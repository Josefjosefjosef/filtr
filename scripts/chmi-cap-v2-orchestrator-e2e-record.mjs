#!/usr/bin/env node
/**
 * Persist CHMI orchestrator E2E attempt metadata (data dir only).
 * Distinguishes last attempt, last successful source processing, last main publish.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

function argVal(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

const dataDir = path.resolve(argVal("data-dir", path.join(REPO, "projects/data/info_events")));
const runId = argVal("run-id", process.env.GITHUB_RUN_ID || "");
const runAttempt = argVal("run-attempt", process.env.GITHUB_RUN_ATTEMPT || "1");
const phase = argVal("phase", "prep");
const outcome = argVal("outcome", "in_progress");
const openPr = argVal("open-pr", "");
const pushed = argVal("pushed", "");

const outPath = path.join(dataDir, "chmi_cap_v2", "orchestrator_e2e.json");
const syncState = readJson(path.join(dataDir, "chmi_cap_v2", "sync_state.json"), {});
const monitoring = readJson(path.join(dataDir, "monitoring.json"), {});
const chmi = monitoring.chmiCapV2 || {};

const now = new Date().toISOString();
const prev = readJson(outPath, {});

const lastSourceSuccessAt =
  (syncState.sync && syncState.sync.last_success_at) || chmi.lastSuccessAt || prev.lastSuccessfulSourceProcessingAt || null;

const lastMainPublishAt =
  (chmi.freshness && chmi.freshness.publishedAt) || chmi.lastSnapshotAt || prev.lastMainPublishAt || null;

const next = {
  version: 1,
  lastOrchestratorAttemptAt: now,
  lastOrchestratorAttemptRunId: runId || prev.lastOrchestratorAttemptRunId || null,
  lastOrchestratorAttemptNumber: Number(runAttempt) || 1,
  lastOrchestratorPhase: phase,
  lastOrchestratorOutcome: outcome,
  lastSuccessfulSourceProcessingAt: lastSourceSuccessAt,
  lastMainPublishAt,
  lastChangedAt: (syncState.sync && syncState.sync.last_changed_at) || chmi.lastChangedAt || prev.lastChangedAt || null,
  openAutomationPrNumber: openPr ? Number(openPr) : prev.openAutomationPrNumber ?? null,
  lastSharedWritePushed: pushed === "true" ? true : pushed === "false" ? false : prev.lastSharedWritePushed ?? null,
  history: Array.isArray(prev.history) ? prev.history.slice(0, 47) : [],
};

next.history.unshift({
  at: now,
  runId: runId || null,
  phase,
  outcome,
  openPr: openPr || null,
  pushed: next.lastSharedWritePushed,
  sourceSuccessAt: lastSourceSuccessAt,
  mainPublishAt: lastMainPublishAt,
});

if (outcome === "merged" && openPr) {
  next.lastSuccessfulDataMergeAt = now;
  next.lastMergedPrNumber = Number(openPr);
  next.openAutomationPrNumber = null;
}

if (outcome === "scope_blocked" || outcome === "checks_failed") {
  next.lastBlockedAt = now;
  next.lastBlockedReason = outcome;
  if (openPr) next.openAutomationPrNumber = Number(openPr);
}

writeJson(outPath, next);
console.log("CHMI_ORCHESTRATOR_E2E_RECORD=OK");
console.log("path=" + outPath);
