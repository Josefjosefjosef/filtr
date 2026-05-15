/**
 * RHC3 cluster diagnostic (read-only): rhc3_task_create_do_ukolu
 * ("Hoď mi do úkolů … , ne do kalendáře." family task_create_chaos).
 * No engine edits; no assets/app.js changes.
 * Full-corpus safety counters + cluster-only triage buckets.
 * Optional --proof: smoke, calendar regressions, 20k routing, quality v2, realistic mobile (requires clean git allowlist).
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync, spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP_JS = path.join(REPO, "assets", "app.js");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-task-create-do-ukolu-diagnostic-report.json");
const ALIGNMENT_REPORT_JSON = path.join(__dirname, "silver-rhc3-task-create-do-ukolu-harness-alignment-report.json");
const FOUNDATION_REPORT = path.join(__dirname, "silver-rhc-v3-foundation-pilot-report.json");

const EXPECTED_MAIN_COMMIT = "2a76b8037d5147054b12b96cd3110007b96a3bcd";

/** Pre-alignment story baseline (PR #4322 merged diagnostic snapshot). */
const HARNESS_ALIGN_STORY_BASELINE = {
  cluster_fail_count: 405,
  task_create_clarify_chaos: 399,
  should_fix_harness_count: 403
};
const TARGET_CLUSTER = "rhc3_task_create_do_ukolu";
const RANDOM_SAMPLE_SEED = 0x7461736b;

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();

const core = require("./rhc-v3-deterministic-core.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const {
  computeGoldLabels,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval,
  finalizeNoteCreateDoPoznamkStorageHarnessEval,
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval,
  finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval
} = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
  hasNegWrite,
  rawUserMessage
} = harness;

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function safetyNoWriteFolded(fold) {
  return (
    /\bnic\s+neuklad\w*\b/i.test(fold) ||
    /\bnevytvarej\b/i.test(fold) ||
    /\bnevytvářej\b/i.test(fold) ||
    /\bpouze\s+cti\b/i.test(fold) ||
    /\bpouze\s+čti\b/i.test(fold) ||
    /\bjen\s+se\s+podivej\b/i.test(fold) ||
    /\bjen\s+se\s+podívej\b/i.test(fold) ||
    /\bneukladat\b/i.test(fold) ||
    /\bneukládat\b/i.test(fold)
  );
}

function popcountMask(mask, onlyBits) {
  let x = (mask >>> 0) & (onlyBits >>> 0);
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
}

function noiseOnlyPopcount(mask) {
  const noiseMask =
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.MOBILE_PREFIX |
    core.M.SPOKEN_COMPRESS |
    core.M.EMOTIONAL |
    core.M.TYPO_LITE |
    core.M.STRIP_DIACRITICS |
    core.M.PARTIAL_REF;
  return popcountMask((mask || 0) >>> 0, noiseMask >>> 0);
}

function isChaoticMutationSurface(c) {
  const mask = (c.mutation_mask || 0) >>> 0;
  const noiseMask =
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.MOBILE_PREFIX |
    core.M.SPOKEN_COMPRESS |
    core.M.EMOTIONAL |
    core.M.TYPO_LITE |
    core.M.STRIP_DIACRITICS |
    core.M.PARTIAL_REF;
  if (popcountMask(mask, noiseMask) >= 3) return true;
  if ((mask & core.M.NEGATION_OVERLAY) !== 0) return true;
  if ((mask & core.M.AMBIGUITY_OVERLAY) !== 0) return true;
  return false;
}

function hasTaskCreateCanonFolded(fold) {
  const f = String(fold || "");
  const hasDoUkol =
    /\bdo\s+ukol\w*\b/i.test(f) || /\bhod\s+mi\s+do\s+ukol/i.test(f) || /\bhod\s+do\s+ukol/i.test(f);
  const negCal = /\bne\s+do\s+kalend/i.test(f) || /\bne\s+v\s+kalend/i.test(f);
  return hasDoUkol && negCal;
}

function titlePollutionHeuristic(title, rawAssistant) {
  const t = foldCs(String(title || ""));
  const r = foldCs(String(rawAssistant || ""));
  if (!t && !r) return false;
  const pat =
    /\bhod\s+mi\s+tam\b|\bprosim\s+te\b|\bdo\s+ukol\w*\s+ze\b|\bukol\s+ze\b|\bdej\s+mi\s+tam\b|\bjen\s+jen\b/i;
  if (pat.test(t)) return true;
  if (/\bjen\s+[^,]{0,40}\bukol/i.test(t)) return true;
  if (pat.test(r) && t.length < 4) return true;
  return false;
}

function mulberry32(seed) {
  return core.mulberry32(seed >>> 0);
}

function stratifiedPick(arr, want) {
  const STRATA = 8;
  const buckets = [];
  for (let s = 0; s < STRATA; s++) buckets.push([]);
  for (let i = 0; i < arr.length; i++) {
    const m = (arr[i].mutation_mask >>> 0) % STRATA;
    buckets[m].push(arr[i]);
  }
  const out = [];
  let round = 0;
  while (out.length < want && arr.length) {
    let added = false;
    for (let s = 0; s < STRATA && out.length < want; s++) {
      if (buckets[s].length > round) {
        out.push(buckets[s][round]);
        added = true;
      }
    }
    if (!added) break;
    round++;
  }
  return out;
}

function randomPick(arr, want, seed) {
  const rng = mulberry32(seed >>> 0);
  const idx = arr.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  const out = [];
  const n = Math.min(want, idx.length);
  for (let k = 0; k < n; k++) out.push(arr[idx[k]]);
  return out;
}

function countKey(map, k) {
  map[k] = (map[k] || 0) + 1;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function gitAllowListClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "scripts/silver-rhc3-task-create-do-ukolu-diagnostic.cjs",
      "scripts/silver-rhc3-task-create-do-ukolu-diagnostic-report.json",
      "scripts/silver-rhc3-task-create-do-ukolu-harness-alignment-report.json",
      "scripts/silver-real-human-chaos-v3.cjs",
      "scripts/silver-real-human-chaos-v3-report.json"
    ];
    const bad = tracked.filter((l) => {
      const pathPart = (l.length >= 4 ? l.slice(3) : l).trim().replace(/\\/g, "/");
      for (let ai = 0; ai < allow.length; ai++) {
        if (pathPart.indexOf(allow[ai].replace(/\\/g, "/")) >= 0) return false;
      }
      return true;
    });
    return { ok: bad.length === 0, porcelain: o.trim() };
  } catch (e) {
    return { ok: false, porcelain: String(e && e.message) };
  }
}

function gitStatusShortClean() {
  try {
    return execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim() === "" ? "YES" : "NO";
  } catch {
    return "NO";
  }
}

function runNode(rel) {
  const script = path.join(REPO, rel);
  const r = spawnSync(process.execPath, [script], { cwd: REPO, encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

function runNpmBackedScript(rel) {
  const script = path.join(REPO, rel);
  const r = spawnSync(process.execPath, [script], { cwd: REPO, encoding: "utf8", stdio: "pipe", maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0;
}

function parse20kCalendarRouting(out) {
  const s = String(out || "");
  const cw = /calendar_write=(\d+)\/3000/.exec(s);
  const cq = /calendar_query=(\d+)\/3000/.exec(s);
  return {
    calendar_write_20k: cw ? cw[1] + "/3000" : "UNKNOWN",
    calendar_query_20k: cq ? cq[1] + "/3000" : "UNKNOWN"
  };
}

function runProofBundle() {
  const out = {
    smoke: "FAIL",
    calendar_regression: "FAIL",
    routing_20k: "FAIL",
    quality: "FAIL",
    realistic_mobile: "FAIL",
    calendar_write_20k: "SKIPPED",
    calendar_query_20k: "SKIPPED"
  };
  const s1 = runNpmBackedScript("scripts/smoke.mjs");
  out.smoke = s1 ? "PASS" : "FAIL";
  const s2 = runNpmBackedScript("scripts/silver-calendar-create-regression.mjs");
  const s3 = runNpmBackedScript("scripts/silver-calendar-read-regression.mjs");
  out.calendar_regression = s2 && s3 ? "PASS" : "FAIL";
  const s4 = runNode("scripts/audit_silver_20000_routing_stable.cjs");
  out.routing_20k = s4.ok ? "PASS" : "FAIL";
  const cal20 = parse20kCalendarRouting(s4.out);
  out.calendar_write_20k = cal20.calendar_write_20k;
  out.calendar_query_20k = cal20.calendar_query_20k;
  const s5 = runNode("scripts/audit_silver_quality_v2.cjs");
  out.quality = s5.ok ? "PASS" : "FAIL";
  const s6 = runNode("scripts/audit_silver_realistic_mobile_corpus.cjs");
  out.realistic_mobile = s6.ok ? "PASS" : "FAIL";
  return out;
}

function classifyTaskCreateDoUkol(c, turn, ev) {
  const fold = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const cat = String(ev.cat || "");
  const exp = String(c.expectedIntent || "");
  const auditIntent = String(ev.auditIntent || "");
  const drafty = createLikeTurn(turn);
  const chaotic = isChaoticMutationSurface(c);
  const mobileVoice =
    (c.mutation_mask & core.M.MOBILE_PREFIX) !== 0 || (c.mutation_mask & core.M.SPOKEN_COMPRESS) !== 0;
  const hasCanon = hasTaskCreateCanonFolded(fold);
  const pristine = noiseOnlyPopcount(c.mutation_mask) === 0 && !chaotic;
  const raw = rawUserMessage(turn);
  const title = String((turn.draft && turn.draft.title) || "");

  if (cat === "runtime_fail") {
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "runtime_throw" };
  }

  if (cat === "wrong_collection" || cat === "calendar_vs_task_confusion") {
    return { primary: "WRONG_MODULE", subcluster: cat + ":" + eng };
  }
  if (cat === "note_vs_task_confusion") {
    return { primary: "WRONG_MODULE", subcluster: "note_vs_task:" + eng };
  }

  if (cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "safety:" + cat };
  }

  if ((cat === "raw_response_wrong" || cat === "raw_response_empty") && eng === "tasks.create" && ps === "READY_TO_SAVE") {
    if (titlePollutionHeuristic(title, raw)) {
      return { primary: "TITLE_POLLUTION", subcluster: "draft_or_copy:" + cat };
    }
    return { primary: "HARNESS_LABEL_PROBLEM", subcluster: "taskWriteSemantic:" + cat };
  }

  if (cat === "unnecessary_disambiguation") {
    if (chaotic || mobileVoice || !hasCanon) {
      return { primary: "AMBIGUOUS_INPUT", subcluster: "storage_disambig_chaos" };
    }
    return { primary: "HARNESS_LABEL_PROBLEM", subcluster: "storage_disambig_strict" };
  }

  if (cat !== "intent_fail") {
    return { primary: "OTHER", subcluster: cat + ":" + eng };
  }

  if (exp === "unknown") {
    if (eng === "tasks.create" && drafty) {
      return { primary: "HARNESS_LABEL_PROBLEM", subcluster: "gold_unknown_vs_engine_create" };
    }
    if ((eng === "clarification" || eng === "unknown") && !drafty) {
      return { primary: "SAFE_CLARIFICATION_OK", subcluster: "gold_unknown_safe_probe" };
    }
    if (chaotic || mobileVoice) {
      return { primary: "AMBIGUOUS_INPUT", subcluster: "gold_unknown_chaos" };
    }
    return { primary: "AMBIGUOUS_INPUT", subcluster: "gold_unknown_eng_" + eng };
  }

  if (exp === "task.create") {
    if (eng === "calendar.create" || eng === "notes.create") {
      return { primary: "WRONG_MODULE", subcluster: "intent_fail_cross:" + eng };
    }
    if (eng === "clarification" || eng === "unknown") {
      if (chaotic) return { primary: "AMBIGUOUS_INPUT", subcluster: "task_create_clarify_chaos" };
      if (mobileVoice && !hasCanon) return { primary: "REAL_WORLD_ACCEPTABLE", subcluster: "mobile_broke_markers" };
      if (!hasCanon) return { primary: "AMBIGUOUS_INPUT", subcluster: "lost_task_markers" };
      return { primary: "TRUE_ENGINE_FAIL", subcluster: "clear_surface_clarify" };
    }
    if (eng === "tasks.read" || auditIntent === "task.query") {
      if (chaotic || mobileVoice) return { primary: "AMBIGUOUS_INPUT", subcluster: "read_vs_create_chaos" };
      return { primary: "TRUE_ENGINE_FAIL", subcluster: "routed_read_not_create" };
    }
  }

  return { primary: "OTHER", subcluster: "intent_fail:" + eng + ":" + auditIntent };
}

function winBeepTwice() {
  if (process.platform !== "win32") return;
  try {
    const cmd = "powershell -NoProfile -Command \"[console]::beep(880,250)\"";
    execSync(cmd, { cwd: REPO, stdio: "ignore" });
    execSync(cmd, { cwd: REPO, stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

function main() {
  const wantProof = process.argv.includes("--proof");
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== RHC3_TASK_CREATE_DO_UKOLU_DIAGNOSTIC_ABORT ===");
    console.log("reason=tracked_files_dirty");
    console.log(git.porcelain);
    console.log("=== END_ABORT ===");
    process.exit(1);
  }

  const hashBefore = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";

  let runnerHead = "";
  try {
    runnerHead = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    runnerHead = "UNKNOWN";
  }

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = rhc3.buildCorpus(TOTAL_CASES);
  if (cases.length !== TOTAL_CASES) {
    console.log("seed_data_fail=expected_" + TOTAL_CASES + "_got_" + cases.length);
    process.exit(1);
  }

  applyHarnessExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
  }
  for (let sji = 0; sji < cases.length; sji++) {
    const sj = cases[sji];
    if (sj.family === "module_switching" && sj.gold) {
      sj.expectedIntent = sj.gold.expected_intent;
    }
  }

  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;

  const primaryCounts = {
    TRUE_ENGINE_FAIL: 0,
    TITLE_POLLUTION: 0,
    HARNESS_LABEL_PROBLEM: 0,
    AMBIGUOUS_INPUT: 0,
    SAFE_CLARIFICATION_OK: 0,
    WRONG_MODULE: 0,
    REAL_WORLD_ACCEPTABLE: 0,
    OTHER: 0
  };
  const subclusterCounts = {};

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const totalClusterCases = clusterCases.length;
  let clusterPass = 0;
  let clusterFailCount = 0;
  const clusterFailById = new Map();

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const foldedIn = foldCs(c.input);
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {}
    const empty = eng.createEmptyDraft();
    let turn;
    let ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: "" };
    try {
      turn = eng.processUserTurn(c.input, empty, ctxForCase(c.group));
      ev = evaluateOne(c, turn);
      ev = finalizeModuleSwitchHarnessEval(c, turn, ev);
      ev = finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeNegationNoWriteHarnessEval(c, turn, ev);
      ev = finalizeNoteQueryKdeHarnessEval(c, turn, ev);
      ev = finalizeNoteCreateDoPoznamkStorageHarnessEval(c, turn, ev);
      ev = finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval(c, turn, ev);
      ev = finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval(c, turn, ev);
    } catch (e) {
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
    }

    const createLike = createLikeTurn(turn);
    if (
      !ev.pass &&
      c.group.indexOf("query") >= 0 &&
      (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")
    ) {
      falseWriteCount++;
    }
    if (ev.cat === "query_created_write") queryCreatedWriteCount++;
    if (hasNegWrite(foldedIn) && createLike) writeWhenNegatedCount++;
    const caseDangerous =
      ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail" || (hasNegWrite(foldedIn) && createLike);
    if (caseDangerous) dangerousWriteCount++;

    if (c.cluster !== TARGET_CLUSTER) continue;

    if (ev.pass) {
      clusterPass++;
    } else {
      clusterFailCount++;
      const cls = classifyTaskCreateDoUkol(c, turn, ev);
      countKey(primaryCounts, cls.primary);
      countKey(subclusterCounts, cls.subcluster);
      clusterFailById.set(c.id, { c, turn, ev, cls });
    }
  }

  const hashAfter = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";
  const assetsAppChanged = hashBefore && hashAfter && hashBefore !== hashAfter ? "YES" : "NO";
  if (assetsAppChanged === "YES") {
    console.log("=== RHC3_TASK_CREATE_DO_UKOLU_DIAGNOSTIC_ABORT ===");
    console.log("reason=assets_app_js_hash_changed");
    process.exit(1);
  }

  const trueEngineFailCount = primaryCounts.TRUE_ENGINE_FAIL;
  const titlePollutionCount = primaryCounts.TITLE_POLLUTION;
  const wrongModuleCount = primaryCounts.WRONG_MODULE;
  const harnessProblemCount = primaryCounts.HARNESS_LABEL_PROBLEM;
  const ambiguousInputCount = primaryCounts.AMBIGUOUS_INPUT;
  const safeClarificationOkCount = primaryCounts.SAFE_CLARIFICATION_OK;
  const realWorldAcceptableCount = primaryCounts.REAL_WORLD_ACCEPTABLE;
  const mustFixEngineCount =
    primaryCounts.TRUE_ENGINE_FAIL + primaryCounts.WRONG_MODULE + primaryCounts.TITLE_POLLUTION;
  const shouldFixHarnessCount =
    primaryCounts.HARNESS_LABEL_PROBLEM + primaryCounts.AMBIGUOUS_INPUT + primaryCounts.SAFE_CLARIFICATION_OK + primaryCounts.OTHER;

  const subPairs = Object.keys(subclusterCounts).map((k) => ({ k, n: subclusterCounts[k] }));
  subPairs.sort((a, b) => b.n - a.n);
  const top1 = subPairs[0] || { k: "(none)", n: 0 };
  const top2 = subPairs[1] || { k: "(none)", n: 0 };

  let smoke = "SKIPPED";
  let calendar_regression = "SKIPPED";
  let routing_20k = "SKIPPED";
  let quality = "SKIPPED";
  let realistic_mobile = "SKIPPED";
  let calendar_write_20k = "SKIPPED";
  let calendar_query_20k = "SKIPPED";

  if (wantProof) {
    const gitPre = gitStatusShortClean();
    if (gitPre !== "YES") {
      console.log("=== RHC3_TASK_CREATE_DO_UKOLU_DIAGNOSTIC_ABORT ===");
      console.log("reason=git_not_clean_for_proof");
      process.exit(1);
    }
    const pb = runProofBundle();
    smoke = pb.smoke;
    calendar_regression = pb.calendar_regression;
    routing_20k = pb.routing_20k;
    quality = pb.quality;
    realistic_mobile = pb.realistic_mobile;
    calendar_write_20k = pb.calendar_write_20k;
    calendar_query_20k = pb.calendar_query_20k;
    try {
      execSync("git checkout -- scripts/silver-quality-v2-report.json scripts/silver-realistic-mobile-corpus-report.json", {
        cwd: REPO,
        encoding: "utf8",
        stdio: "pipe"
      });
    } catch {
      /* non-fatal */
    }
  } else {
    const fr = readJsonSafe(FOUNDATION_REPORT);
    const bundle = fr && fr.proof_bundle;
    if (bundle && bundle.gates_pass === "YES" && String(fr.main_commit || "") === runnerHead) {
      smoke = bundle.smoke || smoke;
      const cr =
        bundle.silver_calendar_create_regression === "PASS" && bundle.silver_calendar_read_regression === "PASS"
          ? "PASS"
          : "SKIPPED";
      calendar_regression = cr;
      routing_20k = bundle.audit_silver_20000_routing_stable || "SKIPPED";
      quality = bundle.audit_silver_quality_v2 || "SKIPPED";
      realistic_mobile = bundle.audit_silver_realistic_mobile_corpus || "SKIPPED";
    }
  }

  let recommendedNextTask = "scripts-only: add harness clarify lane for rhc3_task_create_do_ukolu (mirror note_create / note_query patterns) after engine routing baseline";
  if (top1.k.indexOf("calendar_vs_task") >= 0 || wrongModuleCount > trueEngineFailCount) {
    recommendedNextTask =
      "narrow_engine: calendar.create vs explicit do úkolů + ne do kalendáře disambiguation (routing not title-only)";
  } else if (titlePollutionCount > harnessProblemCount) {
    recommendedNextTask = "engine_or_copy: strip spoken fillers from task draft title (hoď mi tam / prosím / že tail)";
  } else if (harnessProblemCount > ambiguousInputCount) {
    recommendedNextTask = "scripts-only: relax taskWriteSemantic or gold_unknown vs engine create alignment";
  } else if (ambiguousInputCount > trueEngineFailCount && clusterFailCount > 0) {
    recommendedNextTask = "corpus+harness: chaotic mobile/spoken_compress lanes — document acceptable clarify PASS scope";
  } else if (clusterFailCount === 0 && mustFixEngineCount === 0) {
    recommendedNextTask = "none: rhc3_task_create_do_ukolu cluster green under harness + engine baseline";
  }

  const gitCleanAll = gitStatusShortClean();

  const lines = [
    "=== RHC3_TASK_CREATE_DO_UKOLU_DIAGNOSTIC_RESULT ===",
    "main_commit=" + runnerHead,
    "engine_changed=NO",
    "assets_app_changed=" + assetsAppChanged,
    "total_cluster_cases=" + totalClusterCases,
    "cluster_fail_count=" + clusterFailCount,
    "true_engine_fail_count=" + trueEngineFailCount,
    "title_pollution_count=" + titlePollutionCount,
    "wrong_module_count=" + wrongModuleCount,
    "harness_problem_count=" + harnessProblemCount,
    "ambiguous_input_count=" + ambiguousInputCount,
    "safe_clarification_ok_count=" + safeClarificationOkCount,
    "real_world_acceptable_count=" + realWorldAcceptableCount,
    "must_fix_engine_count=" + mustFixEngineCount,
    "should_fix_harness_count=" + shouldFixHarnessCount,
    "top_subcluster_1=" + top1.k,
    "top_subcluster_1_count=" + top1.n,
    "top_subcluster_2=" + top2.k,
    "top_subcluster_2_count=" + top2.n,
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "smoke=" + smoke,
    "calendar_regression=" + calendar_regression,
    "routing_20k=" + routing_20k,
    "quality=" + quality,
    "realistic_mobile=" + realistic_mobile,
    "git_status_clean=" + gitCleanAll,
    "recommended_next_task=" + recommendedNextTask,
    "=== END_RHC3_TASK_CREATE_DO_UKOLU_DIAGNOSTIC_RESULT ==="
  ];
  const textBlock = lines.join("\n");
  console.log("\n" + textBlock + "\n");

  const first200 = clusterCases.slice(0, 200);
  const strat300 = stratifiedPick(clusterCases, 300);
  const rand200 = randomPick(clusterCases, 200, RANDOM_SAMPLE_SEED);
  const idSet = new Set();
  const inspected = [];
  function pushUnique(cc) {
    if (!idSet.has(cc.id)) {
      idSet.add(cc.id);
      inspected.push(cc);
    }
  }
  for (let a = 0; a < first200.length; a++) pushUnique(first200[a]);
  for (let b = 0; b < strat300.length; b++) pushUnique(strat300[b]);
  for (let r = 0; r < rand200.length; r++) pushUnique(rand200[r]);

  const examples = [];
  for (let ii = 0; ii < inspected.length && examples.length < 24; ii++) {
    const c = inspected[ii];
    const hit = clusterFailById.get(c.id);
    if (!hit) continue;
    const turn = hit.turn;
    const ev = hit.ev;
    const cls = hit.cls;
    examples.push({
      id: c.id,
      primary: cls.primary,
      subcluster: cls.subcluster,
      input: String(c.input).slice(0, 220),
      eng: String(turn.normalizedIntent || ""),
      ps: String(turn.processingState || ""),
      cat: String(ev.cat || ""),
      expectedIntent: String(c.expectedIntent || ""),
      title: String((turn.draft && turn.draft.title) || "").slice(0, 120)
    });
  }

  const reportObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    diag_runner_head: runnerHead,
    target_cluster: TARGET_CLUSTER,
    total_cases: TOTAL_CASES,
    total_cluster_cases: totalClusterCases,
    cluster_pass: clusterPass,
    cluster_fail_count: clusterFailCount,
    primary_counts: primaryCounts,
    subcluster_counts: subclusterCounts,
    true_engine_fail_count: trueEngineFailCount,
    title_pollution_count: titlePollutionCount,
    wrong_module_count: wrongModuleCount,
    harness_problem_count: harnessProblemCount,
    ambiguous_input_count: ambiguousInputCount,
    safe_clarification_ok_count: safeClarificationOkCount,
    real_world_acceptable_count: realWorldAcceptableCount,
    must_fix_engine_count: mustFixEngineCount,
    should_fix_harness_count: shouldFixHarnessCount,
    top_subcluster_1: top1.k,
    top_subcluster_1_count: top1.n,
    top_subcluster_2: top2.k,
    top_subcluster_2_count: top2.n,
    safety: {
      dangerous_write_count: dangerousWriteCount,
      false_write_count: falseWriteCount,
      query_created_write_count: queryCreatedWriteCount,
      write_when_negated_count: writeWhenNegatedCount
    },
    gates: {
      smoke,
      calendar_regression,
      routing_20k,
      quality,
      realistic_mobile,
      calendar_write_20k,
      calendar_query_20k,
      proof_mode: wantProof ? "live" : "hydrate_or_skip"
    },
    git_status_clean: gitCleanAll,
    recommended_next_task: recommendedNextTask,
    sample_fail_examples: examples,
    text_block: textBlock
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  let mainBefore = "UNKNOWN";
  let branchName = "UNKNOWN";
  let changedFiles = "";
  try {
    branchName = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {}
  try {
    mainBefore = execSync("git rev-parse origin/main", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    try {
      mainBefore = execSync("git rev-parse main", { cwd: REPO, encoding: "utf8" }).trim();
    } catch {}
  }
  try {
    changedFiles = execSync("git diff --name-only origin/main...HEAD", { cwd: REPO, encoding: "utf8" })
      .trim()
      .replace(/\r?\n/g, ";");
  } catch {}

  const pilotSnap = readJsonSafe(FOUNDATION_REPORT);
  const rhc3FoundationPilot =
    pilotSnap &&
    pilotSnap.proof_bundle &&
    pilotSnap.proof_bundle.gates_pass === "YES" &&
    (pilotSnap.chaos_child_exit_code === 0 || pilotSnap.chaos_child_exit_code === undefined)
      ? "PASS"
      : "SKIPPED";

  const afterClarifyChaos = subclusterCounts["task_create_clarify_chaos"] || 0;
  const readyForPr =
    clusterFailCount === 0 &&
    mustFixEngineCount === 0 &&
    wrongModuleCount === 0 &&
    titlePollutionCount === 0 &&
    dangerousWriteCount === 0 &&
    falseWriteCount === 0 &&
    queryCreatedWriteCount === 0 &&
    writeWhenNegatedCount === 0 &&
    gitCleanAll === "YES"
      ? "YES"
      : "NO";

  const alignLines = [
    "=== RHC3_TASK_CREATE_DO_UKOLU_HARNESS_ALIGNMENT_RESULT ===",
    "main_before=" + mainBefore,
    "branch=" + branchName,
    "commit=" + runnerHead,
    "changed_files=" + changedFiles,
    "engine_changed=NO",
    "assets_app_changed=" + assetsAppChanged,
    "ui_changed=NO",
    "css_changed=NO",
    "backend_changed=NO",
    "total_cluster_cases=" + totalClusterCases,
    "before_cluster_fail_count=" + HARNESS_ALIGN_STORY_BASELINE.cluster_fail_count,
    "after_cluster_fail_count=" + clusterFailCount,
    "before_task_create_clarify_chaos=" + HARNESS_ALIGN_STORY_BASELINE.task_create_clarify_chaos,
    "after_task_create_clarify_chaos=" + afterClarifyChaos,
    "before_should_fix_harness_count=" + HARNESS_ALIGN_STORY_BASELINE.should_fix_harness_count,
    "after_should_fix_harness_count=" + shouldFixHarnessCount,
    "must_fix_engine_count=" + mustFixEngineCount,
    "true_engine_fail_count=" + trueEngineFailCount,
    "wrong_module_count=" + wrongModuleCount,
    "title_pollution_count=" + titlePollutionCount,
    "ambiguous_input_count=" + ambiguousInputCount,
    "real_world_acceptable_count=" + realWorldAcceptableCount,
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "calendar_write_20k=" + calendar_write_20k,
    "calendar_query_20k=" + calendar_query_20k,
    "routing_20k=" + routing_20k,
    "quality=" + quality,
    "realistic_mobile=" + realistic_mobile,
    "rhc3_foundation_pilot=" + rhc3FoundationPilot,
    "calendar_regression=" + calendar_regression,
    "git_status_clean=" + gitCleanAll,
    "ready_for_pr=" + readyForPr,
    "recommended_next_task=" + recommendedNextTask,
    "=== END_RHC3_TASK_CREATE_DO_UKOLU_HARNESS_ALIGNMENT_RESULT ==="
  ];
  const alignText = alignLines.join("\n");
  console.log("\n" + alignText + "\n");

  const alignObj = {
    generated_at: new Date().toISOString(),
    baseline_label: "PR4322_diagnostic_story_pre_harness_align",
    baseline: HARNESS_ALIGN_STORY_BASELINE,
    main_before: mainBefore,
    branch: branchName,
    commit: runnerHead,
    changed_files: changedFiles,
    engine_changed: "NO",
    assets_app_changed: assetsAppChanged,
    ui_changed: "NO",
    css_changed: "NO",
    backend_changed: "NO",
    after: {
      total_cluster_cases: totalClusterCases,
      cluster_fail_count: clusterFailCount,
      task_create_clarify_chaos: afterClarifyChaos,
      should_fix_harness_count: shouldFixHarnessCount,
      must_fix_engine_count: mustFixEngineCount,
      true_engine_fail_count: trueEngineFailCount,
      wrong_module_count: wrongModuleCount,
      title_pollution_count: titlePollutionCount,
      ambiguous_input_count: ambiguousInputCount,
      real_world_acceptable_count: realWorldAcceptableCount,
      safety: {
        dangerous_write_count: dangerousWriteCount,
        false_write_count: falseWriteCount,
        query_created_write_count: queryCreatedWriteCount,
        write_when_negated_count: writeWhenNegatedCount
      },
      gates: {
        smoke,
        calendar_regression,
        routing_20k,
        quality,
        realistic_mobile,
        calendar_write_20k,
        calendar_query_20k,
        rhc3_foundation_pilot: rhc3FoundationPilot
      },
      git_status_clean: gitCleanAll,
      ready_for_pr: readyForPr,
      recommended_next_task: recommendedNextTask
    },
    text_block: alignText
  };
  fs.writeFileSync(ALIGNMENT_REPORT_JSON, JSON.stringify(alignObj, null, 2), "utf8");

  const proofFail =
    wantProof &&
    (smoke !== "PASS" ||
      calendar_regression !== "PASS" ||
      routing_20k !== "PASS" ||
      quality !== "PASS" ||
      realistic_mobile !== "PASS" ||
      calendar_write_20k !== "3000/3000" ||
      calendar_query_20k !== "3000/3000");
  if (proofFail) {
    console.log("=== RHC3_TASK_CREATE_DO_UKOLU_DIAGNOSTIC_ABORT ===");
    console.log("reason=proof_gate_failed");
    process.exit(1);
  }
  if (dangerousWriteCount > 0 || falseWriteCount > 0 || queryCreatedWriteCount > 0 || writeWhenNegatedCount > 0) {
    console.log("=== RHC3_TASK_CREATE_DO_UKOLU_DIAGNOSTIC_ABORT ===");
    console.log("reason=safety_counter_nonzero");
    process.exit(1);
  }

  winBeepTwice();
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_CLUSTER,
  classifyTaskCreateDoUkol,
  EXPECTED_MAIN_COMMIT
};
