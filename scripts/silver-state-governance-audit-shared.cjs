#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const lineK = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const CAPABILITY_INTENTS = new Set(["assistant.capability", "assistant.help", "assistant.guidance"]);

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function runCapabilityIsolationCase(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const before = eng.iuSilverSessionStateGovernancePeekV1 ? eng.iuSilverSessionStateGovernancePeekV1() : null;
  const regBefore = before ? before.draftRegistryCount : 0;
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), harness.ctxForCase("calendar_write"));
  const intent = String(turn.normalizedIntent || "");
  const after = eng.iuSilverSessionStateGovernancePeekV1 ? eng.iuSilverSessionStateGovernancePeekV1() : null;
  const issues = [];
  if (!CAPABILITY_INTENTS.has(intent)) issues.push("intent_not_static_assistant:" + intent);
  if (WRITE_INTENTS.has(intent)) issues.push("capability_write_leak:" + intent);
  if (turn.readQuery) issues.push("capability_read_query_leak");
  if (turn.silverConversationAction === "update" && c.mustNotContinuation) {
    issues.push("capability_continuation_leak");
  }
  if (after && after.draftRegistryCount > regBefore + (c.allowRegistryGrowth || 0)) {
    issues.push("capability_draft_registry_growth");
  }
  if (turn.draft && turn.draft.targetContainer && turn.draft.targetContainer !== "none") {
    const t = String(turn.draft.title || "").trim();
    if (t.length > 2) issues.push("capability_draft_payload");
  }
  return { id: c.id, input: c.input, intent, issues, pass: issues.length === 0, turn };
}

function runLongSessionStorm(eng, steps, maxFootprint, maxDupCreates) {
  eng.iuSilverConversationReset();
  const ctx = harness.ctxForCase("calendar_write");
  let prev = eng.createEmptyDraft();
  let maxFp = 0;
  let capabilityLeaks = 0;
  let dupCreates = 0;
  let prevIntent = null;
  for (let i = 0; i < steps.length; i++) {
    const t = eng.processUserTurn(steps[i], prev, ctx);
    if (CAPABILITY_INTENTS.has(String(t.normalizedIntent || "")) === false && eng.iuSilverGovIsCapabilityIntent) {
      void 0;
    }
    if (i > 0 && t.normalizedIntent === "calendar.create" && t.silverConversationAction !== "update") {
      if (String(prevIntent || "").indexOf(".read") < 0) dupCreates++;
    }
    prev = t.draft || prev;
    prevIntent = t.normalizedIntent;
    if (eng.iuSilverSessionStateGovernancePeekV1) {
      const peek = eng.iuSilverSessionStateGovernancePeekV1();
      const fp =
        peek.draftRegistryCount +
        peek.contextSlotCount +
        (peek.continuationChain || 0);
      if (fp > maxFp) maxFp = fp;
    }
    if (eng.iuSilverGovMeasureFootprintV1) {
      const fp2 = eng.iuSilverGovMeasureFootprintV1();
      if (fp2 > maxFp) maxFp = fp2;
    }
  }
  const issues = [];
  if (maxFp > maxFootprint) issues.push("footprint_exceeded:" + maxFp + ">" + maxFootprint);
  const dupCap = maxDupCreates != null ? maxDupCreates : 8;
  if (dupCreates > dupCap) issues.push("duplicate_create_storm:" + dupCreates);
  return { maxFp, dupCreates, capabilityLeaks, issues, pass: issues.length === 0 };
}

function runMemoryBudgetCase(eng, c) {
  eng.iuSilverConversationReset();
  const ctx = harness.ctxForCase(c.group || "calendar_write");
  let prev = eng.createEmptyDraft();
  for (let i = 0; i < c.steps.length; i++) {
    prev = eng.processUserTurn(c.steps[i], prev, ctx).draft || prev;
  }
  if (eng.iuSilverSessionStateGovernanceTickV1) eng.iuSilverSessionStateGovernanceTickV1({ skipSessionBump: true });
  const peek = eng.iuSilverSessionStateGovernancePeekV1 ? eng.iuSilverSessionStateGovernancePeekV1() : {};
  const issues = [];
  if (peek.draftRegistryCount > (c.maxDrafts || 12)) issues.push("draft_budget:" + peek.draftRegistryCount);
  if (peek.contextSlotCount > (c.maxSlots || 16)) issues.push("slot_budget:" + peek.contextSlotCount);
  if ((peek.continuationDepth || 0) > (c.maxDepth || 8)) issues.push("depth_budget:" + peek.continuationDepth);
  return { id: c.id, peek, issues, pass: issues.length === 0 };
}

function runOrphanCleanupCase(eng, c) {
  eng.iuSilverConversationReset();
  const ctx = harness.ctxForCase("calendar_write");
  let prev = eng.createEmptyDraft();
  for (let i = 0; i < c.seedSteps.length; i++) {
    prev = eng.processUserTurn(c.seedSteps[i], prev, ctx).draft || prev;
  }
  const snap = eng.iuSilverLineNPersistenceSnapshotV1 ? eng.iuSilverLineNPersistenceSnapshotV1() : null;
  eng.iuSilverConversationReset();
  if (snap && eng.iuSilverLineNPersistenceRestoreV1) eng.iuSilverLineNPersistenceRestoreV1(snap);
  if (eng.iuSilverSessionStateGovernanceTickV1) eng.iuSilverSessionStateGovernanceTickV1({ skipSessionBump: true });
  const peek = eng.iuSilverSessionStateGovernancePeekV1 ? eng.iuSilverSessionStateGovernancePeekV1() : {};
  const issues = [];
  const lc = peek.draftRegistryCount || 0;
  if (lc > (c.maxRegistryAfter || 12)) issues.push("orphan_registry:" + lc);
  const life = eng.iuSilverConversationPeek ? eng.iuSilverConversationPeek() : {};
  if (life.historicalAnchorCount > 12) issues.push("orphan_anchors:" + life.historicalAnchorCount);
  return { id: c.id, peek, issues, pass: issues.length === 0 };
}

function emitReport(harnessId, report, reportPath) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("=== " + harnessId.toUpperCase() + " ===");
  console.log("harness_id=" + harnessId);
  console.log("main_commit=" + report.main_commit);
  console.log("cases_total=" + report.cases_total);
  console.log("pass_count=" + report.pass_count);
  console.log("fail_count=" + report.fail_count);
  if (report.accuracy_pct != null) console.log("accuracy_pct=" + report.accuracy_pct);
  for (const k of Object.keys(report.metrics || {})) {
    console.log(k + "=" + report.metrics[k]);
  }
  console.log("PASS_FAIL=" + (report.pass_count === report.cases_total ? "PASS" : "FAIL"));
  console.log("=== END_" + harnessId.toUpperCase() + " ===");
}

module.exports = {
  REPO,
  mainCommit,
  foldCs,
  runCapabilityIsolationCase,
  runLongSessionStorm,
  runMemoryBudgetCase,
  runOrphanCleanupCase,
  emitReport,
  CAPABILITY_INTENTS,
  WRITE_INTENTS,
  lineK
};
