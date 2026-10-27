#!/usr/bin/env node
/**
 * Phase 3R — AI events → CJ reconcile bridge (staging / DISARMED).
 *
 * CJ API is the only authority for partner state.
 * Email/AI never alone add/remove partner, button, coupon, or product.
 * Paid/manual-protected slots are never touched.
 */
import { AI_EVENT_TYPE } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";
import {
  LIFECYCLE_ACTION,
  assertEndedRemovalAllowed,
  applyConfirmedEndedAtomic,
} from "./iu-cj-affiliate-phase3m-unified-lifecycle-v1.mjs";
import {
  resolveCjApiConfig,
  cjApiHttpGet,
  readCjPatFromEnv,
} from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import { CJ_ADVERTISER_LOOKUP_BASE } from "./iu-cj-affiliate-phase1-lib.mjs";

export const PHASE3R_RECONCILE_SCHEMA = "iu-cj-affiliate-phase3r-ai-to-cj-reconcile-v1";

function isPaidOrProtected(slot = {}) {
  const m = String(slot.management || slot.policy || "").toUpperCase();
  return (
    m === "MANUAL_PROTECTED" ||
    m === "PAID_RESERVED" ||
    slot.paidReserved === true ||
    slot.manualProtected === true
  );
}

export function planStagingActionFromAiEvent(event = {}, ctx = {}) {
  const base = {
    eventType: event.eventType,
    advertiserId: event.advertiserId || null,
    couponCode: event.couponCode || null,
    confidence: event.confidence || "low",
    mutate: false,
    publishArmed: false,
    liveEnabled: false,
    requiresCjApi: true,
    lifecycleAction: LIFECYCLE_ACTION.EMAIL_HINT_REQUIRES_CJ_RECONCILE,
  };

  if (ctx.duplicate === true) {
    return { ...base, decision: "SKIP_DUPLICATE", reason: "duplicate_email" };
  }
  if (event.eventType === AI_EVENT_TYPE.UNTRUSTED_OR_UNCLEAR) {
    return {
      ...base,
      decision: "MANUAL_REVIEW",
      lifecycleAction: LIFECYCLE_ACTION.MANUAL_REVIEW,
      reason: "untrusted_or_unclear",
    };
  }
  if (ctx.paidProtected === true) {
    return {
      ...base,
      decision: "PROTECTED_SKIP",
      lifecycleAction: LIFECYCLE_ACTION.PROTECTED_SKIP,
      reason: "paid_or_manual_protected",
    };
  }

  switch (event.eventType) {
    case AI_EVENT_TYPE.PARTNER_APPROVED:
      return {
        ...base,
        decision: "STAGING_ADD_CANDIDATE",
        planned: "verify_cid_url_section_via_cj_then_add",
        reason: "ai_joined_hint_requires_cj",
      };
    case AI_EVENT_TYPE.PARTNER_ENDED:
      return {
        ...base,
        decision: "STAGING_ENDED_CANDIDATE",
        planned: "confirm_ended_via_cj_then_atomic_remove",
        reason: "ai_ended_hint_requires_cj",
      };
    case AI_EVENT_TYPE.COUPON_NEW:
    case AI_EVENT_TYPE.PROMO_NEW:
      return {
        ...base,
        decision: "STAGING_COUPON_CANDIDATE",
        planned: "verify_coupon_via_cj_link_search",
        reason: "ai_coupon_hint_requires_cj",
      };
    case AI_EVENT_TYPE.COUPON_EXPIRED:
      return {
        ...base,
        decision: "STAGING_EXPIRE_COUPON",
        planned: "expire_coupon_only_after_cj_confirm",
        reason: "ai_coupon_expired_hint",
      };
    case AI_EVENT_TYPE.TERMS_CHANGED:
      return {
        ...base,
        decision: "MANUAL_REVIEW",
        lifecycleAction: LIFECYCLE_ACTION.MANUAL_REVIEW,
        planned: "verify_intended_use_permissions",
        reason: "terms_change_requires_review",
      };
    case AI_EVENT_TYPE.PRODUCT_NEW:
    case AI_EVENT_TYPE.OFFER_CHANGED:
      return {
        ...base,
        decision: "STAGING_PRODUCT_CANDIDATE",
        planned: "verify_price_photo_affiliate_url_via_cj",
        reason: "ai_product_hint_requires_cj",
      };
    default:
      return {
        ...base,
        decision: "INFORMATIONAL_KEEP_LKG",
        lifecycleAction: LIFECYCLE_ACTION.KEEP_LKG,
        reason: "informational",
      };
  }
}

/**
 * Optional live CJ advertiser-lookup verification (read-only).
 * Never publishes. Failures → keep LKG / MANUAL_REVIEW.
 */
export async function verifyAdvertiserViaCjApi(advertiserId, options = {}) {
  const env = options.env || process.env;
  const config = resolveCjApiConfig(env);
  const id = String(advertiserId || "").replace(/\D/g, "");
  if (!id) {
    return { ok: false, verified: false, reason: "missing_advertiser_id", keepLkg: true };
  }
  if (options.simulateOutage) {
    return { ok: false, verified: false, reason: "api_outage", keepLkg: true, incompletePaging: false };
  }
  if (options.simulateIncompletePaging) {
    return {
      ok: false,
      verified: false,
      reason: "incomplete_paging",
      keepLkg: true,
      incompletePaging: true,
    };
  }
  if (options.useMock === true || !config.enabled || !config.httpExecuteArmed) {
    return {
      ok: true,
      verified: false,
      mock: true,
      reason: "cj_http_not_armed_mock_plan_only",
      advertiserId: id,
      keepLkg: true,
    };
  }
  if (!readCjPatFromEnv(env)) {
    return { ok: false, verified: false, reason: "pat_missing", keepLkg: true };
  }

  const url =
    CJ_ADVERTISER_LOOKUP_BASE +
    "?requestor-cid=" +
    encodeURIComponent(String(env.IU_CJ_PUBLISHER_CID || "").trim()) +
    "&advertiser-ids=" +
    encodeURIComponent(id);

  try {
    const res = await cjApiHttpGet(url, env, options);
    if (res?.blocked) {
      return { ok: false, verified: false, reason: res.reason || "blocked", keepLkg: true };
    }
    if (!res?.ok) {
      return {
        ok: false,
        verified: false,
        reason: res?.reason || "cj_api_error",
        keepLkg: true,
        httpStatus: res?.httpStatus || null,
      };
    }
    const body = String(res.body || res.text || "");
    const joined = /<account-status>\s*joined\s*<\/account-status>/i.test(body);
    const ended =
      /<account-status>\s*(notjoined|rejected|removed|declined)\s*<\/account-status>/i.test(body) ||
      /<account-status>\s*ended\s*<\/account-status>/i.test(body);
    return {
      ok: true,
      verified: true,
      advertiserId: id,
      cjStatus: joined ? "joined" : ended ? "ended_or_absent" : "unclear",
      joined,
      endedCandidate: ended,
      keepLkg: !joined && !ended,
    };
  } catch (e) {
    return {
      ok: false,
      verified: false,
      reason: "cj_api_exception",
      keepLkg: true,
      safe: String(e?.message || "").slice(0, 80),
    };
  }
}

/**
 * Apply one AI event through CJ authority path (staging plans; DISARMED publish).
 */
export async function reconcileAiEventWithCj(event = {}, ctx = {}) {
  const plan = planStagingActionFromAiEvent(event, ctx);
  const out = {
    schema: PHASE3R_RECONCILE_SCHEMA,
    ...plan,
    cjVerified: false,
    stagingApplied: false,
    endedRemoved: false,
    rollbackSafe: true,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
  };

  if (plan.decision === "SKIP_DUPLICATE" || plan.decision === "PROTECTED_SKIP") {
    return out;
  }
  if (plan.decision === "MANUAL_REVIEW" || plan.decision === "INFORMATIONAL_KEEP_LKG") {
    return out;
  }

  const cj = await verifyAdvertiserViaCjApi(event.advertiserId, ctx);
  out.cjLookup = {
    verified: cj.verified === true,
    mock: cj.mock === true,
    reason: cj.reason || null,
    cjStatus: cj.cjStatus || null,
  };
  out.cjVerified = cj.verified === true && cj.mock !== true;

  if (cj.incompletePaging || cj.reason === "api_outage" || cj.reason === "incomplete_paging") {
    out.decision = "KEEP_LKG";
    out.lifecycleAction = LIFECYCLE_ACTION.KEEP_LKG;
    out.reason = cj.reason;
    out.keepLkg = true;
    return out;
  }

  if (plan.decision === "STAGING_ENDED_CANDIDATE") {
    const endedCtx = {
      confirmedEnded: cj.endedCandidate === true || ctx.forceConfirmedEnded === true,
      statusUnclear: cj.endedCandidate !== true && ctx.forceConfirmedEnded !== true,
      apiOutage: cj.reason === "api_outage",
      fetchComplete: cj.incompletePaging !== true,
      emailOnly: cj.verified !== true && ctx.forceConfirmedEnded !== true,
    };
    const endedOk = assertEndedRemovalAllowed(endedCtx);
    if (!endedOk?.ok) {
      out.decision = "REJECT_UNSAFE_ENDED";
      out.lifecycleAction = endedOk?.action || LIFECYCLE_ACTION.REJECT_UNSAFE_ENDED;
      out.reason = endedOk?.reason || "ended_not_confirmed_by_cj";
      out.keepLkg = true;
      return out;
    }
    if (ctx.applyStagingEnded === true && Array.isArray(ctx.stagingCatalog)) {
      const applied = applyConfirmedEndedAtomic({
        managedPublic: { partners: ctx.stagingCatalog },
        advertiserId: event.advertiserId,
        offersPublic: ctx.offersPublic || null,
        endedCtx,
      });
      out.stagingApplied = applied?.ok === true;
      out.endedRemoved = applied?.ok === true;
      out.stagingResult = {
        ok: applied?.ok === true,
        action: applied?.action || null,
        liveEnabled: false,
        publishArmed: false,
      };
      out.lifecycleAction = LIFECYCLE_ACTION.REMOVE_ENDED_ATOMIC;
      out.decision = applied?.ok ? "STAGING_ENDED_APPLIED" : "STAGING_ENDED_REJECTED";
      return out;
    }
    out.decision = "STAGING_ENDED_PLAN_ONLY";
    out.reason = "ended_candidate_awaiting_staging_apply_flag";
    return out;
  }

  if (plan.decision === "STAGING_ADD_CANDIDATE") {
    if (cj.joined === true || cj.mock === true || ctx.forceJoined === true) {
      out.decision = cj.mock ? "STAGING_ADD_PLAN_MOCK" : "STAGING_ADD_PLAN";
      out.stagingApplied = false;
      out.reason = "joined_verified_or_mock_plan_no_public_publish";
      return out;
    }
    out.decision = "MANUAL_REVIEW";
    out.lifecycleAction = LIFECYCLE_ACTION.MANUAL_REVIEW;
    out.reason = "joined_not_confirmed";
    return out;
  }

  // Coupons / products: plan only unless explicit staging fixture apply.
  out.decision = plan.decision + "_PLAN";
  out.stagingApplied = false;
  return out;
}

export async function reconcileAiEventBatch(events = [], ctx = {}) {
  const results = [];
  let passedToRobot = 0;
  let verifiedViaCj = 0;
  let stagingAdd = 0;
  let stagingUpdate = 0;
  let stagingEnded = 0;
  let manualReview = 0;
  let protectedSkip = 0;
  let duplicates = 0;

  for (const ev of events) {
    const paid = isPaidOrProtected(ctx.slotByAdvertiserId?.[ev.advertiserId] || {});
    const r = await reconcileAiEventWithCj(ev, { ...ctx, paidProtected: paid });
    results.push(r);
    passedToRobot += 1;
    if (r.cjVerified) verifiedViaCj += 1;
    if (String(r.decision).includes("ADD")) stagingAdd += 1;
    if (String(r.decision).includes("COUPON") || String(r.decision).includes("PRODUCT")) {
      stagingUpdate += 1;
    }
    if (String(r.decision).includes("ENDED")) stagingEnded += 1;
    if (r.decision === "MANUAL_REVIEW") manualReview += 1;
    if (r.decision === "PROTECTED_SKIP") protectedSkip += 1;
    if (r.decision === "SKIP_DUPLICATE") duplicates += 1;
  }

  return {
    schema: PHASE3R_RECONCILE_SCHEMA,
    ok: true,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    mutatePartnersFromEmailAlone: false,
    counts: {
      eventsIn: events.length,
      passedToRobot,
      verifiedViaCjApi: verifiedViaCj,
      stagingAddPlans: stagingAdd,
      stagingUpdatePlans: stagingUpdate,
      stagingEndedPlans: stagingEnded,
      manualReview,
      protectedSkip,
      duplicates,
    },
    results: results.slice(0, 100),
  };
}
