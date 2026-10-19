#!/usr/bin/env node
/** Build coupon + product card view models from phase-2 pipeline (no invented prices/discounts). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./iu-cj-affiliate-phase1-lib.mjs";
import {
  loadBindingContext,
  runPublicationPipelineForLinkProduct,
} from "./iu-cj-affiliate-phase2-publication-pipeline.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));

export function resolveFixtureStateDir(stateDir) {
  if (stateDir) return stateDir;
  const candidates = [
    path.join(scriptsRoot, "fixtures", "pipeline-parity-v29-2", "state"),
    path.join(scriptsRoot, "scripts", "fixtures", "pipeline-parity-v29-2", "state"),
  ];
  for (const c of candidates) {
    try {
      if (readJson(path.join(c, "cj-promotions-links.json"), null)) return c;
    } catch {
      /* try next */
    }
  }
  return candidates[0];
}

function moneyLabel(value, unit, currency) {
  if (value == null || value === "") return null;
  const u = String(unit || "").toLowerCase();
  if (u === "percent" || u === "percentage") return `${value} %`;
  if (currency) return `${value} ${currency}`;
  return String(value);
}

function productCardFromPipeline(pipeline, product, partnerName) {
  const g = pipeline.publicationGatesTextOnly || {};
  const pe = pipeline.productEval || {};
  const price = product?.price ?? product?.salePrice ?? null;
  const original = product?.retailPrice ?? product?.originalPrice ?? null;
  const showOriginal =
    original != null &&
    price != null &&
    Number(original) > Number(price) &&
    pe.originalPriceVerified === true;
  const discountLabel =
    pe.customerDiscountVerified === true && pe.customerDiscountDisplay
      ? pe.customerDiscountDisplay
      : null;
  return {
    productId: String(product.productId),
    title: product.title || product.name || `Produkt ${product.productId}`,
    partnerName,
    imageUrl: g.imageLicenseOk === true && product.imageUrl ? product.imageUrl : null,
    imageFallback: "text",
    currentPrice: price != null ? moneyLabel(price, "amount", product.currency) : null,
    originalPrice: showOriginal ? moneyLabel(original, "amount", product.currency) : null,
    discountLabel,
    affiliateUrl: g.affiliateLinkValid ? pipeline.productInnerUrl || product.link || null : null,
    validityTo: null,
    sourceSystem: "CJ",
    verifiedAt: product.queryMeta?.observedAt || null,
    publicationReady: g.publicationReady === true,
    blockers: g.blockers || [],
    publisherCommissionNote:
      "Provize vydavatele není zákaznická sleva a na kartě se nezobrazuje.",
  };
}

function couponCardFromContext(ctx, pipeline) {
  const g = pipeline.publicationGatesTextOnly || {};
  const ce = ctx.couponEval || {};
  return {
    couponCode: ctx.linkMeta?.couponCode || ctx.bindingRow?.couponCode || null,
    partnerName: ctx.bindingRow?.advertiserName || "Partner",
    cjLinkId: String(ctx.bindingRow?.linkId || ""),
    customerDiscount: moneyLabel(
      ce.customerDiscountValue,
      ce.customerDiscountUnit,
      ce.currency
    ),
    conditionsSummary: ctx.scope?.conditionsText || ctx.bindingRow?.offerText || null,
    minOrderValue: ce.minOrderValue ?? null,
    assortmentScope: ctx.scope?.assortmentScopeLabel || null,
    exclusions: ce.documentedExclusions || [],
    validFrom: ctx.linkMeta?.promotionStartDate || null,
    validTo: ctx.linkMeta?.promotionEndDate || null,
    affiliateUrl: g.affiliateLinkValid ? ctx.linkMeta?.destination || null : null,
    permissionEvidence: {
      contractState: g.contractPermissionState || ce.contractPermissionState || "unknown",
      publicationReady: g.publicationReady === true,
    },
    sourceSystem: "CJ",
    verifiedAt: ctx.bindingRow?.observedAt || null,
    publicationReady: g.publicationReady === true,
    blockers: g.blockers || [],
  };
}

/**
 * @param {string} stateDir
 * @param {{ linkId: string, sectionKey: string, partnerSlug: string, refDate?: Date, maxProducts?: number }} opts
 */
export async function buildSectionOfferViewModel(stateDir, opts) {
  const dir = resolveFixtureStateDir(stateDir);
  const linkId = String(opts.linkId);
  const maxProducts = opts.maxProducts ?? 12;
  const ctx = await loadBindingContext(dir, linkId);
  if (!ctx) return { ok: false, reason: "binding_not_found", linkId };

  const products = (ctx.bindingRow.confirmedProducts || []).slice(0, maxProducts);
  const partnerName = ctx.bindingRow.advertiserName || "Autohotarek.cz";
  const productCards = [];
  for (const product of products) {
    const pipeline = await runPublicationPipelineForLinkProduct(dir, linkId, product.productId, {
      refDate: opts.refDate || new Date("2026-10-17T12:00:00Z"),
      fetchLanding: false,
    });
    if (pipeline.error) continue;
    const card = productCardFromPipeline(pipeline, product, partnerName);
    card.validityTo = ctx.linkMeta?.promotionEndDate || null;
    productCards.push(card);
  }

  const primaryPipeline = await runPublicationPipelineForLinkProduct(
    dir,
    linkId,
    products[0]?.productId || "IDN32844",
    { refDate: opts.refDate || new Date("2026-10-17T12:00:00Z"), fetchLanding: false }
  );
  const coupon =
    primaryPipeline.error != null
      ? null
      : couponCardFromContext(ctx, primaryPipeline);

  return {
    ok: true,
    schemaVersion: "cj_phase2_section_offers_v1",
    previewOnly: true,
    productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
    sectionKey: opts.sectionKey,
    partnerSlug: opts.partnerSlug,
    linkId,
    coupon,
    productCards,
    display: {
      defaultVisibleProducts: 3,
      showMoreLabel: "Zobrazit další",
    },
    generatedAt: new Date().toISOString(),
    stateDir: dir,
  };
}
