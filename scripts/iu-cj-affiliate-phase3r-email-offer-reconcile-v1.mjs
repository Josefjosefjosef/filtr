#!/usr/bin/env node
/**
 * V30 — safe CJ ↔ email offer reconcile (never invents affiliate URLs / prices).
 *
 * - Email never alone publishes.
 * - Email never changes JOINED/ENDED, Paragon HOLD, or tracking URL authority.
 * - Matching coupon codes on JOINED advertisers corroborate existing CJ staging links.
 * - Email-only offers without a CJ-authorized click URL go to HOLD (not public).
 */
import { AI_EVENT_TYPE } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { isPlausibleCjAdvertiserId } from "./iu-cj-affiliate-phase3z-email-hints-bridge-v19.mjs";
import { EMAIL_CONTENT_STATE } from "./iu-cj-affiliate-phase3r-email-content-state-v1.mjs";

export const PHASE3R_EMAIL_OFFER_RECONCILE_SCHEMA =
  "iu-cj-affiliate-phase3r-email-offer-reconcile-v1";

function normCode(c) {
  return String(c || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isJoinedAdvertiser(advertiserId, joinedIds) {
  const id = isPlausibleCjAdvertiserId(advertiserId);
  if (!id) return false;
  if (!joinedIds || joinedIds.size === 0) return false;
  return joinedIds.has(id);
}

/**
 * Build JOINED advertiser id set from managed-public / staging advertisers.
 */
export function buildJoinedAdvertiserSet(opts = {}) {
  const set = new Set();
  for (const p of opts.managedPartners || []) {
    if (p && p.active !== false) {
      const id = isPlausibleCjAdvertiserId(p.advertiserId);
      if (id) set.add(id);
    }
  }
  for (const a of opts.stagingAdvertisers || []) {
    const status = String(a?.accountStatus || a?.relationshipStatus || a?.status || "").toLowerCase();
    if (status && status !== "joined") continue;
    const id = isPlausibleCjAdvertiserId(a?.advertiserId || a?.advertiserCid || a?.cid);
    if (id) set.add(id);
  }
  for (const idRaw of opts.joinedIds || []) {
    const id = isPlausibleCjAdvertiserId(idRaw);
    if (id) set.add(id);
  }
  return set;
}

/**
 * Reconcile AI/email offer events against CJ staging links.
 * Returns corroboration updates + HOLD rows. Does not mutate partners.
 */
export function reconcileEmailOffersWithCjStaging(opts = {}) {
  const events = Array.isArray(opts.events) ? opts.events : [];
  const links = Array.isArray(opts.stagingLinks) ? opts.stagingLinks : [];
  const joined = buildJoinedAdvertiserSet(opts);
  const armed = opts.emailOfferStagingArmed === true;

  const byAdvCode = new Map();
  for (const link of links) {
    const adv = isPlausibleCjAdvertiserId(link?.advertiserId);
    const code = normCode(link?.couponCode);
    if (!adv || !code) continue;
    const key = adv + "|" + code;
    if (!byAdvCode.has(key)) byAdvCode.set(key, []);
    byAdvCode.get(key).push(link);
  }

  const corroborated = [];
  const holds = [];
  const conflicts = [];
  const skipped = [];
  let emailOnlyPublishBlocked = 0;
  let cjPlusEmail = 0;

  for (const ev of events) {
    const type = String(ev?.eventType || "");
    const isOffer =
      type === AI_EVENT_TYPE.COUPON_NEW ||
      type === AI_EVENT_TYPE.COUPON_EXPIRED ||
      type === AI_EVENT_TYPE.PROMO_NEW ||
      type === AI_EVENT_TYPE.PRODUCT_NEW ||
      type === AI_EVENT_TYPE.OFFER_CHANGED;
    if (!isOffer) {
      skipped.push({ uid: ev.uid ?? null, reason: "not_offer_event", eventType: type });
      continue;
    }
    const adv = isPlausibleCjAdvertiserId(ev.advertiserId);
    const code = normCode(ev.couponCode);
    if (!adv) {
      holds.push({
        uid: ev.uid ?? null,
        eventType: type,
        contentState: EMAIL_CONTENT_STATE.HOLD,
        reason: "missing_or_implausible_advertiser_id",
        couponCode: code || null,
        mutate: false,
        publishArmed: false,
      });
      continue;
    }
    if (!isJoinedAdvertiser(adv, joined)) {
      holds.push({
        uid: ev.uid ?? null,
        advertiserId: adv,
        eventType: type,
        contentState: EMAIL_CONTENT_STATE.HOLD,
        reason: "advertiser_not_joined",
        couponCode: code || null,
        mutate: false,
        publishArmed: false,
        note: "Email must not promote non-JOINED or create JOINED from email alone",
      });
      continue;
    }

    if (code && byAdvCode.has(adv + "|" + code)) {
      const matched = byAdvCode.get(adv + "|" + code);
      const primary = matched[0];
      const click = primary?.clickUrl || primary?.affiliateUrl || null;
      if (click && !isCjTrackingUrl(click)) {
        holds.push({
          uid: ev.uid ?? null,
          advertiserId: adv,
          eventType: type,
          contentState: EMAIL_CONTENT_STATE.HOLD,
          reason: "staging_link_not_trusted_cj_tracking",
          couponCode: code,
          mutate: false,
        });
        continue;
      }
      cjPlusEmail += 1;
      corroborated.push({
        uid: ev.uid ?? null,
        advertiserId: adv,
        eventType: type,
        couponCode: code,
        linkId: primary?.linkId || primary?.id || null,
        sources: ["cj", "email"],
        contentState: EMAIL_CONTENT_STATE.RECONCILED,
        decision: "CORROBORATE_EXISTING_CJ_LINK",
        mutate: false,
        publishArmed: false,
        emailOfferStagingArmed: armed,
        note: "Email corroborates CJ staging coupon; CJ remains URL/authority source",
      });
      continue;
    }

    // Email-only: never invent click URL. Optional armed staging still requires CJ URL.
    emailOnlyPublishBlocked += 1;
    holds.push({
      uid: ev.uid ?? null,
      advertiserId: adv,
      eventType: type,
      couponCode: code || null,
      productHint: ev.productHint || null,
      contentState: EMAIL_CONTENT_STATE.HOLD,
      decision: "EMAIL_ONLY_HOLD",
      reason: code
        ? "email_only_coupon_awaiting_cj_link_search_match"
        : "email_offer_without_cj_authorized_url",
      mutate: false,
      publishArmed: false,
      requiresCjLinkSearchRefresh: true,
      note:
        "Authorized email-only offers stay in HOLD until CJ Link Search / product API provides an authorized tracking URL",
    });
  }

  return {
    schema: PHASE3R_EMAIL_OFFER_RECONCILE_SCHEMA,
    ok: true,
    mutatePartnersFromEmailAlone: false,
    emailNeverBypassesJoined: true,
    emailNeverReplacesCjTrackingUrl: true,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    emailOfferStagingArmed: armed,
    counts: {
      eventsIn: events.length,
      corroborated: corroborated.length,
      holds: holds.length,
      conflicts: conflicts.length,
      skipped: skipped.length,
      cjPlusEmail,
      emailOnlyPublishBlocked,
    },
    corroborated: corroborated.slice(0, 200),
    holds: holds.slice(0, 200),
    conflicts: conflicts.slice(0, 50),
    skipped: skipped.slice(0, 50),
  };
}
