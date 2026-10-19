#!/usr/bin/env node
/** Reclassify historical confirmed bindings → eligible/ineligible/unknown (no re-bind). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultStateDir, readJson, writeJson } from "./iu-cj-affiliate-phase1-lib.mjs";
import { parseCouponScope } from "./iu-cj-affiliate-phase2-coupon-scope.mjs";
import {
  COUPON_PUBLICATION_CARD_TYPE,
  COUPON_PUBLICATION_TRACK,
  IU_CJ_ELIGIBILITY_POLICY,
  buildCouponCardPresentation,
  classifyCouponPublicationCardType,
  evaluateCouponCzPublish,
  evaluateProductBinding,
  explainAutohotarekProductGap,
  validatePublicationCard,
} from "./iu-cj-affiliate-phase2-coupon-eligibility.mjs";
import {
  assessCouponOnlyPublicationGates,
  legacyPublishableProductBlock,
} from "./iu-cj-affiliate-phase2-publication-gates.mjs";
import {
  landingBatchKey,
  readLandingBatchMap,
  runProductPublicationPipeline,
} from "./iu-cj-affiliate-phase2-publication-pipeline.mjs";
import { loadPhase1Artifacts, mergeLinkWithEnrichment } from "./iu-cj-affiliate-phase2-lib.mjs";

const stateDir = defaultStateDir();
const histPath = path.join(stateDir, "cj-phase2-coupon-product-bindings.json");
const histArchive = path.join(stateDir, "cj-phase2-coupon-product-bindings-historical-2026-10-17T045156Z.json");

if (!fs.existsSync(histArchive) && fs.existsSync(histPath)) {
  fs.copyFileSync(histPath, histArchive);
}

const historical = readJson(histPath, null);
if (!historical) {
  console.log(JSON.stringify({ IU_CJ_COUPON_BINDING_REEVAL: "FAIL", error: "missing_historical_bindings" }));
  process.exitCode = 1;
  process.exit(1);
}

const overlay = readJson(path.join(stateDir, "cj-link-enrichment-overlay.json"), { byLinkId: {} });
const programTermsProbe = readJson(path.join(stateDir, "cj-phase2-program-terms-probe.json"), null);
const programTermsImage = programTermsProbe?.imageUsage || { state: "not_fetched" };
const landingBatchMap = readLandingBatchMap(stateDir);
const { links } = loadPhase1Artifacts(stateDir);

function linkForBinding(row) {
  const raw = (links.links || []).find((l) => String(l.linkId) === String(row.linkId));
  if (!raw) return { description: row.offerText, adContent: "", linkId: row.linkId };
  return mergeLinkWithEnrichment(raw, overlay.byLinkId[String(row.linkId)]);
}

function linkMetaFromLink(link, row) {
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

const reasonCounts = { eligible: {}, ineligible: {}, unknown: {} };
function bump(bucket, reason) {
  const k = reason || "unspecified";
  reasonCounts[bucket][k] = (reasonCounts[bucket][k] || 0) + 1;
}

const reevaluatedBindings = [];
let totalHistoricalConfirmed = 0;
let legacyPublishableProductBlockRows = 0;
let couponProductEligibleRows = 0;
let publicationReadyProductRows = 0;
let wholeSortimentCouponCardsReady = 0;
let wholeSortimentCzechStorefrontReady = 0;
let wholeSortimentForeignForCzReady = 0;
let wholeSortimentUnknownCandidates = 0;
let limitedSortimentCouponCardsReady = 0;

for (const row of historical.bindings || []) {
  const link = linkForBinding(row);
  const linkMeta = linkMetaFromLink(link, row);
  const scope = parseCouponScope(link);
  const offerText = scope.offerTextStripped || row.offerText;
  const couponEval = evaluateCouponCzPublish({ bindingRow: { ...row, offerText }, scope, linkId: row.linkId, linkMeta });
  const cardTypeInfo = classifyCouponPublicationCardType(scope, couponEval, offerText, linkMeta);
  const cardPresentation = buildCouponCardPresentation(scope, couponEval, linkMeta);
  const validity = {
    promotionStartDate: linkMeta.promotionStartDate || row.validity?.promotionStartDate || null,
    promotionEndDate: linkMeta.promotionEndDate || row.validity?.promotionEndDate || null,
  };
  let couponCardPublicationGates = null;
  if (cardTypeInfo.type === COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER) {
    couponCardPublicationGates = assessCouponOnlyPublicationGates({
      couponEval,
      linkMeta,
      validity,
      publicationCardType: cardTypeInfo.type,
      cardMetadata: cardTypeInfo.cardMetadata,
    });
    if (couponCardPublicationGates.publicationReady) {
      wholeSortimentCouponCardsReady += 1;
      if (couponEval.publicationTrack === COUPON_PUBLICATION_TRACK.FOREIGN_FOR_CZ) {
        wholeSortimentForeignForCzReady += 1;
      } else {
        wholeSortimentCzechStorefrontReady += 1;
      }
    }
  }
  const wholeSortimentScope =
    String(scope.scopeType || "").includes("full_sortiment") || scope.scopeType === "full_sortiment";
  if (
    wholeSortimentScope &&
    couponEval.publicationTrack === COUPON_PUBLICATION_TRACK.UNKNOWN_CANDIDATE &&
    !(couponCardPublicationGates && couponCardPublicationGates.publicationReady)
  ) {
    wholeSortimentUnknownCandidates += 1;
  }

  const evaluatedProducts = [];
  for (const prod of row.confirmedProducts || []) {
    totalHistoricalConfirmed += 1;
    const ev = evaluateProductBinding({
      bindingRow: { ...row, offerText },
      product: prod,
      scope,
      linkId: row.linkId,
      linkMeta,
      couponEval,
    });
    bump(ev.eligibility, ev.eligibilityReason);
    if (legacyPublishableProductBlock(ev, couponEval)) legacyPublishableProductBlockRows += 1;
    if (ev.eligibility === "eligible") couponProductEligibleRows += 1;
    const batchKey = landingBatchKey(row.linkId, prod.productId);
    const pipeline = await runProductPublicationPipeline({
      bindingRow: row,
      product: prod,
      linkMeta,
      scope,
      couponEval,
      productEval: ev,
      programTermsImage,
      validity: row.validity,
      landingBatchEntry: landingBatchMap[batchKey] || null,
      fetchLanding: false,
    });
    const publicationGatesTextOnly = pipeline.publicationGatesTextOnly;
    if (publicationGatesTextOnly.publicationReady) publicationReadyProductRows += 1;
    evaluatedProducts.push({
      ...prod,
      ...ev,
      publicationGatesTextOnly,
      landingIdentity: pipeline.landingIdentity,
      landingSource: pipeline.landingSource,
      landingBatchVerify: pipeline.landingBatchVerify,
    });
  }

  const eligible = evaluatedProducts.filter((p) => p.eligibility === "eligible");
  const publishable = evaluatedProducts.filter((p) => p.publicProductBlockPublishable);
  const publicationReadyProducts = evaluatedProducts.filter((p) => p.publicationGatesTextOnly?.publicationReady);
  const ineligible = evaluatedProducts.filter((p) => p.eligibility === "ineligible");
  const unknown = evaluatedProducts.filter((p) => p.eligibility === "unknown");

  let displayProducts = [];
  if (cardTypeInfo.type === COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT) {
    displayProducts = publicationReadyProducts.slice(0, 3);
    if (displayProducts.length > 0) {
      const cardCheck = validatePublicationCard({
        publicationCardType: COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT,
        validity,
        linkMeta,
        couponCzPublish: couponEval,
        displayProducts,
      });
      if (cardCheck.ok) limitedSortimentCouponCardsReady += 1;
    }
  }

  reevaluatedBindings.push({
    ...row,
    scopeTypeReeval: scope.scopeType,
    scopeEvidenceReeval: scope.evidence,
    targetStoreHost: scope.targetStoreHost || null,
    linkMetaUsed: linkMeta,
    couponCzPublish: couponEval,
    publicationCardType: cardTypeInfo.type,
    publicationCardTypeReason: cardTypeInfo.reason,
    cardMetadata: cardTypeInfo.cardMetadata || null,
    cardPresentation,
    couponCardPublicationGates,
    cartCondition: couponEval.cartCondition,
    productRowsHistoricalConfirmed: row.confirmedProducts.length,
    productRowsEvaluated: evaluatedProducts,
    historicalSampleProductsNotUsedAsCardDisplay:
      cardTypeInfo.type === COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER,
    displayProducts,
    additionalPublishableProductIds:
      cardTypeInfo.type === COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT
        ? publicationReadyProducts.slice(3).map((p) => p.productId)
        : [],
    eligibleCount: eligible.length,
    publishableProductCount: publishable.length,
    publicationReadyProductCount: publicationReadyProducts.length,
    unknownProductRows: unknown.map((p) => ({
      productId: p.productId,
      eligibility: p.eligibility,
      reason: p.eligibilityReason,
    })),
    ineligibleProductRows: ineligible.map((p) => ({
      productId: p.productId,
      eligibility: p.eligibility,
      reason: p.eligibilityReason,
    })),
    ineligibleCount: ineligible.length,
    unknownCount: unknown.length,
    publicProductBlockPolicy: IU_CJ_ELIGIBILITY_POLICY,
  });
}

for (const row of historical.showcaseFiveCases || []) {
  if (reevaluatedBindings.some((b) => b.linkId === row.linkId)) continue;
  const link = linkForBinding(row);
  const linkMeta = linkMetaFromLink(link, row);
  const scope = parseCouponScope(link);
  const offerText = scope.offerTextStripped || row.offerText;
  const couponEval = evaluateCouponCzPublish({ bindingRow: { ...row, offerText }, scope, linkId: row.linkId, linkMeta });
  reevaluatedBindings.push({
    ...row,
    scopeTypeReeval: scope.scopeType,
    linkMetaUsed: linkMeta,
    couponCzPublish: couponEval,
    cartCondition: couponEval.cartCondition,
    productRowsEvaluated: [],
    displayProducts: [],
    publishableProductCount: 0,
    couponOnlyNote: "no_historical_confirmed_products; coupon_documented_in_showcase",
    publicProductBlockPolicy: IU_CJ_ELIGIBILITY_POLICY,
  });
}

const uniqueCouponsWithEligible = new Set(
  reevaluatedBindings.filter((b) => b.eligibleCount > 0).map((b) => b.linkId)
);
const uniqueCouponsPublishable = new Set(
  reevaluatedBindings.filter((b) => b.publishableProductCount > 0).map((b) => b.linkId)
);

let autohotarekProductGapExample = null;
const ah = reevaluatedBindings.find((b) => String(b.linkId) === "17365257");
if (ah?.productRowsEvaluated?.[0]) {
  const ahScope = parseCouponScope(linkForBinding(ah));
  autohotarekProductGapExample = explainAutohotarekProductGap(
    ah.productRowsEvaluated[0],
    ah,
    ah.linkMetaUsed || { linkId: "17365257", destination: "https://www.autohotarek.cz/" },
    ahScope
  );
}

const eligibleRowsLandingBatchDiagnostics = [];
for (const b of reevaluatedBindings) {
  for (const p of b.productRowsEvaluated || []) {
    if (p.eligibility !== "eligible") continue;
    const v = p.landingBatchVerify;
    eligibleRowsLandingBatchDiagnostics.push({
      linkId: b.linkId,
      productId: p.productId != null ? String(p.productId) : null,
      landingBatchReason: v?.reason || p.landingIdentity?.reason || null,
      linkageLayer: v?.linkageLayer || null,
      productIdentityLinkage: v?.productIdentityLinkage || null,
      offerActionLinkage: v?.offerActionLinkage || null,
      diagnostics: v?.diagnostics || null,
      landingSource: p.landingSource || null,
    });
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  historicalArchive: histArchive,
  eligibleRowsLandingBatchDiagnostics,
  historicalSnapshot: {
    generatedAt: historical.generatedAt,
    totalConfirmedProductRows: historical.totalConfirmedProductRows,
    bindingsWithProducts: historical.bindingsWithProducts,
  },
  reevalRulesVersion: IU_CJ_ELIGIBILITY_POLICY.rulesVersion,
  policyWhenUncertainDoNotPublish: true,
  publicationDimensionsNote:
    "whole_sortiment_partner_coupon cards do not use historical batch samples as displayProducts; product_row publicationReady is separate",
  totals: {
    historicalConfirmedRowsReclassified: totalHistoricalConfirmed,
    uniqueCouponsWithAtLeastOneEligibleProduct: uniqueCouponsWithEligible.size,
    uniqueCouponsWithPublishableProductBlockRows: uniqueCouponsPublishable.size,
    eligibleBindingRows: Object.values(reasonCounts.eligible).reduce((a, n) => a + n, 0),
    couponProductEligibleRows,
    publicationReadyProductRows,
    publicationReadyRows: publicationReadyProductRows,
    wholeSortimentCouponCardsReady,
    wholeSortimentCzechStorefrontReady,
    wholeSortimentForeignForCzReady,
    wholeSortimentUnknownCandidates,
    limitedSortimentCouponCardsReady,
    legacyPublishableProductBlockRows,
    ineligibleBindingRows: Object.values(reasonCounts.ineligible).reduce((a, n) => a + n, 0),
    unknownBindingRows: Object.values(reasonCounts.unknown).reduce((a, n) => a + n, 0),
  },
  reasonBreakdown: reasonCounts,
  autohotarekProductGapExample,
  bindings: reevaluatedBindings,
  productionAutomationOffLocalPc: "NOT_DONE",
};

const outPath = path.join(stateDir, "cj-phase2-coupon-product-bindings-reeval.json");
writeJson(outPath, out);

const cardFull = reevaluatedBindings.map((b) => ({
  type:
    b.publicationCardType === COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER
      ? "whole_sortiment_partner_coupon"
      : b.publishableProductCount
        ? "limited_sortiment_with_products"
        : "limited_sortiment_or_blocked",
  linkId: b.linkId,
  publicationCardType: b.publicationCardType,
  couponCode: b.couponCode,
  offerText: b.offerText,
  validity: b.validity,
  cartCondition: b.cartCondition,
  cardPresentation: b.cardPresentation || null,
  linkMetaUsed: b.linkMetaUsed || null,
  couponCzPublish: b.couponCzPublish,
  couponCardPublicationGates: b.couponCardPublicationGates || null,
  displayProducts: b.displayProducts,
  publishableProductCount: b.publishableProductCount,
  eligibleCount: b.eligibleCount,
  ineligibleCount: b.ineligibleCount,
  unknownCount: b.unknownCount,
}));

function wholeSortimentScopeKind(binding) {
  const pres = binding.cardPresentation;
  const exclusions = pres?.productExclusionLines?.length ? pres.productExclusionLines : binding.scopeEvidenceReeval || [];
  const hasExcl = (pres?.productExclusionLines || []).length > 0;
  if (hasExcl) return "whole_sortiment_with_documented_exclusions";
  if (binding.cartCondition || pres?.minimumOrderCondition) return "whole_sortiment_with_minimum_order";
  return "whole_sortiment_unconditional_for_named_store";
}

const readyWholeSortiment = reevaluatedBindings.filter(
  (b) => b.couponCardPublicationGates?.publicationReady === true
);
const readyCzech = readyWholeSortiment.filter(
  (b) => b.couponCzPublish?.publicationTrack !== COUPON_PUBLICATION_TRACK.FOREIGN_FOR_CZ
);
const readyForeign = readyWholeSortiment.filter(
  (b) => b.couponCzPublish?.publicationTrack === COUPON_PUBLICATION_TRACK.FOREIGN_FOR_CZ
);
const unknownWhole = reevaluatedBindings.filter((b) => {
  const ws =
    String(b.scopeTypeReeval || "").includes("full_sortiment") || b.scopeTypeReeval === "full_sortiment";
  return (
    ws &&
    b.couponCzPublish?.publicationTrack === COUPON_PUBLICATION_TRACK.UNKNOWN_CANDIDATE &&
    !(b.couponCardPublicationGates && b.couponCardPublicationGates.publicationReady)
  );
});
const phase1Meta = readJson(path.join(stateDir, "cj-promotions-links.json"), { syncedAt: null });

function mapWholeOfferRow(b) {
  const pres = b.cardPresentation || {};
  const bundle = b.couponCzPublish?.offerEvidenceBundle || {};
  return {
    partner: b.advertiserName,
    advertiserCid: b.advertiserId,
    aid: String(b.linkId),
    couponCode: b.couponCode,
    publicationTrack: b.couponCzPublish?.publicationTrack || null,
    presentationVariant: b.couponCzPublish?.presentationVariant || pres.presentationVariant || null,
    scopeKind: wholeSortimentScopeKind(b),
    proposedCardScopeLabel: pres.proposedCardScopeLabel || null,
    market: {
      targetedCountries: b.linkMetaUsed?.targetedCountries || null,
      storefrontMarket: b.couponCzPublish?.storefrontIdentity?.storefrontMarket || null,
      czCustomerAvailability: b.couponCzPublish?.czCustomerAvailability || null,
      destinationPathMarketHint: pres.storeAndMarket?.destinationPathMarketHint || null,
    },
    storeHosts: bundle.stores || (b.targetStoreHost ? [b.targetStoreHost] : []),
    validity: {
      promotionStartDate: b.linkMetaUsed?.promotionStartDate || b.validity?.promotionStartDate || null,
      promotionEndDate: b.linkMetaUsed?.promotionEndDate || b.validity?.promotionEndDate || null,
    },
    cartCondition: b.cartCondition || pres.minimumOrderCondition || null,
    exclusions: pres.productExclusionLines || [],
    exclusionSpansRaw: b.scopeEvidenceReeval?.filter((e) => String(e).startsWith("creative_na_phrase:")) || [],
    cardPresentation: pres,
    evidence: {
      sources: bundle.sources?.join("|") || null,
      phase1ExportSyncedAt: phase1Meta.syncedAt || null,
      reevalGeneratedAt: out.generatedAt,
      destination: b.linkMetaUsed?.destination || null,
    },
    cardMetadata: b.cardMetadata || null,
    displayProductsOnCard: 0,
    historicalSampleProductsNotCardDisplay: true,
  };
}

const wholeSortimentOffers = {
  generatedAt: out.generatedAt,
  phase1LinksSyncedAt: phase1Meta.syncedAt || null,
  note:
    "Foreign storefront/EUR is allowed; CZ delivery must be documented for foreign prepared cards; never present foreign offer as Czech storefront variant",
  counts: {
    preparedCzechStorefront: readyCzech.length,
    preparedForeignForCzVisitors: readyForeign.length,
    preparedTotal: readyWholeSortiment.length,
    unknownWholeSortimentCandidates: unknownWhole.length,
  },
  preparedCzechStorefrontOffers: readyCzech.map(mapWholeOfferRow),
  preparedForeignForCzVisitorsOffers: readyForeign.map(mapWholeOfferRow),
  unknownWholeSortimentCandidates: unknownWhole.map((b) => ({
    aid: String(b.linkId),
    couponCode: b.couponCode,
    publicationTrack: b.couponCzPublish?.publicationTrack,
    missingDecisiveFact: b.couponCzPublish?.missingDecisiveFact,
    publishBlockReason: b.couponCzPublish?.publishBlockReason,
    presentationVariant: b.couponCzPublish?.presentationVariant,
    linkMetaUsed: b.linkMetaUsed,
    cartCondition: b.cartCondition,
    cardPresentation: b.cardPresentation || null,
  })),
  decisionChanges: [
    {
      aid: "17333067",
      couponCode: "AFFIL10",
      change: "slovak_storefront_unknown_candidate_not_czech_variant",
      reason:
        "Separate from CZ AFFIL10 (17313396); EUR/40 EUR/všetky produkty; missing cz_customer_delivery_or_service in stored creative",
    },
    {
      aid: "17346749",
      couponCode: "JESEN20",
      change: "not_for_cz_visitors_unknown",
      reason: "targetedCountries SK without CZ — territorial coupon condition, not EUR/store block",
    },
  ],
};

writeJson(path.join(os.tmpdir(), "iu-cj-whole-sortiment-11-offers.json"), wholeSortimentOffers);
writeJson(path.join(stateDir, "cj-phase2-whole-sortiment-coupon-cards-ready.json"), wholeSortimentOffers);

writeJson(path.join(stateDir, "cj-phase2-card-prep-full-reeval.json"), {
  generatedAt: out.generatedAt,
  publicProductBlockNote: "validatePublicationCard must pass before any publish",
  cards: cardFull,
});

let publicationValidatorViolations = 0;
for (const card of cardFull) {
  const binding = reevaluatedBindings.find((b) => b.linkId === card.linkId);
  if (card.publicationCardType === COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER) {
    const v = validatePublicationCard({
      publicationCardType: COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER,
      validity: card.validity || binding?.linkMetaUsed,
      linkMeta: binding?.linkMetaUsed,
      couponCzPublish: card.couponCzPublish,
      displayProducts: [],
      cardMetadata: binding?.cardMetadata,
    });
    if (!v.ok) publicationValidatorViolations += v.errors.length;
    continue;
  }
  if (!(card.displayProducts || []).length) continue;
  const v = validatePublicationCard({
    publicationCardType: COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT,
    validity: card.validity || binding?.linkMetaUsed,
    linkMeta: binding?.linkMetaUsed,
    couponCzPublish: card.couponCzPublish,
    displayProducts: card.displayProducts.filter((p) => p.publicationGatesTextOnly?.publicationReady),
  });
  if (!v.ok) publicationValidatorViolations += v.errors.length;
}

const gatePass = publicationValidatorViolations === 0;

console.log(
  JSON.stringify({
    IU_CJ_COUPON_BINDING_REEVAL: gatePass ? "OK" : "FAIL_PUBLICATION_VALIDATOR",
    outPath,
    historicalConfirmed: totalHistoricalConfirmed,
    eligibleRows: out.totals.eligibleBindingRows,
    couponProductEligibleRows,
    publicationReadyProductRows,
    wholeSortimentCouponCardsReady,
    wholeSortimentCzechStorefrontReady,
    wholeSortimentForeignForCzReady,
    wholeSortimentUnknownCandidates,
    limitedSortimentCouponCardsReady,
    legacyPublishableProductBlockRows,
    publicationValidatorViolations,
    gatePublicationValidator: gatePass,
    autohotarekGapReason: autohotarekProductGapExample?.eligibilityReason || null,
  })
);
process.exitCode = gatePass ? 0 : 1;
