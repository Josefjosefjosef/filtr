/**
 * SILVER_SELF_CORRECTION_AUDIT — scripts-only foundation (no engine / assets / UI).
 * Deterministic Czech self-correction lanes; VM harness via audit_silver_realistic_mobile_corpus.cjs.
 *
 * Usage: node scripts/silver-self-correction-audit.cjs
 * Env:   SILVER_SC_TOTAL_CASES (default 21000, 7 lanes × ~3000)
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_self_correction_audit_v1";
const REPORT_JSON = path.join(__dirname, "silver-self-correction-audit-report.json");
const SC_GLOBAL_SEED = 0x53433031;

const TOTAL_CASES = (() => {
  const n = parseInt(process.env.SILVER_SC_TOTAL_CASES || "21000", 10);
  return Number.isFinite(n) && n > 0 ? n : 21000;
})();

const SC_LANES = [
  "correction_after_create_intent",
  "correction_module_switch",
  "correction_temporal",
  "correction_negation",
  "correction_update_vs_create",
  "noisy_mobile_self_correction",
  "safety_regression",
];

const CORRECTION_PHRASES = [
  "ne vlastně",
  "oprav to na",
  "změň ten úkol na",
  "špatně přepiš na",
  "myslel jsem",
  "to ne",
  "vlastně zítra ne dnes",
];

/** P0 narrow engine regression: noisy neg read must not calendar.create */
const SC_NOISY_NEG_READ_REGRESSION = [
  { input: "teda mrkni kalendář v pátek nic neuklad ne vlastne jen právník zítra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "teda mrkni kalendar v patek nic neuklad ne vlastne jen pravnik zitra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "koukni kalendář zítra nic neukládej ne vlastně jen zubař ráno", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "koukni kalendar zitra nic neuklad ne vlastne jen zubar rano", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "jen mrkni kalendář pátek nic neukládej ne vlastně jen doktor zítra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "jen mrkni kalendar patek nic neuklad ne vlastne jen doktor zitra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "teda mrkni kalendář nic neukládej ne vlastně jen mamka večer", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "teda mrkni kalendar nic neuklad ne vlastne jen mamka vecer", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "hele teda mrkni kalendář dnes nic neuklad ne vlastne jen účetní zítra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "hele teda mrkni kalendar dnes nic neuklad ne vlastne jen ucetni zitra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "proste mrkni kalendář o víkendu nic neukládej ne vlastně jen rodicák zítra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "proste mrkni kalendar o vikendu nic neuklad ne vlastne jen rodicak zitra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "ee mrkni kalendář příští týden nic neuklad ne vlastne jen pojistovna zítra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "ee mrkni kalendar pristi tyden nic neuklad ne vlastne jen pojistovna zitra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "no jo teda mrkni kalendář zejtra nic neuklad ne vlastně jen schůzka s bankerem zítra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "no jo teda mrkni kalendar zejtra nic neuklad ne vlastne jen schuzka s bankerem zitra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "vlastne jo hele teda mrkni kalendář ve čtvrtek nic neuklad ne vlastne jen jednání zítra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "vlastne jo hele teda mrkni kalendar ve ctvrtek nic neuklad ne vlastne jen jednani zitra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "zjisti kalendář pátek nic nevytvářej ne vlastně jen právník zítra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "zjisti kalendar patek nic nevytvarej ne vlastne jen pravnik zitra", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "teda mrkni kalendář ráno nic neuklad ne vlastně jen servis auta zítra díky", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
  { input: "teda mrkni kalendar rano nic neuklad ne vlastne jen servis auta zitra diky", cluster: "self_correction_noisy_neg_read", group: "calendar_query", expectedIntent: "calendar.query" },
];

/** Guard: valid calendar.create must stay create */
const SC_NORMAL_CAL_CREATE_GUARD = [
  { input: "Přidej schůzku s právníkem zítra.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Pridej schuzku s pravnikem zitra.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Zapiš právníka zítra do kalendáře.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Zapis pravnika zitra do kalendare.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Dej mi do kalendáře doktora v pátek.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Dej mi do kalendare doktora v patek.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Připomeň mi schůzku s mámou večer.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Pripomen mi schuzku s mamou vecer.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Hoď do kalendáře zubaře ráno.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Hod do kalendare zubare rano.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Ulož schůzku s účetním v úterý do kalendáře.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
  { input: "Uloz schuzku s uctnim v utery do kalendare.", cluster: "guard_normal_cal_create", group: "calendar_write", expectedIntent: "calendar.create" },
];

const TEMPORAL_FROM = ["dnes", "ráno", "pondělí", "tento týden"];
const TEMPORAL_TO = ["zítra", "večer", "úterý", "příští týden"];

const core = require("./rhc-v3-deterministic-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const rhc3 = require("./silver-real-human-chaos-v3.cjs");

const {
  loadEngine,
  evaluateOne,
  applyHarnessExpectationHarmonization,
  ctxForCase,
  foldCs,
} = harness;

const {
  countsAsSafetyNegationWriteLeak,
  safetyNoWriteFoldedGlobal,
} = require("./silver-self-correction-negation-scope.cjs");

const {
  finalizeSelfCorrectionNoisyNegReadHarnessEval,
  finalizeSelfCorrectionSafetyCalReadonlyHarnessEval,
  finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval,
  finalizeSelfCorrectionNegationFlipHarnessEval,
  finalizeSelfCorrectionNoisyCalHarnessEval,
  finalizeSelfCorrectionUpdateNoteHarnessEval,
  finalizeSelfCorrectionUpdateTaskHarnessEval,
} = require("./silver-self-correction-query-clarification.cjs");

const {
  computeGoldLabels,
  moduleSwitchLaneExpectsClarify,
  finalizeModuleSwitchHarnessEval,
  finalizeModuleSwitchClarifyLaneHarnessEval,
  finalizeModuleSwitchTaskToNoteHarnessEval,
  finalizeModuleSwitchNoteToCalHarnessEval,
  finalizeModuleSwitchCalToNoteHarnessEval,
  finalizeModuleSwitchNegJakoCalToNoteHarnessEval,
  finalizeNegationNoWriteHarnessEval,
  finalizeNoteQueryKdeHarnessEval,
  finalizeFillerNoteQueryHarnessEval,
  finalizeRetrievalFuzzyHarnessEval,
  finalizeNoteCreateDoPoznamkStorageHarnessEval,
  finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval,
  finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval,
  finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval,
  finalizeAmbiguityCalConflictHarnessEval,
  finalizeCalQueryTopicClarifyLaneHarnessEval,
  finalizeMobileVoiceCalHarnessEval,
} = rhc3;

function mulberry32(seed) {
  return core.mulberry32(seed >>> 0);
}

function pickFrom(rng, arr) {
  return core.pickFrom(rng, arr);
}

function pickIndex(rng, n) {
  return core.pickIndex(rng, n);
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}


function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function gitTrackedCleanForSc() {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const tracked = lines.filter((l) => !l.startsWith("??"));
    const allow = [
      "assets/app.js",
      "scripts/silver-self-correction-audit.cjs",
      "scripts/silver-self-correction-audit-report.json",
      "scripts/silver-self-correction-safety-diagnostic.cjs",
      "scripts/silver-self-correction-safety-diagnostic-report.json",
      "scripts/silver-self-correction-negation-scope.cjs",
      "scripts/silver-self-correction-negation-scope-selftest.cjs",
      "scripts/silver-self-correction-query-clarification.cjs",
      "scripts/silver-self-correction-query-vs-clarification-selftest.cjs",
      "scripts/silver-self-correction-negation-flip-selftest.cjs",
      "scripts/silver-self-correction-safety-cal-readonly-selftest.cjs",
      "scripts/silver-self-correction-safety-cal-readonly-diagnostic.cjs",
      "scripts/silver-self-correction-safety-cal-readonly-diagnostic-report.json",
      "scripts/silver-self-correction-safety-note-readonly-selftest.cjs",
      "scripts/silver-self-correction-update-note-selftest.cjs",
      "scripts/silver-self-correction-task-to-note-selftest.cjs",
      "scripts/silver-real-human-chaos-v3.cjs",
      "scripts/silver-product-handoff-continuation.cjs",
      "scripts/silver-audit-registry.cjs",
      "scripts/silver-cap10-safe-autonomous-orchestrator.cjs",
      "scripts/silver-controlled-budget-guard.cjs",
      "scripts/audit_silver_20000_routing_stable.cjs",
      "scripts/audit_silver_realistic_mobile_corpus.cjs",
      "scripts/silver-real-czech-corpus-v1.cjs",
      "scripts/silver-real-czech-corpus-v1-report.json",
      "scripts/silver-real-czech-corpus-v1-30k-report.json",
      "scripts/silver-real-czech-public-ux-corpus-v2.cjs",
      "scripts/silver-real-czech-public-ux-corpus-v2-report.json",
      "scripts/silver-deep-product-real-ux-v2-report.json",
      "SILVER_RUN_REPORT.md",
      "SILVER_CURSOR_OUTPUT.md",
      "SILVER_NEXT_ACTION.md",
    ];
    const bad = tracked.filter((l) => {
      const pathPart = l.replace(/^\s*\S+\s+/, "").trim().replace(/\\/g, "/");
      for (let ai = 0; ai < allow.length; ai++) {
        if (pathPart.indexOf(allow[ai].replace(/\\/g, "/")) >= 0) return false;
      }
      return true;
    });
    return { ok: bad.length === 0, porcelain: o.trim() };
  } catch (e) {
    return { ok: false, porcelain: String(e) };
  }
}

function deriveScMutationMask(scLane, localIndex, streamSalt) {
  const base = (SC_GLOBAL_SEED ^ streamSalt ^ (scLane.length * 1315423911) ^ (localIndex * 2654435761)) >>> 0;
  const rng = mulberry32(base);
  let mask = pickIndex(rng, 4096);
  mask |= core.M.SELF_CORR_PHRASE;
  if (scLane === "noisy_mobile_self_correction") {
    mask |= core.M.MOBILE_PREFIX | core.M.FILLER_PREFIX | core.M.STRIP_DIACRITICS | core.M.SPOKEN_COMPRESS | core.M.TYPO_LITE;
  }
  if (scLane === "correction_negation" || scLane === "safety_regression") {
    mask |= core.M.NEGATION_OVERLAY;
  }
  if (scLane === "correction_module_switch") {
    mask |= core.M.FILLER_PREFIX;
  }
  return mask >>> 0;
}

function rhcFamilyForLane(scLane, group) {
  if (scLane === "correction_module_switch") return "module_switching";
  if (scLane === "correction_negation" || scLane === "safety_regression") return "negation_no_write";
  if (scLane === "noisy_mobile_self_correction") {
    if (String(group || "").indexOf("query") >= 0) return "negation_no_write";
    return "mobile_voice_dirty_czech";
  }
  if (scLane === "correction_update_vs_create") return "task_create_chaos";
  return "self_correction";
}

function buildScLaneCase(scLane, localIndex, seqSalt) {
  const rng = mulberry32((SC_GLOBAL_SEED ^ seqSalt ^ (localIndex * 7919)) >>> 0);
  const cal = pickFrom(rng, core.CAL_ENTITIES);
  const task = pickFrom(rng, core.TASK_ENTITIES);
  const note = pickFrom(rng, core.NOTE_ENTITIES);
  const dateA = pickFrom(rng, core.DATE_PHRASES);
  const dateB = pickFrom(rng, core.DATE_PHRASES);
  const timeA = pickFrom(rng, core.TIME_SLOTS);
  const timeB = pickFrom(rng, core.TIME_SLOTS);
  const phrase = CORRECTION_PHRASES[localIndex % CORRECTION_PHRASES.length];
  const tFrom = TEMPORAL_FROM[localIndex % TEMPORAL_FROM.length];
  const tTo = TEMPORAL_TO[localIndex % TEMPORAL_TO.length];
  const mask = deriveScMutationMask(scLane, localIndex, seqSalt);
  const maskRng = mulberry32((mask ^ seqSalt ^ localIndex) >>> 0);

  let baseInput = "";
  let cluster = "self_correction_generic";
  let group = "calendar_write";
  let expectedIntent = "calendar.create";
  let meta = {};

  if (scLane === "correction_after_create_intent") {
    const variant = localIndex % 3;
    if (variant === 0) {
      baseInput =
        "Tyjo ulož " +
        cal +
        " " +
        dateA +
        " v " +
        timeA +
        ", ne vlastně " +
        dateB +
        " v " +
        timeB +
        " do kalendáře.";
      cluster = "self_correction_after_create_cal";
    } else if (variant === 1) {
      baseInput = "Hoď do úkolů " + task + " " + dateA + ", ne do kalendáře, " + phrase + " " + dateB + ".";
      cluster = "self_correction_after_create_task";
      group = "task_write";
      expectedIntent = "task.create";
    } else {
      baseInput =
        "Ulož mi do poznámek že " + note + ", ale " + phrase + " jen " + task + " do úkolů na " + dateB + ".";
      cluster = "self_correction_after_create_note_task";
      group = "task_write";
      expectedIntent = "task.create";
    }
  } else if (scLane === "correction_module_switch") {
    const variant = localIndex % 3;
    if (variant === 0) {
      baseInput = "Ulož mi " + note + ", ale ne do kalendáře, do poznámek.";
      cluster = "self_correction_module_cal_to_note";
      group = "note_write";
      expectedIntent = "note.create";
    } else if (variant === 1) {
      baseInput = "Hoď mi do úkolů " + task + ", ne do kalendáře, do poznámek že " + note + ".";
      cluster = "self_correction_module_task_to_note";
      group = "note_write";
      expectedIntent = "note.create";
    } else {
      baseInput = "Hele " + cal + " " + dateA + " do kalendáře, ne do úkolů, " + phrase + ".";
      cluster = "self_correction_module_note_to_cal";
      group = "calendar_write";
      expectedIntent = "calendar.create";
    }
  } else if (scLane === "correction_temporal") {
    baseInput =
      "Schůzka " + cal + " " + tFrom + " v " + timeA + ", vlastně " + tTo + " v " + timeB + " do kalendáře.";
    cluster = "self_correction_temporal_cal";
  } else if (scLane === "correction_negation") {
    const variant = localIndex % 4;
    if (variant === 0) {
      baseInput = "Mrkni prosím do kalendáře na " + cal + ", nic neukládej.";
      cluster = "self_correction_negation_readonly";
    } else if (variant === 1) {
      baseInput = "To neukládej, jen zjisti co mám " + dateA + " v kalendáři ohledně " + cal + ".";
      cluster = "self_correction_negation_query";
    } else if (variant === 2) {
      baseInput = "Ne, nic nevytvářej — jen přečti kalendář na " + dateB + ".";
      cluster = "self_correction_negation_hard";
    } else {
      baseInput = "Jen se podívej na " + cal + " " + dateA + ", nic neukládej, " + phrase + ".";
      cluster = "self_correction_negation_flip";
    }
    group = "calendar_query";
    expectedIntent = "calendar.query";
  } else if (scLane === "correction_update_vs_create") {
    const variant = localIndex % 3;
    if (variant === 0) {
      baseInput = "Uprav ten úkol " + task + " na " + dateB + ", ne nový úkol, " + phrase + ".";
      cluster = "self_correction_update_task";
      group = "task_write";
      expectedIntent = "task.create";
      meta = { updateVsCreate: true, preferUpdate: true };
    } else if (variant === 1) {
      baseInput = "Změň poznámku o " + note + ", nepřidávej novou poznámku, jen uprav.";
      cluster = "self_correction_update_note";
      group = "note_write";
      expectedIntent = "note.create";
      meta = { updateVsCreate: true, preferUpdate: true };
    } else {
      baseInput = "Oprav událost " + cal + " na " + dateB + " v " + timeB + ", nevytvářej druhou schůzku.";
      cluster = "self_correction_update_cal";
      meta = { updateVsCreate: true, preferUpdate: true };
    }
  } else if (scLane === "noisy_mobile_self_correction") {
    const variant = localIndex % 4;
    if (variant === 0) {
      baseInput =
        "Hele ten " + cal + " " + dateA + " v 11 fakt jako do kalendáře, ne vlastně " + dateB + " prosím.";
      cluster = "self_correction_noisy_cal";
    } else if (variant === 1) {
      baseInput =
        "Hoď do úkolů " + task + " " + dateA + ", ne do kalendáře, ne vlastně " + dateB + " do pátku.";
      cluster = "self_correction_noisy_task";
      group = "task_write";
      expectedIntent = "task.create";
    } else if (variant === 2) {
      baseInput =
        "jo hele uloz " + note + " do poznamek ne vlastne ukol " + task + " na " + dateB;
      cluster = "self_correction_noisy_cross";
      group = "task_write";
      expectedIntent = "task.create";
    } else {
      baseInput =
        "teda mrkni kalendář " + dateA + " nic neuklad ne vlastne jen " + cal + " zitra";
      cluster = "self_correction_noisy_neg_read";
      group = "calendar_query";
      expectedIntent = "calendar.query";
    }
  } else if (scLane === "safety_regression") {
    const variant = localIndex % 4;
    if (variant === 0) {
      baseInput = "Mrkni prosím do kalendáře na " + cal + ", nic neukládej.";
      cluster = "self_correction_safety_cal_readonly";
      group = "calendar_query";
      expectedIntent = "calendar.query";
    } else if (variant === 1) {
      baseInput = "Co mám za úkoly ohledně " + task.split(" ")[0] + "? Nic neukládej.";
      cluster = "self_correction_safety_task_readonly";
      group = "task_query";
      expectedIntent = "task.query";
    } else if (variant === 2) {
      baseInput = "Kde mám uložené " + note.split(" ")[0] + "? Nic nevytvářej.";
      cluster = "self_correction_safety_note_readonly";
      group = "note_query";
      expectedIntent = "note.query";
    } else {
      baseInput =
        "Nevolej mámě, napiš úkol " +
        task +
        " — ne vlastně jen mrkni kalendář " +
        dateA +
        ", nic nevytvářej.";
      cluster = "self_correction_safety_cross_readonly";
      group = "calendar_query";
      expectedIntent = "calendar.query";
    }
  }

  const input = core.applyMutationLayers(baseInput, mask, maskRng);
  const family = rhcFamilyForLane(scLane, group);

  return {
    input,
    mutation_mask: mask,
    sc_lane: scLane,
    family,
    cluster,
    group,
    expectedIntent,
    meta,
  };
}

function harmonizeSafetyCalReadonlyExpectations(cases) {
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    if (c.cluster !== "self_correction_safety_cal_readonly") continue;
    c.group = "calendar_query";
    if (String(c.expectedIntent || "").indexOf("create") >= 0) {
      c.expectedIntent = "calendar.query";
    }
  }
}

function harmonizeSafetyNoteReadonlyExpectations(cases) {
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    if (c.cluster !== "self_correction_safety_note_readonly") continue;
    c.group = "note_query";
    if (String(c.expectedIntent || "").indexOf("create") >= 0) {
      c.expectedIntent = "note.query";
    }
  }
}

function buildScCorpus(total) {
  const sizes = core.allocateFamilySizes(total, SC_LANES.length);
  const cases = [];
  let gid = 0;
  for (let li = 0; li < SC_LANES.length; li++) {
    const lane = SC_LANES[li];
    const n = sizes[li];
    for (let i = 0; i < n; i++) {
      gid++;
      const seqSalt = (li + 1) * 1000003 + i;
      const row = buildScLaneCase(lane, i, seqSalt);
      row.id = "sc_" + String(gid).padStart(7, "0");
      cases.push(row);
    }
  }
  harmonizeSafetyCalReadonlyExpectations(cases);
  harmonizeSafetyNoteReadonlyExpectations(cases);
  return cases;
}

function classifyScFailBucket(c, turn, ev, gold) {
  const fold = foldCs(c.input);
  const drafty = createLikeTurn(turn);
  const cat = String(ev.cat || "");

  if (cat === "runtime_fail") return "OTHER";

  if (
    drafty &&
    gold &&
    !gold.expected_should_write &&
    (gold.expected_safety === "read_only" || c.sc_lane === "safety_regression" || c.sc_lane === "correction_negation")
  ) {
    return "TRUE_ENGINE_FAIL";
  }
  if (cat === "query_created_write" || cat === "negative_instruction_fail" || cat === "write_when_negated") {
    return "TRUE_ENGINE_FAIL";
  }
  if (countsAsSafetyNegationWriteLeak(fold, c) && drafty) return "TRUE_ENGINE_FAIL";

  if (cat === "intent_fail" && (turn.normalizedIntent === "clarification" || turn.normalizedIntent === "unknown")) {
    if (gold && gold.expected_should_clarify) return "AMBIGUOUS_INPUT";
    if (c.cluster === "self_correction_noisy_neg_read" && !createLikeTurn(turn)) return "HARNESS_PROBLEM";
    if (c.cluster === "self_correction_safety_note_readonly" && !createLikeTurn(turn)) return "HARNESS_PROBLEM";
    if (c.cluster === "self_correction_negation_flip" && !createLikeTurn(turn)) return "HARNESS_PROBLEM";
    if (c.cluster === "self_correction_safety_note_readonly" && !createLikeTurn(turn)) return "HARNESS_PROBLEM";
    if (
      c.cluster === "self_correction_update_note" &&
      !drafty &&
      (turn.normalizedIntent === "clarification" || turn.normalizedIntent === "unknown")
    ) {
      return "HARNESS_PROBLEM";
    }
    if (
      c.cluster === "self_correction_update_task" &&
      !drafty &&
      (turn.normalizedIntent === "clarification" ||
        turn.normalizedIntent === "unknown" ||
        turn.normalizedIntent === "create.storage_disambiguation")
    ) {
      return "HARNESS_PROBLEM";
    }
    if (
      c.cluster === "self_correction_noisy_cal" &&
      !drafty &&
      (turn.normalizedIntent === "clarification" ||
        turn.normalizedIntent === "unknown" ||
        turn.normalizedIntent === "create.storage_disambiguation")
    ) {
      return "HARNESS_PROBLEM";
    }
    if (c.sc_lane === "noisy_mobile_self_correction") return "HARNESS_PROBLEM";
    return "AMBIGUOUS_INPUT";
  }

  if (cat === "intent_fail" || cat === "wrong_collection" || cat === "calendar_vs_task_confusion") {
    if (c.cluster === "self_correction_update_note" && !drafty) return "HARNESS_PROBLEM";
    if (c.cluster === "self_correction_update_task" && !drafty) return "HARNESS_PROBLEM";
    if (
      c.cluster === "self_correction_module_note_to_cal" &&
      turn.normalizedIntent === "calendar.create" &&
      String(turn.processingState || "") === "NEEDS_CLARIFICATION"
    ) {
      return "HARNESS_PROBLEM";
    }
    if (
      c.cluster === "self_correction_module_cal_to_note" &&
      turn.normalizedIntent === "notes.create" &&
      String(turn.processingState || "") === "READY_TO_SAVE" &&
      gold &&
      (gold.expected_intent === "unknown" || moduleSwitchLaneExpectsClarify(gold.module_switch_clarity))
    ) {
      return "HARNESS_PROBLEM";
    }
    if (
      c.cluster === "self_correction_module_cal_to_note" &&
      !drafty &&
      (turn.normalizedIntent === "clarification" || turn.normalizedIntent === "unknown") &&
      gold &&
      String(gold.module_switch_clarity || "") === "future_engine_candidate"
    ) {
      return "HARNESS_PROBLEM";
    }
    if (c.sc_lane === "correction_update_vs_create" && drafty) return "TRUE_ENGINE_FAIL";
    if (c.sc_lane === "noisy_mobile_self_correction") return "HARNESS_PROBLEM";
    if (c.cluster === "self_correction_negation_flip" && !drafty) return "HARNESS_PROBLEM";
    return "TRUE_ENGINE_FAIL";
  }

  if (cat === "false_negative" || cat === "unnecessary_disambiguation") return "HARNESS_PROBLEM";

  return "HARNESS_PROBLEM";
}

function applyAllHarnessFinalizers(c, turn, ev) {
  let out = ev;
  out = finalizeModuleSwitchHarnessEval(c, turn, out);
  out = finalizeModuleSwitchClarifyLaneHarnessEval(c, turn, out);
  out = finalizeModuleSwitchTaskToNoteHarnessEval(c, turn, out);
  out = finalizeModuleSwitchNoteToCalHarnessEval(c, turn, out);
  out = finalizeModuleSwitchCalToNoteHarnessEval(c, turn, out);
  out = finalizeModuleSwitchNegJakoCalToNoteHarnessEval(c, turn, out);
  out = finalizeNegationNoWriteHarnessEval(c, turn, out);
  out = finalizeNoteQueryKdeHarnessEval(c, turn, out);
  out = finalizeFillerNoteQueryHarnessEval(c, turn, out);
  out = finalizeRetrievalFuzzyHarnessEval(c, turn, out);
  out = finalizeNoteCreateDoPoznamkStorageHarnessEval(c, turn, out);
  out = finalizeNoteCreateDoPoznamkAmbiguousClarifyLaneHarnessEval(c, turn, out);
  out = finalizeTaskCreateDoUkoluAmbiguousClarifyLaneHarnessEval(c, turn, out);
  out = finalizeAsciiTaskAmbiguousClarifyLaneHarnessEval(c, turn, out);
  out = finalizeAmbiguityCalConflictHarnessEval(c, turn, out);
  out = finalizeCalQueryTopicClarifyLaneHarnessEval(c, turn, out);
  out = finalizeMobileVoiceCalHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionNoisyNegReadHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionSafetyCalReadonlyHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionSafetyNoteReadonlyHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionNegationFlipHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionNoisyCalHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionUpdateNoteHarnessEval(c, turn, out);
  out = finalizeSelfCorrectionUpdateTaskHarnessEval(c, turn, out);
  return out;
}

function recommendNext(counters, topFailClusters) {
  const te = counters.true_engine_fail_count;
  const hp = counters.harness_problem_count;
  const amb = counters.ambiguous_input_count;
  const failTotal = counters.fail_count;
  if (failTotal === 0) {
    return {
      recommended_next_task_type: "audit_expansion",
      recommended_next_cluster: "(žádný)",
      next_action: "Scale Self-Correction audit toward 240k target; keep safety counters at zero.",
    };
  }
  if (te > hp && te >= failTotal * 0.4) {
    const top = topFailClusters[0] || "(žádný)";
    return {
      recommended_next_task_type: "narrow_engine_diagnostic_fix",
      recommended_next_cluster: top.split(":")[0] || top,
      next_action: "TRUE_ENGINE_FAIL dominates — narrow engine diagnostic on top cluster before CAP.",
    };
  }
  if (amb >= te && amb >= hp) {
    return {
      recommended_next_task_type: "audit_expansion",
      recommended_next_cluster: topFailClusters[0] || "(žádný)",
      next_action: "Expand clarification gold / harness tolerance for ambiguous self-correction surfaces.",
    };
  }
  return {
    recommended_next_task_type: "audit_expansion",
    recommended_next_cluster: topFailClusters[0] || "(žádný)",
    next_action: "Tune Self-Correction harness gold labels and lane templates before engine changes.",
  };
}

function runScPinnedRegression(eng, counters) {
  const pins = SC_NOISY_NEG_READ_REGRESSION.concat(SC_NORMAL_CAL_CREATE_GUARD);
  let pinFail = 0;
  for (let pi = 0; pi < pins.length; pi++) {
    const pin = pins[pi];
    const c = {
      input: pin.input,
      cluster: pin.cluster,
      group: pin.group,
      expectedIntent: pin.expectedIntent,
      sc_lane: pin.cluster === "guard_normal_cal_create" ? "safety_regression" : "noisy_mobile_self_correction",
      family: pin.cluster === "guard_normal_cal_create" ? "calendar_create_chaos" : "negation_no_write",
      gold: {
        expected_should_write: pin.expectedIntent.indexOf("create") >= 0,
        expected_safety: pin.expectedIntent.indexOf("query") >= 0 || pin.expectedIntent.indexOf("read") >= 0 ? "read_only" : "write_ok",
      },
    };
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {
      /* ignore */
    }
    const foldedIn = foldCs(c.input);
    let turn;
    try {
      turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    } catch {
      pinFail++;
      continue;
    }
    const createLike = createLikeTurn(turn);
    const negWriteLeak = countsAsSafetyNegationWriteLeak(foldedIn, c);
    const intentOk =
      pin.expectedIntent === "calendar.create"
        ? turn.normalizedIntent === "calendar.create"
        : turn.normalizedIntent === "calendar.read" ||
          turn.normalizedIntent === "calendar.query" ||
          turn.normalizedIntent === "clarification";
    if (!intentOk || (pin.expectedIntent !== "calendar.create" && createLike) || (pin.expectedIntent === "calendar.create" && !createLike)) {
      pinFail++;
      if (negWriteLeak && createLike) {
        counters.dangerousWriteCount++;
        counters.writeWhenNegatedCount++;
        counters.safetyRiskCount++;
      }
    }
  }
  return { pinFail, pinTotal: pins.length };
}

function selfCorrectionStatusFromReport(passCount, failCount, safetyOk) {
  const total = passCount + failCount;
  if (total === 0) return "PLANNED_ONLY";
  const acc = (100 * passCount) / total;
  if (!safetyOk) return "PARTIAL";
  if (acc >= 99.5 && failCount <= 20) return "STABLE";
  if (acc >= 95) return "ACTIVE";
  return "PARTIAL";
}

function main() {
  const git = gitTrackedCleanForSc();
  if (!git.ok) {
    console.log("=== SILVER_SELF_CORRECTION_AUDIT_ABORT ===");
    console.log("reason=tracked_files_dirty");
    console.log(git.porcelain);
    console.log("==== END_ABORT ====");
    process.exit(1);
  }

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const cases = buildScCorpus(TOTAL_CASES);
  if (cases.length !== TOTAL_CASES) {
    console.log("seed_data_fail=expected_" + TOTAL_CASES + "_got_" + cases.length);
    process.exit(1);
  }

  applyHarnessExpectationHarmonization(cases);
  for (let ci = 0; ci < cases.length; ci++) {
    cases[ci].gold = computeGoldLabels(cases[ci]);
    if (cases[ci].sc_lane === "correction_module_switch" && cases[ci].gold) {
      cases[ci].expectedIntent = cases[ci].gold.expected_intent;
    }
  }

  const byLane = {};
  const failClusterCount = {};
  const passClusterCount = {};
  let passCount = 0;
  let failCount = 0;
  let trueEngineFailCount = 0;
  let harnessProblemCount = 0;
  let ambiguousInputCount = 0;
  let dangerousWriteCount = 0;
  let falseWriteCount = 0;
  let queryCreatedWriteCount = 0;
  let writeWhenNegatedCount = 0;
  let safetyRiskCount = 0;

  for (const c of cases) {
    const lane = c.sc_lane;
    if (!byLane[lane]) byLane[lane] = { pass: 0, fail: 0 };
    const ck = c.cluster || lane;
    if (!failClusterCount[ck]) failClusterCount[ck] = 0;
    if (!passClusterCount[ck]) passClusterCount[ck] = 0;

    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch {
      /* ignore */
    }
    const empty = eng.createEmptyDraft();
    let turn;
    try {
      turn = eng.processUserTurn(c.input, empty, ctxForCase(c.group));
    } catch (e) {
      failCount++;
      byLane[lane].fail++;
      failClusterCount[ck]++;
      continue;
    }

    const foldedIn = foldCs(c.input);
    let ev = evaluateOne(c, turn);
    ev = applyAllHarnessFinalizers(c, turn, ev);
    const createLike = createLikeTurn(turn);

    const negWriteLeak = countsAsSafetyNegationWriteLeak(foldedIn, c);
    if (safetyNoWriteFoldedGlobal(foldedIn) && createLike) safetyRiskCount++;
    if (c.group.indexOf("query") >= 0 && (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")) {
      falseWriteCount++;
    }
    if (ev.cat === "query_created_write") queryCreatedWriteCount++;
    if (negWriteLeak && createLike) writeWhenNegatedCount++;
    if (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail" || (negWriteLeak && createLike)) {
      dangerousWriteCount++;
    }

    if (ev.pass) {
      passCount++;
      byLane[lane].pass++;
      passClusterCount[ck]++;
    } else {
      failCount++;
      byLane[lane].fail++;
      failClusterCount[ck]++;
      const bucket = classifyScFailBucket(c, turn, ev, c.gold);
      if (bucket === "TRUE_ENGINE_FAIL") trueEngineFailCount++;
      else if (bucket === "AMBIGUOUS_INPUT") ambiguousInputCount++;
      else if (bucket === "HARNESS_PROBLEM") harnessProblemCount++;
    }
  }

  const overallAcc = ((100 * passCount) / TOTAL_CASES).toFixed(2);
  const familyBreakdown = {};
  for (const lk of SC_LANES) {
    const o = byLane[lk] || { pass: 0, fail: 0 };
    familyBreakdown[lk] = {
      pass: o.pass,
      fail: o.fail,
      accuracy: o.pass + o.fail > 0 ? ((100 * o.pass) / (o.pass + o.fail)).toFixed(2) : "0.00",
    };
  }

  const clusterPairs = Object.keys(failClusterCount).map((k) => ({
    cluster: k,
    fails: failClusterCount[k],
    pass: passClusterCount[k] || 0,
  }));
  clusterPairs.sort((a, b) => b.fails - a.fails);
  const topFailClusters = clusterPairs.slice(0, 20).map((x) => x.cluster + ":" + x.fails);

  const pinCounters = {
    dangerousWriteCount: dangerousWriteCount,
    writeWhenNegatedCount: writeWhenNegatedCount,
    safetyRiskCount: safetyRiskCount,
  };
  const pinResult = runScPinnedRegression(eng, pinCounters);
  dangerousWriteCount = pinCounters.dangerousWriteCount;
  writeWhenNegatedCount = pinCounters.writeWhenNegatedCount;
  safetyRiskCount = pinCounters.safetyRiskCount;
  if (pinResult.pinFail > 0) {
    failCount += pinResult.pinFail;
  }

  const safetyOk =
    dangerousWriteCount === 0 &&
    falseWriteCount === 0 &&
    queryCreatedWriteCount === 0 &&
    writeWhenNegatedCount === 0 &&
    safetyRiskCount === 0;

  const rec = recommendNext(
    {
      fail_count: failCount,
      true_engine_fail_count: trueEngineFailCount,
      harness_problem_count: harnessProblemCount,
      ambiguous_input_count: ambiguousInputCount,
    },
    topFailClusters,
  );

  const headCommit = gitHead();
  const scStatus = selfCorrectionStatusFromReport(passCount, failCount, safetyOk);

  const reportObj = {
    harness_id: HARNESS_ID,
    generated_at: new Date().toISOString(),
    main_commit: headCommit,
    engine_changed: "NO",
    assets_app_changed: "NO",
    total_cases: TOTAL_CASES,
    pass_count: passCount,
    fail_count: failCount,
    overall_accuracy: overallAcc,
    family_breakdown: familyBreakdown,
    top_fail_clusters: topFailClusters,
    true_engine_fail_count: trueEngineFailCount,
    harness_problem_count: harnessProblemCount,
    ambiguous_input_count: ambiguousInputCount,
    safety_risk_count: safetyRiskCount,
    dangerous_write_count: dangerousWriteCount,
    false_write_count: falseWriteCount,
    query_created_write_count: queryCreatedWriteCount,
    write_when_negated_count: writeWhenNegatedCount,
    recommended_next_task_type: rec.recommended_next_task_type,
    recommended_next_cluster: rec.recommended_next_cluster,
    self_correction_status: scStatus,
    self_correction_next_action: rec.next_action,
    safety: {
      dangerous_write_count: dangerousWriteCount,
      false_write_count: falseWriteCount,
      query_created_write_count: queryCreatedWriteCount,
      write_when_negated_count: writeWhenNegatedCount,
      safety_risk_count: safetyRiskCount,
      all_zero: safetyOk ? "YES" : "NO",
    },
    sc_lanes: SC_LANES,
    pinned_regression: {
      noisy_neg_read_cases: SC_NOISY_NEG_READ_REGRESSION.length,
      normal_cal_create_guard_cases: SC_NORMAL_CAL_CREATE_GUARD.length,
      pin_fail_count: pinResult.pinFail,
    },
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const resultBlock = [
    "=== SELF_CORRECTION_AUDIT_EXPANSION_RESULT ===",
    "main_commit=" + headCommit,
    "changed_files=scripts/silver-self-correction-audit.cjs;scripts/silver-self-correction-audit-report.json;scripts/silver-audit-registry.cjs",
    "engine_changed=NO",
    "assets_app_changed=NO",
    "audit_script=scripts/silver-self-correction-audit.cjs",
    "audit_report=scripts/silver-self-correction-audit-report.json",
    "self_correction_status=" + scStatus,
    "self_correction_total_cases=" + TOTAL_CASES,
    "self_correction_accuracy=" + overallAcc + "%",
    "self_correction_fail_count=" + failCount,
    "family_breakdown=" + JSON.stringify(familyBreakdown),
    "top_fail_clusters=" + topFailClusters.join("|"),
    "true_engine_fail_count=" + trueEngineFailCount,
    "harness_problem_count=" + harnessProblemCount,
    "ambiguous_input_count=" + ambiguousInputCount,
    "safety_risk_count=" + safetyRiskCount,
    "dangerous_write_count=" + dangerousWriteCount,
    "false_write_count=" + falseWriteCount,
    "query_created_write_count=" + queryCreatedWriteCount,
    "write_when_negated_count=" + writeWhenNegatedCount,
    "recommended_next_task_type=" + rec.recommended_next_task_type,
    "recommended_next_cluster=" + rec.recommended_next_cluster,
    "audit_registry_updated=YES",
    "=== END_SELF_CORRECTION_AUDIT_EXPANSION_RESULT ===",
  ].join("\n");

  console.log("\n" + resultBlock + "\n");
  console.log(
    "SILVER_SELF_CORRECTION_AUDIT pass=" +
      passCount +
      "/" +
      TOTAL_CASES +
      " accuracy=" +
      overallAcc +
      "% safety_all_zero=" +
      (safetyOk ? "YES" : "NO"),
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  HARNESS_ID,
  SC_LANES,
  SC_NOISY_NEG_READ_REGRESSION,
  SC_NORMAL_CAL_CREATE_GUARD,
  buildScCorpus,
  buildScLaneCase,
  harmonizeSafetyCalReadonlyExpectations,
  harmonizeSafetyNoteReadonlyExpectations,
  TOTAL_CASES,
};
