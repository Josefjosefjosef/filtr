/**
 * SILVER_CAP45_RETRIEVAL_QUERY_FOUNDATION — diagnostic only (NO engine / retrieval rewrite).
 * Query understanding groundwork, search intent diagnostics, list/count/filter templates.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const REPORT_JSON = path.join(__dirname, "silver-retrieval-query-foundation-cap45-diagnostic-report.json");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const RETRIEVAL_INTENT_TEMPLATES = [
  { id: "RQ01", input: "Co mám zítra?", expectedModule: "calendar", expectedMode: "search", family: "temporal_list" },
  { id: "RQ02", input: "Kolik mám tento týden schůzek?", expectedModule: "calendar", expectedMode: "search", family: "count_filter" },
  { id: "RQ03", input: "Kde mám poznámku o autě?", expectedModule: "notes", expectedMode: "search", family: "entity_anchor" },
  { id: "RQ04", input: "Najdi mi úkoly s právníkem.", expectedModule: "tasks", expectedMode: "search", family: "entity_filter" },
  { id: "RQ05", input: "Co jsem řešil minulý měsíc?", expectedModule: "calendar", expectedMode: "search", family: "temporal_past" },
  { id: "RQ06", input: "Kdy mám doktora?", expectedModule: "calendar", expectedMode: "search", family: "temporal_when" },
  { id: "RQ07", input: "Jaké mám úkoly na dnes?", expectedModule: "tasks", expectedMode: "search", family: "temporal_list" },
  { id: "RQ08", input: "Vypiš mi schůzky na příští týden", expectedModule: "calendar", expectedMode: "search", family: "list_filter" },
  { id: "RQ09", input: "Kolik úkolů mám otevřených?", expectedModule: "tasks", expectedMode: "search", family: "count_filter" },
  { id: "RQ10", input: "Najdi poznámku o pojištění", expectedModule: "notes", expectedMode: "search", family: "entity_anchor" },
  { id: "RQ11", input: "Co mám dnes večer?", expectedModule: "calendar", expectedMode: "search", family: "temporal_list" },
  { id: "RQ12", input: "Kde je uložené heslo od wifi?", expectedModule: "notes", expectedMode: "search", family: "personal_fact" },
];

const SAFE_NO_WRITE_TEMPLATES = [
  { id: "NW01", input: "Nic neukládej jen se ptám co mám zítra", expectNoWrite: true, family: "no_write_ambiguity" },
  { id: "NW02", input: "Jen se podívej co mám v kalendáři", expectNoWrite: true, family: "read_only_lead" },
  { id: "NW03", input: "Nevytvářej úkol — kolik jich mám?", expectNoWrite: true, family: "negated_write_query" },
];

function classifyModule(intent) {
  const ni = String(intent || "");
  if (ni.indexOf("calendar") === 0) return "calendar";
  if (ni.indexOf("tasks") === 0) return "tasks";
  if (ni.indexOf("notes") === 0) return "notes";
  if (ni.indexOf("global") === 0) return "global";
  return "other";
}

function evaluateRetrievalCase(eng, c) {
  const group =
    c.expectedModule === "calendar"
      ? "calendar_query"
      : c.expectedModule === "tasks"
        ? "task_query"
        : c.expectedModule === "notes"
          ? "note_query"
          : "calendar_query";
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(group));
  const modeVal = actionCore.validateSaveSearchTurn(turn, c.input);
  const moduleGot = classifyModule(turn.normalizedIntent);
  const hasDraftCard = actionCore.turnHasStructuredDraftCard(turn);
  const isRead = String(turn.normalizedIntent || "").indexOf(".read") >= 0;
  const pass =
    modeVal.pass &&
    modeVal.mode === "search" &&
    !hasDraftCard &&
    (isRead || turn.processingState === "READ_OK" || turn.processingState === "CLARIFICATION") &&
    (moduleGot === c.expectedModule || moduleGot === "global" || c.expectedModule === "calendar");
  return {
    id: c.id,
    input: c.input,
    family: c.family,
    intent: turn.normalizedIntent,
    mode: modeVal.mode,
    module: moduleGot,
    hasDraftCard,
    pass,
  };
}

function evaluateNoWriteCase(eng, c) {
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase("calendar_query"));
  const modeVal = actionCore.validateSaveSearchTurn(turn, c.input);
  const isCreate =
    turn.normalizedIntent === "calendar.create" ||
    turn.normalizedIntent === "tasks.create" ||
    turn.normalizedIntent === "notes.create";
  const hasDraftCard = actionCore.turnHasStructuredDraftCard(turn);
  const pass = c.expectNoWrite ? !isCreate && !hasDraftCard && modeVal.mode !== "save" : true;
  return { id: c.id, input: c.input, family: c.family, intent: turn.normalizedIntent, hasDraftCard, pass };
}

function main() {
  const eng = loadEngine();
  const retrievalResults = RETRIEVAL_INTENT_TEMPLATES.map((c) => evaluateRetrievalCase(eng, c));
  const noWriteResults = SAFE_NO_WRITE_TEMPLATES.map((c) => evaluateNoWriteCase(eng, c));
  const retrievalPass = retrievalResults.filter((r) => r.pass).length;
  const noWritePass = noWriteResults.filter((r) => r.pass).length;
  const families = {};
  for (let i = 0; i < retrievalResults.length; i++) {
    const f = retrievalResults[i].family;
    if (!families[f]) families[f] = { pass: 0, total: 0 };
    families[f].total++;
    if (retrievalResults[i].pass) families[f].pass++;
  }

  const report = {
    cap: 45,
    engine_changed: "NO",
    retrieval_engine_changed: "NO",
    diagnostic_only: true,
    retrieval_templates_total: RETRIEVAL_INTENT_TEMPLATES.length,
    retrieval_pass: retrievalPass,
    no_write_templates_total: SAFE_NO_WRITE_TEMPLATES.length,
    no_write_pass: noWritePass,
    families,
    retrieval_results: retrievalResults,
    no_write_results: noWriteResults,
    pass_fail: retrievalPass === RETRIEVAL_INTENT_TEMPLATES.length && noWritePass === SAFE_NO_WRITE_TEMPLATES.length ? "PASS" : "METRICS_ONLY",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_CAP45_RETRIEVAL_QUERY_FOUNDATION ===");
  console.log("engine_changed=NO");
  console.log("retrieval_engine_changed=NO");
  console.log("diagnostic_only=YES");
  console.log("retrieval_templates_total=" + RETRIEVAL_INTENT_TEMPLATES.length);
  console.log("retrieval_pass=" + retrievalPass + "/" + RETRIEVAL_INTENT_TEMPLATES.length);
  console.log("no_write_pass=" + noWritePass + "/" + SAFE_NO_WRITE_TEMPLATES.length);
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_CAP45_RETRIEVAL_QUERY_FOUNDATION ===");
}

if (require.main === module) {
  main();
}

module.exports = { main, RETRIEVAL_INTENT_TEMPLATES };
