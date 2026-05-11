/**
 * RHC3 cluster diagnostic: rhc3_negation_cal_readonly (read-only engine; no app.js edits).
 * Buckets: engine negation breach vs harness/gold/template vs safe clarification vs wrong module read.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-negation-cal-readonly-diagnostic-report.json");

const PINNED_MAIN_COMMIT = "bff646c9cbc3a9d28173d475644d874f88d44d54";
const TARGET_CLUSTER = "rhc3_negation_cal_readonly";
const RANDOM_SAMPLE_SEED = 0x4e656761;
const STRATA = 8;

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.RHC_V3_TOTAL_CASES || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
})();

const core = require("./rhc-v3-deterministic-core.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");
const { computeGoldLabels, finalizeModuleSwitchHarnessEval } = rhc3;
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

function serializeDraftBrief(turn) {
  const d = turn.draft || {};
  const parts = [];
  if (d.title) parts.push("title:" + String(d.title).slice(0, 100));
  if (d.date || d.dateISO) parts.push("date:" + String(d.date || d.dateISO || ""));
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

function hasReadableReadonlyCue(fold) {
  const f = String(fold || "");
  return (
    /\bnic\s+neuklad/i.test(f) ||
    /\bnic\s+nevytv/i.test(f) ||
    /\bpouze\s+cti\b/i.test(f) ||
    /\bjen\s+se\s+podivej/i.test(f) ||
    (/\bmrkni\b/i.test(f) && /\bkalend/i.test(f)) ||
    (/\bhledej\b/i.test(f) && /\bkalend/i.test(f))
  );
}

function templateDnaLikelyBroken(c, fold) {
  const f = String(fold || "");
  if (!/\bkalend/i.test(f) && !/\bschuz/i.test(f) && !/\budalost/i.test(f)) return true;
  if (String(c.input || "").length < 14) return true;
  if (!/\bnic\b/i.test(f) && !/\bneuklad/i.test(f) && !/\bnevytv/i.test(f) && !/\bmrkni\b/i.test(f)) return true;
  return false;
}

/**
 * @returns {string} diagnostic bucket key matching report counters
 */
function classifyNegationCalReadonly(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const drafty = createLikeTurn(turn);
  const cat = String(ev.cat || "");
  const auditIntent = String(ev.auditIntent || "");

  if (cat === "runtime_fail") return "OTHER";

  if (drafty && gold && !gold.expected_should_write && gold.expected_safety === "read_only") {
    return "TRUE_ENGINE_FAIL_NEGATION";
  }
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return "TRUE_ENGINE_FAIL_NEGATION";
  }

  if (cat === "wrong_collection" || cat === "calendar_vs_task_confusion" || cat === "note_vs_task_confusion") {
    if (!drafty) return "WRONG_MODULE_READ";
    return "TRUE_ENGINE_FAIL_NEGATION";
  }

  if (cat === "query_wrong_dataset") {
    if (!drafty) return "WRONG_MODULE_READ";
    return "TRUE_ENGINE_FAIL_NEGATION";
  }

  if (
    cat === "false_negative" ||
    cat === "wrong_person_match" ||
    cat === "raw_response_empty" ||
    cat === "unnecessary_disambiguation"
  ) {
    if (!drafty) return "SAFE_READ_OK_BUT_HARNESS_FAIL";
    return "TRUE_ENGINE_FAIL_NEGATION";
  }

  if (cat === "intent_fail") {
    if (drafty) return "TRUE_ENGINE_FAIL_NEGATION";
    if (
      eng === "tasks.read" ||
      eng === "tasks.create" ||
      eng === "notes.read" ||
      eng === "notes.create" ||
      eng === "calendar.create"
    ) {
      if (!drafty) return "WRONG_MODULE_READ";
      return "TRUE_ENGINE_FAIL_NEGATION";
    }
    if (eng === "clarification" || eng === "unknown" || auditIntent === "unknown") {
      if (templateDnaLikelyBroken(c, fold) && !hasReadableReadonlyCue(fold)) {
        return "TEMPLATE_DNA_BAD_INPUT";
      }
      if (!hasReadableReadonlyCue(fold)) {
        return "SAFE_CLARIFICATION_OK";
      }
      if (isChaoticMutationSurface(c)) {
        return "GOLD_LABEL_TOO_STRICT";
      }
      return "GOLD_LABEL_TOO_STRICT";
    }
    if (templateDnaLikelyBroken(c, fold) && !hasReadableReadonlyCue(fold)) {
      return "TEMPLATE_DNA_BAD_INPUT";
    }
    return "GOLD_LABEL_TOO_STRICT";
  }

  if (!drafty && templateDnaLikelyBroken(c, fold) && hasReadableReadonlyCue(fold) === false && isChaoticMutationSurface(c)) {
    return "TEMPLATE_DNA_BAD_INPUT";
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
      "scripts/silver-rhc3-negation-cal-readonly-diagnostic.cjs",
      "scripts/silver-rhc3-negation-cal-readonly-diagnostic-report.json"
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
    .map(
      (x) =>
        (x.input || "").slice(0, 130) +
        " | cat=" +
        x.cat +
        " | eng=" +
        x.eng +
        " | b=" +
        x.bucket
    );
}

function main() {
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== SILVER_RHC3_NEGATION_CAL_READONLY_DIAGNOSTIC_ABORT ===");
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
    TRUE_ENGINE_FAIL_NEGATION: 0,
    SAFE_READ_OK_BUT_HARNESS_FAIL: 0,
    SAFE_CLARIFICATION_OK: 0,
    GOLD_LABEL_TOO_STRICT: 0,
    TEMPLATE_DNA_BAD_INPUT: 0,
    WRONG_MODULE_READ: 0,
    OTHER: 0
  };

  const inspectBuckets = Object.assign({}, fullBuckets);
  const examples = {
    TRUE_ENGINE_FAIL_NEGATION: [],
    SAFE_READ_OK_BUT_HARNESS_FAIL: [],
    SAFE_CLARIFICATION_OK: [],
    GOLD_LABEL_TOO_STRICT: [],
    TEMPLATE_DNA_BAD_INPUT: [],
    WRONG_MODULE_READ: [],
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
    const b = classifyNegationCalReadonly(cc, hit.turn, hit.ev, cc.gold);
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
    const bucket = ev.pass ? "PASS" : classifyNegationCalReadonly(c, turn, ev, g);

    if (!ev.pass) {
      countKey(inspectBuckets, bucket);
      const list = examples[bucket];
      if (list && list.length < 40) {
        list.push({
          id: c.id,
          input: c.input,
          cat: ev.cat || "",
          bucket,
          eng: turn.normalizedIntent,
          raw: raw.slice(0, 200)
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
      contains_filler: g.contains_filler,
      contains_no_diacritics: g.contains_no_diacritics,
      risk_level: g.risk_level,
      actual_intent: turn.normalizedIntent,
      actual_module: actualModuleFromTurn(turn),
      actual_mode: actualModeFromTurn(turn),
      actual_processingState: turn.processingState,
      actual_has_draft: createLikeTurn(turn),
      actual_draft_summary: serializeDraftBrief(turn),
      actual_response_summary: raw.slice(0, 280),
      harness_pass: ev.pass,
      harness_cat: ev.cat || "",
      diagnostic_bucket: bucket
    });
  }

  const te = fullBuckets.TRUE_ENGINE_FAIL_NEGATION;
  const sr = fullBuckets.SAFE_READ_OK_BUT_HARNESS_FAIL;
  const sc = fullBuckets.SAFE_CLARIFICATION_OK;
  const gl = fullBuckets.GOLD_LABEL_TOO_STRICT;
  const tp = fullBuckets.TEMPLATE_DNA_BAD_INPUT;
  const wm = fullBuckets.WRONG_MODULE_READ;
  const ot = fullBuckets.OTHER;
  const fullFailSum = te + sr + sc + gl + tp + wm + ot;

  const ranked = Object.entries(fullBuckets).sort((a, b) => b[1] - a[1]);
  const dominant_root_cause = fullFailSum ? ranked[0][0] : "NONE";

  const failTotal = clusterFail;
  const safeDominated = sr + sc + gl + tp >= te * 1.15;
  let ready_for_engine_fix = "NO";
  if (failTotal > 0) {
    const teShare = te / failTotal;
    if (
      teShare >= 0.52 &&
      te >= 200 &&
      te > sr + sc &&
      !safeDominated &&
      dominant_root_cause === "TRUE_ENGINE_FAIL_NEGATION"
    ) {
      ready_for_engine_fix = "YES";
    }
  }

  let recommended_next_action =
    "Dominate troubleshooting: if SAFE_READ_OK_BUT_HARNESS_FAIL or GOLD_LABEL_TOO_STRICT wins, tune calendar_query harness semantics and gold tolerance before any engine change.";
  let recommended_batch_family = "negation_no_write";
  if (ready_for_engine_fix === "YES") {
    recommended_next_action =
      "Single-scope engine PR: calendar read-only negation must not produce READY_TO_SAVE / calendar.create on mrkni… nic neukládej cluster.";
    recommended_batch_family = "negation_no_write_cal_readonly";
  } else if (dominant_root_cause === "SAFE_READ_OK_BUT_HARNESS_FAIL") {
    recommended_next_action =
      "Adjust calendarQuerySemantic / false_negative guards for read-only calendar lookup with entity-heavy folds; keep engine unchanged until harness sign-off.";
  } else if (dominant_root_cause === "SAFE_CLARIFICATION_OK" || dominant_root_cause === "GOLD_LABEL_TOO_STRICT") {
    recommended_next_action =
      "Revisit RHC3 gold expected_should_clarify or harness clarification acceptance for mutated negation_no_write surfaces; no engine routing PR yet.";
  }

  const repTrue = fmtExMini(examples.TRUE_ENGINE_FAIL_NEGATION, 10);
  const repSafeRead = fmtExMini(examples.SAFE_READ_OK_BUT_HARNESS_FAIL, 5);
  const repSafeClar = fmtExMini(examples.SAFE_CLARIFICATION_OK, 5);
  const repGoldTpl = fmtExMini(examples.GOLD_LABEL_TOO_STRICT, 5);
  const repGoldTplArr = repGoldTpl.slice();
  if (repGoldTplArr.length < 5) {
    repGoldTplArr.push.apply(repGoldTplArr, fmtExMini(examples.TEMPLATE_DNA_BAD_INPUT, 5 - repGoldTplArr.length));
  }

  const gitClean = git.ok ? "YES" : "NO";

  const textBlock = [
    "=== SILVER_RHC3_NEGATION_CAL_READONLY_DIAGNOSTIC_RESULT ===",
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
    "true_engine_fail_negation_count=" + te,
    "safe_read_ok_but_harness_fail_count=" + sr,
    "safe_clarification_ok_count=" + sc,
    "gold_label_too_strict_count=" + gl,
    "template_dna_bad_input_count=" + tp,
    "wrong_module_read_count=" + wm,
    "other_count=" + ot,
    "",
    "dominant_root_cause=" + dominant_root_cause,
    "",
    "representative_true_engine_fail_examples=" + repTrue.join(" || "),
    "representative_safe_read_examples=" + repSafeRead.join(" || "),
    "representative_safe_clarification_examples=" + repSafeClar.join(" || "),
    "representative_gold_or_template_examples=" + repGoldTplArr.slice(0, 5).join(" || "),
    "",
    "ready_for_engine_fix=" + ready_for_engine_fix,
    "recommended_next_action=" + recommended_next_action,
    "recommended_batch_family=" + recommended_batch_family,
    "",
    "git_status_clean=" + gitClean,
    "======= END_SILVER_RHC3_NEGATION_CAL_READONLY_DIAGNOSTIC_RESULT ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    pinned_main_commit: PINNED_MAIN_COMMIT,
    diag_runner_head: runnerHead,
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
    representative: {
      true_engine_fail_negation: repTrue,
      safe_read_ok_but_harness_fail: repSafeRead,
      safe_clarification_ok: repSafeClar,
      gold_or_template: repGoldTplArr.slice(0, 5)
    },
    samples: samplesOut,
    text_block: textBlock
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
}

if (require.main === module) {
  main();
}

module.exports = { TARGET_CLUSTER, classifyNegationCalReadonly };
