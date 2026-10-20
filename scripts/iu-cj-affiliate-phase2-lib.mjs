#!/usr/bin/env node
/** Shared helpers for CJ phase-2 evaluation (local artifacts + batch audit). */
import path from "node:path";
import { defaultStateDir, readJson, writeJson, extractCjLinkIdFromClickUrl } from "./iu-cj-affiliate-phase1-lib.mjs";
import { promotionConditionsDocumented } from "./iu-cj-affiliate-phase2-promotion-terms.mjs";

export { defaultStateDir, readJson, writeJson, extractCjLinkIdFromClickUrl };

export function parseCjDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = new Date(s.replace(/\.0$/, "").replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

export function hostFromUrl(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function classifyTimeWindow(startRaw, endRaw, ref) {
  const start = parseCjDate(startRaw);
  const end = parseCjDate(endRaw);
  if (!start && !end) return "time_unverified";
  if (end && end < ref) return "expired";
  if (start && start > ref) return "future";
  if (start && end && start <= ref && ref <= end) return "time_active";
  if (start && !end && start <= ref) return "time_open_end_missing";
  if (!start && end) return "time_unverified";
  return "time_unverified";
}

const DISCOUNT_EVIDENCE_RE =
  /(\d+\s*%)|(\%\s*off)|sleva|discount|save|off\b|free shipping|doprava zdarma|kupón|coupon|promo/i;

export function creativeText(link) {
  const parts = [link.description, link.linkName, link.adContent].filter(Boolean).map(String);
  return parts.join(" ").trim();
}

export function hasDiscountEvidence(text) {
  return DISCOUNT_EVIDENCE_RE.test(String(text || ""));
}

export function stripHtmlLite(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** CJ Link Search: description/ad-content = creative copy, not full program legal terms (per CJ field docs). */
export function termsCompleteness(link) {
  const desc = String(link.description || "").trim();
  const ad = String(link.adContent || "").trim();
  const combinedRaw = [desc, ad].filter(Boolean).join("\n");
  const stripped = stripHtmlLite(combinedRaw);
  const htmlLike = /<[a-z][\s\S]*?>/i.test(combinedRaw);
  const creativeCopyPresent = stripped.length > 0;
  const qualityHeuristicSubstantive = stripped.length >= 40 && !/^[\W_]+$/u.test(stripped);
  if (creativeCopyPresent) {
    return {
      creativeCopyPresent,
      qualityHeuristicSubstantive,
      /** @deprecated use qualityHeuristicSubstantive — not proof of complete promotion terms */
      substantivePromotionCopy: qualityHeuristicSubstantive,
      strippedTextLength: stripped.length,
      htmlLike,
      fullPromotionTerms: "not_in_link_search_fields",
      programTermsSource: "cj_account_manager_program_agreement",
      note: ">=40 chars is quality heuristic only; promotion completeness requires documented scope/validity signals",
    };
  }
  return {
    creativeCopyPresent: false,
    qualityHeuristicSubstantive: false,
    substantivePromotionCopy: false,
    strippedTextLength: 0,
    htmlLike: false,
    fullPromotionTerms: "missing_in_export",
    programTermsSource: "cj_account_manager_program_agreement",
    note: "Parser supports description/ad-content; requires enrich or re-fetch by link-id",
  };
}

export function isAutoDiscountPromotionType(pt) {
  const t = String(pt || "").trim().toLowerCase();
  return t === "sale/discount" || t === "free shipping";
}

export function offerKind(link) {
  const code = normCode(link.couponCode);
  const pt = String(link.promotionType || "").trim();
  if (code) return "coupon_coded";
  if (pt === "Product" || pt === "Seasonal Link" || pt === "Coupon") return "not_auto_discount";
  if (isAutoDiscountPromotionType(pt)) return "candidate_discount_no_code";
  return "general_link";
}

export function assessOffer(link, ref, opts = {}) {
  const productLinkVerified = Boolean(opts.productLinkVerified);
  const timeWindow = classifyTimeWindow(link.promotionStartDate, link.promotionEndDate, ref);
  const timeProvablyActive = timeWindow === "time_active";
  const kind = offerKind(link);
  const creative = creativeText(link);
  const terms = termsCompleteness(link);
  const evidence = hasDiscountEvidence(creative);
  const hardBlockers = [];
  const advisories = [];

  if (timeWindow === "expired" || timeWindow === "future") hardBlockers.push("time_window");
  if (timeWindow === "time_unverified") hardBlockers.push("time_not_proven");
  if (timeWindow === "time_open_end_missing") hardBlockers.push("promotion_end_not_documented");

  let couponReady = false;
  let conditionsSufficient = false;

  const promoDoc = kind === "coupon_coded" || kind === "candidate_discount_no_code" ? promotionConditionsDocumented(link, ref) : null;

  if (kind === "coupon_coded") {
    couponReady = Boolean(normCode(link.couponCode));
    conditionsSufficient = Boolean(promoDoc?.documented);
    if (!couponReady) hardBlockers.push("coupon_code_missing");
    if (!terms.creativeCopyPresent) hardBlockers.push("creative_copy_missing");
    if (!conditionsSufficient) hardBlockers.push("promotion_conditions_not_documented");
    advisories.push("full_program_terms_not_in_link_search");
    if (!productLinkVerified) advisories.push("coupon_product_link_unverified");
  } else if (kind === "candidate_discount_no_code") {
    couponReady = false;
    conditionsSufficient = evidence && Boolean(promoDoc?.documented);
    if (!evidence) hardBlockers.push("discount_not_evidence_in_creative");
    if (!terms.creativeCopyPresent) hardBlockers.push("creative_copy_missing");
    if (!conditionsSufficient) hardBlockers.push("promotion_conditions_not_documented");
    advisories.push("full_program_terms_not_in_link_search");
    if (!productLinkVerified) advisories.push("offer_product_link_unverified");
  } else {
    hardBlockers.push("not_classified_as_publishable_discount");
  }

  const publishReadyCouponOnly =
    kind === "coupon_coded" &&
    timeProvablyActive &&
    couponReady &&
    conditionsSufficient &&
    hardBlockers.length === 0;

  const publishReadyDiscountAction =
    kind === "candidate_discount_no_code" && timeProvablyActive && conditionsSufficient && hardBlockers.length === 0;

  const publishReadyWithProducts =
    productLinkVerified && (publishReadyCouponOnly || publishReadyDiscountAction);

  const publishReady = publishReadyCouponOnly || publishReadyDiscountAction;

  const publishCandidateCoupon =
    kind === "coupon_coded" &&
    timeProvablyActive &&
    couponReady &&
    terms.creativeCopyPresent &&
    hardBlockers.filter((b) => b !== "promotion_conditions_not_documented").length === 0;

  const publishCandidateDiscount =
    kind === "candidate_discount_no_code" && timeProvablyActive && terms.creativeCopyPresent && evidence;

  return {
    timeWindow,
    timeProvablyActive,
    kind,
    couponReady,
    conditionsSufficient,
    productLinkVerified,
    cartVerified: false,
    cartVerificationNote: "CJ availability does not verify checkout",
    terms,
    promotionConditions: promoDoc,
    discountEvidenceInCreative: evidence,
    publishCandidateCoupon,
    publishCandidateDiscount,
    publishReady,
    publishReadyCouponOnly,
    publishReadyDiscountAction,
    publishReadyWithProducts,
    publishBlockers: [...new Set(hardBlockers)],
    publishAdvisories: [...new Set(advisories)],
    publishBlockersLegacyStrict: [...new Set([...hardBlockers, ...advisories])],
  };
}

/** @deprecated use assessOffer */
export function publishReadiness(link, ref, opts) {
  return assessOffer(link, ref, opts);
}

export function mergeLinkWithEnrichment(base, overlay) {
  if (!overlay) return base;
  if (String(overlay.status || "") !== "ok") return base;
  return {
    ...base,
    description: overlay.description || base.description,
    adContent: overlay.adContent || base.adContent,
    targetedCountries: overlay.targetedCountries || base.targetedCountries,
    lastUpdated: overlay.lastUpdated || base.lastUpdated,
    enrichmentSource: overlay.enrichmentSource || null,
    enrichmentAt: overlay.enrichmentAt || null,
  };
}

export function offerClusterKey(link) {
  return [
    String(link.advertiserId || ""),
    normCode(link.couponCode),
    String(link.promotionStartDate || "").slice(0, 19),
    String(link.promotionEndDate || "").slice(0, 19),
    hostFromUrl(link.destination),
    String(link.linkName || "").trim().toLowerCase(),
  ].join("\u001f");
}

/** Same coupon code across advertisers is not one global offer. */
export function couponOfferIdentityKey(link, ref) {
  const terms = termsCompleteness(link);
  const stripped = terms.strippedTextLength ? stripHtmlLite([link.description, link.adContent].filter(Boolean).join(" ")).slice(0, 120) : "";
  return [
    String(link.advertiserId || ""),
    normCode(link.couponCode),
    String(link.targetedCountries || "").trim().toUpperCase(),
    String(link.promotionStartDate || "").slice(0, 10),
    String(link.promotionEndDate || "").slice(0, 10),
    stripped.toLowerCase(),
  ].join("\u001f");
}

export function loadPhase1Artifacts(stateDir = defaultStateDir()) {
  return {
    stateDir,
    liveRun: readJson(path.join(stateDir, "cj-pipeline-last-run.json"), {}),
    compare: readJson(path.join(stateDir, "cj-web-compare-report.json"), {}),
    advertisers: readJson(path.join(stateDir, "cj-advertisers-joined.json"), { advertisers: [] }),
    links: readJson(path.join(stateDir, "cj-promotions-links.json"), { links: [] }),
  };
}
