#!/usr/bin/env node
/**
 * Selftest: pages lean + section shards + client fetch preference contract.
 * Does not unlock growth gate. Does not publish synthetic fixtures.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPagesLeanDoc,
  buildSectionShardDoc,
  estimateLoadPath,
  writePagesShards,
  PAGES_LEAN_SCHEMA,
  SECTION_SHARD_SCHEMA,
  PAGES_LEAN_FILENAME,
  SECTIONS_DIRNAME,
} from "./iu-cj-affiliate-offers-pages-shards-v1.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const offersJs = fs.readFileSync(path.join(repoRoot, "assets", "iu-affiliate-phase2-offers-v1.js"), "utf8");

const fixture = {
  schema: "iu-affiliate-cj-offers-public-v1",
  version: 1,
  updatedAt: "2026-11-20T00:00:00.000Z",
  liveEnabled: true,
  ok: true,
  refreshCoverage: { huge: "x".repeat(5000), note: "must_not_appear_in_lean" },
  publicGrowthBudget: { uncappedMode: false, deferredNew: 99 },
  sections: [
    {
      sectionKey: "aff-auto-moto",
      coupons: [
        {
          couponCode: "TEST",
          publicationReady: true,
          affiliateUrl: "https://www.example.com/click",
          partnerName: "Fixture",
        },
      ],
      actions: [],
      products: [
        {
          title: "Card A",
          publicationReady: true,
          currentPrice: 100,
          affiliateUrl: "https://www.example.com/click-a",
        },
      ],
    },
    {
      sectionKey: "aff-elektro",
      coupons: [],
      actions: [],
      products: [{ title: "Card B", publicationReady: true, currentPrice: 50, affiliateUrl: "https://www.example.com/b" }],
    },
  ],
  stats: { uniqueProducts: 2, products: 2 },
};

const lean = buildPagesLeanDoc(fixture);
assert.equal(lean.schema, PAGES_LEAN_SCHEMA);
assert.equal(lean.liveEnabled, true);
assert.equal(lean.refreshCoverage, undefined);
assert.equal(lean.publicGrowthBudget, undefined);
assert.equal(lean.sections.length, 2);
assert.ok(!JSON.stringify(lean).includes("must_not_appear_in_lean"));

const shard = buildSectionShardDoc(fixture, fixture.sections[0]);
assert.equal(shard.schema, SECTION_SHARD_SCHEMA);
assert.equal(shard.sections.length, 1);
assert.equal(shard.sections[0].sectionKey, "aff-auto-moto");
assert.equal(shard.liveEnabled, true);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-pages-shards-"));
const written = writePagesShards(fixture, tmpRoot, { pretty: false });
assert.equal(written.ok, true);
assert.equal(written.shardCount, 2);
assert.ok(fs.existsSync(path.join(tmpRoot, PAGES_LEAN_FILENAME)));
assert.ok(fs.existsSync(path.join(tmpRoot, SECTIONS_DIRNAME, "aff-auto-moto.json")));
assert.ok(fs.existsSync(path.join(tmpRoot, SECTIONS_DIRNAME, "aff-elektro.json")));

const est = estimateLoadPath(fixture, { abortMs: 2500 });
assert.ok(est.leanBytes < est.fullBytes);
assert.ok(est.maxShardBytes <= 1_500_000);
assert.equal(est.architectureSafeFor5k, true);

/* Oversized single-section must page under soft max. */
const fatProducts = [];
for (let i = 0; i < 400; i++) {
  fatProducts.push({
    title: "Fat-" + i + "-" + "y".repeat(2000),
    publicationReady: true,
    currentPrice: i,
    affiliateUrl: "https://www.kqzyfj.com/click-fat-" + i,
    advertiserId: "fat",
    productId: "f" + i,
    imageUrl: "https://example.com/" + "i".repeat(200),
  });
}
const fatDoc = {
  ...fixture,
  sections: [{ sectionKey: "aff-fat", coupons: [], actions: [], products: fatProducts }],
  stats: { uniqueProducts: 400 },
};
const fatEst = estimateLoadPath(fatDoc, { softMaxBytes: 200_000 });
assert.ok(fatEst.maxShardBytes <= 200_000, "paged shards must stay under soft max");
assert.ok(fatEst.shardCount >= 2, "fat section must split into pages");
assert.equal(fatEst.architectureSafeFor5k, true);

assert.ok(offersJs.includes("OFFERS_SECTION_BASE"));
assert.ok(offersJs.includes("OFFERS_PAGES_LEAN_PATH"));
assert.ok(offersJs.includes("fetchOffersSectionShard"));
assert.ok(offersJs.includes("fetchJsonWithTimeout"));
assert.ok(offersJs.includes("mergeSectionPageDocs"));
assert.ok(offersJs.includes("__p"));
assert.ok(offersJs.includes('rel="sponsored noopener"'));
assert.ok(offersJs.includes('target="_blank"'));
assert.ok(offersJs.includes("defaultVisibleProducts: 3"));
assert.ok(offersJs.includes("ensureAffiliateCategoryOrder"));
/* Growth gate must stay locked in client path — no uncapped toggle. */
assert.equal(offersJs.includes("uncappedMode"), false);

const swSrc = fs.readFileSync(path.join(repoRoot, "sw.js"), "utf8");
assert.ok(swSrc.includes("isAffiliateOffersPublicDataPath"));
assert.ok(swSrc.includes("iu-affiliate-cj-offers-public-v1.json"));
assert.ok(swSrc.includes("iu-affiliate-cj-offers-pages-v1.json"));
assert.ok(swSrc.includes('iu-affiliate-cj-offers-sections-v1/'));
const swFetch = swSrc.match(/self\.addEventListener\("fetch"[\s\S]*?\n\}\);/);
assert.ok(swFetch, "sw fetch handler");
assert.ok(swFetch[0].indexOf("isAffiliateOffersPublicDataPath(path)") < swFetch[0].indexOf("handleDataRequest(event)"));

const syncSrc = fs.readFileSync(path.join(repoRoot, "scripts", "iu-cj-affiliate-offers-live-sync-v1.mjs"), "utf8");
assert.ok(syncSrc.includes("writePagesShards"));
assert.ok(syncSrc.includes("pagesShards"));

console.log(
  JSON.stringify({
    IU_CJ_OFFERS_PAGES_SHARDS_SELFTEST: "OK",
    leanBytes: written.leanBytes,
    shardCount: written.shardCount,
    maxShardBytes: written.maxShardBytes,
    growthGateStillLocked: true,
    firstClickContract: true,
    tmpRoot,
  })
);
