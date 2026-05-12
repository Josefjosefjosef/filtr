/**
 * RHC3 cluster diagnostic (read-only): rhc3_note_create_uloz_poznamku ("Ulož mi do poznámek že …, ne úkol.").
 * Buckets: unknown vs wrong module vs query routing vs response/title vs negation vs ambiguous vs template/gold.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(os.tmpdir(), "silver-rhc3-note-create-uloz-poznamku-diagnostic-report.json");

const EXPECTED_MAIN_COMMIT = "25956906b9a95e86c2ef5f768d127c573db137b1";
const TARGET_CLUSTER = "rhc3_note_create_uloz_poznamku";
const RANDOM_SAMPLE_SEED = 0x4e6f7465;
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
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval
} = rhc3;
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const { loadEngine, evaluateOne, applyHarnessExpectationHarmonization, ctxForCase, foldCs, rawUserMessage, hasNegWrite } =
  harness;

const BUCKET_KEYS = [
  "note_create_should_create_but_unknown",
  "note_create_wrong_module_calendar",
  "note_create_wrong_module_task",
  "note_create_routed_as_query_read",
  "note_create_title_or_content_cleanup_fail",
  "note_create_response_contract_fail",
  "negation_or_no_write_should_not_create",
  "ambiguous_should_clarify",
  "template_dna_bad_input",
  "gold_label_problem",
  "other"
];

function mulberry32(seed) {
  return core.mulberry32(seed >>> 0);
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function safetyNoWriteFolded(fold) {
  const f = String(fold || "");
  return (
    /\bnic\s+neuklad\w*\b/i.test(f) ||
    /\bnevytvarej\b/i.test(f) ||
    /\bnevytvářej\b/i.test(f) ||
    /\bpouze\s+cti\b/i.test(f) ||
    /\bpouze\s+čti\b/i.test(f) ||
    /\bjen\s+se\s+podivej\b/i.test(f) ||
    /\bjen\s+se\s+podívej\b/i.test(f) ||
    /\bneukladat\b/i.test(f) ||
    /\bneukládat\b/i.test(f)
  );
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

function hasNoteCreateTemplateSignal(fold) {
  const f = String(fold || "");
  return /\buloz\w*\s+mi\s+do\s+poznam|\buloz\w*\s+do\s+poznam|do\s+poznam\w*\s+(ze|že)\b/i.test(f);
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
  return popcount((mask || 0) >>> 0, noiseMask >>> 0);
}

function isQueryLikeRouting(eng, auditIntent) {
  const e = String(eng || "");
  const a = String(auditIntent || "");
  if (e === "notes.read" || e === "tasks.read" || e === "calendar.read") return true;
  if (e === "global.search") return true;
  if (a === "note.query" || a === "calendar.query" || a === "task.query") return true;
  return false;
}

function extractPayloadAfterZe(input) {
  const s = String(input || "");
  const m = s.match(/do\s+pozn[aá]mk[aá]ch\s+(?:ze|že)\s+(.+?)(?:,\s*ne\s+úkol|,?\s*ne\s+ukol|$)/i);
  if (m) return m[1].trim().slice(0, 200);
  return "";
}

function foldSnippet(s) {
  return foldCs(String(s || "").toLowerCase()).replace(/\s+/g, " ").trim();
}

function draftEntityMismatch(turn, payloadFold) {
  if (!payloadFold || payloadFold.length < 4) return false;
  const d = turn.draft || {};
  const probe = foldSnippet([d.title, d.note, d.silverNoteText].filter(Boolean).join(" "));
  const head = payloadFold.slice(0, Math.min(12, payloadFold.length));
  return probe.length > 0 && probe.indexOf(head) < 0;
}

/**
 * @returns {{ bucket: string, why: string, root: string }}
 */
function classifyNoteCreateUloz(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const eng = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const cat = String(ev.cat || "");
  const auditIntent = String(ev.auditIntent || "");
  const drafty = createLikeTurn(turn);
  const g = gold || {};

  if (cat === "runtime_fail") {
    return { bucket: "other", why: "runtime_throw:" + String(ev.raw || "").slice(0, 80), root: "ENGINE_BUG" };
  }

  if (cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return {
      bucket: "negation_or_no_write_should_not_create",
      why: "harness_cat=" + cat,
      root: "ENGINE_BUG"
    };
  }
  if (safetyNoWriteFolded(fold) && drafty) {
    return {
      bucket: "negation_or_no_write_should_not_create",
      why: "safety_no_write_folded+but_create_like_turn",
      root: "ENGINE_BUG"
    };
  }
  if (hasNegWrite(fold) && drafty) {
    return {
      bucket: "negation_or_no_write_should_not_create",
      why: "hasNegWrite+but_create_like_turn",
      root: "ENGINE_BUG"
    };
  }

  if (cat === "wrong_collection" && (eng === "calendar.create" || eng === "calendar.read")) {
    return { bucket: "note_create_wrong_module_calendar", why: "wrong_collection+calendar_intent", root: "ENGINE_BUG" };
  }
  if (eng === "calendar.create") {
    return { bucket: "note_create_wrong_module_calendar", why: "engine_calendar.create+cat=" + cat, root: "ENGINE_BUG" };
  }

  if (cat === "note_vs_task_confusion" || eng === "tasks.create" || eng === "tasks.read") {
    return { bucket: "note_create_wrong_module_task", why: "task_module+cat=" + cat + ";eng=" + eng, root: "ENGINE_BUG" };
  }

  if (isQueryLikeRouting(eng, auditIntent) && String(g.expected_intent || "") === "note.create") {
    return {
      bucket: "note_create_routed_as_query_read",
      why: "query_like_routing:eng=" + eng + ";audit=" + auditIntent + ";cat=" + cat,
      root: "ENGINE_BUG"
    };
  }

  if (cat === "raw_response_empty" || cat === "raw_response_wrong" || cat === "unnecessary_disambiguation") {
    const payload = extractPayloadAfterZe(c.input);
    const pf = foldSnippet(payload);
    if (
      (cat === "raw_response_wrong" || cat === "raw_response_empty") &&
      eng === "notes.create" &&
      ps === "READY_TO_SAVE" &&
      draftEntityMismatch(turn, pf)
    ) {
      return {
        bucket: "note_create_title_or_content_cleanup_fail",
        why: "notes.create+READY+draft_mismatch_vs_payload;cat=" + cat,
        root: "ENGINE_BUG"
      };
    }
    return {
      bucket: "note_create_response_contract_fail",
      why: "response_semantic:cat=" + cat + ";eng=" + eng + ";ps=" + ps,
      root: "ENGINE_BUG"
    };
  }

  const shortInput = String(c.input || "").length < 12;
  if (shortInput || !hasNoteCreateTemplateSignal(fold)) {
    return {
      bucket: "template_dna_bad_input",
      why: shortInput ? "input_too_short" : "lost_note_create_template_markers_after_mutation",
      root: "TEMPLATE_DNA_PROBLEM"
    };
  }

  const pristine = noiseOnlyPopcount(c.mutation_mask) === 0 && !isChaoticMutationSurface(c);
  const neUkolTail = /\bne\s+ukol|\bne\s+úkol/i.test(fold);
  if (pristine && neUkolTail && (eng === "unknown" || eng === "clarification") && cat === "intent_fail") {
    return {
      bucket: "gold_label_problem",
      why: "pristine_template+ne_ukol_tail+engine_unknown;gold_still_expects_note.create",
      root: "GOLD_PROBLEM"
    };
  }

  if (
    (eng === "unknown" || eng === "clarification") &&
    isChaoticMutationSurface(c) &&
    hasNoteCreateTemplateSignal(fold) &&
    cat === "intent_fail"
  ) {
    return {
      bucket: "ambiguous_should_clarify",
      why: "heavy_mutation_surface+safe_clarify_or_unknown_vs_strict_note.create",
      root: "AMBIGUOUS_OK"
    };
  }

  if (cat === "intent_fail" && (eng === "unknown" || eng === "clarification")) {
    return {
      bucket: "note_create_should_create_but_unknown",
      why: "intent_fail+unknown_or_clarification+audit=" + auditIntent,
      root: "ENGINE_BUG"
    };
  }

  if (cat === "intent_fail") {
    return {
      bucket: "other",
      why: "intent_fail+eng=" + eng + ";audit=" + auditIntent,
      root: "HARNESS_BUG"
    };
  }

  return { bucket: "other", why: "unclassified_fail:cat=" + cat + ";eng=" + eng, root: "HARNESS_BUG" };
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
    const allow = ["scripts/silver-rhc3-note-create-uloz-poznamku-diagnostic.cjs"];
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

function actualModuleFromTurn(turn) {
  const d = turn.draft || {};
  if (d.targetContainer) return d.targetContainer;
  const eng = turn.normalizedIntent;
  if (eng === "calendar.create" || eng === "calendar.read") return "calendar";
  if (eng === "tasks.create" || eng === "tasks.read") return "tasks";
  if (eng === "notes.create" || eng === "notes.read") return "notes";
  return "";
}

function serializeDraft(turn) {
  const d = turn.draft || {};
  const parts = [];
  if (d.title) parts.push("title:" + String(d.title).slice(0, 120));
  if (d.note) parts.push("note:" + String(d.note).slice(0, 120));
  if (d.silverNoteText) parts.push("nText:" + String(d.silverNoteText).slice(0, 120));
  if (d.targetContainer) parts.push("target:" + d.targetContainer);
  return parts.join(";") || "(none)";
}

function buildExampleRecord(c, turn, ev, gold, cls) {
  const g = gold || {};
  const raw = rawUserMessage(turn);
  const eng = String(turn.normalizedIntent || "");
  const actualClarify = eng === "clarification" || eng === "unknown" || String(turn.processingState || "") === "CLARIFICATION";
  return {
    id: c.id,
    bucket: cls.bucket,
    classification: cls.root,
    why_fail: cls.why,
    input: c.input,
    expected_intent: g.expected_intent || "",
    actual_intent: eng,
    actual_state: String(turn.processingState || ""),
    expected_should_clarify: !!g.expected_should_clarify,
    actual_should_clarify_or_probe: actualClarify,
    harness_cat: ev.cat || "",
    audit_intent: ev.auditIntent || "",
    extracted_title: String((turn.draft && turn.draft.title) || ""),
    extracted_note: String((turn.draft && (turn.draft.note || turn.draft.silverNoteText)) || ""),
    draft_summary: serializeDraft(turn),
    response_excerpt: raw.slice(0, 280),
    gold_expected_create_title: g.expected_create_title || ""
  };
}

function main() {
  const git = gitAllowListClean();
  if (!git.ok) {
    console.log("=== RHC3_NOTE_CREATE_ULOZ_POZNAMKU_DIAGNOSTIC_ABORT ===");
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
  const cluster_total = clusterCases.length;

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

  const bucketCounts = {};
  for (let bi = 0; bi < BUCKET_KEYS.length; bi++) bucketCounts[BUCKET_KEYS[bi]] = 0;

  const rootCounts = {
    ENGINE_BUG: 0,
    HARNESS_BUG: 0,
    GOLD_PROBLEM: 0,
    TEMPLATE_DNA_PROBLEM: 0,
    AMBIGUOUS_OK: 0,
    SAFETY_OK: 0
  };

  const examplesByBucket = {};
  for (let ei = 0; ei < BUCKET_KEYS.length; ei++) examplesByBucket[BUCKET_KEYS[ei]] = [];

  const byId = new Map();
  let clusterPass = 0;
  let fail_total = 0;

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
      fail_total++;
      turn = { normalizedIntent: "", processingState: "", draft: {} };
      ev = { pass: false, cat: "runtime_fail", auditIntent: "unknown", raw: String(e && e.message) };
      const cls = classifyNoteCreateUloz(c, turn, ev, c.gold);
      countKey(bucketCounts, cls.bucket);
      const rk = cls.root;
      if (rootCounts[rk] != null) rootCounts[rk]++;
      else rootCounts.HARNESS_BUG++;
      byId.set(c.id, { c, turn, ev, cls });
      continue;
    }
    if (ev.pass) clusterPass++;
    else {
      fail_total++;
      const cls = classifyNoteCreateUloz(c, turn, ev, c.gold);
      countKey(bucketCounts, cls.bucket);
      const rk = cls.root;
      if (rootCounts[rk] != null) rootCounts[rk]++;
      else rootCounts.HARNESS_BUG++;
      byId.set(c.id, { c, turn, ev, cls });
    }
  }

  for (let ii = 0; ii < inspectedList.length; ii++) {
    const c = inspectedList[ii];
    const hit = byId.get(c.id);
    if (!hit || hit.ev.pass) continue;
    const list = examplesByBucket[hit.cls.bucket];
    if (list && list.length < 10) {
      list.push(buildExampleRecord(c, hit.turn, hit.ev, c.gold, hit.cls));
    }
  }

  for (let fi = 0; fi < clusterCases.length; fi++) {
    const c = clusterCases[fi];
    const hit = byId.get(c.id);
    if (!hit || hit.ev.pass) continue;
    const list = examplesByBucket[hit.cls.bucket];
    if (list && list.length < 10) {
      const already = list.some((x) => x.id === c.id);
      if (!already) list.push(buildExampleRecord(c, hit.turn, hit.ev, c.gold, hit.cls));
    }
  }

  let dominant_root_cause = "none";
  let best = -1;
  for (let bi = 0; bi < BUCKET_KEYS.length; bi++) {
    const k = BUCKET_KEYS[bi];
    const v = bucketCounts[k] || 0;
    if (v > best) {
      best = v;
      dominant_root_cause = k;
    }
  }

  const engine_bug_count = rootCounts.ENGINE_BUG;
  const harness_bug_count = rootCounts.HARNESS_BUG;
  const gold_problem_count = rootCounts.GOLD_PROBLEM;
  const template_dna_problem_count = rootCounts.TEMPLATE_DNA_PROBLEM;
  const ambiguous_ok_count = rootCounts.AMBIGUOUS_OK;
  const safety_ok_count = rootCounts.SAFETY_OK;

  const scriptOnlyDominant =
    dominant_root_cause === "template_dna_bad_input" ||
    dominant_root_cause === "gold_label_problem" ||
    dominant_root_cause === "ambiguous_should_clarify";

  let engine_fix_recommended = "NO";
  if (!scriptOnlyDominant && fail_total > 0) {
    const engineHeavy =
      (bucketCounts.note_create_should_create_but_unknown || 0) +
      (bucketCounts.note_create_wrong_module_calendar || 0) +
      (bucketCounts.note_create_wrong_module_task || 0) +
      (bucketCounts.note_create_routed_as_query_read || 0) +
      (bucketCounts.note_create_title_or_content_cleanup_fail || 0) +
      (bucketCounts.note_create_response_contract_fail || 0) +
      (bucketCounts.negation_or_no_write_should_not_create || 0);
    const scriptHeavy =
      (bucketCounts.template_dna_bad_input || 0) +
      (bucketCounts.gold_label_problem || 0) +
      (bucketCounts.ambiguous_should_clarify || 0);
    if (engine_bug_count > 0 && engineHeavy >= scriptHeavy * 0.85) {
      engine_fix_recommended = "YES";
    }
  }

  let scripts_alignment_recommended = "NO";
  if (
    dominant_root_cause === "template_dna_bad_input" ||
    dominant_root_cause === "gold_label_problem" ||
    dominant_root_cause === "ambiguous_should_clarify" ||
    harness_bug_count > engine_bug_count
  ) {
    scripts_alignment_recommended = "YES";
  } else if (template_dna_problem_count + gold_problem_count + ambiguous_ok_count > engine_bug_count * 1.1) {
    scripts_alignment_recommended = "YES";
  } else if (ambiguous_ok_count >= 50 || template_dna_problem_count >= 25) {
    scripts_alignment_recommended = "YES";
  }

  let recommended_next_scope = "";
  if (dominant_root_cause === "template_dna_bad_input") {
    recommended_next_scope =
      "scripts-only: tighten note_create_chaos template / mutation exclusions so uloz+do+poznam+ze survive folding";
  } else if (dominant_root_cause === "gold_label_problem") {
    recommended_next_scope =
      "scripts-only: revisit gold expected_intent for pristine uloz-do-poznamek+ne_ukol tail vs engine unknown";
  } else if (dominant_root_cause === "ambiguous_should_clarify") {
    recommended_next_scope =
      "scripts-only: add harness clarify lane for noisy note_create (mirror note_query_kde pattern)";
  } else if (dominant_root_cause === "note_create_wrong_module_calendar") {
    recommended_next_scope = "narrow engine: calendar.create/read leakage on explicit do poznamkách paths";
  } else if (dominant_root_cause === "note_create_wrong_module_task") {
    recommended_next_scope = "narrow engine: tasks.create/read vs note.create on ne úkol disambiguation";
  } else if (dominant_root_cause === "note_create_routed_as_query_read") {
    recommended_next_scope = "narrow engine: notes.read / global.search vs notes.create for uloz imperative";
  } else if (dominant_root_cause === "note_create_response_contract_fail") {
    recommended_next_scope = "narrow engine or copy: assistant raw must satisfy noteWriteSemantic poznam/uloz cues";
  } else if (dominant_root_cause === "note_create_title_or_content_cleanup_fail") {
    recommended_next_scope = "narrow engine: READY_TO_SAVE draft title/note must retain payload after ze-clause";
  } else if (dominant_root_cause === "note_create_should_create_but_unknown") {
    recommended_next_scope = "narrow engine: unknown/clarification on clear uloz-do-poznamek create surface";
  } else if (dominant_root_cause === "negation_or_no_write_should_not_create") {
    recommended_next_scope = "safety+harness: negation/write guards on note_write cluster";
  } else {
    recommended_next_scope = "inspect other bucket samples in JSON; then pick first high-frequency harness_cat";
  }

  const gitCleanAll = (() => {
    try {
      return execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim() === "" ? "YES" : "NO";
    } catch {
      return "NO";
    }
  })();

  const textBlock = [
    "=== RHC3_NOTE_CREATE_ULOZ_POZNAMKU_DIAGNOSTIC ===",
    "",
    "main_commit=" + EXPECTED_MAIN_COMMIT,
    "",
    "cluster_total=" + cluster_total,
    "fail_total=" + fail_total,
    "",
    "note_create_should_create_but_unknown=" + (bucketCounts.note_create_should_create_but_unknown || 0),
    "note_create_wrong_module_calendar=" + (bucketCounts.note_create_wrong_module_calendar || 0),
    "note_create_wrong_module_task=" + (bucketCounts.note_create_wrong_module_task || 0),
    "note_create_routed_as_query_read=" + (bucketCounts.note_create_routed_as_query_read || 0),
    "note_create_title_or_content_cleanup_fail=" + (bucketCounts.note_create_title_or_content_cleanup_fail || 0),
    "note_create_response_contract_fail=" + (bucketCounts.note_create_response_contract_fail || 0),
    "negation_or_no_write_should_not_create=" + (bucketCounts.negation_or_no_write_should_not_create || 0),
    "ambiguous_should_clarify=" + (bucketCounts.ambiguous_should_clarify || 0),
    "template_dna_bad_input=" + (bucketCounts.template_dna_bad_input || 0),
    "gold_label_problem=" + (bucketCounts.gold_label_problem || 0),
    "other=" + (bucketCounts.other || 0),
    "",
    "engine_bug_count=" + engine_bug_count,
    "harness_bug_count=" + harness_bug_count,
    "gold_problem_count=" + gold_problem_count,
    "template_dna_problem_count=" + template_dna_problem_count,
    "ambiguous_ok_count=" + ambiguous_ok_count,
    "safety_ok_count=" + safety_ok_count,
    "",
    "dominant_root_cause=" + dominant_root_cause,
    "",
    "engine_fix_recommended=" + engine_fix_recommended,
    "scripts_alignment_recommended=" + scripts_alignment_recommended,
    "",
    "recommended_next_scope=" + recommended_next_scope,
    "",
    "git_status_clean=" + gitCleanAll,
    "",
    "=== END_RHC3_NOTE_CREATE_ULOZ_POZNAMKU_DIAGNOSTIC ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    expected_main_commit: EXPECTED_MAIN_COMMIT,
    diag_runner_head: runnerHead,
    target_cluster: TARGET_CLUSTER,
    total_cases: TOTAL_CASES,
    cluster_total,
    cluster_pass_in_full_scan: clusterPass,
    fail_total,
    bucket_counts: bucketCounts,
    root_cause_tag_counts: rootCounts,
    dominant_root_cause,
    engine_fix_recommended,
    scripts_alignment_recommended,
    recommended_next_scope,
    examples_by_bucket: examplesByBucket,
    text_block: textBlock
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGET_CLUSTER,
  classifyNoteCreateUloz,
  EXPECTED_MAIN_COMMIT
};
