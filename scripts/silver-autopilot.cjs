#!/usr/bin/env node
/**
 * Silver Autopilot V1 — local orchestration only (no runtime Silver changes).
 * Commands: --status | --verify-pr= | --merge-pr= | --post-merge-proof | --refresh-rhc3 | --ask-model | --sanitize-next-action-md | --auto | --full-auto-loop | --loop-once | --cli-autonomous-adapter-diagnostic
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const {
  silverNextActionQualityViolations,
  silverNextActionHasClusterWorkflow,
  buildClusterHandoffForHealthyPlanner,
  isHealthyPlannerContext,
  readOrchestratorReport,
  runPlannerClusterPreferenceSelftest,
} = require("./silver-next-action-planner-handoff.cjs");
const {
  coerceOpenAiChatCompletionText,
  decodeFetchBodyUtf8,
  parseOpenAiChatCompletionRaw,
  extractOpenAiChatMessageContent,
  repairSilverOpenAiUtf8Text,
  stripSilverAutopilotUkolHeaderLine,
  hasSilverUtf8MojibakeMarkers,
  writeUtf8FileNoBom,
  runOpenAiNextActionUtf8Selftest,
  printOpenAiRealNextActionUtf8Diagnostic,
} = require("./silver-openai-utf8.cjs");

const REPO = path.resolve(__dirname, "..");
const SCRIPTS = __dirname;

const STRATEGY = path.join(REPO, "SILVER_STRATEGY.md");
const NEXT_ACTION = path.join(REPO, "SILVER_NEXT_ACTION.md");
const RUN_REPORT = path.join(REPO, "SILVER_RUN_REPORT.md");
const README = path.join(REPO, "SILVER_AUTOPILOT_README.md");
const CURSOR_OUTPUT = path.join(REPO, "SILVER_CURSOR_OUTPUT.md");

const RHC3_MAIN = path.join(SCRIPTS, "silver-real-human-chaos-v3.cjs");
const RHC3_REPORT_JSON = path.join(SCRIPTS, "silver-real-human-chaos-v3-report.json");

const HARNESS_SAFE_EXCLUDE = {
  rhc3_filler_note_query: "silver-rhc3-filler-note-query-diagnostic-report.json",
  rhc3_retrieval_fuzzy_note_read: "silver-rhc3-retrieval-fuzzy-note-read-diagnostic-report.json",
  rhc3_ascii_task: "silver-rhc3-ascii-task-diagnostic-report.json",
};

const PREFERRED_NEXT = ["rhc3_ambiguity_cal_conflict", "rhc3_cal_query_topic"];

const POST_MERGE_STEPS = [
  { kind: "npm", args: ["run", "smoke"] },
  { kind: "node", file: "silver-calendar-create-regression.mjs" },
  { kind: "node", file: "audit_silver_20000_routing_stable.cjs" },
  { kind: "node", file: "audit_silver_quality_v2.cjs" },
  { kind: "node", file: "audit_silver_realistic_mobile_corpus.cjs" },
  { kind: "node", file: "silver-real-czech-corpus-v1.cjs" },
  { kind: "node", file: "silver-real-czech-public-ux-corpus-v2.cjs" },
  { kind: "node", file: "silver-deep-product-real-ux-v2.cjs" },
];

const SAFETY_REPORT_JSON = [
  "silver-quality-v2-report.json",
  "silver-realistic-mobile-corpus-report.json",
  "silver-real-czech-corpus-v1-report.json",
  "silver-real-czech-public-ux-corpus-v2-report.json",
  "silver-deep-product-real-ux-v2-report.json",
  "silver-real-human-chaos-v3-report.json",
];

/** JSON reports scanned for substring mentions of realistic_mobile (PASS/FAIL); not authoritative for gates. */
const REALISTIC_MOBILE_RAW_SCAN_JSON = SAFETY_REPORT_JSON;

const REALISTIC_MOBILE_CORPUS_REPORT = "silver-realistic-mobile-corpus-report.json";
const DEEP_PRODUCT_UX_V2_REPORT = "silver-deep-product-real-ux-v2-report.json";

function nowIso() {
  return new Date().toISOString();
}

function readTextSafe(abs) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function readJsonSafe(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

function runGit(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function gitStatusPorcelain() {
  try {
    /* Avoid quoted/octal paths so porcelain parsing matches PS autopilot guard and WSL adapters. */
    return runGit(["-c", "core.quotePath=false", "status", "--porcelain"]);
  } catch {
    return "DIRTY_UNKNOWN";
  }
}

/** Decode Git-style C escapes inside a quoted path segment (\n, \t, \\, \", octal \ddd). */
function decodeGitQuotedInner(inner) {
  const raw = String(inner || "");
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i);
    if (c !== "\\") {
      out += c;
      continue;
    }
    i++;
    if (i >= raw.length) break;
    const esc = raw.charAt(i);
    if (esc === "\\" || esc === '"') {
      out += esc;
      continue;
    }
    if (esc === "n") {
      out += "\n";
      continue;
    }
    if (esc === "t") {
      out += "\t";
      continue;
    }
    const oct = raw.slice(i).match(/^([0-7]{1,3})/);
    if (oct) {
      const code = parseInt(oct[1], 8);
      if (!Number.isNaN(code)) {
        out += String.fromCharCode(code & 255);
        i += oct[1].length - 1;
        continue;
      }
    }
    out += esc;
  }
  return out;
}

function normalizeRepoRel(rel) {
  let s = String(rel || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .trim();
  /* Git may quote paths when core.quotePath is enabled; Windows adapters may vary slash/case. */
  if (
    (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') ||
    (s.length >= 2 && s.charAt(0) === "'" && s.charAt(s.length - 1) === "'")
  ) {
    s = decodeGitQuotedInner(s.slice(1, -1))
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "");
  }
  return s;
}

/** Normalized repo-relative path for allowdirty / guard lookups (case-insensitive). */
function repoRelGuardKey(rel) {
  return normalizeRepoRel(rel).toLowerCase();
}

/** Paths allowed dirty during `--full-auto-loop` / controlled adapter runs (keys are lowercase). */
const FULL_AUTO_LOOP_ALLOWED_DIRTY = new Set(
  [
    "SILVER_STRATEGY.md",
    "SILVER_NEXT_ACTION.md",
    "SILVER_RUN_REPORT.md",
    "SILVER_PROGRESS_LOG.md",
    "SILVER_AUTOPILOT_README.md",
    "SILVER_PR_ORCHESTRATOR_README.md",
    "SILVER_CURSOR_OUTPUT.md",
    "SILVER_STOP_AUTOPILOT",
    "scripts/silver-autopilot.cjs",
    "scripts/silver-openai-utf8.cjs",
    "scripts/silver-autopilot-loop.ps1",
    "scripts/silver-autonomous-loop-safety-diagnostic.ps1",
    /* WSL / Cursor CLI adapter runtime may refresh adapter scripts + SILVER_CURSOR_OUTPUT.md during controlled loops */
    "scripts/silver-cursor-agent-adapter.ps1",
    "scripts/silver-cursor-agent-adapter-diagnostic.ps1",
    /* Adapter diagnostic JSON is regenerated/read during WSL agent flows; narrow runtime noise */
    "scripts/silver-cursor-agent-adapter-diagnostic-report.json",
    "scripts/silver-rhc3-negation-cal-readonly-diagnostic-report.json",
    "scripts/silver-rhc3-cluster-classifier-v1-report.json",
  ].map((s) => repoRelGuardKey(s)),
);

/** Regenerated audit JSON under scripts/ (SAFETY_REPORT_JSON); autonomous orchestration transient only. */
const TRANSIENT_GENERATED_AUDIT_REPORT_KEYS = new Set(
  SAFETY_REPORT_JSON.map((basename) => repoRelGuardKey("scripts/" + basename)),
);

function isTransientGeneratedAuditReportRel(rel) {
  const n = normalizeRepoRel(rel);
  if (!n) return false;
  return TRANSIENT_GENERATED_AUDIT_REPORT_KEYS.has(repoRelGuardKey(n));
}

/** Regenerated cluster-classifier JSON under scripts/ (runtime-only). */
const TRANSIENT_GENERATED_CLUSTER_CLASSIFIER_REPORT_RE =
  /^scripts\/silver-[a-z0-9][a-z0-9_-]*-cluster-classifier-v\d+-report\.json$/i;

function isTransientGeneratedClusterClassifierReportRel(rel) {
  const n = normalizeRepoRel(rel);
  if (!n) return false;
  return TRANSIENT_GENERATED_CLUSTER_CLASSIFIER_REPORT_RE.test(n);
}

/** Narrow runtime-only paths safe to `git restore --worktree` before CAP50 / autonomous cycles (keys lowercase). */
const CAP50_RUNTIME_RESTORE_EXACT = new Set(
  [
    "SILVER_CURSOR_OUTPUT.md",
    "SILVER_NEXT_ACTION.md",
    "SILVER_PROGRESS_LOG.md",
    "SILVER_RUN_REPORT.md",
    "scripts/silver-cursor-agent-adapter-diagnostic-report.json",
    "scripts/silver-rhc3-negation-cal-readonly-diagnostic-report.json",
  ].map((s) => repoRelGuardKey(s)),
);

function cap50RuntimeRestoreReason(rel) {
  const n = normalizeRepoRel(rel);
  if (!n) return "";
  if (CAP50_RUNTIME_RESTORE_EXACT.has(repoRelGuardKey(n))) return "runtime_exact_allowlist";
  if (isTransientGeneratedAuditReportRel(n)) return "runtime_transient_audit_json";
  if (isTransientGeneratedClusterClassifierReportRel(n)) return "runtime_cluster_classifier_json";
  return "";
}

function cap50PreflightRuntimeCleanup(dryRunOnly) {
  const po = gitStatusPorcelain();
  const dirtyBefore = [];
  const toRestore = [];
  const blocked = [];
  let allowCount = 0;
  if (po && po !== "DIRTY_UNKNOWN") {
    for (const raw of po.split(/\r?\n/)) {
      const line = String(raw || "").replace(/\r$/, "").trim();
      if (!line) continue;
      const st = line.length >= 2 ? line.slice(0, 2) : "";
      let extracted = "";
      if (line.length >= 3 && line.charAt(2) === " ") extracted = line.slice(3).trim();
      else {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) extracted = parts.slice(1).join(" ").trim();
        else extracted = line.trim();
      }
      const p = porcelainPathToWorkingTree(extracted);
      if (!p) continue;
      dirtyBefore.push(p);
      const reason = cap50RuntimeRestoreReason(p);
      if (st === "??") {
        blocked.push(reason ? p + "(untracked_runtime_unknown)" : p + "(untracked_unknown)");
        continue;
      }
      if (reason) {
        allowCount++;
        toRestore.push(p);
      } else {
        blocked.push(p);
      }
    }
  }
  const restored = [];
  if (!dryRunOnly) {
    for (const rel of toRestore) {
      try {
        execFileSync("git", ["restore", "--worktree", "--", rel], { cwd: REPO, stdio: "pipe" });
        restored.push(rel);
      } catch {
        blocked.push(rel + "(restore_failed)");
      }
    }
  } else {
    for (const rel of toRestore) restored.push(rel + "(dry_run)");
  }
  const cleanAfter = gitClean() ? "YES" : "NO";
  let safe = "NO";
  if (blocked.length === 0) {
    if (cleanAfter === "YES") safe = "YES";
    else if (dryRunOnly && toRestore.length > 0 && dirtyBefore.length === toRestore.length) safe = "YES";
  }
  const passFail = safe === "YES" ? "PASS" : "FAIL";
  const result = {
    dirty_before: dirtyBefore.join(";"),
    allowlisted_runtime_dirty_count: String(allowCount),
    restored_runtime_files: restored.join(";"),
    blocked_dirty_files: blocked.join(";"),
    git_clean_after: cleanAfter,
    safe_to_start_cycle: safe,
    PASS_FAIL: passFail,
  };
  console.log("=== SILVER_CAP50_PREFLIGHT_CLEANUP_RESULT ===");
  console.log("dirty_before=" + result.dirty_before);
  console.log("allowlisted_runtime_dirty_count=" + result.allowlisted_runtime_dirty_count);
  console.log("restored_runtime_files=" + result.restored_runtime_files);
  console.log("blocked_dirty_files=" + result.blocked_dirty_files);
  console.log("git_clean_after=" + result.git_clean_after);
  console.log("safe_to_start_cycle=" + result.safe_to_start_cycle);
  console.log("PASS_FAIL=" + result.PASS_FAIL);
  console.log("=== END_SILVER_CAP50_PREFLIGHT_CLEANUP_RESULT ===");
  return { result, exitCode: passFail === "PASS" ? 0 : 1 };
}

/** Porcelain rename/copy lines may report `orig -> dest`; guards must evaluate the working-tree path (dest). */
function porcelainPathToWorkingTree(rel) {
  let p = normalizeRepoRel(rel);
  if (!p) return "";
  const arrow = " -> ";
  const idx = p.lastIndexOf(arrow);
  if (idx >= 0) {
    p = normalizeRepoRel(p.slice(idx + arrow.length));
  }
  return p;
}

function gitChangedFilesList() {
  const po = gitStatusPorcelain();
  if (!po) return [];
  return po
    .split(/\r?\n/)
    .map((l) => {
      const line = String(l || "").replace(/\r$/, "");
      if (!line) return "";
      let extracted = "";
      if (line.length >= 3 && line.charAt(2) === " ") extracted = line.slice(3).trim();
      else {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) extracted = parts.slice(1).join(" ").trim();
        else extracted = line.trim();
      }
      return porcelainPathToWorkingTree(extracted);
    })
    .filter(Boolean);
}

function gitClean() {
  return gitStatusPorcelain() === "";
}

function listTrackedReportJsonUnderScripts() {
  let out = "";
  try {
    out = runGit(["ls-files", "scripts"]);
  } catch {
    return [];
  }
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("scripts/") && /report\.json$/i.test(l));
}

function restoreTrackedReportJsons() {
  const files = listTrackedReportJsonUnderScripts();
  for (const rel of files) {
    try {
      execFileSync("git", ["restore", "--", rel], { cwd: REPO, stdio: "pipe" });
    } catch {
      /* best-effort */
    }
  }
}

function spawnRepo(cmd, args, inherit) {
  const r = spawnSync(cmd, args, {
    cwd: REPO,
    encoding: "utf8",
    shell: false,
    stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
  });
  return { code: r.status === null ? 1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function ghJson(args) {
  const r = spawnRepo("gh", args, false);
  if (r.code !== 0) {
    const err = new Error("GH_FAILED");
    err.ghStdout = r.stdout;
    err.ghStderr = r.stderr;
    err.code = r.code;
    throw err;
  }
  return JSON.parse(r.stdout || "{}");
}

function ghLines(args) {
  const r = spawnRepo("gh", args, false);
  if (r.code !== 0) {
    const err = new Error("GH_FAILED");
    err.ghStdout = r.stdout;
    err.ghStderr = r.stderr;
    throw err;
  }
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

const ROOT_SILVER_MD = /^SILVER_(STRATEGY|NEXT_ACTION|RUN_REPORT|AUTOPILOT_README|CURSOR_OUTPUT|PR_ORCHESTRATOR_README)\.md$/;

function isAllowedVerifyPath(rel) {
  const n = String(rel || "").replace(/\\/g, "/").trim();
  if (!n) return false;
  if (ROOT_SILVER_MD.test(path.basename(n)) && !n.includes("/")) return true;
  return n.startsWith("scripts/");
}

function classifyDiffPath(rel) {
  const n = String(rel || "").replace(/\\/g, "/");
  const out = {
    path: n,
    assets_app: false,
    engine_touch: false,
    css: false,
    ui: false,
    backend: false,
    forbidden_zone: false,
  };
  if (n === "assets/app.js") {
    out.assets_app = true;
    out.engine_touch = true;
    return out;
  }
  if (/^assets\//.test(n) && /\.css$/i.test(n)) out.css = true;
  if (/^assets\//.test(n) && /\.(html?|js|mjs)$/i.test(n) && n !== "assets/app.js") out.ui = true;
  if (/^(server|cloudflare|workers?)\//i.test(n) || /wrangler\.toml$/i.test(n)) out.backend = true;
  if (/^\.github\//.test(n) || /^projects\//.test(n) || /^assets\//.test(n)) {
    if (n !== "assets/app.js" && !/^scripts\//.test(n)) {
      /* assets other files = product surface */
      if (/^assets\//.test(n)) out.ui = out.ui || true;
    }
  }
  if (/^projects\//.test(n) && !/^projects\/data\//.test(n)) out.forbidden_zone = true;
  if (/^\.github\//.test(n)) out.forbidden_zone = true;
  if (/^assets\//.test(n)) out.assets_app = out.assets_app || n === "assets/app.js";
  return out;
}

function extractSafetyFromJson(data) {
  if (!data || typeof data !== "object") {
    return {
      dangerous_write_count: 0,
      false_write_count: 0,
      query_created_write_count: 0,
      write_when_negated_count: 0,
    };
  }
  const nested = data.safety && typeof data.safety === "object" ? data.safety : {};
  const pick = (k) => {
    const v = data[k] != null ? data[k] : nested[k];
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const qcw = Math.max(pick("query_created_write_count"), pick("query_created_write_count_realistic"));
  return {
    dangerous_write_count: pick("dangerous_write_count"),
    false_write_count: pick("false_write_count"),
    query_created_write_count: qcw,
    write_when_negated_count: pick("write_when_negated_count"),
  };
}

function maxSafety(a, b) {
  return {
    dangerous_write_count: Math.max(a.dangerous_write_count, b.dangerous_write_count),
    false_write_count: Math.max(a.false_write_count, b.false_write_count),
    query_created_write_count: Math.max(a.query_created_write_count, b.query_created_write_count),
    write_when_negated_count: Math.max(a.write_when_negated_count, b.write_when_negated_count),
  };
}

function aggregateSafetyFromReports() {
  let agg = {
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
  };
  for (const name of SAFETY_REPORT_JSON) {
    const data = readJsonSafe(path.join(SCRIPTS, name));
    agg = maxSafety(agg, extractSafetyFromJson(data));
  }
  return agg;
}

function parseSafetyCountersLineFromRunReportMd(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!/^safety_counters=/i.test(t)) continue;
    const raw = t.replace(/^safety_counters=/i, "").trim();
    if (!raw || raw === "(none)") {
      return { dangerous_write_count: 0, false_write_count: 0, query_created_write_count: 0, write_when_negated_count: 0 };
    }
    try {
      const obj = JSON.parse(raw);
      return extractSafetyFromJson(obj);
    } catch {
      /* key=value;key=value */
    }
    const out = {
      dangerous_write_count: 0,
      false_write_count: 0,
      query_created_write_count: 0,
      write_when_negated_count: 0,
    };
    const parts = raw.split(";");
    for (const p of parts) {
      const kv = p.split("=");
      if (kv.length < 2) continue;
      const k = kv[0].trim();
      const v = parseInt(kv.slice(1).join("=").trim(), 10);
      if (!Number.isFinite(v)) continue;
      if (k in out) out[k] = v;
    }
    return out;
  }
  return null;
}

function safetyBlockFromRunReportMd(text) {
  const parsed = parseSafetyCountersLineFromRunReportMd(text);
  if (!parsed) return { blocked: false, counters: null };
  const blocked =
    parsed.dangerous_write_count > 0 ||
    parsed.false_write_count > 0 ||
    parsed.query_created_write_count > 0 ||
    parsed.write_when_negated_count > 0;
  return { blocked, counters: parsed };
}

function dirtyGitUnexpectedForFullAutoLoop(changedList) {
  const list = Array.isArray(changedList) ? changedList : [];
  for (const rel of list) {
    const n = normalizeRepoRel(rel);
    if (!n) continue;
    if (FULL_AUTO_LOOP_ALLOWED_DIRTY.has(repoRelGuardKey(n))) continue;
    if (cap50RuntimeRestoreReason(n)) continue;
    if (isTransientGeneratedAuditReportRel(n)) continue;
    if (isTransientGeneratedClusterClassifierReportRel(n)) continue;
    return { pass: false, firstUnexpected: n };
  }
  return { pass: true, firstUnexpected: "" };
}

function assetsAppJsDirty(changedList) {
  const list = Array.isArray(changedList) ? changedList : [];
  return list.some((rel) => repoRelGuardKey(rel) === "assets/app.js");
}

function parseSilverAdapterMetaKeyValues(text) {
  const out = {};
  const full = String(text || "");
  if (full.indexOf("# silver-cursor-agent-adapter") < 0) return out;
  const marker = "# stdout";
  const idx = full.indexOf(marker);
  const head = idx >= 0 ? full.slice(0, idx) : full;
  for (const raw of head.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    if (!/^[a-zA-Z0-9_]+$/.test(k)) continue;
    out[k] = line.slice(eq + 1);
  }
  return out;
}

const ADAPTER_OUTPUT_STATE_COMPLETED = new Set(["COMPLETED", "COMPLETE"]);

function isSilverAdapterCapture(text) {
  return String(text || "").indexOf("# silver-cursor-agent-adapter") >= 0;
}

function extractSilverAdapterStreamBodies(full) {
  const marker = "# stdout";
  const idx = full.indexOf(marker);
  const tail = idx >= 0 ? full.slice(idx + marker.length) : "";
  const stderrMarker = "# stderr";
  const stderrIdx = tail.indexOf(stderrMarker);
  const stdoutRaw = stderrIdx >= 0 ? tail.slice(0, stderrIdx) : tail;
  const stderrRaw = stderrIdx >= 0 ? tail.slice(stderrIdx + stderrMarker.length) : "";
  return {
    stdoutNonWs: stdoutRaw.replace(/\s/g, ""),
    stderrNonWs: stderrRaw.replace(/\s/g, ""),
  };
}

function cursorOutputStaleForAutonomousRun(cursorText) {
  const runId = String(process.env.SILVER_AUTONOMOUS_RUN_ID || "").trim();
  if (!runId) return false;
  const meta = parseSilverAdapterMetaKeyValues(cursorText);
  if (String(meta.adapter_output_state || "").trim() === "INVALIDATED_AWAITING_CYCLE") return true;
  const metaRunId = String(meta.autonomous_run_id || "").trim();
  if (!metaRunId || metaRunId !== runId) return true;
  const envCycle = String(process.env.SILVER_AUTONOMOUS_CYCLE || "").trim();
  if (envCycle) {
    const metaCycle = String(meta.autonomous_cycle || "").trim();
    if (metaCycle !== envCycle) return true;
  }
  const envRunStart = String(process.env.SILVER_AUTONOMOUS_RUN_START_UTC || "").trim();
  if (envRunStart) {
    const metaRunStart = String(meta.autonomous_run_start_utc || "").trim();
    if (metaRunStart && metaRunStart !== envRunStart) return true;
  }
  return false;
}

/**
 * Authoritative gate for adapter capture used by full-auto-loop (always enforced for adapter files).
 * @returns {object}
 */
function evaluateAutonomousAdapterOutput(cursorText) {
  const full = String(cursorText || "");
  const meta = parseSilverAdapterMetaKeyValues(full);
  const streams = extractSilverAdapterStreamBodies(full);
  const state = String(meta.adapter_output_state || "").trim();
  const stdoutFlagYes = String(meta.stdout_nonempty || "").toUpperCase() === "YES";
  const stdout_present =
    streams.stdoutNonWs.length >= 20 || (stdoutFlagYes && streams.stdoutNonWs.length > 0) ? "YES" : "NO";
  const stderr_present =
    streams.stderrNonWs.length > 0 || String(meta.stderr_nonempty || "").toUpperCase() === "YES" ? "YES" : "NO";
  const task_digest_present = String(meta.task_digest || "").trim().length > 0 ? "YES" : "NO";
  const process_start_present = String(meta.process_start_utc || "").trim().length > 0 ? "YES" : "NO";
  const exit_code_present = String(meta.exit_code || "").trim().length > 0 ? "YES" : "NO";
  const autonomous_cycle = String(meta.autonomous_cycle || "").trim() || "(empty)";

  const base = {
    adapter_output_state: state || "(empty)",
    adapter_output_valid: "NO",
    stale_detected: "NO",
    lifecycle_block_reason: "",
    stdout_present,
    stderr_present,
    task_digest_present,
    process_start_present,
    autonomous_cycle,
    next_action_generation_allowed: "NO",
    fallback_template_used: "NO",
    is_adapter_capture: isSilverAdapterCapture(full) ? "YES" : "NO",
  };

  if (!isSilverAdapterCapture(full)) {
    return {
      ...base,
      adapter_output_valid: "NA",
      lifecycle_block_reason: "not_adapter_capture",
      next_action_generation_allowed: "NA",
    };
  }

  let reason = "";
  if (state === "INVALIDATED_AWAITING_CYCLE") {
    reason = "invalidated_awaiting_cycle_non_authoritative";
    base.stale_detected = "YES";
  } else if (!ADAPTER_OUTPUT_STATE_COMPLETED.has(state)) {
    reason = "adapter_output_state_not_completed:" + (state || "(empty)");
    if (state) base.stale_detected = "YES";
  } else if (process_start_present === "NO") {
    reason = "missing_process_start_utc";
  } else if (exit_code_present === "NO") {
    reason = "missing_exit_code";
  } else if (stdout_present === "NO") {
    reason = "empty_stdout";
  } else if (task_digest_present === "NO") {
    reason = "missing_task_digest";
  } else if (cursorOutputStaleForAutonomousRun(full)) {
    reason = "autonomous_run_identity_mismatch";
    base.stale_detected = "YES";
  } else {
    base.adapter_output_valid = "YES";
    base.next_action_generation_allowed = "YES";
    reason = "(none)";
  }

  if (base.adapter_output_valid !== "YES") {
    base.lifecycle_block_reason = reason;
  } else {
    base.lifecycle_block_reason = reason;
  }
  return base;
}

function buildAdapterInvalidFailSafeStopBody(evalResult) {
  const ev = evalResult || {};
  return [
    "STOP — SILVER_CURSOR_OUTPUT.md adapter capture is stale or non-authoritative.",
    "",
    "- adapter_output_state=" + String(ev.adapter_output_state || "(unknown)"),
    "- lifecycle_block_reason=" + String(ev.lifecycle_block_reason || "(unknown)"),
    "- stale_detected=" + String(ev.stale_detected || "NO"),
    "",
    "INVALIDATED_AWAITING_CYCLE and empty adapter stdout must never drive --full-auto-loop.",
    "",
    "1) Inspect adapter lifecycle:",
    "",
    "```",
    "node scripts/silver-autopilot.cjs --cli-autonomous-adapter-diagnostic",
    "```",
    "",
    "2) Run a fresh controlled adapter capture, then re-check diagnostic until adapter_output_valid=YES.",
    "",
    "3) Re-run full-auto-loop only after a valid adapter cycle:",
    "",
    "```",
    "node scripts/silver-autopilot.cjs --full-auto-loop --max-steps=1",
    "```",
  ].join("\n");
}

function pickFullAutoLoopInput() {
  const cursorText = readTextSafe(CURSOR_OUTPUT).trim();
  const reportText = readTextSafe(RUN_REPORT).trim();
  let adapterEval = null;

  if (cursorText.length >= 20) {
    if (isSilverAdapterCapture(cursorText)) {
      adapterEval = evaluateAutonomousAdapterOutput(cursorText);
      if (adapterEval.adapter_output_valid !== "YES") {
        console.log(
          "SILVER_CURSOR_OUTPUT_ADAPTER_INVALID=YES reason=" +
            String(adapterEval.lifecycle_block_reason || "unknown"),
        );
        return {
          source: "(adapter-invalid)",
          body: "",
          adapterEval,
          adapterBlockReason: adapterEval.lifecycle_block_reason,
        };
      }
    }
    if (cursorOutputStaleForAutonomousRun(cursorText)) {
      console.log(
        "SILVER_CURSOR_OUTPUT_STALE=YES reason=autonomous_run_identity_mismatch_or_invalidated",
      );
    } else {
      return {
        source: "SILVER_CURSOR_OUTPUT.md",
        body: cursorText.slice(0, 24000),
        adapterEval: adapterEval || evaluateAutonomousAdapterOutput(cursorText),
      };
    }
  }
  if (reportText.length >= 10) {
    return { source: "SILVER_RUN_REPORT.md", body: reportText.slice(0, 24000), adapterEval };
  }
  return { source: "(none)", body: "", adapterEval };
}

function violatesEngineTaskWithoutDiagnosticPolicy(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  const engineish =
    /\bassets\/app\.js\b/i.test(t) ||
    /\bengine\b.*\b(edit|chang|patch|refactor|rewrite)\b/i.test(t) ||
    /\brouting\b.*\b(edit|chang|patch|refactor|rewrite)\b/i.test(t) ||
    /\bnormalizer\b.*\b(edit|chang|patch|refactor|rewrite)\b/i.test(t);
  const diagnosticish =
    /\bdiagnostic\b/i.test(t) ||
    /\bscripts-only\b/i.test(t) ||
    /\bnode\s+scripts\/silver-/i.test(t) ||
    /\baudit_/i.test(t) ||
    /\bharness\b/i.test(t);
  return engineish && !diagnosticish;
}

/** Files under scripts/ that may be referenced in prompts (existence-checked at runtime). */
function buildRepoScriptsManifestForPrompt() {
  try {
    const names = fs.readdirSync(SCRIPTS);
    const lines = [];
    for (const name of names) {
      if (!/^silver-/i.test(name) && !/^audit_silver/i.test(name)) continue;
      let st;
      try {
        st = fs.statSync(path.join(SCRIPTS, name));
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      lines.push("scripts/" + String(name).replace(/\\/g, "/"));
    }
    lines.sort();
    const max = 200;
    if (lines.length > max) {
      return lines.slice(0, max).join("\n") + "\n… (" + lines.length + " total, showing " + max + ")";
    }
    return lines.join("\n");
  } catch {
    return "(unable to list scripts/)";
  }
}

const NEXT_ACTION_BANNED_HALLUCINATION_RUNS = [
  /\bnode\s+scripts\/silver-diagnostic\.js\b/i,
  /\bnode\s+scripts\/silver-smoke-test-maxcycles-1\.js\b/i,
];

/**
 * `silver-autopilot.cjs` launched with argv[2] absent (bare) hits usage + exit 1.
 * Fence blocks: Copy-paste runnable; flag any bare autopilot invocation.
 * Prose outside fences: only flag lone command lines unless the prior text line looks documentary (invalid/example).
 */
function isScriptsSilverAutopilotPathSlice(pathSlice) {
  const p = String(pathSlice || "").replace(/\\/g, "/").trim();
  if (!p) return false;
  return /^(?:\.\/)?scripts\/silver-autopilot\.cjs$/i.test(p);
}

function lineIndicatesDocumentaryContext(nonemptyLine) {
  const p = String(nonemptyLine || "").trim();
  if (!p) return false;
  return /\binvalid\b|\bincorrect\b|\bwrong\b|ROOT\s+CAUSE|MUST\b|SILVER_NEXT_ACTION\.md\s+GENERATED\b|GENERATED.{0,80}\binvalid\b|EXPLICIT\s+ARGS|WITHOUT\s+ARGS|bez[^\n]{0,20}(args|argument)|^TASK:|^GOAL:|^SCOPE:|^NO-GO:|^REQUIRED:|\*\*DO\s+NOT\b|ANTI[-\s]?PATTERN|PŘÍKLAD|NEPOUŽ|\breject\b/i.test(p);
}

/** Prose / STOP lines that mention forbidden `cat C:\...` as guidance, not as a runnable command. */
function lineIndicatesCatWindowsDocContext(nonemptyLine) {
  const p = String(nonemptyLine || "").trim();
  if (!p) return false;
  if (lineIndicatesDocumentaryContext(p)) return true;
  return /Nepoužívej|nepoužívej|never\s+(suggest|use)|don'?t\s+use|not\s+use|zakázan|Zakáz|použij\s+`Get-Content|use\s+Get-Content|Get-Content\s+-LiteralPath|místo\s+`?cat|instead\s+of\s+`?cat|`cat\s+C:\\[^`]*\.\.\./i.test(
    p,
  );
}

function lineLooksLikeRunnableCatWindows(line) {
  const t = String(line || "").trim();
  if (!t) return false;
  if (lineIndicatesCatWindowsDocContext(t)) return false;
  if (/`cat\s+C:\\[^`]*\.\.\./i.test(t)) return false;
  if (/Nepoužívej[^\n]*`?cat\s+C:/i.test(t)) return false;
  if (/never\s+suggest[^\n]*`?cat\s+C:/i.test(t)) return false;
  if (/^\s*cat\s+C:\\/i.test(t)) return true;
  if (/\bCommand:\s*`?cat\s+C:\\/i.test(t)) return true;
  if (/`cat\s+C:\\/i.test(t)) return true;
  return false;
}

/** Runnable `cat C:\...` only; documentary / fenced explanatory mentions are allowed. */
function nextActionHasRunnableCatWindowsInvocation(inner) {
  const text = String(inner || "").replace(/\r\n/g, "\n");
  const fenceBodies = [];
  const outsideLines = [];
  const lines = text.split(/\n/);
  let inFence = false;
  let curFenceLines = [];

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        fenceBodies.push(curFenceLines.join("\n"));
        curFenceLines = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      curFenceLines.push(line);
      continue;
    }
    outsideLines.push(line);
  }
  if (inFence) {
    fenceBodies.push(curFenceLines.join("\n"));
  }

  for (let bi = 0; bi < fenceBodies.length; bi++) {
    const fenceLines = fenceBodies[bi].split(/\n/);
    let prevNonEmpty = "";
    for (const line of fenceLines) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;
      if (!lineLooksLikeRunnableCatWindows(trimmed)) {
        prevNonEmpty = trimmed;
        continue;
      }
      const docAllowed =
        lineIndicatesCatWindowsDocContext(prevNonEmpty) || lineIndicatesCatWindowsDocContext(trimmed);
      if (!docAllowed) return true;
      prevNonEmpty = trimmed;
    }
  }

  let prevNonEmpty = "";
  for (let li = 0; li < outsideLines.length; li++) {
    const trimmed = String(outsideLines[li] || "").trim();
    if (!trimmed) continue;
    if (!lineLooksLikeRunnableCatWindows(trimmed)) {
      prevNonEmpty = trimmed;
      continue;
    }
    const docAllowed =
      lineIndicatesCatWindowsDocContext(prevNonEmpty) || lineIndicatesCatWindowsDocContext(trimmed);
    if (!docAllowed) return true;
    prevNonEmpty = trimmed;
  }

  return false;
}

/** True if bare `node …/silver-autopilot.cjs` (no `--…` autopilot argv) appears in segment. */
function segmentHasBareSilverAutopilotInvocation(rawSegment) {
  const raw = String(rawSegment || "").replace(/\r\n/g, "\n");
  const reNode = /\bnode(?:\.exe)?\s+/gi;
  let n;
  while ((n = reNode.exec(raw))) {
    let i = n.index + n[0].length;
    if (i >= raw.length) continue;

    let pathSlice = "";
    const qc = raw.charAt(i);
    if (qc === '"' || qc === "'" || qc === "`") {
      let j = i + 1;
      while (j < raw.length) {
        const c = raw.charAt(j);
        if (qc !== "`" && c === "\\") {
          j += 2;
          continue;
        }
        if (c === qc) break;
        j++;
      }
      pathSlice = raw.slice(i + 1, j);
      i = j + 1;
    } else {
      let j = i;
      while (j < raw.length) {
        const c = raw.charAt(j);
        if (c === " " || c === "\t" || c === "\n" || c === "\r") break;
        j++;
      }
      pathSlice = raw.slice(i, j);
      i = j;
    }

    if (!isScriptsSilverAutopilotPathSlice(pathSlice)) continue;

    while (i < raw.length && (raw.charAt(i) === " " || raw.charAt(i) === "\t")) i++;
    const aft = i >= raw.length ? "" : raw.slice(i);
    if (/^--\s*\S/i.test(aft)) continue;
    return true;
  }
  return false;
}

function nextActionHasBareSilverAutopilotNodeInvocation(inner) {
  const text = String(inner || "").replace(/\r\n/g, "\n");
  const fenceBodies = [];
  const outsideLines = [];
  const lines = text.split(/\n/);
  let inFence = false;
  let curFenceLines = [];

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        fenceBodies.push(curFenceLines.join("\n"));
        curFenceLines = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }

    if (inFence) {
      curFenceLines.push(line);
      continue;
    }

    outsideLines.push(line);
  }

  if (inFence) {
    fenceBodies.push(curFenceLines.join("\n"));
  }

  for (let bi = 0; bi < fenceBodies.length; bi++) {
    if (segmentHasBareSilverAutopilotInvocation(fenceBodies[bi])) return true;
  }

  let prevNonEmpty = "";
  for (let li = 0; li < outsideLines.length; li++) {
    const trimmed = String(outsideLines[li] || "").trim();
    if (!trimmed) continue;

    if (!/\bnode(?:\.exe)?\s+/i.test(trimmed)) {
      prevNonEmpty = trimmed;
      continue;
    }
    if (!segmentHasBareSilverAutopilotInvocation(trimmed)) {
      prevNonEmpty = trimmed;
      continue;
    }

    const docAllowed = lineIndicatesDocumentaryContext(prevNonEmpty) || lineIndicatesDocumentaryContext(trimmed);
    if (!docAllowed) return true;
    prevNonEmpty = trimmed;
  }

  return false;
}

/** Replace bare autopilot invocations with explicit `--status` (deterministic, copy-paste safe). */
function segmentSanitizeBareSilverAutopilotInvocation(rawSegment) {
  let raw = String(rawSegment || "").replace(/\r\n/g, "\n");
  const reNode = /\bnode(?:\.exe)?\s+/gi;
  const patches = [];
  let n;
  while ((n = reNode.exec(raw))) {
    let i = n.index + n[0].length;
    if (i >= raw.length) continue;

    let pathSlice = "";
    const qc = raw.charAt(i);
    if (qc === '"' || qc === "'" || qc === "`") {
      let j = i + 1;
      while (j < raw.length) {
        const c = raw.charAt(j);
        if (qc !== "`" && c === "\\") {
          j += 2;
          continue;
        }
        if (c === qc) break;
        j++;
      }
      pathSlice = raw.slice(i + 1, j);
      i = j + 1;
    } else {
      let j = i;
      while (j < raw.length) {
        const c = raw.charAt(j);
        if (c === " " || c === "\t" || c === "\n" || c === "\r") break;
        j++;
      }
      pathSlice = raw.slice(i, j);
      i = j;
    }

    if (!isScriptsSilverAutopilotPathSlice(pathSlice)) continue;

    while (i < raw.length && (raw.charAt(i) === " " || raw.charAt(i) === "\t")) i++;
    const aft = i >= raw.length ? "" : raw.slice(i);
    if (/^--\s*\S/i.test(aft)) continue;

    let lineEnd = i;
    while (lineEnd < raw.length && raw.charAt(lineEnd) !== "\n" && raw.charAt(lineEnd) !== "\r") {
      lineEnd++;
    }
    patches.push({ from: i, to: lineEnd, insert: " --status" });
  }

  if (!patches.length) return raw;

  patches.sort((a, b) => b.from - a.from);
  for (const p of patches) {
    raw = raw.slice(0, p.from) + p.insert + raw.slice(p.to);
  }
  return raw;
}

function sanitizeBareSilverAutopilotInText(inner) {
  const lines = String(inner || "").replace(/\r\n/g, "\n").split(/\n/);
  const out = [];
  let inFence = false;
  let fenceBuf = [];
  let prevNonEmpty = "";

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        const body = segmentSanitizeBareSilverAutopilotInvocation(fenceBuf.join("\n"));
        for (const fl of body.split(/\n/)) {
          out.push(fl);
        }
        fenceBuf = [];
        inFence = false;
        out.push(line);
      } else {
        inFence = true;
        out.push(line);
      }
      continue;
    }

    if (inFence) {
      fenceBuf.push(line);
      continue;
    }

    const trimmed = String(line || "").trim();
    if (
      trimmed &&
      /\bnode(?:\.exe)?\s+/i.test(trimmed) &&
      segmentHasBareSilverAutopilotInvocation(trimmed) &&
      !lineIndicatesDocumentaryContext(prevNonEmpty) &&
      !lineIndicatesDocumentaryContext(trimmed)
    ) {
      out.push(segmentSanitizeBareSilverAutopilotInvocation(line));
    } else {
      out.push(line);
    }
    if (trimmed) prevNonEmpty = trimmed;
  }

  if (inFence) {
    const body = segmentSanitizeBareSilverAutopilotInvocation(fenceBuf.join("\n"));
    for (const fl of body.split(/\n/)) {
      out.push(fl);
    }
  }

  return out.join("\n");
}

/** Sanitize bare autopilot commands, then quality-gate; fallback if still invalid. */
function writeNextActionUtf8Safe(absPath, text) {
  let body = repairSilverOpenAiUtf8Text(String(text || "").trim());
  writeUtf8FileNoBom(absPath, body);
  const readBack = fs.readFileSync(absPath, "utf8");
  if (hasSilverUtf8MojibakeMarkers(readBack)) {
    body = repairSilverOpenAiUtf8Text(readBack);
    writeUtf8FileNoBom(absPath, body);
    console.log("SILVER_OPENAI_UTF8_REPAIR=YES path=post_write_readback");
  }
  return body;
}

function resolveNextActionModelBody(rawBody, fallbackCtx) {
  let body = repairSilverOpenAiUtf8Text(
    stripSilverAutopilotUkolHeaderLine(String(rawBody || "").trim()),
  );
  const hadBare = nextActionHasBareSilverAutopilotNodeInvocation(body);
  if (hadBare) {
    body = sanitizeBareSilverAutopilotInText(body);
    console.log("SILVER_NEXT_ACTION_BARE_AUTOPILOT=sanitized_to_status");
  }
  const q = nextActionInnerQualityViolations(body);
  const tagProbeViolations = silverNextActionQualityViolations(
    wrapNextActionDoc(body, "full-auto-loop-openai"),
  );
  const allViolations = [...new Set([...q, ...tagProbeViolations])];
  if (allViolations.length) {
    return {
      ok: false,
      body: buildPlannerRejectedBody(fallbackCtx || {}),
      violations: allViolations,
      bareSanitized: hadBare,
      clusterHandoff: isHealthyPlannerContext(normalizePlannerContext(fallbackCtx || {})),
    };
  }
  return { ok: true, body, violations: [], bareSanitized: hadBare };
}

function normalizePlannerContext(ctx) {
  return {
    guardBlocked: !!(ctx && ctx.guardBlocked),
    safetyBlocked: !!(ctx && ctx.safetyBlocked),
    dirtyBlocked: !!(ctx && ctx.dirtyBlocked),
  };
}

function buildPlannerRejectedBody(fallbackCtx) {
  if (fallbackCtx && fallbackCtx.adapterInvalid) {
    return buildAdapterInvalidFailSafeStopBody(fallbackCtx.adapterEval);
  }
  const plannerCtx = normalizePlannerContext(fallbackCtx || {});
  if (isHealthyPlannerContext(plannerCtx)) {
    return buildClusterHandoffForHealthyPlanner({
      mainCommit: fallbackCtx && fallbackCtx.mainCommit,
      queueReport: readOrchestratorReport(),
    });
  }
  return buildFullAutoQualityFallbackBody(fallbackCtx || {});
}

function writeClusterHandoffFile(mainCommit) {
  const md = buildClusterHandoffForHealthyPlanner({
    mainCommit: mainCommit || "",
    queueReport: readOrchestratorReport(),
  });
  writeUtf8FileNoBom(NEXT_ACTION, md);
  return md;
}

function nextActionInnerQualityViolations(inner) {
  const t = String(inner || "");
  const violations = [...silverNextActionQualityViolations(t)];
  if (nextActionHasBareSilverAutopilotNodeInvocation(t)) {
    violations.push("bare_silver_autopilot_node_use_status_subcommand");
  }
  for (const re of NEXT_ACTION_BANNED_HALLUCINATION_RUNS) {
    if (re.test(t)) violations.push("banned_node_invocation:" + String(re));
  }
  if (nextActionHasRunnableCatWindowsInvocation(t)) {
    violations.push("cat_windows_path");
  }
  return violations;
}

function buildFullAutoQualityFallbackBody(ctx) {
  const src = String((ctx && ctx.inputSource) || "SILVER_RUN_REPORT.md");
  const changed = String((ctx && ctx.changedFilesJoined) || "").trim();
  return [
    "### Vyhodnocení vstupů (povinné jako první)",
    "",
    "1) V PowerShell z kořene repa `C:\\projects\\filtr` spusť:",
    "",
    "```",
    "Set-Location C:\\projects\\filtr",
    "Get-Content -LiteralPath .\\SILVER_CURSOR_OUTPUT.md -Raw",
    "Get-Content -LiteralPath .\\SILVER_RUN_REPORT.md -Raw",
    "```",
    "",
    "2) **Git dirty jen runtime:** Pokud `git status --short` ukazuje výhradně soubory `SILVER_*.md` (případně další výslovně povolené reporting soubory), **nejprve** shrň obsah a důsledek pro další krok, teprve poté zvaž `git restore --worktree -- <cesta>`. Nikdy neobnovuj engine soubory „naslepo“.",
    "",
    "3) Stav autopilota (existující skript — vždy dostupný):",
    "",
    "```",
    "node scripts/silver-autopilot.cjs --status",
    "```",
    "",
    "4) Diagnostika Cursor / WSL adaptéru (existující):",
    "",
    "```",
    "powershell -ExecutionPolicy Bypass -File scripts\\silver-cursor-agent-adapter-diagnostic.ps1",
    "```",
    "",
    "### Scope guard (tvrdý limit)",
    "- Povoleno: diagnostika, skripty pod `scripts/` z manifestu v promptu autopilota / existující `silver-*` a `audit_silver*`, root reporty `SILVER_*.md`, úpravy `scripts/silver-autopilot.cjs` dle procesu.",
    "- Zakázáno: úpravy `assets/app.js`, engine core, routing, retrieval refaktory bez výslovného scope, deploy, **vymýšlení** nových cest `scripts/*.js`, které v repu nejsou.",
    "",
    "### STOP podmínky",
    "- **MaxCycles 0 (PowerShell outer loop)**: raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je **zakázáno**; řízený autonomous mode existuje jen s těmito přepínači a stále má **tvrdý strop cyklů** + emergency stop — v rámci úkolu **nespouštěj** reálný nekonečný běh ani neobcházej tyto pojistky.",
    "- Nepoužívej `cat C:\\...` na Windows; použij `Get-Content -LiteralPath`.",
    "- Neexistují soubory `scripts/silver-diagnostic.js` ani `scripts/silver-smoke-test-maxcycles-1.js` — neuváděj je.",
    "",
    "### Kontext (autopilot)",
    "- Poslední zdroj vstupu pro full-auto loop byl: **" + src + "**.",
    "- Poslední známý seznam změn z autopilota: `" + (changed || "(prázdné — ověř git status)") + "`.",
    "",
    "### Povinný výsledek (vlož do chatu po provedení)",
    "",
    "```",
    "=== SILVER_CURSOR_MANUAL_VERIFY_RESULT ===",
    "input_files_read=YES/NO",
    "git_runtime_only_dirty=YES/NO/NA",
    "autopilot_status_ran=YES/NO",
    "adapter_diagnostic_ran=YES/NO/NA",
    "engine_or_assets_touch_planned=NO",
    "max_cycles_zero_attempted=NO",
    "=== END_SILVER_CURSOR_MANUAL_VERIFY_RESULT ===",
    "```",
    "",
    "_Automaticky vložená náhrada: výstup modelu neprošel kontrolou kvality (UTF-8 / PowerShell / zakázané řetězce)._",
  ].join("\n");
}

function wrapNextActionDoc(inner, tag) {
  const header =
    "<!-- SILVER_NEXT_ACTION: " +
    String(tag || "silver-autopilot") +
    "; copy-paste for Cursor; not auto-applied -->\n\n" +
    "ÚKOL PRO CURSOR — infoUzel.cz / Silver\n\n";
  return header + String(inner || "").trim() + "\n";
}

function printFullAutoLoopResult(ctx) {
  console.log("=== SILVER_AUTOPILOT_FULL_AUTO_LOOP_RESULT ===");
  console.log("main_commit=" + String(ctx.main_commit || ""));
  console.log("mode=" + String(ctx.mode || ""));
  console.log("input_source=" + String(ctx.input_source || ""));
  if (ctx.adapter_gate) console.log(String(ctx.adapter_gate));
  console.log("openai_api=" + String(ctx.openai_api || ""));
  console.log("next_action_written=" + String(ctx.next_action_written || "NO"));
  console.log("next_action_file=SILVER_NEXT_ACTION.md");
  console.log("engine_changed=" + String(ctx.engine_changed || "NO"));
  console.log("assets_app_changed=" + String(ctx.assets_app_changed || "NO"));
  console.log("git_status_clean=" + String(ctx.git_status_clean || "NO"));
  console.log("safety_block_detected=" + String(ctx.safety_block_detected || "NO"));
  console.log("recommended_next_task=" + String(ctx.recommended_next_task || ""));
  console.log("=== END_SILVER_AUTOPILOT_FULL_AUTO_LOOP_RESULT ===");
}

function printFullAutoLoopV1Result(ctx) {
  console.log("=== SILVER_AUTOPILOT_FULL_AUTO_LOOP_V1_RESULT ===");
  console.log("main_commit=" + String(ctx.main_commit || ""));
  console.log("branch=" + String(ctx.branch || ""));
  console.log("engine_changed=" + String(ctx.engine_changed || "NO"));
  console.log("assets_app_changed=" + String(ctx.assets_app_changed || "NO"));
  console.log("changed_files=" + String(ctx.changed_files || ""));
  console.log("status_exit=" + String(ctx.status_exit != null ? ctx.status_exit : ""));
  console.log("full_auto_loop_exit=" + String(ctx.full_auto_loop_exit != null ? ctx.full_auto_loop_exit : ""));
  console.log("openai_api_used=" + String(ctx.openai_api_used || "NO"));
  console.log("next_action_written=" + String(ctx.next_action_written || "NO"));
  console.log("next_action_file=SILVER_NEXT_ACTION.md");
  console.log("dirty_git_guard=" + String(ctx.dirty_git_guard || "FAIL"));
  console.log("assets_app_guard=" + String(ctx.assets_app_guard || "FAIL"));
  console.log("safety_guard=" + String(ctx.safety_guard || "FAIL"));
  console.log("fallback_without_api=" + String(ctx.fallback_without_api || "N/A"));
  console.log("git_status_clean=" + String(ctx.git_status_clean || "NO"));
  console.log("pr_ready=" + String(ctx.pr_ready || "NO"));
  console.log("recommended_next_task=" + String(ctx.recommended_next_task || ""));
  console.log("=== END_SILVER_AUTOPILOT_FULL_AUTO_LOOP_V1_RESULT ===");
}

function parseCalendar20k(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s || /^skipped$/i.test(s) || /^n\/a$/i.test(s) || /^unknown$/i.test(s)) return { ok: true, raw: s || "SKIPPED", strict: false };
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return { ok: false, raw: s, strict: true };
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (b !== 3000) return { ok: false, raw: s, strict: true };
  return { ok: a === 3000 && b === 3000, raw: s, strict: true };
}

function aggregateCalendar20kFromReports() {
  let writeRaw = "";
  let queryRaw = "";
  let writeOk = true;
  let queryOk = true;
  const applyPair = (cw, cq) => {
    const pw = parseCalendar20k(cw);
    const pq = parseCalendar20k(cq);
    if (pw.raw) writeRaw = pw.raw;
    if (pq.raw) queryRaw = pq.raw;
    if (pw.strict) writeOk = writeOk && pw.ok;
    if (pq.strict) queryOk = queryOk && pq.ok;
  };
  const rcz = readJsonSafe(path.join(SCRIPTS, "silver-real-czech-public-ux-corpus-v2-report.json"));
  if (rcz) {
    const g = rcz.gates && typeof rcz.gates === "object" ? rcz.gates : {};
    applyPair(
      rcz.calendar_write_20k != null ? rcz.calendar_write_20k : g.calendar_write_20k,
      rcz.calendar_query_20k != null ? rcz.calendar_query_20k : g.calendar_query_20k,
    );
  }
  const qual = readJsonSafe(path.join(SCRIPTS, "silver-quality-v2-report.json"));
  if (qual) applyPair(qual.calendar_write_20k, qual.calendar_query_20k);
  const chaos = readJsonSafe(path.join(SCRIPTS, "silver-real-human-chaos-v3-report.json"));
  if (chaos && chaos.baseline_metrics && typeof chaos.baseline_metrics === "object") {
    applyPair(chaos.baseline_metrics.calendar_write_20k, chaos.baseline_metrics.calendar_query_20k);
  }
  return {
    calendar_write_20k: writeRaw || "UNKNOWN",
    calendar_query_20k: queryRaw || "UNKNOWN",
    calendar_write_ok: writeOk,
    calendar_query_ok: queryOk,
  };
}

function countSubstr(haystack, needle) {
  const h = String(haystack || "");
  const n = String(needle || "");
  if (!h || !n) return 0;
  let c = 0;
  let i = 0;
  while (true) {
    const j = h.indexOf(n, i);
    if (j < 0) break;
    c++;
    i = j + n.length;
  }
  return c;
}

function scanRawRealisticMobileMentions(jsonBasenames) {
  const failPatterns = ['realistic_mobile=FAIL', '"realistic_mobile":"FAIL"'];
  const passPatterns = ['realistic_mobile=PASS', '"realistic_mobile":"PASS"'];
  let rawFail = 0;
  let rawPass = 0;
  const names = Array.isArray(jsonBasenames) ? jsonBasenames : REALISTIC_MOBILE_RAW_SCAN_JSON;
  for (const name of names) {
    const t = readTextSafe(path.join(SCRIPTS, name));
    for (const p of failPatterns) rawFail += countSubstr(t, p);
    for (const p of passPatterns) rawPass += countSubstr(t, p);
  }
  return { rawFail, rawPass };
}

/**
 * Authoritative post-merge realistic-mobile gate: dedicated audit output
 * (`audit_silver_realistic_mobile_corpus.cjs` → silver-realistic-mobile-corpus-report.json).
 * Sibling reports may embed stale `realistic_mobile` after `git restore` on tracked *report.json.
 */
function parseAuthoritativeRealisticMobileFromCorpusReport(data) {
  if (!data || typeof data !== "object") {
    return { gate: "UNKNOWN", source: "(missing_or_invalid_json)", reason: "no_corpus_report_json" };
  }
  const rmc = data.real_mobile_cases;
  if (rmc === "PASS") {
    return {
      gate: "PASS",
      source: REALISTIC_MOBILE_CORPUS_REPORT + ":real_mobile_cases",
      reason: "corpus_report_declares_PASS",
    };
  }
  if (rmc === "FAIL") {
    return {
      gate: "FAIL",
      source: REALISTIC_MOBILE_CORPUS_REPORT + ":real_mobile_cases",
      reason: "corpus_report_declares_FAIL",
    };
  }
  const top = data.top_20_fail_clusters;
  const fc = data.fail_count_by_cluster;
  let sumFails = 0;
  if (fc && typeof fc === "object") {
    for (const k of Object.keys(fc)) {
      const v = Number(fc[k]);
      if (Number.isFinite(v)) sumFails += v;
    }
  }
  const topEmpty = !Array.isArray(top) || top.length === 0;
  if (topEmpty && sumFails === 0) {
    return {
      gate: "PASS",
      source: REALISTIC_MOBILE_CORPUS_REPORT + ":derived_no_fails",
      reason: "real_mobile_cases_absent_but_zero_fails",
    };
  }
  return {
    gate: "UNKNOWN",
    source: REALISTIC_MOBILE_CORPUS_REPORT + ":ambiguous",
    reason: "real_mobile_cases_missing_and_fail_signals_present",
  };
}

function readDeepProductEmbeddedRealisticMobileGate(data) {
  if (!data || typeof data !== "object") return "";
  const g = data.gates && typeof data.gates === "object" ? data.gates : {};
  return String(g.realistic_mobile || "").trim();
}

function proofSummaryConsistentFromAuthoritative(authoritativeGate) {
  return authoritativeGate === "PASS" ? "YES" : "NO";
}

/**
 * Separates real adapter/run lifecycle stale meta from stale embedded JSON gate hints.
 * Authoritative realistic_mobile corpus PASS always wins over sibling embedded FAIL strings.
 */
function classifyReportingHygiene(authoritativeGate, deepEmbedded, rawFail, rawPass) {
  const authPass = String(authoritativeGate || "").trim() === "PASS";
  const embeddedFail = String(deepEmbedded || "").trim() === "FAIL";
  const staleEmbeddedHint = authPass && embeddedFail;
  const rawFailHint = authPass && Number(rawFail) > 0;
  const rawPassHint = authPass && Number(rawPass) > 0;
  return {
    real_stale_meta_issue_seen: "NO",
    stale_embedded_hint_seen: staleEmbeddedHint ? "YES" : "NO",
    stale_embedded_hint_non_authoritative: staleEmbeddedHint ? "YES" : "NO",
    stale_raw_substring_hint_seen: rawFailHint ? "YES" : "NO",
    stale_raw_substring_hint_non_authoritative: rawFailHint ? "YES" : "NO",
    authoritative_runtime_pass: authPass ? "YES" : "NO",
    reporting_embedded_fail_is_non_authoritative_hint: staleEmbeddedHint ? "YES" : "NO",
    reporting_raw_fail_substrings_ignored_when_authoritative_pass: rawFailHint ? "YES" : "NO",
    reporting_raw_pass_substrings_informational_only: rawPassHint ? "YES" : "NO",
  };
}

function mergeReportingHygieneIntoPayload(payload, authoritativeGate, deepEmbedded, rawFail, rawPass) {
  const h = classifyReportingHygiene(authoritativeGate, deepEmbedded, rawFail, rawPass);
  for (const k of Object.keys(h)) {
    payload[k] = h[k];
  }
  return payload;
}

function buildProofGateConsistencyReason(authoritative, deepEmbedded, rawFail, rawPass) {
  const parts = [];
  parts.push("authoritative_verdict_primary=" + authoritative.gate);
  parts.push("authoritative=" + authoritative.gate + "@" + authoritative.source);
  parts.push("authoritative_gate_used=realistic_mobile_corpus_json");
  if (deepEmbedded) parts.push("deep_product_embedded_gate=" + deepEmbedded);
  else parts.push("deep_product_embedded_gate=(absent)");
  parts.push("embedded_gate_authoritative=NO");
  parts.push("raw_substring_FAIL_mentions=" + rawFail + "_PASS_mentions=" + rawPass);
  if (authoritative.gate === "PASS" && deepEmbedded === "FAIL") {
    parts.push("deep_product_embedded_gate_hint=STALE_NON_AUTHORITATIVE_FAIL");
    parts.push("embedded_FAIL_with_authoritative_PASS_means=not_real_product_defect");
    parts.push(
      "diagnosis=stale_embedded_sibling_hint_non_authoritative_not_product_fail_deep_may_rerun_gates",
    );
  } else if (authoritative.gate === "PASS" && rawFail > 0) {
    parts.push("diagnosis=raw_FAIL_strings_in_non_authoritative_or_restored_JSON_ignored_for_autopilot_PASS");
  } else if (authoritative.gate === "PASS") {
    parts.push("diagnosis=aligned_authoritative_PASS");
  }
  return parts.join(" | ");
}

function printProofGateConsistencyResult(ctx) {
  console.log("=== SILVER_AUTOPILOT_PROOF_GATE_CONSISTENCY_RESULT ===");
  console.log("main_commit=" + String(ctx.main_commit || ""));
  console.log("engine_changed=" + String(ctx.engine_changed || "NO"));
  console.log("assets_app_changed=" + String(ctx.assets_app_changed || "NO"));
  console.log("changed_files=" + String(ctx.changed_files || ""));
  console.log("post_merge_proof_exit=" + String(ctx.post_merge_proof_exit != null ? ctx.post_merge_proof_exit : ""));
  console.log("authoritative_realistic_mobile=" + String(ctx.authoritative_realistic_mobile || ""));
  console.log("raw_realistic_mobile_fail_mentions=" + String(ctx.raw_realistic_mobile_fail_mentions != null ? ctx.raw_realistic_mobile_fail_mentions : ""));
  console.log("raw_realistic_mobile_pass_mentions=" + String(ctx.raw_realistic_mobile_pass_mentions != null ? ctx.raw_realistic_mobile_pass_mentions : ""));
  console.log("selected_authoritative_source=" + String(ctx.selected_authoritative_source || ""));
  console.log("proof_summary_consistent=" + String(ctx.proof_summary_consistent || ""));
  console.log("gate_realistic_mobile=" + String(ctx.gate_realistic_mobile || ctx.authoritative_realistic_mobile || ""));
  const authRmLine = String(ctx.authoritative_realistic_mobile || "").trim();
  const deepEmbRaw = String(ctx.deep_product_embedded_gate_raw || "").trim();
  if (authRmLine === "PASS" && deepEmbRaw === "FAIL") {
    console.log("deep_product_embedded_gate_clarity=stale_non_authoritative_JSON_sibling_hint_only");
    console.log("PASS_FAIL_verdict_source=authoritative_realistic_mobile_corpus_JSON_not_embedded_field");
    console.log("real_product_defect_from_embedded_FAIL_when_authoritative_PASS=NO");
  }
  const hygiene = classifyReportingHygiene(
    authRmLine || ctx.authoritative_realistic_mobile,
    deepEmbRaw,
    ctx.raw_realistic_mobile_fail_mentions,
    ctx.raw_realistic_mobile_pass_mentions,
  );
  console.log("real_stale_meta_issue_seen=" + hygiene.real_stale_meta_issue_seen);
  console.log("stale_embedded_hint_seen=" + hygiene.stale_embedded_hint_seen);
  console.log("stale_embedded_hint_non_authoritative=" + hygiene.stale_embedded_hint_non_authoritative);
  console.log("authoritative_runtime_pass=" + hygiene.authoritative_runtime_pass);
  console.log(
    "reporting_embedded_fail_is_non_authoritative_hint=" + hygiene.reporting_embedded_fail_is_non_authoritative_hint,
  );
  console.log("reason=" + String(ctx.reason || ""));
  console.log("dangerous_write_count=" + String(ctx.dangerous_write_count != null ? ctx.dangerous_write_count : ""));
  console.log("false_write_count=" + String(ctx.false_write_count != null ? ctx.false_write_count : ""));
  console.log("query_created_write_count=" + String(ctx.query_created_write_count != null ? ctx.query_created_write_count : ""));
  console.log("write_when_negated_count=" + String(ctx.write_when_negated_count != null ? ctx.write_when_negated_count : ""));
  console.log("calendar_write_20k=" + String(ctx.calendar_write_20k || ""));
  console.log("calendar_query_20k=" + String(ctx.calendar_query_20k || ""));
  console.log("git_status_clean=" + String(ctx.git_status_clean || ""));
  console.log("recommended_next_task=" + String(ctx.recommended_next_task || ""));
  console.log("=== END_SILVER_AUTOPILOT_PROOF_GATE_CONSISTENCY_RESULT ===");
}

function postMergeStepLabel(step) {
  if (!step || typeof step !== "object") return "";
  if (step.kind === "npm") return "npm:" + (Array.isArray(step.args) ? step.args.join(" ") : "");
  if (step.kind === "node") return "node:" + String(step.file || "");
  return JSON.stringify(step);
}

function printPostMergeProofStrictFailResult(ctx) {
  console.log("=== SILVER_AUTOPILOT_POST_MERGE_PROOF_STRICT_FAIL_RESULT ===");
  console.log("main_commit=" + String(ctx.main_commit || ""));
  console.log("branch=" + String(ctx.branch || ""));
  console.log("pr_url=" + String(ctx.pr_url || ""));
  console.log("engine_changed=" + String(ctx.engine_changed || "NO"));
  console.log("assets_app_changed=" + String(ctx.assets_app_changed || "NO"));
  console.log("changed_files=" + String(ctx.changed_files || ""));
  console.log("status_exit=" + String(ctx.status_exit != null && ctx.status_exit !== "" ? ctx.status_exit : ""));
  console.log("post_merge_proof_exit=" + String(ctx.post_merge_proof_exit != null ? ctx.post_merge_proof_exit : ""));
  console.log("post_merge_proof_logical_status=" + String(ctx.post_merge_proof_logical_status || ""));
  console.log("tracked_report_restore_before_realistic_mobile=" + String(ctx.tracked_report_restore_before_realistic_mobile || ""));
  console.log("failed_step=" + String(ctx.failed_step || ""));
  console.log("failed_reason=" + String(ctx.failed_reason || ""));
  console.log("forced_fail_test_exit=" + String(ctx.forced_fail_test_exit != null ? ctx.forced_fail_test_exit : ""));
  console.log("forced_fail_test_pass=" + String(ctx.forced_fail_test_pass || ""));
  console.log("dangerous_write_count=" + String(ctx.dangerous_write_count != null ? ctx.dangerous_write_count : ""));
  console.log("false_write_count=" + String(ctx.false_write_count != null ? ctx.false_write_count : ""));
  console.log("query_created_write_count=" + String(ctx.query_created_write_count != null ? ctx.query_created_write_count : ""));
  console.log("write_when_negated_count=" + String(ctx.write_when_negated_count != null ? ctx.write_when_negated_count : ""));
  console.log("calendar_write_20k=" + String(ctx.calendar_write_20k || ""));
  console.log("calendar_query_20k=" + String(ctx.calendar_query_20k || ""));
  console.log("git_status_clean=" + String(ctx.git_status_clean || ""));
  console.log("pr_ready=" + String(ctx.pr_ready || ""));
  console.log("recommended_next_task=" + String(ctx.recommended_next_task || ""));
  console.log("=== END_SILVER_AUTOPILOT_POST_MERGE_PROOF_STRICT_FAIL_RESULT ===");
}

function writeRunReport(payload) {
  const envTapP = String(process.env.SILVER_TIMEOUT_ARCHIVE_PATH || "").trim();
  const envTapA0 = String(process.env.SILVER_TIMEOUT_ARTIFACTS_ARCHIVED || "").trim();
  const envTapA = envTapA0 || (envTapP ? "YES" : "NO");
  const timeoutArchivePathLine =
    payload.timeout_archive_path != null && String(payload.timeout_archive_path).trim() !== ""
      ? String(payload.timeout_archive_path).trim()
      : envTapP;
  const timeoutArtifactsArchivedLine =
    payload.timeout_artifacts_archived != null && String(payload.timeout_artifacts_archived).trim() !== ""
      ? String(payload.timeout_artifacts_archived).trim()
      : envTapA;
  const lines = [
    "# SILVER_RUN_REPORT",
    "",
    "timestamp=" + String(payload.timestamp || ""),
    "command=" + String(payload.command || ""),
    "status=" + String(payload.status || "STOP"),
    "branch=" + String(payload.branch || ""),
    "commit=" + String(payload.commit || ""),
    "git_status_clean=" + String(payload.git_status_clean || "NO"),
    "changed_files=" + String(payload.changed_files || ""),
    "pr_info=" + String(payload.pr_info || ""),
    "engine_changed=" + String(payload.engine_changed || "UNKNOWN"),
    "assets_app_changed=" + String(payload.assets_app_changed || "UNKNOWN"),
    "ui_changed=" + String(payload.ui_changed || "UNKNOWN"),
    "css_changed=" + String(payload.css_changed || "UNKNOWN"),
    "backend_changed=" + String(payload.backend_changed || "UNKNOWN"),
    "safety_counters=" + String(payload.safety_counters || ""),
    "calendar_write_20k=" + String(payload.calendar_write_20k || ""),
    "calendar_query_20k=" + String(payload.calendar_query_20k || ""),
    "gate_realistic_mobile=" + String(payload.gate_realistic_mobile || ""),
    "raw_realistic_mobile_mentions_FAIL=" + String(payload.raw_realistic_mobile_mentions_FAIL != null ? payload.raw_realistic_mobile_mentions_FAIL : ""),
    "raw_realistic_mobile_mentions_PASS=" + String(payload.raw_realistic_mobile_mentions_PASS != null ? payload.raw_realistic_mobile_mentions_PASS : ""),
    "selected_authoritative_source=" + String(payload.selected_authoritative_source || ""),
    "proof_gate_consistency_reason=" + String(payload.proof_gate_consistency_reason || ""),
    "proof_summary_consistent=" + String(payload.proof_summary_consistent || ""),
    "real_stale_meta_issue_seen=" + String(payload.real_stale_meta_issue_seen || "NO"),
    "stale_embedded_hint_seen=" + String(payload.stale_embedded_hint_seen || "NO"),
    "stale_embedded_hint_non_authoritative=" + String(payload.stale_embedded_hint_non_authoritative || "NO"),
    "stale_raw_substring_hint_seen=" + String(payload.stale_raw_substring_hint_seen || "NO"),
    "authoritative_runtime_pass=" + String(payload.authoritative_runtime_pass || ""),
    "reporting_embedded_fail_is_non_authoritative_hint=" +
      String(payload.reporting_embedded_fail_is_non_authoritative_hint || "NO"),
    "post_merge_proof_exit_code=" + String(payload.post_merge_proof_exit_code != null ? payload.post_merge_proof_exit_code : ""),
    "post_merge_proof_logical_status=" + String(payload.post_merge_proof_logical_status || ""),
    "post_merge_proof_process_exit=" + String(payload.post_merge_proof_process_exit != null ? payload.post_merge_proof_process_exit : ""),
    "tracked_report_restore_before_realistic_mobile=" + String(payload.tracked_report_restore_before_realistic_mobile || ""),
    "failed_step=" + String(payload.failed_step || ""),
    "failed_reason=" + String(payload.failed_reason || ""),
    "next_recommended_command=" + String(payload.next_recommended_command || ""),
    "recommended_next_task=" + String(payload.recommended_next_task || ""),
    "utf8_mojibake_detected=" + String(payload.utf8_mojibake_detected || "NO"),
    "ready_for_product_cap50=" + String(payload.ready_for_product_cap50 || ""),
    "reason_for_stop=" + String(payload.reason_for_stop || ""),
    "timeout_archive_path=" + timeoutArchivePathLine,
    "timeout_artifacts_archived=" + timeoutArtifactsArchivedLine,
  ];
  const cepRaw = payload.core_engine_progress;
  const cep = cepRaw == null ? "" : String(cepRaw).trim();
  if (cep && !cep.includes("baseline_pending_precise_measurement")) {
    lines.push("core_engine_progress=" + cep);
  }
  lines.push(
    "",
    "## Notes",
    "- Autopilot V1 never commits secrets. Do not paste `OPENAI_API_KEY` into this file.",
    "",
  );
  fs.writeFileSync(RUN_REPORT, lines.join("\n"), "utf8");
}

function summarizeLastReportBlock() {
  const t = readTextSafe(RUN_REPORT);
  if (!t) return "(no prior SILVER_RUN_REPORT.md)";
  const lines = t.split(/\r?\n/).filter((l) => /^[a-z_]+=/i.test(l));
  return lines.slice(0, 12).join(" | ") || "(empty structured lines)";
}

function openPrForCurrentBranch() {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") return { summary: "(detached)", url: "", number: "" };
  try {
    const rows = ghJson(["pr", "list", "--head", branch, "--json", "number,url,state,title", "--limit", "5"]);
    if (!Array.isArray(rows) || rows.length === 0) return { summary: "(none)", url: "", number: "" };
    const o = rows[0];
    return {
      summary: "PR #" + o.number + " " + String(o.state || "") + " " + String(o.title || "").slice(0, 120),
      url: String(o.url || ""),
      number: String(o.number || ""),
    };
  } catch {
    return { summary: "(gh unavailable or no PR)", url: "", number: "" };
  }
}

function cmdStatus(argvCommand) {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = runGit(["rev-parse", "HEAD"]);
  const clean = gitClean();
  const changed = gitChangedFilesList().join(";");
  const pr = openPrForCurrentBranch();
  const safety = aggregateSafetyFromReports();
  const cal = aggregateCalendar20kFromReports();
  const safetyStr =
    "dangerous_write_count=" +
    safety.dangerous_write_count +
    ";false_write_count=" +
    safety.false_write_count +
    ";query_created_write_count=" +
    safety.query_created_write_count +
    ";write_when_negated_count=" +
    safety.write_when_negated_count;

  let status = "PASS";
  let reason = "";
  /* --status is informational: dirty git is reported but not STOP for this command. */

  const nextCmd = gitClean()
    ? "node scripts/silver-autopilot.cjs --verify-pr=<NUMBER>"
    : "git status; resolve dirty tree before verify/merge/auto";

  const priorReportSnapshot = summarizeLastReportBlock();

  const corpusDataStatus = readJsonSafe(path.join(SCRIPTS, REALISTIC_MOBILE_CORPUS_REPORT));
  const authJsonStatus = parseAuthoritativeRealisticMobileFromCorpusReport(corpusDataStatus);
  const authoritativeGateStatus = authJsonStatus.gate === "FAIL" ? "FAIL" : "PASS";
  const authForStatus = {
    gate: authoritativeGateStatus,
    source: authJsonStatus.source + "+status_disk_only",
  };
  const deepRmStatus = readDeepProductEmbeddedRealisticMobileGate(
    readJsonSafe(path.join(SCRIPTS, DEEP_PRODUCT_UX_V2_REPORT)),
  );
  const rawStatus = scanRawRealisticMobileMentions(REALISTIC_MOBILE_RAW_SCAN_JSON);
  const summaryStatus = proofSummaryConsistentFromAuthoritative(authoritativeGateStatus);
  const reasonStatus =
    buildProofGateConsistencyReason(authForStatus, deepRmStatus, rawStatus.rawFail, rawStatus.rawPass) +
    " | context=--status_uses_on_disk_JSON_only_no_post_merge_step_exit_signal";

  writeRunReport(
    mergeReportingHygieneIntoPayload(
      {
        timestamp: nowIso(),
        command: argvCommand || "--status",
        status,
        branch,
        commit,
        git_status_clean: clean ? "YES" : "NO",
        changed_files: changed,
        pr_info: pr.summary,
        engine_changed: "NO",
        assets_app_changed: "NO",
        ui_changed: "NO",
        css_changed: "NO",
        backend_changed: "NO",
        safety_counters: safetyStr,
        calendar_write_20k: cal.calendar_write_20k,
        calendar_query_20k: cal.calendar_query_20k,
        gate_realistic_mobile: authoritativeGateStatus,
        raw_realistic_mobile_mentions_FAIL: rawStatus.rawFail,
        raw_realistic_mobile_mentions_PASS: rawStatus.rawPass,
        selected_authoritative_source: authForStatus.source,
        proof_gate_consistency_reason: reasonStatus,
        proof_summary_consistent: summaryStatus,
        post_merge_proof_exit_code: "",
        next_recommended_command: nextCmd,
        reason_for_stop: reason,
      },
      authoritativeGateStatus,
      deepRmStatus,
      rawStatus.rawFail,
      rawStatus.rawPass,
    ),
  );

  console.log("=== SILVER_AUTOPILOT_STATUS ===");
  console.log("timestamp=" + nowIso());
  console.log("command=" + (argvCommand || "--status"));
  console.log("branch=" + branch);
  console.log("commit=" + commit);
  console.log("git_status_clean=" + (clean ? "YES" : "NO"));
  console.log("changed_files=" + (changed || "(none)"));
  console.log("open_pr=" + pr.summary);
  console.log("last_report_snapshot=" + priorReportSnapshot);
  console.log("safety_counters=" + safetyStr);
  console.log("calendar_write_20k=" + cal.calendar_write_20k);
  console.log("calendar_query_20k=" + cal.calendar_query_20k);
  console.log("next_recommended_command=" + nextCmd);
  console.log("PASS_FAIL=" + status);
  const statusHygiene = classifyReportingHygiene(
    authoritativeGateStatus,
    deepRmStatus,
    rawStatus.rawFail,
    rawStatus.rawPass,
  );
  console.log("real_stale_meta_issue_seen=" + statusHygiene.real_stale_meta_issue_seen);
  console.log("stale_embedded_hint_seen=" + statusHygiene.stale_embedded_hint_seen);
  console.log("stale_embedded_hint_non_authoritative=" + statusHygiene.stale_embedded_hint_non_authoritative);
  console.log("authoritative_runtime_pass=" + statusHygiene.authoritative_runtime_pass);
  console.log(
    "reporting_embedded_fail_is_non_authoritative_hint=" +
      statusHygiene.reporting_embedded_fail_is_non_authoritative_hint,
  );
  const statusTimeoutPath = String(process.env.SILVER_TIMEOUT_ARCHIVE_PATH || "").trim();
  if (statusTimeoutPath) {
    console.log("timeout_archive_path=" + statusTimeoutPath);
    console.log(
      "timeout_artifacts_archived=" +
        (String(process.env.SILVER_TIMEOUT_ARTIFACTS_ARCHIVED || "").trim() || "YES"),
    );
  }
  printProofGateConsistencyResult({
    main_commit: commit,
    engine_changed: "NO",
    assets_app_changed: "NO",
    changed_files: changed,
    post_merge_proof_exit: "",
    authoritative_realistic_mobile: authoritativeGateStatus,
    deep_product_embedded_gate_raw: deepRmStatus,
    raw_realistic_mobile_fail_mentions: rawStatus.rawFail,
    raw_realistic_mobile_pass_mentions: rawStatus.rawPass,
    selected_authoritative_source: authForStatus.source,
    proof_summary_consistent: summaryStatus,
    gate_realistic_mobile: authoritativeGateStatus,
    reason: reasonStatus,
    dangerous_write_count: safety.dangerous_write_count,
    false_write_count: safety.false_write_count,
    query_created_write_count: safety.query_created_write_count,
    write_when_negated_count: safety.write_when_negated_count,
    calendar_write_20k: cal.calendar_write_20k,
    calendar_query_20k: cal.calendar_query_20k,
    git_status_clean: clean ? "YES" : "NO",
    recommended_next_task: nextCmd,
  });
  console.log("=== END_SILVER_AUTOPILOT_STATUS ===");
  return { status, branch, commit, clean };
}

function verifyPr(prNumber) {
  const n = String(prNumber || "").replace(/[^\d]/g, "");
  if (!n) {
    console.log("STOP: invalid PR number");
    return { verdict: "STOP", reason: "invalid_pr_number" };
  }
  if (!gitClean()) {
    console.log("STOP: dirty git");
    return { verdict: "STOP", reason: "dirty_git" };
  }

  let meta;
  try {
    meta = ghJson([
      "pr",
      "view",
      n,
      "--json",
      "number,url,state,mergeable,mergeStateStatus,statusCheckRollup,headRefName,baseRefName",
    ]);
  } catch (e) {
    console.log("STOP: gh pr view failed");
    return { verdict: "STOP", reason: "gh_pr_view_failed" };
  }

  if (String(meta.state || "").toUpperCase() !== "OPEN") {
    console.log("STOP: PR not OPEN state=" + String(meta.state || ""));
    return { verdict: "STOP", reason: "pr_not_open" };
  }

  const mergeable = String(meta.mergeable || "").toUpperCase();
  if (mergeable === "CONFLICTING") {
    console.log("STOP: mergeable=CONFLICTING");
    return { verdict: "STOP", reason: "mergeable_conflicting" };
  }

  const mss = String(meta.mergeStateStatus || "");
  if (mss === "DIRTY" || mss === "UNKNOWN") {
    console.log("STOP: mergeStateStatus=" + mss);
    return { verdict: "STOP", reason: "merge_state_" + mss };
  }
  if (mss === "BEHIND") {
    console.log("STOP: mergeStateStatus=BEHIND");
    return { verdict: "STOP", reason: "behind" };
  }
  if (mss !== "CLEAN") {
    console.log("STOP: mergeStateStatus=" + (mss || "EMPTY") + " (require CLEAN)");
    return { verdict: "STOP", reason: "merge_state_not_clean:" + mss };
  }

  const rollup = Array.isArray(meta.statusCheckRollup) ? meta.statusCheckRollup : [];
  let pending = false;
  let failed = false;
  for (const c of rollup) {
    const st = String((c && c.state) || "").toUpperCase();
    const con = String((c && c.conclusion) || "").toUpperCase();
    if (st === "PENDING" || st === "IN_PROGRESS" || st === "QUEUED") pending = true;
    if (st === "FAILURE" || st === "ERROR" || con === "FAILURE" || con === "TIMED_OUT" || con === "CANCELLED")
      failed = true;
  }
  if (pending) {
    console.log("STOP: checks PENDING");
    return { verdict: "STOP", reason: "checks_pending" };
  }
  if (failed) {
    console.log("STOP: checks FAILURE");
    return { verdict: "STOP", reason: "checks_failure" };
  }

  let files = [];
  try {
    files = ghLines(["pr", "diff", n, "--name-only"]);
  } catch {
    console.log("STOP: gh pr diff failed");
    return { verdict: "STOP", reason: "gh_pr_diff_failed" };
  }

  let engine = "NO";
  let assetsApp = "NO";
  let ui = "NO";
  let css = "NO";
  let backend = "NO";
  let unexpected = false;
  let stopReason = "";

  for (const rel of files) {
    if (!isAllowedVerifyPath(rel)) {
      unexpected = true;
      stopReason = "unexpected_path:" + rel;
      break;
    }
    const c = classifyDiffPath(rel);
    if (c.engine_touch) engine = "YES";
    if (c.assets_app) assetsApp = "YES";
    if (c.css) css = "YES";
    if (c.ui) ui = "YES";
    if (c.backend) backend = "YES";
    if (c.forbidden_zone) {
      unexpected = true;
      stopReason = "forbidden_zone:" + rel;
      break;
    }
  }

  const allowAssets = String(process.env.SILVER_AUTOPILOT_ALLOW_ASSETS_APP || "").toUpperCase() === "YES";
  const allowEngine = String(process.env.SILVER_AUTOPILOT_ALLOW_ENGINE || "").toUpperCase() === "YES";

  if (assetsApp === "YES" && !allowAssets) {
    console.log("STOP: assets/app.js in PR diff (set SILVER_AUTOPILOT_ALLOW_ASSETS_APP=YES to override)");
    return { verdict: "STOP", reason: "assets_app_js_blocked" };
  }
  if (engine === "YES" && !allowEngine) {
    console.log("STOP: engine-related path in diff (set SILVER_AUTOPILOT_ALLOW_ENGINE=YES to override)");
    return { verdict: "STOP", reason: "engine_path_blocked" };
  }
  if (ui === "YES" || css === "YES" || backend === "YES") {
    console.log("STOP: UI/CSS/backend path in diff");
    return { verdict: "STOP", reason: "ui_css_backend_blocked" };
  }
  if (unexpected) {
    console.log("STOP: " + stopReason);
    return { verdict: "STOP", reason: stopReason };
  }

  console.log("READY_TO_MERGE");
  console.log("pr=" + n + " url=" + String(meta.url || ""));
  console.log(
    "flags engine_changed=" + engine + " assets_app_changed=" + assetsApp + " ui_changed=" + ui + " css_changed=" + css + " backend_changed=" + backend
  );
  return {
    verdict: "READY_TO_MERGE",
    meta,
    flags: { engine, assetsApp, ui, css, backend },
  };
}

function cmdMergePr(prNumber) {
  const v = verifyPr(prNumber);
  if (v.verdict !== "READY_TO_MERGE") {
    console.log("STOP: merge blocked (verify-pr did not return READY_TO_MERGE)");
    writeRunReport({
      timestamp: nowIso(),
      command: "--merge-pr=" + prNumber,
      status: "STOP",
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: runGit(["rev-parse", "HEAD"]),
      git_status_clean: gitClean() ? "YES" : "NO",
      changed_files: gitChangedFilesList().join(";"),
      pr_info: "merge blocked",
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: "",
      calendar_write_20k: "",
      calendar_query_20k: "",
      next_recommended_command: "node scripts/silver-autopilot.cjs --verify-pr=" + prNumber,
      reason_for_stop: "merge_blocked",
    });
    return;
  }
  const n = String(prNumber || "").replace(/[^\d]/g, "");
  const r = spawnRepo("gh", ["pr", "merge", n, "--squash", "--delete-branch"], true);
  if (r.code !== 0) {
    console.log("STOP: gh pr merge failed");
    return;
  }
  try {
    runGit(["checkout", "main"]);
    runGit(["pull", "--ff-only"]);
  } catch {
    console.log("STOP: git checkout main / pull failed — resolve manually");
    return;
  }
  cmdStatus("--merge-pr=" + n + " (post-merge)");
  console.log("PASS: merge flow completed on updated main");
}

function cmdPostMergeProof() {
  const forceFailRequested = String(process.env.IU_SILVER_AUTOPILOT_FORCE_PROOF_FAIL || "").trim() === "1";
  const prOpen = openPrForCurrentBranch();
  let trackedReportRestoreBeforeRealisticMobile = "NO";

  function emitStrictResult(p) {
    const safety = p.safety != null ? p.safety : aggregateSafetyFromReports();
    const cal = p.cal != null ? p.cal : aggregateCalendar20kFromReports();
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = runGit(["rev-parse", "HEAD"]);
    const clean = gitClean();
    const changed = gitChangedFilesList().join(";");
    const logical = String(p.logicalStatus || "");
    const procEx = p.processExit != null ? p.processExit : 1;
    const prReady =
      clean &&
      logical === "PASS" &&
      safety.dangerous_write_count === 0 &&
      safety.false_write_count === 0 &&
      safety.query_created_write_count === 0 &&
      safety.write_when_negated_count === 0
        ? "YES"
        : "NO";
    let forcedExit = "";
    let forcedPass = "N/A";
    if (forceFailRequested) {
      if (p.syntheticForce) {
        forcedExit = 1;
        forcedPass = "YES";
      } else {
        forcedExit = "";
        forcedPass = "NO";
      }
    }
    printPostMergeProofStrictFailResult({
      main_commit: commit,
      branch,
      pr_url: String(prOpen.url || ""),
      engine_changed: "NO",
      assets_app_changed: "NO",
      changed_files: changed,
      status_exit: "",
      post_merge_proof_exit: procEx,
      post_merge_proof_logical_status: logical,
      tracked_report_restore_before_realistic_mobile: String(p.trackedRestore || "NO"),
      failed_step: String(p.failedStep || ""),
      failed_reason: String(p.failedReason || ""),
      forced_fail_test_exit: forcedExit,
      forced_fail_test_pass: forcedPass,
      dangerous_write_count: safety.dangerous_write_count,
      false_write_count: safety.false_write_count,
      query_created_write_count: safety.query_created_write_count,
      write_when_negated_count: safety.write_when_negated_count,
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      git_status_clean: clean ? "YES" : "NO",
      pr_ready: prReady,
      recommended_next_task: String(p.recommended_next_task || ""),
    });
  }

  if (!gitClean()) {
    console.log("STOP: dirty git before post-merge-proof");
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = runGit(["rev-parse", "HEAD"]);
    const safety = aggregateSafetyFromReports();
    const cal = aggregateCalendar20kFromReports();
    writeRunReport({
      timestamp: nowIso(),
      command: "--post-merge-proof",
      status: "STOP",
      branch,
      commit,
      git_status_clean: "NO",
      changed_files: gitChangedFilesList().join(";"),
      pr_info: prOpen.summary,
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: JSON.stringify(safety),
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      post_merge_proof_exit_code: 1,
      post_merge_proof_logical_status: "FAIL",
      post_merge_proof_process_exit: 1,
      tracked_report_restore_before_realistic_mobile: "NO",
      failed_step: "preflight.git_clean",
      failed_reason: "dirty_git_before_post_merge_proof",
      next_recommended_command: "git status; resolve dirty tree before post-merge-proof",
      reason_for_stop: "dirty_git_before_post_merge_proof",
    });
    emitStrictResult({
      logicalStatus: "FAIL",
      processExit: 1,
      trackedRestore: "NO",
      failedStep: "preflight.git_clean",
      failedReason: "dirty_git_before_post_merge_proof",
      safety,
      cal,
      syntheticForce: false,
      recommended_next_task: "git status; resolve dirty tree before post-merge-proof",
    });
    return 1;
  }

  if (forceFailRequested) {
    const safety = aggregateSafetyFromReports();
    const cal = aggregateCalendar20kFromReports();
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = runGit(["rev-parse", "HEAD"]);
    console.log(
      "STOP: step failed " + JSON.stringify({ kind: "synthetic", reason: "IU_SILVER_AUTOPILOT_FORCE_PROOF_FAIL" }),
    );
    writeRunReport({
      timestamp: nowIso(),
      command: "--post-merge-proof",
      status: "STOP",
      branch,
      commit,
      git_status_clean: "YES",
      changed_files: "",
      pr_info: prOpen.summary,
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: JSON.stringify(safety),
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      post_merge_proof_exit_code: 1,
      post_merge_proof_logical_status: "FAIL",
      post_merge_proof_process_exit: 1,
      tracked_report_restore_before_realistic_mobile: "NO",
      failed_step: "env:IU_SILVER_AUTOPILOT_FORCE_PROOF_FAIL",
      failed_reason: "forced_proof_fail_self_test",
      next_recommended_command: "Remove-Item Env:\\IU_SILVER_AUTOPILOT_FORCE_PROOF_FAIL; re-run --post-merge-proof",
      reason_for_stop: "forced_proof_fail_self_test",
    });
    emitStrictResult({
      logicalStatus: "FAIL",
      processExit: 1,
      trackedRestore: "NO",
      failedStep: "env:IU_SILVER_AUTOPILOT_FORCE_PROOF_FAIL",
      failedReason: "forced_proof_fail_self_test",
      safety,
      cal,
      syntheticForce: true,
      recommended_next_task: "Unset IU_SILVER_AUTOPILOT_FORCE_PROOF_FAIL and re-run proof",
    });
    return 1;
  }

  let realisticMobileStandaloneStepPass = false;
  for (const step of POST_MERGE_STEPS) {
    if (step.kind === "node" && step.file === "audit_silver_realistic_mobile_corpus.cjs") {
      restoreTrackedReportJsons();
      trackedReportRestoreBeforeRealisticMobile = "YES";
    }
    let code = 1;
    if (step.kind === "npm") {
      let r;
      if (process.platform === "win32") {
        const joined = ["npm", ...step.args].map((a) => String(a)).join(" ");
        r = spawnRepo("cmd.exe", ["/d", "/s", "/c", joined], true);
      } else {
        r = spawnRepo("npm", step.args, true);
      }
      code = r.code;
    } else {
      const scriptPath = path.join(SCRIPTS, step.file);
      const r = spawnRepo(process.execPath, [scriptPath], true);
      code = r.code;
    }
    if (code !== 0) {
      console.log("STOP: step failed " + JSON.stringify(step));
      const safety = aggregateSafetyFromReports();
      const cal = aggregateCalendar20kFromReports();
      const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
      const commit = runGit(["rev-parse", "HEAD"]);
      writeRunReport({
        timestamp: nowIso(),
        command: "--post-merge-proof",
        status: "STOP",
        branch,
        commit,
        git_status_clean: gitClean() ? "YES" : "NO",
        changed_files: gitChangedFilesList().join(";"),
        pr_info: prOpen.summary,
        engine_changed: "NO",
        assets_app_changed: "NO",
        ui_changed: "NO",
        css_changed: "NO",
        backend_changed: "NO",
        safety_counters: JSON.stringify(safety),
        calendar_write_20k: cal.calendar_write_20k,
        calendar_query_20k: cal.calendar_query_20k,
        post_merge_proof_exit_code: 1,
        post_merge_proof_logical_status: "FAIL",
        post_merge_proof_process_exit: 1,
        tracked_report_restore_before_realistic_mobile: trackedReportRestoreBeforeRealisticMobile,
        failed_step: postMergeStepLabel(step),
        failed_reason: "audit_step_nonzero_exit",
        next_recommended_command: "fix failing audit then re-run",
        reason_for_stop: "audit_step_failed:" + JSON.stringify(step),
      });
      emitStrictResult({
        logicalStatus: "FAIL",
        processExit: 1,
        trackedRestore: trackedReportRestoreBeforeRealisticMobile,
        failedStep: postMergeStepLabel(step),
        failedReason: "audit_step_nonzero_exit",
        safety,
        cal,
        syntheticForce: false,
        recommended_next_task: "fix failing audit then re-run --post-merge-proof",
      });
      return 1;
    }
    if (code === 0 && step.kind === "node" && step.file === "audit_silver_realistic_mobile_corpus.cjs") {
      realisticMobileStandaloneStepPass = true;
    }
  }

  const safety = aggregateSafetyFromReports();
  const cal = aggregateCalendar20kFromReports();
  if (
    safety.dangerous_write_count > 0 ||
    safety.false_write_count > 0 ||
    safety.query_created_write_count > 0 ||
    safety.write_when_negated_count > 0
  ) {
    console.log("STOP: safety counters nonzero");
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = runGit(["rev-parse", "HEAD"]);
    writeRunReport({
      timestamp: nowIso(),
      command: "--post-merge-proof",
      status: "STOP",
      branch,
      commit,
      git_status_clean: gitClean() ? "YES" : "NO",
      changed_files: gitChangedFilesList().join(";"),
      pr_info: prOpen.summary,
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: JSON.stringify(safety),
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      post_merge_proof_exit_code: 1,
      post_merge_proof_logical_status: "FAIL",
      post_merge_proof_process_exit: 1,
      tracked_report_restore_before_realistic_mobile: trackedReportRestoreBeforeRealisticMobile,
      failed_step: "post_chain.safety_counters",
      failed_reason: "safety_counters_nonzero",
      next_recommended_command: "triage safety harness",
      reason_for_stop: "safety_counters_nonzero",
    });
    emitStrictResult({
      logicalStatus: "FAIL",
      processExit: 1,
      trackedRestore: trackedReportRestoreBeforeRealisticMobile,
      failedStep: "post_chain.safety_counters",
      failedReason: "safety_counters_nonzero",
      safety,
      cal,
      syntheticForce: false,
      recommended_next_task: "triage safety harness",
    });
    return 1;
  }
  if (!cal.calendar_write_ok || !cal.calendar_query_ok) {
    console.log("STOP: calendar 20k metrics not 3000/3000 when strict");
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = runGit(["rev-parse", "HEAD"]);
    writeRunReport({
      timestamp: nowIso(),
      command: "--post-merge-proof",
      status: "STOP",
      branch,
      commit,
      git_status_clean: gitClean() ? "YES" : "NO",
      changed_files: gitChangedFilesList().join(";"),
      pr_info: prOpen.summary,
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: JSON.stringify(safety),
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      post_merge_proof_exit_code: 1,
      post_merge_proof_logical_status: "FAIL",
      post_merge_proof_process_exit: 1,
      tracked_report_restore_before_realistic_mobile: trackedReportRestoreBeforeRealisticMobile,
      failed_step: "post_chain.calendar_20k",
      failed_reason: "calendar_20k_not_3000",
      next_recommended_command: "inspect calendar harness reports",
      reason_for_stop: "calendar_20k_not_3000",
    });
    emitStrictResult({
      logicalStatus: "FAIL",
      processExit: 1,
      trackedRestore: trackedReportRestoreBeforeRealisticMobile,
      failedStep: "post_chain.calendar_20k",
      failedReason: "calendar_20k_not_3000",
      safety,
      cal,
      syntheticForce: false,
      recommended_next_task: "inspect calendar harness reports",
    });
    return 1;
  }

  const corpusPath = path.join(SCRIPTS, REALISTIC_MOBILE_CORPUS_REPORT);
  const corpusDataPre = readJsonSafe(corpusPath);
  const authJson = parseAuthoritativeRealisticMobileFromCorpusReport(corpusDataPre);
  const deepDataPre = readJsonSafe(path.join(SCRIPTS, DEEP_PRODUCT_UX_V2_REPORT));
  const deepRm = readDeepProductEmbeddedRealisticMobileGate(deepDataPre);
  const rawPre = scanRawRealisticMobileMentions(REALISTIC_MOBILE_RAW_SCAN_JSON);

  if (!realisticMobileStandaloneStepPass) {
    console.log("STOP: proof gate: POST_MERGE_STEPS did not record standalone realistic mobile audit success");
    const commitEarly = runGit(["rev-parse", "HEAD"]);
    const branchEarly = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const authFail = { gate: "FAIL", source: "(missing_post_merge_step:audit_silver_realistic_mobile_corpus.cjs)" };
    const summaryEarly = proofSummaryConsistentFromAuthoritative(authFail.gate);
    const reasonEarly = buildProofGateConsistencyReason(authFail, deepRm, rawPre.rawFail, rawPre.rawPass);
    printProofGateConsistencyResult({
      main_commit: commitEarly,
      engine_changed: "NO",
      assets_app_changed: "NO",
      changed_files: gitChangedFilesList().join(";"),
      post_merge_proof_exit: 1,
      authoritative_realistic_mobile: authFail.gate,
      deep_product_embedded_gate_raw: deepRm,
      raw_realistic_mobile_fail_mentions: rawPre.rawFail,
      raw_realistic_mobile_pass_mentions: rawPre.rawPass,
      selected_authoritative_source: authFail.source,
      proof_summary_consistent: summaryEarly,
      gate_realistic_mobile: authFail.gate,
      reason: reasonEarly,
      dangerous_write_count: safety.dangerous_write_count,
      false_write_count: safety.false_write_count,
      query_created_write_count: safety.query_created_write_count,
      write_when_negated_count: safety.write_when_negated_count,
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      git_status_clean: "YES",
      recommended_next_task: "proof_gate_missing_standalone_realistic_mobile_step",
    });
    writeRunReport({
      timestamp: nowIso(),
      command: "--post-merge-proof",
      status: "STOP",
      branch: branchEarly,
      commit: commitEarly,
      git_status_clean: "YES",
      changed_files: "",
      pr_info: prOpen.summary,
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: JSON.stringify(safety),
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      gate_realistic_mobile: authFail.gate,
      raw_realistic_mobile_mentions_FAIL: rawPre.rawFail,
      raw_realistic_mobile_mentions_PASS: rawPre.rawPass,
      selected_authoritative_source: authFail.source,
      proof_gate_consistency_reason: reasonEarly,
      proof_summary_consistent: summaryEarly,
      post_merge_proof_exit_code: 1,
      post_merge_proof_logical_status: "FAIL",
      post_merge_proof_process_exit: 1,
      tracked_report_restore_before_realistic_mobile: trackedReportRestoreBeforeRealisticMobile,
      failed_step: "proof_gate.standalone_realistic_mobile",
      failed_reason: "proof_gate_missing_standalone_realistic_mobile_step",
      next_recommended_command: "node scripts/silver-autopilot.cjs --post-merge-proof",
      reason_for_stop: "proof_gate_missing_standalone_realistic_mobile_step",
    });
    restoreTrackedReportJsons();
    emitStrictResult({
      logicalStatus: "FAIL",
      processExit: 1,
      trackedRestore: trackedReportRestoreBeforeRealisticMobile,
      failedStep: "proof_gate.standalone_realistic_mobile",
      failedReason: "proof_gate_missing_standalone_realistic_mobile_step",
      safety,
      cal,
      syntheticForce: false,
      recommended_next_task: "proof_gate_missing_standalone_realistic_mobile_step",
    });
    return 1;
  }

  const authoritativeGate = authJson.gate === "FAIL" ? "FAIL" : "PASS";
  const selectedAuthoritativeSource =
    "post_merge_step:audit_silver_realistic_mobile_corpus.cjs:exit0+" + authJson.source;
  const auth = { gate: authoritativeGate, source: selectedAuthoritativeSource };
  const summaryOk = proofSummaryConsistentFromAuthoritative(auth.gate);
  const reasonStr = buildProofGateConsistencyReason(auth, deepRm, rawPre.rawFail, rawPre.rawPass);
  const commit = runGit(["rev-parse", "HEAD"]);
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);

  function gateConsistencyStop(consoleMsg, stopKey) {
    console.log("STOP: " + consoleMsg);
    printProofGateConsistencyResult({
      main_commit: commit,
      engine_changed: "NO",
      assets_app_changed: "NO",
      changed_files: gitChangedFilesList().join(";"),
      post_merge_proof_exit: 1,
      authoritative_realistic_mobile: auth.gate,
      deep_product_embedded_gate_raw: deepRm,
      raw_realistic_mobile_fail_mentions: rawPre.rawFail,
      raw_realistic_mobile_pass_mentions: rawPre.rawPass,
      selected_authoritative_source: auth.source,
      proof_summary_consistent: summaryOk,
      gate_realistic_mobile: auth.gate,
      reason: reasonStr,
      dangerous_write_count: safety.dangerous_write_count,
      false_write_count: safety.false_write_count,
      query_created_write_count: safety.query_created_write_count,
      write_when_negated_count: safety.write_when_negated_count,
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      git_status_clean: "YES",
      recommended_next_task: stopKey,
    });
    writeRunReport({
      timestamp: nowIso(),
      command: "--post-merge-proof",
      status: "STOP",
      branch,
      commit,
      git_status_clean: "YES",
      changed_files: "",
      pr_info: prOpen.summary,
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: JSON.stringify(safety),
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      gate_realistic_mobile: auth.gate,
      raw_realistic_mobile_mentions_FAIL: rawPre.rawFail,
      raw_realistic_mobile_mentions_PASS: rawPre.rawPass,
      selected_authoritative_source: auth.source,
      proof_gate_consistency_reason: reasonStr,
      proof_summary_consistent: summaryOk,
      post_merge_proof_exit_code: 1,
      post_merge_proof_logical_status: "FAIL",
      post_merge_proof_process_exit: 1,
      tracked_report_restore_before_realistic_mobile: trackedReportRestoreBeforeRealisticMobile,
      failed_step: "proof_gate.authoritative_realistic_mobile",
      failed_reason: stopKey,
      next_recommended_command: "node scripts/silver-autopilot.cjs --post-merge-proof",
      reason_for_stop: stopKey,
    });
    restoreTrackedReportJsons();
    emitStrictResult({
      logicalStatus: "FAIL",
      processExit: 1,
      trackedRestore: trackedReportRestoreBeforeRealisticMobile,
      failedStep: "proof_gate.authoritative_realistic_mobile",
      failedReason: stopKey,
      safety,
      cal,
      syntheticForce: false,
      recommended_next_task: stopKey,
    });
  }

  if (authoritativeGate === "FAIL") {
    gateConsistencyStop(
      "proof gate: authoritative realistic_mobile not PASS (corpus JSON real_mobile_cases or derived fails after standalone audit exit 0)",
      "proof_gate_authoritative_realistic_mobile_not_PASS",
    );
    return 1;
  }

  restoreTrackedReportJsons();
  const rawPost = scanRawRealisticMobileMentions(REALISTIC_MOBILE_RAW_SCAN_JSON);
  const deepPost = readDeepProductEmbeddedRealisticMobileGate(readJsonSafe(path.join(SCRIPTS, DEEP_PRODUCT_UX_V2_REPORT)));
  const summaryFinal = proofSummaryConsistentFromAuthoritative(auth.gate);
  const reasonFinal =
    buildProofGateConsistencyReason(auth, deepRm, rawPost.rawFail, rawPost.rawPass) +
    " | post_restore_deep_embedded=" +
    (deepPost || "(absent)") +
    "_note=post_restore_JSON_may_revert_to_stale_tracked_snapshot_use_authoritative_fields";
  let gs = "";
  try {
    gs = runGit(["-c", "core.quotePath=false", "status", "--short"]);
  } catch {
    gs = "UNKNOWN";
  }
  console.log("=== GIT_STATUS_AFTER_RESTORE ===");
  console.log(gs || "(clean)");
  console.log("=== END_GIT_STATUS ===");
  console.log("PASS: post-merge-proof complete");
  printProofGateConsistencyResult({
    main_commit: commit,
    engine_changed: "NO",
    assets_app_changed: "NO",
    changed_files: gitChangedFilesList().join(";"),
    post_merge_proof_exit: 0,
    authoritative_realistic_mobile: auth.gate,
    deep_product_embedded_gate_raw: deepRm,
    raw_realistic_mobile_fail_mentions: rawPost.rawFail,
    raw_realistic_mobile_pass_mentions: rawPost.rawPass,
    selected_authoritative_source: auth.source,
    proof_summary_consistent: summaryFinal,
    gate_realistic_mobile: auth.gate,
    reason: reasonFinal,
    dangerous_write_count: safety.dangerous_write_count,
    false_write_count: safety.false_write_count,
    query_created_write_count: safety.query_created_write_count,
    write_when_negated_count: safety.write_when_negated_count,
    calendar_write_20k: cal.calendar_write_20k,
    calendar_query_20k: cal.calendar_query_20k,
    git_status_clean: gitClean() ? "YES" : "NO",
    recommended_next_task: summaryFinal === "NO" ? "investigate_proof_gate_consistency" : "node scripts/silver-autopilot.cjs --status",
  });
  writeRunReport(
    mergeReportingHygieneIntoPayload(
      {
        timestamp: nowIso(),
        command: "--post-merge-proof",
        status: "PASS",
        branch,
        commit,
        git_status_clean: gitClean() ? "YES" : "NO",
        changed_files: gitChangedFilesList().join(";"),
        pr_info: prOpen.summary,
        engine_changed: "NO",
        assets_app_changed: "NO",
        ui_changed: "NO",
        css_changed: "NO",
        backend_changed: "NO",
        safety_counters: JSON.stringify(safety),
        calendar_write_20k: cal.calendar_write_20k,
        calendar_query_20k: cal.calendar_query_20k,
        gate_realistic_mobile: auth.gate,
        raw_realistic_mobile_mentions_FAIL: rawPost.rawFail,
        raw_realistic_mobile_mentions_PASS: rawPost.rawPass,
        selected_authoritative_source: auth.source,
        proof_gate_consistency_reason: reasonFinal,
        proof_summary_consistent: summaryFinal,
        post_merge_proof_exit_code: 0,
        post_merge_proof_logical_status: "PASS",
        post_merge_proof_process_exit: 0,
        tracked_report_restore_before_realistic_mobile: trackedReportRestoreBeforeRealisticMobile,
        failed_step: "",
        failed_reason: "",
        next_recommended_command: "node scripts/silver-autopilot.cjs --status",
        reason_for_stop: "",
      },
      auth.gate,
      deepRm,
      rawPost.rawFail,
      rawPost.rawPass,
    ),
  );
  emitStrictResult({
    logicalStatus: "PASS",
    processExit: 0,
    trackedRestore: trackedReportRestoreBeforeRealisticMobile,
    failedStep: "",
    failedReason: "",
    safety,
    cal,
    syntheticForce: false,
    recommended_next_task: summaryFinal === "NO" ? "investigate_proof_gate_consistency" : "node scripts/silver-autopilot.cjs --status",
  });
  return 0;
}

function harnessSafeExclude(clusterName) {
  const fname = HARNESS_SAFE_EXCLUDE[clusterName];
  if (!fname) return false;
  const data = readJsonSafe(path.join(SCRIPTS, fname));
  if (!data) return false;
  const te = Number(data.true_engine_fail_count);
  const mf = Number(data.must_fix_engine_count);
  const sh = Number(data.should_fix_harness_count);
  if (!Number.isFinite(te) || !Number.isFinite(mf) || !Number.isFinite(sh)) return false;
  return te === 0 && mf === 0 && sh > 0;
}

function parseTopFailFromReport(data) {
  if (!data) return [];
  const arr = data.top_fail_clusters;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const s = String(row);
    const idx = s.lastIndexOf(":");
    if (idx <= 0) continue;
    const name = s.slice(0, idx).trim();
    const count = parseInt(s.slice(idx + 1), 10);
    if (!name || !Number.isFinite(count)) continue;
    if (count <= 0) continue;
    out.push({ name, count });
  }
  return out;
}

function cmdRefreshRhc3() {
  console.log("=== SILVER_AUTOPILOT_REFRESH_RHC3 ===");
  console.log("Running: node scripts/silver-real-human-chaos-v3.cjs (long-running)");
  const r = spawnRepo(process.execPath, [RHC3_MAIN], true);
  if (r.code !== 0) {
    console.log("STOP: RHC3 refresh script failed");
    return;
  }
  const rep = readJsonSafe(RHC3_REPORT_JSON);
  const tops = parseTopFailFromReport(rep);
  console.log("--- top_fail_clusters (nonzero) ---");
  for (const row of tops.slice(0, 15)) {
    console.log(row.name + ":" + row.count);
  }
  const filtered = tops.filter((t) => {
    if (!HARNESS_SAFE_EXCLUDE[t.name]) return true;
    return !harnessSafeExclude(t.name);
  });
  let candidate = filtered[0] && filtered[0].name;
  if (!candidate) {
    candidate = PREFERRED_NEXT.find((n) => tops.some((t) => t.name === n)) || "(none)";
  } else if (PREFERRED_NEXT.includes(candidate)) {
    /* ok */
  } else {
    /* Prefer explicit next diagnostics when present in top list */
    const pref = PREFERRED_NEXT.find((n) => tops.some((t) => t.name === n && t.count > 0));
    if (pref && tops[0] && tops[0].count > 0 && pref !== candidate) {
      /* keep first non-excluded unless user-expected cluster ranks high */
      const prefRank = tops.findIndex((t) => t.name === pref);
      if (prefRank >= 0 && prefRank <= 6) candidate = pref;
    }
  }
  console.log("--- candidate_next_cluster ---");
  console.log(String(candidate));
  console.log("=== END_SILVER_AUTOPILOT_REFRESH_RHC3 ===");
  writeRunReport({
    timestamp: nowIso(),
    command: "--refresh-rhc3",
    status: "PASS",
    branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: runGit(["rev-parse", "HEAD"]),
    git_status_clean: gitClean() ? "YES" : "NO",
    changed_files: gitChangedFilesList().join(";"),
    pr_info: "",
    engine_changed: "NO",
    assets_app_changed: "NO",
    ui_changed: "NO",
    css_changed: "NO",
    backend_changed: "NO",
    safety_counters: JSON.stringify(extractSafetyFromJson(rep)),
    calendar_write_20k: String((rep && rep.baseline_metrics && rep.baseline_metrics.calendar_write_20k) || ""),
    calendar_query_20k: String((rep && rep.baseline_metrics && rep.baseline_metrics.calendar_query_20k) || ""),
    next_recommended_command: "node scripts/silver-autopilot.cjs --status",
    reason_for_stop: "",
  });
}

async function cmdAskModel() {
  const strat = readTextSafe(STRATEGY).slice(0, 12000);
  const report = readTextSafe(RUN_REPORT).slice(0, 12000);
  let gs = "";
  try {
    gs = runGit(["-c", "core.quotePath=false", "status", "--short"]);
  } catch {
    gs = "git_status_unavailable";
  }
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    console.log("OPENAI_API_KEY_MISSING");
    writeRunReport({
      timestamp: nowIso(),
      command: "--ask-model",
      status: "PASS",
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: runGit(["rev-parse", "HEAD"]),
      git_status_clean: gitClean() ? "YES" : "NO",
      changed_files: gitChangedFilesList().join(";"),
      pr_info: "",
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: "",
      calendar_write_20k: "",
      calendar_query_20k: "",
      next_recommended_command: "set OPENAI_API_KEY in environment (never commit) then re-run --ask-model",
      reason_for_stop: "",
    });
    return;
  }

  const model = String(process.env.SILVER_AUTOPILOT_OPENAI_MODEL || "gpt-4o-mini").trim();
  const manifestAsk = buildRepoScriptsManifestForPrompt();
  const body = {
    model,
    temperature: 0.2,
    max_tokens: 1800,
    messages: [
      {
        role: "system",
        content:
          "You are a Silver (infoUzel.cz) development copilot. Output ONLY copy-paste instructions for a human or Cursor. " +
          "Write in Czech (cs) with correct diacritics and real Unicode (Ú, ř, š, em dash —). Never emit UTF-8 mis-decoded mojibake (e.g. Ă or â€). " +
          "Windows PowerShell first: use Get-Content, Set-Location, Join-Path; never suggest `cat C:\\...` or POSIX cat with Windows drive letters. " +
          "Never invent script paths: only node scripts/<file> that appear in the USER manifest list; if unsure use only `node scripts/silver-autopilot.cjs --status`. " +
          "Never request engine edits, assets/app.js edits, routing/normalizer refactors, merges, or secret pastes. " +
          "Prefer scripts-only diagnostics. Do not instruct raw PowerShell `-MaxCycles 0` without `-AllowInfinite`/`-AutonomousMode`; controlled autonomous mode still has hard caps and `SILVER_STOP_AUTOPILOT` per SILVER_AUTOPILOT_README.md — never advise bypassing those gates. " +
          "Use concise markdown with one primary NEXT block.",
      },
      {
        role: "user",
        content:
          "SILVER_STRATEGY.md (excerpt):\n" +
          strat +
          "\n\nSILVER_RUN_REPORT.md (excerpt):\n" +
          report +
          "\n\ngit status --short:\n" +
          gs +
          "\n\n### Existující skripty v repu (manifest — používej jen tyto nebo podmnožinu)\n" +
          manifestAsk +
          "\n\nWrite SILVER_NEXT_ACTION.md content: short title in Czech, bullets, exact commands from manifest or `node scripts/silver-autopilot.cjs --status`; include ### Scope guard, ### STOP podmínky, and a ### Povinný výsledek block with === lines.",
      },
    ],
  };

  let text = "";
  let resolvedAsk = null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await decodeFetchBodyUtf8(res);
    if (!res.ok) {
      console.log("STOP: OpenAI HTTP " + res.status);
      console.log(raw.slice(0, 500));
      return;
    }
    const coercedAsk = coerceOpenAiChatCompletionText(raw);
    if (coercedAsk.repaired === "YES") {
      console.log("SILVER_OPENAI_UTF8_REPAIR=YES path=ask-model");
    }
    const rawAsk = coercedAsk.content;
    const commitAsk = runGit(["rev-parse", "HEAD"]);
    resolvedAsk = resolveNextActionModelBody(rawAsk, {
      inputSource: "SILVER_STRATEGY+RUN_REPORT+git",
      changedFilesJoined: gs,
      mainCommit: commitAsk,
      guardBlocked: false,
      safetyBlocked: false,
      dirtyBlocked: false,
    });
    if (!resolvedAsk.ok) {
      console.log("SILVER_NEXT_ACTION_QUALITY_GATE=REJECT ask-model " + resolvedAsk.violations.join("; "));
    }
    text = resolvedAsk.body;
  } catch (e) {
    console.log("STOP: OpenAI request error");
    return;
  }

  if (resolvedAsk && resolvedAsk.clusterHandoff && silverNextActionHasClusterWorkflow(text)) {
    writeUtf8FileNoBom(NEXT_ACTION, text);
  } else {
    const out =
      "<!-- SILVER_NEXT_ACTION: generated by silver-autopilot --ask-model; not auto-applied -->\n\n" +
      String(text || "").trim() +
      "\n";
    writeUtf8FileNoBom(NEXT_ACTION, out);
  }
  console.log("PASS: wrote SILVER_NEXT_ACTION.md");
}

function cmdAuto(maxSteps) {
  const ms = Math.min(parseInt(String(maxSteps || "1"), 10) || 1, 1);
  if (ms !== 1) {
    console.log("STOP: V1 supports only --max-steps=1");
    return;
  }
  if (!gitClean()) {
    console.log("STOP: dirty git (auto will not run)");
    writeRunReport({
      timestamp: nowIso(),
      command: "--auto --max-steps=1",
      status: "STOP",
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: runGit(["rev-parse", "HEAD"]),
      git_status_clean: "NO",
      changed_files: gitChangedFilesList().join(";"),
      pr_info: "",
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: "",
      calendar_write_20k: "",
      calendar_query_20k: "",
      next_recommended_command: "git stash or commit; clean tree before autopilot",
      reason_for_stop: "dirty_git",
    });
    return;
  }
  /* Single safe step: refresh status report only */
  cmdStatus("--auto --max-steps=1");
  console.log("PASS: auto executed one safe step (status refresh)");
}

async function cmdOpenAiRealNextActionUtf8Diagnostic() {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    console.log("OPENAI_API_KEY_MISSING");
    process.exit(1);
    return;
  }
  const inputPick = pickFullAutoLoopInput();
  if (!inputPick.body || inputPick.source === "(none)") {
    console.log("STOP: no usable SILVER_CURSOR_OUTPUT.md / SILVER_RUN_REPORT.md input");
    process.exit(1);
    return;
  }
  const strat = readTextSafe(STRATEGY).slice(0, 12000);
  const commit = runGit(["rev-parse", "HEAD"]);
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const changedJoined = gitChangedFilesList().map(normalizeRepoRel).filter(Boolean).join(";");
  const autoStatus = [
    "branch=" + branch,
    "commit=" + commit,
    "changed_files=" + changedJoined,
    "input_source=" + inputPick.source,
  ].join("\n");
  const manifestLoop = buildRepoScriptsManifestForPrompt();
  const model = String(process.env.SILVER_AUTOPILOT_OPENAI_MODEL || "gpt-4o-mini").trim();
  const systemContent =
    "You are a Silver (infoUzel.cz) development copilot. Output a single copy-paste task for Cursor. " +
    "Language: Czech (cs) with correct diacritics and real Unicode (Ú, ř, š, em dash —). Never emit UTF-8 mis-decoded mojibake (e.g. Ă or â€). " +
    "Do not repeat the line starting with ÚKOL PRO CURSOR (the file template adds it). Start with numbered steps or ### headings. " +
    "Windows PowerShell first: use Get-Content -LiteralPath, Set-Location, Join-Path; never suggest `cat C:\\...` or POSIX cat with Windows drive letters. " +
    "NEVER invent script paths. Only reference files under scripts/ that appear in the USER manifest list; if unsure use only `node scripts/silver-autopilot.cjs --status`. " +
    "Hard rules: diagnostic-first; cluster-driven; scripts-only dominance; safety-first; zero-regression; " +
    "no broad refactor; engine only after proven TRUE_ENGINE_FAIL and surgically; assets/app.js only after explicit human permission.";
  const userContent =
    "### SILVER_STRATEGY.md (excerpt)\n" +
    strat +
    "\n\n### Autopilot status snapshot\n" +
    autoStatus +
    "\n\n### Last Cursor output / report (from " +
    inputPick.source +
    ")\n" +
    inputPick.body +
    "\n\n### Existující skripty v repu (manifest — používej POUZE tyto nebo podmnožinu)\n" +
    manifestLoop +
    "\n\n### Deliverable\n" +
    "Produce ONE next task in Czech: concise numbered steps; exact commands only from manifest above or `node scripts/silver-autopilot.cjs --status`; scripts-only unless engine failure is proven; never hallucinate scripts/*.js paths.";

  let rawUtf8 = "";
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2200,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userContent },
        ],
      }),
    });
    rawUtf8 = await decodeFetchBodyUtf8(res);
    if (!res.ok) {
      console.log("STOP: OpenAI HTTP " + res.status);
      console.log(rawUtf8.slice(0, 800));
      process.exit(1);
      return;
    }
  } catch {
    console.log("STOP: OpenAI request error");
    process.exit(1);
    return;
  }

  const json = parseOpenAiChatCompletionRaw(rawUtf8);
  const extractedContent = extractOpenAiChatMessageContent(json).trim();
  const coerced = coerceOpenAiChatCompletionText(rawUtf8);
  const resolved = resolveNextActionModelBody(coerced.content, {
    inputSource: inputPick.source,
    changedFilesJoined: changedJoined,
    mainCommit: commit,
    guardBlocked: false,
    safetyBlocked: false,
    dirtyBlocked: false,
  });
  const finalInner = resolved.ok ? resolved.body : coerced.content;
  const finalDoc = wrapNextActionDoc(finalInner, "real-api-utf8-diagnostic");
  writeNextActionUtf8Safe(NEXT_ACTION, finalDoc);
  const finalFileText = fs.readFileSync(NEXT_ACTION, "utf8");

  const pass = printOpenAiRealNextActionUtf8Diagnostic({
    rawUtf8,
    extractedContent,
    repairedContent: coerced.content,
    finalFileText,
  });
  process.exit(pass ? 0 : 1);
}

function runAutonomousAdapterDiagnosticSelftest() {
  const stub =
    "# silver-cursor-agent-adapter\nadapter_output_state=INVALIDATED_AWAITING_CYCLE\nprocess_start_utc=\ntask_digest=\nexit_code=\n# stdout\n\n# stderr\n\n";
  const ev = evaluateAutonomousAdapterOutput(stub);
  if (ev.adapter_output_valid !== "NO" || ev.stale_detected !== "YES") {
    console.log("AUTONOMOUS_ADAPTER_DIAGNOSTIC_SELFTEST=FAIL invalidated_stub");
    return false;
  }
  const good =
    "# silver-cursor-agent-adapter\nadapter_output_state=COMPLETED\nprocess_start_utc=2026-01-01T00:00:00.000Z\nexit_code=0\ntask_digest=abc123\nstdout_nonempty=YES\n# stdout\n" +
    "x".repeat(25) +
    "\n# stderr\n\n";
  const evOk = evaluateAutonomousAdapterOutput(good);
  if (evOk.adapter_output_valid !== "YES" || evOk.next_action_generation_allowed !== "YES") {
    console.log("AUTONOMOUS_ADAPTER_DIAGNOSTIC_SELFTEST=FAIL completed_capture");
    return false;
  }
  console.log("AUTONOMOUS_ADAPTER_DIAGNOSTIC_SELFTEST=PASS");
  return true;
}

function cmdCliAutonomousAdapterDiagnostic() {
  const cursorText = readTextSafe(CURSOR_OUTPUT);
  const ev = evaluateAutonomousAdapterOutput(cursorText);
  const nextPath = readTextSafe(NEXT_ACTION);
  const nextTagMatch = nextPath.match(/<!--\s*SILVER_NEXT_ACTION:\s*([^;]+)/i);
  const nextTag = nextTagMatch ? String(nextTagMatch[1]).trim() : "(none)";
  const fallback_template_used =
    /full-auto-loop-unclear-input|full-auto-loop-quality-fallback/i.test(nextTag) ? "YES" : "NO";

  console.log("=== SILVER_CLI_AUTONOMOUS_ADAPTER_DIAGNOSTIC ===");
  console.log("adapter_output_state=" + ev.adapter_output_state);
  console.log("adapter_output_valid=" + ev.adapter_output_valid);
  console.log("stale_detected=" + ev.stale_detected);
  console.log("lifecycle_block_reason=" + ev.lifecycle_block_reason);
  console.log("stdout_present=" + ev.stdout_present);
  console.log("stderr_present=" + ev.stderr_present);
  console.log("task_digest_present=" + ev.task_digest_present);
  console.log("process_start_present=" + ev.process_start_present);
  console.log("autonomous_cycle=" + ev.autonomous_cycle);
  console.log("next_action_generation_allowed=" + ev.next_action_generation_allowed);
  console.log("fallback_template_used=" + fallback_template_used);
  console.log("is_adapter_capture=" + ev.is_adapter_capture);
  console.log("SILVER_AUTONOMOUS_RUN_ID=" + (String(process.env.SILVER_AUTONOMOUS_RUN_ID || "").trim() || "(unset)"));
  console.log("=== END_SILVER_CLI_AUTONOMOUS_ADAPTER_DIAGNOSTIC ===");

  const selfOk = runAutonomousAdapterDiagnosticSelftest();
  if (!selfOk) return 1;
  if (ev.is_adapter_capture === "YES" && ev.adapter_output_valid !== "YES") return 1;
  return 0;
}

async function cmdFullAutoLoop(argvSlice, maxStepsArg) {
  const ms = parseInt(String(maxStepsArg || "1"), 10) || 1;
  if (ms !== 1) {
    console.log("NOTE: full-auto-loop V1 clamps to --max-steps=1 (requested " + ms + ")");
  }
  const mode = (argvSlice || []).indexOf("--loop-once") >= 0 ? "loop-once" : "full-auto-loop";

  let statusExit = 0;
  try {
    cmdStatus("--full-auto-loop (pre-status)");
  } catch {
    statusExit = 1;
  }

  const commit = runGit(["rev-parse", "HEAD"]);
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const changed = gitChangedFilesList().map(normalizeRepoRel).filter(Boolean);
  const changedJoined = changed.join(";");
  const dirtyD = dirtyGitUnexpectedForFullAutoLoop(changed);
  const dirtyGitGuard = dirtyD.pass ? "PASS" : "FAIL";
  const assetsAppGuard = assetsAppJsDirty(changed) ? "FAIL" : "PASS";
  const assetsAppChangedFlag = assetsAppGuard === "FAIL" ? "YES" : "NO";

  const runReportText = readTextSafe(RUN_REPORT);
  const safetyInfo = safetyBlockFromRunReportMd(runReportText);
  const safetyGuard = safetyInfo.blocked ? "FAIL" : "PASS";

  const inputPick = pickFullAutoLoopInput();

  let openaiApiUsed = "NO";
  let fallbackWithoutApi = "N/A";
  let nextActionWritten = "NO";
  let openaiApiLine = "SKIP";
  let recommended = "";
  let loopExit = 0;
  let innerNext = "";

  const plannerCtxBase = {
    mainCommit: commit,
    guardBlocked: false,
    safetyBlocked: safetyGuard === "FAIL",
    dirtyBlocked: !dirtyD.pass,
  };

  function writeGuardedNext(inner, tag) {
    let body = repairSilverOpenAiUtf8Text(stripSilverAutopilotUkolHeaderLine(String(inner || "").trim()));
    let finalTag = String(tag || "silver-autopilot");
    const probeDoc = wrapNextActionDoc(body, finalTag);
    const plannerViolations = silverNextActionQualityViolations(probeDoc);
    if (plannerViolations.length) {
      if (isHealthyPlannerContext(plannerCtxBase)) {
        body = writeClusterHandoffFile(commit);
        finalTag = "planner-cluster-handoff-enforced";
        console.log(
          "SILVER_NEXT_ACTION_PLANNER_ENFORCE=cluster_handoff tag_was=" +
            String(tag || "") +
            " violations=" +
            plannerViolations.join("; "),
        );
      } else {
        body = stripSilverAutopilotUkolHeaderLine(
          buildFullAutoQualityFallbackBody({
            inputSource: inputPick.source,
            changedFilesJoined: changedJoined,
            mainCommit: commit,
          }),
        );
        finalTag = "planner-quality-fallback-enforced";
        console.log(
          "SILVER_NEXT_ACTION_PLANNER_ENFORCE=manual_fallback tag_was=" +
            String(tag || "") +
            " violations=" +
            plannerViolations.join("; "),
        );
      }
      innerNext = body;
      nextActionWritten = "YES";
      if (silverNextActionHasClusterWorkflow(body) && /<!--\s*SILVER_NEXT_ACTION:/i.test(body)) {
        writeNextActionUtf8Safe(NEXT_ACTION, body);
      } else {
        writeNextActionUtf8Safe(NEXT_ACTION, wrapNextActionDoc(body, finalTag));
      }
      return;
    }
    innerNext = body;
    if (silverNextActionHasClusterWorkflow(body) && /<!--\s*SILVER_NEXT_ACTION:/i.test(body)) {
      writeNextActionUtf8Safe(NEXT_ACTION, body);
    } else {
      writeNextActionUtf8Safe(NEXT_ACTION, wrapNextActionDoc(body, finalTag));
    }
    nextActionWritten = "YES";
  }

  const guardBlocked = !dirtyD.pass || assetsAppGuard === "FAIL" || safetyGuard === "FAIL";
  plannerCtxBase.guardBlocked = guardBlocked;

  if (guardBlocked) {
    const parts = [];
    if (!dirtyD.pass) parts.push("unexpected_dirty:" + dirtyD.firstUnexpected);
    if (assetsAppGuard === "FAIL") parts.push("assets_app_js_dirty");
    if (safetyGuard === "FAIL") parts.push("safety_counters_nonzero_in_SILVER_RUN_REPORT");
    recommended = "Fix guard failures (clean tree, revert assets/app.js, resolve safety counters), then re-run.";
    writeGuardedNext(
      [
        "STOP — Autopilot full-auto-loop blocked by guard.",
        "",
        "- Reasons: " + parts.join("; "),
        "",
        "Run `node scripts/silver-autopilot.cjs --status`, fix the working tree, then:",
        "`node scripts/silver-autopilot.cjs --full-auto-loop --max-steps=1`",
      ].join("\n"),
      "full-auto-loop-guard",
    );
    loopExit = 1;
  } else if (inputPick.source === "(adapter-invalid)") {
    recommended =
      "STOP: refresh SILVER_CURSOR_OUTPUT.md via controlled adapter cycle; require adapter_output_valid=YES before full-auto-loop.";
    writeGuardedNext(
      buildAdapterInvalidFailSafeStopBody(inputPick.adapterEval),
      "full-auto-loop-adapter-invalid",
    );
    console.log("SILVER_FULL_AUTO_LOOP_ADAPTER_GATE=BLOCKED");
    loopExit = 1;
  } else if (!inputPick.body || inputPick.source === "(none)") {
    recommended =
      "Add >=20 chars to SILVER_CURSOR_OUTPUT.md or ensure SILVER_RUN_REPORT.md has >=10 chars; run --status; re-loop.";
    writeGuardedNext(
      [
        "Diagnostic-only: autopilot input state is unclear.",
        "",
        "- No usable input: SILVER_CURSOR_OUTPUT.md needs >= 20 non-whitespace chars, else SILVER_RUN_REPORT.md >= 10.",
        "",
        "1) Paste the latest Cursor output into `SILVER_CURSOR_OUTPUT.md`, **or** run `node scripts/silver-autopilot.cjs --status`.",
        "2) Re-run `node scripts/silver-autopilot.cjs --full-auto-loop --max-steps=1`.",
        "",
        "Rules: diagnostic-first, cluster-driven, scripts-only dominance, safety-first, zero-regression, no broad refactor.",
      ].join("\n"),
      "full-auto-loop-unclear-input",
    );
    loopExit = 0;
  } else {
    const strat = readTextSafe(STRATEGY).slice(0, 12000);
    const autoStatus = [
      "branch=" + branch,
      "commit=" + commit,
      "git_clean=" + (gitClean() ? "YES" : "NO"),
      "changed_files=" + changedJoined,
      "safety_block_from_SILVER_RUN_REPORT=" + (safetyInfo.blocked ? "YES" : "NO"),
      "input_source=" + inputPick.source,
    ].join("\n");

    const key = String(process.env.OPENAI_API_KEY || "").trim();
    if (!key) {
      console.log("OPENAI_API_KEY_MISSING");
      openaiApiLine = "MISSING";
      fallbackWithoutApi = "PASS";
      recommended = "STOP — OPENAI_API_KEY missing. Add key or run manual ChatGPT review.";
      writeGuardedNext(
        "OPENAI_API_KEY_MISSING\n\n" +
          "STOP — OPENAI_API_KEY missing. Add key or run manual ChatGPT review.\n\n" +
          "Set the key in your environment (never commit). Then re-run:\n" +
          "`node scripts/silver-autopilot.cjs --full-auto-loop --max-steps=1`\n",
        "full-auto-loop-no-api",
      );
      loopExit = 0;
    } else {
      openaiApiLine = "CALLED";
      fallbackWithoutApi = "N/A";
      const model = String(process.env.SILVER_AUTOPILOT_OPENAI_MODEL || "gpt-4o-mini").trim();
      const manifestLoop = buildRepoScriptsManifestForPrompt();
      const systemContent =
        "You are a Silver (infoUzel.cz) development copilot. Output a single copy-paste task for Cursor. " +
        "Language: Czech (cs) with correct diacritics and real Unicode (Ú, ř, š, em dash —). Never emit UTF-8 mis-decoded mojibake (e.g. Ă or â€). " +
        "Do not repeat the line starting with ÚKOL PRO CURSOR (the file template adds it). Start with numbered steps or ### headings. " +
        "Windows PowerShell first: use Get-Content -LiteralPath, Set-Location, Join-Path; never suggest `cat C:\\...` or POSIX cat with Windows drive letters. " +
        "NEVER invent script paths. Only reference files under scripts/ that appear in the USER manifest list; if unsure use only `node scripts/silver-autopilot.cjs --status`. " +
        "Hard rules: diagnostic-first; cluster-driven; scripts-only dominance; safety-first; zero-regression; " +
        "no broad refactor; engine only after proven TRUE_ENGINE_FAIL and surgically; assets/app.js only after explicit human permission; " +
        "no routing or normalizer refactors unless explicitly scoped; never paste secrets. " +
        "If git is dirty only with Silver runtime markdown (SILVER_*.md and similar), instruct: read files first, summarize, then optionally git restore those paths — never blind restore of engine files. " +
        "State in STOP podmínky: raw `-MaxCycles 0` without `-AllowInfinite`/`-AutonomousMode` is forbidden; controlled autonomous mode requires those switches plus built-in caps (see SILVER_AUTOPILOT_README.md). Never advise bypassing orchestrator safety gates. " +
        "Always include sections ### Scope guard, ### STOP podmínky, and ### Povinný výsledek with a fenced block using === line markers the operator pastes back. " +
        "If state is ambiguous, output diagnostic-only steps (node scripts/silver-…, audits from manifest). " +
        "Never instruct a direct engine or assets/app.js edit without explicit diagnostics-first framing. " +
        "For healthy Silver CAP workflow prefer PRODUCT CLUSTER diagnostics (silver-rhc3-cluster-classifier-v1.cjs, harness, audit_silver). " +
        "Never output generic infra (sudo apt, gh auth login, verify-pr=NNNN, git push -u) unless the task starts with INFRA_BLOCKER_REASON: and a concrete blocker. " +
        "Never hardcode stale PR numbers; use node scripts/silver-autopilot.cjs --status for current state.";

      const userContent =
        "### SILVER_STRATEGY.md (excerpt)\n" +
        strat +
        "\n\n### Autopilot status snapshot\n" +
        autoStatus +
        "\n\n### Last Cursor output / report (from " +
        inputPick.source +
        ")\n" +
        inputPick.body +
        "\n\n### Existující skripty v repu (manifest — používej POUZE tyto nebo podmnožinu)\n" +
        manifestLoop +
        "\n\n### Deliverable\n" +
        "Produce ONE next task in Czech: concise numbered steps; exact commands only from manifest above or `node scripts/silver-autopilot.cjs --status`; scripts-only unless engine failure is proven; never hallucinate scripts/*.js paths.";

      let text = "";
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 2200,
            messages: [
              { role: "system", content: systemContent },
              { role: "user", content: userContent },
            ],
          }),
        });
        const raw = await decodeFetchBodyUtf8(res);
        if (!res.ok) {
          console.log("STOP: OpenAI HTTP " + res.status);
          openaiApiUsed = "YES";
          writeGuardedNext(
            "STOP — OpenAI API HTTP " +
              res.status +
              ". Fix credentials or quota; or run manual ChatGPT review.\n\nTruncated response:\n" +
              raw.slice(0, 1200),
            "full-auto-loop-api-http",
          );
          recommended = "Resolve OpenAI API error; re-run full-auto-loop.";
          loopExit = 1;
        } else {
          const coercedLoop = coerceOpenAiChatCompletionText(raw);
          if (coercedLoop.repaired === "YES") {
            console.log("SILVER_OPENAI_UTF8_REPAIR=YES path=full-auto-loop");
          }
          text = coercedLoop.content;
          openaiApiUsed = "YES";
          if (violatesEngineTaskWithoutDiagnosticPolicy(text)) {
            writeGuardedNext(
              "STOP — proposed engine/routing/assets/app.js style work without diagnostic-first framing. Re-run with clearer cluster context.\n\n" +
                "--- reference (blocked model text, truncated) ---\n" +
                text.slice(0, 2500),
              "full-auto-loop-engine-policy",
            );
            recommended = "Re-run after `node scripts/silver-autopilot.cjs --refresh-rhc3` or enrich SILVER_CURSOR_OUTPUT.md.";
            loopExit = 1;
          } else {
            const resolvedLoop = resolveNextActionModelBody(text, {
              inputSource: inputPick.source,
              changedFilesJoined: changedJoined,
              mainCommit: commit,
              guardBlocked: false,
              safetyBlocked: safetyGuard === "FAIL",
              dirtyBlocked: !dirtyD.pass,
              adapterInvalid: inputPick.source === "(adapter-invalid)",
              adapterEval: inputPick.adapterEval,
            });
            if (!resolvedLoop.ok) {
              console.log("SILVER_NEXT_ACTION_QUALITY_GATE=REJECT full-auto-loop " + resolvedLoop.violations.join("; "));
              if (resolvedLoop.clusterHandoff) {
                writeGuardedNext(resolvedLoop.body, "planner-cluster-handoff-regen");
                recommended =
                  "Model output rejected; deterministic Silver cluster handoff written (healthy CAP context).";
              } else {
                writeGuardedNext(resolvedLoop.body, "full-auto-loop-quality-fallback");
                recommended =
                  "Model output failed quality gate; manual-verify fallback written; see SILVER_NEXT_ACTION_QUALITY_GATE.";
              }
              loopExit = 0;
            } else {
              writeGuardedNext(resolvedLoop.body, "full-auto-loop-openai");
              recommended = resolvedLoop.bareSanitized
                ? "SILVER_NEXT_ACTION.md written (bare autopilot command sanitized to --status); execute in Cursor."
                : "Execute steps in SILVER_NEXT_ACTION.md in Cursor.";
              loopExit = 0;
            }
          }
        }
      } catch {
        console.log("STOP: OpenAI request error");
        openaiApiUsed = "YES";
        writeGuardedNext(
          "STOP — OpenAI request failed (network/parse). Retry or run manual ChatGPT review.\n",
          "full-auto-loop-network",
        );
        recommended = "Check network and OPENAI_API_KEY; re-run.";
        loopExit = 1;
      }
    }
  }

  const cleanAfter = gitClean();
  const gitStatusClean = cleanAfter ? "YES" : "NO";
  const changedFinal = gitChangedFilesList().map(normalizeRepoRel).filter(Boolean).join(";");
  const prReady =
    cleanAfter && dirtyGitGuard === "PASS" && assetsAppGuard === "PASS" && safetyGuard === "PASS" && loopExit === 0
      ? "YES"
      : "NO";

  const adapterGateLine =
    inputPick.adapterEval && inputPick.adapterEval.is_adapter_capture === "YES"
      ? "adapter_output_valid=" + inputPick.adapterEval.adapter_output_valid
      : "adapter_output_valid=NA";

  printFullAutoLoopResult({
    main_commit: commit,
    mode,
    input_source: inputPick.source,
    adapter_gate: adapterGateLine,
    openai_api: openaiApiLine,
    next_action_written: nextActionWritten,
    engine_changed: "NO",
    assets_app_changed: assetsAppChangedFlag,
    git_status_clean: gitStatusClean,
    safety_block_detected: safetyGuard === "FAIL" ? "YES" : "NO",
    recommended_next_task: recommended,
  });

  printFullAutoLoopV1Result({
    main_commit: commit,
    branch,
    engine_changed: "NO",
    assets_app_changed: assetsAppChangedFlag,
    changed_files: changedFinal,
    status_exit: statusExit,
    full_auto_loop_exit: loopExit,
    openai_api_used: openaiApiUsed,
    next_action_written: nextActionWritten,
    dirty_git_guard: dirtyGitGuard,
    assets_app_guard: assetsAppGuard,
    safety_guard: safetyGuard,
    fallback_without_api: fallbackWithoutApi,
    git_status_clean: gitStatusClean,
    pr_ready: prReady,
    recommended_next_task: recommended,
  });

  let utf8MojibakeDetected = "NO";
  let readyForProductCap50 = loopExit === 0 && prReady === "YES" ? "YES" : "NO";
  if (nextActionWritten === "YES") {
    const nextOnDisk = readTextSafe(NEXT_ACTION);
    if (hasSilverUtf8MojibakeMarkers(nextOnDisk)) {
      utf8MojibakeDetected = "YES";
      readyForProductCap50 = "NO";
      if (loopExit === 0) loopExit = 1;
    }
  }

  writeRunReport({
    timestamp: nowIso(),
    command: "--full-auto-loop",
    status: loopExit === 0 ? "PASS" : "STOP",
    branch,
    commit,
    git_status_clean: gitStatusClean,
    changed_files: changedFinal,
    pr_info: "",
    engine_changed: "NO",
    assets_app_changed: assetsAppChangedFlag,
    ui_changed: "NO",
    css_changed: "NO",
    backend_changed: "NO",
    safety_counters: (() => {
      const m = String(runReportText || "").match(/^safety_counters=(.*)$/m);
      return m ? String(m[1]).trim() : "";
    })(),
    calendar_write_20k: "",
    calendar_query_20k: "",
    next_recommended_command: recommended,
    recommended_next_task: recommended,
    utf8_mojibake_detected: utf8MojibakeDetected,
    ready_for_product_cap50: readyForProductCap50,
    reason_for_stop: loopExit !== 0 ? recommended : "",
  });

  return loopExit;
}

function cmdSanitizeNextActionMd(argvCommand) {
  const full = readTextSafe(NEXT_ACTION).trim();
  const v = [
    ...new Set([
      ...silverNextActionQualityViolations(full),
      ...nextActionInnerQualityViolations(full),
    ]),
  ];
  if (!v.length) {
    console.log("SILVER_NEXT_ACTION_SANITIZE=SKIP no_violations");
    return 0;
  }
  const commit = runGit(["rev-parse", "HEAD"]);
  const dirtyD = dirtyGitUnexpectedForFullAutoLoop(gitChangedFilesList().map(normalizeRepoRel).filter(Boolean));
  const runReportText = readTextSafe(RUN_REPORT);
  const safetyInfo = safetyBlockFromRunReportMd(runReportText);
  const plannerCtx = {
    mainCommit: commit,
    guardBlocked: !dirtyD.pass || assetsAppJsDirty(gitChangedFilesList().map(normalizeRepoRel).filter(Boolean)),
    safetyBlocked: safetyInfo.blocked,
    dirtyBlocked: !dirtyD.pass,
  };
  if (isHealthyPlannerContext(plannerCtx)) {
    writeClusterHandoffFile(commit);
    console.log(
      "SILVER_NEXT_ACTION_QUALITY_GATE_SANITIZE=CLUSTER_HANDOFF " +
        v.join("; ") +
        " argv=" +
        String(argvCommand || "--sanitize-next-action-md"),
    );
  } else {
    const fb = buildFullAutoQualityFallbackBody({
      inputSource: "SILVER_NEXT_ACTION.md (precycle sanitization)",
      changedFilesJoined: gitChangedFilesList().join(";") || "(none)",
    });
    writeUtf8FileNoBom(NEXT_ACTION, wrapNextActionDoc(fb, "sanitize-next-action-md"));
    console.log(
      "SILVER_NEXT_ACTION_QUALITY_GATE_SANITIZE=MANUAL_FALLBACK " +
        v.join("; ") +
        " argv=" +
        String(argvCommand || "--sanitize-next-action-md"),
    );
  }
  console.log("SILVER_NEXT_ACTION_SANITIZED=YES recommended=node scripts/silver-autopilot.cjs --status");
  return 0;
}

function parseArgs(argv) {
  const out = { cmd: null, pr: "", maxSteps: "1" };
  for (const a of argv) {
    if (a === "--status") out.cmd = "status";
    else if (a.startsWith("--verify-pr=")) {
      out.cmd = "verify-pr";
      out.pr = a.slice("--verify-pr=".length);
    } else if (a.startsWith("--merge-pr=")) {
      out.cmd = "merge-pr";
      out.pr = a.slice("--merge-pr=".length);
    } else if (a === "--post-merge-proof") out.cmd = "post-merge-proof";
    else if (a === "--refresh-rhc3") out.cmd = "refresh-rhc3";
    else if (a === "--ask-model") out.cmd = "ask-model";
    else if (a === "--sanitize-next-action-md") out.cmd = "sanitize-next-action-md";
    else if (a === "--cli-planner-cluster-preference-selftest") out.cmd = "planner-cluster-selftest";
    else if (a === "--cli-openai-next-action-utf8-selftest") out.cmd = "openai-next-action-utf8-selftest";
    else if (a === "--cli-openai-real-next-action-utf8-diagnostic") out.cmd = "openai-real-next-action-utf8-diagnostic";
    else if (a === "--cli-autonomous-adapter-diagnostic") out.cmd = "cli-autonomous-adapter-diagnostic";
    else if (a === "--preflight-runtime-cleanup") out.cmd = "preflight-runtime-cleanup";
    else if (a === "--preflight-runtime-cleanup-selftest") out.cmd = "preflight-runtime-cleanup-selftest";
    else if (a === "--auto") out.cmd = "auto";
    else if (a === "--full-auto-loop" || a === "--loop-once") out.cmd = "full-auto-loop";
    else if (a.startsWith("--max-steps=")) out.maxSteps = a.slice("--max-steps=".length);
  }
  return out;
}

(async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log("Usage: node scripts/silver-autopilot.cjs --status | --verify-pr=NNNN | --full-auto-loop | ...");
    process.exit(1);
  }
  const p = parseArgs(argv);
  if (!p.cmd) {
    console.log("STOP: no command");
    process.exit(1);
  }
  let exitCode = 0;
  if (p.cmd === "status") cmdStatus("--status");
  else if (p.cmd === "verify-pr") verifyPr(p.pr);
  else if (p.cmd === "merge-pr") cmdMergePr(p.pr);
  else if (p.cmd === "post-merge-proof") exitCode = cmdPostMergeProof();
  else if (p.cmd === "refresh-rhc3") cmdRefreshRhc3();
  else if (p.cmd === "ask-model") await cmdAskModel();
  else if (p.cmd === "sanitize-next-action-md") exitCode = cmdSanitizeNextActionMd("--sanitize-next-action-md");
  else if (p.cmd === "planner-cluster-selftest") {
    process.exit(runPlannerClusterPreferenceSelftest() ? 0 : 1);
  } else if (p.cmd === "openai-next-action-utf8-selftest") {
    process.exit(runOpenAiNextActionUtf8Selftest() ? 0 : 1);
  } else if (p.cmd === "openai-real-next-action-utf8-diagnostic") {
    await cmdOpenAiRealNextActionUtf8Diagnostic();
    return;
  } else if (p.cmd === "cli-autonomous-adapter-diagnostic") {
    process.exit(cmdCliAutonomousAdapterDiagnostic());
  } else if (p.cmd === "preflight-runtime-cleanup") {
    const dryOnly = argv.indexOf("--dry-run") >= 0;
    const pf = cap50PreflightRuntimeCleanup(dryOnly);
    process.exit(pf.exitCode);
  } else if (p.cmd === "preflight-runtime-cleanup-selftest") {
    const cases = [
      { rel: "SILVER_RUN_REPORT.md", pass: true },
      { rel: "SILVER_NEXT_ACTION.md", pass: true },
      { rel: "scripts/silver-rhc3-cluster-classifier-v1-report.json", pass: true },
    ];
    const failures = [];
    const utf8 = { encoding: "utf8" };
    for (const c of cases) {
      const full = path.join(REPO, c.rel);
      let backup = null;
      try {
        backup = fs.existsSync(full) ? fs.readFileSync(full, utf8) : null;
        fs.writeFileSync(full, "# cap50-preflight-selftest\n", utf8);
        const pf = cap50PreflightRuntimeCleanup(false);
        if (!c.pass && pf.result.PASS_FAIL === "PASS") failures.push(c.rel + ": expected FAIL");
        if (c.pass) {
          if (!pf.result.restored_runtime_files.includes(c.rel)) {
            failures.push(c.rel + ": not in restored_runtime_files");
          }
          const stillDirty = gitChangedFilesList().some(
            (p) => repoRelGuardKey(p) === repoRelGuardKey(c.rel),
          );
          if (stillDirty) failures.push(c.rel + ": still dirty after restore");
        }
      } finally {
        if (backup != null) fs.writeFileSync(full, backup, utf8);
        else {
          try {
            execFileSync("git", ["restore", "--worktree", "--", c.rel], { cwd: REPO, stdio: "pipe" });
          } catch {
            /* best-effort */
          }
        }
        cap50PreflightRuntimeCleanup(false);
      }
    }
    const blockRel = "SILVER_CAP50_PREFLIGHT_SELFTEST_BLOCK.txt";
    const blockFull = path.join(REPO, blockRel);
    try {
      fs.writeFileSync(blockFull, "block\n", utf8);
      const pfBlock = cap50PreflightRuntimeCleanup(false);
      if (pfBlock.result.PASS_FAIL !== "FAIL") failures.push("non_allowlist: expected FAIL");
    } finally {
      try {
        fs.unlinkSync(blockFull);
      } catch {
        /* ignore */
      }
    }
    if (failures.length) {
      console.log("SILVER_CAP50_PREFLIGHT_CLEANUP_SELFTEST=FAIL");
      for (const f of failures) console.log(f);
      process.exit(1);
    }
    console.log("SILVER_CAP50_PREFLIGHT_CLEANUP_SELFTEST=PASS");
    process.exit(0);
  } else if (p.cmd === "auto") cmdAuto(p.maxSteps);
  else if (p.cmd === "full-auto-loop") exitCode = await cmdFullAutoLoop(argv, p.maxSteps);
  if (exitCode) process.exit(exitCode);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
