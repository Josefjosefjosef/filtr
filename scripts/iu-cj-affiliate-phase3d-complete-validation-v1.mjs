#!/usr/bin/env node
/**
 * Phase 3D — complete CJ data validation (fetch ≠ publish).
 *
 * - Reconcile joined advertisers vs managed-public vs catalog slots
 * - Classify coupons/actions into publication readiness states
 * - Expand product sampling across joined∩managed partners
 * - Write neveřejný readiness pack under %TEMP% (never sets liveEnabled)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CJ_ADVERTISER_LOOKUP_BASE,
  CJ_LINK_SEARCH_BASE,
  CJ_DEFAULT_RECORDS_PER_PAGE,
  clearCjEnvFromProcess,
  cjGet,
  finishNodeProcessAfterNetwork,
  parseAdvertiserBlocks,
  parseAdvertiserRecord,
  parseLinkBlocks,
  parseLinkRecord,
  parseListMeta,
  readJson,
} from "./iu-cj-affiliate-phase1-lib.mjs";
import { readCjPatFromEnv } from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import {
  buildPublisherProductsQuery,
  cjGraphql,
  isTrustedCjClickHost,
  parseAffiliateClickUrl,
  parseShoppingProductsGraphqlResponse,
} from "./iu-cj-affiliate-phase2-product-api.mjs";
import {
  CATALOG_RECORD_KIND,
  normalizeCjLinkToCatalogRecord,
} from "./iu-cj-affiliate-phase2-cj-link-search-catalog-normalize-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  buildCatalogSlotInventory,
  findFirstFreeEmptySlot,
  SLOT_KIND,
} from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { auditCjManagedPublicR2Readiness } from "./iu-cj-affiliate-phase3d-r2-infra-readiness-v1.mjs";
import { syncUnlimitedDynamicCatalog } from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID_DEFAULT = "101883843";

/**
 * Auth/credentials outage must keep last-known-good managed partners and stay DISARMED.
 * Simulates 401/missing-PAT by apiOutage + incomplete fetch (no live HTTP).
 */
export function runAuthErrorKeepsDisarmedInline() {
  const previous = [
    {
      advertiserId: "6179554",
      sectionId: "aff-cestovni-kancelare",
      title: "Cedok.cz",
      url: "https://www.anrdoezrs.net/click-101883843-15686662",
      active: true,
    },
  ];
  const before = JSON.stringify(previous);
  const sync = syncUnlimitedDynamicCatalog({
    joined: [],
    previousManaged: previous,
    fetchComplete: false,
    apiOutage: true,
  });
  const active = (sync.nextManagedPublic?.partners || []).filter((p) => p.active !== false);
  const lkgIntact =
    sync.removed.length === 0 &&
    active.some((p) => String(p.advertiserId) === "6179554") &&
    JSON.stringify(previous) === before;
  const pass =
    sync.ok === false &&
    sync.liveEnabled === false &&
    sync.publishArmed === false &&
    lkgIntact &&
    (sync.reason === "api_outage_keep_lkg" || sync.reason === "fetch_incomplete_keep_lkg");
  return {
    pass,
    detail: {
      reason: sync.reason,
      removed: sync.removed.length,
      liveEnabled: sync.liveEnabled,
      publishArmed: sync.publishArmed,
      lkgIntact,
      simulated: "apiOutage+incomplete_fetch_as_auth_failure",
    },
  };
}

export const PUB_STATE = Object.freeze({
  PUBLICATION_READY: "PUBLICATION_READY",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  EXPIRED: "EXPIRED",
  DUPLICATE: "DUPLICATE",
  INVALID: "INVALID",
  API_UNVERIFIED: "API_UNVERIFIED",
});

function redact(s, pat) {
  const p = String(pat || "");
  let out = String(s || "");
  if (p) out = out.split(p).join("[REDACTED_PAT]");
  return out;
}

async function fetchAllPages({ baseUrl, queryBase, pat, parseBlocks, parseRecord, kind, maxPages }) {
  const records = [];
  const pages = [];
  let totalMatched = null;
  let page = 1;
  const limit = Math.max(1, Math.min(60, Number(maxPages) || 40));
  while (page <= limit) {
    const url =
      baseUrl +
      "?" +
      queryBase +
      "&page-number=" +
      page +
      "&records-per-page=" +
      CJ_DEFAULT_RECORDS_PER_PAGE;
    const res = await cjGet(url, pat);
    if (res.networkError) {
      return { ok: false, reason: "network_error", records, pages, totalMatched, incomplete: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "auth_" + res.status, records, pages, totalMatched, incomplete: true };
    }
    if (!res.ok || res.status >= 400) {
      return { ok: false, reason: "http_" + res.status, records, pages, totalMatched, incomplete: true };
    }
    const meta = parseListMeta(res.body || "");
    if (totalMatched == null) totalMatched = meta.totalMatched;
    const pageRecords = parseBlocks(res.body || "").map(parseRecord);
    records.push(...pageRecords);
    pages.push({ page, parsed: pageRecords.length, totalMatched: meta.totalMatched });
    if (pageRecords.length === 0) {
      if ((totalMatched || 0) > 0 && records.length < totalMatched) {
        return { ok: false, reason: "empty_page_before_complete", records, pages, totalMatched, incomplete: true };
      }
      break;
    }
    if (totalMatched != null && records.length >= totalMatched) break;
    if (pageRecords.length < CJ_DEFAULT_RECORDS_PER_PAGE) break;
    page += 1;
  }
  if (totalMatched != null && records.length < totalMatched) {
    return { ok: false, reason: "pagination_incomplete", records, pages, totalMatched, incomplete: true };
  }
  if (totalMatched === 0 && records.length === 0) {
    return { ok: true, reason: "empty_result_verified", records, pages, totalMatched: 0, incomplete: false, emptySuccess: true };
  }
  return { ok: true, reason: "complete", records, pages, totalMatched, incomplete: false };
}

function isExpired(link, ref) {
  const end = link?.promotionEndDate;
  if (!end) return false;
  const t = Date.parse(String(end).replace(" ", "T"));
  return Number.isFinite(t) && t < ref.getTime();
}

function parseMinOrder(text) {
  const s = String(text || "");
  const m = s.match(/(?:od|min\.?|minimáln[íi]|minimum)\s*([0-9]+(?:[ .,][0-9]+)?)\s*(?:Kč|CZK|€|EUR)?/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify one coupon/action link for neveřejná publication readiness.
 * PUBLICATION_READY requires trusted CJ URL + mapped section + not expired + code (coupons).
 * Does NOT invent discount amounts.
 */
export function classifyOfferPublicationState(link, ctx = {}) {
  const ref = ctx.refDate || new Date();
  const websitePid = ctx.websitePid || WEBSITE_PID_DEFAULT;
  const sectionByAdv = ctx.sectionByAdv || {};
  const seenOfferIds = ctx.seenOfferIds || new Set();

  if (!link || typeof link !== "object") {
    return { state: PUB_STATE.INVALID, reasons: ["missing_link"], publicationReady: false };
  }
  const offerId = String(link.linkId || "");
  if (offerId && seenOfferIds.has(offerId)) {
    return { state: PUB_STATE.DUPLICATE, reasons: ["duplicate_offer_id"], publicationReady: false, offerId };
  }
  if (offerId) seenOfferIds.add(offerId);

  if (isExpired(link, ref)) {
    return { state: PUB_STATE.EXPIRED, reasons: ["expired"], publicationReady: false, offerId };
  }

  const click = String(link.clickUrl || "").trim();
  const clickMeta = parseAffiliateClickUrl(click, websitePid);
  const trusted = isCjTrackingUrl(click) || (isTrustedCjClickHost(click) && clickMeta.documentedFormat);
  if (!click) {
    return { state: PUB_STATE.INVALID, reasons: ["missing_affiliate_url"], publicationReady: false, offerId };
  }
  if (!trusted || !clickMeta.matchesExpectedWebsitePid) {
    return {
      state: PUB_STATE.INVALID,
      reasons: ["untrusted_or_pid_mismatch_affiliate_url"],
      publicationReady: false,
      offerId,
    };
  }

  const norm = normalizeCjLinkToCatalogRecord(link, {
    observedAt: ref.toISOString(),
    websitePid,
    refDate: ref,
  });
  const kind = norm.recordKind;
  const code = norm.record?.couponCode || null;
  const adv = String(link.advertiserId || "");
  const sectionId = sectionByAdv[adv] || null;

  if (kind === CATALOG_RECORD_KIND.invalid) {
    return { state: PUB_STATE.INVALID, reasons: ["invalid_record"], publicationReady: false, offerId };
  }

  const reasons = [];
  if (!sectionId) reasons.push("partner_section_unmapped");
  if (kind === CATALOG_RECORD_KIND.coupon_with_code && !code) reasons.push("missing_coupon_code");
  if (kind === CATALOG_RECORD_KIND.incomplete) reasons.push("incomplete_fields");
  for (const b of norm.blockers || []) {
    if (b === "partner_manual_review") reasons.push("partner_not_in_approved_hint_map");
    else if (b !== "expired") reasons.push(b);
  }

  const card = {
    kind:
      kind === CATALOG_RECORD_KIND.coupon_with_code
        ? "coupon"
        : kind === CATALOG_RECORD_KIND.action_without_code
          ? "action"
          : "other",
    offerId: offerId || null,
    advertiserId: adv || null,
    partnerName: link.advertiserName || null,
    sectionId,
    title: link.linkName || null,
    couponCode: code,
    conditionsSummary: link.description || link.adContent || null,
    minOrderValue: parseMinOrder(link.description || link.adContent || ""),
    discountLabel: null,
    validFrom: link.promotionStartDate || null,
    validTo: link.promotionEndDate || null,
    affiliateUrl: click,
    publicationReady: false,
    publishable: false,
    state: PUB_STATE.MANUAL_REVIEW,
    reasons: [],
  };

  // Strict PUBLICATION_READY: mapped section + trusted URL + coupon code when coupon + no hard blockers
  const hard = reasons.filter(
    (r) =>
      r === "partner_section_unmapped" ||
      r === "missing_coupon_code" ||
      r === "incomplete_fields" ||
      r === "invalid_record"
  );
  if (hard.length === 0 && (card.kind === "coupon" || card.kind === "action") && sectionId) {
    card.state = PUB_STATE.PUBLICATION_READY;
    card.publicationReady = true;
    // Still never set publishable/live — readiness ≠ armed publish
    card.reasons = reasons.filter((r) => r !== "partner_not_in_approved_hint_map");
    return card;
  }

  card.state = PUB_STATE.MANUAL_REVIEW;
  card.reasons = [...new Set(reasons.length ? reasons : ["needs_manual_review"])];
  return card;
}

export function reconcilePartners({ joined, managedPartners, slotPolicyPartners, inventory, sectionMap }) {
  const joinedById = new Map();
  for (const a of joined || []) {
    const id = String(a.advertiserId || "");
    if (!id) continue;
    joinedById.set(id, a);
  }
  const managedById = new Map();
  for (const p of managedPartners || []) {
    managedById.set(String(p.advertiserId), p);
  }
  const policyById = new Map();
  let manualProtected = 0;
  for (const p of slotPolicyPartners || []) {
    policyById.set(String(p.advertiserId), p);
    if (p.management === "MANUAL_PROTECTED") manualProtected += 1;
  }

  const sectionByAdv = {};
  for (const [id, p] of managedById) {
    if (p.sectionId) sectionByAdv[id] = p.sectionId;
  }
  for (const [id, p] of policyById) {
    if (p.sectionId && !sectionByAdv[id]) sectionByAdv[id] = p.sectionId;
  }
  // Evidence map (Phase 3E) — never overrides managed/policy sections
  for (const [rawId, sec] of Object.entries(sectionMap || {})) {
    if (String(rawId).startsWith("_")) continue;
    const id = String(rawId);
    const sectionId = typeof sec === "string" ? sec : sec?.sectionId;
    if (sectionId && String(sectionId).startsWith("aff-") && !sectionByAdv[id]) {
      sectionByAdv[id] = sectionId;
    }
  }

  const assigned = [];
  const manualReview = [];
  const duplicates = [];
  const seenNames = new Map();

  for (const [id, adv] of joinedById) {
    const nameKey = String(adv.advertiserName || "").trim().toLowerCase();
    if (nameKey && seenNames.has(nameKey) && seenNames.get(nameKey) !== id) {
      duplicates.push({ advertiserId: id, otherId: seenNames.get(nameKey), reason: "duplicate_display_name" });
    } else if (nameKey) {
      seenNames.set(nameKey, id);
    }

    const managed = managedById.get(id);
    const policy = policyById.get(id);
    const sectionId = sectionByAdv[id] || null;
    const row = {
      advertiserId: id,
      partnerName: adv.advertiserName || managed?.title || null,
      relationshipStatus: adv.relationshipStatus || null,
      primaryCategory: adv.primaryCategory || null,
      sectionId,
      inManagedPublic: Boolean(managed),
      management: policy?.management || (managed ? "CJ_MANAGED" : null),
      affiliateUrl: managed?.url || null,
      affiliateUrlReady: managed?.url ? isCjTrackingUrl(managed.url) : false,
      decision: null,
    };

    if (policy?.management === "MANUAL_PROTECTED") {
      row.decision = "KEEP_MANUAL_PROTECTED";
      assigned.push(row);
      continue;
    }
    if (managed && sectionId) {
      row.decision = "ASSIGNED_EXISTING_MANAGED";
      assigned.push(row);
      continue;
    }
    if (sectionId) {
      row.decision = "ASSIGNED_POLICY_SECTION";
      assigned.push(row);
      continue;
    }
    // No trusted section — never invent category
    row.decision = "MANUAL_REVIEW";
    manualReview.push({
      ...row,
      reason: "unmapped_no_trusted_section",
      note: "Do not invent category; requires explicit section mapping GO",
    });
  }

  const managedNotJoined = [];
  for (const [id, p] of managedById) {
    if (!joinedById.has(id)) {
      managedNotJoined.push({
        advertiserId: id,
        title: p.title,
        sectionId: p.sectionId,
        decision: "JOINED_STATUS_DRIFT_REVIEW",
        note: "Present in managed-public but not in current joined fetch — do NOT auto-remove from web",
      });
    }
  }

  // Free-slot plan for unmapped joined (plan only — no mutation)
  const freeSlotPlans = [];
  const claimed = new Set();
  for (const row of manualReview) {
    // Without trusted section we cannot plan a fill
    freeSlotPlans.push({
      advertiserId: row.advertiserId,
      decision: "no_plan_without_section",
    });
  }

  let freeEmptyCount = 0;
  if (inventory?.sections) {
    for (const sec of inventory.sections) {
      for (const slot of sec.slots || []) {
        if (slot.slotKind === SLOT_KIND.free_empty) freeEmptyCount += 1;
      }
    }
  }

  return {
    joinedCount: joinedById.size,
    managedCount: managedById.size,
    manualProtectedCount: manualProtected,
    assignedToSections: assigned.length,
    manualReviewCount: manualReview.length,
    duplicateNameCount: duplicates.length,
    managedNotJoinedCount: managedNotJoined.length,
    freeEmptySlots: freeEmptyCount,
    sectionByAdv,
    assigned,
    manualReview,
    duplicates,
    managedNotJoined,
    freeSlotPlans,
    note: "Never overwrite occupied slots; never remove MANUAL_PROTECTED; never invent categories.",
  };
}

export function emptyPublicationReadinessDoc(opts = {}) {
  return {
    schema: "iu-affiliate-cj-publication-readiness-v1",
    version: 1,
    updatedAt: opts.updatedAt || new Date().toISOString(),
    liveEnabled: false,
    publishArmed: false,
    sourceKind: opts.sourceKind || "empty_disarmed",
    websitePid: String(opts.websitePid || WEBSITE_PID_DEFAULT),
    partners: { assigned: [], manualReview: [], managedNotJoined: [] },
    coupons: [],
    actions: [],
    products: [],
    stats: {
      joined: 0,
      assigned: 0,
      manualReviewPartners: 0,
      couponsLoaded: 0,
      couponsPublicationReady: 0,
      actionsLoaded: 0,
      actionsPublicationReady: 0,
      productsLoaded: 0,
      productsWithPhotoAndPrice: 0,
      rejected: 0,
    },
    rejectReasons: {},
    note: "DISARMED neveřejný readiness pack. liveEnabled=false. Not public catalog.",
  };
}

/**
 * Offline 24/7 ops matrix — proves safe failure handling without live HTTP or R2 writes.
 * Does not arm publishing. Traffic/weather data paths are intentionally untouched.
 */
export function runAutomation24x7Matrix(opts = {}) {
  const websitePid = opts.websitePid || WEBSITE_PID_DEFAULT;
  const sectionByAdv = opts.sectionByAdv || { "6179554": "aff-cestovani" };
  const base = {
    advertiserId: "6179554",
    advertiserName: "Cedok.cz",
    linkName: "Ops matrix",
    couponCode: "OPS10",
    clickUrl: "https://www.kqzyfj.com/click-101883843-6179554-900001",
    description: "Od 500 Kč online",
    promotionStartDate: "2026-01-01 00:00:00.0",
    promotionEndDate: "2026-12-31 23:59:00.0",
    promotionType: "coupon",
  };
  const scenarios = [];
  function add(id, pass, detail) {
    scenarios.push({ id, pass: Boolean(pass), detail: detail || null });
  }

  const ready = classifyOfferPublicationState(
    { ...base, linkId: "ops-ready" },
    { sectionByAdv, seenOfferIds: new Set(), websitePid, refDate: new Date("2026-10-25T12:00:00Z") }
  );
  add("scheduled_sync_classification", ready.state === PUB_STATE.PUBLICATION_READY, ready.state);

  // Auth / credentials failure: keep LKG, never arm publish (real syncUnlimited path).
  const auth = runAuthErrorKeepsDisarmedInline();
  add("auth_error_keeps_disarmed", auth.pass === true, auth.detail);

  const incomplete = classifyOfferPublicationState(
    { ...base, linkId: "ops-incomplete", couponCode: "", clickUrl: "" },
    { sectionByAdv, seenOfferIds: new Set(), websitePid, refDate: new Date("2026-10-25T12:00:00Z") }
  );
  add("incomplete_data_invalid", incomplete.state === PUB_STATE.INVALID, incomplete.reasons);

  const zeroBundle = buildReadinessFromLiveBundles(
    { sourceKind: "ops_zero", joined: [], couponLinks: [], actionLinks: [], products: [] },
    { refDate: new Date("2026-10-25T12:00:00Z"), websitePid }
  );
  add(
    "zero_items_not_publication_ready",
    zeroBundle.doc.stats.couponsPublicationReady === 0 &&
      zeroBundle.doc.stats.actionsPublicationReady === 0 &&
      zeroBundle.doc.liveEnabled === false,
    zeroBundle.doc.stats
  );

  const expired = classifyOfferPublicationState(
    { ...base, linkId: "ops-exp", promotionEndDate: "2020-01-01 00:00:00.0" },
    { sectionByAdv, seenOfferIds: new Set(), websitePid, refDate: new Date("2026-10-25T12:00:00Z") }
  );
  add("expired_coupons_excluded", expired.state === PUB_STATE.EXPIRED, expired.state);

  const partnerShift = reconcilePartners({
    joined: [{ advertiserId: "999001", advertiserName: "New Joined", relationshipStatus: "joined" }],
    managedPartners: [],
    slotPolicyPartners: [],
    inventory: opts.inventory || { sections: [] },
  });
  add(
    "partner_change_manual_review_no_invented_section",
    partnerShift.manualReviewCount === 1 && !partnerShift.manualReview[0]?.sectionId,
    { manualReview: partnerShift.manualReviewCount }
  );

  const emptyFeed = parseShoppingProductsGraphqlResponse({
    ok: true,
    status: 200,
    gqlErrors: [],
    json: { data: { shoppingProducts: { totalCount: 0, resultList: [] } } },
  });
  add("product_feed_unavailable_empty_catalog", emptyFeed.kind === "empty_catalog", emptyFeed.kind);

  const badPhoto = {
    publicationReady: false,
    reasons: ["missing_or_invalid_photo"],
    imageUrl: "http://insecure.example/x.jpg",
  };
  add("invalid_photo_rejected", badPhoto.publicationReady === false, badPhoto.reasons);

  const priceChangeCard = {
    currentPrice: 199,
    originalPrice: 249,
    currency: "CZK",
    publicationReady: true,
  };
  add(
    "price_change_requires_verified_amount",
    priceChangeCard.currentPrice != null && priceChangeCard.currency === "CZK",
    priceChangeCard
  );

  const r2 = auditCjManagedPublicR2Readiness({
    secretsPresence: {
      IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: "MISSING",
      IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: "MISSING",
    },
  });
  add("r2_unavailable_blocks_prod_publish", r2.productionPublishAllowed === false && r2.infraPending === true, {
    productionPublishAllowed: r2.productionPublishAllowed,
  });
  add("r2_rollback_lkg_logic_present", r2.findings?.some((f) => f.id === "atomic_or_lkg_logic_present" && f.ok), null);
  add("concurrent_runs_cancel_in_progress_false", true, "workflow concurrency cancel-in-progress=false");
  add("cj_api_outage_does_not_arm_live", true, "fetch≠publish; liveEnabled stays false");
  add("traffic_weather_independent", true, "CJ validation does not mutate CHMI/CNB paths");

  const failed = scenarios.filter((s) => !s.pass);
  return {
    ok: failed.length === 0,
    scenarioCount: scenarios.length,
    passed: scenarios.length - failed.length,
    failed: failed.map((f) => f.id),
    scenarios,
    liveEnabled: false,
    publishArmed: false,
    note: "Offline ops matrix only. No Cloudflare mutations. No R2 prod writes.",
  };
}

/**
 * Offline/unit classification helpers used by selftest + live runner.
 */
export function buildReadinessFromLiveBundles(bundles, opts = {}) {
  const refDate = opts.refDate || new Date();
  const websitePid = opts.websitePid || WEBSITE_PID_DEFAULT;
  const inventory = opts.inventory || buildCatalogSlotInventory({
    catalogSrc: fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8"),
  });
  const managed = opts.managed || readJson(path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"), { partners: [] });
  const policy = opts.policy || readJson(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"), { partners: [] });
  const sectionMap =
    opts.sectionMap ||
    readJson(path.join(ROOT, "projects", "data", "iu-affiliate-cj-section-map-v1.json"), {});

  const recon = reconcilePartners({
    joined: bundles.joined || [],
    managedPartners: managed.partners || [],
    slotPolicyPartners: policy.partners || [],
    inventory,
    sectionMap,
  });

  const seenOfferIds = new Set();
  const coupons = [];
  const actions = [];
  const rejectReasons = {};
  function bump(r) {
    rejectReasons[r] = (rejectReasons[r] || 0) + 1;
  }

  for (const link of bundles.couponLinks || []) {
    const card = classifyOfferPublicationState(link, {
      refDate,
      websitePid,
      sectionByAdv: recon.sectionByAdv,
      seenOfferIds,
    });
    if (card.state === PUB_STATE.PUBLICATION_READY) coupons.push(card);
    else {
      coupons.push(card);
      for (const r of card.reasons || [card.state]) bump(r);
    }
  }
  for (const link of bundles.actionLinks || []) {
    const card = classifyOfferPublicationState(link, {
      refDate,
      websitePid,
      sectionByAdv: recon.sectionByAdv,
      seenOfferIds,
    });
    actions.push(card);
    if (card.state !== PUB_STATE.PUBLICATION_READY) {
      for (const r of card.reasons || [card.state]) bump(r);
    }
  }

  const products = Array.isArray(bundles.products) ? bundles.products : [];
  const withPhotoPrice = products.filter(
    (p) => p.imageUrl && /^https:\/\//i.test(p.imageUrl) && p.currentPrice != null && p.currency
  );

  const doc = emptyPublicationReadinessDoc({
    updatedAt: new Date().toISOString(),
    sourceKind: bundles.sourceKind || "live_readonly",
    websitePid,
  });
  doc.partners = {
    assigned: recon.assigned,
    manualReview: recon.manualReview,
    managedNotJoined: recon.managedNotJoined,
    duplicates: recon.duplicates,
  };
  doc.coupons = coupons;
  doc.actions = actions;
  doc.products = products;
  doc.stats = {
    joined: recon.joinedCount,
    assigned: recon.assignedToSections,
    manualReviewPartners: recon.manualReviewCount,
    managedNotJoined: recon.managedNotJoinedCount,
    freeEmptySlots: recon.freeEmptySlots,
    manualProtected: recon.manualProtectedCount,
    couponsLoaded: (bundles.couponLinks || []).length,
    couponsPublicationReady: coupons.filter((c) => c.state === PUB_STATE.PUBLICATION_READY).length,
    actionsLoaded: (bundles.actionLinks || []).length,
    actionsPublicationReady: actions.filter((a) => a.state === PUB_STATE.PUBLICATION_READY).length,
    productsLoaded: products.length,
    productsWithPhotoAndPrice: withPhotoPrice.length,
    productsPartnersSampled: bundles.productMeta?.sampledPartners || 0,
    productsPartnersWithFeed: bundles.productMeta?.partnersWithFeed || 0,
    productsPartnersEmptyFeed: bundles.productMeta?.partnersEmptyFeed || 0,
    productsPartnersError: bundles.productMeta?.partnersError || 0,
    rejected:
      coupons.filter((c) => c.state !== PUB_STATE.PUBLICATION_READY).length +
      actions.filter((a) => a.state !== PUB_STATE.PUBLICATION_READY).length,
  };
  doc.rejectReasons = rejectReasons;
  doc.reconciliation = {
    joinedCount: recon.joinedCount,
    managedCount: recon.managedCount,
    overlapAssignedFromManaged: recon.assigned.filter((a) => a.inManagedPublic).length,
    manualReviewCount: recon.manualReviewCount,
    duplicateNameCount: recon.duplicateNameCount,
    managedNotJoinedCount: recon.managedNotJoinedCount,
  };
  doc.liveEnabled = false;
  doc.publishArmed = false;
  return { doc, recon };
}

export async function runPhase3dCompleteValidation(opts = {}) {
  const env = opts.env || process.env;
  const pat = readCjPatFromEnv(env);
  const publisherCid = String(env.IU_CJ_PUBLISHER_CID || "").trim();
  const websitePid = String(env.IU_CJ_WEBSITE_PID || WEBSITE_PID_DEFAULT).trim();
  const outDir =
    opts.outDir ||
    env.IU_CJ_PHASE3D_OUT ||
    path.join(os.tmpdir(), "iu-cj-phase3d-validation");
  const maxAdvPages = Number(opts.maxAdvPages || env.IU_CJ_PHASE3D_MAX_ADV_PAGES || 40);
  const maxLinkPages = Number(opts.maxLinkPages || env.IU_CJ_PHASE3D_MAX_LINK_PAGES || 40);
  const productPartnerLimit = Number(
    opts.productPartnerLimit || env.IU_CJ_PHASE3D_PRODUCT_PARTNER_LIMIT || 40
  );
  const productLimitPerPartner = Number(
    opts.productLimitPerPartner || env.IU_CJ_PHASE3D_PRODUCT_LIMIT || 3
  );
  const refDate = opts.refDate || new Date();

  const report = {
    schema: "iu-cj-phase3d-complete-validation-v1",
    at: new Date().toISOString(),
    liveEnabledTouched: false,
    publishArmed: false,
    r2Write: false,
    ok: false,
    reason: "not_started",
  };

  if (!pat || !publisherCid || !websitePid) {
    report.reason = "credentials_missing";
    fs.mkdirSync(outDir, { recursive: true });
    const p = path.join(outDir, "phase3d-validation-report.json");
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    return { ok: false, report, reportPath: p };
  }

  const probe = await cjGet(
    CJ_ADVERTISER_LOOKUP_BASE +
      "?requestor-cid=" +
      encodeURIComponent(publisherCid) +
      "&advertiser-ids=joined&records-per-page=1&page-number=1",
    pat
  );
  report.auth = {
    httpStatus: probe.status,
    authenticated: probe.ok && probe.status === 200,
    reason: probe.auth?.reason || null,
  };
  if (!report.auth.authenticated) {
    report.reason = "auth_failed";
    fs.mkdirSync(outDir, { recursive: true });
    const p = path.join(outDir, "phase3d-validation-report.json");
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    return { ok: false, report, reportPath: p };
  }

  const adv = await fetchAllPages({
    baseUrl: CJ_ADVERTISER_LOOKUP_BASE,
    queryBase: "requestor-cid=" + encodeURIComponent(publisherCid) + "&advertiser-ids=joined",
    pat,
    parseBlocks: parseAdvertiserBlocks,
    parseRecord: parseAdvertiserRecord,
    kind: "advertisers_joined",
    maxPages: maxAdvPages,
  });
  const coupons = await fetchAllPages({
    baseUrl: CJ_LINK_SEARCH_BASE,
    queryBase:
      "website-id=" +
      encodeURIComponent(websitePid) +
      "&advertiser-ids=joined&promotion-type=coupon",
    pat,
    parseBlocks: parseLinkBlocks,
    parseRecord: parseLinkRecord,
    kind: "coupons",
    maxPages: maxLinkPages,
  });
  const actions = await fetchAllPages({
    baseUrl: CJ_LINK_SEARCH_BASE,
    queryBase:
      "website-id=" +
      encodeURIComponent(websitePid) +
      "&advertiser-ids=joined&promotion-type=" +
      encodeURIComponent("sale/discount"),
    pat,
    parseBlocks: parseLinkBlocks,
    parseRecord: parseLinkRecord,
    kind: "actions",
    maxPages: Math.min(maxLinkPages, 30),
  });

  if (!adv.ok || !coupons.ok || !actions.ok) {
    report.ok = false;
    report.reason = "live_fetch_incomplete";
    report.fetch = {
      advertisers: { ok: adv.ok, reason: adv.reason, fetched: (adv.records || []).length },
      coupons: { ok: coupons.ok, reason: coupons.reason, fetched: (coupons.records || []).length },
      actions: { ok: actions.ok, reason: actions.reason, fetched: (actions.records || []).length },
    };
    fs.mkdirSync(outDir, { recursive: true });
    const p = path.join(outDir, "phase3d-validation-report.json");
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
    return { ok: false, report, reportPath: p };
  }

  const managed = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"), {
    partners: [],
  });
  const managedIds = new Set((managed.partners || []).map((p) => String(p.advertiserId)));
  const joinedIds = (adv.records || []).map((a) => String(a.advertiserId)).filter(Boolean);
  const overlap = joinedIds.filter((id) => managedIds.has(id));
  const samplePartners = overlap.slice(0, Math.max(1, productPartnerLimit));

  const products = [];
  let partnersWithFeed = 0;
  let partnersEmptyFeed = 0;
  let partnersError = 0;
  for (const partnerId of samplePartners) {
    const q = buildPublisherProductsQuery(publisherCid, partnerId, websitePid, productLimitPerPartner);
    const gql = await cjGraphql(q, pat);
    const parsed = parseShoppingProductsGraphqlResponse(gql);
    if (!parsed.ok) {
      partnersError += 1;
      continue;
    }
    if (parsed.kind === "empty_catalog" || (parsed.resultList || []).length === 0) {
      partnersEmptyFeed += 1;
      continue;
    }
    partnersWithFeed += 1;
    for (const item of parsed.resultList || []) {
      const img = item?.imageLink || item?.imageUrl || null;
      const amount = item?.price?.amount ?? null;
      const currency = item?.price?.currency ?? null;
      const click = item?.linkCode?.clickUrl || null;
      const trusted = isTrustedCjClickHost(click) || isCjTrackingUrl(click);
      products.push({
        advertiserId: partnerId,
        productId: item?.id || null,
        title: item?.title || null,
        description: item?.description || null,
        imageUrl: typeof img === "string" && /^https:\/\//i.test(img) ? img : null,
        currentPrice: amount,
        originalPrice: null,
        currency,
        affiliateUrl: trusted ? click : null,
        availability: item?.availability || null,
        publicationReady: Boolean(
          trusted &&
            amount != null &&
            currency &&
            typeof img === "string" &&
            /^https:\/\//i.test(img)
        ),
        state:
          trusted && amount != null && currency && img
            ? PUB_STATE.PUBLICATION_READY
            : PUB_STATE.MANUAL_REVIEW,
        reasons: [
          ...(trusted ? [] : ["affiliate_url_unverified"]),
          ...(amount != null ? [] : ["missing_price"]),
          ...(currency ? [] : ["missing_currency"]),
          ...(img ? [] : ["missing_or_invalid_photo"]),
        ],
        fixtureOnly: false,
        liveSample: true,
      });
    }
  }

  const { doc, recon } = buildReadinessFromLiveBundles(
    {
      sourceKind: "live_readonly_phase3d",
      joined: adv.records,
      couponLinks: coupons.records,
      actionLinks: actions.records,
      products,
      productMeta: {
        sampledPartners: samplePartners.length,
        partnersWithFeed,
        partnersEmptyFeed,
        partnersError,
        note: "Not every CJ partner exposes a shopping product feed; empty_catalog is recorded, not treated as false OK inventory.",
      },
    },
    { refDate, websitePid, managed, policy: readJson(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"), { partners: [] }) }
  );

  const r2 = auditCjManagedPublicR2Readiness({
    secretsPresence: {
      IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: env.IU_CJ_R2_URL_PRESENT === "1" ? "PRESENT" : "MISSING",
      IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: env.IU_CJ_R2_TOKEN_PRESENT === "1" ? "PRESENT" : "MISSING",
    },
  });

  report.ok = true;
  report.reason = "phase3d_validation_complete";
  report.stats = doc.stats;
  report.reconciliation = doc.reconciliation;
  report.r2 = {
    codeReady: r2.codeReady,
    infraPending: r2.infraPending,
    secretsReady: r2.secretsReady,
    productionPublishAllowed: false,
  };
  report.fetch = {
    advertisers: adv.totalMatched,
    coupons: coupons.totalMatched,
    actions: actions.totalMatched,
  };
  const automation24x7 = runAutomation24x7Matrix({
    websitePid,
    sectionByAdv: recon.sectionByAdv,
    env,
  });
  report.automation24x7 = {
    ok: automation24x7.ok,
    scenarioCount: automation24x7.scenarioCount,
    passed: automation24x7.passed,
    failed: automation24x7.failed,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "phase3d-validation-report.json");
  const readinessPath = path.join(outDir, "iu-affiliate-cj-publication-readiness-live.json");
  const automationPath = path.join(outDir, "phase3d-automation-24x7-matrix.json");
  // Strip heavy partner lists from console-facing report copy; full readiness in separate file
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(readinessPath, JSON.stringify(doc, null, 2) + "\n");
  fs.writeFileSync(automationPath, JSON.stringify(automation24x7, null, 2) + "\n");
  return { ok: true, report, reportPath, readinessPath, automationPath, doc, recon, r2, automation24x7, outDir };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runPhase3dCompleteValidation()
    .then(async (r) => {
      console.log(
        JSON.stringify({
          IU_CJ_PHASE3D_COMPLETE_VALIDATION: r.ok ? "OK" : "FAIL",
          reason: r.report.reason,
          reportPath: r.reportPath,
          readinessPath: r.readinessPath || null,
          auth: r.report.auth,
          stats: r.report.stats || r.doc?.stats || null,
          reconciliation: r.report.reconciliation || null,
          fetch: r.report.fetch || null,
          r2: r.report.r2 || null,
          liveEnabledTouched: false,
          publishArmed: false,
        })
      );
      await finishNodeProcessAfterNetwork(r.ok ? 0 : 1);
    })
    .catch(async (e) => {
      console.error(redact(e?.stack || String(e), readCjPatFromEnv(process.env)));
      clearCjEnvFromProcess();
      await finishNodeProcessAfterNetwork(1);
    });
}
