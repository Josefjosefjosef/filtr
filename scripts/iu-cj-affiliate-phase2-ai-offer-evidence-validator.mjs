/** Ground AI offer fields in source email text — no hallucinated coupons/discounts/dates. */

const AFFILIATE_URL_RE = /https?:\/\/[^\s<>"']+/gi;

function normalizeForMatch(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sourceContainsSpan(sourceText, span) {
  const src = normalizeForMatch(sourceText);
  const needle = normalizeForMatch(span);
  if (!needle) return false;
  if (src.includes(needle)) return true;
  const compactSrc = src.replace(/\s/g, "");
  const compactNeedle = needle.replace(/\s/g, "");
  return compactNeedle.length >= 3 && compactSrc.includes(compactNeedle);
}

function percentInSource(sourceText, pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return false;
  const n = Number(pct);
  if (n <= 0 || n > 100) return false;
  const src = String(sourceText || "");
  const patterns = [
    new RegExp("\\b" + n + "\\s*%"),
    new RegExp("\\b" + n + "\\s*percent", "i"),
    new RegExp("\\b" + n + "\\s*%\\s*off", "i"),
    new RegExp("sleva\\s*" + n, "i"),
  ];
  return patterns.some((re) => re.test(src));
}

function couponInSource(sourceText, code) {
  if (!code) return true;
  const c = String(code).trim();
  if (!c) return true;
  return new RegExp("\\b" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(String(sourceText || ""));
}

function urlInSource(sourceText, url) {
  if (!url) return true;
  return sourceContainsSpan(sourceText, url);
}

function dateLikeInSource(sourceText, value) {
  if (!value) return true;
  return sourceContainsSpan(sourceText, value);
}

const INJECTION_MARKERS = [
  /ignore\s+previous\s+instructions/i,
  /auto\s*allow/i,
  /grant\s+publication/i,
  /publish\s+all\s+offers/i,
];

/**
 * @param {object} value AI JSON payload
 * @param {string} sourceText Original email body (plain), never trust AI alone
 */
export function validateAiOfferJson(value, sourceText = "") {
  if (!value || typeof value !== "object") return { ok: false, reason: "not_object" };
  if (!Array.isArray(value.offers)) return { ok: false, reason: "missing_offers_array" };
  const src = String(sourceText || "");
  if (!src.trim()) return { ok: false, reason: "missing_source_text_for_grounding" };

  for (const marker of INJECTION_MARKERS) {
    if (marker.test(src) && value.offers.some((o) => /allow|publish|grant/i.test(String(o?.evidenceSpan || "")))) {
      return { ok: false, reason: "prompt_injection_evidence_rejected" };
    }
  }

  for (const o of value.offers) {
    if (!o || typeof o !== "object") return { ok: false, reason: "invalid_offer_object" };
    if (typeof o.evidenceSpan !== "string" || !o.evidenceSpan.trim()) {
      return { ok: false, reason: "missing_evidence_span" };
    }
    if (!["low", "medium", "high"].includes(o.confidence)) {
      return { ok: false, reason: "invalid_confidence" };
    }
    if (!sourceContainsSpan(src, o.evidenceSpan)) {
      return { ok: false, reason: "evidence_span_not_in_source:" + o.evidenceSpan.slice(0, 40) };
    }
    if (o.couponCode != null && o.couponCode !== "" && !couponInSource(src, o.couponCode)) {
      return { ok: false, reason: "coupon_not_in_source:" + String(o.couponCode).slice(0, 32) };
    }
    if (o.discountPercent != null && !percentInSource(src, o.discountPercent)) {
      return { ok: false, reason: "discount_not_in_source:" + String(o.discountPercent) };
    }
    if (o.discountAmount != null && !sourceContainsSpan(src, String(o.discountAmount))) {
      return { ok: false, reason: "discount_amount_not_in_source" };
    }
    if (o.validFrom != null && !dateLikeInSource(src, o.validFrom)) {
      return { ok: false, reason: "valid_from_not_in_source" };
    }
    if (o.validTo != null && !dateLikeInSource(src, o.validTo)) {
      return { ok: false, reason: "valid_to_not_in_source" };
    }
    if (o.currency != null && !sourceContainsSpan(src, String(o.currency))) {
      return { ok: false, reason: "currency_not_in_source" };
    }
    if (o.advertiserCid != null && !sourceContainsSpan(src, String(o.advertiserCid))) {
      return { ok: false, reason: "advertiser_cid_not_in_source" };
    }
    if (o.affiliateUrl != null && !urlInSource(src, o.affiliateUrl)) {
      return { ok: false, reason: "affiliate_url_not_in_source" };
    }
    if (o.contractGrant === true || o.publicationAllowed === true) {
      return { ok: false, reason: "ai_cannot_grant_publication" };
    }
  }
  return { ok: true, reason: null };
}

/** Adversarial fixtures for selftests. */
export function buildHallucinatedAiPayload(kind) {
  switch (kind) {
    case "fake_coupon":
      return { offers: [{ evidenceSpan: "FAKE999", couponCode: "FAKE999", confidence: "high" }] };
    case "fake_discount":
      return { offers: [{ evidenceSpan: "999% sleva", discountPercent: 999, confidence: "high" }] };
    case "fake_date":
      return { offers: [{ evidenceSpan: "2030-01-01", validTo: "2030-01-01", confidence: "high" }] };
    case "fake_advertiser":
      return { offers: [{ evidenceSpan: "CID 99999999", advertiserCid: "99999999", confidence: "high" }] };
    case "fake_currency":
      return { offers: [{ evidenceSpan: "USD only", currency: "USD", confidence: "high" }] };
    case "fake_url":
      return {
        offers: [{ evidenceSpan: "click here", affiliateUrl: "https://evil.example/track", confidence: "high" }],
      };
    case "fake_grant":
      return { offers: [{ evidenceSpan: "approved", publicationAllowed: true, confidence: "high" }] };
    default:
      return { offers: [{ evidenceSpan: "X", confidence: "high" }] };
  }
}

export function extractAffiliateUrlsFromSource(sourceText) {
  return [...String(sourceText || "").matchAll(AFFILIATE_URL_RE)].map((m) => m[0]);
}
