#!/usr/bin/env node
/**
 * NDIC shared-write two-source orchestration (offline-testable).
 *
 * ORCHESTRATION_CODE_SOURCE = feature HEAD workspace (helpers)
 * SHARED_STATE_SOURCE       = latest main data workspace (info_events RMW)
 *
 * Incident: ACTIVE run 31254863015 — checkout main into the same workspace
 * removed scripts/info-events-shared-writer-critical.mjs → MODULE_NOT_FOUND.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const ORCH_DIR_NAME = "ndic-orch";
export const MAIN_DATA_DIR_NAME = "ndic-main-data";
export const CRITICAL_HELPER_REL = path.join(
  "scripts",
  "info-events-shared-writer-critical.mjs"
);
export const DATA_PR_HELPER_REL = path.join(
  "scripts",
  "ndic-open-or-refresh-data-pr.mjs"
);
export const SHARED_STATE_REL = path.join("projects", "data", "info_events");

export function resolveTwoSourcePaths({ featureRoot, mainRoot }) {
  const fr = path.resolve(featureRoot);
  const mr = path.resolve(mainRoot);
  return {
    featureRoot: fr,
    mainRoot: mr,
    helperPath: path.join(fr, CRITICAL_HELPER_REL),
    dataPrHelperPath: path.join(fr, DATA_PR_HELPER_REL),
    targetDir: path.join(mr, SHARED_STATE_REL),
    ORCHESTRATION_CODE_SOURCE: "FEATURE_HEAD",
    SHARED_STATE_SOURCE: "LATEST_MAIN",
  };
}

export function assertFeatureHelperPresent(featureRoot) {
  const p = path.join(path.resolve(featureRoot), CRITICAL_HELPER_REL);
  if (!fs.existsSync(p)) {
    const err = new Error("FEATURE_HELPER_MISSING: " + p);
    err.code = "FEATURE_HELPER_MISSING";
    throw err;
  }
  return p;
}

/**
 * Legacy same-workspace model (pre-fix): run helper from mainRoot.
 * Reproduces MODULE_NOT_FOUND when main lacks the feature helper.
 */
export function runLegacySameWorkspaceApply({ mainRoot, candidateDir, nodeBin = process.execPath }) {
  const helper = path.join(path.resolve(mainRoot), CRITICAL_HELPER_REL);
  const targetDir = path.join(path.resolve(mainRoot), SHARED_STATE_REL);
  if (!fs.existsSync(helper)) {
    const err = new Error("Cannot find module '" + helper + "'");
    err.code = "MODULE_NOT_FOUND";
    throw err;
  }
  const r = spawnSync(
    nodeBin,
    [helper, "ndic", candidateDir, targetDir],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    const err = new Error(r.stderr || r.stdout || "LEGACY_APPLY_FAIL");
    err.code = "LEGACY_APPLY_FAIL";
    err.status = r.status;
    throw err;
  }
  return { ok: true, mode: "legacy-same-workspace", stdout: r.stdout };
}

/**
 * Fixed two-source model: helper from featureRoot, data under mainRoot.
 */
export async function runTwoSourceApply({ featureRoot, mainRoot, candidateDir, nowIso }) {
  const paths = resolveTwoSourcePaths({ featureRoot, mainRoot });
  assertFeatureHelperPresent(featureRoot);
  if (!fs.existsSync(paths.targetDir)) {
    const err = new Error("MAIN_SHARED_STATE_MISSING: " + paths.targetDir);
    err.code = "MAIN_SHARED_STATE_MISSING";
    throw err;
  }
  const mod = await import(pathToFileURL(paths.helperPath).href + "?t=" + Date.now());
  const result = mod.applyNdicCandidate({
    targetDir: paths.targetDir,
    candidateDir: path.resolve(candidateDir),
    nowIso: nowIso || new Date().toISOString(),
  });
  return {
    ...result,
    ...paths,
    FEATURE_HELPER_AVAILABLE_DURING_MAIN_REREAD: "YES",
    MAIN_STATE_REREAD_PRESERVED: "YES",
    SHARED_STATE_REREAD_AFTER_ACQUIRE: "YES",
    NDIC_REREAD_AFTER_ACQUIRE: "YES",
  };
}

export function workflowUsesTwoSourceModel(wfSrc) {
  const write = jobBlock(wfSrc, "ndic-shared-write");
  if (!write) return false;
  const hasOrch = /path:\s*ndic-orch\b/.test(write);
  const hasMain = /path:\s*ndic-main-data\b/.test(write) && /ref:\s*main\b/.test(write);
  const helperFromOrch = /node\s+ndic-orch\/scripts\/info-events-shared-writer-critical\.mjs\s+ndic/.test(
    write
  );
  const targetMain = /ndic-main-data\/projects\/data\/info_events/.test(write);
  const legacySame =
    /node\s+scripts\/info-events-shared-writer-critical\.mjs\s+ndic/.test(write) &&
    !helperFromOrch;
  return hasOrch && hasMain && helperFromOrch && targetMain && !legacySame;
}

export function jobBlock(src, jobName) {
  const re = new RegExp(
    "(?:^|\\n)\\s*" + jobName + ":\\s*\\n([\\s\\S]*?)(?=\\n\\s{0,2}[a-zA-Z0-9_-]+:\\s*\\n|$)"
  );
  const m = String(src || "").match(re);
  return m ? m[1] : "";
}
