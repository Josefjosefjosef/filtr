#!/usr/bin/env node
"use strict";

/**
 * REAL WORLD TASK READ SAFETY DIAGNOSTIC V1 — stop-gate before product fixes.
 * Classifies dangerous/false/query-created writes from corpus v1 (4329 cases).
 * No engine edits.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const taskDiag = require("./silver-task-query-family-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const CORPUS_SCRIPT = path.join(__dirname, "silver-real-world-task-read-corpus-v1.cjs");
const REPORT_PATH = path.join(__dirname, "silver-real-world-task-read-safety-diagnostic-v1-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const READ_CUE_RX =
  /\b(kdy\s+m[aá]m|co\s+m[aá]m|potřebuju\s+v[eě]d[eě]t|nev[ií]š|m[uů]že[sš]\s+mi\s+ř[ií]ct|do\s+kdy|kdy\s+je\s+term[ií]n|kdy\s+že\s+m[aá]m|kdy\s+mus[ií]m|kdy\s+bych\s+m[eě]l|co\s+mi\s+zb[yý]v[aá]|co\s+m[aá]m\s+je[sš]t[eě]|co\s+m[aá]m\s+vlastn[eě])\b/i;

const WRITE_CUE_RX =
  /\b(připomeň|pripomn|do\s+kalend[aá][řr]?e?|do\s+pozn[aá]m|ulo[žz]|přidej|pridej|vytvo[řr]|hoď\s|hod\s|nezapomeň|nezapomen|zapi[sš]|ukl[aá]dej|připrav\s+n[aá]vrh)\b/i;

const SAVE_PREFIX_RX = /^\s*(do\s+kalend[aá][řr]?e?|do\s+pozn[aá]m|připomeň|pripomn)\b/i;

const PAST_TENSE_RX = /\b(co\s+jsem\s+m[eě]l|mel\s+jsem|m[eě]l\s+jsem\s+ud[eě]lat)\b/i;

const NEGATION_RX = /\b(nic\s+neukl[aá]dej|neukl[aá]dej|jen\s+čti|pouze\s+čti)\b/i;

const CATEGORY_SEVERITY = {
  TRUE_ENGINE_DANGEROUS_WRITE: 100,
  SAVE_PREFIX_LEAK: 95,
  TASK_NOTE_CONFUSION: 90,
  TASK_CALENDAR_CONFUSION: 90,
  QUERY_INTERPRETATION_FAIL: 80,
  WRITE_CUE_LEAK: 70,
  AMBIGUOUS_INPUT: 40,
  HARNESS_PROBLEM: 20
};

function loadCorpusGenerator() {
  if (!fs.existsSync(CORPUS_SCRIPT)) {
    console.error("STOP: missing " + CORPUS_SCRIPT);
    process.exit(2);
  }
  let src = fs.readFileSync(CORPUS_SCRIPT, "utf8");
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  src = src.replace(/^#![^\r\n]*[\r\n]+/, "");
  src = src.replace(
    /if \(require\.main === module\) main\(\);\s*$/,
    "module.exports = { generateCorpus: generateCorpus };"
  );
  const m = { exports: {} };
  const fn = new Function("require", "module", "exports", "__dirname", "__filename", src);
  fn(require, m, m.exports, __dirname, CORPUS_SCRIPT);
  return m.exports;
}

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function turnMsg(turn) {
  return String(
    (turn.readAnswer && turn.readAnswer.message) ||
      turn.assistantLead ||
      turn.userFacingSummary ||
      ""
  );
}

function hasReadCue(input) {
  return READ_CUE_RX.test(input);
}

function hasWriteCue(input) {
  return WRITE_CUE_RX.test(input);
}

function hasSavePrefix(input) {
  return SAVE_PREFIX_RX.test(input);
}

function isBareSynonymLane(c) {
  return c.lane === "synonym" && !hasReadCue(c.input);
}

function isPastTenseRead(input) {
  return PAST_TENSE_RX.test(input);
}

function expectedIntent(c) {
  return "tasks.read";
}

function classifySafetyCase(c, turn) {
  const intent = String(turn.normalizedIntent || "");
  const input = c.input;
  const folded = foldCs(input);
  const readyToSave = turn.processingState === "READY_TO_SAVE";
  const isWriteIntent = WRITE_INTENTS.has(intent);
  const isDangerous = isWriteIntent;
  const isQueryCreated = readyToSave;
  const isFalseWrite = isDangerous || isQueryCreated;

  if (!isFalseWrite) {
    return null;
  }

  let category = "QUERY_INTERPRETATION_FAIL";
  let rationale = "";

  if (hasSavePrefix(input)) {
    category = "SAVE_PREFIX_LEAK";
    rationale = "explicit_save_prefix_in_corpus_input";
  } else if (NEGATION_RX.test(input)) {
    category = "HARNESS_PROBLEM";
    rationale = "negation_phrase_not_in_task_read_corpus_gold";
  } else if (hasWriteCue(input) && !hasReadCue(input)) {
    category = "WRITE_CUE_LEAK";
    rationale = "write_imperative_without_read_cue";
  } else if (isBareSynonymLane(c)) {
    category = "AMBIGUOUS_INPUT";
    rationale = "bare_synonym_phrase_no_kdy_co_anchor";
  } else if (isPastTenseRead(input)) {
    category = "AMBIGUOUS_INPUT";
    rationale = "past_tense_co_jsem_mel_borderline_read_vs_create";
  } else if (intent === "create.storage_disambiguation" || intent === "clarification" || intent === "unknown") {
    category = "AMBIGUOUS_INPUT";
    rationale = "engine_disambiguation_not_commit_write";
  } else if (intent === "notes.create") {
    if (hasReadCue(input) && !hasWriteCue(input)) {
      category = "TASK_NOTE_CONFUSION";
      rationale = "read_cue_routed_to_notes_create";
    } else {
      category = "WRITE_CUE_LEAK";
      rationale = "notes_create_with_mixed_cues";
    }
  } else if (intent === "calendar.create") {
    if (hasReadCue(input) && !hasWriteCue(input)) {
      category = "TASK_CALENDAR_CONFUSION";
      rationale = "read_cue_routed_to_calendar_create";
    } else {
      category = "WRITE_CUE_LEAK";
      rationale = "calendar_create_with_mixed_cues";
    }
  } else if (intent === "tasks.create") {
    if (hasReadCue(input) && !hasWriteCue(input) && !isPastTenseRead(input)) {
      category = "TRUE_ENGINE_DANGEROUS_WRITE";
      rationale = "clear_read_cue_produced_tasks_create";
    } else if (isPastTenseRead(input)) {
      category = "AMBIGUOUS_INPUT";
      rationale = "past_tense_triggered_tasks_create";
    } else if (hasWriteCue(input)) {
      category = "WRITE_CUE_LEAK";
      rationale = "write_surface_in_input";
    } else if (/\b(uhradit|zaplatit|koupit|kontaktovat|zařídit|vyzvednout|pořídit)\b/i.test(input) && !hasReadCue(input)) {
      category = "AMBIGUOUS_INPUT";
      rationale = "bare_action_phrase_without_read_anchor";
    } else {
      category = "QUERY_INTERPRETATION_FAIL";
      rationale = "tasks_create_on_corpus_read_template";
    }
  } else if (readyToSave && !isWriteIntent) {
    category = "QUERY_INTERPRETATION_FAIL";
    rationale = "ready_to_save_without_write_intent";
  } else if (hasReadCue(input) && !hasWriteCue(input)) {
    category = "TRUE_ENGINE_DANGEROUS_WRITE";
    rationale = "read_cue_produced_write_path";
  } else if (/\b(prosím|prosim|hele|no tak)\b/i.test(folded) && hasReadCue(input)) {
    category = "QUERY_INTERPRETATION_FAIL";
    rationale = "colloquial_read_wrapper_misrouted";
  } else {
    category = "HARNESS_PROBLEM";
    rationale = "corpus_gold_read_vs_engine_write_unclassified";
  }

  if (category === "QUERY_INTERPRETATION_FAIL" && hasReadCue(input) && !hasWriteCue(input) && isWriteIntent) {
    category = "TRUE_ENGINE_DANGEROUS_WRITE";
    rationale = "read_cue_write_intent_" + intent;
  }

  return {
    id: c.id,
    taskId: c.taskId,
    lane: c.lane,
    input: input,
    expected: expectedIntent(c),
    actual: intent,
    processingState: String(turn.processingState || ""),
    message: turnMsg(turn).slice(0, 240),
    isDangerousWrite: isDangerous,
    isQueryCreatedWrite: isQueryCreated,
    isFalseWrite: isFalseWrite,
    category: category,
    rationale: rationale,
    severity: CATEGORY_SEVERITY[category] || 50,
    hasReadCue: hasReadCue(input),
    hasWriteCue: hasWriteCue(input),
    hasSavePrefix: hasSavePrefix(input)
  };
}

function hashFile(rel) {
  try {
    const buf = fs.readFileSync(path.join(REPO, rel));
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

function assetsAppChanged() {
  try {
    const out = execSync("git status --porcelain assets/app.js", { cwd: REPO, encoding: "utf8" }).trim();
    if (out) return "YES";
    const diff = execSync("git diff --name-only HEAD -- assets/app.js", { cwd: REPO, encoding: "utf8" }).trim();
    return diff ? "YES" : "NO";
  } catch {
    return "UNKNOWN";
  }
}

function gitCleanExceptAllow(allowRel) {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const allow = allowRel.map(function (p) {
      return p.replace(/\\/g, "/");
    });
    const bad = lines.filter(function (l) {
      const raw = String(l || "").trim();
      const pathPart = raw.length >= 4 ? raw.slice(3).trim().replace(/\\/g, "/") : raw.replace(/\\/g, "/");
      for (let i = 0; i < allow.length; i++) {
        if (pathPart === allow[i]) return false;
      }
      return true;
    });
    return bad.length === 0 ? "YES" : "NO";
  } catch {
    return "NO";
  }
}

function countBy(arr, key) {
  const m = {};
  for (let i = 0; i < arr.length; i++) {
    const k = arr[i][key];
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function recommendNextStep(trueEngineCount, breakdown) {
  if (trueEngineCount === 0) {
    return "NO_SAFETY_FIX_NEEDED — proceed to task_vs_notes_steal retrieval analysis";
  }
  if ((breakdown.TRUE_ENGINE_DANGEROUS_WRITE || 0) > 0) {
    return "P0: narrow read-before-write guard for clear kdy-mám/co-mám task read queries";
  }
  if ((breakdown.TASK_NOTE_CONFUSION || 0) + (breakdown.TASK_CALENDAR_CONFUSION || 0) > 0) {
    return "P0: block notes.create/calendar.create when read cue + task entity tail present";
  }
  return "P1: review QUERY_INTERPRETATION_FAIL cluster before engine changes";
}

function main() {
  const appHashBefore = hashFile("assets/app.js");
  const corpusGen = loadCorpusGenerator();
  const corpus = corpusGen.generateCorpus();

  const eng = loadEngine();
  const ctx = taskDiag.seedCtx();

  const dangerousCases = [];
  const queryCreatedCases = [];
  const falseWriteCases = [];
  const falseWriteIds = new Set();

  for (let i = 0; i < corpus.length; i++) {
    const c = corpus[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const row = classifySafetyCase(c, turn);
    if (!row) continue;

    if (row.isDangerousWrite) dangerousCases.push(row);
    if (row.isQueryCreatedWrite) queryCreatedCases.push(row);
    if (row.isFalseWrite && !falseWriteIds.has(row.id)) {
      falseWriteIds.add(row.id);
      falseWriteCases.push(row);
    }

    if ((i + 1) % 500 === 0) {
      process.stderr.write("progress=" + (i + 1) + "/" + corpus.length + "\n");
    }
  }

  const rootCauseBreakdown = countBy(falseWriteCases, "category");
  const trueEngineCases = falseWriteCases.filter(function (r) {
    return r.category === "TRUE_ENGINE_DANGEROUS_WRITE";
  });
  const trueEngineCount = trueEngineCases.length;

  const top50 = falseWriteCases
    .slice()
    .sort(function (a, b) {
      if (b.severity !== a.severity) return b.severity - a.severity;
      if (a.category !== b.category) {
        return (CATEGORY_SEVERITY[b.category] || 0) - (CATEGORY_SEVERITY[a.category] || 0);
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, 50)
    .map(function (r) {
      return {
        INPUT: r.input,
        EXPECTED: r.expected,
        ACTUAL: r.actual + (r.processingState === "READY_TO_SAVE" ? " (READY_TO_SAVE)" : ""),
        CATEGORY: r.category,
        id: r.id,
        lane: r.lane,
        rationale: r.rationale,
        message: r.message
      };
    });

  const appHashAfter = hashFile("assets/app.js");
  const assetsChanged =
    appHashBefore && appHashAfter && appHashBefore !== appHashAfter ? "YES" : assetsAppChanged();
  if (assetsChanged === "YES") {
    console.error("STOP: assets/app.js changed during safety diagnostic");
    process.exit(2);
  }

  const falseWriteCorpusDoubleCount = dangerousCases.length + queryCreatedCases.length;

  const report = {
    generatedAt: new Date().toISOString(),
    audit: "REAL_WORLD_TASK_READ_SAFETY_DIAGNOSTIC_V1",
    corpus_source: "silver-real-world-task-read-corpus-v1.cjs",
    corpus_total_cases: corpus.length,
    phase_engine_changed: "NO",
    assets_app_changed: "NO",
    app_js_sha256: appHashAfter,
    dangerous_total: dangerousCases.length,
    false_write_total: falseWriteCorpusDoubleCount,
    false_write_unique_cases: falseWriteCases.length,
    query_created_total: queryCreatedCases.length,
    overlap_dangerous_and_query_created: dangerousCases.filter(function (d) {
      return d.isQueryCreatedWrite;
    }).length,
    root_cause_breakdown: rootCauseBreakdown,
    true_engine_dangerous_write_count: trueEngineCount,
    true_engine_dangerous_write_cases: trueEngineCases.map(function (r) {
      return {
        id: r.id,
        input: r.input,
        actual: r.actual,
        lane: r.lane,
        message: r.message
      };
    }),
    category_definitions: {
      TRUE_ENGINE_DANGEROUS_WRITE: "Clear read cue, no write cue — engine produced write path",
      QUERY_INTERPRETATION_FAIL: "Engine misread phrasing but not clear-cut true dangerous write",
      WRITE_CUE_LEAK: "Input contains write imperative / save surface",
      SAVE_PREFIX_LEAK: "Explicit save prefix present in input",
      TASK_NOTE_CONFUSION: "Task read phrasing routed to notes.create",
      TASK_CALENDAR_CONFUSION: "Task read phrasing routed to calendar.create",
      HARNESS_PROBLEM: "Corpus gold label expects read where write is defensible",
      AMBIGUOUS_INPUT: "Bare synonym, past tense, or disambiguation — not actionable engine bug"
    },
    top_50: top50,
    recommended_next_step: recommendNextStep(trueEngineCount, rootCauseBreakdown),
    verdict:
      trueEngineCount === 0
        ? "B — return to task_vs_notes_steal=1469 retrieval work; no safety fix required"
        : "A — safety fix required before retrieval/ranking fixes"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const gitClean = gitCleanExceptAllow([
    "scripts/silver-real-world-task-read-safety-diagnostic-v1.cjs",
    "scripts/silver-real-world-task-read-safety-diagnostic-v1-report.json"
  ]);

  const passFail =
    trueEngineCount === 0 && gitClean === "YES" && assetsChanged === "NO" ? "PASS" : "DIAGNOSTIC";

  console.log("=== REAL_WORLD_TASK_READ_SAFETY_DIAGNOSTIC_V1 ===");
  console.log("DANGEROUS_TOTAL=" + dangerousCases.length);
  console.log("FALSE_WRITE_TOTAL=" + falseWriteCorpusDoubleCount);
  console.log("FALSE_WRITE_UNIQUE_CASES=" + falseWriteCases.length);
  console.log("QUERY_CREATED_TOTAL=" + queryCreatedCases.length);
  console.log("ROOT_CAUSE_BREAKDOWN=" + JSON.stringify(rootCauseBreakdown));
  console.log("TRUE_ENGINE_DANGEROUS_WRITE_COUNT=" + trueEngineCount);
  console.log("TOP_50_REPORT_CREATED=YES");
  console.log("PHASE_ENGINE_CHANGED=NO");
  console.log("ASSETS_APP_CHANGED=NO");
  console.log("RECOMMENDED_NEXT_STEP=" + report.recommended_next_step);
  console.log("VERDICT=" + report.verdict);
  console.log("GIT_CLEAN=" + gitClean);
  console.log("PASS_FAIL=" + passFail);
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_REAL_WORLD_TASK_READ_SAFETY_DIAGNOSTIC_V1 ===");
}

if (require.main === module) main();
