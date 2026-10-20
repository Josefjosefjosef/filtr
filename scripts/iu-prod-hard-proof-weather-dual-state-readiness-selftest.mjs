import {
  evaluateWeatherSetupControlsVisible,
  evaluateWeatherSetupStateGate,
  evaluateWeatherReadyStateGate,
  evaluateWeatherStackFitsViewport,
  evaluateWeatherSetupToReadyReallocationOk,
  weatherSlotMaxHeightCapIsActive,
} from "./iu-prod-hard-proof-weather-dual-state-readiness.mjs";

function must(cond, label) {
  if (!cond) {
    console.error("IU_PROD_HARD_PROOF_WEATHER_DUAL_STATE_READINESS_SELFTEST_FAIL=" + label);
    process.exit(1);
  }
}

must(
  evaluateWeatherSetupControlsVisible({ phase: "firstVisit", compactPromptVisible: true }) === true,
  "firstVisit_compact_prompt"
);
must(
  evaluateWeatherSetupControlsVisible({ phase: "firstVisit", compactPromptVisible: false, actionsFallbackVisible: true }) ===
    false,
  "firstVisit_rejects_hidden_actions_only"
);
must(
  evaluateWeatherStackFitsViewport({ slotMaxHeightCapActive: false, foldOk: true, overflowDelta: 400 }) === true,
  "document_scroll_fold_ok"
);
must(
  evaluateWeatherStackFitsViewport({ slotMaxHeightCapActive: true, foldOk: true, overflowDelta: 0 }) === true,
  "capped_slot_fits"
);
must(
  evaluateWeatherStackFitsViewport({ slotMaxHeightCapActive: true, foldOk: true, overflowDelta: 8 }) === false,
  "capped_slot_overflow_fail"
);
must(
  evaluateWeatherSetupStateGate({
    layout: "setup",
    phase: "firstVisit",
    compactPromptVisible: true,
    slotMaxHeightCapActive: false,
    foldOk: true,
    overflowDelta: 200,
  }) === true,
  "setup_gate_firstVisit_document_scroll"
);
must(
  evaluateWeatherSetupStateGate({
    layout: "setup",
    phase: "firstVisit",
    compactPromptVisible: false,
    slotMaxHeightCapActive: false,
    foldOk: true,
    overflowDelta: 0,
  }) === false,
  "setup_gate_negative_no_prompt"
);
must(
  evaluateWeatherReadyStateGate({
    layout: "ready",
    actionsFallbackVisible: false,
    slotMaxHeightCapActive: false,
    foldOk: true,
    overflowDelta: 300,
  }) === true,
  "ready_gate_document_scroll"
);
must(
  evaluateWeatherSetupToReadyReallocationOk({ wxH: 120, thirdH: 400 }, { wxH: 70, thirdH: 500 }) === true,
  "reallocation_ok"
);
must(
  evaluateWeatherSetupToReadyReallocationOk(
    { wxH: 64, thirdH: 1055, slotMaxHeightCapActive: false },
    { wxH: 58, thirdH: 1055, slotMaxHeightCapActive: false, phase: "data" }
  ) === true,
  "reallocation_document_scroll_wx_shrink"
);
must(weatherSlotMaxHeightCapIsActive(600, 640, 664) === true, "slot_cap_active");
must(weatherSlotMaxHeightCapIsActive(2000, 640, 664) === false, "slot_cap_inactive_document_scroll");

console.log("IU_PROD_HARD_PROOF_WEATHER_DUAL_STATE_READINESS_SELFTEST_PASS=true");
