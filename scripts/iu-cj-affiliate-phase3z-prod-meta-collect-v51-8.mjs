/**
 * V51.8 — complete production offers-public meta collector.
 * Never treats HTTP 200 alone as correctness; requires UTF-8 JSON parse + stats.
 */
import fs from "node:fs";
import path from "node:path";

export const PROD_META_SCHEMA = "iu-cj-affiliate-phase3z-prod-meta-v51-8";

export function collectProdMetaFromOffersJson(doc, opts = {}) {
  if (!doc || typeof doc !== "object") {
    return {
      schema: PROD_META_SCHEMA,
      ok: false,
      reason: "MISSING_OR_INVALID_DOC",
      at: new Date().toISOString(),
    };
  }
  const gb = doc.publicGrowthBudget || {};
  const stats = doc.stats || {};
  const display = stats.freshness?.displayClass || {};
  return {
    schema: PROD_META_SCHEMA,
    ok: true,
    at: opts.at || new Date().toISOString(),
    sourceUrl: opts.sourceUrl || null,
    bytes: opts.bytes ?? null,
    headHex: opts.headHex || null,
    utf8ObjectStart: opts.utf8ObjectStart === true,
    snapshotId: doc.snapshotId ?? null,
    updatedAt: doc.updatedAt ?? null,
    liveEnabled: doc.liveEnabled === true,
    LIVE: gb.publicEligibleAfter ?? stats.uniquePublicEligible ?? null,
    DEFERRED_NEW: gb.deferredNew ?? null,
    growthCum: gb.cumulativeAddedSinceBaseline ?? null,
    growthRem: gb.cumulativeRemaining ?? null,
    ownerGate: gb.exceptionalGrowthRequiresOwner === true,
    baseline: gb.baselinePublicEligible ?? null,
    coupons: stats.coupons ?? null,
    actions: stats.actions ?? null,
    partners: stats.partners ?? null,
    products: stats.products ?? null,
    lkgHold: stats.lkgPublicHoldProducts ?? null,
    lkgCarried: stats.lkgCarriedProducts ?? null,
    uniquePublic: stats.uniquePublicEligible ?? null,
    displayCURRENT: display.CURRENT ?? null,
    displaySTALE: display.STALE ?? null,
    displayUNKNOWN: display.UNKNOWN ?? null,
    displayUNAVAILABLE: display.UNAVAILABLE ?? null,
  };
}

export function assertCompleteProdMeta(meta) {
  const required = [
    "snapshotId",
    "updatedAt",
    "LIVE",
    "coupons",
    "actions",
    "partners",
    "growthCum",
    "ownerGate",
  ];
  const missing = required.filter((k) => meta?.[k] == null);
  return {
    ok: meta?.ok === true && missing.length === 0 && meta.utf8ObjectStart !== false,
    missing,
  };
}

export function writeProdMetaFile(outPath, meta) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
  return assertCompleteProdMeta(meta);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("iu-cj-affiliate-phase3z-prod-meta-collect-v51-8.mjs")) {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error("Usage: node iu-cj-affiliate-phase3z-prod-meta-collect-v51-8.mjs <offers.json> <out-meta.json>");
    process.exit(2);
  }
  const buf = fs.readFileSync(inPath);
  const headHex = Buffer.from(buf.subarray(0, 4)).toString("hex");
  const utf8ObjectStart = buf[0] === 0x7b;
  if (!utf8ObjectStart) {
    const meta = {
      schema: PROD_META_SCHEMA,
      ok: false,
      reason: "NOT_UTF8_JSON_OBJECT",
      bytes: buf.length,
      headHex,
      utf8ObjectStart: false,
      at: new Date().toISOString(),
    };
    writeProdMetaFile(outPath, meta);
    console.log(JSON.stringify({ ok: false, reason: meta.reason, outPath }));
    process.exit(1);
  }
  const doc = JSON.parse(buf.toString("utf8"));
  const meta = collectProdMetaFromOffersJson(doc, {
    sourceUrl: process.env.IU_CJ_PROD_OFFERS_URL || null,
    bytes: buf.length,
    headHex,
    utf8ObjectStart: true,
  });
  const check = writeProdMetaFile(outPath, meta);
  console.log(JSON.stringify({ ok: check.ok, missing: check.missing, outPath, LIVE: meta.LIVE }));
  process.exit(check.ok ? 0 : 1);
}
