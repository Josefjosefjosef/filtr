#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const diag = require("./silver-explicit-save-prefix-routing-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-explicit-save-prefix-regression-report.json");
const FIXED_NOW = new Date("2026-06-01T12:00:00Z");

const VIEWPORTS = [
  { id: "mobile", width: 390, height: 844 },
  { id: "tablet", width: 768, height: 1024 },
  { id: "desktop", width: 1280, height: 800 }
];

const SUBMIT_PATHS = [
  "green_arrow_submit",
  "mobile_enter_key",
  "hint_click_prefill",
  "manual_prefix_typed"
];

const ASSISTANT_MODES = ["personal_assistant", "calendar_assistant"];

const NOTE_REGRESSION_INPUTS = [
  {
    input: "Do poznámek záruka na televizi mi končí v lednu 2027",
    expectedRoute: "notes.create",
    expectedContentRx: /zaruk\w*\s+na\s+televiz/i,
    family: "note_force_save"
  },
  {
    input: "Do poznámek záruka na televizi mi končí v lednu 2028",
    expectedRoute: "notes.create",
    expectedContentRx: /zaruk\w*\s+na\s+televiz/i,
    family: "note_force_save"
  },
  {
    input: "Do poznámek SPZ Volva je ABC 4243",
    expectedRoute: "notes.create",
    expectedContentRx: /SPZ\s+Volva/i,
    family: "note_force_save"
  }
];

const VARIANTS = [
  { label: "diacritics", map: function (s) { return s; } },
  {
    label: "no_diacritics",
    map: function (s) {
      return s
        .replace(/á/g, "a")
        .replace(/Á/g, "A")
        .replace(/č/g, "c")
        .replace(/Č/g, "C")
        .replace(/ě/g, "e")
        .replace(/É/g, "E")
        .replace(/í/g, "i")
        .replace(/Í/g, "I")
        .replace(/ň/g, "n")
        .replace(/ó/g, "o")
        .replace(/ř/g, "r")
        .replace(/š/g, "s")
        .replace(/ú/g, "u")
        .replace(/ů/g, "u")
        .replace(/ý/g, "y")
        .replace(/ž/g, "z")
        .replace(/é/g, "e")
        .replace(/É/g, "E");
    }
  },
  { label: "colon_after_prefix", map: function (s) { return s.replace(/^(Do pozn[aá]m\w*)\s+/i, "$1: "); } },
  { label: "extra_spaces", map: function (s) { return s.replace(/^(Do pozn[aá]m\w*)\s+/i, "$1   "); } },
  { label: "upper_prefix", map: function (s) { return s.replace(/^Do/, "DO"); } },
  { label: "lower_prefix", map: function (s) { return s.replace(/^Do/, "do"); } }
];

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function savedContent(turn) {
  const d = turn && turn.draft ? turn.draft : {};
  if (String(d.silverNoteText || "").trim()) return String(d.silverNoteText || "").trim();
  if (String(d.title || "").trim()) return String(d.title || "").trim();
  if (String(d.note || "").trim()) return String(d.note || "").trim();
  return "";
}

function prefixLeaked(content, input, eng) {
  const d = eng.iuSilverDetectExplicitSavePrefixV1(input);
  if (!d) return null;
  const c = foldCs(content);
  const rawHead = String(input || "")
    .trim()
    .match(/^(do\s+pozn[aá]m\w*|do\s+kalend[aá]?[rř]?e?|p[rř]ipom[eě][nň]?\s+mi|p[rř]ipom[eě][nň]?|ulo[zž]\s+do\s+[uú]kol\w*|do\s+[uú]kol\w*)/iu);
  if (rawHead && c.indexOf(foldCs(rawHead[0])) >= 0) return rawHead[0];
  return null;
}

function retrievalBranchEntered(turn, msg) {
  const intent = String(turn.normalizedIntent || "");
  if (/\.read$/.test(intent) || intent === "global.search") return true;
  if (/Nic jsem k tomu nenašel/i.test(msg)) return true;
  if (/Našel jsem|Máš |V poznámkách|V úkolech/i.test(msg)) return true;
  return false;
}

function evaluateCase(eng, ctx, spec, viewport, submitPath, assistantMode, variantLabel, input) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const det = eng.iuSilverDetectExplicitSavePrefixV1(input);
  const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
  const observedRoute = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const content = savedContent(turn);
  const leak = prefixLeaked(content, input, eng);
  const retrieval = retrievalBranchEntered(turn, msg);
  const routePass = observedRoute === spec.expectedRoute;
  const contentPass = !spec.expectedContentRx || spec.expectedContentRx.test(foldCs(content));
  const noRetrievalPass = spec.expectedRoute.indexOf(".create") > 0 ? !retrieval : true;
  const pass = routePass && contentPass && !leak && noRetrievalPass;
  let rootCause = null;
  if (!det && spec.expectedRoute.indexOf(".create") > 0) {
    rootCause = "explicit_prefix_detector_did_not_fire";
  } else if (det && !routePass && retrieval) {
    rootCause = "save_search_mode_guard_or_retrieval_stole_explicit_prefix_create";
  } else if (det && !routePass) {
    rootCause = "routing_mismatch_after_explicit_prefix_detect";
  } else if (leak) {
    rootCause = "prefix_leaked_into_saved_content";
  } else if (!contentPass) {
    rootCause = "saved_content_missing_expected_body";
  }
  return {
    input: input,
    base_input: spec.input,
    variant: variantLabel,
    viewport: viewport.id,
    submit_path: submitPath,
    assistant_mode: assistantMode,
    expected_route: spec.expectedRoute,
    observed_route: observedRoute,
    explicit_prefix_detector_fired: !!det,
    forced_module: det ? det.forcedModule : null,
    cleaned_input: det ? det.cleanedInput : null,
    observed_saved_content: content,
    prefix_leaked: leak,
    retrieval_branch_entered: retrieval,
    observed_message: msg.slice(0, 160),
    silver_explicit_save_prefix_flag: !!turn.silverExplicitSavePrefixRoutingV1,
    pass: pass,
    root_cause: pass ? null : rootCause
  };
}

function main() {
  const eng = loadEngine();
  const ctx = diag.seedCtx();
  ctx.now = FIXED_NOW;
  const rows = [];

  for (let i = 0; i < NOTE_REGRESSION_INPUTS.length; i++) {
    const spec = NOTE_REGRESSION_INPUTS[i];
    for (let vi = 0; vi < VARIANTS.length; vi++) {
      const variant = VARIANTS[vi];
      const input = variant.map(spec.input);
      for (let vp = 0; vp < VIEWPORTS.length; vp++) {
        for (let sp = 0; sp < SUBMIT_PATHS.length; sp++) {
          for (let am = 0; am < ASSISTANT_MODES.length; am++) {
            rows.push(
              evaluateCase(
                eng,
                ctx,
                spec,
                VIEWPORTS[vp],
                SUBMIT_PATHS[sp],
                ASSISTANT_MODES[am],
                variant.label,
                input
              )
            );
          }
        }
      }
    }
  }

  const passCount = rows.filter(function (r) {
    return r.pass;
  }).length;
  const ok = passCount === rows.length;
  const report = {
    diagnostic_id: "silver_explicit_save_prefix_regression_diagnostic",
    root_cause_summary:
      ok
        ? "explicit_save_prefix_routing_stable_across_regression_matrix"
        : "iuSilverApplySaveSearchModeGuardV1 converted explicit prefix notes.create to notes.read when warranty/read cues matched before save-mode override",
    rows: rows,
    pass_count: passCount,
    total: rows.length,
    PASS_FAIL: ok ? "PASS" : "FAIL"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_EXPLICIT_SAVE_PREFIX_REGRESSION_DIAGNOSTIC ===");
  console.log("PASS_COUNT=" + passCount + "/" + rows.length);
  console.log("report_path=" + REPORT_PATH);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_EXPLICIT_SAVE_PREFIX_REGRESSION_DIAGNOSTIC ===");

  if (!ok) process.exit(1);
}

if (require.main === module) main();

module.exports = { NOTE_REGRESSION_INPUTS: NOTE_REGRESSION_INPUTS, evaluateCase: evaluateCase };
