#!/usr/bin/env node
/**
 * V51: empty publication staging must not invent offers, but MUST still allow
 * durable/reverify ledger write against LIVE LKG (SOURCE_VERIFIED ≠ PUBLICATION).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runOffersLiveSync,
  writeDurableVerificationLedgers,
} from "./iu-cj-affiliate-offers-live-sync-v1.mjs";
import {
  appendDurablePriceHistory,
  assertDurableHistoryReadable,
  emptyDurablePriceHistory,
} from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-v51-verify-"));
const dataDir = path.join(tmp, "data");
fs.mkdirSync(dataDir, { recursive: true });

const liveDoc = {
  schemaVersion: 1,
  liveEnabled: true,
  updatedAt: "2026-11-07T00:00:00.000Z",
  sections: [
    {
      sectionKey: "aff-nabytek",
      advertiserId: "111",
      products: [
        {
          advertiserId: "111",
          productId: "P1",
          currentPrice: "100.00",
          previousPrice: "90.00",
          currency: "CZK",
          availability: "in stock",
          publicationReady: true,
          verifiedAt: "2026-11-07T00:00:00.000Z",
          priceChangedAt: "2026-11-07T00:00:00.000Z",
          affiliateUrl: "https://www.tkqlhce.com/click-101883843-1",
        },
      ],
      coupons: [],
      actions: [],
    },
  ],
};

fs.writeFileSync(
  path.join(dataDir, "iu-affiliate-cj-offers-public-v1.json"),
  JSON.stringify(liveDoc, null, 2)
);
fs.writeFileSync(
  path.join(dataDir, "iu-affiliate-cj-staging-v1.json"),
  JSON.stringify({ apiOutage: false, advertisers: [], links: [] })
);
fs.writeFileSync(
  path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"),
  JSON.stringify({ partners: [{ advertiserId: "111", title: "T", active: true }] })
);
fs.writeFileSync(path.join(dataDir, "iu-affiliate-slot-policy-v1.json"), JSON.stringify({ partners: [] }));
fs.writeFileSync(path.join(dataDir, "iu-affiliate-cj-section-map-v1.json"), JSON.stringify({}));

const r = await runOffersLiveSync({
  dataDir,
  env: {
    IU_CJ_OFFERS_PROMOTE_ARMED: "0",
    IU_CJ_OFFERS_LIVE_ENABLED: "0",
    IU_CJ_OFFERS_REFRESH_PUBLISHED: "0",
  },
  sampleProducts: false,
  refreshPublished: false,
});

assert(r.ok === false, "publication not ok");
assert(r.reason === "STAGING_EMPTY_VERIFY_ONLY", "verify-only reason");
assert(r.wrote === false, "no publication write");
assert(r.verificationLedgersWritten === true, "ledgers written");
assert(fs.existsSync(path.join(dataDir, "iu-affiliate-cj-durable-price-history-v50.json")), "durable file");
assert(fs.existsSync(path.join(dataDir, "iu-affiliate-cj-product-reverify-v50.json")), "reverify file");

// Idempotent append / cross-run readable when prior restored
const prior = JSON.parse(
  fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-durable-price-history-v50.json"), "utf8")
);
const again = appendDurablePriceHistory(prior, {
  nowIso: "2026-11-07T01:00:00.000Z",
  runId: "runB",
  priceChanges: [],
  formatOnlyChanges: [],
});
const proof = assertDurableHistoryReadable(prior, again);
assert(proof.readable === true, "prior keys readable after empty append");
assert(proof.missing === 0, "no missing prior keys");

// Helper export smoke
const w = writeDurableVerificationLedgers({
  dataDir,
  env: { GITHUB_RUN_ID: "helper", GITHUB_SHA: "abc" },
  doc: liveDoc,
  prevPublic: liveDoc,
  coverageByKey: new Map(),
  refreshedByKey: new Map(),
  publicationGate: "SELFTEST",
});
assert(w.ok === true, "helper ok");

console.log(
  JSON.stringify({
    V51_STAGING_VERIFY_ONLY_SELFTEST: "PASS",
    reason: r.reason,
    durableEvents: prior.counts?.economicEvents ?? null,
    readProof: proof,
  })
);
