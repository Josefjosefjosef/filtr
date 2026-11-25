#!/usr/bin/env node
/**
 * V51.8 — partner inventory summary export (pure, no IO).
 *
 * Normalizes three DISTINCT partner denominators so they are never double-counted:
 *   1) JOINED proxy          — CJ program joins (funnel / inventory joined)
 *   2) advertisersWithOffers — unique advertisers present in published offers
 *                              (= stats.partners) — NOT CJ JOINED count
 *   3) withFeed / withoutFeed — inventory feed flags among tracked partners
 *
 * Explicit note: stats.partners != CJ JOINED count.
 *
 * CLI selftest: node scripts/iu-cj-affiliate-phase3z-partner-inventory-export-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PARTNER_INVENTORY_EXPORT_SCHEMA =
  "iu-cj-affiliate-phase3z-partner-inventory-export-v51-8";

const STATS_PARTNERS_NOTE =
  "stats.partners (= advertisersWithOffers) = unique advertisers with ≥1 coupon/action/product in published offers — NOT CJ JOINED count.";

function num(v, fallback = null) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function firstNum(...candidates) {
  for (const c of candidates) {
    const n = num(c, null);
    if (n != null) return n;
  }
  return null;
}

/**
 * @param {object} input
 * @param {object} [input.funnel] — product/partner funnel progress snapshot
 * @param {object} [input.feedInventory] — feed-inventory doc ({ counts, partners })
 * @param {object} [input.offersStats] — offers-public stats (or { stats })
 */
export function buildPartnerInventorySummary({
  funnel = {},
  feedInventory = {},
  offersStats = {},
} = {}) {
  const funnelCounts = funnel?.counts && typeof funnel.counts === "object" ? funnel.counts : funnel || {};
  const invCounts =
    feedInventory?.counts && typeof feedInventory.counts === "object"
      ? feedInventory.counts
      : feedInventory || {};
  const statsRaw =
    offersStats?.stats && typeof offersStats.stats === "object"
      ? offersStats.stats
      : offersStats || {};

  const partnersList = Array.isArray(feedInventory?.partners) ? feedInventory.partners : [];

  let withFeedFromList = 0;
  let withoutFeedFromList = 0;
  let joinedFromList = 0;
  for (const p of partnersList) {
    if (p?.joined === true || /joined/i.test(String(p?.relationshipStatus || ""))) {
      joinedFromList += 1;
    }
    if (p?.hasFeed === true) withFeedFromList += 1;
    else withoutFeedFromList += 1;
  }

  const joinedProxy = firstNum(
    funnelCounts.JOINED,
    funnelCounts.joined,
    funnelCounts.joinedHistorical,
    funnelCounts.joinedPartners,
    funnel?.JOINED,
    funnel?.joined,
    invCounts.joined,
    invCounts.joinedPartners,
    joinedFromList > 0 ? joinedFromList : null,
  );

  const inventoryTracked = firstNum(
    invCounts.partners,
    invCounts.partnersTracked,
    invCounts.partnersListed,
    partnersList.length > 0 ? partnersList.length : null,
    funnelCounts.inventory,
    funnelCounts.partnersTracked,
  );

  let withFeed = firstNum(
    funnelCounts.withFeed,
    funnelCounts.withFeedTracked,
    invCounts.partnersWithFeed,
    invCounts.withFeed,
    partnersList.length > 0 ? withFeedFromList : null,
  );
  let withoutFeed = firstNum(
    funnelCounts.withoutFeed,
    funnelCounts.withoutFeedTracked,
    invCounts.partnersWithoutFeed,
    invCounts.withoutFeed,
    partnersList.length > 0 ? withoutFeedFromList : null,
  );

  // Prefer list-derived partition when available (authoritative no-double-count).
  if (partnersList.length > 0) {
    withFeed = withFeedFromList;
    withoutFeed = withoutFeedFromList;
  } else if (withFeed != null && withoutFeed == null && inventoryTracked != null) {
    withoutFeed = Math.max(0, inventoryTracked - withFeed);
  } else if (withoutFeed != null && withFeed == null && inventoryTracked != null) {
    withFeed = Math.max(0, inventoryTracked - withoutFeed);
  }

  const feedPartitionSum =
    withFeed != null && withoutFeed != null ? withFeed + withoutFeed : null;
  const feedPartitionMatchesTracked =
    feedPartitionSum != null && inventoryTracked != null
      ? feedPartitionSum === inventoryTracked
      : feedPartitionSum != null
        ? true
        : null;

  const advertisersWithOffers = firstNum(
    statsRaw.advertisersWithOffers,
    statsRaw.partners,
    offersStats?.advertisersWithOffers,
    offersStats?.partners,
  );

  const statsPartners = firstNum(statsRaw.partners, advertisersWithOffers);

  const productAdvertisers = firstNum(statsRaw.productAdvertisers);
  const couponAdvertisers = firstNum(statsRaw.couponAdvertisers);
  const actionAdvertisers = firstNum(statsRaw.actionAdvertisers);

  const notes = [
    STATS_PARTNERS_NOTE,
    "JOINED proxy is CJ program joins (funnel/inventory) — do not equate to stats.partners.",
    "withFeed + withoutFeed partitions inventoryTracked partners; mutually exclusive, no double-count.",
  ];

  if (
    joinedProxy != null &&
    statsPartners != null &&
    joinedProxy !== statsPartners
  ) {
    notes.push(
      "joinedProxy (" +
        joinedProxy +
        ") != stats.partners (" +
        statsPartners +
        ") — expected; different denominators.",
    );
  }

  return {
    schema: PARTNER_INVENTORY_EXPORT_SCHEMA,
    denominators: {
      joinedProxy,
      joinedProxySource: "CJ JOINED / funnel proxy — not offers stats.partners",
      inventoryTracked,
      withFeed,
      withoutFeed,
      feedPartitionSum,
      feedPartitionMatchesTracked,
      advertisersWithOffers,
      statsPartners,
      statsPartnersEqualsAdvertisersWithOffers:
        statsPartners != null &&
        advertisersWithOffers != null &&
        statsPartners === advertisersWithOffers,
    },
    offersBreakdown: {
      productAdvertisers,
      couponAdvertisers,
      actionAdvertisers,
      note: "Subset advertisers by offer type; union size is advertisersWithOffers (may be < sum of subsets).",
    },
    equalityGuards: {
      statsPartnersIsNotCjJoined: true,
      withFeedPlusWithoutFeedEqualsTracked:
        feedPartitionMatchesTracked === true ||
        (inventoryTracked == null && feedPartitionSum != null),
      noDoubleCountWithFeedWithoutFeed:
        withFeed != null &&
        withoutFeed != null &&
        (inventoryTracked == null || withFeed + withoutFeed === inventoryTracked),
    },
    notes,
    statsPartnersNote: STATS_PARTNERS_NOTE,
  };
}

/** Fixture selftest: withFeed+withoutFeed math, no double-count, stats.partners ≠ JOINED. */
export function runPartnerInventoryExportSelftest() {
  const funnel = {
    counts: {
      JOINED: 183,
      inventory: 10,
      withFeedTracked: 6,
    },
  };
  const feedInventory = {
    counts: {
      partnersListed: 10,
      partnersWithFeed: 6,
      partnersWithoutFeed: 4,
      joinedPartners: 183,
    },
    partners: [
      { advertiserId: "1", joined: true, hasFeed: true },
      { advertiserId: "2", joined: true, hasFeed: true },
      { advertiserId: "3", joined: true, hasFeed: true },
      { advertiserId: "4", joined: true, hasFeed: true },
      { advertiserId: "5", joined: true, hasFeed: true },
      { advertiserId: "6", joined: true, hasFeed: true },
      { advertiserId: "7", joined: true, hasFeed: false },
      { advertiserId: "8", joined: true, hasFeed: false },
      { advertiserId: "9", joined: false, hasFeed: false },
      { advertiserId: "10", joined: false, hasFeed: false },
    ],
  };
  const offersStats = {
    partners: 42,
    advertisersWithOffers: 42,
    productAdvertisers: 30,
    couponAdvertisers: 20,
    actionAdvertisers: 15,
    statsSemantics:
      "partners(=advertisersWithOffers)=unique advertisers with ≥1 coupon/action/product in published offers — NOT CJ JOINED count",
  };

  const s = buildPartnerInventorySummary({ funnel, feedInventory, offersStats });
  const checks = [];
  function check(name, ok, detail) {
    checks.push({ name, ok: ok === true, detail: detail ?? null });
  }

  check("joined_proxy_183", s.denominators.joinedProxy === 183, s.denominators.joinedProxy);
  check("with_feed_6", s.denominators.withFeed === 6, s.denominators.withFeed);
  check("without_feed_4", s.denominators.withoutFeed === 4, s.denominators.withoutFeed);
  check(
    "with_plus_without_eq_tracked",
    s.denominators.withFeed + s.denominators.withoutFeed === s.denominators.inventoryTracked,
    {
      sum: s.denominators.feedPartitionSum,
      tracked: s.denominators.inventoryTracked,
    },
  );
  check(
    "no_double_count_guard",
    s.equalityGuards.noDoubleCountWithFeedWithoutFeed === true,
    s.equalityGuards,
  );
  check(
    "stats_partners_42",
    s.denominators.statsPartners === 42 && s.denominators.advertisersWithOffers === 42,
    s.denominators,
  );
  check(
    "stats_partners_not_joined",
    s.denominators.statsPartners !== s.denominators.joinedProxy &&
      s.equalityGuards.statsPartnersIsNotCjJoined === true,
    {
      statsPartners: s.denominators.statsPartners,
      joinedProxy: s.denominators.joinedProxy,
    },
  );
  check(
    "note_mentions_not_joined",
    /NOT CJ JOINED/i.test(s.statsPartnersNote) &&
      s.notes.some((n) => /stats\.partners/i.test(n) && /NOT CJ JOINED/i.test(n)),
    s.statsPartnersNote,
  );

  // Counts-only path (no partners list): derive withoutFeed from tracked - withFeed
  const derived = buildPartnerInventorySummary({
    funnel: { counts: { JOINED: 100, withFeed: 7 } },
    feedInventory: { counts: { partnersTracked: 12, partnersWithFeed: 7 } },
    offersStats: { partners: 5, advertisersWithOffers: 5 },
  });
  check("derived_without_feed", derived.denominators.withoutFeed === 5, derived.denominators);
  check(
    "derived_partition_math",
    derived.denominators.withFeed + derived.denominators.withoutFeed === 12,
    derived.denominators,
  );
  check(
    "derived_stats_ne_joined",
    derived.denominators.statsPartners === 5 && derived.denominators.joinedProxy === 100,
    derived.denominators,
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: PARTNER_INVENTORY_EXPORT_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
    summary: {
      joinedProxy: s.denominators.joinedProxy,
      withFeed: s.denominators.withFeed,
      withoutFeed: s.denominators.withoutFeed,
      inventoryTracked: s.denominators.inventoryTracked,
      statsPartners: s.denominators.statsPartners,
    },
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runPartnerInventoryExportSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_PARTNER_INVENTORY_EXPORT_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
