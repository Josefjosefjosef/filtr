/**
 * RHC3 cluster diagnostic (read-only): rhc3_retrieval_fuzzy_note_read (retrieval_fuzzy_notes).
 * Splits failures into engine vs harness vs retrieval vs gold-boundary buckets. No engine edits; no assets/app.js.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-retrieval-fuzzy-note-read-diagnostic-report.json");

/** User MAIN baseline for STOP-SHIP diff checks (tree must match for engine bundle paths). */
const EXPECTED_MAIN_COMMIT = "7e5daa036eb7f6a83dec251f4f34140f84883101";

const TARGET_CLUSTER = "rhc3_retrieval_fuzzy_note_read";
const RANDOM_SAMPLE_SEED = 0x72686333;

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
  rawUserMessage,
  cardType,
  hasNegWrite
} = harness;

const TITLE_POLLUTION_RE =
  /\b(hele|prosim|prosím|pockej|počkej|vlastne|vlastně|\bno\b|ehm|jako|prost[eě]|ee|echo|tyjo|no\s+jo)\b/i;

const WRONG_MODULE_CATS = new Set([
  "wrong_collection",
  "note_vs_task_confusion",
  "calendar_vs_task_confusion",
  "query_wrong_dataset"
]);

function mulberry32(seed) {
  return core.mulberry32(seed >>> 0);
}

function popcount(mask, onlyBits) {
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
  if (popcount(mask, noiseMask) >= 3) return true;
  if ((mask & core.M.NEGATION_OVERLAY) !== 0) return true;
  if ((mask & core.M.AMBIGUITY_OVERLAY) !== 0) return true;
  return false;
}

function hasRetrievalFuzzyTripleCueFolded(fold) {
  const f = String(fold || "");
  return (
    /\bpoznam|not(e|a)\b/i.test(f) &&
    /\b(mrkni|koukni|hledej|najdi)\b/i.test(f) &&
    /\bnic\s+neuklad/i.test(f)
  );
}

function templateRetrievalBroken(c, fold) {
  const f = String(fold || "");
  if (String(c.input || "").length < 12) return true;
  if (!/\bpoznam|not(e|a)\b/i.test(f)) return true;
  return !hasRetrievalFuzzyTripleCueFolded(f);
}

function ambiguousCrossModuleRetrievalFolded(fold) {
  const f = String(fold || "");
  if (/\bpoznam|not(e|a)\b/i.test(f)) return false;
  return /\b(ukol|úkol|kalend|schuz|udalost|termin)\b/i.test(f);
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function actualModuleFromTurn(turn) {
  const d = turn.draft || {};
  if (d.targetContainer) return d.targetContainer;
  const eng = turn.normalizedIntent;
  if (eng === "calendar.create" || eng === "calendar.read") return "calendar";
  if (eng === "tasks.create" || eng === "tasks.read") return "tasks";
  if (eng === "notes.create" || eng === "notes.read") return "notes";
  return "";
}

function engineRouteLabel(turn) {
  const eng = String(turn.normalizedIntent || "");
  if (eng === "notes.read") return "notes.read";
  if (eng === "global.search") return "global.search";
  if (eng === "clarification") return "clarification";
  if (eng === "unknown") return "unknown";
  if (eng === "notes.create") return "notes.create";
  if (eng.indexOf("calendar") === 0) return eng;
  if (eng.indexOf("tasks") === 0) return eng;
  return eng || "(empty)";
}

function topicAppearsInRawFolded(topic, rawFolded) {
  const t = String(topic || "").trim();
  if (!t) return false;
  const tf = foldCs(t);
  if (tf.length < 2) return false;
  return String(rawFolded || "").indexOf(tf) >= 0;
}

function readinessLabel(turn) {
  if (turn && turn.readiness != null && String(turn.readiness).trim()) return String(turn.readiness).trim();
  const ps = String(turn.processingState || "");
  const ni = String(turn.normalizedIntent || "");
  return ps && ni ? ps + "/" + ni : ps || ni || "";
}

/**
 * Exclusive failure bucket (sums to cluster_fail_count).
 * @returns {keyof typeof BUCKET_KEYS}
 */
function classifyRetrievalFuzzyExclusive(c, turn, ev) {
  const fold = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const cat = String(ev.cat || "");
  const raw = rawUserMessage(turn);
  const createLike = createLikeTurn(turn);

  if (cat === "runtime_fail") return "TRUE_ENGINE_FAIL";
  if (cat === "query_created_write") return "QUERY_CREATED_WRITE";
  if (cat === "negative_instruction_fail") return "TRUE_ENGINE_FAIL";
  if (cat === "write_when_negated") return "TRUE_ENGINE_FAIL";
  if (WRONG_MODULE_CATS.has(cat)) return "WRONG_MODULE";
  if (cat === "false_negative") return "RETRIEVAL_MISS";
  if (cat === "raw_response_empty") {
    if (createLike) return "QUERY_CREATED_WRITE";
    if (eng === "notes.read" || eng === "global.search") return "RETRIEVAL_MISS";
    return "TRUE_ENGINE_FAIL";
  }
  if (cat === "unnecessary_disambiguation") return "TRUE_ENGINE_FAIL";
  if (cat === "intent_fail") {
    if (createLike) return "QUERY_CREATED_WRITE";
    if (eng === "clarification" || eng === "unknown") {
      if (templateRetrievalBroken(c, fold)) return "HARNESS_GOLD_PROBLEM";
      if (ambiguousCrossModuleRetrievalFolded(fold)) return "AMBIGUOUS_INPUT";
      if (isChaoticMutationSurface(c) && hasRetrievalFuzzyTripleCueFolded(fold)) return "SAFE_CLARIFICATION_OK";
      if (isChaoticMutationSurface(c) && String(raw).length >= 48) return "REAL_WORLD_ACCEPTABLE";
      return "NOTE_READ_VS_QUERY_GOLD_BOUNDARY";
    }
    if (eng.indexOf("calendar") === 0 || eng.indexOf("tasks") === 0) return "WRONG_MODULE";
    if (eng === "notes.read" || eng === "global.search") return "NOTE_READ_VS_QUERY_GOLD_BOUNDARY";
    return "TRUE_ENGINE_FAIL";
  }
  return "TRUE_ENGINE_FAIL";
}

function countKey(map, k) {
  map[k] = (map[k] || 0) + 1;
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

function gitAllowListClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "scripts/silver-rhc3-retrieval-fuzzy-note-read-diagnostic.cjs",
      "scripts/silver-rhc3-retrieval-fuzzy-note-read-diagnostic-report.json"
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

function gitDiffQuiet(commit, relPath) {
  const r = spawnSync("git", ["diff", "--quiet", commit, "--", relPath], { cwd: REPO, encoding: "utf8" });
  return r.status === 0;
}

function beepTwice() {
  const cmd = "[console]::beep(880,250)";
  spawnSync("powershell", ["-NoProfile", "-Command", cmd], { cwd: REPO, stdio: "ignore" });
  spawnSync("powershell", ["-NoProfile", "-Command", cmd], { cwd: REPO, stdio: "ignore" });
}

function main() {
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== RHC3_RETRIEVAL_FUZZY_NOTE_READ_DIAGNOSTIC_ABORT ===");
    console.log("reason=tracked_files_dirty");
    console.log(git.porcelain);
    console.log("=== END_ABORT ===");
    process.exit(1);
  }

  let runnerHead = "";
  try {
    runnerHead = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    runnerHead = "UNKNOWN";
  }

  const appJsPath = "assets/app.js";
  const auditPath = "scripts/audit_silver_realistic_mobile_corpus.cjs";
  const corePath = "scripts/rhc-v3-deterministic-core.cjs";

  const assets_app_changed = gitDiffQuiet(EXPECTED_MAIN_COMMIT, appJsPath) ? "NO" : "YES";
  const audit_changed = gitDiffQuiet(EXPECTED_MAIN_COMMIT, auditPath) ? "NO" : "YES";
  const core_changed = gitDiffQuiet(EXPECTED_MAIN_COMMIT, corePath) ? "NO" : "YES";
  const engine_changed = assets_app_changed === "YES" || audit_changed === "YES" || core_changed === "YES" ? "YES" : "NO";

  if (assets_app_changed === "YES" || engine_changed === "YES") {
    console.log("=== RHC3_RETRIEVAL_FUZZY_NOTE_READ_DIAGNOSTIC_ABORT ===");
    console.log("reason=engine_or_assets_tree_mismatch_vs_expected_main");
    console.log("expected_main_commit=" + EXPECTED_MAIN_COMMIT);
    console.log("assets_app_changed=" + assets_app_changed);
    console.log("audit_changed=" + audit_changed);
    console.log("core_changed=" + core_changed);
    console.log("=== END_ABORT ===");
    process.exit(1);
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

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const total_cluster_cases = clusterCases.length;

  const first200 = clusterCases.slice(0, 200);
  const strat300 = stratifiedPick(clusterCases, 300);
  const rand200 = randomPick(clusterCases, 200, RANDOM_SAMPLE_SEED);
  const idSet = new Set();
  const inspectedList = [];
  function pushUnique(c) {
    if (!idSet.has(c.id)) {
      idSet.add(c.id);
      inspectedList.push(c);
    }
  }
  for (let a = 0; a < first200.length; a++) pushUnique(first200[a]);
  for (let b = 0; b < strat300.length; b++) pushUnique(strat300[b]);
  for (let r = 0; r < rand200.length; r++) pushUnique(rand200[r]);
  const inspected_count = inspectedList.length;

  const byId = new Map();
  let clusterPass = 0;
  let clusterFail = 0;

  let dangerous_write_count = 0;
  let false_write_count = 0;
  let query_created_write_cluster = 0;
  let write_when_negated_count = 0;

  const subclusterCounts = {};

  for (let i = 0; i < clusterCases.length; i++) {
    const c = clusterCases[i];
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
      clusterFail++;
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
      byId.set(c.id, { c, turn, ev });
      const ex = classifyRetrievalFuzzyExclusive(c, turn, ev);
      countKey(subclusterCounts, ex + "|runtime_fail");
      continue;
    }

    const foldedIn = foldCs(c.input);
    const createLike = createLikeTurn(turn);
    if (
      !ev.pass &&
      c.group.indexOf("query") >= 0 &&
      (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")
    ) {
      false_write_count++;
    }
    if (ev.cat === "query_created_write") query_created_write_cluster++;
    if (hasNegWrite(foldedIn) && createLike) write_when_negated_count++;
    const caseDangerous =
      ev.cat === "query_created_write" ||
      ev.cat === "negative_instruction_fail" ||
      (hasNegWrite(foldedIn) && createLike);
    if (caseDangerous) dangerous_write_count++;

    if (ev.pass) clusterPass++;
    else {
      clusterFail++;
      const ex = classifyRetrievalFuzzyExclusive(c, turn, ev);
      const sk = ex + "|cat=" + String(ev.cat || "") + "|eng=" + String(turn.normalizedIntent || "");
      countKey(subclusterCounts, sk);
    }
    byId.set(c.id, { c, turn, ev });
  }

  const buckets = {
    TRUE_ENGINE_FAIL: 0,
    RETRIEVAL_MISS: 0,
    WRONG_MODULE: 0,
    NOTE_READ_VS_QUERY_GOLD_BOUNDARY: 0,
    HARNESS_GOLD_PROBLEM: 0,
    SAFE_CLARIFICATION_OK: 0,
    AMBIGUOUS_INPUT: 0,
    REAL_WORLD_ACCEPTABLE: 0,
    QUERY_CREATED_WRITE: 0
  };

  for (let fi = 0; fi < clusterCases.length; fi++) {
    const cc = clusterCases[fi];
    const hit = byId.get(cc.id);
    if (!hit || hit.ev.pass) continue;
    const b = classifyRetrievalFuzzyExclusive(cc, hit.turn, hit.ev);
    buckets[b]++;
  }

  const true_engine_fail_count = buckets.TRUE_ENGINE_FAIL;
  const retrieval_miss_count = buckets.RETRIEVAL_MISS;
  const wrong_module_count = buckets.WRONG_MODULE;
  const note_read_vs_query_gold_boundary_count = buckets.NOTE_READ_VS_QUERY_GOLD_BOUNDARY;
  const harness_problem_count = buckets.HARNESS_GOLD_PROBLEM;
  const safe_clarification_ok_count = buckets.SAFE_CLARIFICATION_OK;
  const ambiguous_input_count = buckets.AMBIGUOUS_INPUT;
  const real_world_acceptable_count = buckets.REAL_WORLD_ACCEPTABLE;
  const query_created_write_count = buckets.QUERY_CREATED_WRITE;

  const must_fix_engine_count =
    true_engine_fail_count + wrong_module_count + retrieval_miss_count + query_created_write_count;
  const should_fix_harness_count =
    harness_problem_count +
    note_read_vs_query_gold_boundary_count +
    safe_clarification_ok_count +
    ambiguous_input_count +
    real_world_acceptable_count;

  let title_pollution_count = 0;
  for (let ti = 0; ti < clusterCases.length; ti++) {
    const cc = clusterCases[ti];
    const hit = byId.get(cc.id);
    if (!hit || hit.ev.pass) continue;
    const d = hit.turn.draft || {};
    const titleStr = String(d.title || "");
    if (titleStr && TITLE_POLLUTION_RE.test(foldCs(titleStr))) title_pollution_count++;
  }

  const rankedSub = Object.entries(subclusterCounts).sort((a, b) => b[1] - a[1]);
  const top1 = rankedSub[0] || ["NONE", 0];
  const top2 = rankedSub[1] || ["NONE", 0];
  const top3 = rankedSub[2] || ["NONE", 0];

  const dominant = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
  const dominantKey = clusterFail && dominant ? dominant[0] : "NONE";

  let selected_next_action = "Hold engine work; validate harness slices vs retrieval_fuzzy_notes gold first.";
  let recommended_next_task =
    "scripts-only: extend silver-real-human-chaos-v3 harness for retrieval_fuzzy_notes (safe clarification lane) before any assets/app.js change.";

  if (dominantKey === "RETRIEVAL_MISS" || dominantKey === "TRUE_ENGINE_FAIL" || dominantKey === "WRONG_MODULE") {
    selected_next_action =
      "Engine-side: improve notes retrieval/read path for fuzzy \"Mrkni do poznámek … nic neukládej\" (notes.read vs global.search) and response grounding to expected_query_topic.";
    recommended_next_task =
      "Follow-up engine PR: note read/search ranking + empty-read handling; re-run this diagnostic until RETRIEVAL_MISS and TRUE_ENGINE_FAIL drop.";
  } else if (dominantKey === "HARNESS_GOLD_PROBLEM" || dominantKey === "NOTE_READ_VS_QUERY_GOLD_BOUNDARY") {
    selected_next_action =
      "Harness/gold: align retrieval_fuzzy_notes expectations with legitimate clarification on broken templates or strict note.query vs read-card states.";
    recommended_next_task =
      "scripts/silver-real-human-chaos-v3.cjs harness tuning for retrieval_fuzzy_notes cluster (no routing rewrite in assets/app.js in same batch).";
  } else if (dominantKey === "SAFE_CLARIFICATION_OK" || dominantKey === "REAL_WORLD_ACCEPTABLE") {
    selected_next_action =
      "Treat dominant fails as acceptable clarification/UX variance under chaos mutations; widen harness PASS lanes before engine edits.";
    recommended_next_task =
      "Add finalizeRetrievalFuzzyHarnessEval (mirror note_query_kde lane) scoped to rhc3_retrieval_fuzzy_note_read only.";
  } else if (dominantKey === "AMBIGUOUS_INPUT") {
    selected_next_action =
      "Split ambiguous mutated inputs into a dedicated cluster or gold=unknown; avoid engine retrieval fixes until template DNA is separated.";
    recommended_next_task =
      "Template/mask audit in rhc-v3-deterministic-core.cjs for cross-module bleed on retrieval_fuzzy_notes.";
  } else if (dominantKey === "QUERY_CREATED_WRITE") {
    selected_next_action =
      "P0: stop-ship pattern — note query path must not create READY_TO_SAVE notes.create; fix engine create guard (out of scope for this scripts-only diagnostic).";
    recommended_next_task =
      "Isolate query_created_write repro slices from this report JSON samples; engine PR separate from harness tuning.";
  }

  const exclusiveSum =
    true_engine_fail_count +
    retrieval_miss_count +
    wrong_module_count +
    note_read_vs_query_gold_boundary_count +
    harness_problem_count +
    safe_clarification_ok_count +
    ambiguous_input_count +
    real_world_acceptable_count +
    query_created_write_count;

  if (exclusiveSum !== clusterFail) {
    console.log("internal_bucket_sum_mismatch=expected_" + clusterFail + "_got_" + exclusiveSum);
    process.exit(1);
  }

  function gitStatusCleanAllowOnlyDiagnosticFiles() {
    try {
      const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
      const lines = o.split(/\r?\n/).filter(Boolean);
      const allow = [
        "scripts/silver-rhc3-retrieval-fuzzy-note-read-diagnostic.cjs",
        "scripts/silver-rhc3-retrieval-fuzzy-note-read-diagnostic-report.json"
      ];
      for (let i = 0; i < lines.length; i++) {
        const pathPart = (lines[i].length >= 4 ? lines[i].slice(3) : lines[i]).trim().replace(/\\/g, "/");
        let hit = false;
        for (let j = 0; j < allow.length; j++) {
          if (pathPart === allow[j] || pathPart.indexOf(allow[j]) >= 0) {
            hit = true;
            break;
          }
        }
        if (!hit) return "NO";
      }
      return "YES";
    } catch {
      return "NO";
    }
  }

  const gitClean = gitAllowListClean().ok && gitStatusCleanAllowOnlyDiagnosticFiles() === "YES" ? "YES" : "NO";

  const textBlock = [
    "=== RHC3_RETRIEVAL_FUZZY_NOTE_READ_DIAGNOSTIC_RESULT ===",
    "",
    "main_commit=" + runnerHead,
    "engine_changed=" + engine_changed,
    "assets_app_changed=" + assets_app_changed,
    "",
    "total_cluster_cases=" + total_cluster_cases,
    "cluster_fail_count=" + clusterFail,
    "",
    "true_engine_fail_count=" + true_engine_fail_count,
    "retrieval_miss_count=" + retrieval_miss_count,
    "wrong_module_count=" + wrong_module_count,
    "note_read_vs_query_gold_boundary_count=" + note_read_vs_query_gold_boundary_count,
    "harness_problem_count=" + harness_problem_count,
    "safe_clarification_ok_count=" + safe_clarification_ok_count,
    "ambiguous_input_count=" + ambiguous_input_count,
    "real_world_acceptable_count=" + real_world_acceptable_count,
    "must_fix_engine_count=" + must_fix_engine_count,
    "should_fix_harness_count=" + should_fix_harness_count,
    "query_created_write_count=" + query_created_write_count,
    "title_pollution_count=" + title_pollution_count,
    "",
    "top_subcluster_1=" + top1[0],
    "top_subcluster_1_count=" + top1[1],
    "top_subcluster_2=" + top2[0],
    "top_subcluster_2_count=" + top2[1],
    "top_subcluster_3=" + top3[0],
    "top_subcluster_3_count=" + top3[1],
    "",
    "selected_next_action=" + selected_next_action,
    "recommended_next_task=" + recommended_next_task,
    "",
    "dangerous_write_count=" + dangerous_write_count,
    "false_write_count=" + false_write_count,
    "query_created_write_count=" + query_created_write_cluster,
    "write_when_negated_count=" + write_when_negated_count,
    "",
    "git_status_clean=" + gitClean,
    "",
    "=== END_RHC3_RETRIEVAL_FUZZY_NOTE_READ_DIAGNOSTIC_RESULT ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const samplesOut = [];
  const examples = {};
  const bucketKeys = Object.keys(buckets);
  for (let bi = 0; bi < bucketKeys.length; bi++) examples[bucketKeys[bi]] = [];

  for (let ii = 0; ii < inspectedList.length; ii++) {
    const c = inspectedList[ii];
    const cached = byId.get(c.id);
    if (!cached) continue;
    const turn = cached.turn;
    const ev = cached.ev;
    const g = c.gold;
    const raw = rawUserMessage(turn);
    const rawF = foldCs(raw);
    const topic = String((g && g.expected_query_topic) || "");
    const bucket = ev.pass ? "PASS" : classifyRetrievalFuzzyExclusive(c, turn, ev);

    if (!ev.pass) {
      const exList = examples[bucket];
      if (exList && exList.length < 24) {
        exList.push({
          id: c.id,
          input: c.input,
          cat: ev.cat || "",
          bucket,
          expectedIntent: c.expectedIntent,
          auditIntent: ev.auditIntent || "",
          eng: turn.normalizedIntent,
          topic_in_raw: topicAppearsInRawFolded(topic, rawF),
          raw: raw.slice(0, 220)
        });
      }
    }

    samplesOut.push({
      id: c.id,
      input: c.input,
      family: c.family,
      cluster: c.cluster,
      expected_intent: c.expectedIntent,
      expected_query_topic: topic,
      gold_expected_module: g.expected_module,
      gold_expected_should_write: g.expected_should_write,
      gold_expected_should_clarify: g.expected_should_clarify,
      gold_contains_filler: g.contains_filler,
      gold_contains_retrieval: g.contains_retrieval,
      topic_missing_in_user_fold: topic ? foldCs(c.input).indexOf(foldCs(topic)) < 0 : true,
      mutation_mask: c.mutation_mask,
      actual_intent: turn.normalizedIntent,
      actual_auditIntent: ev.auditIntent || "",
      actual_processingState: turn.processingState,
      readiness: readinessLabel(turn),
      cardKind: cardType(turn),
      engine_route_label: engineRouteLabel(turn),
      actual_module: actualModuleFromTurn(turn),
      harness_pass: ev.pass,
      harness_cat: ev.cat || "",
      diagnostic_bucket: bucket,
      topic_grounded_in_response: topic ? topicAppearsInRawFolded(topic, rawF) : null
    });
  }

  const reportObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    diag_runner_head: runnerHead,
    target_cluster: TARGET_CLUSTER,
    total_cases: TOTAL_CASES,
    total_cluster_cases,
    cluster_pass_in_full_scan: clusterPass,
    cluster_fail_in_full_scan: clusterFail,
    inspected_count,
    engine_changed,
    assets_app_changed,
    buckets_exclusive: buckets,
    must_fix_engine_count,
    should_fix_harness_count,
    title_pollution_count,
    safety_counters: {
      dangerous_write_count,
      false_write_count,
      query_created_write_count: query_created_write_cluster,
      write_when_negated_count
    },
    dominant_exclusive_bucket: dominantKey,
    top_subclusters: rankedSub.slice(0, 12),
    selected_next_action,
    recommended_next_task,
    representative_examples: examples,
    samples: samplesOut,
    text_block: textBlock
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  beepTwice();
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_CLUSTER,
  EXPECTED_MAIN_COMMIT,
  classifyRetrievalFuzzyExclusive
};
