#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateFlexRemainderInfoCardsReadiness,
  evaluateSilverFlexRemainderGate,
  isMobileOrTabletHardProofViewport,
  silverSlotMaxHeightCapIsActive,
} from "./iu-prod-hard-proof-silver-flex-remainder-readiness.mjs";
import { evaluateDesktopRightColumnGate } from "./iu-prod-hard-proof-desktop-right-column-readiness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardProof = fs.readFileSync(
  path.join(ROOT, "scripts", "iu_prod_hard_proof_no_mock.mjs"),
  "utf8"
);
const readiness = fs.readFileSync(
  path.join(ROOT, "scripts", "iu-prod-hard-proof-silver-flex-remainder-readiness.mjs"),
  "utf8"
);

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

must(
  evaluateFlexRemainderInfoCardsReadiness({
    infoCardsDisplay: "flex",
    calendarHeightPx: 52,
    tasksHeightPx: 48,
  }).ok === true,
  "expanded_cards_pass"
);
must(
  evaluateFlexRemainderInfoCardsReadiness({
    infoCardsDisplay: "none",
    calendarHeightPx: 0,
    tasksHeightPx: 0,
  }).ok === false,
  "collapsed_cards_fail"
);
must(
  evaluateFlexRemainderInfoCardsReadiness({
    infoCardsDisplay: "block",
    calendarHeightPx: 0,
    tasksHeightPx: 40,
  }).ok === false,
  "zero_calendar_fail"
);

must(isMobileOrTabletHardProofViewport({ group: "mobile", name: "mobileShort" }), "vp_mobile");
must(!isMobileOrTabletHardProofViewport({ name: "desktop" }), "vp_desktop_not");

must(
  silverSlotMaxHeightCapIsActive({
    slotClientHeightPx: 1992,
    slotMaxHeightPx: 640,
    viewportHeightPx: 664,
  }) === false,
  "prod_mobile_slot_not_capped"
);
must(
  silverSlotMaxHeightCapIsActive({
    slotClientHeightPx: 620,
    slotMaxHeightPx: 640,
    viewportHeightPx: 664,
  }) === true,
  "capped_slot_detected"
);

must(
  evaluateSilverFlexRemainderGate({
    slotMaxHeightCapActive: false,
    deltaPx: 67,
    tallHeightPx: 1055,
  }).ok === true,
  "document_scroll_ignores_delta"
);
must(
  evaluateSilverFlexRemainderGate({
    slotMaxHeightCapActive: false,
    deltaPx: 67,
    tallHeightPx: 100,
  }).ok === false,
  "document_scroll_short_third_fail"
);
must(
  evaluateSilverFlexRemainderGate({
    slotMaxHeightCapActive: true,
    deltaPx: 67,
    tallHeightPx: 400,
  }).ok === false,
  "capped_slot_bad_delta_fail"
);
must(
  evaluateSilverFlexRemainderGate({
    slotMaxHeightCapActive: true,
    deltaPx: 8,
    tallHeightPx: 400,
  }).ok === true,
  "capped_slot_ok_delta_pass"
);

must(/evaluateSilverFlexRemainderGate/.test(hardProof), "hard_proof_uses_gate");
must(/silverSlotMaxHeightCapIsActive/.test(hardProof), "hard_proof_cap_helper");
must(/slotClientHeightPx/.test(hardProof), "hard_proof_slot_metrics");

must(/applySilverFlexRemainderReadiness/.test(hardProof), "hard_proof_calls_readiness");
must(/iu-prod-hard-proof-silver-flex-remainder-readiness\.mjs/.test(hardProof), "hard_proof_imports_module");
must(/data-iu-info-cards-expanded/.test(readiness), "readiness_expanded_attr");
must(/iu\.infoCards\.expanded\.v1/.test(readiness), "readiness_ls_key");

must(
  evaluateDesktopRightColumnGate({
    isDesktopBp: true,
    asidePaddingTopPx: 0,
    asideTopY: 92,
    mindMenuVisible: false,
    mindMenuTopY: 0,
    qrVisible: true,
    qrTopY: 92,
    railVisible: true,
    railHeightPx: 568,
    railTopY: 710,
    horizontalOverflow: false,
    leftSilverTopY: 92,
  }).ok === true,
  "desktop_rail_v3_prod_geometry_pass"
);
must(
  evaluateDesktopRightColumnGate({
    isDesktopBp: true,
    asidePaddingTopPx: 0,
    asideTopY: 92,
    mindMenuVisible: false,
    mindMenuTopY: 0,
    qrVisible: false,
    railVisible: false,
    horizontalOverflow: false,
  }).ok === false,
  "desktop_rail_missing_content_fail"
);
must(
  evaluateDesktopRightColumnGate({
    isDesktopBp: true,
    asidePaddingTopPx: 4,
    asideTopY: 92,
    mindMenuVisible: false,
    qrVisible: true,
    qrTopY: 92,
    railVisible: true,
    railHeightPx: 568,
    horizontalOverflow: false,
    leftSilverTopY: 92,
  }).ok === false,
  "desktop_aside_padding_fail"
);
must(
  evaluateDesktopRightColumnGate({
    isDesktopBp: true,
    asidePaddingTopPx: 0,
    asideTopY: 92,
    mindMenuVisible: true,
    mindMenuTopY: 110,
    qrVisible: false,
    railVisible: false,
    horizontalOverflow: false,
  }).ok === false,
  "mindmenu_visible_strip_fail"
);

must(/evaluateDesktopRightColumnGate/.test(hardProof), "hard_proof_desktop_right_gate");
must(/webkit-silver-shell-base/.test(hardProof), "hard_proof_webkit_localhost_prod_fallback");
must(/PROD_WEBKIT_SILVER_READONLY_BASE/.test(hardProof), "hard_proof_webkit_prod_readonly_base");
must(/iu-prod-hard-proof-weather-dual-state-readiness/.test(hardProof), "hard_proof_weather_dual_state_module");
must(/compactPromptVisible/.test(hardProof), "hard_proof_weather_first_visit_compact_prompt");
must(
  /iu-prod-hard-proof-desktop-right-column-readiness\.mjs/.test(hardProof),
  "hard_proof_imports_desktop_right_module"
);

console.log(
  "IU_PROD_HARD_PROOF_SILVER_FLEX_REMAINDER_READINESS_SELFTEST_PASS=" + (fails.length === 0)
);
if (fails.length) {
  console.log("IU_PROD_HARD_PROOF_SILVER_FLEX_REMAINDER_READINESS_SELFTEST_FAILS=" + fails.join(","));
  process.exitCode = 1;
}
