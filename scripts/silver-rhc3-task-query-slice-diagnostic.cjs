/**
 * RHC3 cluster diagnostic (read-only): rhc3_task_query_slice (task_query_chaos).
 * No engine edits; no assets/app.js changes.
 * Buckets: TRUE_ENGINE_FAIL, RETRIEVAL_MISS, WRONG_MODULE, HARNESS_LABEL_PROBLEM,
 * AMBIGUOUS_INPUT, SAFE_CLARIFICATION_OK, REAL_WORLD_ACCEPTABLE, OTHER.
 * Optional --proof: smoke, calendar regressions, 20k routing, quality v2, realistic mobile (requires clean git).
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync, spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP_JS = path.join(REPO, "assets", "app.js");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-task-query-slice-diagnostic-report.json");
const FOUNDATION_REPORT = path.join(__dirname, "silver-rhc-v3-foundation-pilot-report.json");

/** Baseline reference (user story); runner prints live HEAD in text block. */
const EXPECTED_MAIN_COMMIT = "2af5f755566b5dafef1b8f98ab33617e8e1625f3";

const TARGET_CLUSTER = "rhc3_task_query_slice";
const RANDOM_SAMPLE_SEED = 0x74736b71;

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

function popcountMask(mask, onlyBits) {
  let x = (mask >>> 0) & (onlyBits >>> 0);
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
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

function isMobileOrSpokenSurface(c) {
  const mask = (c.mutation_mask || 0) >>> 0;
  return (mask & core.M.MOBILE_PREFIX) !== 0 || (mask & core.M.SPOKEN_COMPRESS) !== 0;
}

function hasPartialRefSurface(c) {
  return ((c.mutation_mask || 0) >>> 0 & core.M.PARTIAL_REF) !== 0;
}

/** Folded: task-list query DNA ("co mám … úkol", "ohledně", "ukaž úkoly" style tails). */
function hasTaskQueryCueFolded(fold) {
  const f = String(fold || "");
  const listCue =
    /\b(co|jak(e|é))\s+m(am|ame)\b/i.test(f) ||
    /\buka(z|ž)\b/i.test(f) ||
    /\bnajd(i|it)\b/i.test(f) ||
    /\bseznam\b/i.test(f) ||
    /\bmrkni\b/i.test(f);
  const taskCue = /\bukol/i.test(f);
  const scopeCue = /\bohledn/i.test(f) || /\bkolem\b/i.test(f) || /\bohledne\b/i.test(f);
  return taskCue && (listCue || scopeCue);
}

function hasRelationshipEntityCueFolded(fold) {
  const f = String(fold || "");
  return (
    /\bpravn/i.test(f) ||
    /\badvokat/i.test(f) ||
    /\bzavolat\b/i.test(f) ||
    /\bs\s+nekym\b/i.test(f) ||
    /\bkoupit\b/i.test(f) ||
    /\bmlik/i.test(f)
  );
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
      "scripts/silver-rhc3-task-query-slice-diagnostic.cjs",
      "scripts/silver-rhc3-task-query-slice-diagnostic-report.json"
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

/**
 * Mutually exclusive primary + subcluster for rhc3_task_query_slice fails.
 * @returns {{ primary: string, subcluster: string }}
 */
function classifyTaskQuerySlice(c, turn, ev) {
  const fold = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const cat = String(ev.cat || "");
  const auditIntent = String(ev.auditIntent || "");
  const exp = String(c.expectedIntent || "");
  const drafty = createLikeTurn(turn);
  const chaotic = isChaoticMutationSurface(c);
  const mobileVoice = isMobileOrSpokenSurface(c);
  const raw = rawUserMessage(turn);

  if (cat === "runtime_fail") {
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "runtime_throw" };
  }

  if (
    cat === "wrong_collection" ||
    cat === "calendar_vs_task_confusion" ||
    cat === "note_vs_task_confusion"
  ) {
    return { primary: "WRONG_MODULE", subcluster: cat + ":" + eng };
  }

  if (cat === "query_wrong_dataset") {
    return { primary: "WRONG_MODULE", subcluster: "query_wrong_dataset:" + eng };
  }

  if (cat === "query_created_write") {
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "query_created_write:" + eng };
  }

  if (cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "safety:" + cat };
  }

  if (cat === "raw_response_empty") {
    const readLike =
      eng === "tasks.read" ||
      eng === "global.search" ||
      (eng === "notes.read" && auditIntent === "note.query");
    if (readLike && !drafty) {
      return { primary: "RETRIEVAL_MISS", subcluster: "empty_answer:" + eng + ":" + ps };
    }
    return { primary: "TRUE_ENGINE_FAIL", subcluster: "raw_empty_non_read:" + eng };
  }

  if (cat === "unnecessary_disambiguation") {
    return { primary: "HARNESS_LABEL_PROBLEM", subcluster: "storage_disambig_on_query" };
  }

  if (cat !== "intent_fail") {
    return { primary: "OTHER", subcluster: cat + ":" + eng + ":" + auditIntent };
  }

  if (exp === "unknown") {
    if (eng === "clarification" || eng === "unknown") {
      return { primary: "SAFE_CLARIFICATION_OK", subcluster: "gold_unknown_clarify_probe" };
    }
    if (drafty) {
      return { primary: "TRUE_ENGINE_FAIL", subcluster: "gold_unknown_but_create" };
    }
    return { primary: "AMBIGUOUS_INPUT", subcluster: "gold_unknown_eng_" + eng };
  }

  if (exp === "task.query") {
    if (drafty) {
      return { primary: "TRUE_ENGINE_FAIL", subcluster: "query_surface_routed_to_create" };
    }

    if (eng === "clarification" || eng === "unknown" || auditIntent === "unknown") {
      if (chaotic && !hasTaskQueryCueFolded(fold)) {
        return { primary: "AMBIGUOUS_INPUT", subcluster: "lost_task_query_markers" };
      }
      if (chaotic && hasTaskQueryCueFolded(fold)) {
        return { primary: "SAFE_CLARIFICATION_OK", subcluster: "task_query_clarify_chaos_ok" };
      }
      if (mobileVoice && !hasTaskQueryCueFolded(fold)) {
        return { primary: "REAL_WORLD_ACCEPTABLE", subcluster: "mobile_voice_lost_markers" };
      }
      if (mobileVoice && hasTaskQueryCueFolded(fold)) {
        return { primary: "SAFE_CLARIFICATION_OK", subcluster: "mobile_voice_safe_probe" };
      }
      if (hasPartialRefSurface(c) || !hasTaskQueryCueFolded(fold)) {
        return { primary: "AMBIGUOUS_INPUT", subcluster: "partial_or_weak_task_query_surface" };
      }
      if (hasRelationshipEntityCueFolded(fold) && /\bohledn/i.test(fold)) {
        return { primary: "HARNESS_LABEL_PROBLEM", subcluster: "relationship_entity_strict_clarify" };
      }
      return { primary: "HARNESS_LABEL_PROBLEM", subcluster: "clear_surface_should_route_read" };
    }

    if (
      auditIntent === "calendar.query" ||
      eng === "calendar.read" ||
      eng === "calendar.create" ||
      auditIntent === "note.query" ||
      eng === "notes.read" ||
      eng === "notes.create"
    ) {
      return { primary: "WRONG_MODULE", subcluster: "intent_fail_cross:" + eng + ":" + auditIntent };
    }

    return { primary: "TRUE_ENGINE_FAIL", subcluster: "intent_fail_residual:" + eng + ":" + auditIntent };
  }

  return { primary: "OTHER", subcluster: "unexpected_exp:" + exp + ":" + eng };
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
    console.log("=== RHC3_TASK_QUERY_SLICE_DIAGNOSTIC_ABORT ===");
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
    RETRIEVAL_MISS: 0,
    WRONG_MODULE: 0,
    HARNESS_LABEL_PROBLEM: 0,
    AMBIGUOUS_INPUT: 0,
    SAFE_CLARIFICATION_OK: 0,
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
      const cls = classifyTaskQuerySlice(c, turn, ev);
      countKey(primaryCounts, cls.primary);
      countKey(subclusterCounts, cls.subcluster);
      clusterFailById.set(c.id, { c, turn, ev, cls });
    }
  }

  const hashAfter = fs.existsSync(APP_JS) ? sha256File(APP_JS) : "";
  const assetsAppChanged = hashBefore && hashAfter && hashBefore !== hashAfter ? "YES" : "NO";
  if (assetsAppChanged === "YES") {
    console.log("=== RHC3_TASK_QUERY_SLICE_DIAGNOSTIC_ABORT ===");
    console.log("reason=assets_app_js_hash_changed");
    process.exit(1);
  }

  const trueEngineFailCount = primaryCounts.TRUE_ENGINE_FAIL;
  const retrievalMissCount = primaryCounts.RETRIEVAL_MISS;
  const wrongModuleCount = primaryCounts.WRONG_MODULE;
  const harnessProblemCount = primaryCounts.HARNESS_LABEL_PROBLEM;
  const ambiguousInputCount = primaryCounts.AMBIGUOUS_INPUT;
  const safeClarificationOkCount = primaryCounts.SAFE_CLARIFICATION_OK;
  const realWorldAcceptableCount = primaryCounts.REAL_WORLD_ACCEPTABLE;

  const mustFixEngineCount = trueEngineFailCount + retrievalMissCount + wrongModuleCount;
  const shouldFixHarnessCount =
    harnessProblemCount + ambiguousInputCount + safeClarificationOkCount + realWorldAcceptableCount + primaryCounts.OTHER;

  const subPairs = Object.keys(subclusterCounts).map((k) => ({ k, n: subclusterCounts[k] }));
  subPairs.sort((a, b) => b.n - a.n);
  const top1 = subPairs[0] || { k: "(none)", n: 0 };
  const top2 = subPairs[1] || { k: "(none)", n: 0 };
  const top3 = subPairs[2] || { k: "(none)", n: 0 };

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
      console.log("=== RHC3_TASK_QUERY_SLICE_DIAGNOSTIC_ABORT ===");
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

  let recommendedNextTask =
    "scripts-only: add task_query clarify lane (mirror note_query_kde) for chaotic but marker-locked „úkoly/ohledně“ surfaces; then re-run diagnostic.";
  if (trueEngineFailCount > safeClarificationOkCount * 4 && wrongModuleCount === 0 && retrievalMissCount === 0) {
    recommendedNextTask =
      "engine_routing: dominant fails are intent_fail with create-like draft on task_query_chaos — treat as read-vs-create routing bug (ne zápis); verify before any broad harness relax.";
  }
  if (wrongModuleCount > trueEngineFailCount + retrievalMissCount) {
    recommendedNextTask =
      "engine_routing: reduce calendar.read / notes.read misroutes on task_query_chaos (cross-module dotazy úkol vs kalendář vs poznámky).";
  } else if (retrievalMissCount > harnessProblemCount && retrievalMissCount > ambiguousInputCount) {
    recommendedNextTask =
      "engine_retrieval: tasks.read / global.search empty or off-topic answers for seeded task snapshots (nic nenašel / wrong card).";
  } else if (queryCreatedWriteCount > 0) {
    recommendedNextTask = "engine_safety: block tasks.create from pure task_query group without explicit create verb.";
  } else if (harnessProblemCount > ambiguousInputCount) {
    recommendedNextTask =
      "scripts-only: relax taskQuerySemantic / gold alignment for relationship-entity „ohledně právník“ reads or clear-surface clarify.";
  } else if (ambiguousInputCount > trueEngineFailCount && clusterFailCount > 0) {
    recommendedNextTask =
      "corpus+harness: document PASS scope for partial entity / no-diacritics / spoken_compress task query chaos.";
  } else if (clusterFailCount === 0 && mustFixEngineCount === 0) {
    recommendedNextTask = "none: rhc3_task_query_slice cluster green under harness + engine baseline.";
  }

  const gitCleanAll = gitStatusShortClean();

  const lines = [
    "=== RHC3_TASK_QUERY_SLICE_DIAGNOSTIC_RESULT ===",
    "main_commit=" + runnerHead,
    "engine_changed=NO",
    "assets_app_changed=" + assetsAppChanged,
    "total_cluster_cases=" + totalClusterCases,
    "cluster_fail_count=" + clusterFailCount,
    "true_engine_fail_count=" + trueEngineFailCount,
    "retrieval_miss_count=" + retrievalMissCount,
    "wrong_module_count=" + wrongModuleCount,
    "harness_problem_count=" + harnessProblemCount,
    "ambiguous_input_count=" + ambiguousInputCount,
    "safe_clarification_ok_count=" + safeClarificationOkCount,
    "real_world_acceptable_count=" + realWorldAcceptableCount,
    "must_fix_engine_count=" + mustFixEngineCount,
    "should_fix_harness_count=" + shouldFixHarnessCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "top_subcluster_1=" + top1.k,
    "top_subcluster_1_count=" + top1.n,
    "top_subcluster_2=" + top2.k,
    "top_subcluster_2_count=" + top2.n,
    "top_subcluster_3=" + top3.k,
    "top_subcluster_3_count=" + top3.n,
    "smoke=" + smoke,
    "calendar_regression=" + calendar_regression,
    "routing_20k=" + routing_20k,
    "quality=" + quality,
    "realistic_mobile=" + realistic_mobile,
    "git_status_clean=" + gitCleanAll,
    "recommended_next_task=" + recommendedNextTask,
    "=== END_RHC3_TASK_QUERY_SLICE_DIAGNOSTIC_RESULT ==="
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
  for (let ii = 0; ii < inspected.length && examples.length < 28; ii++) {
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
      auditIntent: String(ev.auditIntent || ""),
      raw_head: String(rawUserMessage(turn)).slice(0, 160)
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
    retrieval_miss_count: retrievalMissCount,
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
    top_subcluster_3: top3.k,
    top_subcluster_3_count: top3.n,
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
    console.log("=== RHC3_TASK_QUERY_SLICE_DIAGNOSTIC_ABORT ===");
    console.log("reason=proof_gate_failed");
    process.exit(1);
  }
  if (dangerousWriteCount > 0 || falseWriteCount > 0 || queryCreatedWriteCount > 0 || writeWhenNegatedCount > 0) {
    console.log("=== RHC3_TASK_QUERY_SLICE_DIAGNOSTIC_ABORT ===");
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
  classifyTaskQuerySlice,
  EXPECTED_MAIN_COMMIT
};
