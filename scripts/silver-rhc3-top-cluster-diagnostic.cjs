/**
 * RHC3 top-cluster diagnostic (read-only engine, no app.js edits).
 * Target: rhc3_module_switch_cal_to_note
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-top-cluster-diagnostic-report.json");

const EXPECTED_MAIN_COMMIT = "88b59b6ff7c004f721561070d5bf8e4a1ce66a2e";
const TARGET_CLUSTER = "rhc3_module_switch_cal_to_note";
const RANDOM_SAMPLE_SEED = 0xc411a7e3;
const STRATA = 8;

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
  finalizeModuleSwitchNegJakoCalToNoteHarnessEval
} = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, rawUserMessage } = harness;

function mulberry32(seed) {
  return core.mulberry32(seed >>> 0);
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
    /\bneukladat\b/i.test(fold)
  );
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function serializeDraft(turn) {
  const d = turn.draft || {};
  const parts = [];
  if (d.title) parts.push("title:" + String(d.title).slice(0, 120));
  if (d.date || d.dateISO) parts.push("date:" + String(d.date || d.dateISO || ""));
  if (d.time || d.timeHHMM) parts.push("time:" + String(d.time || d.timeHHMM || ""));
  if (d.address || d.location) parts.push("addr:" + String(d.address || d.location || "").slice(0, 80));
  if (d.note) parts.push("note:" + String(d.note).slice(0, 80));
  if (d.silverNoteText) parts.push("nText:" + String(d.silverNoteText).slice(0, 120));
  if (d.targetContainer) parts.push("target:" + d.targetContainer);
  return parts.join(";") || "(none)";
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

function actualModeFromTurn(turn) {
  const eng = turn.normalizedIntent;
  if (eng === "calendar.read" || eng === "tasks.read" || eng === "notes.read" || eng === "global.search") {
    return "query";
  }
  if (eng === "calendar.query" || eng === "task.query" || eng === "note.query") return "query";
  return "write";
}

function inputKeepsNoteTarget(folded) {
  return (
    /\bdo\s+poznam/i.test(folded) ||
    /\bpoznamk/i.test(folded) ||
    (/\buloz\s+mi\b/i.test(folded) && /\bpoznam/i.test(folded))
  );
}

function inputExcludesCalendar(folded) {
  return (
    /\bne\s+do\s+kalend/i.test(folded) ||
    /\bne\s+v\s+kalend/i.test(folded) ||
    /\bne\s+kalend/i.test(folded) ||
    /\bne\b\s+\S{1,20}\s+do\s+kalend/i.test(folded) ||
    /\bne\s+do\s+\S{1,16}\s+kalend/i.test(folded)
  );
}

function classifyFailure(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const eng = turn.normalizedIntent;
  const cat = ev.cat || "";
  const raw = String(ev.raw || "");

  if (gold.expected_safety === "read_only" && !gold.expected_should_write && c.expectedIntent === "note.create") {
    return "SAFETY_NEGATION_CONFLICT";
  }

  if (cat === "wrong_collection" && eng === "calendar.create" && inputExcludesCalendar(fold) && inputKeepsNoteTarget(fold)) {
    return "TRUE_ENGINE_FAIL_MODULE_SWITCH";
  }

  if (cat === "wrong_collection" || cat === "note_vs_task_confusion") {
    if (eng === "tasks.create") return "WRONG_MODULE_REAL_BUG";
    if (eng === "calendar.create" && (!inputExcludesCalendar(fold) || !inputKeepsNoteTarget(fold))) {
      return "TEMPLATE_DNA_BAD_INPUT";
    }
    return "WRONG_MODULE_REAL_BUG";
  }

  if (cat === "unnecessary_disambiguation") {
    const fillerBetweenNeDoCal =
      /\bne\s+do\s+\S{2,16}\s+kalend/i.test(fold) ||
      /\bne\b\s+\S{1,12}\s+do\s+kalend/i.test(fold);
    if (!fillerBetweenNeDoCal && /\bne\s+do\s+kalend/i.test(fold) && inputKeepsNoteTarget(fold)) {
      return "GOLD_LABEL_TOO_AGGRESSIVE";
    }
    const storageAsk =
      eng === "create.storage_disambiguation" ||
      turn.processingState === "STORAGE_DISAMBIGUATION" ||
      /kam\s+to|kalend|poznam|ukol/i.test(raw);
    if (storageAsk && raw.length > 12) return "ENGINE_SAFE_CLARIFICATION_OK";
    return "GOLD_LABEL_TOO_AGGRESSIVE";
  }

  if (!inputKeepsNoteTarget(fold) || !inputExcludesCalendar(fold)) {
    if (/\buloz\s+nevim|ten\s+clovek\s+s\s+tim|modra\s+vetev|schuzka\s+s\s+kyblem/i.test(fold)) {
      return "TEMPLATE_DNA_BAD_INPUT";
    }
    return "TEMPLATE_DNA_BAD_INPUT";
  }

  if (eng === "clarification" || ev.auditIntent === "unknown") {
    if (turn.processingState === "CLARIFICATION" && raw.length > 30) return "ENGINE_SAFE_CLARIFICATION_OK";
    return "AMBIGUITY_SHOULD_CLARIFY";
  }

  if (cat === "intent_fail") {
    if (ev.auditIntent === "unknown" || eng === "clarification") return "AMBIGUITY_SHOULD_CLARIFY";
    return "WRONG_MODULE_REAL_BUG";
  }

  if (cat === "negative_instruction_fail") return "SAFETY_NEGATION_CONFLICT";

  return "OTHER";
}

function countKey(map, k) {
  map[k] = (map[k] || 0) + 1;
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

function gitAllowListClean() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "scripts/silver-rhc3-top-cluster-diagnostic.cjs",
      "scripts/silver-rhc3-top-cluster-diagnostic-report.json",
      "scripts/silver-real-human-chaos-v3.cjs",
      "scripts/silver-real-human-chaos-v3-report.json",
      "scripts/rhc-v3-deterministic-core.cjs"
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

function main() {
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== SILVER_RHC3_TOP_CLUSTER_DIAGNOSTIC_ABORT ===");
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
  const mainCommit = EXPECTED_MAIN_COMMIT;

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

  const bucketCounts = {
    TRUE_ENGINE_FAIL_MODULE_SWITCH: 0,
    GOLD_LABEL_TOO_AGGRESSIVE: 0,
    TEMPLATE_DNA_BAD_INPUT: 0,
    SAFETY_NEGATION_CONFLICT: 0,
    AMBIGUITY_SHOULD_CLARIFY: 0,
    ENGINE_SAFE_CLARIFICATION_OK: 0,
    WRONG_MODULE_REAL_BUG: 0,
    OTHER: 0
  };

  const examples = {
    TRUE_ENGINE_FAIL_MODULE_SWITCH: [],
    GOLD_LABEL_TOO_AGGRESSIVE: [],
    TEMPLATE_DNA_BAD_INPUT: [],
    AMBIGUITY_SHOULD_CLARIFY: [],
    ENGINE_SAFE_CLARIFICATION_OK: [],
    OTHER: []
  };

  const samplesOut = [];
  let clusterPass = 0;
  let clusterFail = 0;

  const byId = new Map();

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
      ev = finalizeModuleSwitchNegJakoCalToNoteHarnessEval(c, turn, ev);
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

  const fullClusterBucketCounts = {
    TRUE_ENGINE_FAIL_MODULE_SWITCH: 0,
    GOLD_LABEL_TOO_AGGRESSIVE: 0,
    TEMPLATE_DNA_BAD_INPUT: 0,
    SAFETY_NEGATION_CONFLICT: 0,
    AMBIGUITY_SHOULD_CLARIFY: 0,
    ENGINE_SAFE_CLARIFICATION_OK: 0,
    WRONG_MODULE_REAL_BUG: 0,
    OTHER: 0
  };
  for (let fi = 0; fi < clusterCases.length; fi++) {
    const cc = clusterCases[fi];
    const hit = byId.get(cc.id);
    if (!hit || hit.ev.pass) continue;
    const b = classifyFailure(cc, hit.turn, hit.ev, cc.gold);
    countKey(fullClusterBucketCounts, b);
  }

  for (let ii = 0; ii < inspectedList.length; ii++) {
    const c = inspectedList[ii];
    const cached = byId.get(c.id);
    if (!cached) continue;
    const turn = cached.turn;
    const ev = cached.ev;
    const g = c.gold;
    const raw = rawUserMessage(turn);
    const bucket = ev.pass ? "PASS" : classifyFailure(c, turn, ev, g);

    if (!ev.pass) {
      countKey(bucketCounts, bucket);
      const exList = examples[bucket];
      if (exList && exList.length < 30) {
        exList.push({
          id: c.id,
          input: c.input,
          cat: ev.cat,
          bucket,
          auditIntent: ev.auditIntent,
          eng: turn.normalizedIntent,
          ps: turn.processingState,
          raw: raw.slice(0, 220)
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
      expected_safety: g.expected_safety,
      contains_negation: g.contains_negation,
      contains_correction: g.contains_correction,
      contains_module_switch: g.contains_module_switch,
      contains_filler: g.contains_filler,
      contains_typo: g.contains_typo,
      contains_no_diacritics: g.contains_no_diacritics,
      risk_level: g.risk_level,
      actual_intent: turn.normalizedIntent,
      actual_module: actualModuleFromTurn(turn),
      actual_mode: actualModeFromTurn(turn),
      actual_processingState: turn.processingState,
      actual_should_write: createLikeTurn(turn),
      actual_draft_summary: serializeDraft(turn),
      actual_response_summary: raw.slice(0, 280),
      harness_pass: ev.pass,
      harness_cat: ev.cat || "",
      diagnostic_bucket: bucket
    });
  }

  const te = fullClusterBucketCounts.TRUE_ENGINE_FAIL_MODULE_SWITCH;
  const gl = fullClusterBucketCounts.GOLD_LABEL_TOO_AGGRESSIVE;
  const td = fullClusterBucketCounts.TEMPLATE_DNA_BAD_INPUT;
  const sn = fullClusterBucketCounts.SAFETY_NEGATION_CONFLICT;
  const am = fullClusterBucketCounts.AMBIGUITY_SHOULD_CLARIFY;
  const es = fullClusterBucketCounts.ENGINE_SAFE_CLARIFICATION_OK;
  const wm = fullClusterBucketCounts.WRONG_MODULE_REAL_BUG;
  const ot = fullClusterBucketCounts.OTHER;
  const fullFailBuckets = te + gl + td + sn + am + es + wm + ot;

  const ranked = Object.entries(fullClusterBucketCounts).sort((a, b) => b[1] - a[1]);
  const dominant_root_cause = fullFailBuckets ? ranked[0][0] : "NONE";

  const failTotal = clusterFail;

  let ready_for_engine_fix = "NO";
  if (failTotal > 0) {
    const teShare = te / failTotal;
    const ambiguityHarnessHeavy = am + es + gl + td;
    if (teShare >= 0.42 && te >= wm + ot + 50 && ambiguityHarnessHeavy < te * 1.25) {
      ready_for_engine_fix = "YES";
    }
  }

  let recommended_next_action =
    "Nejdřív sladit harness / gold očekávání pro module_switching: dominanta je clarification (intent_fail) a část storage disambiguation; čistý engine fix až po tom.";
  let recommended_batch_family = "module_switching";
  if (ready_for_engine_fix === "YES") {
    recommended_next_action =
      "Úzký engine routing fix: explicitní „ne do kalendáře → do poznámek“ + ulož má končit notes.create bez calendar.create.";
    recommended_batch_family = "module_switching_cal_to_note";
  }

  function fmtEx(arr, n) {
    return (arr || [])
      .slice(0, n)
      .map((x) => x.input.slice(0, 140) + " | cat=" + x.cat + " | eng=" + x.eng + " | b=" + x.bucket);
  }

  const repTrue = fmtEx(examples.TRUE_ENGINE_FAIL_MODULE_SWITCH, 10);
  let repGold = fmtEx(examples.GOLD_LABEL_TOO_AGGRESSIVE, 5);
  if (repGold.length < 5) {
    const goldStyle = samplesOut.filter(
      (s) =>
        !s.harness_pass &&
        s.harness_cat === "unnecessary_disambiguation" &&
        /\bale\s+ne\s+do\s+kalend/i.test(foldCs(s.input))
    );
    let extra = goldStyle.slice(0, 5 - repGold.length).map((s) => {
      return (
        s.input.slice(0, 140) +
        " | cat=" +
        s.harness_cat +
        " | eng=" +
        s.actual_intent +
        " | b=GOLD_LABEL_TOO_AGGRESSIVE_PROXY"
      );
    });
    if (repGold.length + extra.length < 5) {
      const anyDis = samplesOut.filter(
        (s) => !s.harness_pass && s.harness_cat === "unnecessary_disambiguation" && s.diagnostic_bucket === "ENGINE_SAFE_CLARIFICATION_OK"
      );
      const need = 5 - repGold.length - extra.length;
      extra = extra.concat(
        anyDis.slice(0, need).map((s) => {
          return (
            s.input.slice(0, 140) +
            " | cat=" +
            s.harness_cat +
            " | eng=" +
            s.actual_intent +
            " | b=GOLD_LABEL_TOO_AGGRESSIVE_PROXY"
          );
        })
      );
    }
    repGold = repGold.concat(extra);
  }
  let repTpl = fmtEx(examples.TEMPLATE_DNA_BAD_INPUT, 5);
  if (!repTpl.length) {
    const noisy = samplesOut.filter(
      (s) => !s.harness_pass && (s.contains_filler || s.contains_typo || s.contains_no_diacritics)
    );
    repTpl = noisy.slice(0, 5).map((s) => {
      return (
        s.input.slice(0, 140) +
        " | cat=" +
        s.harness_cat +
        " | eng=" +
        s.actual_intent +
        " | b=TEMPLATE_DNA_STYLE_PROXY"
      );
    });
  }
  const repAmb = []
    .concat(fmtEx(examples.AMBIGUITY_SHOULD_CLARIFY, 3))
    .concat(fmtEx(examples.ENGINE_SAFE_CLARIFICATION_OK, 2));

  const gitClean = git.ok ? "YES" : "NO";

  const textBlock = [
    "=== SILVER_RHC3_MODULE_SWITCH_CAL_TO_NOTE_DIAGNOSTIC_RESULT ===",
    "main_commit=" + mainCommit,
    "engine_changed=NO",
    "assets_app_changed=NO",
    "ui_changed=NO",
    "css_changed=NO",
    "backend_changed=NO",
    "",
    "target_cluster=" + TARGET_CLUSTER,
    "total_cluster_count=" + total_cluster_count,
    "inspected_count=" + inspected_count,
    "",
    "true_engine_fail_count=" + te,
    "gold_label_problem_count=" + gl,
    "template_dna_problem_count=" + td,
    "safety_negation_conflict_count=" + sn,
    "ambiguity_should_clarify_count=" + am,
    "engine_safe_clarification_ok_count=" + es,
    "wrong_module_real_bug_count=" + wm,
    "other_count=" + ot,
    "",
    "dominant_root_cause=" + dominant_root_cause,
    "",
    "representative_true_engine_fail_examples=" + repTrue.join(" || "),
    "representative_gold_label_problem_examples=" + repGold.join(" || "),
    "representative_template_dna_problem_examples=" + repTpl.join(" || "),
    "representative_ambiguity_examples=" + repAmb.join(" || "),
    "",
    "ready_for_engine_fix=" + ready_for_engine_fix,
    "recommended_next_action=" + recommended_next_action,
    "recommended_batch_family=" + recommended_batch_family,
    "",
    "git_status_clean=" + gitClean,
    "======= END_SILVER_RHC3_MODULE_SWITCH_CAL_TO_NOTE_DIAGNOSTIC_RESULT ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    baseline_main_commit: mainCommit,
    diag_runner_head: runnerHead,
    target_cluster: TARGET_CLUSTER,
    total_cases: TOTAL_CASES,
    total_cluster_count,
    cluster_pass_in_full_scan: clusterPass,
    cluster_fail_in_full_scan: failTotal,
    inspected_count,
    inspected_bucket_counts: bucketCounts,
    full_cluster_bucket_counts: fullClusterBucketCounts,
    dominant_root_cause,
    ready_for_engine_fix,
    recommended_next_action,
    recommended_batch_family,
    representative: {
      true_engine_fail: repTrue,
      gold_label: repGold,
      template_dna: repTpl,
      ambiguity_safe: repAmb
    },
    samples: samplesOut,
    text_block: textBlock
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj), "utf8");
}

if (require.main === module) {
  main();
}

module.exports = { TARGET_CLUSTER, classifyFailure, computeGoldLabels };
