#!/usr/bin/env node
/**
 * Individual LKG carry/hold root-cause audit against live offers-public (read-only).
 * Does not mutate production. Classifies why products are LKG-carried or on public hold.
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_URL = "https://infouzel.cz/projects/data/iu-affiliate-cj-offers-public-v1.json";

function productKey(p) {
  const a = String(p?.advertiserId || p?.advertiserID || "").trim();
  const id = String(p?.productId || p?.id || "").trim();
  return a && id ? `${a}|${id}` : null;
}

export function classifyLkgProduct(p, nowMs = Date.now()) {
  const reasons = [];
  if (p?.lkgCarried === true) reasons.push("LKG_CARRIED_FLAG");
  if (p?.lkgPublicHold === true || p?.publicationHold === true) reasons.push("LKG_PUBLIC_HOLD_FLAG");
  if (p?.freshnessStatus === "FETCH_RECENT_SOURCE_AGE_UNKNOWN") reasons.push("SOURCE_TIMESTAMP_UNAVAILABLE");
  if (p?.freshnessStatus === "SOURCE_FRESH") reasons.push("SOURCE_FRESH");
  if (p?.sourceUpdatedAtStatus === "NOT_PROVIDED" || p?.sourceUpdatedAtStatus === "UNKNOWN") {
    reasons.push("SOURCE_TIMESTAMP_UNAVAILABLE");
  }
  if (!p?.sourceUpdatedAt) reasons.push("NO_SOURCE_UPDATED_AT");
  if (p?.lastVerifiedAt || p?.lastFetchAt || p?.checkedAt) reasons.push("HAS_LAST_VERIFIED_CLOCK");
  const verifiedMs = Date.parse(p?.lastVerifiedAt || p?.lastFetchAt || p?.checkedAt || "");
  if (Number.isFinite(verifiedMs)) {
    const ageH = (nowMs - verifiedMs) / 3600000;
    if (ageH > 72) reasons.push("VERIFIED_STALE_OVER_72H");
    else if (ageH > 24) reasons.push("VERIFIED_AGE_24_72H");
    else reasons.push("VERIFIED_WITHIN_24H");
  } else {
    reasons.push("NO_VERIFIED_CLOCK");
  }
  if (p?.availability === false || p?.inStock === false) reasons.push("UNAVAILABLE_FLAG");
  if (p?.publicationReady === false) reasons.push("NOT_PUBLICATION_READY");
  const primary =
    reasons.find((r) => r === "LKG_PUBLIC_HOLD_FLAG") ||
    reasons.find((r) => r === "VERIFIED_STALE_OVER_72H") ||
    reasons.find((r) => r === "SOURCE_TIMESTAMP_UNAVAILABLE") ||
    reasons.find((r) => r === "NO_VERIFIED_CLOCK") ||
    reasons[0] ||
    "UNKNOWN";
  return { key: productKey(p), primary, reasons, advertiserId: p?.advertiserId || null };
}

export function auditLkgFromOffersDoc(doc, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const carried = [];
  const hold = [];
  const byPrimary = {};
  const byAdvertiser = {};
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      const isCarry = p?.lkgCarried === true;
      const isHold = p?.lkgPublicHold === true || p?.publicationHold === true || p?.lkgHold === true;
      if (!isCarry && !isHold) continue;
      const c = classifyLkgProduct(p, nowMs);
      c.sectionKey = sec.sectionKey || null;
      byPrimary[c.primary] = (byPrimary[c.primary] || 0) + 1;
      const adv = String(c.advertiserId || "unknown");
      byAdvertiser[adv] = (byAdvertiser[adv] || 0) + 1;
      if (isHold) hold.push(c);
      else if (isCarry) carried.push(c);
    }
  }
  return {
    schema: "iu-cj-affiliate-phase3z-lkg-rootcause-audit-v51-8",
    at: new Date(nowMs).toISOString(),
    source: opts.source || null,
    stats: doc?.stats || null,
    carriedCount: carried.length,
    holdCount: hold.length,
    byPrimary,
    topAdvertisers: Object.entries(byAdvertiser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([advertiserId, count]) => ({ advertiserId, count })),
    sampleCarried: carried.slice(0, 40),
    sampleHold: hold.slice(0, 40),
    note:
      "LKG is safety carry-forward, not proof of freshness. SOURCE_TIMESTAMP_UNAVAILABLE ≠ stale; use lastVerified clocks for verification currency.",
  };
}

async function main() {
  const url = process.env.IU_CJ_OFFERS_PUBLIC_URL || DEFAULT_URL;
  const outPath =
    process.env.IU_CJ_LKG_AUDIT_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-lkg-rootcause-audit.json");
  const res = await fetch(url);
  const doc = await res.json();
  const audit = auditLkgFromOffersDoc(doc, { source: url });
  fs.writeFileSync(outPath, JSON.stringify(audit, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        carriedCount: audit.carriedCount,
        holdCount: audit.holdCount,
        byPrimary: audit.byPrimary,
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
