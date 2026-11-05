#!/usr/bin/env node
import {
  FEED_INVENTORY_SCHEMA,
  PARTNER_INVENTORY_STATUS,
  buildCumulativeCoverageLedgerV40,
  buildFeedInventoryDocument,
  mergeFeedInventoryDocuments,
  selectPartnersForProgressiveInventory,
} from "./iu-cj-affiliate-phase3z-feed-inventory-v40.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const doc = buildFeedInventoryDocument({
  inventoryEnabled: true,
  nowIso: "2026-11-04T20:00:00.000Z",
  runId: "test",
  inventoriedAdvertiserIds: new Set(["1", "2"]),
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
assert(doc.partners[0].inventoryStatus === PARTNER_INVENTORY_STATUS.INVENTORIED_HAS_FEED, "has feed status");
assert(doc.partners[1].inventoryStatus === PARTNER_INVENTORY_STATUS.INVENTORIED_NO_FEED, "no feed status");

const disabled = buildFeedInventoryDocument({
  inventoryEnabled: false,
  feeds: [],
  partners: [{ advertiserId: "1", title: "A" }],
});
assert(disabled.inventoryEnabled === false, "honest disabled");
assert(disabled.counts.feedRows === 0, "no invented feeds");
assert(disabled.partners[0].inventoryStatus === PARTNER_INVENTORY_STATUS.NOT_YET_INVENTORIED, "not yet");

const merged = mergeFeedInventoryDocuments(
  doc,
  [
    {
      advertiserId: "2",
      partnerName: "B",
      adId: "20",
      feedName: "f2",
      productCount: 3,
      inventoryComplete: true,
    },
  ],
  {
    partners: [
      { advertiserId: "1", title: "A", active: true },
      { advertiserId: "2", title: "B", active: true },
      { advertiserId: "3", title: "C", active: true },
    ],
    inventoriedAdvertiserIds: new Set(["2"]),
    inventoryMode: "progressive",
    runId: "test2",
    nowIso: "2026-11-05T12:00:00.000Z",
  }
);
assert(merged.counts.feedRows === 2, "merged keeps prior + new");
assert(merged.counts.partnersWithFeed === 2, "both with feed");
assert(merged.partners.find((p) => p.advertiserId === "3").inventoryStatus === PARTNER_INVENTORY_STATUS.NOT_YET_INVENTORIED, "3 pending");

const prog = selectPartnersForProgressiveInventory(
  [
    { advertiserId: "1", title: "A", active: true },
    { advertiserId: "2", title: "B", active: true },
    { advertiserId: "3", title: "C", active: true },
  ],
  merged,
  { limit: 2 }
);
assert(prog.needingInventory === 1, "only C needs inventory");
assert(prog.selected.length === 1 && prog.selected[0].advertiserId === "3", "select C");

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
    mergedCounts: merged.counts,
    progressive: { needing: prog.needingInventory, selected: prog.selected.length },
    cumHorizons: Object.fromEntries(Object.entries(cum.horizons).map(([k, v]) => [k, v.status])),
  })
);
