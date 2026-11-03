#!/usr/bin/env node
/**
 * V30/V31 — safe CJ ↔ email offer reconcile.
 *
 * - Email never changes JOINED/ENDED, Paragon HOLD, or invents tracking URLs.
 * - Matching coupon codes on JOINED advertisers corroborate existing CJ staging links.
 * - V31: email-only offers may become publishable ONLY when:
 *     JOINED + partner authorized CJ tracking URL + conditions + validity + CZ usable
 *     + confidence + emailOfferStagingArmed + not forged/conflict/Paragon.
 *   The affiliate URL is always the partner's authorized CJ URL (never from email body).
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

function confidenceOk(c) {
  const s = String(c || "").toLowerCase();
  return s === "high" || s === "medium";
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
 * Map advertiserId → authorized CJ tracking URL (main button / managed public).
 */
export function buildPartnerAuthorizedUrlMap(opts = {}) {
  const map = new Map();
  const put = (idRaw, url) => {
    const id = isPlausibleCjAdvertiserId(idRaw);
    if (!id || !isCjTrackingUrl(url)) return;
    if (!map.has(id)) map.set(id, String(url).trim());
  };
  for (const [k, v] of Object.entries(opts.partnerAuthorizedUrls || {})) put(k, v);
  for (const p of opts.managedPartners || []) {
    put(p?.advertiserId, p?.affiliateUrl || p?.clickUrl || p?.href);
  }
  for (const b of opts.mainButtons || []) {
    put(b?.advertiserId || b?.cid, b?.href || b?.affiliateUrl || b?.clickUrl || b?.url);
  }
  if (opts.mainButtonsDoc && typeof opts.mainButtonsDoc === "object") {
    const sections = opts.mainButtonsDoc.sections || opts.mainButtonsDoc.buttons || [];
    if (Array.isArray(sections)) {
      for (const s of sections) {
        const buttons = s?.buttons || s?.partners || (s?.advertiserId ? [s] : []);
        for (const b of buttons) {
          put(b?.advertiserId || b?.cid, b?.href || b?.affiliateUrl || b?.clickUrl || b?.url);
        }
      }
    }
    for (const [k, v] of Object.entries(opts.mainButtonsDoc)) {
      if (k.startsWith("_") || typeof v !== "object" || !v) continue;
      put(v.advertiserId || k, v.href || v.affiliateUrl || v.clickUrl);
    }
  }
  return map;
}

function emailOnlyGateReasons(ev, ctx) {
  const reasons = [];
  if (!ctx.joined) reasons.push("advertiser_not_joined");
  if (!ctx.authorizedUrl) reasons.push("missing_partner_authorized_cj_url");
  if (!ctx.hasOfferSignal) reasons.push("missing_coupon_or_promo_signal");
  if (!ctx.hasTerms) reasons.push("missing_conditions");
  if (!ctx.hasValidity) reasons.push("missing_validity_window");
  if (!ctx.confidence) reasons.push("confidence_too_low");
  if (!ctx.czUsable) reasons.push("not_cz_usable");
  if (ctx.forged) reasons.push("forged_or_spoofed_email");
  if (ctx.paragonHold) reasons.push("paragon_hold");
  if (ctx.conflict) reasons.push("conflict_with_cj");
  if (!ctx.armed) reasons.push("email_offer_staging_not_armed");
  return reasons;
}

/**
 * Reconcile AI/email offer events against CJ staging links + optional partner authorized URLs.
 * Returns corroboration, email-only publishable staging links, HOLD rows. Does not mutate partners.
 */
export function reconcileEmailOffersWithCjStaging(opts = {}) {
  const events = Array.isArray(opts.events) ? opts.events : [];
  const links = Array.isArray(opts.stagingLinks) ? opts.stagingLinks : [];
  const joined = buildJoinedAdvertiserSet(opts);
  const authorized = buildPartnerAuthorizedUrlMap(opts);
  const armed = opts.emailOfferStagingArmed === true;
  const paragonHold = new Set(
    (opts.paragonHoldIds || []).map((x) => isPlausibleCjAdvertiserId(x)).filter(Boolean)
  );
  const testFixtureMode = opts.testFixtureMode === true;

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
  const emailOnlyPublishable = [];
  const holds = [];
  const conflicts = [];
  const skipped = [];
  let emailOnlyPublishBlocked = 0;
  let emailOnlyPublishArmed = 0;
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

    if (ev.forged === true || ev.spoofed === true || String(ev.trust || "").toLowerCase() === "forged") {
      holds.push({
        uid: ev.uid ?? null,
        advertiserId: adv,
        eventType: type,
        contentState: EMAIL_CONTENT_STATE.HOLD,
        reason: "forged_or_spoofed_email",
        couponCode: code || null,
        mutate: false,
        publishArmed: false,
      });
      continue;
    }

    if (paragonHold.has(adv)) {
      holds.push({
        uid: ev.uid ?? null,
        advertiserId: adv,
        eventType: type,
        contentState: EMAIL_CONTENT_STATE.HOLD,
        reason: "paragon_hold",
        couponCode: code || null,
        mutate: false,
        publishArmed: false,
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
      // Conflict: explicit conflict flag or contradictory discount labels for same code
      const emailDiscount = ev.discountLabel || ev.discount || null;
      const cjDiscount = primary?.linkName || primary?.description || null;
      if (
        ev.conflictWithCj === true ||
        (emailDiscount &&
          cjDiscount &&
          String(emailDiscount).trim().toLowerCase() !== String(cjDiscount).trim().toLowerCase() &&
          ev.forceDiscountConflict === true)
      ) {
        conflicts.push({
          uid: ev.uid ?? null,
          advertiserId: adv,
          couponCode: code,
          contentState: EMAIL_CONTENT_STATE.HOLD,
          decision: "CONFLICT_CJ_EMAIL",
          reason: "conflicting_terms_or_discount",
          mutate: false,
          publishArmed: false,
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

    // Email-only path (no matching CJ promotions link for this code).
    const partnerUrl = authorized.get(adv) || null;
    const hasOfferSignal =
      Boolean(code) ||
      type === AI_EVENT_TYPE.PROMO_NEW ||
      type === AI_EVENT_TYPE.OFFER_CHANGED ||
      type === AI_EVENT_TYPE.PRODUCT_NEW;
    const hasTerms = Boolean(
      String(ev.termsSummary || ev.conditionsSummary || ev.conditions || "").trim()
    );
    const hasValidity = Boolean(ev.validTo || ev.validThrough || ev.endDate || ev.expiresAt);
    const czUsable = ev.czUsable !== false && ev.czUsable !== "false";
    const gateCtx = {
      joined: true,
      authorizedUrl: Boolean(partnerUrl && isCjTrackingUrl(partnerUrl)),
      hasOfferSignal,
      hasTerms,
      hasValidity,
      confidence: confidenceOk(ev.confidence),
      czUsable,
      forged: false,
      paragonHold: false,
      conflict: ev.conflictWithCj === true,
      armed,
    };
    const gateFails = emailOnlyGateReasons(ev, gateCtx);

    if (gateFails.length === 0) {
      const kind =
        code || type === AI_EVENT_TYPE.COUPON_NEW || type === AI_EVENT_TYPE.COUPON_EXPIRED
          ? "coupon"
          : "action";
      const linkId = `email-${adv}-${ev.uid != null ? ev.uid : "x"}-${code || kind}`;
      const stagingLink = {
        advertiserId: adv,
        advertiserName: ev.partnerName || null,
        linkId,
        linkName: ev.title || ev.productHint || (code ? `Email coupon ${code}` : "Email promo"),
        description: String(ev.termsSummary || ev.conditionsSummary || "").slice(0, 500),
        couponCode: code || null,
        clickUrl: partnerUrl,
        promotionType: kind === "coupon" ? "coupon" : "sale",
        linkType: kind === "coupon" ? "Coupon" : "Text Link",
        startDate: ev.validFrom || ev.startDate || null,
        endDate: ev.validTo || ev.validThrough || ev.endDate || ev.expiresAt || null,
        sourceSystem: "email_plus_partner_authorized_cj_url",
        emailUid: ev.uid ?? null,
        fixtureOnly: testFixtureMode === true || ev.fixtureOnly === true,
        publicationCandidate: true,
      };
      emailOnlyPublishArmed += 1;
      emailOnlyPublishable.push({
        uid: ev.uid ?? null,
        advertiserId: adv,
        eventType: type,
        couponCode: code || null,
        kind,
        affiliateUrl: partnerUrl,
        sources: ["email", "partner_authorized_cj_url"],
        contentState: EMAIL_CONTENT_STATE.PUBLISHED,
        decision: "EMAIL_ONLY_PUBLISH_WITH_PARTNER_AUTHORIZED_URL",
        mutate: false,
        publishArmed: true,
        emailOfferStagingArmed: true,
        stagingLink,
        note:
          "Email-only offer published using partner main-button/managed authorized CJ tracking URL; email never supplies the click URL",
      });
      continue;
    }

    emailOnlyPublishBlocked += 1;
    holds.push({
      uid: ev.uid ?? null,
      advertiserId: adv,
      eventType: type,
      couponCode: code || null,
      productHint: ev.productHint || null,
      contentState: EMAIL_CONTENT_STATE.HOLD,
      decision: "EMAIL_ONLY_HOLD",
      reason: gateFails[0],
      gateFails,
      mutate: false,
      publishArmed: false,
      requiresCjLinkSearchRefresh: !gateCtx.authorizedUrl,
      note:
        gateFails[0] === "email_offer_staging_not_armed"
          ? "Gates otherwise OK but staging arm required for email-only publish"
          : "Authorized email-only offers stay in HOLD until all safety gates pass",
    });
  }

  return {
    schema: PHASE3R_EMAIL_OFFER_RECONCILE_SCHEMA,
    ok: true,
    mutatePartnersFromEmailAlone: false,
    emailNeverBypassesJoined: true,
    emailNeverReplacesCjTrackingUrl: true,
    emailMayUsePartnerAuthorizedCjUrl: true,
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
      emailOnlyPublishArmed,
      emailOnlyPublishable: emailOnlyPublishable.length,
    },
    corroborated: corroborated.slice(0, 200),
    emailOnlyPublishable: emailOnlyPublishable.slice(0, 200),
    emailOnlyStagingLinks: emailOnlyPublishable
      .filter((r) => r.stagingLink && r.stagingLink.fixtureOnly !== true)
      .map((r) => r.stagingLink)
      .slice(0, 200),
    holds: holds.slice(0, 200),
    conflicts: conflicts.slice(0, 50),
    skipped: skipped.slice(0, 50),
  };
}
