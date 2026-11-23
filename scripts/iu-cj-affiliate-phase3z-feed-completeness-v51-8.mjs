#!/usr/bin/env node
/**
 * Per-JOINED-partner feed completeness bilance (read-only).
 * CJ inventory → published offers. Does not invent declared totals when unknown.
 */
import fs from "node:fs";
import path from "node:path";

export function buildFeedCompleteness(opts = {}) {
  const inventory = opts.inventory || {};
  const offers = opts.offers || {};
  const growth = offers.publicGrowthBudget || opts.growth || {};
  const durableByAdv = opts.durableEligibleByAdvertiser || {};
  const partners = Array.isArray(inventory.partners) ? inventory.partners : [];
  const growthRemaining =
    growth.cumulativeRemaining != null
      ? Number(growth.cumulativeRemaining)
      : growth.maxCumulativeAbs != null && growth.cumulativeAddedSinceBaseline != null
        ? Number(growth.maxCumulativeAbs) - Number(growth.cumulativeAddedSinceBaseline)
        : null;
  const growthExhausted = growthRemaining === 0 || Number(growth.allowedNew) === 0;
  const byAdvPublished = {};
  let publishedProducts = 0;
  let holdProducts = 0;
  let carriedProducts = 0;
  for (const sec of offers.sections || []) {
    for (const p of sec.products || []) {
      const adv = String(p?.advertiserId || "").trim();
      if (!adv) continue;
      if (!byAdvPublished[adv]) {
        byAdvPublished[adv] = {
          advertiserId: adv,
          publishedUnique: new Set(),
          holdUnique: new Set(),
          carriedUnique: new Set(),
          rejectedHints: 0,
        };
      }
      const id = String(p?.productId || p?.id || "").trim();
      const key = id ? `${adv}|${id}` : null;
      if (!key) continue;
      byAdvPublished[adv].publishedUnique.add(key);
      publishedProducts += 1;
      if (p?.lkgPublicHold === true || p?.publicationHold === true) {
        byAdvPublished[adv].holdUnique.add(key);
        holdProducts += 1;
      }
      if (p?.lkgCarried === true) {
        byAdvPublished[adv].carriedUnique.add(key);
        carriedProducts += 1;
      }
    }
  }

  const rows = [];
  for (const partner of partners) {
    const adv = String(partner.advertiserId || "").trim();
    const pub = byAdvPublished[adv] || {
      publishedUnique: new Set(),
      holdUnique: new Set(),
      carriedUnique: new Set(),
    };
    const declared =
      partner.declaredProductCountSum != null && Number.isFinite(Number(partner.declaredProductCountSum))
        ? Number(partner.declaredProductCountSum)
        : null;
    const published = pub.publishedUnique.size;
    const hold = pub.holdUnique.size;
    const carried = pub.carriedUnique.size;
    const durableEligible = Number(durableByAdv[adv] || 0);
    const gaps = [];
    if (partner.hasFeed !== true && published > 0) gaps.push("PUBLISHED_WITHOUT_CURRENT_FEED_FLAG");
    if (partner.hasFeed === true && declared === 0 && published === 0 && durableEligible === 0) {
      gaps.push("EMPTY_FEED");
    }
    if (partner.hasFeed === true && declared != null && declared > 0 && published === 0) {
      if (durableEligible > 0 && growthExhausted) {
        gaps.push("GROWTH_BUDGET_BLOCKED_ELIGIBLE");
      } else if (durableEligible > 0) {
        gaps.push("DURABLE_ELIGIBLE_AWAITING_PUBLICATION");
      } else {
        gaps.push("FEED_DECLARED_BUT_NONE_PUBLISHED");
      }
    }
    if (partner.joined === false && published > 0) gaps.push("PUBLISHED_WHILE_NOT_JOINED");
    if (partner.inventoryStatus && /error|blocked/i.test(String(partner.inventoryStatus))) {
      gaps.push("INVENTORY_ERROR_OR_BLOCKED");
    }
    rows.push({
      advertiserId: adv,
      partnerName: partner.partnerName || null,
      partnershipStatus: partner.joined === true ? "JOINED" : partner.active === false ? "INACTIVE" : "UNKNOWN",
      joined: partner.joined === true,
      hasFeed: partner.hasFeed === true,
      feedCount: partner.feedCount ?? null,
      lastInventoryAt: partner.inventoriedAt || null,
      declaredProductCount: declared,
      declaredProductCountKnown: declared != null,
      downloadedItems: null,
      processedItems: null,
      deduplicatedItems: null,
      rejectedItems: null,
      eligibleProducts: durableEligible > 0 ? durableEligible : null,
      publishedProducts: published,
      holdProducts: hold,
      carriedProducts: carried,
      growthBudgetBlocked: durableEligible > 0 && growthExhausted ? durableEligible : null,
      gapReasons: gaps,
      note:
        declared == null
          ? "CJ declared total unknown/null for partner — report processed/published only"
          : durableEligible > 0 && published === 0 && growthExhausted
            ? "Eligible durable products present; public growth cumulative budget exhausted (not silent feed loss)"
            : "declaredProductCountSum is inventory-declared, not a guarantee of CJ API completeness",
    });
  }

  // Advertisers present in offers but missing from inventory snapshot
  for (const adv of Object.keys(byAdvPublished)) {
    if (rows.some((r) => r.advertiserId === adv)) continue;
    const pub = byAdvPublished[adv];
    rows.push({
      advertiserId: adv,
      partnerName: null,
      partnershipStatus: "NOT_IN_INVENTORY_SNAPSHOT",
      joined: null,
      hasFeed: null,
      feedCount: null,
      lastInventoryAt: null,
      declaredProductCount: null,
      declaredProductCountKnown: false,
      downloadedItems: null,
      processedItems: null,
      deduplicatedItems: null,
      rejectedItems: null,
      eligibleProducts: null,
      publishedProducts: pub.publishedUnique.size,
      holdProducts: pub.holdUnique.size,
      carriedProducts: pub.carriedUnique.size,
      growthBudgetBlocked: null,
      gapReasons: ["OFFERS_ADVERTISER_MISSING_FROM_INVENTORY"],
      note: "Present in published offers; absent from feed-inventory partners list this snapshot",
    });
  }

  return {
    schema: "iu-cj-affiliate-phase3z-feed-completeness-v51-8",
    at: new Date().toISOString(),
    inventoryCounts: inventory.counts || null,
    inventoryEvidenceClass: inventory.evidenceClass || null,
    offersStats: offers.stats || null,
    growthBudget: {
      cumulativeAddedSinceBaseline: growth.cumulativeAddedSinceBaseline ?? null,
      cumulativeRemaining: growth.cumulativeRemaining ?? null,
      deferredNew: growth.deferredNew ?? growth.newCandidates ?? null,
      uncappedMode: growth.uncappedMode === true,
      note: "Deferred new identities are growth-budget blocked, not silent feed loss",
    },
    totals: {
      partnersInInventory: partners.length,
      partnersWithFeed: partners.filter((p) => p.hasFeed === true).length,
      partnersJoined: partners.filter((p) => p.joined === true).length,
      declaredProductCountSum: inventory.counts?.declaredProductCountSum ?? null,
      publishedProductRows: publishedProducts,
      uniquePublishedApprox: Object.values(byAdvPublished).reduce((n, x) => n + x.publishedUnique.size, 0),
      holdProductRows: holdProducts,
      carriedProductRows: carriedProducts,
    },
    partners: rows.sort((a, b) => String(a.advertiserId).localeCompare(String(b.advertiserId))),
    chain: [
      "CJ API",
      "available feeds (inventory)",
      "ingestion/checkpoints",
      "validation",
      "dedup",
      "eligibility",
      "growth gate/budget",
      "publication",
    ],
  };
}

function loadDurableEligibleByAdvertiser(dirAbs) {
  const out = {};
  if (!dirAbs || !fs.existsSync(dirAbs)) return out;
  const names = fs.readdirSync(dirAbs).filter((n) =>
    /^iu-affiliate-cj-durable-catalog-shard-v51-.*\.json$/i.test(n),
  );
  for (const name of names) {
    const shard = JSON.parse(fs.readFileSync(path.join(dirAbs, name), "utf8"));
    const products = shard.products || {};
    for (const key of Object.keys(products)) {
      const adv = String(key.split("|")[0] || "").trim();
      if (!adv) continue;
      out[adv] = (out[adv] || 0) + 1;
    }
  }
  return out;
}

async function main() {
  const invPath =
    process.env.IU_CJ_FEED_INVENTORY_PATH ||
    path.join(process.env.TEMP || "/tmp", "iu-affiliate-cj-feed-inventory-v40.json");
  const offersUrl =
    process.env.IU_CJ_OFFERS_PUBLIC_URL ||
    "https://infouzel.cz/projects/data/iu-affiliate-cj-offers-public-v1.json";
  const outPath =
    process.env.IU_CJ_FEED_COMPLETENESS_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-feed-completeness.json");
  const durableDir =
    process.env.IU_CJ_DURABLE_CATALOG_DIR ||
    path.dirname(invPath);

  let inventory = {};
  if (fs.existsSync(invPath)) {
    inventory = JSON.parse(fs.readFileSync(invPath, "utf8"));
  }
  const offers = await (await fetch(offersUrl)).json();
  const durableEligibleByAdvertiser = loadDurableEligibleByAdvertiser(durableDir);
  const doc = buildFeedCompleteness({ inventory, offers, durableEligibleByAdvertiser });
  doc.totals.durableEligibleAdvertisers = Object.keys(durableEligibleByAdvertiser).length;
  doc.totals.durableEligibleProducts = Object.values(durableEligibleByAdvertiser).reduce(
    (n, v) => n + Number(v || 0),
    0,
  );
  doc.totals.growthBudgetBlockedPartners = doc.partners.filter((p) =>
    (p.gapReasons || []).includes("GROWTH_BUDGET_BLOCKED_ELIGIBLE"),
  ).length;
  doc.totals.unexplainedNonePublished = doc.partners.filter((p) =>
    (p.gapReasons || []).includes("FEED_DECLARED_BUT_NONE_PUBLISHED"),
  ).length;
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        partners: doc.partners.length,
        totals: doc.totals,
        gapPartners: doc.partners.filter((p) => (p.gapReasons || []).length).length,
        unexplainedNonePublished: doc.totals.unexplainedNonePublished,
        growthBudgetBlockedPartners: doc.totals.growthBudgetBlockedPartners,
      },
      null,
      2,
    ),
  );
}

const isDirect =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("iu-cj-affiliate-phase3z-feed-completeness-v51-8.mjs");
if (isDirect) {
  main().catch((e) => {
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  });
}
