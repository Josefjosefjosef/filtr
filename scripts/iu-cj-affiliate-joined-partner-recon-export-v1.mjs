#!/usr/bin/env node
/**
 * JOINED partner reconciliation + product inventory + ENDED longitudinal proof exporter (read-only, offline).
 *
 * Reads committed/ephemeral artifacts and writes LARGE outputs OUTSIDE the repo (--out-dir, e.g. C:\projects\iu-cj-audits).
 * No network, no D1/R2, no repo writes, no growth/email activation. Safety gates are reported, never changed.
 *
 * Outputs (in --out-dir):
 *   FULL_JOINED_PARTNER_RECONCILIATION.json   per-partner rows for ALL JOINED partners (+ summary, guards)
 *   PRODUCT_INVENTORY_IDENTITIES.jsonl.gz     one JSON line per durable catalog identity (only when shards found)
 *   PRODUCT_INVENTORY_BALANCE_AGGREGATE.json  counts + product-inventory-balance math (+ EXTERNAL_BLOCKED when shards absent)
 *   ENDED_LONGITUDINAL_PROOF.json             fixture-based mechanism proof (never claims a production ENDED event)
 *
 * Run (PowerShell, one arg per line is fine):
 *   node scripts/iu-cj-affiliate-joined-partner-recon-export-v1.mjs --out-dir C:\projects\iu-cj-audits `
 *     --registry <registry.json> --offers <offers-public.json> `
 *     [--feed-inventory <feed-inventory-v40.json>] [--missing-feed <missing-feed-partners-v47.json>] `
 *     [--shard-dir <dir with durable-catalog-shard-v51-s*.json>] [--deferred-ledger <deferred-new-ledger-v51.json>] `
 *     [--retry-queue <lkg-refresh-retry-queue-v51-8.json>] [--previous-registry <older registry.json>]...
 *
 * Defaults: --registry / --offers fall back to committed projects/data artifacts (the committed registry may be OLDER
 * than the live CJ staging snapshot — pass the newest phase3z-out registry explicitly for current JOINED counts).
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import zlib from "node:zlib";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { buildJoinedEndedInventory } from "./iu-cj-affiliate-joined-ended-inventory-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  buildProductInventoryBalance,
  PRIMARY_STATE,
  PRIMARY_STATE_PRIORITY,
} from "./iu-cj-affiliate-phase3z-product-inventory-balance-v51-8.mjs";
import {
  classifyPartnerLifecycleTransition,
  evaluatePartnerLifecyclePublicRules,
  normalizeRelationshipStatus,
} from "./iu-cj-affiliate-phase3z-partner-lifecycle-v51-8.mjs";
import { isEndedApiDownFalsePositive } from "./iu-cj-affiliate-phase3z-partner-lifecycle-audit-v51-8.mjs";

export const JOINED_PARTNER_RECON_SCHEMA = "iu-cj-affiliate-joined-partner-reconciliation-v2";
export const PRODUCT_INVENTORY_AGGREGATE_SCHEMA = "iu-cj-affiliate-product-inventory-aggregate-v2";
export const ENDED_LONGITUDINAL_PROOF_SCHEMA = "iu-cj-affiliate-ended-longitudinal-proof-v1";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REGISTRY = path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json");
const DEFAULT_OFFERS = path.join(ROOT, "projects", "data", "iu-affiliate-cj-offers-public-v1.json");

export const SHARD_FILE_RE = /^iu-affiliate-cj-durable-catalog-shard-v51-s\d+\.json$/;
export const EXPECTED_ARTIFACT_PATHS = Object.freeze({
  shardDir: "<dir>/iu-affiliate-cj-durable-catalog-shard-v51-s0000.json … sNNNN.json (CI artifact 'iu-cj-cp-<runId>' / durable checkpoint)",
  durableCatalogIndex: "<dir>/iu-affiliate-cj-durable-catalog-v51.json (generation.shards[] manifest)",
  deferredLedger: "<dir>/iu-affiliate-cj-deferred-new-ledger-v51.json (keys[] / entries[])",
  retryQueue: "<dir>/iu-affiliate-cj-lkg-refresh-retry-queue-v51-8.json",
  feedInventory: "<dir>/iu-affiliate-cj-feed-inventory-v40.json",
  missingFeedPartners: "<dir>/iu-affiliate-cj-missing-feed-partners-v47.json",
});

// ───────────────────────── helpers ─────────────────────────
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function idOf(p) {
  const v = p?.advertiserId ?? p?.cid ?? p?.partnerId;
  if (v == null || v === "") return null;
  return String(v).replace(/^cj-/, "");
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}
function sortedIds(ids) {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
function assertOutsideRepo(dir) {
  const abs = path.resolve(dir);
  if (abs === ROOT || abs.startsWith(ROOT + path.sep)) {
    throw new Error("REFUSED: --out-dir must be outside the repo (large artifacts go to the audits folder / %TEMP%).");
  }
  return abs;
}

// ───────────────────────── offers index ─────────────────────────
/**
 * Per-advertiser published-offer index from offers-public (items carry their own advertiserId).
 * Unique counts de-duplicate cross-category placements (sections repeat the same offer/product).
 */
export function indexOffersByAdvertiser(offersPublic) {
  const byAdv = new Map();
  const publishedKeys = new Set();
  const heldKeys = new Set();
  const get = (id) => {
    if (!byAdv.has(id)) {
      byAdv.set(id, {
        couponIds: new Set(),
        actionIds: new Set(),
        productKeys: new Set(),
        heldProductKeys: new Set(),
        couponPlacements: 0,
        actionPlacements: 0,
        productPlacements: 0,
        emailSourcedOfferIds: new Set(),
        sectionKeys: new Set(),
        partnerNames: new Set(),
      });
    }
    return byAdv.get(id);
  };
  const sections = Array.isArray(offersPublic?.sections) ? offersPublic.sections : [];
  for (const sec of sections) {
    for (const kind of ["coupons", "actions", "products"]) {
      const arr = Array.isArray(sec?.[kind]) ? sec[kind] : [];
      for (const o of arr) {
        if (o?.advertiserId == null || o.advertiserId === "") continue;
        const id = String(o.advertiserId);
        const e = get(id);
        if (sec.sectionKey) e.sectionKeys.add(String(sec.sectionKey));
        if (o.partnerName) e.partnerNames.add(String(o.partnerName));
        if (kind === "coupons") {
          e.couponPlacements += 1;
          e.couponIds.add(String(o.offerId ?? `${o.title}|${o.couponCode}`));
        } else if (kind === "actions") {
          e.actionPlacements += 1;
          e.actionIds.add(String(o.offerId ?? o.title));
        } else {
          const key = `${id}|${o.productId}`;
          // LKG public-hold items live in offers-public but are NOT publicly shown (hold ≠ published).
          if (o.lkgPublicHold === true || o.publicationEligibility === "PUBLICATION_HOLD") {
            e.heldProductKeys.add(key);
            heldKeys.add(key);
          } else {
            e.productPlacements += 1;
            e.productKeys.add(key);
            publishedKeys.add(key);
          }
        }
        if (/email/i.test(String(o.sourceSystem || ""))) {
          e.emailSourcedOfferIds.add(String(o.offerId ?? o.productId ?? o.title));
        }
      }
    }
  }
  for (const k of heldKeys) publishedKeys.delete(k);
  return { byAdv, publishedKeys, heldKeys };
}

// ───────────────────────── per-partner reconciliation ─────────────────────────
function deriveCzStatus(p) {
  const v = p?.czMarketEligibilityVerified;
  if (v === true) return "CZ_ELIGIBLE_VERIFIED";
  if (v === false) return "CZ_NOT_ELIGIBLE";
  return "CZ_UNKNOWN";
}

function feedIndexes(feedInventory) {
  const partners = new Map();
  const feedsByAdv = new Map();
  for (const p of feedInventory?.partners || []) partners.set(String(p.advertiserId), p);
  for (const f of feedInventory?.feeds || []) {
    const id = String(f.advertiserId);
    if (!feedsByAdv.has(id)) feedsByAdv.set(id, []);
    feedsByAdv.get(id).push(f);
  }
  return { partners, feedsByAdv };
}

/**
 * @param {object} input
 * @param {object} input.registry
 * @param {object} input.offersPublic
 * @param {object} [input.feedInventory]
 * @param {object} [input.missingFeed]
 * @param {Map<string,{catalog:number,published:number,blockedGrowthOnly:number,eligibleNew:number}>} [input.shardByAdv]
 * @param {object} [input.previousRegistry]
 */
export function buildJoinedPartnerReconciliation({
  registry = {},
  offersPublic = {},
  feedInventory = null,
  missingFeed = null,
  shardByAdv = null,
  previousRegistry = null,
  expectJoined = null,
} = {}) {
  const inv = buildJoinedEndedInventory({ registry, offersPublic, previousRegistry });
  const joinedSet = new Set(inv.lists.joinedIds);
  const endedSet = new Set(inv.lists.endedIds);
  const { byAdv } = indexOffersByAdvertiser(offersPublic);
  const { partners: feedPartners, feedsByAdv } = feedIndexes(feedInventory);
  const missingById = new Map((missingFeed?.partners || []).map((m) => [String(m.advertiserId), m]));
  const regById = new Map();
  for (const p of registry?.partners || []) {
    const id = idOf(p);
    if (id) regById.set(id, p);
  }
  const feedAvailable = Boolean(feedInventory);
  const shardsAvailable = shardByAdv instanceof Map && shardByAdv.size > 0;

  const rows = [];
  for (const id of sortedIds(joinedSet)) {
    const p = regById.get(id) || {};
    const o = byAdv.get(id) || null;
    const fp = feedPartners.get(id) || null;
    const feeds = feedsByAdv.get(id) || [];
    const miss = missingById.get(id) || null;
    const sh = shardsAvailable ? shardByAdv.get(id) || null : null;

    const couponsCount = o ? o.couponIds.size : 0;
    const actionsCount = o ? o.actionIds.size : 0;
    const productsCount = o ? o.productKeys.size : 0;
    const productsHeldCount = o ? o.heldProductKeys.size : 0;
    const hasOffers = couponsCount + actionsCount + productsCount > 0;

    // hasProductFeed: feed-inventory authoritative; otherwise null (never invented).
    let hasProductFeed = null;
    let hasProductFeedSource = "UNKNOWN_NO_FEED_INVENTORY";
    if (fp) {
      hasProductFeed = fp.hasFeed === true;
      hasProductFeedSource = "feed-inventory-v40";
    } else if (feedAvailable) {
      hasProductFeed = false;
      hasProductFeedSource = "feed-inventory-v40:not_listed";
    } else if (productsCount > 0) {
      hasProductFeed = true;
      hasProductFeedSource = "inferred_from_published_products";
    }

    const diagnostics = Array.isArray(p?.mainButtonReadiness?.diagnostics) ? p.mainButtonReadiness.diagnostics : [];
    const emailSourced = o ? o.emailSourcedOfferIds.size : 0;

    const mainBlockers = Array.isArray(p?.mainButtonReadiness?.blockers) ? p.mainButtonReadiness.blockers : [];
    const clickUrl = p.selectedClickUrl || null;

    let unpublishedReason = null;
    if (!hasOffers) {
      const reasons = [];
      if (p.publishability === "QUARANTINED" || p.holdReason) {
        reasons.push(`REGISTRY_${p.holdReason || p.publishability}`);
      }
      if (productsHeldCount > 0) reasons.unshift("ALL_PRODUCTS_LKG_PUBLIC_HOLD");
      if (miss) reasons.push(`FEED_${miss.excludeReason || "MISSING_FEED_PARTNER"}`);
      if (sh && sh.catalog > 0) {
        reasons.push(
          sh.blockedGrowthOnly > 0
            ? "DURABLE_CATALOG_PRESENT_GROWTH_BUDGET_DEFERRED"
            : "DURABLE_CATALOG_PRESENT_NOT_PUBLISHED",
        );
      } else if (hasProductFeed === false) {
        reasons.push("NO_PRODUCT_FEED_AND_NO_PUBLISHED_COUPON_OR_ACTION");
      } else if (hasProductFeed === true && !miss) {
        reasons.push("FEED_PRESENT_NO_DURABLE_ROWS_OR_NOT_YET_INGESTED");
      }
      if (!reasons.length) reasons.push("NO_PUBLISHED_OFFERS_NO_FURTHER_EVIDENCE");
      unpublishedReason = {
        primary: reasons[0],
        all: reasons,
        missingFeedRootCause: miss?.rootCause || null,
        missingFeedNextAction: miss?.nextAction || null,
      };
    }

    rows.push({
      advertiserId: id,
      name: p.displayNameCs || p.cjName || o?.partnerNames?.values().next().value || null,
      cjName: p.cjName || null,
      affiliateButton: {
        present: Boolean(clickUrl),
        clickUrl,
        cjTrackingUrlValid: clickUrl ? isCjTrackingUrl(clickUrl) : false,
        destination: p.selectedDestination || null,
        destinationDecision: p.destinationDecision || null,
        mainButtonStatus: p.mainButtonStatus || null,
        mainButtonReady: p.mainButtonReady === true,
        mainButtonBlockers: mainBlockers,
        buttonRecordStatus: p.buttonRecordStatus || null,
        publishability: p.publishability || null,
        publicationReady: p.publicationReady === true,
        management: p.management || null,
        sectionId: p.sectionId || null,
      },
      productsCount,
      productsHeldCount,
      couponsCount,
      actionsCount,
      placements: {
        products: o ? o.productPlacements : 0,
        coupons: o ? o.couponPlacements : 0,
        actions: o ? o.actionPlacements : 0,
      },
      hasPublishedOffers: hasOffers,
      hasProductFeed,
      hasProductFeedSource,
      feed: {
        feedCount: fp ? num(fp.feedCount) : feeds.length || null,
        declaredProductCountSum: fp ? num(fp.declaredProductCountSum) : null,
        inventoryStatus: fp?.inventoryStatus || null,
        feedLanguages: sortedIds(new Set(feeds.map((f) => f.language).filter(Boolean))),
        feedCurrencies: sortedIds(new Set(feeds.map((f) => f.currency).filter(Boolean))),
        feedCountries: sortedIds(new Set(feeds.map((f) => f.advertiserCountry).filter(Boolean))),
      },
      durableCatalog: shardsAvailable
        ? {
            catalogIdentities: sh ? sh.catalog : 0,
            published: sh ? sh.published : 0,
            blockedGrowthOnly: sh ? sh.blockedGrowthOnly : 0,
            eligibleNew: sh ? sh.eligibleNew : 0,
          }
        : { status: "ARTIFACT_MISSING_NO_SHARDS" },
      emailOffers: {
        publishedEmailSourcedOffers: emailSourced,
        welcomeEmailMissing: diagnostics.includes("MISSING_WELCOME_EMAIL"),
        emailHintsApplied: p?.mainButtonReadiness?.emailHintsApplied === true,
        authority: false,
        note: "Email/AI never authority for JOINED/ENDED; no local email-offer store was read (count = published offers whose sourceSystem is email).",
      },
      categories: {
        sectionId: p.sectionId || null,
        sectionTitleCs: p.sectionTitleCs || null,
        cjCategoryKey: p.categoryKey || null,
        merchantType: p.merchantType || null,
        primaryAssortment: p.assortmentProfile?.primaryAssortment?.sectionId || null,
        secondaryAssortment: p.assortmentProfile?.secondaryAssortment?.sectionId || null,
        publishedSectionKeys: o ? sortedIds(o.sectionKeys) : [],
      },
      localization: {
        selectedLanguage: p.selectedLanguage || null,
        languageDecision: p.languageDecision || null,
        countryDecision: p.countryDecision || null,
        targetedCountries: p.selectedTargetedCountries ?? null,
        languagePrioritySatisfied: p.languagePrioritySatisfied ?? null,
        availableLanguages: p.languageEvidence?.availableLanguages || [],
      },
      czechMarketAvailability: {
        status: deriveCzStatus(p),
        czMarketEligibilityVerified: p.czMarketEligibilityVerified ?? null,
        czShippingVerified: p.czShippingVerified ?? null,
        czBookingOrServiceVerified: p.czBookingOrServiceVerified ?? null,
        marketTargeting: p.czEvidence?.marketTargeting ?? null,
        czDomain: p.czEvidence?.czDomain ?? null,
      },
      partnershipStatus: {
        relationshipStatus: normalizeRelationshipStatus(p.relationshipStatus),
        accountStatus: p.accountStatus || null,
        joined: true,
        ended: endedSet.has(id),
        authority: "CJ_API_STAGING",
        publicPromotionAllowed: evaluatePartnerLifecyclePublicRules({
          relationshipStatus: p.relationshipStatus,
          management: p.management,
          publishability: p.publishability,
        }).publicPromotionAllowed,
      },
      unpublishedReason,
    });
  }

  const withOffers = rows.filter((r) => r.hasPublishedOffers).length;
  const summary = {
    joined: rows.length,
    expectJoined: expectJoined ?? null,
    expectJoinedMatches: expectJoined == null ? null : rows.length === Number(expectJoined),
    joinedWithOffers: withOffers,
    joinedWithoutOffers: rows.length - withOffers,
    joinedWithAnyOfferItemsIncludingHeld: rows.filter((r) => r.hasPublishedOffers || r.productsHeldCount > 0).length,
    productsHeldTotal: rows.reduce((s, r) => s + r.productsHeldCount, 0),
    joinedWithoutOffersAllHaveReason: rows.filter((r) => !r.hasPublishedOffers).every((r) => r.unpublishedReason?.primary),
    totals: {
      productsUnique: new Set(
        [...byAdv.values()].flatMap((e) => [...e.productKeys]),
      ).size,
      productsSumPerPartner: rows.reduce((s, r) => s + r.productsCount, 0),
      statsUniqueProducts: num(offersPublic?.stats?.uniqueProducts),
      productsUniqueMinusStatsUnique: new Set([...byAdv.values()].flatMap((e) => [...e.productKeys])).size - num(offersPublic?.stats?.uniqueProducts),
      productsNote: "productsCount = unique advertiserId|productId among NON-held items in offers-public sections; stats.uniqueProducts is the publisher's own counter (can differ slightly: items without LKG metadata).",
      coupons: rows.reduce((s, r) => s + r.couponsCount, 0),
      actions: rows.reduce((s, r) => s + r.actionsCount, 0),
    },
    withProductFeed: rows.filter((r) => r.hasProductFeed === true).length,
    withoutProductFeed: rows.filter((r) => r.hasProductFeed === false).length,
    productFeedUnknown: rows.filter((r) => r.hasProductFeed === null).length,
    czEligibleVerified: rows.filter((r) => r.czechMarketAvailability.status === "CZ_ELIGIBLE_VERIFIED").length,
    czUnknown: rows.filter((r) => r.czechMarketAvailability.status === "CZ_UNKNOWN").length,
    buttonsPresent: rows.filter((r) => r.affiliateButton.present).length,
    buttonsMainReady: rows.filter((r) => r.affiliateButton.mainButtonReady).length,
    unpublishedReasonPrimaryCounts: Object.fromEntries(
      [
        ...rows
          .filter((r) => r.unpublishedReason)
          .reduce((m, r) => {
            bump(m, r.unpublishedReason.primary);
            return m;
          }, new Map()),
      ].sort(),
    ),
    ended: endedSet.size,
    statsPartners: inv.denominators.statsPartners,
    statsPartnersIsNotJoined: inv.guards.joinedCountNotEqualStatsPartners,
  };

  return {
    schema: JOINED_PARTNER_RECON_SCHEMA,
    readOnly: true,
    registryGeneratedAt: registry?.generatedAt ?? null,
    offersUpdatedAt: offersPublic?.updatedAt ?? null,
    authority: inv.authority,
    summary,
    denominators: inv.denominators,
    guards: inv.guards,
    partners: rows,
  };
}

// ───────────────────────── product inventory ─────────────────────────
export function listShardFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => SHARD_FILE_RE.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Pure per-identity classifier (priority order = PRIMARY_STATE_PRIORITY). */
export function classifyIdentity(rec, ctx) {
  const key = `${rec.advertiserId}|${rec.productId}`;
  if (ctx.endedIds.has(String(rec.advertiserId))) {
    return PRIMARY_STATE.ENDED_PARTNERSHIP;
  }
  if (ctx.publishedKeys.has(key)) return PRIMARY_STATE.PUBLISHED;
  if (ctx.invalidKeys.has(key)) return PRIMARY_STATE.INVALID;
  if (ctx.heldKeys?.has(key) || rec.lkgPublicHold === true || /HOLD/.test(String(rec.publicationEligibility || ""))) return PRIMARY_STATE.HOLD;
  if (ctx.retryKeys.has(key)) return PRIMARY_STATE.RETRY;
  if (rec.freshnessStatus && rec.freshnessStatus !== "SOURCE_VERIFIED") return PRIMARY_STATE.UNAVAILABLE; // pending verification bucket
  if (!rec.title || !rec.imageUrl || rec.currentPrice == null || rec.currentPrice === "" || !rec.affiliateUrl) {
    return PRIMARY_STATE.MISSING_BUSINESS_DATA;
  }
  if (rec.publicationEligibility && rec.publicationEligibility !== "PUBLICATION_ELIGIBLE") {
    return PRIMARY_STATE.UNSUITABLE_CZ_MARKET;
  }
  if (ctx.deferredKeys) {
    return ctx.deferredKeys.has(key) ? PRIMARY_STATE.BLOCKED_GROWTH_ONLY : PRIMARY_STATE.ELIGIBLE_NEW;
  }
  return ctx.growthBudgetExhausted ? PRIMARY_STATE.BLOCKED_GROWTH_ONLY : PRIMARY_STATE.ELIGIBLE_NEW;
}

/**
 * Stream durable shards → classified JSONL (gzip). One shard in memory at a time.
 * @returns counts + per-advertiser shard summary
 */
export async function exportProductInventoryJsonl({
  shardFiles,
  outFile,
  ctx,
}) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const gz = zlib.createGzip({ level: 6 });
  const ws = fs.createWriteStream(outFile);
  gz.pipe(ws);
  const finished = once(ws, "close");

  const seen = new Set();
  const stateCounts = new Map();
  const byAdv = new Map();
  let sourceRows = 0;
  let duplicates = 0;
  let identityCollisions = 0;
  let pendingVerification = 0;
  let nonCzk = 0;
  let notInJoinedSet = 0;
  const shardInfo = [];
  const publishedInShards = new Set();

  for (const file of shardFiles) {
    const shard = readJson(file);
    const products = shard?.products && typeof shard.products === "object" ? shard.products : {};
    let n = 0;
    let buf = [];
    for (const [k, rec] of Object.entries(products)) {
      sourceRows += 1;
      n += 1;
      const key = `${rec.advertiserId}|${rec.productId}`;
      if (k !== key) identityCollisions += 1;
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      const state = classifyIdentity(rec, ctx);
      bump(stateCounts, state);
      if (rec.freshnessStatus && rec.freshnessStatus !== "SOURCE_VERIFIED") pendingVerification += 1;
      if (rec.currency && rec.currency !== "CZK") nonCzk += 1;
      if (ctx.joinedIds.size > 0 && !ctx.joinedIds.has(String(rec.advertiserId))) notInJoinedSet += 1;
      if (state === PRIMARY_STATE.PUBLISHED) publishedInShards.add(key);
      const adv = String(rec.advertiserId);
      if (!byAdv.has(adv)) byAdv.set(adv, { catalog: 0, published: 0, blockedGrowthOnly: 0, eligibleNew: 0 });
      const a = byAdv.get(adv);
      a.catalog += 1;
      if (state === PRIMARY_STATE.PUBLISHED) a.published += 1;
      if (state === PRIMARY_STATE.BLOCKED_GROWTH_ONLY) a.blockedGrowthOnly += 1;
      if (state === PRIMARY_STATE.ELIGIBLE_NEW) a.eligibleNew += 1;
      buf.push(
        JSON.stringify({
          key,
          advertiserId: adv,
          productId: String(rec.productId),
          primaryState: state,
          sectionKey: rec.sectionKey ?? null,
          currency: rec.currency ?? null,
          availabilityClass: rec.availabilityClass ?? null,
          freshnessStatus: rec.freshnessStatus ?? null,
          shard: path.basename(file).replace(/^.*-(s\d+)\.json$/, "$1"),
        }),
      );
      if (buf.length >= 2000) {
        if (!gz.write(buf.join("\n") + "\n")) await once(gz, "drain");
        buf = [];
      }
    }
    if (buf.length) {
      if (!gz.write(buf.join("\n") + "\n")) await once(gz, "drain");
    }
    shardInfo.push({ file: path.basename(file), declaredProductCount: shard?.productCount ?? null, rows: n });
  }
  gz.end();
  await finished;

  const outBytes = fs.statSync(outFile).size;
  return {
    sourceRows,
    uniqueCompositeIds: seen.size,
    duplicates,
    identityCollisions,
    pendingVerification,
    nonCzkCurrencyInformational: nonCzk,
    identitiesOfAdvertisersNotInJoinedSet: notInJoinedSet,
    countsByPrimaryState: Object.fromEntries(
      PRIMARY_STATE_PRIORITY.map((s) => [s, stateCounts.get(s) || 0]),
    ),
    publishedInShards: publishedInShards.size,
    shardInfo,
    byAdv,
    jsonl: { file: outFile, bytes: outBytes, lines: seen.size },
  };
}

function loadDeferredKeys(ledgerPath) {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return null;
  const l = readJson(ledgerPath);
  const keys = Array.isArray(l.keys) ? l.keys : (l.entries || []).map((e) => e.key);
  return { keys: new Set(keys.map(String)), meta: { updatedAt: l.updatedAt ?? null, deferredNewCount: l.deferredNewCount ?? null, evidenceCompleteness: l.evidenceCompleteness ?? null } };
}

function loadRetryAndInvalid(queuePath) {
  const retryKeys = new Set();
  const invalidKeys = new Set();
  if (!queuePath || !fs.existsSync(queuePath)) return { retryKeys, invalidKeys, present: false };
  const q = readJson(queuePath);
  for (const it of Object.values(q.items || {})) {
    if (it.status === "RETRY_SCHEDULED" && it.closed !== true) retryKeys.add(String(it.key));
    else if (it.status === "INVALID_DATA") invalidKeys.add(String(it.key));
  }
  return { retryKeys, invalidKeys, present: true };
}

/**
 * Aggregate balance from offers.publicGrowthBudget + stats (authoritative current counters),
 * through the existing product-inventory-balance module.
 */
export function buildAggregateBalance({ offersPublic, shardResult = null, runLevelRetry = null, runLevelInvalid = null }) {
  const stats = offersPublic?.stats || {};
  const budget = offersPublic?.publicGrowthBudget || {};
  const balance = buildProductInventoryBalance({
    uniquePublished: stats.uniqueProducts,
    uniquePublicEligible: stats.uniquePublicEligible,
    deferredNew: budget.deferredNew,
    holdCount: stats.lkgPublicHoldProducts,
    lkgCarried: stats.lkgCarriedProducts,
    invalidData: runLevelInvalid ?? 0,
    retryScheduled: runLevelRetry ?? 0,
    refreshed: 0,
    technicalFailure: 0,
    newCandidates: budget.newCandidates,
    growthRemaining: budget.cumulativeRemaining,
    uncappedMode: budget.uncappedMode === true,
  });
  return balance;
}

// ───────────────────────── ENDED longitudinal proof (fixture-based) ─────────────────────────
export function buildEndedLongitudinalProof({ observedPrevious = [] } = {}) {
  const mk = (id, rel) => ({ advertiserId: String(id), relationshipStatus: rel });
  const offersPublic = {
    sections: [{ coupons: [{ advertiserId: "1001" }] }, { actions: [{ advertiserId: "1002" }] }],
    stats: { partners: 2, advertisersWithOffers: 2 },
  };
  const t0 = { stagingMeta: { sourceKind: "cj_api_xml" }, generatedAt: "FIXTURE-T0", partners: [mk(1001, "joined"), mk(1002, "joined"), mk(1003, "joined")] };
  const t1 = { stagingMeta: { sourceKind: "cj_api_xml" }, generatedAt: "FIXTURE-T1", partners: [mk(1001, "joined"), mk(1002, "joined")] };
  const t2 = { stagingMeta: { sourceKind: "cj_api_xml" }, generatedAt: "FIXTURE-T2", partners: [mk(1001, "joined"), mk(1002, "joined"), mk(1003, "joined")] };

  const scenarios = [];
  const add = (name, ok, detail) => scenarios.push({ name, ok: ok === true, detail });

  const d1 = buildJoinedEndedInventory({ registry: t1, offersPublic, previousRegistry: t0 });
  add("T0->T1_joined_to_absent_is_ENDED", d1.lists.endedIds.join(",") === "1003" && d1.denominators.joined === 2 && d1.denominators.ended === 1, d1.denominators);
  const tr = classifyPartnerLifecycleTransition("joined", "ended");
  const rules = evaluatePartnerLifecyclePublicRules({ relationshipStatus: "ended" });
  add("ENDED_blocks_public_promotion", tr.transition === "ENDED" && tr.promoteAllowed === false && rules.publicPromotionAllowed === false, { tr, rules });

  const d2 = buildJoinedEndedInventory({ registry: t2, offersPublic, previousRegistry: t1 });
  const rj = classifyPartnerLifecycleTransition("ended", "joined");
  add("T1->T2_rejoin_restores_JOINED", d2.denominators.joined === 3 && d2.denominators.ended === 0 && rj.transition === "REJOINED" && rj.promoteAllowed === true, { denominators: d2.denominators, rj });

  const apiDownSample = [{ advertiserId: "1003", reason: "CJ_API_DOWN", inferredEnded: true }];
  const dFp = buildJoinedEndedInventory({ registry: t1, offersPublic, previousRegistry: t0, endedSample: apiDownSample });
  add("CJ_API_DOWN_never_yields_ENDED", isEndedApiDownFalsePositive(apiDownSample) === true && dFp.lists.endedIds.length === 0 && dFp.ended.diffSkippedReason === "cj_api_down_false_positive", dFp.ended);

  const dNoPrev = buildJoinedEndedInventory({ registry: t1, offersPublic, previousRegistry: null });
  add("no_previous_registry_yields_ended_0", dNoPrev.denominators.ended === 0 && dNoPrev.ended.diffSkippedReason === "no_previous_registry", dNoPrev.ended);

  const dIncomplete = buildJoinedEndedInventory({ registry: t1, offersPublic, previousRegistry: t0, currentFetchComplete: false });
  add("incomplete_fetch_never_yields_ENDED", dIncomplete.lists.endedIds.length === 0 && dIncomplete.ended.diffSkippedReason === "current_fetch_incomplete_or_not_cj_authoritative", dIncomplete.ended);

  const dFixtureNonCj = buildJoinedEndedInventory({ registry: { ...t1, stagingMeta: { sourceKind: "email" } }, offersPublic, previousRegistry: t0 });
  add("non_cj_authority_never_yields_ENDED", dFixtureNonCj.lists.endedIds.length === 0, dFixtureNonCj.ended);

  const failed = scenarios.filter((s) => !s.ok).map((s) => s.name);
  return {
    schema: ENDED_LONGITUDINAL_PROOF_SCHEMA,
    evidenceClass: "FIXTURE_MECHANISM_PROOF",
    productionEndedEventClaimed: false,
    claim:
      "Mechanism proof only (fixtures T0/T1/T2). NO production ENDED event is claimed. Production ENDED requires a previous CJ-authoritative registry + a COMPLETE CJ fetch in which the previously JOINED advertiser is absent/ended.",
    modulesUsed: [
      "scripts/iu-cj-affiliate-joined-ended-inventory-v1.mjs",
      "scripts/iu-cj-affiliate-phase3z-partner-lifecycle-v51-8.mjs",
      "scripts/iu-cj-affiliate-phase3z-partner-lifecycle-audit-v51-8.mjs",
    ],
    ok: failed.length === 0,
    failed,
    scenarios,
    productionObservation: {
      note: "Informational JOINED-set diffs against older local registry snapshots; NOT ENDED declarations (staging registries are JOINED-only, no completeness proof for older snapshots).",
      snapshots: observedPrevious,
    },
  };
}

/** JOINED-set diff of the current registry vs an older registry (informational). */
export function diffJoinedSets(currentRegistry, olderRegistry, label) {
  const joined = (r) =>
    new Set(
      (r?.partners || [])
        .filter((p) => normalizeRelationshipStatus(p.relationshipStatus) === "joined")
        .map(idOf)
        .filter(Boolean),
    );
  const cur = joined(currentRegistry);
  const old = joined(olderRegistry);
  return {
    label,
    olderGeneratedAt: olderRegistry?.generatedAt ?? null,
    olderJoined: old.size,
    currentJoined: cur.size,
    absentNowButJoinedBefore: sortedIds([...old].filter((x) => !cur.has(x))),
    newlyJoined: sortedIds([...cur].filter((x) => !old.has(x))),
    productionEndedEventClaimed: false,
  };
}

// ───────────────────────── orchestration ─────────────────────────
export async function runExport(opts) {
  const outDir = assertOutsideRepo(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const registryPath = opts.registry || DEFAULT_REGISTRY;
  const offersPath = opts.offers || DEFAULT_OFFERS;
  const registry = readJson(registryPath);
  const offersPublic = readJson(offersPath);
  const feedInventory = opts.feedInventory && fs.existsSync(opts.feedInventory) ? readJson(opts.feedInventory) : null;
  const missingFeed = opts.missingFeed && fs.existsSync(opts.missingFeed) ? readJson(opts.missingFeed) : null;

  const inv = buildJoinedEndedInventory({ registry, offersPublic });
  const joinedIds = new Set(inv.lists.joinedIds);
  const endedIds = new Set(inv.lists.endedIds);
  const { publishedKeys, heldKeys } = indexOffersByAdvertiser(offersPublic);
  const budget = offersPublic?.publicGrowthBudget || {};

  // product inventory (durable shards)
  const shardFiles = listShardFiles(opts.shardDir);
  const retry = loadRetryAndInvalid(opts.retryQueue);
  const deferred = loadDeferredKeys(opts.deferredLedger);
  let shardResult = null;
  const jsonlFile = path.join(outDir, "PRODUCT_INVENTORY_IDENTITIES.jsonl.gz");
  if (shardFiles.length > 0) {
    shardResult = await exportProductInventoryJsonl({
      shardFiles,
      outFile: jsonlFile,
      ctx: {
        joinedIds,
        endedIds,
        publishedKeys,
        heldKeys,
        invalidKeys: retry.invalidKeys,
        retryKeys: retry.retryKeys,
        deferredKeys: deferred ? deferred.keys : null,
        growthBudgetExhausted: num(budget.allowedNew) === 0 && num(budget.cumulativeRemaining) === 0,
      },
    });
  }

  const recon = buildJoinedPartnerReconciliation({
    registry,
    offersPublic,
    feedInventory,
    missingFeed,
    shardByAdv: shardResult ? shardResult.byAdv : null,
    expectJoined: opts.expectJoined ?? null,
  });
  recon.provenance = {
    registry: { path: registryPath, sha256: sha256File(registryPath), generatedAt: registry.generatedAt ?? null },
    offers: { path: offersPath, sha256: sha256File(offersPath), updatedAt: offersPublic.updatedAt ?? null },
    feedInventory: feedInventory ? { path: opts.feedInventory, at: feedInventory.at ?? null } : "ARTIFACT_MISSING",
    missingFeedPartners: missingFeed ? { path: opts.missingFeed, at: missingFeed.at ?? null } : "ARTIFACT_MISSING",
    durableShards: shardResult ? { dir: opts.shardDir, files: shardFiles.length } : "ARTIFACT_MISSING",
  };
  const reconPath = path.join(outDir, "FULL_JOINED_PARTNER_RECONCILIATION.json");
  fs.writeFileSync(reconPath, JSON.stringify(recon, null, 2) + "\n", "utf8");

  // aggregate balance (authoritative = offers.publicGrowthBudget + stats; shards = evidence)
  const stats = offersPublic?.stats || {};
  const balance = buildAggregateBalance({
    offersPublic,
    runLevelRetry: retry.present ? retry.retryKeys.size : 0,
    runLevelInvalid: retry.present ? retry.invalidKeys.size : 0,
  });
  const rejects = offersPublic?.rejectReasons || {};
  const aggregate = {
    schema: PRODUCT_INVENTORY_AGGREGATE_SCHEMA,
    readOnly: true,
    offersUpdatedAt: offersPublic.updatedAt ?? null,
    snapshotId: offersPublic.snapshotId ?? null,
    status: shardResult ? "SHARDS_PRESENT" : "EXTERNAL_BLOCKED_ARTIFACT_MISSING",
    authoritativeCounts: {
      source: "offers-public stats + publicGrowthBudget (current published snapshot)",
      uniquePublished: num(stats.uniqueProducts),
      uniquePublicEligible: num(stats.uniquePublicEligible),
      blockedGrowthOnly: num(budget.deferredNew),
      newCandidates: num(budget.newCandidates),
      eligibleNew: Math.max(0, num(budget.newCandidates) - num(budget.deferredNew)),
      hold: num(stats.lkgPublicHoldProducts),
      lkgCarried: num(stats.lkgCarriedProducts),
      retry: retry.present ? retry.retryKeys.size : null,
      invalid: retry.present ? retry.invalidKeys.size : null,
      endedPartners: inv.denominators.ended,
      growthGate: { uncappedMode: budget.uncappedMode === true, cumulativeRemaining: num(budget.cumulativeRemaining), allowedNew: num(budget.allowedNew) },
    },
    runLevelRejectsBeforeCatalog: {
      note: "Last-run rejects before the durable catalog (NOT part of the identity partition; informational).",
      unsuitableCz: num(rejects.market_not_targeting_cz),
      incompleteBusiness: num(rejects.incomplete_fields) + num(rejects.missing_https_image),
      duplicateProduct: num(rejects.duplicate_product),
      outOfStock: num(rejects.availability_out_of_stock),
      raw: rejects,
    },
    balance,
    mathBalance: balance.mathBalance,
  };
  if (shardResult) {
    const c = shardResult.countsByPrimaryState;
    const upstream = shardResult.shardInfo.length ? readUpstreamMerge(opts.shardDir) : null;
    aggregate.shardEvidence = {
      shardDir: opts.shardDir,
      shardFiles: shardFiles.length,
      shardInfo: shardResult.shardInfo,
      sourceRows: shardResult.sourceRows,
      uniqueCompositeIds: shardResult.uniqueCompositeIds,
      duplicates: shardResult.duplicates,
      upstreamSourceUpsertedRows: upstream?.sourceUpserted ?? null,
      upstreamDuplicatesDeduped: upstream ? Math.max(0, upstream.sourceUpserted - upstream.seenCount) : null,
      published: c.published,
      eligibleNew: c.eligible_new,
      blockedGrowthOnly: c.blocked_growth_only,
      hold: c.hold,
      retry: c.retry,
      invalid: c.invalid,
      identityCollisions: shardResult.identityCollisions,
      unsuitableCz: c.unsuitable_cz_market,
      incompleteBusiness: c.missing_business_data,
      pendingVerification: shardResult.pendingVerification,
      endedPartners: c.ended_partnership,
      nonCzkCurrencyInformational: shardResult.nonCzkCurrencyInformational,
      identitiesOfAdvertisersNotInJoinedSet: shardResult.identitiesOfAdvertisersNotInJoinedSet,
      countsByPrimaryState: c,
      exclusiveSum: Object.values(c).reduce((s, v) => s + v, 0),
      exclusiveSumEqualsUniqueIdentities: Object.values(c).reduce((s, v) => s + v, 0) === shardResult.uniqueCompositeIds,
      deferredLedger: deferred ? deferred.meta : "ARTIFACT_MISSING",
      jsonl: shardResult.jsonl,
      eligibleNewShardDerivedMeaning:
        "Shard identities that are PUBLICATION_ELIGIBLE but neither in the current published set nor in the (older) deferred-new ledger = durable-vs-ledger snapshot gap (ledger itself documents an expected small gap). NOT a growth-ready claim: authoritative eligibleNew = newCandidates - deferredNew (budget exhausted, allowedNew=0).",
      snapshotCaveat:
        "Shards are a durable-catalog snapshot (see durable catalog index updatedAt) and may be OLDER than offers-public; authoritativeCounts is the current published truth. Deltas are expected and reported, never reconciled by guessing.",
    };
    const sh = aggregate.shardEvidence;
    aggregate.deltaShardVsAuthoritative = {
      blockedGrowthOnly: sh.blockedGrowthOnly - aggregate.authoritativeCounts.blockedGrowthOnly,
      published: sh.published - aggregate.authoritativeCounts.uniquePublished,
    };
  } else {
    aggregate.EXTERNAL_BLOCKED = {
      code: "ARTIFACT_MISSING",
      reason: "Durable catalog shards not found locally; per-identity JSONL not produced. Aggregate computed from offers.publicGrowthBudget + stats only.",
      searched: opts.shardDir || "(no --shard-dir given)",
      expectedPaths: EXPECTED_ARTIFACT_PATHS,
    };
  }
  const aggPath = path.join(outDir, "PRODUCT_INVENTORY_BALANCE_AGGREGATE.json");
  fs.writeFileSync(aggPath, JSON.stringify(aggregate, null, 2) + "\n", "utf8");

  // ENDED proof
  const observed = [];
  for (const prev of opts.previousRegistries || []) {
    try {
      observed.push(diffJoinedSets(registry, readJson(prev), prev));
    } catch (e) {
      observed.push({ label: prev, error: String(e?.message || e) });
    }
  }
  const proof = buildEndedLongitudinalProof({ observedPrevious: observed });
  const proofPath = path.join(outDir, "ENDED_LONGITUDINAL_PROOF.json");
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + "\n", "utf8");

  return { reconPath, aggPath, proofPath, jsonlFile: shardResult ? jsonlFile : null, recon, aggregate, proof };
}

function readUpstreamMerge(shardDir) {
  try {
    const idx = readJson(path.join(shardDir, "iu-affiliate-cj-durable-catalog-v51.json"));
    return { sourceUpserted: num(idx?.lastMerge?.sourceUpserted), seenCount: num(idx?.lastMerge?.seenCount), updatedAt: idx?.updatedAt ?? null };
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const o = { previousRegistries: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    const map = {
      "--out-dir": "outDir",
      "--registry": "registry",
      "--offers": "offers",
      "--feed-inventory": "feedInventory",
      "--missing-feed": "missingFeed",
      "--shard-dir": "shardDir",
      "--deferred-ledger": "deferredLedger",
      "--retry-queue": "retryQueue",
      "--expect-joined": "expectJoined",
    };
    if (map[a]) {
      o[map[a]] = v;
      i++;
    } else if (a === "--previous-registry") {
      o.previousRegistries.push(v);
      i++;
    }
  }
  return o;
}

function isDirectRun() {
  const arg = process.argv[1];
  return Boolean(arg) && path.resolve(arg) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  const o = parseArgs(process.argv.slice(2));
  if (!o.outDir) {
    console.error("REFUSED: --out-dir <dir outside repo> is required.");
    process.exit(2);
  }
  try {
    const r = await runExport(o);
    const s = r.recon.summary;
    const a = r.aggregate;
    console.log(
      JSON.stringify(
        {
          IU_CJ_JOINED_PARTNER_RECON_EXPORT: "DONE",
          paths: { recon: r.reconPath, aggregate: r.aggPath, endedProof: r.proofPath, jsonl: r.jsonlFile },
          joined: s.joined,
          joinedWithOffers: s.joinedWithOffers,
          joinedWithoutOffers: s.joinedWithoutOffers,
          status: a.status,
          authoritativeCounts: a.authoritativeCounts,
          shardEvidence: a.shardEvidence ? { ...a.shardEvidence, shardInfo: undefined, countsByPrimaryState: a.shardEvidence.countsByPrimaryState } : null,
          endedProofOk: r.proof.ok,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(String(e?.message || e));
    process.exit(2);
  }
}

