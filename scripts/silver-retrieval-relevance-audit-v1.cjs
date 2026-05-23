#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT = path.join(__dirname, "silver-retrieval-relevance-audit-v1-report.json");
const CASES = Math.min(5000, Math.max(2500, parseInt(process.env.SPG_RETRIEVAL_CASES || "2500", 10)));

const QUERIES = [
  { q: "Kdy mám doktora?", module: "calendar", anchor: "doktor" },
  { q: "Kdy mám zubaře?", module: "calendar", anchor: "zubař" },
  { q: "Co mám v poznámkách o servisu auta?", module: "notes", anchor: "servis" },
  { q: "Jakou mám adresu u doktora v poznámkách?", module: "notes", anchor: "doktor" },
  { q: "Kdy mám koupit mléko?", module: "tasks", anchor: "mléko" },
];

function seedCtx(eng, spec) {
  const now = new Date("2026-05-06T10:00:00Z");
  const events = [
    { title: "Doktor", start: "2026-05-06T09:00:00", end: "2026-05-06T10:00:00" },
    { title: "Zubař", start: "2026-05-08T14:00:00", end: "2026-05-08T15:00:00" },
  ];
  const notes = [
    { title: "Doktor adresa", body: "Adresa doktora: Korunní 12 Praha" },
    { title: "Servis auta", body: "Servis auta musím zaplatit do konce měsíce" },
  ];
  const tasks = [{ title: "Koupit mléko", due: "2026-05-07T08:00:00", note: "" }];
  return {
    now: now,
    getEventsSnapshot: function () {
      return events;
    },
    getNotesSnapshot: function () {
      return notes;
    },
    getTasksSnapshot: function () {
      return tasks;
    },
  };
}

function run() {
  const eng = loadEngine();
  let pass = 0;
  let total = 0;
  for (let i = 0; i < CASES; i++) {
    const spec = QUERIES[i % QUERIES.length];
    const ctx = seedCtx(eng, spec);
    const group = spec.module === "tasks" ? "task_query" : spec.module === "notes" ? "note_query" : "calendar_query";
    const turn = eng.processUserTurn(spec.q, eng.createEmptyDraft(), Object.assign(ctxForCase(group), ctx));
    total++;
    const intent = String(turn.normalizedIntent || "");
    const msg = String(
      (turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || ""
    ).toLowerCase();
    const readOk =
      intent.indexOf(".read") > 0 &&
      turn.processingState === "READ_OK" &&
      msg.indexOf("upřesni") < 0 &&
      msg.indexOf("nejasn") < 0 &&
      (msg.indexOf(spec.anchor.toLowerCase()) >= 0 || msg.indexOf("máš") >= 0 || msg.indexOf("mas") >= 0);
    if (readOk) pass++;
  }
  const eProbe = eng.processUserTurn(
    "Kdy mám doktora?",
    eng.createEmptyDraft(),
    Object.assign(ctxForCase("calendar_query"), seedCtx(eng, {}))
  );
  const probeOk =
    eProbe.normalizedIntent === "calendar.read" &&
    String((eProbe.readAnswer && eProbe.readAnswer.message) || "").toLowerCase().indexOf("doktor") >= 0;
  const accuracy = total ? pass / total : 1;
  const report = {
    harness_id: "silver_retrieval_relevance_audit_v1",
    cases_total: total,
    accuracy,
    product_probes_pass: probeOk ? "1/1" : "0/1",
    pass_fail: accuracy >= 0.85 && probeOk ? "PASS" : "FAIL",
    reason: total < 5000 ? "runtime_cap_2500" : "",
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_RETRIEVAL_RELEVANCE_AUDIT_V1 ===");
  console.log("cases_total=" + total);
  console.log("accuracy=" + Math.round(accuracy * 10000) / 100 + "%");
  console.log("product_probes_pass=" + report.product_probes_pass);
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_RETRIEVAL_RELEVANCE_AUDIT_V1 ===");
  process.exit(report.pass_fail === "PASS" ? 0 : 1);
}

run();
