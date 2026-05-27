#!/usr/bin/env node
/**
 * SILVER_DEEP_PRODUCT_93_FOLLOWUP_GUARD_V1 — permanent replay for deep-product residual clusters.
 * Timeline recall must not leak to HELP/capability; negated calendar read must surface seed tokens.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-deep-product-93-followup-guard-v1-report.json");

const deep = require("./silver-deep-product-real-ux-v2.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, foldCs, rawUserMessage } = harness;

const REPLAY_BASES = [
  "cma_retrieval_vs_create",
  "tl_minuly_tyden",
  "tl_pred_mesicem",
  "dc_voice_chaos",
  "cq_truly_ambiguous",
];

const TIMELINE_RECALL = [
  "Co jsem řešil minulý týden?",
  "Co jsem měl před měsícem u doktora?",
  "Kdy jsem měl kurýra?",
];

const HELP_ISOLATION = [
  "Na co jsou úkoly?",
  "Jak fungují poznámky?",
  "Co umíš?",
];

function isCapabilityLeak(turn) {
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  return (
    eng === "assistant.capability" ||
    eng === "assistant.help" ||
    eng === "assistant.guidance" ||
    ps === "CAPABILITY_OK"
  );
}

function evaluateDeepCase(c, turn) {
  let ev = evaluateOne(
    { id: c.id, group: c.group, input: c.input, expectedIntent: c.expectedIntent, meta: c.meta || {} },
    turn
  );
  ev = deep.evaluateClarificationQuality(c, turn, ev);
  ev = deep.evaluateDirtyCzechAmbiguity(c, turn, ev);
  if (ev.pass && c.retrievalNeedles && c.retrievalNeedles.length) {
    const fr = foldCs(ev.raw || "");
    const needleEv = deep.retrievalNeedlePass(fr, c.retrievalNeedles);
    if (!needleEv.ok) {
      ev = { pass: false, cat: needleEv.cat, auditIntent: ev.auditIntent, raw: ev.raw };
    }
  }
  return ev;
}

function main() {
  let mainCommit = "unknown";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    /* ignore */
  }

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("=== SILVER_DEEP_PRODUCT_93_FOLLOWUP_GUARD_V1 ===");
    console.log("PASS_FAIL=FAIL");
    console.log("runtime_fail=" + String(e && e.message));
    console.log("=== END_SILVER_DEEP_PRODUCT_93_FOLLOWUP_GUARD_V1 ===");
    process.exit(1);
  }

  const all = deep.expandCases();
  const cases = all.filter(function (c) {
    return c.mutation_mask === 0 && REPLAY_BASES.indexOf(c.base_id) >= 0;
  });

  let passCount = 0;
  let failCount = 0;
  let capabilityLeakCount = 0;
  let helpLeakCount = 0;
  const fails = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), deep.ctxForCaseDeep(c));
    if (isCapabilityLeak(turn) && c.slice === "timeline_reasoning") capabilityLeakCount++;
    const ev = evaluateDeepCase(c, turn);
    if (ev.pass) passCount++;
    else {
      failCount++;
      fails.push({ base_id: c.base_id, cat: ev.cat, intent: turn.normalizedIntent });
    }
  }

  for (let ti = 0; ti < TIMELINE_RECALL.length; ti++) {
    const input = TIMELINE_RECALL[ti];
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), deep.ctxForCaseDeep({ group: "calendar_query", slice: "timeline_reasoning" }));
    if (isCapabilityLeak(turn)) {
      capabilityLeakCount++;
      failCount++;
      fails.push({ base_id: "timeline_recall_guard", input: input, intent: turn.normalizedIntent });
    } else {
      passCount++;
    }
  }

  for (let hi = 0; hi < HELP_ISOLATION.length; hi++) {
    const input = HELP_ISOLATION[hi];
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), deep.ctxForCaseDeep({ group: "calendar_query", slice: "clarification_quality" }));
    const engI = String(turn.normalizedIntent || "");
    const ps = String(turn.processingState || "");
    const okHelp =
      engI === "assistant.help" ||
      engI === "assistant.capability" ||
      engI === "assistant.guidance" ||
      ps === "CAPABILITY_OK";
    const noSave = ps !== "READY_TO_SAVE" && engI !== "calendar.create" && engI !== "tasks.create" && engI !== "notes.create";
    if (okHelp && noSave) passCount++;
    else {
      helpLeakCount++;
      failCount++;
      fails.push({ base_id: "help_isolation", input: input, intent: engI, ps: ps });
    }
  }

  const rep = {
    harness_id: "silver_deep_product_93_followup_guard_v1",
    generated_at: new Date().toISOString(),
    main_commit: mainCommit,
    replay_bases: REPLAY_BASES,
    cases_total: cases.length + TIMELINE_RECALL.length + HELP_ISOLATION.length,
    pass_count: passCount,
    fail_count: failCount,
    capability_leak_count: capabilityLeakCount,
    help_leak_count: helpLeakCount,
    fails: fails.slice(0, 20),
    PASS_FAIL: failCount === 0 && capabilityLeakCount === 0 && helpLeakCount === 0 ? "PASS" : "FAIL",
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2), "utf8");

  console.log("=== SILVER_DEEP_PRODUCT_93_FOLLOWUP_GUARD_V1 ===");
  console.log("main_commit=" + mainCommit);
  console.log("cases_total=" + rep.cases_total);
  console.log("pass_count=" + rep.pass_count);
  console.log("fail_count=" + rep.fail_count);
  console.log("capability_leak_count=" + rep.capability_leak_count);
  console.log("help_leak_count=" + rep.help_leak_count);
  console.log("PASS_FAIL=" + rep.PASS_FAIL);
  console.log("report=" + REPORT_JSON);
  console.log("=== END_SILVER_DEEP_PRODUCT_93_FOLLOWUP_GUARD_V1 ===");

  process.exit(rep.PASS_FAIL === "PASS" ? 0 : 1);
}

if (require.main === module) main();
