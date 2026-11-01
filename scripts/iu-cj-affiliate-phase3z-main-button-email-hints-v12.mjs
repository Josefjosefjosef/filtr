#!/usr/bin/env node
/**
 * Phase 3Z V12 — email hints for MAIN buttons only (Forpsi reuse).
 *
 * - Never executes email instructions.
 * - Never trusts links/attachments as executable.
 * - Pairing by advertiser CID (or explicit fixture CID), not fuzzy name alone.
 * - SEM brand-bid / coupon-partner restrictions do NOT ban ordinary main buttons.
 * - Stale welcome email loses to newer CJ program terms when timestamps conflict.
 */
export const PHASE3Z_MAIN_BUTTON_EMAIL_SCHEMA =
  "iu-cj-affiliate-phase3z-main-button-email-hints-v12";

/**
 * Build a trusted main-button email hint from a sanitized event-like object.
 * Rejects untrusted assignment (missing advertiserId or explicit untrusted flag).
 */
export function buildMainButtonEmailHint(raw = {}) {
  const advertiserId = String(raw.advertiserId || raw.advertiserCid || "").trim();
  const trusted =
    raw.trusted === true &&
    Boolean(advertiserId) &&
    raw.untrustedAssignment !== true &&
    String(raw.matchMethod || "advertiser_cid") !== "name_similarity_only";

  const receivedAt = raw.receivedAt || raw.emailDate || null;
  const cjTermsUpdatedAt = raw.cjTermsUpdatedAt || null;
  let staleVsCjTerms = false;
  if (receivedAt && cjTermsUpdatedAt) {
    const a = Date.parse(String(receivedAt));
    const b = Date.parse(String(cjTermsUpdatedAt));
    if (Number.isFinite(a) && Number.isFinite(b) && a < b) staleVsCjTerms = true;
  }

  const assortmentPrimary = String(raw.assortmentPrimary || raw.primaryAssortment || "").trim();
  const assortmentSecondary = String(raw.assortmentSecondary || "").trim();
  const suggestedSectionId = raw.suggestedSectionId || null;

  // Restrictions: SEM / coupons are method-specific — do not flip ordinaryPromoBanned.
  const semBrandBidRestricted =
    raw.semBrandBidRestricted === true ||
    raw.semBrandBidBan === true ||
    /sem.*brand|brand.*bid|z[aá]kaz\s*sem/i.test(String(raw.restrictionText || ""));
  const couponPartnerRestricted =
    raw.couponPartnerRestricted === true ||
    /coupon\s*partner|kup[oó]nov/i.test(String(raw.restrictionText || ""));
  const ordinaryPromoBanned = raw.ordinaryPromoBanned === true;

  return {
    schema: PHASE3Z_MAIN_BUTTON_EMAIL_SCHEMA,
    advertiserId: advertiserId || null,
    trusted,
    matchMethod: raw.matchMethod || (advertiserId ? "advertiser_cid" : "none"),
    assortmentPrimary: assortmentPrimary || null,
    assortmentSecondary: assortmentSecondary || null,
    suggestedSectionId,
    semBrandBidRestricted,
    couponPartnerRestricted,
    ordinaryPromoBanned,
    staleVsCjTerms,
    receivedAt,
    cjTermsUpdatedAt,
    sourceMessageId: raw.sourceMessageId || raw.messageId || null,
    restrictionExcerpt: raw.restrictionExcerpt || null,
    note: trusted
      ? "Trusted email hint for main-button assortment/restrictions only."
      : "Untrusted or incomplete email assignment — ignored for section authority.",
  };
}

/** Deterministic fixtures for GANT.CZ and Čedok.cz (no live mailbox required). */
export const GANT_EMAIL_FIXTURE = Object.freeze({
  advertiserId: "4978487",
  advertiserCid: "4978487",
  trusted: true,
  matchMethod: "advertiser_cid",
  assortmentPrimary: "Pánská a dámská móda; obuv a módní doplňky",
  assortmentSecondary: "Doplňky",
  suggestedSectionId: "aff-moda",
  semBrandBidRestricted: true,
  couponPartnerRestricted: true,
  ordinaryPromoBanned: false,
  receivedAt: "2025-06-01T10:00:00Z",
  sourceMessageId: "fixture-gant-welcome-v12",
  restrictionText: "Zákaz SEM na značku. Omezení kupónových partnerů.",
  restrictionExcerpt: "Zákaz SEM na značku; omezení kupónových partnerů — běžná affiliate propagace povolena.",
});

export const CEDOK_EMAIL_FIXTURE = Object.freeze({
  advertiserId: "6179554",
  advertiserCid: "6179554",
  trusted: true,
  matchMethod: "advertiser_cid",
  assortmentPrimary: "Pobytové a poznávací zájezdy",
  assortmentSecondary: "Doplňkové cestovní služby (letenky, transfery, pojištění) — vedlejší",
  suggestedSectionId: "aff-cestovni-kancelare",
  semBrandBidRestricted: true,
  couponPartnerRestricted: false,
  ordinaryPromoBanned: false,
  receivedAt: "2025-05-15T09:00:00Z",
  sourceMessageId: "fixture-cedok-welcome-v12",
  restrictionText: "Zákaz SEM na značku.",
  restrictionExcerpt: "Zákaz SEM na značku — běžná affiliate tlačítka povolena; jedno hlavní tlačítko CK.",
});

export function buildDefaultMainButtonEmailHintMap() {
  const gant = buildMainButtonEmailHint(GANT_EMAIL_FIXTURE);
  const cedok = buildMainButtonEmailHint(CEDOK_EMAIL_FIXTURE);
  return new Map([
    [gant.advertiserId, gant],
    [cedok.advertiserId, cedok],
  ]);
}

/**
 * Prefer newer CJ terms over older welcome email when both speak to restrictions.
 */
export function mergeEmailHintWithCjTerms(hint, cjTerms = null) {
  if (!hint) return null;
  if (!cjTerms) return hint;
  const merged = { ...hint };
  if (cjTerms.updatedAt) merged.cjTermsUpdatedAt = cjTerms.updatedAt;
  const a = Date.parse(String(hint.receivedAt || ""));
  const b = Date.parse(String(cjTerms.updatedAt || ""));
  if (Number.isFinite(a) && Number.isFinite(b) && a < b) {
    merged.staleVsCjTerms = true;
    // Newer CJ terms win for ordinary promo ban / SEM flags when provided.
    if (typeof cjTerms.ordinaryPromoBanned === "boolean") {
      merged.ordinaryPromoBanned = cjTerms.ordinaryPromoBanned;
    }
    if (typeof cjTerms.semBrandBidRestricted === "boolean") {
      merged.semBrandBidRestricted = cjTerms.semBrandBidRestricted;
    }
  }
  return buildMainButtonEmailHint(merged);
}
