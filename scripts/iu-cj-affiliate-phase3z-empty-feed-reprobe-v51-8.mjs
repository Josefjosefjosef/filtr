#!/usr/bin/env node
/**
 * V51.8 — individual re-verify of CJ_FEED_API_EMPTY partners (1-page probe).
 * External empty remains classified; never renamed to PASS without evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { fetchAllShoppingProductsForPartner } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const EMPTY_FEED_REPROBE_SCHEMA = "iu-cj-affiliate-phase3z-empty-feed-reprobe-v51-8";

export const REPROBE_STATUS = Object.freeze({
  STILL_EMPTY: "STILL_EMPTY",
  NOW_NONEMPTY: "NOW_NONEMPTY",
  TECHNICAL_FAILURE: "TECHNICAL_FAILURE",
  SKIPPED_NO_CREDENTIALS: "SKIPPED_NO_CREDENTIALS",
  SKIPPED_NO_TARGETS: "SKIPPED_NO_TARGETS",
});

/**
 * @param {Array<{advertiserId:string,partnerName?:string,declaredProductCount?:number}>} partners
 */
export async function reprobeEmptyFeedPartners(opts = {}) {
  const partners = Array.isArray(opts.partners) ? opts.partners : [];
  const gqlEnv = opts.gqlEnv || null;
  const nowIso = opts.nowIso || new Date().toISOString();
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 25));
  const byStatus = {};
  for (const s of Object.values(REPROBE_STATUS)) byStatus[s] = 0;
  const rows = [];

  if (!partners.length) {
    return {
      schema: EMPTY_FEED_REPROBE_SCHEMA,
      at: nowIso,
      targetCount: 0,
      byStatus: { ...byStatus, [REPROBE_STATUS.SKIPPED_NO_TARGETS]: 1 },
      partners: [],
      note: "No CJ_FEED_API_EMPTY partners supplied",
    };
  }
  if (!gqlEnv?.pat || !gqlEnv?.publisherCid) {
    for (const p of partners) {
      byStatus[REPROBE_STATUS.SKIPPED_NO_CREDENTIALS] += 1;
      rows.push({
        advertiserId: String(p.advertiserId),
        partnerName: p.partnerName || null,
        declaredProductCount: p.declaredProductCount ?? null,
        status: REPROBE_STATUS.SKIPPED_NO_CREDENTIALS,
        fetchedCount: null,
        totalCount: null,
        error: null,
      });
    }
    return {
      schema: EMPTY_FEED_REPROBE_SCHEMA,
      at: nowIso,
      targetCount: partners.length,
      byStatus,
      partners: rows,
      credentialsPresent: false,
      note: "PAT/publisherCid missing — reprobe deferred",
    };
  }

  for (const p of partners) {
    const advertiserId = String(p.advertiserId || "").trim();
    if (!advertiserId) continue;
    try {
      const fetched = await fetchAllShoppingProductsForPartner(gqlEnv, advertiserId, {
        pageSize,
        maxPages: 1,
        stopAfterCount: pageSize,
      });
      const count = Number(fetched.fetchedCount || (fetched.resultList || []).length || 0);
      const total = fetched.totalCount != null ? Number(fetched.totalCount) : null;
      const nonempty = count > 0 || (Number.isFinite(total) && total > 0);
      const status = nonempty ? REPROBE_STATUS.NOW_NONEMPTY : REPROBE_STATUS.STILL_EMPTY;
      byStatus[status] += 1;
      rows.push({
        advertiserId,
        partnerName: p.partnerName || null,
        declaredProductCount: p.declaredProductCount ?? null,
        status,
        fetchedCount: count,
        totalCount: total,
        complete: fetched.complete === true,
        error: fetched.error || null,
        priorClassification: "CJ_FEED_API_EMPTY",
      });
    } catch (e) {
      byStatus[REPROBE_STATUS.TECHNICAL_FAILURE] += 1;
      rows.push({
        advertiserId,
        partnerName: p.partnerName || null,
        declaredProductCount: p.declaredProductCount ?? null,
        status: REPROBE_STATUS.TECHNICAL_FAILURE,
        fetchedCount: null,
        totalCount: null,
        error: String(e && e.message ? e.message : e).slice(0, 300),
      });
    }
  }

  return {
    schema: EMPTY_FEED_REPROBE_SCHEMA,
    at: nowIso,
    targetCount: rows.length,
    byStatus,
    partners: rows,
    credentialsPresent: true,
    note:
      "Individual 1-page reprobe. STILL_EMPTY is external/source evidence, not renamed PASS.",
  };
}

/**
 * Extract empty-API partners from a feed-completeness doc.
 */
export function emptyPartnersFromFeedCompleteness(doc) {
  const partners = Array.isArray(doc?.partners) ? doc.partners : [];
  return partners
    .filter((p) => (p.gapReasons || []).includes("CJ_FEED_API_EMPTY"))
    .map((p) => ({
      advertiserId: String(p.advertiserId),
      partnerName: p.partnerName || null,
      declaredProductCount: p.declaredProductCount ?? null,
      continuation: p.continuation || null,
    }));
}

async function main() {
  const outPath =
    process.env.IU_CJ_EMPTY_FEED_REPROBE_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-empty-feed-reprobe-v51-8.json");
  const completenessPath = process.env.IU_CJ_FEED_COMPLETENESS_PATH || "";
  let partners = [];
  if (completenessPath && fs.existsSync(completenessPath)) {
    const doc = JSON.parse(fs.readFileSync(completenessPath, "utf8"));
    partners = emptyPartnersFromFeedCompleteness(doc);
  } else {
    const raw = String(process.env.IU_CJ_EMPTY_API_ADVERTISER_IDS || "").trim();
    partners = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((advertiserId) => ({ advertiserId }));
  }
  const dry =
    process.env.IU_CJ_EMPTY_FEED_REPROBE_DRY === "1" ||
    !(process.env.IU_CJ_PAT || process.env.CJ_API_PAT || process.env.CJ_PERSONAL_ACCESS_TOKEN);
  const gqlEnv = dry
    ? null
    : {
        pat: process.env.IU_CJ_PAT || process.env.CJ_API_PAT || process.env.CJ_PERSONAL_ACCESS_TOKEN || "",
        publisherCid: String(process.env.IU_CJ_PUBLISHER_CID || "").trim(),
        websitePid: String(process.env.IU_CJ_WEBSITE_PID || "101883843"),
      };
  const ledger = await reprobeEmptyFeedPartners({
    partners,
    gqlEnv: gqlEnv?.pat ? gqlEnv : null,
  });
  fs.writeFileSync(outPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ok: true, outPath, ...ledger, partners: undefined, partnerSample: ledger.partners.slice(0, 12) }, null, 2));
}

const isDirect =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("iu-cj-affiliate-phase3z-empty-feed-reprobe-v51-8.mjs");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
