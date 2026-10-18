#!/usr/bin/env node
/** Shared landing + publication gates for one coupon–product row (bulk and card probes use this). */
import path from "node:path";
import { defaultStateDir, readJson } from "./iu-cj-affiliate-phase1-lib.mjs";
import { parseCouponScope } from "./iu-cj-affiliate-phase2-coupon-scope.mjs";
import {
  evaluateCouponCzPublish,
  evaluateProductBinding,
  extractLandingUrl,
} from "./iu-cj-affiliate-phase2-coupon-eligibility.mjs";
import { assessPublicationGates } from "./iu-cj-affiliate-phase2-publication-gates.mjs";
import {
  assessLandingIdentity,
  classifyLandingTargetType,
  fetchLandingSafe,
  hostSuffixesFromProductAndCouponUrls,
  verifyLandingBatchEntry,
} from "./iu-cj-affiliate-phase2-offer-landing-lib.mjs";
import { loadPhase1Artifacts, mergeLinkWithEnrichment } from "./iu-cj-affiliate-phase2-lib.mjs";

export function landingBatchKey(linkId, productId) {
  return String(linkId) + ":" + String(productId);
}

export function readLandingBatchMap(stateDir = defaultStateDir()) {
  const batch = readJson(path.join(stateDir, "cj-phase2-offer-landing-batch.json"), { byKey: {} });
  return batch.byKey || batch.results || {};
}

function linkMetaFromLink(link, row, overlay) {
  const oid = String(row.linkId || link.linkId || "");
  const ov = overlay.byLinkId[oid] || {};
  return {
    linkId: oid,
    destination: link.destination || null,
    couponCode: link.couponCode || row.couponCode || null,
    promotionStartDate: link.promotionStartDate || row.validity?.promotionStartDate || null,
    promotionEndDate: link.promotionEndDate || row.validity?.promotionEndDate || null,
    description: ov.description || link.description || null,
    targetedCountries: ov.targetedCountries || link.targetedCountries || null,
    websitePid: "101883843",
  };
}

/**
 * @param {{
 *   bindingRow: object,
 *   product: object,
 *   linkMeta?: object,
 *   scope?: object,
 *   couponEval?: object,
 *   productEval?: object,
 *   programTermsImage?: object,
 *   refDate?: Date,
 *   landingBatchEntry?: object|null,
 *   fetchLanding?: boolean,
 * }} opts
 */
export async function runProductPublicationPipeline(opts) {
  const refDate = opts.refDate || new Date();
  const bindingRow = opts.bindingRow;
  const product = opts.product;
  const programTermsImage = opts.programTermsImage || { state: "not_fetched" };

  let scope = opts.scope;
  let couponEval = opts.couponEval;
  let linkMeta = opts.linkMeta;
  let productEval = opts.productEval;

  if (!scope || !couponEval || !linkMeta) {
    throw new Error("pipeline_requires_scope_couponEval_linkMeta_or_loader");
  }
  if (!productEval) {
    productEval = evaluateProductBinding({
      bindingRow,
      product,
      scope,
      linkMeta,
      couponEval,
      refDate,
    });
  }

  const productInner = extractLandingUrl(product.affiliateClickUrl)?.href;
  const couponDest = linkMeta.destination;
  const allow = hostSuffixesFromProductAndCouponUrls(productInner, couponDest);

  let landingIdentity;
  let productFetch = null;
  let landingSource = "not_fetched";
  let landingBatchVerify = null;

  const batch = opts.landingBatchEntry;
  if (batch?.landingIdentity) {
    landingBatchVerify = verifyLandingBatchEntry(batch, {
      linkId: bindingRow.linkId,
      productId: product.productId,
      product,
      linkMeta,
      bindingRow,
      scope,
      refDate,
    });
    if (landingBatchVerify.ok) {
      landingIdentity = landingBatchVerify.landingIdentity;
      productFetch = batch.productFetch || null;
      landingSource = "landing_batch_artifact_verified";
    } else {
      const layer = landingBatchVerify.linkageLayer || "unknown";
      landingIdentity = {
        status: "unknown",
        reason: "landing_batch_" + layer + "_stale:" + landingBatchVerify.reason,
        evidence: batch.landingIdentity?.evidence || [],
        blockers: ["landing_batch_linkage_failed"],
        productId: product.productId != null ? String(product.productId) : null,
      };
      productFetch = batch.productFetch || null;
      landingSource = "landing_batch_rejected";
    }
  } else if (opts.fetchLanding && productInner) {
    productFetch = await fetchLandingSafe(productInner, { allowedHostSuffixes: allow });
    landingIdentity = assessLandingIdentity({
      product,
      couponLinkMeta: linkMeta,
      productLandingUrl: productInner,
      couponDestinationUrl: couponDest,
      landingFetch: productFetch,
      offerText: bindingRow.offerText,
    });
    landingSource = "live_fetch";
  } else {
    landingIdentity = { status: "unknown", reason: "landing_not_probed", evidence: [] };
    landingSource = "skipped";
  }

  const validity = {
    promotionStartDate: linkMeta.promotionStartDate || bindingRow.validity?.promotionStartDate || null,
    promotionEndDate: linkMeta.promotionEndDate || bindingRow.validity?.promotionEndDate || null,
  };

  const publicationGatesTextOnly = assessPublicationGates({
    productEval,
    product,
    couponEval,
    programTermsImage,
    landingIdentity,
    cardDisplayMode: "text_only",
    validity,
    linkMeta,
    refDate,
  });

  const publicationGatesWithImage = assessPublicationGates({
    productEval,
    product,
    couponEval,
    programTermsImage,
    landingIdentity,
    cardDisplayMode: "with_product_image",
    validity,
    linkMeta,
    refDate,
  });

  return {
    pipelineVersion: "phase2_publication_v1",
    linkId: bindingRow.linkId,
    productId: product.productId,
    landingBatchVerify,
    productInnerUrl: productInner,
    couponDestination: couponDest,
    allowedHostSuffixes: allow,
    productEval,
    couponEval,
    landingIdentity,
    productFetchSummary: productFetch
      ? {
          fetchStatus: productFetch.fetchStatus,
          httpStatus: productFetch.httpStatus,
          gateReason: productFetch.gateReason || null,
        }
      : null,
    landingSource,
    publicationGatesTextOnly,
    publicationGatesWithImage,
    productDestType: productInner
      ? classifyLandingTargetType(productInner, { productId: product.productId })
      : null,
  };
}

export async function loadBindingContext(stateDir, linkId) {
  const hist = readJson(path.join(stateDir, "cj-phase2-coupon-product-bindings.json"), { bindings: [] });
  const row = hist.bindings.find((b) => String(b.linkId) === String(linkId));
  if (!row) return null;
  const overlay = readJson(path.join(stateDir, "cj-link-enrichment-overlay.json"), { byLinkId: {} });
  const { links } = loadPhase1Artifacts(stateDir);
  const raw = (links.links || []).find((l) => String(l.linkId) === String(linkId));
  const link = raw
    ? mergeLinkWithEnrichment(raw, overlay.byLinkId[String(linkId)])
    : { description: row.offerText, linkId: row.linkId };
  const linkMeta = linkMetaFromLink(link, row, overlay);
  const scope = parseCouponScope(link);
  const offerText = scope.offerTextStripped || row.offerText;
  const couponEval = evaluateCouponCzPublish({ bindingRow: { ...row, offerText }, scope, linkMeta });
  return { bindingRow: row, link, linkMeta, scope, couponEval, overlay };
}

export async function runPublicationPipelineForLinkProduct(stateDir, linkId, productId, pipelineOpts = {}) {
  const ctx = await loadBindingContext(stateDir, linkId);
  if (!ctx) return { error: "binding_not_found", linkId };
  const product = (ctx.bindingRow.confirmedProducts || []).find((p) => String(p.productId) === String(productId));
  if (!product) return { error: "product_not_in_binding", linkId, productId };

  const programTerms = readJson(path.join(stateDir, "cj-phase2-program-terms-probe.json"), null);
  const batchMap = readLandingBatchMap(stateDir);
  const key = landingBatchKey(linkId, productId);
  const batchEntry = batchMap[key] || null;

  return runProductPublicationPipeline({
    bindingRow: ctx.bindingRow,
    product,
    linkMeta: ctx.linkMeta,
    scope: ctx.scope,
    couponEval: ctx.couponEval,
    programTermsImage: programTerms?.imageUsage || pipelineOpts.programTermsImage,
    refDate: pipelineOpts.refDate,
    landingBatchEntry: batchEntry,
    fetchLanding: Boolean(pipelineOpts.fetchLanding),
  });
}

export function pipelineStateFingerprint(result) {
  const g = result.publicationGatesTextOnly || {};
  return {
    landing: result.landingIdentity?.status,
    landingReason: result.landingIdentity?.reason,
    publicationReady: g.publicationReady,
    blockers: g.blockers || [],
    couponProductEligible: g.couponProductEligible,
    affiliateLinkValid: g.affiliateLinkValid,
  };
}
