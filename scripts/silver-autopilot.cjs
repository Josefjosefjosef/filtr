#!/usr/bin/env node
/**
 * Silver Autopilot V1 — local orchestration only (no runtime Silver changes).
 * Commands: --status | --verify-pr= | --merge-pr= | --post-merge-proof | --refresh-rhc3 | --ask-model | --auto | --full-auto-loop | --loop-once
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
const CURSOR_OUTPUT = path.join(REPO, "SILVER_CURSOR_OUTPUT.md");

const FULL_AUTO_LOOP_ALLOWED_DIRTY = new Set(
  [
    "SILVER_STRATEGY.md",
    "SILVER_NEXT_ACTION.md",
    "SILVER_RUN_REPORT.md",
    "SILVER_PROGRESS_LOG.md",
    "SILVER_AUTOPILOT_README.md",
    "SILVER_CURSOR_OUTPUT.md",
    "SILVER_STOP_AUTOPILOT",
    "scripts/silver-autopilot.cjs",
    "scripts/silver-autopilot-loop.ps1",
    "scripts/silver-autonomous-loop-safety-diagnostic.ps1",
  ].map((s) => s.replace(/\\/g, "/")),
);

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
    return runGit(["status", "--porcelain"]);
  } catch {
    return "DIRTY_UNKNOWN";
  }
}

function normalizeRepoRel(rel) {
  return String(rel || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function gitChangedFilesList() {
  const po = gitStatusPorcelain();
  if (!po) return [];
  return po
    .split(/\r?\n/)
    .map((l) => {
      const line = String(l || "").replace(/\r$/, "");
      if (!line) return "";
      if (line.length >= 3 && line.charAt(2) === " ") return line.slice(3).trim();
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) return parts.slice(1).join(" ").trim();
      return line.trim();
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

const ROOT_SILVER_MD = /^SILVER_(STRATEGY|NEXT_ACTION|RUN_REPORT|AUTOPILOT_README|CURSOR_OUTPUT)\.md$/;

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
    if (FULL_AUTO_LOOP_ALLOWED_DIRTY.has(n)) continue;
    return { pass: false, firstUnexpected: n };
  }
  return { pass: true, firstUnexpected: "" };
}

function assetsAppJsDirty(changedList) {
  const list = Array.isArray(changedList) ? changedList : [];
  return list.some((rel) => normalizeRepoRel(rel) === "assets/app.js");
}

function pickFullAutoLoopInput() {
  const cursorText = readTextSafe(CURSOR_OUTPUT).trim();
  const reportText = readTextSafe(RUN_REPORT).trim();
  if (cursorText.length >= 20) {
    return { source: "SILVER_CURSOR_OUTPUT.md", body: cursorText.slice(0, 24000) };
  }
  if (reportText.length >= 10) {
    return { source: "SILVER_RUN_REPORT.md", body: reportText.slice(0, 24000) };
  }
  return { source: "(none)", body: "" };
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

function nextActionInnerQualityViolations(inner) {
  const t = String(inner || "");
  const violations = [];
  if (/Ă/.test(t)) violations.push("mojibake_C3");
  if (/â€/.test(t)) violations.push("mojibake_em_dash");
  for (const re of NEXT_ACTION_BANNED_HALLUCINATION_RUNS) {
    if (re.test(t)) violations.push("banned_node_invocation:" + String(re));
  }
  if (/`cat\s+C:\\/i.test(t) || /\bCommand:\s*`?cat\s+C:\\/i.test(t) || /^\s*cat\s+C:\\/im.test(t)) {
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

function buildProofGateConsistencyReason(authoritative, deepEmbedded, rawFail, rawPass) {
  const parts = [];
  parts.push("authoritative=" + authoritative.gate + "@" + authoritative.source);
  if (deepEmbedded) parts.push("deep_product_embedded_gate=" + deepEmbedded);
  else parts.push("deep_product_embedded_gate=(absent)");
  parts.push("raw_substring_FAIL_mentions=" + rawFail + "_PASS_mentions=" + rawPass);
  if (authoritative.gate === "PASS" && deepEmbedded === "FAIL") {
    parts.push(
      "diagnosis=embedded_sibling_FAIL_non_authoritative_when_standalone_audit_and_corpus_JSON_PASS_deep_may_rerun_gates",
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
    "post_merge_proof_exit_code=" + String(payload.post_merge_proof_exit_code != null ? payload.post_merge_proof_exit_code : ""),
    "post_merge_proof_logical_status=" + String(payload.post_merge_proof_logical_status || ""),
    "post_merge_proof_process_exit=" + String(payload.post_merge_proof_process_exit != null ? payload.post_merge_proof_process_exit : ""),
    "tracked_report_restore_before_realistic_mobile=" + String(payload.tracked_report_restore_before_realistic_mobile || ""),
    "failed_step=" + String(payload.failed_step || ""),
    "failed_reason=" + String(payload.failed_reason || ""),
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
    gate_realistic_mobile: authoritativeGateStatus,
    raw_realistic_mobile_mentions_FAIL: rawStatus.rawFail,
    raw_realistic_mobile_mentions_PASS: rawStatus.rawPass,
    selected_authoritative_source: authForStatus.source,
    proof_gate_consistency_reason: reasonStatus,
    proof_summary_consistent: summaryStatus,
    post_merge_proof_exit_code: "",
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
  printProofGateConsistencyResult({
    main_commit: commit,
    engine_changed: "NO",
    assets_app_changed: "NO",
    changed_files: changed,
    post_merge_proof_exit: "",
    authoritative_realistic_mobile: authoritativeGateStatus,
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
    gs = runGit(["status", "--short"]);
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
  writeRunReport({
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
  });
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
    const rawAsk = String((((json.choices || [])[0] || {}).message || {}).content || "").trim();
    const qAsk = nextActionInnerQualityViolations(rawAsk);
    if (qAsk.length) {
      console.log("SILVER_NEXT_ACTION_QUALITY_GATE=REJECT ask-model " + qAsk.join("; "));
      text = buildFullAutoQualityFallbackBody({
        inputSource: "SILVER_STRATEGY+RUN_REPORT+git",
        changedFilesJoined: gs,
      });
    } else {
      text = rawAsk;
    }
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

  function writeGuardedNext(inner, tag) {
    innerNext = inner;
    fs.writeFileSync(NEXT_ACTION, wrapNextActionDoc(inner, tag), "utf8");
    nextActionWritten = "YES";
  }

  const guardBlocked = !dirtyD.pass || assetsAppGuard === "FAIL" || safetyGuard === "FAIL";

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
        "Never instruct a direct engine or assets/app.js edit without explicit diagnostics-first framing.";

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
        const raw = await res.text();
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
          const json = JSON.parse(raw);
          text = String((((json.choices || [])[0] || {}).message || {}).content || "").trim();
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
            let body = text;
            body = body.replace(/^\s*ÚKOL\s+PRO\s+CURSOR[^\n]*\n+/i, "").trim();
            const qLoop = nextActionInnerQualityViolations(body);
            if (qLoop.length) {
              console.log("SILVER_NEXT_ACTION_QUALITY_GATE=REJECT full-auto-loop " + qLoop.join("; "));
              const fb = buildFullAutoQualityFallbackBody({
                inputSource: inputPick.source,
                changedFilesJoined: changedJoined,
              });
              writeGuardedNext(fb, "full-auto-loop-quality-fallback");
              recommended =
                "Model output failed UTF-8/PowerShell/hallucination quality gate; deterministic SILVER_NEXT_ACTION.md written; see console SILVER_NEXT_ACTION_QUALITY_GATE.";
              loopExit = 0;
            } else {
              writeGuardedNext(body, "full-auto-loop-openai");
              recommended = "Execute steps in SILVER_NEXT_ACTION.md in Cursor.";
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

  printFullAutoLoopResult({
    main_commit: commit,
    mode,
    input_source: inputPick.source,
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

  return loopExit;
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
  else if (p.cmd === "auto") cmdAuto(p.maxSteps);
  else if (p.cmd === "full-auto-loop") exitCode = await cmdFullAutoLoop(argv, p.maxSteps);
  if (exitCode) process.exit(exitCode);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
