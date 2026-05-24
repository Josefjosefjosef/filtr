#!/usr/bin/env node
/**
 * SILVER_CAP55_GENERATED_CLUSTER_REPLAY_V1 — generated 2900 family replay with BEFORE/AFTER/DELTA.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const corpus = require("./silver-calendar-save-public-3000-corpus-v1.cjs");
const shared = require("./silver-cap55-calendar-audit-shared.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-cap55-generated-cluster-replay-v1-report.json");

function main() {
  const eng = loadEngine();
  const all = corpus.buildAllCases();
  const cases = all.filter(function (c) {
    return c.family !== "seed_100";
  });
  const familyStats = {};
  const failSamples = {};
  let pass = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase("calendar_write"));
    const ev = shared.evaluateCalendarCase(c, turn);
    const fam = c.family || "unknown";
    if (!familyStats[fam]) familyStats[fam] = { total: 0, pass: 0, fail: 0 };
    familyStats[fam].total++;
    if (ev.pass) {
      pass++;
      familyStats[fam].pass++;
    } else {
      familyStats[fam].fail++;
      const key = (ev.mustIssues[0] || ev.expectMisses[0] || turn.normalizedIntent || "fail") + "";
      if (!failSamples[key] || failSamples[key].length < 3) {
        failSamples[key] = failSamples[key] || [];
        failSamples[key].push({
          input: c.input,
          family: fam,
          intent: turn.normalizedIntent,
          state: turn.processingState,
          title: shared.draftField(turn, "title"),
          issues: ev.mustIssues.concat(ev.expectMisses),
        });
      }
    }
  }
  const topFamilies = Object.keys(familyStats)
    .map(function (k) {
      return { family: k, fail: familyStats[k].fail, total: familyStats[k].total };
    })
    .filter(function (x) {
      return x.fail > 0;
    })
    .sort(function (a, b) {
      return b.fail - a.fail;
    })
    .slice(0, 10);

  const rep = {
    harness_id: "silver_cap55_generated_cluster_replay_v1",
    main_commit: execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim(),
    generated_total: cases.length,
    generated_pass: pass,
    generated_fail: cases.length - pass,
    generated_2900_pass: pass + "/" + cases.length,
    top_fail_families: topFamilies,
    fail_samples: failSamples,
    semantic_rebuild_cases: Object.keys(failSamples)
      .filter(function (k) {
        return k.indexOf("title") >= 0 || k.indexOf("raw_command") >= 0;
      })
      .slice(0, 5),
    PASS_FAIL: pass === cases.length ? "PASS" : "FAIL",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), "utf8");
  console.log("=== SILVER_CAP55_GENERATED_CLUSTER_REPLAY_V1 ===");
  console.log("generated_2900_pass=" + rep.generated_2900_pass);
  console.log("generated_fail=" + rep.generated_fail);
  console.log("top_fail_families=" + topFamilies.map(function (x) { return x.family + ":" + x.fail; }).join(","));
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("=== END_SILVER_CAP55_GENERATED_CLUSTER_REPLAY_V1 ===");
  if (rep.PASS_FAIL !== "PASS") process.exit(1);
}

main();
