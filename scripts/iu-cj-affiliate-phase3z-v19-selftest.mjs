#!/usr/bin/env node
/**
 * Phase 3Z V19 selftest — EXTERNAL_TRACKER+CJ click, email bridge import, VSC semantics note.
 */
import {
  isUnsuitableMainDestination,
  DESTINATION_TYPE,
  classifyDestinationType,
} from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import { isHardUnsuitableMainButtonDestination } from "./iu-cj-affiliate-phase3z-main-button-readiness-v12.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { proveEmailToCategoryChain } from "./iu-cj-affiliate-phase3z-email-hints-bridge-v19.mjs";
import { AI_EVENT_TYPE } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";

const fails = [];
function expect(name, cond, detail) {
  if (!cond) fails.push({ name, detail: detail || null });
  else console.log("PASS " + name);
}

const FOREO_CLICK = "https://www.tkqlhce.com/click-101883843-17250301-1789489845000";
const NOVAKID_CLICK = "https://www.jdoqocy.com/click-101883843-14509925-1756149393000";
const HERO_CLICK = "https://www.dpbolvw.net/click-101883843-17147755-1760460640000";

expect("foreo_cj_url", isCjTrackingUrl(FOREO_CLICK));
expect("novakid_cj_url", isCjTrackingUrl(NOVAKID_CLICK));
expect("hero_cj_url", isCjTrackingUrl(HERO_CLICK));

for (const [id, click, name] of [
  ["5755636", FOREO_CLICK, "Foreo"],
  ["5578976", NOVAKID_CLICK, "Novakid"],
  ["7520433", HERO_CLICK, "HeroWars"],
]) {
  const u = isUnsuitableMainDestination(DESTINATION_TYPE.EXTERNAL_TRACKER, id, { clickUrl: click });
  expect(name + "_not_unsuitable_with_cj_click", u.unsuitable === false && u.note === "cj_tracking_redirect_ok", u);
  const hard = isHardUnsuitableMainButtonDestination({
    destinationType: "EXTERNAL_TRACKER",
    selectedClickUrl: click,
    unsuitableMainDestination: true,
  });
  expect(name + "_hard_allow_cj", hard.blocked === false, hard);
}

const bare = isUnsuitableMainDestination(DESTINATION_TYPE.EXTERNAL_TRACKER, "5755636", {});
expect("external_without_cj_still_bad", bare.unsuitable === true, bare);

const checkout = isUnsuitableMainDestination(DESTINATION_TYPE.CHECKOUT, "2624620", {
  clickUrl: FOREO_CLICK,
});
expect("checkout_still_hard", checkout.unsuitable === true, checkout);

const g2a = classifyDestinationType("https://g2afse.com/click?x=1", "Hero Wars");
expect("g2afse_classified_external", g2a === DESTINATION_TYPE.EXTERNAL_TRACKER, g2a);

const chain = proveEmailToCategoryChain(
  {
    eventType: AI_EVENT_TYPE.PARTNER_APPROVED,
    advertiserId: "4978487",
    productHint: "móda fashion clothing apparel oblečení",
    source: "v19-selftest",
  },
  { fromTrusted: true, from: "owner-membermessaging@mx6.cj.com", sourceMessageId: "v19-st" }
);
expect("email_chain_synthetic", chain.chainComplete === true, chain);

/** VERIFIED_SAFE_CHANGE semantics (documentation gate). */
const VSC_MEANING = {
  label: "VERIFIED_SAFE_CHANGE",
  means: "overrideApplied === true on registry partner row in V18 dry-run",
  notMeans: "pending_or_executed_category_move",
  v18PublishedMoves: 3,
  v18VscLabeled: 26,
  explanationKinds: [
    "OVERRIDE_ALREADY_MATCHES_PUBLISHED",
    "OVERRIDE_NO_PUBLIC_BUTTON",
    "PUBLISHED_FIXED_REGISTRY_STALE",
  ],
};
expect("vsc_semantics_documented", VSC_MEANING.notMeans === "pending_or_executed_category_move");

if (fails.length) {
  console.error(JSON.stringify({ ok: false, fails }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, VSC_MEANING, chain }, null, 2));
