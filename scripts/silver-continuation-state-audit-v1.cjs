#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./rhc-v3-deterministic-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT = path.join(__dirname, "silver-continuation-state-audit-v1-report.json");
const CASES = Math.min(5000, Math.max(2500, parseInt(process.env.SPG_CONTINUATION_CASES || "2500", 10)));

const BASES = [
  "Zítra v 10 doktor Praha 4 a napiš tam že vzít kartičku",
  "Ulož mi schůzku s Petrem zítra v 15 a napiš tam že smlouva",
  "Přidej úkol koupit mléko zítra ráno a napiš tam že nesmím zapomenout",
];
const CONT = [
  "A ještě tam napiš že mám vzít výsledky",
  "A dej tam že mám vzít smlouvu",
  "A napiš tam že faktury",
];

function mainCommit() {
  try {
    return require("child_process").execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function run() {
  const eng = loadEngine();
  let pass = 0;
  for (let i = 0; i < CASES; i++) {
    const rng = core.mulberry32((i * 991) >>> 0);
    let base = BASES[i % BASES.length];
    let cont = CONT[i % CONT.length];
    const mask = core.deriveMutationMask("continuation", i, 991);
    base = core.applyMutationLayers(base, mask, rng);
    cont = core.applyMutationLayers(cont, mask, rng);
    const group = /\bukol|úkol\b/i.test(base) && !/\bkalend|schůzk/i.test(base) ? "task_write" : "calendar_write";
    const t0 = eng.processUserTurn(base, eng.createEmptyDraft(), ctxForCase(group));
    const t1 = eng.processUserTurn(cont, t0.draft || eng.createEmptyDraft(), ctxForCase(group));
    const titleF = foldCs(String((t1.draft && t1.draft.title) || ""));
    const noteF = foldCs(String((t1.draft && t1.draft.note) || (t1.draft && t1.draft.taskNote) || ""));
    const contF = foldCs(cont);
    const ok =
      titleF.length > 2 &&
      noteF.length > 2 &&
      titleF.indexOf("jeste tam") < 0 &&
      titleF.indexOf("dej tam") < 0 &&
      (contF.indexOf("vysled") < 0 || noteF.indexOf("vysled") >= 0) &&
      (contF.indexOf("smlouv") < 0 || noteF.indexOf("smlouv") >= 0);
    if (ok) pass++;
  }
  const t0 = eng.processUserTurn(
    "Zítra v 10 doktor Praha 4 a napiš tam že vzít kartičku",
    eng.createEmptyDraft(),
    ctxForCase("calendar_write")
  );
  const t1 = eng.processUserTurn(
    "A ještě tam napiš že mám vzít výsledky",
    t0.draft,
    ctxForCase("calendar_write")
  );
  const probeOk =
    foldCs(String((t1.draft && t1.draft.title) || "")).indexOf("doktor") >= 0 &&
    foldCs(String((t1.draft && t1.draft.note) || "")).indexOf("vysled") >= 0;
  const accuracy = CASES ? pass / CASES : 1;
  const report = {
    harness_id: "silver_continuation_state_audit_v1",
    main_commit: mainCommit(),
    cases_total: CASES,
    accuracy,
    product_probes_pass: probeOk ? "1/1" : "0/1",
    pass_fail: accuracy >= 0.9 && probeOk ? "PASS" : "FAIL",
    reason: CASES < 5000 ? "runtime_cap_2500" : "",
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_CONTINUATION_STATE_AUDIT_V1 ===");
  console.log("cases_total=" + CASES);
  console.log("accuracy=" + Math.round(accuracy * 10000) / 100 + "%");
  console.log("product_probes_pass=" + report.product_probes_pass);
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_CONTINUATION_STATE_AUDIT_V1 ===");
  process.exit(report.pass_fail === "PASS" ? 0 : 1);
}

run();
