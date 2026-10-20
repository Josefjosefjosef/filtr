#!/usr/bin/env node
/** Pure banner inventory classification/grouping (offline regression). */
import { createHash } from "node:crypto";
import {
  classifyTimeWindow,
  creativeText,
  hasDiscountEvidence,
  stripHtmlLite,
} from "./iu-cj-affiliate-phase2-lib.mjs";

export function normalizeCreativeBase(linkName) {
  return String(linkName || "")
    .replace(/\b\d{2,4}\s*[x×]\s*\d{2,4}\b/gi, "{dim}")
    .replace(/\b(CZ|SK|EN|DE|FR|RO|PL|HU|IT|ES)\b/gi, "{lang}")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function hashCreativeText(text) {
  const n = stripHtmlLite(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return "_empty";
  return createHash("sha256").update(n).digest("hex").slice(0, 40);
}

/** Tracking-only query keys — excluded from grouping; do not treat as condition/target change. */
export const IGNORED_QUERY_PARAMS_FOR_STOREFRONT_GROUPING = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "msclkid",
  "dclid",
  "mc_eid",
]);

export function normalizeDestinationHost(url) {
  const u = new URL(String(url));
  return u.hostname.replace(/^www\./i, "").toLowerCase();
}

export function normalizeDestinationPathPreserveCase(url) {
  const u = new URL(String(url));
  let p = u.pathname;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

/** Structured query pairs: stable param order; value order preserved for repeats; case preserved. */
export function destinationQueryCanonicalPairs(url) {
  const u = new URL(String(url));
  const seen = new Set();
  const uniqueKeys = [];
  for (const key of u.searchParams.keys()) {
    if (IGNORED_QUERY_PARAMS_FOR_STOREFRONT_GROUPING.has(key.toLowerCase())) continue;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueKeys.push(key);
    }
  }
  uniqueKeys.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "case" }));
  const pairs = [];
  for (const key of uniqueKeys) {
    for (const val of u.searchParams.getAll(key)) {
      pairs.push({ k: key, v: val });
    }
  }
  return pairs;
}

/** Full internal canonical (not for shared JSON/HTML — use fingerprint helpers). */
export function destinationStorefrontCanonicalString(url) {
  try {
    const payload = {
      host: normalizeDestinationHost(url),
      path: normalizeDestinationPathPreserveCase(url),
      query: destinationQueryCanonicalPairs(url),
    };
    return JSON.stringify(payload);
  } catch {
    return "_invalid_destination";
  }
}

/** @deprecated alias — prefer canonicalString or groupingSegment */
export function destinationStorefrontKey(url) {
  return destinationStorefrontCanonicalString(url);
}

export function destinationQueryGroupingString(url) {
  return JSON.stringify(destinationQueryCanonicalPairs(url));
}

/** Hashed segment for strict/variant keys — no raw access tokens in shared overview. */
export function destinationStorefrontGroupingSegment(url) {
  const canon = destinationStorefrontCanonicalString(url);
  if (canon === "_invalid_destination") return canon;
  return createHash("sha256").update(canon).digest("hex").slice(0, 40);
}

/** Report-safe fingerprint (no raw tokens/PII in HTML/JSON previews). */
export function destinationStorefrontReportFingerprint(url) {
  const canon = destinationStorefrontCanonicalString(url);
  if (canon === "_invalid_destination") return canon;
  return createHash("sha256").update(canon).digest("hex").slice(0, 32);
}

export function detectDocumentedOpenEndKind(link) {
  const text = stripHtmlLite(creativeText(link)).toLowerCase();
  if (/do\s+odvol[aá]n[ií]|until\s+further\s+notice|until\s+cancel(l)?ed/i.test(text)) {
    return { partialEndKind: "documented_until_notice", evidenceSource: "creative_copy_in_link_search_fields" };
  }
  if (/do\s+vyprod[aá]n[ií]|while\s+stocks?\s+last|do\s+rozebr[aá]n[ií]|do\s+vyprod[aá]n[ií]\s+z[aá]sob/i.test(text)) {
    return { partialEndKind: "documented_until_stock", evidenceSource: "creative_copy_in_link_search_fields" };
  }
  return null;
}

function groupingKeyParts(link) {
  return {
    advertiserId: String(link.advertiserId || ""),
    storefront: destinationStorefrontGroupingSegment(link.destination),
    market: String(link.targetedCountries || "").toUpperCase() || "_no_tc",
    coupon: String(link.couponCode || "").trim().toUpperCase() || "_no_code",
    promoStart: String(link.promotionStartDate || "").trim() || "_no_start",
    promoEnd: String(link.promotionEndDate || "").trim() || "_no_end",
    descriptionHash: hashCreativeText(link.description || ""),
    adContentHash: hashCreativeText(link.adContent || ""),
  };
}

export function buildCreativeGroupingStrictKey(link) {
  const p = groupingKeyParts(link);
  return [
    p.advertiserId,
    p.storefront,
    p.market,
    p.coupon,
    p.promoStart,
    p.promoEnd,
    String(link.linkName || "").trim().toLowerCase() || "_no_name",
    p.descriptionHash,
    p.adContentHash,
  ].join("|");
}

export function buildCreativeVariantGroupingEstimateKey(link) {
  const p = groupingKeyParts(link);
  return [
    p.advertiserId,
    p.storefront,
    p.market,
    p.coupon,
    p.promoStart,
    p.promoEnd,
    normalizeCreativeBase(link.linkName),
    p.descriptionHash,
    p.adContentHash,
  ].join("|");
}

export function creativeCopyDocumented(link) {
  const desc = stripHtmlLite(link.description || "");
  const ad = stripHtmlLite(link.adContent || "");
  return desc.length + ad.length >= 8;
}

export function assessCreativeAvailability(link) {
  const joined = String(link.relationshipStatus || "").toLowerCase() === "joined";
  const click = Boolean(link.clickUrl);
  if (joined && click) {
    return {
      state: "tracking_row_technically_present",
      joined,
      clickTrackingPresent: click,
      note: "CJ Banner link row exists; not proof of image asset license or live promotion",
    };
  }
  return {
    state: "unknown_or_incomplete_row",
    joined,
    clickTrackingPresent: click,
    note: "Missing joined status or click URL in stored export",
  };
}

export function assessActionValidity(role, link, refDate) {
  if (role === "A_partner_general_banner") {
    return {
      state: "not_applicable",
      category: "general_partner_creative",
      note: "General logo/banner without promotion window; do not treat missing dates as sale activity or inactivity",
    };
  }
  const hasStart = Boolean(String(link.promotionStartDate || "").trim());
  const hasEnd = Boolean(String(link.promotionEndDate || "").trim());
  if (!hasStart && !hasEnd) {
    return {
      state: "unknown",
      category: "time_bound_action",
      reason: "promotion_dates_missing_in_stored_export",
      note: "Missing campaign dates do not prove the discount is active",
    };
  }
  const tw = classifyTimeWindow(link.promotionStartDate, link.promotionEndDate, refDate);
  if (tw === "expired") {
    return { state: "documented_inactive", category: "time_bound_action", reason: "promotion_end_before_reference" };
  }
  if (tw === "future") {
    return { state: "documented_not_yet_active", category: "time_bound_action", reason: "promotion_start_after_reference" };
  }
  if (tw === "time_active") {
    return { state: "documented_active_in_window", category: "time_bound_action", reason: "promotion_start_and_end_include_reference" };
  }
  if (tw === "time_open_end_missing") {
    const openEnd = detectDocumentedOpenEndKind(link);
    const partialEndKind = openEnd?.partialEndKind || "missing_end";
    return {
      state: "partially_documented_period",
      category: "time_bound_action",
      partialEndKind,
      currentValidityAtReference: "unverified",
      reason: "promotion_start_without_export_end_date",
      evidenceSource: openEnd?.evidenceSource || "export_promotion_end_empty",
      note:
        partialEndKind === "missing_end"
          ? "Start in export without end — partial period only; current activity at reference not verified"
          : "Creative copy signals open-ended wording — not closed-window active and not permanent activity",
    };
  }
  return {
    state: "unknown",
    category: "time_bound_action",
    reason: "promotion_window_partial_or_unparseable",
    note: "Partial dates or parse ambiguity — not documented inactive",
  };
}

export function classifyBannerRole(link) {
  const code = String(link.couponCode || "").trim();
  const name = String(link.linkName || "").toLowerCase();
  const creative = creativeText(link);
  const documentedCopy = creativeCopyDocumented(link);
  const hasDates = Boolean(String(link.promotionStartDate || "").trim() || String(link.promotionEndDate || "").trim());
  const discount = hasDiscountEvidence(creative);
  const dimensionOnlyName = /^\s*\d{2,4}\s*[x×]\s*\d{2,4}\s*$/i.test(String(link.linkName || "").trim());
  if (code && (documentedCopy || hasDates)) return "C_coupon_campaign_banner";
  if (/logo|logotyp|brand mark|obecn/i.test(name) && documentedCopy && !discount && !code && !hasDates) {
    return "A_partner_general_banner";
  }
  if (documentedCopy && (discount || hasDates) && !code) return "B_specific_discount_action_banner";
  if (dimensionOnlyName || (!documentedCopy && !code && !discount && !hasDates)) {
    return "U_unknown_unclassified_banner";
  }
  if (code && !documentedCopy && !hasDates) return "C_coupon_campaign_banner";
  return "U_unknown_unclassified_banner";
}
