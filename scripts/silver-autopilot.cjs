#!/usr/bin/env node
/**
 * Silver Autopilot V1 — local orchestration only (no runtime Silver changes).
 * Commands: --status | --verify-pr= | --merge-pr= | --post-merge-proof | --refresh-rhc3 | --ask-model | --auto
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const SCRIPTS = __dirname;

const STRATEGY = path.join(REPO, "SILVER_STRATEGY.md");
const NEXT_ACTION = path.join(REPO, "SILVER_NEXT_ACTION.md");
const RUN_REPORT = path.join(REPO, "SILVER_RUN_REPORT.md");
const README = path.join(REPO, "SILVER_AUTOPILOT_README.md");

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
    return runGit(["status", "--porcelain"]);
  } catch {
    return "DIRTY_UNKNOWN";
  }
}

function gitChangedFilesList() {
  const po = gitStatusPorcelain();
  if (!po) return [];
  return po.split(/\r?\n/).map((l) => l.slice(3).trim()).filter(Boolean);
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

const ROOT_SILVER_MD = /^SILVER_(STRATEGY|NEXT_ACTION|RUN_REPORT|AUTOPILOT_README)\.md$/;

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

function writeRunReport(payload) {
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
    "next_recommended_command=" + String(payload.next_recommended_command || ""),
    "reason_for_stop=" + String(payload.reason_for_stop || ""),
    "",
    "## Notes",
    "- Autopilot V1 never commits secrets. Do not paste `OPENAI_API_KEY` into this file.",
    "",
  ];
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

  writeRunReport({
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
    next_recommended_command: nextCmd,
    reason_for_stop: reason,
  });

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
  if (!gitClean()) {
    console.log("STOP: dirty git before post-merge-proof");
    return;
  }
  for (const step of POST_MERGE_STEPS) {
    let code = 1;
    if (step.kind === "npm") {
      const r = spawnRepo(process.platform === "win32" ? "npm.cmd" : "npm", step.args, true);
      code = r.code;
    } else {
      const scriptPath = path.join(SCRIPTS, step.file);
      const r = spawnRepo(process.execPath, [scriptPath], true);
      code = r.code;
    }
    if (code !== 0) {
      console.log("STOP: step failed " + JSON.stringify(step));
      writeRunReport({
        timestamp: nowIso(),
        command: "--post-merge-proof",
        status: "STOP",
        branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
        commit: runGit(["rev-parse", "HEAD"]),
        git_status_clean: "YES",
        changed_files: "",
        pr_info: "",
        engine_changed: "NO",
        assets_app_changed: "NO",
        ui_changed: "NO",
        css_changed: "NO",
        backend_changed: "NO",
        safety_counters: JSON.stringify(aggregateSafetyFromReports()),
        calendar_write_20k: "",
        calendar_query_20k: "",
        next_recommended_command: "fix failing audit then re-run",
        reason_for_stop: "audit_step_failed:" + JSON.stringify(step),
      });
      return;
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
    writeRunReport({
      timestamp: nowIso(),
      command: "--post-merge-proof",
      status: "STOP",
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: runGit(["rev-parse", "HEAD"]),
      git_status_clean: "YES",
      changed_files: "",
      pr_info: "",
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: JSON.stringify(safety),
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      next_recommended_command: "triage safety harness",
      reason_for_stop: "safety_counters_nonzero",
    });
    return;
  }
  if (!cal.calendar_write_ok || !cal.calendar_query_ok) {
    console.log("STOP: calendar 20k metrics not 3000/3000 when strict");
    writeRunReport({
      timestamp: nowIso(),
      command: "--post-merge-proof",
      status: "STOP",
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: runGit(["rev-parse", "HEAD"]),
      git_status_clean: "YES",
      changed_files: "",
      pr_info: "",
      engine_changed: "NO",
      assets_app_changed: "NO",
      ui_changed: "NO",
      css_changed: "NO",
      backend_changed: "NO",
      safety_counters: JSON.stringify(safety),
      calendar_write_20k: cal.calendar_write_20k,
      calendar_query_20k: cal.calendar_query_20k,
      next_recommended_command: "inspect calendar harness reports",
      reason_for_stop: "calendar_20k_not_3000",
    });
    return;
  }

  restoreTrackedReportJsons();
  let gs = "";
  try {
    gs = runGit(["status", "--short"]);
  } catch {
    gs = "UNKNOWN";
  }
  console.log("=== GIT_STATUS_AFTER_RESTORE ===");
  console.log(gs || "(clean)");
  console.log("=== END_GIT_STATUS ===");
  console.log("PASS: post-merge-proof complete");
  writeRunReport({
    timestamp: nowIso(),
    command: "--post-merge-proof",
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
    safety_counters: JSON.stringify(safety),
    calendar_write_20k: cal.calendar_write_20k,
    calendar_query_20k: cal.calendar_query_20k,
    next_recommended_command: "node scripts/silver-autopilot.cjs --status",
    reason_for_stop: "",
  });
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
    gs = runGit(["status", "--short"]);
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
  const body = {
    model,
    temperature: 0.2,
    max_tokens: 1800,
    messages: [
      {
        role: "system",
        content:
          "You are a Silver (infoUzel.cz) development copilot. Output ONLY copy-paste instructions for a human or Cursor. " +
          "Never request engine edits, assets/app.js edits, routing/normalizer refactors, merges, or secret pastes. " +
          "Prefer scripts-only diagnostics and proof commands. Use concise markdown with one primary NEXT block.",
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
          "\n\nWrite SILVER_NEXT_ACTION.md content: short title, bullets, exact shell commands using node scripts/...",
      },
    ],
  };

  let text = "";
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.log("STOP: OpenAI HTTP " + res.status);
      console.log(raw.slice(0, 500));
      return;
    }
    const json = JSON.parse(raw);
    text = (((json.choices || [])[0] || {}).message || {}).content || "";
  } catch (e) {
    console.log("STOP: OpenAI request error");
    return;
  }

  const out =
    "<!-- SILVER_NEXT_ACTION: generated by silver-autopilot --ask-model; not auto-applied -->\n\n" + String(text || "").trim() + "\n";
  fs.writeFileSync(NEXT_ACTION, out, "utf8");
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
    else if (a === "--auto") out.cmd = "auto";
    else if (a.startsWith("--max-steps=")) out.maxSteps = a.slice("--max-steps=".length);
  }
  return out;
}

(async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log("Usage: node scripts/silver-autopilot.cjs --status | --verify-pr=NNNN | ...");
    process.exit(1);
  }
  const p = parseArgs(argv);
  if (!p.cmd) {
    console.log("STOP: no command");
    process.exit(1);
  }
  if (p.cmd === "status") cmdStatus("--status");
  else if (p.cmd === "verify-pr") verifyPr(p.pr);
  else if (p.cmd === "merge-pr") cmdMergePr(p.pr);
  else if (p.cmd === "post-merge-proof") cmdPostMergeProof();
  else if (p.cmd === "refresh-rhc3") cmdRefreshRhc3();
  else if (p.cmd === "ask-model") await cmdAskModel();
  else if (p.cmd === "auto") cmdAuto(p.maxSteps);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
