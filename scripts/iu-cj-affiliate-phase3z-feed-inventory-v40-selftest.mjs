#!/usr/bin/env node
import {
  FEED_INVENTORY_SCHEMA,
  buildCumulativeCoverageLedgerV40,
  buildFeedInventoryDocument,
} from "./iu-cj-affiliate-phase3z-feed-inventory-v40.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const doc = buildFeedInventoryDocument({
  inventoryEnabled: true,
  nowIso: "2026-11-04T20:00:00.000Z",
  runId: "test",
  partners: [
    { advertiserId: "1", title: "A", active: true },
    { advertiserId: "2", title: "B", active: true },
  ],
  feeds: [
    {
      advertiserId: "1",
      partnerName: "A",
      adId: "10",
      feedName: "f1",
      productCount: 12,
      inventoryComplete: true,
    },
  ],
});
assert(doc.schema === FEED_INVENTORY_SCHEMA, "schema");
assert(doc.counts.feedRows === 1, "feed rows");
assert(doc.counts.partnersWithFeed === 1, "with feed");
assert(doc.counts.partnersWithoutFeed === 1, "without feed");
assert(doc.feeds.length === 1, "full feeds persisted");

const disabled = buildFeedInventoryDocument({
  inventoryEnabled: false,
  feeds: [],
  partners: [{ advertiserId: "1", title: "A" }],
});
assert(disabled.inventoryEnabled === false, "honest disabled");
assert(disabled.counts.feedRows === 0, "no invented feeds");

const cum = buildCumulativeCoverageLedgerV40(
  {
    cumulative: {
      everMatchedCount: 2,
      everMatchedUniqueKeys: ["a|1", "b|2"],
      lastPass: { at: "2026-11-04T20:00:00.000Z", cumulativeCoveragePct: 50 },
      horizons: {
        "3h": { status: "PENDING_OBSERVATION", requiredHours: 3, elapsedHours: 0.5 },
        "6h": { status: "PENDING_OBSERVATION" },
        "12h": { status: "PENDING_OBSERVATION" },
        "24h": { status: "PENDING_OBSERVATION" },
        "48h": { status: "PENDING_OBSERVATION" },
      },
      snapshots: [
        {
          at: "2026-11-04T20:00:00.000Z",
          runId: "1",
          publishedUnique: 4,
          passMatchedUnique: 2,
          cumulativeMatchedUnique: 2,
          cumulativeCoveragePct: 50,
          measured: true,
        },
      ],
    },
  },
  { nowIso: "2026-11-04T20:00:00.000Z" }
);
assert(cum.schema === "iu-cj-affiliate-phase3z-cumulative-coverage-v40", "cum schema");
assert(!("everMatchedUniqueKeys" in cum), "no key explosion in slim ledger");
assert(cum.horizons["3h"].status === "PENDING_OBSERVATION", "3h pending honest");
assert(cum.snapshotCount === 1, "snapshot count");

console.log(
  JSON.stringify({
    IU_CJ_FEED_INVENTORY_V40_SELFTEST: "PASS",
    feedCounts: doc.counts,
    cumHorizons: Object.fromEntries(Object.entries(cum.horizons).map(([k, v]) => [k, v.status])),
  })
);
