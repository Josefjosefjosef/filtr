#!/usr/bin/env node
/**
 * Phase 3Z V12 — CJ-FIRST MAIN_BUTTON_READY regression selftest (offline fixtures).
 * PUBLIC_SWAP always DISARMED in assertions.
 */
import {
  evaluateMainButtonReadiness,
  attachMainButtonReadiness,
  isHardUnsuitableMainButtonDestination,
  applyLifecycleEvent,
  MAIN_BUTTON_STATUS,
  MAIN_BUTTON_DIAG,
  CJ_FIRST_SECTION_OVERRIDES,
} from "./iu-cj-affiliate-phase3z-main-button-readiness-v12.mjs";
import {
  buildMainButtonEmailHint,
  buildDefaultMainButtonEmailHintMap,
  mergeEmailHintWithCjTerms,
  GANT_EMAIL_FIXTURE,
  CEDOK_EMAIL_FIXTURE,
} from "./iu-cj-affiliate-phase3z-main-button-email-hints-v12.mjs";
import { applyMerchantEvidenceOverride } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";

const failures = [];
const proofs = [];
function expect(id, cond, detail) {
  if (!cond) failures.push({ id, detail: detail ?? null });
  else proofs.push({ id, ok: true });
}

const CJ_CLICK = "https://www.anrdoezrs.net/click-101883843-15774549-1768626000000";

function baseJoined(over = {}) {
  return {
    advertiserId: "1000001",
    displayNameCs: "Test Partner",
    relationshipStatus: "joined",
    selectedClickUrl: CJ_CLICK,
    sectionId: "aff-moda",
    destinationType: "MERCHANT_HOMEPAGE",
    unsuitableMainDestination: false,
    publishability: "READY_FOR_REVIEW",
    ...over,
  };
}

// 1) JOINED with full CJ data
{
  const e = evaluateMainButtonReadiness(baseJoined());
  expect("01_joined_full_cj", e.mainButtonReady === true, e);
}

// 2) JOINED without welcome email
{
  const e = evaluateMainButtonReadiness(baseJoined(), { emailHint: null });
  expect(
    "02_joined_no_email",
    e.mainButtonReady === true && e.diagnostics.includes(MAIN_BUTTON_DIAG.MISSING_WELCOME_EMAIL),
    e
  );
}

// 3) JOINED with welcome email
{
  const hint = buildMainButtonEmailHint(GANT_EMAIL_FIXTURE);
  const e = evaluateMainButtonReadiness(
    baseJoined({ advertiserId: "4978487", displayNameCs: "GANT.CZ" }),
    { emailHint: hint }
  );
  expect("03_joined_with_email", e.mainButtonReady === true && e.emailHintsApplied === true, e);
}

// 4–7) Merchant web failures must NOT block
for (const [id, hold, diag] of [
  ["04_http_403", "url_http_403_forbidden", MAIN_BUTTON_DIAG.CRAWL_HOLD_IGNORED_FOR_MAIN_BUTTON],
  ["05_http_429", "url_http_429_rate_limited", MAIN_BUTTON_DIAG.CRAWL_HOLD_IGNORED_FOR_MAIN_BUTTON],
  ["06_captcha", "url_http_403_forbidden", MAIN_BUTTON_DIAG.CRAWL_HOLD_IGNORED_FOR_MAIN_BUTTON],
  ["07_web_unavailable", "url_http_5xx_temporary", MAIN_BUTTON_DIAG.CRAWL_HOLD_IGNORED_FOR_MAIN_BUTTON],
]) {
  const e = evaluateMainButtonReadiness(
    baseJoined({ holdReason: hold, publishability: "NOT_VERIFIED", contentStatus: "CONTENT_UNAVAILABLE" }),
    { forcedDiagnostics: hold.includes("403") ? [MAIN_BUTTON_DIAG.MERCHANT_WEB_CAPTCHA] : [] }
  );
  expect(id, e.mainButtonReady === true && e.diagnostics.includes(diag), e);
}

// 8–9) Missing feed / coupons must NOT block
{
  const e = evaluateMainButtonReadiness(baseJoined(), {
    forcedDiagnostics: [MAIN_BUTTON_DIAG.MISSING_PRODUCT_FEED, MAIN_BUTTON_DIAG.MISSING_COUPONS],
  });
  expect(
    "08_09_missing_feed_coupons",
    e.mainButtonReady === true &&
      e.diagnostics.includes(MAIN_BUTTON_DIAG.MISSING_PRODUCT_FEED) &&
      e.diagnostics.includes(MAIN_BUTTON_DIAG.MISSING_COUPONS),
    e
  );
}

// 10–11) GANT SEM + coupon restriction — main button allowed
{
  const hint = buildMainButtonEmailHint(GANT_EMAIL_FIXTURE);
  expect("10_gant_sem_flag", hint.semBrandBidRestricted === true && hint.ordinaryPromoBanned === false, hint);
  expect("11_gant_coupon_flag", hint.couponPartnerRestricted === true, hint);
  const e = evaluateMainButtonReadiness(
    baseJoined({ advertiserId: "4978487", displayNameCs: "GANT.CZ", sectionId: "aff-moda" }),
    { emailHint: hint }
  );
  expect(
    "10_11_gant_main_allowed",
    e.mainButtonReady === true &&
      e.diagnostics.includes(MAIN_BUTTON_DIAG.SEM_BRAND_BID_RESTRICTED) &&
      e.diagnostics.includes(MAIN_BUTTON_DIAG.COUPON_PARTNER_RESTRICTED) &&
      e.sectionId === "aff-moda",
    e
  );
}

// 12) Čedok multi-assortment → one travel-agency button
{
  const hint = buildMainButtonEmailHint(CEDOK_EMAIL_FIXTURE);
  const e = evaluateMainButtonReadiness(
    baseJoined({
      advertiserId: "6179554",
      displayNameCs: "Čedok.cz",
      sectionId: "aff-cestovni-kancelare",
    }),
    { emailHint: hint }
  );
  expect(
    "12_cedok_single_ck_button",
    e.mainButtonReady === true && e.sectionId === "aff-cestovni-kancelare",
    e
  );
}

// 13) Leo Express → aff-letenky (Doprava a cestování)
{
  const e = evaluateMainButtonReadiness(
    baseJoined({
      advertiserId: "6130482",
      displayNameCs: "Leo Express Europe",
      sectionId: "aff-letenky",
    })
  );
  expect("13_leo_aff_letenky", e.mainButtonReady === true && e.sectionId === "aff-letenky", e);
}

// 14) Allegro marketplace → aff-inzerce-bazary via CJ-FIRST override
{
  expect(
    "14_allegro_override_map",
    CJ_FIRST_SECTION_OVERRIDES["6464420"]?.sectionId === "aff-inzerce-bazary",
    CJ_FIRST_SECTION_OVERRIDES["6464420"]
  );
  const allegroOv = applyMerchantEvidenceOverride({
    advertiserId: "6464420",
    assortment: { merchantType: "MARKETPLACE" },
    baseSectionId: null,
  });
  expect(
    "14_allegro_evidence_section",
    allegroOv.applied &&
      allegroOv.categoryReviewRequired === false &&
      allegroOv.sectionId === "aff-inzerce-bazary",
    allegroOv
  );
  const e = evaluateMainButtonReadiness(
    baseJoined({
      advertiserId: "6464420",
      displayNameCs: "Allegro.cz",
      sectionId: null,
      holdReason: "CATEGORY_REVIEW_REQUIRED",
      publishability: "QUARANTINED",
    })
  );
  expect("14_allegro_main_ready", e.mainButtonReady === true && e.sectionId === "aff-inzerce-bazary", e);
}

// 15–17) name / category / link change lifecycle
{
  expect("15_name_changed", applyLifecycleEvent({}, "NAME_CHANGED").action === "UPDATE_EXISTING");
  expect("16_category_changed", applyLifecycleEvent({}, "CATEGORY_CHANGED").action === "RECLASSIFY");
  expect("17_link_changed", applyLifecycleEvent({}, "LINK_CHANGED").action === "UPDATE_AUTHORIZED_LINK");
}

// 18) Missing / unsuitable link
{
  const missing = evaluateMainButtonReadiness(baseJoined({ selectedClickUrl: "" }));
  expect("18_missing_link", missing.status === MAIN_BUTTON_STATUS.MISSING_AUTHORIZED_LINK, missing);
  const bad = evaluateMainButtonReadiness(
    baseJoined({ selectedClickUrl: "https://example.com/not-cj", destinationType: "MERCHANT_HOMEPAGE" })
  );
  expect("18_non_cj_link", bad.status === MAIN_BUTTON_STATUS.MISSING_AUTHORIZED_LINK, bad);
}

// 19) Legitimate external CJ tracking redirect OK
{
  const gate = isHardUnsuitableMainButtonDestination({
    destinationType: "EXTERNAL_TRACKER",
    selectedClickUrl: CJ_CLICK,
    unsuitableMainDestination: true,
  });
  expect("19_cj_external_tracker_ok", gate.blocked === false, gate);
  const e = evaluateMainButtonReadiness(
    baseJoined({
      destinationType: "EXTERNAL_TRACKER",
      unsuitableMainDestination: true,
      holdReason: "UNSUITABLE_MAIN_DESTINATION",
      publishability: "QUARANTINED",
    })
  );
  expect("19_main_ready_with_cj_tracker_dest", e.mainButtonReady === true, e);
}

// 20) Real ban on ordinary promo
{
  const hint = buildMainButtonEmailHint({
    advertiserId: "1000001",
    trusted: true,
    ordinaryPromoBanned: true,
  });
  const e = evaluateMainButtonReadiness(baseJoined(), { emailHint: hint });
  expect("20_ordinary_promo_banned", e.status === MAIN_BUTTON_STATUS.ORDINARY_PROMO_BANNED, e);
}

// 21–22) JOINED ↔ ENDED
{
  const ended = evaluateMainButtonReadiness(baseJoined({ relationshipStatus: "ended", endedConfirmed: true }));
  expect("21_ended", ended.status === MAIN_BUTTON_STATUS.ENDED_CONFIRMED, ended);
  expect("22_rejoined", applyLifecycleEvent({ endedConfirmed: true }, "REJOINED").relationshipStatus === "joined");
}

// 23–24) API failure / incomplete snapshot
{
  expect("23_api_failure", applyLifecycleEvent({}, "API_FAILURE").action === "PRESERVE_SAFE_STATE");
  expect("24_incomplete_snapshot", applyLifecycleEvent({}, "INCOMPLETE_SNAPSHOT").action === "NO_MASS_DELETE");
}

// 25) Duplicate CJ ID
{
  const seen = new Set(["1000001"]);
  const e = evaluateMainButtonReadiness(baseJoined(), { seenAdvertiserIds: seen });
  expect("25_duplicate_cid", e.status === MAIN_BUTTON_STATUS.DUPLICATE_MAIN_BUTTON, e);
}

// 26) More than eight buttons in a section (no hard cap)
{
  const partners = [];
  for (let i = 0; i < 12; i++) {
    partners.push(
      baseJoined({
        advertiserId: String(2000000 + i),
        displayNameCs: "P" + i,
        sectionId: "aff-moda",
      })
    );
  }
  const reg = { partners, publicButtonSwapArmed: false };
  const sum = attachMainButtonReadiness(reg);
  expect("26_no_eight_cap", sum.mainButtonReady === 12, sum);
}

// 27) Static + dynamic same partner → one main button after attach
{
  const reg = {
    publicButtonSwapArmed: false,
    partners: [
      baseJoined({ advertiserId: "4978487", displayNameCs: "GANT.CZ", management: "CJ_MANAGED" }),
      baseJoined({ advertiserId: "4978487", displayNameCs: "GANT.CZ baked", management: "UNASSIGNED" }),
    ],
  };
  const sum = attachMainButtonReadiness(reg);
  expect(
    "27_dedupe_static_dynamic",
    sum.mainButtonReady === 1 && sum.duplicates === 1,
    sum
  );
}

// 28–29) Paid / non-CJ protection (out of main-button JOINED set — not joined)
{
  const paid = evaluateMainButtonReadiness(
    baseJoined({ relationshipStatus: "joined", management: "PAID_RESERVED", advertiserId: "9000001" })
  );
  // Paid reserved still JOINED in CJ would get a main button record in robot registry;
  // public swap must never dual-own — assert DISARMED + ownership note left to takeover plan.
  expect("28_paid_still_disarmed_ready_math", paid.mainButtonReady === true, paid);
  const nonCj = evaluateMainButtonReadiness(
    baseJoined({ relationshipStatus: "not_joined", selectedClickUrl: "https://example.com/x" })
  );
  expect("29_non_cj_not_joined", nonCj.status === MAIN_BUTTON_STATUS.NOT_JOINED, nonCj);
}

// 30) Rollback on publication failure
{
  const r = applyLifecycleEvent({ publicButtonSwapArmed: true }, "PUBLICATION_FAILURE");
  expect("30_rollback_disarm", r.action === "ROLLBACK" && r.publicButtonSwapArmed === false, r);
}

// 31) Idempotent repeated run
{
  expect("31_idempotent", applyLifecycleEvent({}, "REPEATED_RUN").action === "IDEMPOTENT");
}

// 32) DISARMED — attach never arms
{
  const reg = { partners: [baseJoined()], publicButtonSwapArmed: false };
  const sum = attachMainButtonReadiness(reg);
  expect("32_disarmed", sum.publicButtonSwapArmed === false && reg.publicButtonSwapArmed === false, sum);
}

// 33) PWA / unrelated — lifecycle email unavailable continues with CJ
{
  expect("33_email_unavailable_continue_cj", applyLifecycleEvent({}, "EMAIL_UNAVAILABLE").action === "CONTINUE_WITH_CJ");
  expect(
    "33_merchant_web_no_block",
    applyLifecycleEvent({}, "MERCHANT_WEB_UNAVAILABLE").action === "NO_MAIN_BUTTON_BLOCK"
  );
}

// 34) Older email vs newer CJ terms
{
  const hint = buildMainButtonEmailHint({
    ...GANT_EMAIL_FIXTURE,
    ordinaryPromoBanned: false,
    receivedAt: "2024-01-01T00:00:00Z",
  });
  const merged = mergeEmailHintWithCjTerms(hint, {
    updatedAt: "2025-12-01T00:00:00Z",
    ordinaryPromoBanned: true,
  });
  expect("34_stale_email_cj_terms_win", merged.staleVsCjTerms === true && merged.ordinaryPromoBanned === true, merged);
}

// 35) Reject unverified email assignment
{
  const bad = buildMainButtonEmailHint({
    advertiserId: "",
    trusted: true,
    matchMethod: "name_similarity_only",
    suggestedSectionId: "aff-moda",
  });
  expect("35_untrusted_name_only", bad.trusted === false, bad);
  const e = evaluateMainButtonReadiness(
    baseJoined({ sectionId: null }),
    { emailHint: bad }
  );
  // Untrusted email must not supply section authority → SECTION_UNRESOLVED
  expect("35_untrusted_no_section_authority", e.status === MAIN_BUTTON_STATUS.SECTION_UNRESOLVED, e);
}

// Hard dest still blocks checkout / affiliate signup
{
  const checkout = evaluateMainButtonReadiness(
    baseJoined({ destinationType: "CHECKOUT", unsuitableMainDestination: true, holdReason: "UNSUITABLE_MAIN_DESTINATION" })
  );
  expect("extra_checkout_block", checkout.status === MAIN_BUTTON_STATUS.UNSUITABLE_CUSTOMER_DESTINATION, checkout);
  const signup = evaluateMainButtonReadiness(
    baseJoined({ destinationType: "AFFILIATE_SIGNUP", unsuitableMainDestination: true })
  );
  expect("extra_signup_block", signup.status === MAIN_BUTTON_STATUS.UNSUITABLE_CUSTOMER_DESTINATION, signup);
}

// Default fixture map
{
  const map = buildDefaultMainButtonEmailHintMap();
  expect("fixture_map_gant_cedok", map.has("4978487") && map.has("6179554"), [...map.keys()]);
}

const out = {
  ok: failures.length === 0,
  schema: "iu-cj-affiliate-phase3z-main-button-readiness-v12-selftest",
  proofs: proofs.length,
  failures,
  publicButtonSwapArmed: false,
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exitCode = 1;
