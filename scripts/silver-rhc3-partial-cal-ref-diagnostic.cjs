/**
 * RHC3 cluster diagnostic: rhc3_partial_cal_ref (partial temporal calendar queries; no engine/app.js edits).
 * Buckets: true calendar read/reference vs harness/gold vs template DNA vs ambiguous partial ref vs safe clarification vs wrong module.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-partial-cal-ref-diagnostic-report.json");

const PINNED_MAIN_COMMIT = "9f62e564257c6bf981f546ecbef6481011cdb3c4";
const TARGET_CLUSTER = "rhc3_partial_cal_ref";
const RANDOM_SAMPLE_SEED = 0x50415254;
const STRATA = 8;

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();

const core = require("./rhc-v3-deterministic-core.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const { computeGoldLabels, finalizeModuleSwitchHarnessEval, finalizeModuleSwitchClarifyLaneHarnessEval, finalizeNegationNoWriteHarnessEval, finalizeNoteQueryKdeHarnessEval } = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, rawUserMessage } = harness;

function mulberry32(seed) {
  return core.mulberry32(seed >>> 0);
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

function partialRefNoisePopcount(mask) {
  const noiseMask =
    core.M.FILLER_PREFIX |
    core.M.FILLER_SUFFIX |
    core.M.HESITATION |
    core.M.MOBILE_PREFIX |
    core.M.SPOKEN_COMPRESS |
    core.M.EMOTIONAL |
    core.M.TYPO_LITE |
    core.M.STRIP_DIACRITICS;
  return popcountMask(mask >>> 0, noiseMask >>> 0);
}

function hasVagueTemporalFold(fold) {
  const f = String(fold || "");
  return /\b(tenkrat|nekdy\s+ten\s+den|tamto|kdysi|v\s+tom\s+tydnu)\b/i.test(f);
}

function partialRefTemplateHealthy(fold) {
  const f = String(fold || "");
  return /\bv\s+kalend/i.test(f) && /\bkolem\b/i.test(f) && /\bco\s+(jsem|mas|mame)\b/i.test(f);
}

function hasVagueTemporalRaw(input) {
  const s = String(input || "").toLowerCase();
  return (
    /\btenkrát\b/.test(s) ||
    /\bněkdy\s+ten\s+den\b/.test(s) ||
    /\btamto\b/.test(s) ||
    /\bkdysi\b/.test(s) ||
    /\bv\s+tom\s+týdnu\b/.test(s)
  );
}

/**
 * @returns {string} diagnostic bucket key matching report counters
 */
function classifyPartialCalRef(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const cat = String(ev.cat || "");
  const eng = String(turn.normalizedIntent || "");
  const drafty = createLikeTurn(turn);
  const noise = partialRefNoisePopcount(c.mutation_mask || 0);

  if (cat === "runtime_fail") return "OTHER";

  if (
    cat === "query_wrong_dataset" ||
    cat === "calendar_vs_task_confusion" ||
    cat === "wrong_collection" ||
    cat === "note_vs_task_confusion"
  ) {
    return "WRONG_MODULE";
  }

  if (!partialRefTemplateHealthy(fold) || String(c.input || "").length < 14) {
    return "TEMPLATE_DNA_BAD_INPUT";
  }

  if (
    cat === "query_created_write" ||
    cat === "negative_instruction_fail" ||
    cat === "write_when_negated" ||
    cat === "wrong_person_match"
  ) {
    return "TRUE_CALENDAR_REFERENCE_FAIL";
  }

  if (cat === "unnecessary_disambiguation") {
    return "GOLD_LABEL_TOO_STRICT";
  }

  if (cat === "raw_response_empty") {
    if (hasVagueTemporalFold(fold) || hasVagueTemporalRaw(c.input)) return "AMBIGUOUS_PARTIAL_REFERENCE";
    if (noise >= 2) return "SAFE_CLARIFICATION_OK";
    return "TRUE_CALENDAR_REFERENCE_FAIL";
  }

  if (cat === "false_negative") {
    if (hasVagueTemporalFold(fold) || hasVagueTemporalRaw(c.input)) return "AMBIGUOUS_PARTIAL_REFERENCE";
    if (noise >= 2) return "GOLD_LABEL_TOO_STRICT";
    return "TRUE_CALENDAR_REFERENCE_FAIL";
  }

  if (cat === "intent_fail") {
    if (drafty) return "TRUE_CALENDAR_REFERENCE_FAIL";
    if (eng === "clarification" || eng === "unknown") {
      if (hasVagueTemporalFold(fold) || hasVagueTemporalRaw(c.input)) return "AMBIGUOUS_PARTIAL_REFERENCE";
      if (noise >= 2) return "SAFE_CLARIFICATION_OK";
      return "GOLD_LABEL_TOO_STRICT";
    }
    return "TRUE_CALENDAR_REFERENCE_FAIL";
  }

  return "OTHER";
}

function stratifiedPick(arr, want) {
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

function gitAllowListClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "scripts/silver-rhc3-partial-cal-ref-diagnostic.cjs",
      "scripts/silver-rhc3-partial-cal-ref-diagnostic-report.json"
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

function fmtExMini(arr, n) {
  return (arr || [])
    .slice(0, n)
    .map((x) => (x.input || "").slice(0, 130) + " | cat=" + x.cat + " | eng=" + x.eng + " | b=" + x.bucket);
}

function main() {
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== SILVER_RHC3_PARTIAL_CAL_REF_DIAGNOSTIC_ABORT ===");
    console.log("reason=tracked_files_dirty");
    console.log(git.porcelain);
    console.log("==== END_ABORT ====");
    process.exit(1);
  }

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

  const clusterCases = cases.filter((c) => c.cluster === TARGET_CLUSTER);
  const total_cluster_count = clusterCases.length;

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

  const fullBuckets = {
    TRUE_CALENDAR_REFERENCE_FAIL: 0,
    SAFE_CLARIFICATION_OK: 0,
    GOLD_LABEL_TOO_STRICT: 0,
    TEMPLATE_DNA_BAD_INPUT: 0,
    AMBIGUOUS_PARTIAL_REFERENCE: 0,
    WRONG_MODULE: 0,
    OTHER: 0
  };

  const inspectBuckets = Object.assign({}, fullBuckets);
  const examples = {
    TRUE_CALENDAR_REFERENCE_FAIL: [],
    SAFE_CLARIFICATION_OK: [],
    GOLD_LABEL_TOO_STRICT: [],
    TEMPLATE_DNA_BAD_INPUT: [],
    AMBIGUOUS_PARTIAL_REFERENCE: [],
    WRONG_MODULE: [],
    OTHER: []
  };

  const byId = new Map();
  let clusterPass = 0;
  let clusterFail = 0;

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
    } catch (e) {
      clusterFail++;
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
      byId.set(c.id, { c, turn, ev });
      continue;
    }
    if (ev.pass) clusterPass++;
    else clusterFail++;
    byId.set(c.id, { c, turn, ev });
  }

  for (let fi = 0; fi < clusterCases.length; fi++) {
    const cc = clusterCases[fi];
    const hit = byId.get(cc.id);
    if (!hit || hit.ev.pass) continue;
    const b = classifyPartialCalRef(cc, hit.turn, hit.ev, cc.gold);
    countKey(fullBuckets, b);
  }

  const samplesOut = [];

  for (let ii = 0; ii < inspectedList.length; ii++) {
    const c = inspectedList[ii];
    const cached = byId.get(c.id);
    if (!cached) continue;
    const turn = cached.turn;
    const ev = cached.ev;
    const g = c.gold;
    const raw = rawUserMessage(turn);
    const bucket = ev.pass ? "PASS" : classifyPartialCalRef(c, turn, ev, g);

    if (!ev.pass) {
      countKey(inspectBuckets, bucket);
      const list = examples[bucket];
      if (list && list.length < 40) {
        list.push({
          id: c.id,
          input: c.input,
          cat: ev.cat || "",
          bucket,
          eng: turn.normalizedIntent
        });
      }
    }

    samplesOut.push({
      id: c.id,
      input: c.input,
      family: c.family,
      cluster: c.cluster,
      expected_module: g.expected_module,
      expected_intent: g.expected_intent,
      expected_should_write: g.expected_should_write,
      expected_should_clarify: g.expected_should_clarify,
      mutation_mask: c.mutation_mask,
      partial_ref_noise_popcount: partialRefNoisePopcount(c.mutation_mask || 0),
      has_vague_temporal_fold: hasVagueTemporalFold(foldCs(c.input)),
      actual_intent: turn.normalizedIntent,
      harness_pass: ev.pass,
      harness_cat: ev.cat || "",
      diagnostic_bucket: bucket
    });
  }

  const tc = fullBuckets.TRUE_CALENDAR_REFERENCE_FAIL;
  const sc = fullBuckets.SAFE_CLARIFICATION_OK;
  const gl = fullBuckets.GOLD_LABEL_TOO_STRICT;
  const tp = fullBuckets.TEMPLATE_DNA_BAD_INPUT;
  const ap = fullBuckets.AMBIGUOUS_PARTIAL_REFERENCE;
  const wm = fullBuckets.WRONG_MODULE;
  const ot = fullBuckets.OTHER;
  const fullFailSum = tc + sc + gl + tp + ap + wm + ot;

  const ranked = Object.entries(fullBuckets).sort((a, b) => b[1] - a[1]);
  const dominant_root_cause = clusterFail ? ranked[0][0] : "NONE";

  const failTotal = clusterFail;
  const harnessOrSpecDominated = sc + gl + tp + ap >= tc * 1.1;
  let ready_for_engine_fix = "NO";
  if (failTotal > 0) {
    const tcShare = tc / failTotal;
    if (tcShare >= 0.48 && tc >= 150 && !harnessOrSpecDominated && dominant_root_cause === "TRUE_CALENDAR_REFERENCE_FAIL") {
      ready_for_engine_fix = "YES";
    }
  }

  let recommended_next_action =
    "Review dominant bucket: if AMBIGUOUS_PARTIAL_REFERENCE or GOLD_LABEL_TOO_STRICT leads, adjust calendar_query harness / gold for open-ended partial time windows before engine changes.";
  let recommended_batch_family = "partial_references";
  if (ready_for_engine_fix === "YES") {
    recommended_next_action =
      "Targeted engine PR for calendar.read/query: fix routing or response contract on partial temporal calendar lookups after harness sign-off.";
    recommended_batch_family = "partial_references_cal_scope";
  } else if (dominant_root_cause === "AMBIGUOUS_PARTIAL_REFERENCE") {
    recommended_next_action =
      "Treat as spec/harness: vague Czech temporal anchors (tenkrát, kdysi, …) conflict with strict calendar.query PASS; prefer harness relaxation or gold expected_should_clarify lane.";
  } else if (dominant_root_cause === "TEMPLATE_DNA_BAD_INPUT") {
    recommended_next_action =
      "Template DNA / mutation surface: verify rhc3_partial_cal_ref base string + applyMutationLayers preserve kolem … v kalendáři cues.";
  } else if (dominant_root_cause === "WRONG_MODULE") {
    recommended_next_action =
      "Wrong collection routing: inspect tasks/notes bleed on calendar_query group before calendar engine semantics.";
  } else if (dominant_root_cause === "SAFE_CLARIFICATION_OK" || dominant_root_cause === "GOLD_LABEL_TOO_STRICT") {
    recommended_next_action =
      "Harness/gold alignment: noisy partial_references surfaces may warrant clarification acceptance like note_query_kde lane.";
  }

  const gitClean = git.ok ? "YES" : "NO";

  const textBlock = [
    "=== SILVER_RHC3_PARTIAL_CAL_REF_DIAGNOSTIC_RESULT ===",
    "",
    "main_commit=" + PINNED_MAIN_COMMIT,
    "engine_changed=NO",
    "assets_app_changed=NO",
    "ui_changed=NO",
    "css_changed=NO",
    "backend_changed=NO",
    "",
    "target_cluster=" + TARGET_CLUSTER,
    "total_cluster_count=" + total_cluster_count,
    "fail_count=" + failTotal,
    "inspected_count=" + inspected_count,
    "",
    "true_calendar_reference_fail_count=" + tc,
    "safe_clarification_ok_count=" + sc,
    "gold_label_too_strict_count=" + gl,
    "template_dna_bad_input_count=" + tp,
    "ambiguous_partial_reference_count=" + ap,
    "wrong_module_count=" + wm,
    "other_count=" + ot,
    "",
    "dominant_root_cause=" + dominant_root_cause,
    "ready_for_engine_fix=" + ready_for_engine_fix,
    "recommended_next_action=" + recommended_next_action,
    "recommended_batch_family=" + recommended_batch_family,
    "",
    "git_status_clean=" + gitClean,
    "======= END_SILVER_RHC3_PARTIAL_CAL_REF_DIAGNOSTIC_RESULT ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    pinned_main_commit: PINNED_MAIN_COMMIT,
    diag_runner_head: runnerHead,
    full_fail_bucket_sum: fullFailSum,
    representative: {
      true_calendar_reference_fail: fmtExMini(examples.TRUE_CALENDAR_REFERENCE_FAIL, 10),
      ambiguous_partial_reference: fmtExMini(examples.AMBIGUOUS_PARTIAL_REFERENCE, 5),
      gold_label_too_strict: fmtExMini(examples.GOLD_LABEL_TOO_STRICT, 5),
      template_dna_bad_input: fmtExMini(examples.TEMPLATE_DNA_BAD_INPUT, 5),
      wrong_module: fmtExMini(examples.WRONG_MODULE, 5)
    },
    target_cluster: TARGET_CLUSTER,
    total_cases: TOTAL_CASES,
    total_cluster_count,
    fail_count: failTotal,
    cluster_pass_in_full_scan: clusterPass,
    inspected_count,
    inspected_bucket_counts: inspectBuckets,
    full_cluster_bucket_counts: fullBuckets,
    dominant_root_cause,
    ready_for_engine_fix,
    recommended_next_action,
    recommended_batch_family,
    samples: samplesOut,
    text_block: textBlock
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
}

if (require.main === module) {
  main();
}

module.exports = { TARGET_CLUSTER, classifyPartialCalRef };
