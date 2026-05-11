/**
 * RHC3 cluster diagnostic (read-only): rhc3_note_query_kde ("Kde mám uložené … ?").
 * Buckets: retrieval/read vs wrong module vs harness/gold vs template DNA vs ambiguous "kde" vs safe clarification.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-note-query-kde-diagnostic-report.json");

const EXPECTED_MAIN_COMMIT = "078529eca074e7011a53cceb7a10b3812d02fc63";
const TARGET_CLUSTER = "rhc3_note_query_kde";
const RANDOM_SAMPLE_SEED = 0x4b64654d;
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
  finalizeNegationNoWriteHarnessEval
} = rhc3;
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

function serializeDraft(turn) {
  const d = turn.draft || {};
  const parts = [];
  if (d.title) parts.push("title:" + String(d.title).slice(0, 120));
  if (d.note) parts.push("note:" + String(d.note).slice(0, 80));
  if (d.silverNoteText) parts.push("nText:" + String(d.silverNoteText).slice(0, 120));
  if (d.targetContainer) parts.push("target:" + d.targetContainer);
  return parts.join(";") || "(none)";
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

function hasKdeUlozeneCue(fold) {
  const f = String(fold || "");
  return /\bkde\b/i.test(f) && /\bulozen/i.test(f);
}

function kdeCompetingCalendarOrTaskCue(fold) {
  const f = String(fold || "");
  return (
    /\b(kalendar|schuz|udalost|ukol|ukoly|termin|terminy)\b/i.test(f) &&
    !/\bpoznam|poznamk|note\b/i.test(f)
  );
}

function templateLikelyBroken(c, fold) {
  const f = String(fold || "");
  if (String(c.input || "").length < 10) return true;
  if (!hasKdeUlozeneCue(f)) return true;
  return false;
}

/**
 * @returns {"TRUE_RETRIEVAL_FAIL"|"WRONG_MODULE"|"SAFE_CLARIFICATION_OK"|"GOLD_LABEL_TOO_STRICT"|"TEMPLATE_DNA_BAD_INPUT"|"AMBIGUOUS_INPUT"|"OTHER"}
 */
function classifyNoteQueryKde(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const cat = String(ev.cat || "");
  const auditIntent = String(ev.auditIntent || "");
  const drafty = createLikeTurn(turn);

  if (cat === "runtime_fail") return "OTHER";

  if (cat === "wrong_collection" || cat === "note_vs_task_confusion" || cat === "calendar_vs_task_confusion") {
    return "WRONG_MODULE";
  }

  if (cat === "query_wrong_dataset") {
    return "WRONG_MODULE";
  }

  if (cat === "query_created_write") {
    return "TRUE_RETRIEVAL_FAIL";
  }

  if (cat === "negative_instruction_fail") {
    return "OTHER";
  }

  if (cat === "false_negative") {
    if (/\bbarvu\b.*\baut/i.test(fold)) return "GOLD_LABEL_TOO_STRICT";
    return "TRUE_RETRIEVAL_FAIL";
  }

  if (cat === "raw_response_empty") {
    return "TRUE_RETRIEVAL_FAIL";
  }

  if (cat === "intent_fail") {
    if (drafty) return "TRUE_RETRIEVAL_FAIL";

    if (eng === "clarification" || eng === "unknown" || auditIntent === "unknown") {
      if (templateLikelyBroken(c, fold)) return "TEMPLATE_DNA_BAD_INPUT";
      if (isChaoticMutationSurface(c) && hasKdeUlozeneCue(fold)) return "SAFE_CLARIFICATION_OK";
      if (isChaoticMutationSurface(c)) return "TEMPLATE_DNA_BAD_INPUT";
      if (hasKdeUlozeneCue(fold) && kdeCompetingCalendarOrTaskCue(fold)) return "AMBIGUOUS_INPUT";
      if (hasKdeUlozeneCue(fold)) return "GOLD_LABEL_TOO_STRICT";
      return "AMBIGUOUS_INPUT";
    }

    if (
      auditIntent === "calendar.query" ||
      auditIntent === "task.query" ||
      eng === "calendar.read" ||
      eng === "calendar.create" ||
      eng === "tasks.read" ||
      eng === "tasks.create"
    ) {
      return "WRONG_MODULE";
    }

    return "OTHER";
  }

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
      "scripts/silver-rhc3-note-query-kde-diagnostic.cjs",
      "scripts/silver-rhc3-note-query-kde-diagnostic-report.json"
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
    console.log("=== SILVER_RHC3_NOTE_QUERY_KDE_DIAGNOSTIC_ABORT ===");
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
    TRUE_RETRIEVAL_FAIL: 0,
    WRONG_MODULE: 0,
    SAFE_CLARIFICATION_OK: 0,
    GOLD_LABEL_TOO_STRICT: 0,
    TEMPLATE_DNA_BAD_INPUT: 0,
    AMBIGUOUS_INPUT: 0,
    OTHER: 0
  };

  const examples = {
    TRUE_RETRIEVAL_FAIL: [],
    WRONG_MODULE: [],
    SAFE_CLARIFICATION_OK: [],
    GOLD_LABEL_TOO_STRICT: [],
    TEMPLATE_DNA_BAD_INPUT: [],
    AMBIGUOUS_INPUT: [],
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
    const b = classifyNoteQueryKde(cc, hit.turn, hit.ev, cc.gold);
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
    const bucket = ev.pass ? "PASS" : classifyNoteQueryKde(c, turn, ev, g);

    if (!ev.pass) {
      const exList = examples[bucket];
      if (exList && exList.length < 35) {
        exList.push({
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
      contains_filler: g.contains_filler,
      contains_typo: g.contains_typo,
      contains_no_diacritics: g.contains_no_diacritics,
      contains_retrieval: g.contains_retrieval,
      actual_intent: turn.normalizedIntent,
      actual_module: actualModuleFromTurn(turn),
      actual_mode: actualModeFromTurn(turn),
      actual_processingState: turn.processingState,
      actual_draft_summary: serializeDraft(turn),
      actual_response_summary: raw.slice(0, 280),
      harness_pass: ev.pass,
      harness_cat: ev.cat || "",
      diagnostic_bucket: bucket
    });
  }

  const tr = fullBuckets.TRUE_RETRIEVAL_FAIL;
  const wm = fullBuckets.WRONG_MODULE;
  const sc = fullBuckets.SAFE_CLARIFICATION_OK;
  const gl = fullBuckets.GOLD_LABEL_TOO_STRICT;
  const td = fullBuckets.TEMPLATE_DNA_BAD_INPUT;
  const am = fullBuckets.AMBIGUOUS_INPUT;
  const ot = fullBuckets.OTHER;
  const fullFailSum = tr + wm + sc + gl + td + am + ot;

  const ranked = Object.entries(fullBuckets).sort((a, b) => b[1] - a[1]);
  const dominant_root_cause = fullFailSum ? ranked[0][0] : "NONE";

  const failTotal = clusterFail;

  let ready_for_engine_fix = "NO";
  if (failTotal > 0) {
    const engineHeavy = tr + wm;
    const harnessHeavy = gl + sc + td + am;
    const engineShare = engineHeavy / failTotal;
    if (engineShare >= 0.52 && engineHeavy >= 400 && tr >= wm * 0.15) {
      ready_for_engine_fix = "YES";
    }
    if (harnessHeavy > engineHeavy * 1.35) {
      ready_for_engine_fix = "NO";
    }
  }

  let recommended_next_action =
    "Sladit harness/gold pro note_query „Kde mám uložené … ?“ (intent_fail vs clarification na mutovaných vstupech, micro-semantika false_negative); engine jen pokud dominuje TRUE_RETRIEVAL_FAIL nebo WRONG_MODULE.";
  let recommended_batch_family = "note_query_chaos";

  if (dominant_root_cause === "TRUE_RETRIEVAL_FAIL" || dominant_root_cause === "WRONG_MODULE") {
    recommended_next_action =
      "Navázat na engine: note retrieval/read routing pro „kde mám uložené“ dotazy (notes.read / global.search do poznámek) a kontrola textové odpovědi; ověřit duplicitní kalendářní routing.";
    recommended_batch_family = "note_query_kde";
    if (ready_for_engine_fix === "NO") {
      recommended_next_action =
        "Nejdřív upřesnit gold/harness očekávání pro Kde-dotazy a šumové vrstvy; engine PR až když dominantní příčina není harness/template.";
    }
  } else if (dominant_root_cause === "GOLD_LABEL_TOO_STRICT" || dominant_root_cause === "SAFE_CLARIFICATION_OK") {
    recommended_next_action =
      "Upravit silver harness pro note_query: rozšířit PASS pro legitimní clarification na silně mutovaných „kde uložené“ dotazech nebo zmírnit intent_fail pravidla.";
    recommended_batch_family = "note_query_chaos";
  } else if (dominant_root_cause === "TEMPLATE_DNA_BAD_INPUT") {
    recommended_next_action =
      "Zvážit úpravu šablony note_query_chaos nebo mask exclusion (mutace ničí „kde/uložené“ signál); ne mixovat s engine routing PR.";
    recommended_batch_family = "note_query_chaos";
  } else if (dominant_root_cause === "AMBIGUOUS_INPUT") {
    recommended_next_action =
      "Oddělit ambiguous „kde“ (kalendář vs poznámky) do vlastního clusteru nebo gold expected clarify; nepřepisovat engine bez této separace.";
    recommended_batch_family = "note_query_chaos";
  }

  const gitClean = git.ok ? "YES" : "NO";

  const textBlock = [
    "=== SILVER_RHC3_NOTE_QUERY_KDE_DIAGNOSTIC_RESULT ===",
    "",
    "main_commit=" + EXPECTED_MAIN_COMMIT,
    "",
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
    "true_retrieval_fail_count=" + tr,
    "wrong_module_count=" + wm,
    "safe_clarification_ok_count=" + sc,
    "gold_label_too_strict_count=" + gl,
    "template_dna_bad_input_count=" + td,
    "ambiguous_input_count=" + am,
    "other_count=" + ot,
    "",
    "dominant_root_cause=" + dominant_root_cause,
    "ready_for_engine_fix=" + ready_for_engine_fix,
    "recommended_next_action=" + recommended_next_action,
    "recommended_batch_family=" + recommended_batch_family,
    "",
    "git_status_clean=" + gitClean,
    "",
    "======= END_SILVER_RHC3_NOTE_QUERY_KDE_DIAGNOSTIC_RESULT ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    baseline_main_commit: EXPECTED_MAIN_COMMIT,
    diag_runner_head: runnerHead,
    target_cluster: TARGET_CLUSTER,
    total_cases: TOTAL_CASES,
    total_cluster_count,
    cluster_pass_in_full_scan: clusterPass,
    cluster_fail_in_full_scan: failTotal,
    inspected_count,
    full_cluster_bucket_counts: fullBuckets,
    dominant_root_cause,
    ready_for_engine_fix,
    recommended_next_action,
    recommended_batch_family,
    representative_examples: {
      TRUE_RETRIEVAL_FAIL: examples.TRUE_RETRIEVAL_FAIL.slice(0, 12),
      WRONG_MODULE: examples.WRONG_MODULE.slice(0, 12),
      SAFE_CLARIFICATION_OK: examples.SAFE_CLARIFICATION_OK.slice(0, 8),
      GOLD_LABEL_TOO_STRICT: examples.GOLD_LABEL_TOO_STRICT.slice(0, 8),
      TEMPLATE_DNA_BAD_INPUT: examples.TEMPLATE_DNA_BAD_INPUT.slice(0, 8),
      AMBIGUOUS_INPUT: examples.AMBIGUOUS_INPUT.slice(0, 8),
      OTHER: examples.OTHER.slice(0, 8)
    },
    samples: samplesOut,
    text_block: textBlock
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_CLUSTER,
  classifyNoteQueryKde,
  EXPECTED_MAIN_COMMIT
};
