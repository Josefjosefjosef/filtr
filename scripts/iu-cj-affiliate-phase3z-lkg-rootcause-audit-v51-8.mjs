#!/usr/bin/env node
/**
 * Full individual LKG carry/hold audit against live offers-public (read-only).
 * Emits complete machine-readable inventories (not samples-only).
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_URL = "https://infouzel.cz/projects/data/iu-affiliate-cj-offers-public-v1.json";

export const LKG_CAUSE = {
  FEED_UNAVAILABLE: "FEED_UNAVAILABLE",
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  MISSING_REFRESH: "MISSING_REFRESH",
  VALIDATION_INCOMPLETE: "VALIDATION_INCOMPLETE",
  IDENTITY_COLLISION: "IDENTITY_COLLISION",
  INVALID_AFFILIATE_URL: "INVALID_AFFILIATE_URL",
  STALE_PRICE: "STALE_PRICE",
  STALE_AVAILABILITY: "STALE_AVAILABILITY",
  PARTNERSHIP_ENDED: "PARTNERSHIP_ENDED",
  INGESTION_TECHNICAL: "INGESTION_TECHNICAL",
  PROTECTIVE_HOLD: "PROTECTIVE_HOLD",
  SOURCE_TIMESTAMP_UNAVAILABLE_CARRY: "SOURCE_TIMESTAMP_UNAVAILABLE_CARRY",
  OTHER: "OTHER",
};

function productKey(p) {
  const a = String(p?.advertiserId || p?.advertiserID || "").trim();
  const id = String(p?.productId || p?.id || "").trim();
  if (!a || !id) return null;
  const variant = String(p?.productVariant || "").trim();
  return variant ? a + "|" + id + "|" + variant : a + "|" + id;
}

function ageHours(iso, nowMs) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return null;
  return Number(((nowMs - ms) / 3600000).toFixed(3));
}

function hasAffiliateUrl(p) {
  const u = String(p?.affiliateUrl || p?.linkUrl || p?.clickUrl || "").trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Classify a single LKG carry/hold product with full evidence fields.
 */
export function classifyLkgProductFull(p, sec, nowMs = Date.now()) {
  const verifiedIso =
    p?.lastVerifiedAt || p?.lastSuccessfulRefreshAt || p?.lastCheckedAt || p?.fetchedAt || null;
  const priceIso = p?.priceVerifiedAt || verifiedIso;
  const availIso = p?.availabilityVerifiedAt || verifiedIso;
  const reasons = [];
  const isHold = p?.lkgPublicHold === true || p?.publicationHold === true || p?.lkgHold === true;
  const isCarry = p?.lkgCarried === true;

  if (isCarry) reasons.push("LKG_CARRIED_FLAG");
  if (isHold) reasons.push("LKG_PUBLIC_HOLD_FLAG");
  if (!p?.sourceUpdatedAt) reasons.push("SOURCE_TIMESTAMP_UNAVAILABLE");
  if (p?.sourceUpdatedAtStatus === "NOT_PROVIDED" || p?.sourceUpdatedAtStatus === "UNKNOWN") {
    reasons.push("SOURCE_TIMESTAMP_UNAVAILABLE");
  }
  if (Number.isFinite(ageHours(verifiedIso, nowMs))) {
    const ah = ageHours(verifiedIso, nowMs);
    if (ah > 72) reasons.push("VERIFIED_STALE_OVER_72H");
    else if (ah > 24) reasons.push("VERIFIED_AGE_24_72H");
    else reasons.push("VERIFIED_WITHIN_24H");
  } else {
    reasons.push("NO_VERIFIED_CLOCK");
  }
  if (p?.availability === false || p?.inStock === false || p?.availabilityClass === "OUT_OF_STOCK") {
    reasons.push("UNAVAILABLE_FLAG");
  }
  if (p?.publicationReady === false) reasons.push("NOT_PUBLICATION_READY");
  if (!hasAffiliateUrl(p)) reasons.push("INVALID_OR_MISSING_AFFILIATE_URL");
  if (/COLLISION/i.test(String(p?.publicationClass || p?.refreshReason || ""))) {
    reasons.push("IDENTITY_COLLISION");
  }
  if (/ENDED|TERMINATED/i.test(String(p?.partnerStatus || p?.advertiserStatus || ""))) {
    reasons.push("PARTNERSHIP_ENDED");
  }
  if (/NOT_YET_SEEN_MAX_AGE|GRADUAL_HOLD|INCOMPLETE/i.test(String(p?.freshnessReason || p?.refreshReason || ""))) {
    reasons.push("CHRONIC_INCOMPLETE_HOLD");
  }
  if (/SOURCE_STALE|STALE_PRICE/i.test(String(p?.publicationClass || p?.freshnessReason || ""))) {
    reasons.push("STALE_PRICE_CLASS");
  }

  let causeCode = LKG_CAUSE.OTHER;
  if (reasons.includes("PARTNERSHIP_ENDED")) causeCode = LKG_CAUSE.PARTNERSHIP_ENDED;
  else if (reasons.includes("IDENTITY_COLLISION")) causeCode = LKG_CAUSE.IDENTITY_COLLISION;
  else if (reasons.includes("INVALID_OR_MISSING_AFFILIATE_URL")) causeCode = LKG_CAUSE.INVALID_AFFILIATE_URL;
  else if (reasons.includes("UNAVAILABLE_FLAG")) causeCode = LKG_CAUSE.PRODUCT_UNAVAILABLE;
  else if (reasons.includes("CHRONIC_INCOMPLETE_HOLD")) causeCode = LKG_CAUSE.PROTECTIVE_HOLD;
  else if (reasons.includes("STALE_PRICE_CLASS")) causeCode = LKG_CAUSE.STALE_PRICE;
  else if (reasons.includes("NO_VERIFIED_CLOCK")) causeCode = LKG_CAUSE.MISSING_REFRESH;
  else if (reasons.includes("VERIFIED_STALE_OVER_72H")) causeCode = LKG_CAUSE.MISSING_REFRESH;
  else if (isHold && reasons.includes("NOT_PUBLICATION_READY")) causeCode = LKG_CAUSE.PROTECTIVE_HOLD;
  else if (isCarry && reasons.includes("SOURCE_TIMESTAMP_UNAVAILABLE")) {
    causeCode = LKG_CAUSE.SOURCE_TIMESTAMP_UNAVAILABLE_CARRY;
  } else if (isHold) causeCode = LKG_CAUSE.PROTECTIVE_HOLD;
  else if (isCarry) causeCode = LKG_CAUSE.MISSING_REFRESH;

  // SOURCE_TIMESTAMP_UNAVAILABLE is truthful CJ limitation (not inventable) — not a removable defect.
  const removableTechnical =
    causeCode === LKG_CAUSE.MISSING_REFRESH ||
    causeCode === LKG_CAUSE.INGESTION_TECHNICAL ||
    causeCode === LKG_CAUSE.INVALID_AFFILIATE_URL ||
    causeCode === LKG_CAUSE.IDENTITY_COLLISION;

  return {
    key: productKey(p),
    advertiserId: String(p?.advertiserId || p?.advertiserID || "").trim() || null,
    productId: String(p?.productId || p?.id || "").trim() || null,
    productVariant: String(p?.productVariant || "").trim() || null,
    currency: p?.currency || null,
    feedId: p?.feedId || p?.catalogId || p?.linkId || null,
    title: p?.title || p?.name || null,
    sectionKey: sec?.sectionKey || null,
    partnerName: sec?.partnerName || p?.partnerName || null,
    lastSuccessfulFetchAt: p?.lastSuccessfulRefreshAt || p?.fetchedAt || null,
    lastVerifiedAt: verifiedIso,
    priceVerifiedAt: priceIso,
    availabilityVerifiedAt: availIso,
    lastAffiliateUrl: p?.affiliateUrl || p?.linkUrl || p?.clickUrl || null,
    affiliateUrlValid: hasAffiliateUrl(p),
    lkgReason: p?.refreshReason || p?.freshnessReason || (isCarry ? "lkg_carried" : null),
    holdReason:
      p?.availabilityHoldReason ||
      p?.freshnessReason ||
      p?.refreshReason ||
      (isHold ? "publication_hold" : null),
    sourceAvailable: p?.sourceUnavailable === true ? false : null,
    partnershipStatus: p?.partnerStatus || p?.advertiserStatus || null,
    dataAgeHours: ageHours(verifiedIso, nowMs),
    publicationEligible:
      p?.publicationReady !== false &&
      p?.publicationEligibility !== "PUBLICATION_BLOCKED" &&
      !isHold,
    nextCheckAt: p?.nextCheckAt || null,
    lastRestoreAttempt: p?.lastRefreshAttemptAt || p?.refreshResult || null,
    refreshResult: p?.refreshResult || null,
    freshnessStatus: p?.freshnessStatus || null,
    publicationClass: p?.publicationClass || null,
    availability: p?.availability ?? p?.availabilityClass ?? null,
    currentPrice: p?.currentPrice ?? p?.price ?? null,
    currency: p?.currency || null,
    isLkgCarried: isCarry,
    isPublicHold: isHold,
    causeCode,
    reasons: [...new Set(reasons)],
    removableTechnical,
    keepHoldRecommended: isHold && !removableTechnical,
  };
}

export function auditLkgFromOffersDoc(doc, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const carried = [];
  const hold = [];
  const byPrimary = {};
  const byCause = {};
  const byAdvertiser = {};
  const byHoldCause = {};
  const seenKeys = new Set();

  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      const isCarry = p?.lkgCarried === true;
      const isHold = p?.lkgPublicHold === true || p?.publicationHold === true || p?.lkgHold === true;
      if (!isCarry && !isHold) continue;
      const c = classifyLkgProductFull(p, sec, nowMs);
      if (!c.key || seenKeys.has(c.key + (isHold ? "|H" : "|C"))) {
        // Deduplicate compound identity across sections for inventory uniqueness,
        // but still count section placement once per key+role.
      }
      const dedupeKey = c.key + (isHold ? "|H" : "|C");
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      byPrimary[c.causeCode] = (byPrimary[c.causeCode] || 0) + 1;
      byCause[c.causeCode] = (byCause[c.causeCode] || 0) + 1;
      const adv = String(c.advertiserId || "unknown");
      byAdvertiser[adv] = (byAdvertiser[adv] || 0) + 1;
      if (isHold) {
        hold.push(c);
        byHoldCause[c.causeCode] = (byHoldCause[c.causeCode] || 0) + 1;
      } else if (isCarry) {
        carried.push(c);
      }
    }
  }

  const removable = [...carried, ...hold].filter((x) => x.removableTechnical);
  return {
    schema: "iu-cj-affiliate-phase3z-lkg-full-individual-audit-v51-8",
    at: new Date(nowMs).toISOString(),
    source: opts.source || null,
    stats: doc?.stats || null,
    carriedCount: carried.length,
    holdCount: hold.length,
    byPrimary,
    byCause,
    byHoldCause,
    topAdvertisers: Object.entries(byAdvertiser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([advertiserId, count]) => ({ advertiserId, count })),
    removableTechnicalCount: removable.length,
    // Full inventories (required — not samples).
    carried: carried,
    hold: hold,
    sampleCarried: carried.slice(0, 40),
    sampleHold: hold.slice(0, 40),
    note:
      "Full individual inventory. SOURCE_TIMESTAMP_UNAVAILABLE ≠ stale. Protective holds for chronic incomplete / unavailable are intentional safety, not cosmetic targets.",
  };
}

async function main() {
  const url = process.env.IU_CJ_OFFERS_PUBLIC_URL || DEFAULT_URL;
  const outPath =
    process.env.IU_CJ_LKG_AUDIT_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-lkg-full-individual-audit.json");
  const holdOut =
    process.env.IU_CJ_HOLD_AUDIT_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-public-hold-full-audit.json");
  const res = await fetch(url);
  const doc = await res.json();
  const audit = auditLkgFromOffersDoc(doc, { source: url });
  fs.writeFileSync(outPath, JSON.stringify(audit, null, 2) + "\n", "utf8");
  const holdAudit = {
    schema: "iu-cj-affiliate-phase3z-public-hold-full-audit-v51-8",
    at: audit.at,
    source: audit.source,
    holdCount: audit.holdCount,
    byHoldCause: audit.byHoldCause,
    items: audit.hold,
    summary: Object.entries(audit.byHoldCause || {}).map(([cause, count]) => ({
      cause,
      count,
      justified:
        cause === LKG_CAUSE.PROTECTIVE_HOLD ||
        cause === LKG_CAUSE.PRODUCT_UNAVAILABLE ||
        cause === LKG_CAUSE.PARTNERSHIP_ENDED ||
        cause === LKG_CAUSE.IDENTITY_COLLISION ||
        cause === LKG_CAUSE.INVALID_AFFILIATE_URL,
      restorableViaRefresh: cause === LKG_CAUSE.MISSING_REFRESH || cause === LKG_CAUSE.SOURCE_TIMESTAMP_UNAVAILABLE_CARRY,
    })),
  };
  fs.writeFileSync(holdOut, JSON.stringify(holdAudit, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        holdOut,
        carriedCount: audit.carriedCount,
        holdCount: audit.holdCount,
        byCause: audit.byCause,
        byHoldCause: audit.byHoldCause,
        removableTechnicalCount: audit.removableTechnicalCount,
        uniqueProducts: doc?.stats?.uniqueProducts,
        lkgCarriedProducts: doc?.stats?.lkgCarriedProducts,
        lkgPublicHoldProducts: doc?.stats?.lkgPublicHoldProducts,
      },
      null,
      2,
    ),
  );
}

const isDirect =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("iu-cj-affiliate-phase3z-lkg-rootcause-audit-v51-8.mjs");
if (isDirect) {
  main().catch((e) => {
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  });
}
