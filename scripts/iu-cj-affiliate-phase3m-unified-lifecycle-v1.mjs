#!/usr/bin/env node
/**
 * Phase 3M — ONE unified CJ affiliate partner lifecycle (baked ∪ managed).
 *
 * Authority: CJ API (joined / confirmed ENDED). Email is prompt-only.
 * Never arms liveEnabled / publishArmed / CJ_MANAGED_PUBLIC_LIVE_ENABLED.
 * Never invents sections, prices, or URLs.
 * MANUAL_PROTECTED / PAID_RESERVED are immutable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCjTrackingUrl,
  materializeManagedPublic,
  PARTNER_STATE,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  DYNAMIC_DECISION,
  isConfirmedEndedStatus,
  syncUnlimitedDynamicCatalog,
  classifyPolicyManagement,
} from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { normalizePartnerBrand } from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";

export const PHASE3M_SCHEMA = "iu-cj-affiliate-phase3m-unified-lifecycle-v1";

export const LIFECYCLE_ACTION = Object.freeze({
  ADD_JOINED: "ADD_JOINED",
  UPDATE_URL: "UPDATE_URL",
  MOVE_SECTION: "MOVE_SECTION",
  MIGRATE_BAKED: "MIGRATE_BAKED",
  REMOVE_ENDED_ATOMIC: "REMOVE_ENDED_ATOMIC",
  EXPIRE_COUPON_ONLY: "EXPIRE_COUPON_ONLY",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  KEEP_DRIFT: "KEEP_DRIFT_NOT_CONFIRMED_ENDED",
  KEEP_LKG: "KEEP_LKG",
  PROTECTED_SKIP: "PROTECTED_SKIP",
  SKIP_DUPLICATE: "SKIP_DUPLICATE",
  EMAIL_HINT_REQUIRES_CJ_RECONCILE: "EMAIL_HINT_REQUIRES_CJ_RECONCILE",
  REJECT_UNSAFE_ENDED: "REJECT_UNSAFE_ENDED",
});

export const UNSAFE_ENDED_REASONS = Object.freeze([
  "timeout",
  "http_401",
  "http_403",
  "http_429",
  "api_outage",
  "incomplete_paging",
  "partner_temporarily_absent",
  "unclear_status",
  "parse_error",
  "sync_error",
  "unverified_email",
]);

/**
 * Inventory baked catalog + managed-public under one CID-keyed view.
 */
export function inventuryUnifiedButtons({
  catalogSrc = null,
  managedPublic = null,
  slotPolicyPartners = [],
} = {}) {
  const ordered = parseAffiliateCatalogOrdered(catalogSrc);
  const managedPartners = Array.isArray(managedPublic?.partners)
    ? managedPublic.partners
    : Array.isArray(managedPublic)
      ? managedPublic
      : [];
  const managedById = new Map();
  for (const p of managedPartners) {
    if (p?.advertiserId == null) continue;
    managedById.set(String(p.advertiserId), p);
  }

  const policyById = new Map();
  for (const p of slotPolicyPartners) {
    if (p?.advertiserId != null) policyById.set(String(p.advertiserId), p);
  }

  const baked = [];
  for (const sec of ordered.sections || []) {
    for (const it of sec.items || []) {
      if (it.kind !== "partner" || !it.affiliateUrlReady) continue;
      const id = it.advertiserId ? String(it.advertiserId) : null;
      const policy = id ? policyById.get(id) : null;
      const mgmt = classifyPolicyManagement(policy);
      baked.push({
        title: it.title,
        url: it.url,
        advertiserId: id,
        sectionId: sec.sectionId,
        origin: "baked",
        management: mgmt || (id && managedById.has(id) ? "CJ_MANAGED" : "BAKED_STATIC"),
        inManaged: id ? managedById.has(id) : false,
        managedActive: id ? managedById.get(id)?.active !== false : null,
      });
    }
  }

  const bakedWithCid = baked.filter((b) => b.advertiserId);
  const bakedWithoutCid = baked.filter((b) => !b.advertiserId);
  const bakedIds = new Set(bakedWithCid.map((b) => b.advertiserId));
  const managedActive = managedPartners.filter((p) => p.active !== false);
  const managedIds = new Set(managedActive.map((p) => String(p.advertiserId)));
  const overlap = [...bakedIds].filter((id) => managedIds.has(id));
  const bakedOnlyCid = [...bakedIds].filter((id) => !managedIds.has(id));
  const managedOnly = [...managedIds].filter((id) => !bakedIds.has(id));

  return {
    schema: PHASE3M_SCHEMA,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    counts: {
      bakedPartners: baked.length,
      bakedWithCid: bakedWithCid.length,
      bakedWithoutCid: bakedWithoutCid.length,
      managedTotal: managedPartners.length,
      managedActive: managedActive.length,
      overlapCid: overlap.length,
      bakedOnlyCid: bakedOnlyCid.length,
      managedOnlyCid: managedOnly.length,
      uniqueActiveCid: new Set([...overlap, ...bakedOnlyCid, ...managedOnly]).size,
    },
    bakedOnlyCid,
    managedOnlySample: managedOnly.slice(0, 20),
    bakedWithoutCidSample: bakedWithoutCid.slice(0, 20).map((b) => ({
      title: b.title,
      sectionId: b.sectionId,
      urlTrusted: isCjTrackingUrl(b.url),
    })),
    baked,
    managedPartners,
  };
}

/**
 * Plan migration of baked partners under managed authority (preview only).
 * Partners already in managed → MIGRATE_BAKED noop keep.
 * Baked without CID → only if joinedNameMap resolves a unique CID + section + URL.
 */
export function planBakedMigrationUnderManaged({
  inventory,
  joined = [],
  sectionMap = {},
  urlByAdvertiser = {},
  confirmedNameToAdvertiserId = {},
} = {}) {
  const decisions = [];
  const migrateSlice = [];
  const joinedById = new Map(joined.map((j) => [String(j.advertiserId), j]));
  const nameToId = new Map();
  for (const [name, id] of Object.entries(confirmedNameToAdvertiserId || {})) {
    nameToId.set(normalizePartnerBrand(name), String(id));
  }
  for (const j of joined) {
    const n = normalizePartnerBrand(j.advertiserName || j.partnerName || "");
    if (n && !nameToId.has(n)) nameToId.set(n, String(j.advertiserId));
  }

  const seen = new Set();
  for (const b of inventory?.baked || []) {
    let id = b.advertiserId;
    if (!id) {
      const resolved = nameToId.get(normalizePartnerBrand(b.title));
      if (!resolved) {
        decisions.push({
          title: b.title,
          sectionId: b.sectionId,
          action: LIFECYCLE_ACTION.MANUAL_REVIEW,
          reason: "baked_without_cid_unresolved",
        });
        continue;
      }
      id = resolved;
    }
    if (seen.has(id)) {
      decisions.push({
        advertiserId: id,
        title: b.title,
        action: LIFECYCLE_ACTION.SKIP_DUPLICATE,
        reason: "duplicate_baked_or_managed",
      });
      continue;
    }
    seen.add(id);

    if (b.inManaged && b.managedActive !== false) {
      decisions.push({
        advertiserId: id,
        title: b.title,
        action: LIFECYCLE_ACTION.MIGRATE_BAKED,
        reason: "already_under_managed_authority",
        migrated: false,
      });
      continue;
    }

    const joinedRow = joinedById.get(id);
    const sectionId = sectionMap[id] || b.sectionId || joinedRow?.sectionId || null;
    const url = urlByAdvertiser[id] || b.url || joinedRow?.affiliateUrl || null;
    if (!sectionId) {
      decisions.push({
        advertiserId: id,
        title: b.title,
        action: LIFECYCLE_ACTION.MANUAL_REVIEW,
        reason: "no_trusted_section",
      });
      continue;
    }
    if (!isCjTrackingUrl(url)) {
      decisions.push({
        advertiserId: id,
        title: b.title,
        action: LIFECYCLE_ACTION.MANUAL_REVIEW,
        reason: "missing_or_untrusted_cj_url",
      });
      continue;
    }

    const row = {
      advertiserId: id,
      sectionId,
      title: b.title || joinedRow?.advertiserName || id,
      url,
      active: true,
      management: "CJ_MANAGED",
      migratedFrom: "baked",
    };
    migrateSlice.push(row);
    decisions.push({
      advertiserId: id,
      title: row.title,
      sectionId,
      action: LIFECYCLE_ACTION.MIGRATE_BAKED,
      reason: "planned_under_managed",
      migrated: true,
    });
  }

  return {
    liveEnabled: false,
    publishArmed: false,
    decisions,
    migrateSlice,
    counts: {
      plannedMigrate: migrateSlice.length,
      manualReview: decisions.filter((d) => d.action === LIFECYCLE_ACTION.MANUAL_REVIEW).length,
      alreadyManaged: decisions.filter(
        (d) => d.action === LIFECYCLE_ACTION.MIGRATE_BAKED && d.migrated === false
      ).length,
      duplicates: decisions.filter((d) => d.action === LIFECYCLE_ACTION.SKIP_DUPLICATE).length,
    },
  };
}

/**
 * Safety gate: ENDED removal only when confirmation is trustworthy.
 */
export function assertEndedRemovalAllowed(ctx = {}) {
  if (ctx.emailOnly === true) {
    return { ok: false, reason: "unverified_email", action: LIFECYCLE_ACTION.REJECT_UNSAFE_ENDED };
  }
  if (ctx.apiOutage === true) {
    return { ok: false, reason: "api_outage", action: LIFECYCLE_ACTION.KEEP_LKG };
  }
  if (ctx.fetchComplete === false) {
    return { ok: false, reason: "incomplete_paging", action: LIFECYCLE_ACTION.KEEP_LKG };
  }
  if (ctx.httpStatus === 401 || ctx.httpStatus === 403) {
    return {
      ok: false,
      reason: "http_" + ctx.httpStatus,
      action: LIFECYCLE_ACTION.KEEP_LKG,
    };
  }
  if (ctx.httpStatus === 429) {
    return { ok: false, reason: "http_429", action: LIFECYCLE_ACTION.KEEP_LKG };
  }
  if (ctx.timeout === true) {
    return { ok: false, reason: "timeout", action: LIFECYCLE_ACTION.KEEP_LKG };
  }
  if (ctx.parseError === true) {
    return { ok: false, reason: "parse_error", action: LIFECYCLE_ACTION.KEEP_LKG };
  }
  if (ctx.syncError === true) {
    return { ok: false, reason: "sync_error", action: LIFECYCLE_ACTION.KEEP_LKG };
  }
  if (ctx.statusUnclear === true) {
    return { ok: false, reason: "unclear_status", action: LIFECYCLE_ACTION.KEEP_DRIFT };
  }
  if (ctx.partnerTemporarilyAbsent === true && ctx.confirmedEnded !== true) {
    return {
      ok: false,
      reason: "partner_temporarily_absent",
      action: LIFECYCLE_ACTION.KEEP_DRIFT,
    };
  }
  const statusOk =
    ctx.confirmedEnded === true || isConfirmedEndedStatus(ctx.relationshipStatus);
  if (!statusOk) {
    return { ok: false, reason: "unclear_status", action: LIFECYCLE_ACTION.KEEP_DRIFT };
  }
  return { ok: true, reason: "confirmed_ended", action: LIFECYCLE_ACTION.REMOVE_ENDED_ATOMIC };
}

/**
 * Atomically strip partner button + coupons + actions + products for confirmed ENDED.
 * Returns next managed-public + next offers-public + audit (never mutates inputs).
 */
export function applyConfirmedEndedAtomic({
  advertiserId,
  managedPublic,
  offersPublic = null,
  endedCtx = {},
  websitePid = WEBSITE_PID,
} = {}) {
  const id = String(advertiserId || "");
  const gate = assertEndedRemovalAllowed(endedCtx);
  if (!gate.ok) {
    return {
      ok: false,
      liveEnabled: false,
      publishArmed: false,
      action: gate.action,
      reason: gate.reason,
      nextManagedPublic: managedPublic,
      nextOffersPublic: offersPublic,
      audit: null,
    };
  }

  const partnersIn = Array.isArray(managedPublic?.partners)
    ? managedPublic.partners
    : Array.isArray(managedPublic)
      ? managedPublic
      : [];
  const nextPartners = partnersIn.map((p) => {
    if (String(p.advertiserId) !== id) return { ...p };
    return {
      ...p,
      active: false,
      endedReason: "confirmed_ended",
      management: "CJ_MANAGED",
    };
  });
  // Ensure ENDED marker exists even if partner was baked-only (so overlay can hide)
  if (!nextPartners.some((p) => String(p.advertiserId) === id)) {
    nextPartners.push({
      advertiserId: id,
      sectionId: endedCtx.sectionId || null,
      title: endedCtx.title || id,
      url: endedCtx.url || null,
      active: false,
      endedReason: "confirmed_ended",
      management: "CJ_MANAGED",
    });
  }

  const nextManagedPublic = materializeManagedPublic(nextPartners, {
    websitePid,
    updatedAt: endedCtx.updatedAt || new Date().toISOString(),
  });

  const offers = offersPublic && typeof offersPublic === "object" ? { ...offersPublic } : null;
  let stripped = { coupons: 0, actions: 0, products: 0, sections: 0 };
  let nextOffersPublic = offers;
  if (offers) {
    const filterAdv = (arr) =>
      (Array.isArray(arr) ? arr : []).filter((row) => String(row?.advertiserId) !== id);
    const couponsBefore = Array.isArray(offers.coupons) ? offers.coupons.length : 0;
    const actionsBefore = Array.isArray(offers.actions) ? offers.actions.length : 0;
    const productsBefore = Array.isArray(offers.products) ? offers.products.length : 0;
    const coupons = filterAdv(offers.coupons);
    const actions = filterAdv(offers.actions);
    const products = filterAdv(offers.products);
    let sections = Array.isArray(offers.sections) ? offers.sections : [];
    const sectionsBefore = sections.length;
    sections = sections
      .map((sec) => {
        if (!sec || typeof sec !== "object") return sec;
        const items = Array.isArray(sec.items)
          ? sec.items.filter((it) => String(it?.advertiserId) !== id)
          : sec.items;
        const couponsS = Array.isArray(sec.coupons)
          ? sec.coupons.filter((it) => String(it?.advertiserId) !== id)
          : sec.coupons;
        const productsS = Array.isArray(sec.products)
          ? sec.products.filter((it) => String(it?.advertiserId) !== id)
          : sec.products;
        return { ...sec, items, coupons: couponsS, products: productsS };
      })
      .filter((sec) => {
        if (!sec) return false;
        // Drop only advertiser-scoped section shells; keep category shells.
        if (String(sec.advertiserId) === id) return false;
        return true;
      });
    stripped = {
      coupons: couponsBefore - coupons.length,
      actions: actionsBefore - actions.length,
      products: productsBefore - products.length,
      sections: sectionsBefore - sections.length,
    };
    nextOffersPublic = {
      ...offers,
      liveEnabled: false,
      coupons,
      actions,
      products,
      sections,
      updatedAt: endedCtx.updatedAt || new Date().toISOString(),
      stats: {
        ...(offers.stats || {}),
        coupons: coupons.length,
        actions: actions.length,
        products: products.length,
      },
    };
  }

  const audit = {
    schema: "iu-cj-affiliate-phase3m-ended-audit-v1",
    advertiserId: id,
    at: endedCtx.updatedAt || new Date().toISOString(),
    action: LIFECYCLE_ACTION.REMOVE_ENDED_ATOMIC,
    reason: gate.reason,
    stripped,
    public: false,
  };

  return {
    ok: true,
    liveEnabled: false,
    publishArmed: false,
    action: LIFECYCLE_ACTION.REMOVE_ENDED_ATOMIC,
    reason: gate.reason,
    nextManagedPublic,
    nextOffersPublic,
    audit,
    stripped,
  };
}

/**
 * Expire a single coupon without removing the partner.
 */
export function expireSingleCoupon({ offersPublic, couponId, advertiserId } = {}) {
  const offers = offersPublic && typeof offersPublic === "object" ? { ...offersPublic } : null;
  if (!offers) {
    return { ok: false, reason: "no_offers", nextOffersPublic: null };
  }
  const cid = String(couponId || "");
  const aid = advertiserId != null ? String(advertiserId) : null;
  const coupons = (Array.isArray(offers.coupons) ? offers.coupons : []).filter((c) => {
    if (String(c?.id || c?.couponId || "") === cid) {
      if (aid && String(c.advertiserId) !== aid) return true;
      return false;
    }
    return true;
  });
  return {
    ok: true,
    action: LIFECYCLE_ACTION.EXPIRE_COUPON_ONLY,
    liveEnabled: false,
    nextOffersPublic: {
      ...offers,
      liveEnabled: false,
      coupons,
      stats: { ...(offers.stats || {}), coupons: coupons.length },
    },
    partnerPreserved: true,
  };
}

/**
 * Email notification → hint only. Never mutates catalog.
 */
export function emailHintToLifecycleAction(emailEvent = {}) {
  const kind = String(emailEvent.kind || emailEvent.type || "").toLowerCase();
  const trustedFrom =
    emailEvent.fromTrusted === true ||
    /@mx\d*\.cj\.com$/i.test(String(emailEvent.from || "")) ||
    /owner-membermessaging@/i.test(String(emailEvent.from || ""));
  if (!trustedFrom) {
    return {
      action: LIFECYCLE_ACTION.EMAIL_HINT_REQUIRES_CJ_RECONCILE,
      mutate: false,
      reason: "spoof_or_untrusted_from",
      requiresCjApi: true,
      blocked: true,
    };
  }
  if (emailEvent.duplicate === true) {
    return {
      action: LIFECYCLE_ACTION.EMAIL_HINT_REQUIRES_CJ_RECONCILE,
      mutate: false,
      reason: "duplicate_email",
      requiresCjApi: true,
      blocked: false,
      skip: true,
    };
  }
  let hint = "unknown";
  if (/approv|joined|accept|schv[aá]len/i.test(kind + " " + String(emailEvent.subject || ""))) {
    hint = "joined_candidate";
  } else if (/end|terminat|ukonč|reject/i.test(kind + " " + String(emailEvent.subject || ""))) {
    hint = "ended_candidate";
  } else if (/coupon|promo|offer|kupr/i.test(kind + " " + String(emailEvent.subject || ""))) {
    hint = "offer_candidate";
  }
  return {
    action: LIFECYCLE_ACTION.EMAIL_HINT_REQUIRES_CJ_RECONCILE,
    mutate: false,
    reason: "email_prompt_only",
    hint,
    requiresCjApi: true,
    advertiserHint: emailEvent.advertiserId || emailEvent.advertiserName || null,
    blocked: false,
  };
}

/**
 * Unified sync wrapper: dynamic catalog + optional ENDED offer strip.
 * Always returns liveEnabled=false, publishArmed=false.
 */
export function runUnifiedLifecycleSync(input = {}) {
  const base = syncUnlimitedDynamicCatalog(input);
  const offersPublic = input.offersPublic || null;
  const endedIds = new Set((input.confirmedEndedAdvertiserIds || []).map(String));
  let nextOffers = offersPublic;
  const audits = [];

  if (base.ok && endedIds.size && offersPublic) {
    for (const id of endedIds) {
      const applied = applyConfirmedEndedAtomic({
        advertiserId: id,
        managedPublic: base.nextManagedPublic,
        offersPublic: nextOffers,
        endedCtx: {
          confirmedEnded: true,
          apiOutage: false,
          fetchComplete: input.fetchComplete !== false,
        },
        websitePid: input.websitePid || WEBSITE_PID,
      });
      if (applied.ok) {
        base.nextManagedPublic = applied.nextManagedPublic;
        nextOffers = applied.nextOffersPublic;
        audits.push(applied.audit);
      }
    }
  }

  return {
    ...base,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    nextOffersPublic: nextOffers,
    endedAudits: audits,
    schema: PHASE3M_SCHEMA,
  };
}

/**
 * Resolve Moje lékárna-like partner from joined list (CJ API rows). Never invents.
 */
export function resolveMojeLekarnaCandidate(joined = []) {
  const needle = /moje\s*l[eé]k[aá]rn|mojelekarna|eshop\.mojelekarna/i;
  const hits = (joined || []).filter((j) =>
    needle.test(
      String(j.advertiserName || "") +
        String(j.partnerName || "") +
        String(j.websiteUrl || "") +
        String(j.programUrl || "")
    )
  );
  if (hits.length === 0) {
    return { found: false, status: "NOT_IN_JOINED_FIXTURE", candidate: null };
  }
  if (hits.length > 1) {
    return {
      found: true,
      status: "MANUAL_REVIEW",
      reason: "ambiguous_name_match",
      candidates: hits.map((h) => ({
        advertiserId: String(h.advertiserId),
        name: h.advertiserName || h.partnerName,
        relationshipStatus: h.relationshipStatus || h.status,
      })),
    };
  }
  const h = hits[0];
  const sectionId = h.sectionId || null;
  const url = h.affiliateUrl || h.clickUrl || null;
  const joinedOk = String(h.relationshipStatus || h.status || "")
    .toLowerCase()
    .includes("join");
  if (!joinedOk) {
    return {
      found: true,
      status: "NOT_JOINED",
      candidate: { advertiserId: String(h.advertiserId), name: h.advertiserName },
    };
  }
  if (!sectionId) {
    return {
      found: true,
      status: "MANUAL_REVIEW",
      reason: "no_trusted_section",
      candidate: {
        advertiserId: String(h.advertiserId),
        name: h.advertiserName || h.partnerName,
        suggestedSection: "aff-lekarny",
      },
    };
  }
  if (!isCjTrackingUrl(url)) {
    return {
      found: true,
      status: "MANUAL_REVIEW",
      reason: "missing_or_untrusted_cj_url",
      candidate: { advertiserId: String(h.advertiserId), name: h.advertiserName },
    };
  }
  return {
    found: true,
    status: "READY_FOR_MANAGED_ADD",
    candidate: {
      advertiserId: String(h.advertiserId),
      title: h.advertiserName || h.partnerName,
      sectionId,
      url,
      active: true,
      management: "CJ_MANAGED",
    },
  };
}

/** CLI inventury against repo files (read-only). */
function main() {
  const catalogSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const managedPublic = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"),
      "utf8"
    )
  );
  const inv = inventuryUnifiedButtons({ catalogSrc, managedPublic });
  const out = {
    OK: true,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    counts: inv.counts,
    bakedWithoutCidSample: inv.bakedWithoutCidSample,
  };
  console.log(JSON.stringify(out));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
