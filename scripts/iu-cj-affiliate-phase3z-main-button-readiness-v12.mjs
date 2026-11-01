#!/usr/bin/env node
/**
 * Phase 3Z V12 — CJ-FIRST main button readiness (MAIN_BUTTON_READY).
 *
 * Independent of CONTENT_VERIFIED / merchant-web crawl / coupons / product feeds.
 * PUBLIC_SWAP stays DISARMED unless an explicit external GO arms it.
 */
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

export const PHASE3Z_MAIN_BUTTON_SCHEMA = "iu-cj-affiliate-phase3z-main-button-readiness-v12";

export const MAIN_BUTTON_STATUS = Object.freeze({
  MAIN_BUTTON_READY: "MAIN_BUTTON_READY",
  MISSING_AUTHORIZED_LINK: "MISSING_AUTHORIZED_LINK",
  UNSUITABLE_CUSTOMER_DESTINATION: "UNSUITABLE_CUSTOMER_DESTINATION",
  SECTION_UNRESOLVED: "SECTION_UNRESOLVED",
  NOT_JOINED: "NOT_JOINED",
  ENDED_CONFIRMED: "ENDED_CONFIRMED",
  DUPLICATE_MAIN_BUTTON: "DUPLICATE_MAIN_BUTTON",
  ORDINARY_PROMO_BANNED: "ORDINARY_PROMO_BANNED",
  IDENTITY_AMBIGUOUS: "IDENTITY_AMBIGUOUS",
  TECHNICAL_INVALID: "TECHNICAL_INVALID",
});

export const MAIN_BUTTON_DIAG = Object.freeze({
  MERCHANT_WEB_HTTP_403: "MERCHANT_WEB_HTTP_403",
  MERCHANT_WEB_HTTP_429: "MERCHANT_WEB_HTTP_429",
  MERCHANT_WEB_CAPTCHA: "MERCHANT_WEB_CAPTCHA",
  MERCHANT_WEB_UNAVAILABLE: "MERCHANT_WEB_UNAVAILABLE",
  MISSING_PRODUCT_FEED: "MISSING_PRODUCT_FEED",
  MISSING_COUPONS: "MISSING_COUPONS",
  MISSING_WELCOME_EMAIL: "MISSING_WELCOME_EMAIL",
  CONTENT_NOT_VERIFIED: "CONTENT_NOT_VERIFIED",
  ASSORTMENT_WEIGHT_INSUFFICIENT: "ASSORTMENT_WEIGHT_INSUFFICIENT",
  SEM_BRAND_BID_RESTRICTED: "SEM_BRAND_BID_RESTRICTED",
  COUPON_PARTNER_RESTRICTED: "COUPON_PARTNER_RESTRICTED",
  EMAIL_UNTRUSTED_ASSIGNMENT: "EMAIL_UNTRUSTED_ASSIGNMENT",
  EMAIL_STALE_VS_CJ_TERMS: "EMAIL_STALE_VS_CJ_TERMS",
  CRAWL_HOLD_IGNORED_FOR_MAIN_BUTTON: "CRAWL_HOLD_IGNORED_FOR_MAIN_BUTTON",
  CJ_TRACKING_REDIRECT_OK: "CJ_TRACKING_REDIRECT_OK",
  API_FAILURE_PRESERVE: "API_FAILURE_PRESERVE",
  INCOMPLETE_SNAPSHOT_NO_MASS_DELETE: "INCOMPLETE_SNAPSHOT_NO_MASS_DELETE",
});

/** Destinations that still block ordinary main-button promo (not crawl noise). */
const HARD_BLOCK_DEST = new Set([
  "CHECKOUT",
  "CART",
  "AFFILIATE_SIGNUP",
  "NEWSLETTER",
  "LOGIN",
  "REGISTRATION",
  "ERROR_PAGE",
  "UNRELATED_DESTINATION",
]);

/** Crawl / probe holds that must NOT block MAIN_BUTTON_READY under CJ-FIRST. */
const CRAWL_ONLY_HOLDS = new Set([
  "url_http_403_forbidden",
  "url_http_429_rate_limited",
  "url_http_5xx_temporary",
  "url_http_502",
  "url_http_503",
  "url_timeout",
  "CZ_ELIGIBILITY_UNKNOWN",
  "cz_suitability_not_proven",
  "CONTENT_UNAVAILABLE",
  "ASSORTMENT_WEIGHT_INSUFFICIENT",
]);

/**
 * Known CJ-FIRST section overrides when taxonomy already has an honest existing tile.
 * Allegro: baked catalog + SEO already place marketplace under Inzerce a bazary (online tržiště).
 */
export const CJ_FIRST_SECTION_OVERRIDES = Object.freeze({
  "6464420": {
    sectionId: "aff-inzerce-bazary",
    reason: "cj_first_marketplace_existing_tile_online_trziste",
    sources: ["catalog_bake:aff-inzerce-bazary", "section_seo:online_trziste", "merchant_type:MARKETPLACE"],
  },
});

/**
 * True when destination type is a hard customer-target failure for a main button.
 * EXTERNAL_TRACKER alone is NOT a hard block when the click URL is an authorized CJ tracker
 * (legitimate CJ redirect hosts must not be rejected solely for domain).
 */
export function isHardUnsuitableMainButtonDestination({
  destinationType = "",
  selectedClickUrl = "",
  unsuitableMainDestination = false,
  holdReason = "",
} = {}) {
  const dest = String(destinationType || "");
  const hold = String(holdReason || "");
  if (HARD_BLOCK_DEST.has(dest)) {
    return { blocked: true, reason: "destination_type:" + dest };
  }
  if (hold === "UNSUITABLE_MAIN_DESTINATION" && HARD_BLOCK_DEST.has(dest)) {
    return { blocked: true, reason: "hold:" + hold + ":" + dest };
  }
  if (dest === "EXTERNAL_TRACKER") {
    if (isCjTrackingUrl(String(selectedClickUrl || ""))) {
      return { blocked: false, reason: null, note: MAIN_BUTTON_DIAG.CJ_TRACKING_REDIRECT_OK };
    }
    return { blocked: true, reason: "external_tracker_without_cj_click" };
  }
  // Legacy flag without typed destination: only trust when hold explicitly unsuitable AND no CJ click.
  if (unsuitableMainDestination === true && !isCjTrackingUrl(String(selectedClickUrl || ""))) {
    return { blocked: true, reason: "unsuitable_flag_without_cj_click" };
  }
  if (unsuitableMainDestination === true && HARD_BLOCK_DEST.has(dest)) {
    return { blocked: true, reason: "unsuitable_flag:" + dest };
  }
  // unsuitableMainDestination true solely due to EXTERNAL_TRACKER + CJ click → allow
  if (unsuitableMainDestination === true && dest === "EXTERNAL_TRACKER" && isCjTrackingUrl(String(selectedClickUrl || ""))) {
    return { blocked: false, reason: null, note: MAIN_BUTTON_DIAG.CJ_TRACKING_REDIRECT_OK };
  }
  if (unsuitableMainDestination === true && !dest) {
    // Unknown typed dest with unsuitable flag — keep conservative block
    return { blocked: true, reason: "unsuitable_flag_untyped" };
  }
  return { blocked: false, reason: null };
}

/**
 * Resolve section for main button: partner.sectionId, else CJ-FIRST override, else null.
 */
export function resolveMainButtonSection(partner, emailHint = null) {
  const advId = String(partner?.advertiserId || partner?.advertiserCid || "");
  const override = CJ_FIRST_SECTION_OVERRIDES[advId] || null;
  const emailSection =
    emailHint?.trusted === true && emailHint?.suggestedSectionId
      ? String(emailHint.suggestedSectionId)
      : null;
  const existing = partner?.sectionId ? String(partner.sectionId) : null;
  if (existing && existing !== "UNASSIGNED") {
    return {
      sectionId: existing,
      source: partner?.sectionSource || partner?.assignmentSource || "registry_section",
      evidence: ["partner.sectionId"],
    };
  }
  if (override?.sectionId) {
    return {
      sectionId: override.sectionId,
      source: "cj_first_section_override",
      evidence: override.sources || [override.reason],
      overrideReason: override.reason,
    };
  }
  if (emailSection) {
    return {
      sectionId: emailSection,
      source: "trusted_email_assortment",
      evidence: ["email_hint:" + (emailHint?.sourceMessageId || "fixture")],
    };
  }
  return { sectionId: null, source: "unresolved", evidence: [] };
}

/**
 * Evaluate MAIN_BUTTON_READY for one JOINED-capable partner row.
 * @param {object} partner
 * @param {object|null} opts.emailHint — from main-button email hints (optional)
 * @param {Set<string>|null} opts.seenAdvertiserIds — duplicate detector while attaching
 */
export function evaluateMainButtonReadiness(partner, opts = {}) {
  const emailHint = opts.emailHint || null;
  const seen = opts.seenAdvertiserIds || null;
  const advId = String(partner?.advertiserId || "");
  const rel = String(partner?.relationshipStatus || "").toLowerCase();
  const click = String(partner?.selectedClickUrl || partner?.clickUrl || "");
  const hold = String(partner?.holdReason || "");
  const destType = String(partner?.destinationType || partner?.destinationRole || "");
  const diagnostics = [];
  const blockers = [];

  if (rel === "ended" || hold === "ENDED_CONFIRMED" || partner?.endedConfirmed === true) {
    return {
      mainButtonReady: false,
      status: MAIN_BUTTON_STATUS.ENDED_CONFIRMED,
      sectionId: partner?.sectionId || null,
      blockers: ["ended_confirmed"],
      diagnostics,
      sources: ["relationship:" + rel],
      note: "Confirmed ENDED — LKG must not keep unauthorized active main button.",
    };
  }
  if (rel !== "joined") {
    return {
      mainButtonReady: false,
      status: MAIN_BUTTON_STATUS.NOT_JOINED,
      sectionId: partner?.sectionId || null,
      blockers: ["not_joined:" + (rel || "missing")],
      diagnostics,
      sources: ["relationship:" + rel],
      note: "Main button requires current JOINED cooperation.",
    };
  }
  if (!advId) {
    return {
      mainButtonReady: false,
      status: MAIN_BUTTON_STATUS.IDENTITY_AMBIGUOUS,
      sectionId: null,
      blockers: ["missing_advertiser_id"],
      diagnostics,
      sources: [],
      note: "Partner identity requires CJ advertiser ID.",
    };
  }
  if (seen && seen.has(advId)) {
    return {
      mainButtonReady: false,
      status: MAIN_BUTTON_STATUS.DUPLICATE_MAIN_BUTTON,
      sectionId: partner?.sectionId || null,
      blockers: ["duplicate_advertiser_id:" + advId],
      diagnostics,
      sources: ["advertiserId"],
      note: "One CJ advertiser ID = one main button.",
    };
  }

  // Email / terms: SEM brand-bid and coupon-partner limits must NOT block ordinary main button.
  if (emailHint?.semBrandBidRestricted === true) {
    diagnostics.push(MAIN_BUTTON_DIAG.SEM_BRAND_BID_RESTRICTED);
  }
  if (emailHint?.couponPartnerRestricted === true) {
    diagnostics.push(MAIN_BUTTON_DIAG.COUPON_PARTNER_RESTRICTED);
  }
  if (emailHint?.ordinaryPromoBanned === true) {
    blockers.push("ordinary_promo_banned");
    return {
      mainButtonReady: false,
      status: MAIN_BUTTON_STATUS.ORDINARY_PROMO_BANNED,
      sectionId: partner?.sectionId || null,
      blockers,
      diagnostics,
      sources: ["email_or_terms"],
      note: "Documented ban on ordinary affiliate promotion.",
    };
  }
  if (emailHint && emailHint.trusted === false) {
    diagnostics.push(MAIN_BUTTON_DIAG.EMAIL_UNTRUSTED_ASSIGNMENT);
  }
  if (emailHint?.staleVsCjTerms === true) {
    diagnostics.push(MAIN_BUTTON_DIAG.EMAIL_STALE_VS_CJ_TERMS);
  }
  if (!emailHint) {
    diagnostics.push(MAIN_BUTTON_DIAG.MISSING_WELCOME_EMAIL);
  }

  // Crawl-derived signals: record, never block.
  if (CRAWL_ONLY_HOLDS.has(hold)) {
    diagnostics.push(MAIN_BUTTON_DIAG.CRAWL_HOLD_IGNORED_FOR_MAIN_BUTTON);
    diagnostics.push("crawl_hold:" + hold);
  }
  if (partner?.contentStatus && partner.contentStatus !== "CONTENT_VERIFIED") {
    diagnostics.push(MAIN_BUTTON_DIAG.CONTENT_NOT_VERIFIED);
  }
  if (partner?.publicationReady === false) {
    diagnostics.push("legacy_publication_ready_false_ignored");
  }
  // Explicit non-blocking merchant-web / feed / coupon absences
  for (const d of opts.forcedDiagnostics || []) diagnostics.push(d);

  if (!click || !isCjTrackingUrl(click)) {
    blockers.push(click ? "click_not_cj_authorized" : "missing_selected_click_url");
    return {
      mainButtonReady: false,
      status: MAIN_BUTTON_STATUS.MISSING_AUTHORIZED_LINK,
      sectionId: partner?.sectionId || null,
      blockers,
      diagnostics,
      sources: ["selectedClickUrl"],
      note: "Authorized CJ tracking click URL required for main button.",
    };
  }

  const destGate = isHardUnsuitableMainButtonDestination({
    destinationType: destType,
    selectedClickUrl: click,
    unsuitableMainDestination: partner?.unsuitableMainDestination === true,
    holdReason: hold,
  });
  if (destGate.note) diagnostics.push(destGate.note);
  if (destGate.blocked) {
    blockers.push(destGate.reason);
    return {
      mainButtonReady: false,
      status: MAIN_BUTTON_STATUS.UNSUITABLE_CUSTOMER_DESTINATION,
      sectionId: partner?.sectionId || null,
      blockers,
      diagnostics,
      sources: ["destinationType:" + destType],
      note: "Customer destination unsuitable for ordinary main-button promo.",
    };
  }

  const section = resolveMainButtonSection(partner, emailHint);
  if (!section.sectionId) {
    blockers.push("section_unresolved");
    return {
      mainButtonReady: false,
      status: MAIN_BUTTON_STATUS.SECTION_UNRESOLVED,
      sectionId: null,
      blockers,
      diagnostics,
      sources: section.evidence || [],
      note: "No existing InfoUzel section resolved for partner.",
    };
  }

  // Technical validity: display name + section + click
  const display = String(partner?.displayNameCs || partner?.cjName || partner?.advertiserName || "").trim();
  if (!display) {
    blockers.push("missing_display_name");
    return {
      mainButtonReady: false,
      status: MAIN_BUTTON_STATUS.TECHNICAL_INVALID,
      sectionId: section.sectionId,
      blockers,
      diagnostics,
      sources: ["displayName"],
      note: "Main button record missing display name.",
    };
  }

  return {
    mainButtonReady: true,
    status: MAIN_BUTTON_STATUS.MAIN_BUTTON_READY,
    sectionId: section.sectionId,
    sectionSource: section.source,
    blockers: [],
    diagnostics,
    sources: [
      "relationship:joined",
      "cj_tracking_click",
      "section:" + section.source,
      ...(emailHint?.trusted ? ["email_hint_trusted"] : []),
    ],
    emailHintsApplied: Boolean(emailHint?.trusted),
    note: "CJ-FIRST main button eligible; PUBLIC_SWAP remains DISARMED until explicit GO.",
  };
}

/**
 * Attach MAIN_BUTTON_READY evaluation to every registry partner.
 * Does not arm public swap. Does not mutate legacy publicationReady semantics.
 */
export function attachMainButtonReadiness(registry, { emailHintsByAdvertiserId = null } = {}) {
  const hintMap =
    emailHintsByAdvertiserId instanceof Map
      ? emailHintsByAdvertiserId
      : new Map(
          Object.entries(emailHintsByAdvertiserId || {}).map(([k, v]) => [String(k), v])
        );
  const seen = new Set();
  let mainButtonReady = 0;
  let missing = 0;
  const byStatus = {};
  const remainingBlockers = [];

  for (const p of registry?.partners || []) {
    const advId = String(p.advertiserId || "");
    const hint = hintMap.get(advId) || null;
    const evald = evaluateMainButtonReadiness(p, { emailHint: hint, seenAdvertiserIds: seen });
    if (advId && String(p.relationshipStatus || "").toLowerCase() === "joined") {
      seen.add(advId);
    }
    // Persist CJ-FIRST section when registry section was null but override resolved one.
    if (evald.mainButtonReady && evald.sectionId && !p.sectionId) {
      p.sectionId = evald.sectionId;
      p.sectionSource = evald.sectionSource || "cj_first_section_override";
      p.cjFirstSectionApplied = true;
    }
    p.mainButtonReadiness = evald;
    p.mainButtonReady = evald.mainButtonReady === true;
    p.mainButtonStatus = evald.status;
    const st = evald.status;
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (evald.mainButtonReady) mainButtonReady += 1;
    else if (String(p.relationshipStatus || "").toLowerCase() === "joined") {
      missing += 1;
      remainingBlockers.push({
        advertiserId: advId,
        name: p.displayNameCs || p.cjName || p.advertiserName || "",
        status: evald.status,
        blockers: evald.blockers,
        holdReason: p.holdReason || null,
        destinationType: p.destinationType || null,
      });
    }
  }

  const joined = (registry?.partners || []).filter(
    (p) => String(p.relationshipStatus || "").toLowerCase() === "joined"
  ).length;

  registry.mainButtonSummary = {
    schema: PHASE3Z_MAIN_BUTTON_SCHEMA,
    joined,
    mainButtonReady,
    missingMainButtons: missing,
    coveragePct: joined ? Math.round((mainButtonReady / joined) * 10000) / 100 : 0,
    byStatus,
    remainingBlockers,
    duplicates: byStatus[MAIN_BUTTON_STATUS.DUPLICATE_MAIN_BUTTON] || 0,
    publicButtonSwapArmed: false,
    merchantWebCrawlRequiredForMainButton: false,
    couponProductRefactor: "DEFERRED",
    note: "MAIN_BUTTON_READY is CJ-FIRST and independent of CONTENT_VERIFIED. PUBLIC_SWAP DISARMED.",
  };
  // Keep swap flag explicit on registry root
  if (registry.publicButtonSwapArmed !== false) registry.publicButtonSwapArmed = false;
  return registry.mainButtonSummary;
}

/**
 * Lifecycle helpers (pure) for tests — no I/O.
 */
export function applyLifecycleEvent(state, event) {
  const s = { ...(state || {}), publicButtonSwapArmed: false };
  const ev = String(event || "");
  switch (ev) {
    case "JOINED":
    case "NEW_JOINED":
    case "REJOINED":
      return { ...s, relationshipStatus: "joined", endedConfirmed: false, action: "ADD_OR_RESTORE_MAIN_BUTTON" };
    case "NAME_CHANGED":
      return { ...s, action: "UPDATE_EXISTING" };
    case "LINK_CHANGED":
      return { ...s, action: "UPDATE_AUTHORIZED_LINK" };
    case "CATEGORY_CHANGED":
      return { ...s, action: "RECLASSIFY" };
    case "ENDED_CONFIRMED":
      return { ...s, relationshipStatus: "ended", endedConfirmed: true, action: "REMOVE_MAIN_BUTTON" };
    case "API_FAILURE":
      return { ...s, action: "PRESERVE_SAFE_STATE", diagnostics: [MAIN_BUTTON_DIAG.API_FAILURE_PRESERVE] };
    case "INCOMPLETE_SNAPSHOT":
      return {
        ...s,
        action: "NO_MASS_DELETE",
        diagnostics: [MAIN_BUTTON_DIAG.INCOMPLETE_SNAPSHOT_NO_MASS_DELETE],
      };
    case "EMAIL_UNAVAILABLE":
      return { ...s, action: "CONTINUE_WITH_CJ", diagnostics: [MAIN_BUTTON_DIAG.MISSING_WELCOME_EMAIL] };
    case "MERCHANT_WEB_UNAVAILABLE":
      return { ...s, action: "NO_MAIN_BUTTON_BLOCK", diagnostics: [MAIN_BUTTON_DIAG.MERCHANT_WEB_UNAVAILABLE] };
    case "PUBLICATION_FAILURE":
      return { ...s, action: "ROLLBACK", publicButtonSwapArmed: false };
    case "REPEATED_RUN":
      return { ...s, action: "IDEMPOTENT" };
    default:
      return { ...s, action: "NOOP" };
  }
}
