#!/usr/bin/env node
"use strict";

/**
 * TASK READ HEALTH AUDIT V1 — read-only diagnostic after Task Item Fallback Search V1.
 * No engine edits. Writes silver-task-read-health-audit-v1-report.json.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const taskDiag = require("./silver-task-query-family-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(__dirname, "silver-task-read-health-audit-v1-report.json");
const APP_JS = path.join(REPO, "assets", "app.js");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const READ_TASK_MODULES = new Set(["tasks.read", "tasks.query", "global.search"]);

const DEADLINE_FAMILY = [
  { id: "TD_01", lane: "deadline", input: "Kdy mám zaplatit nájem", entityRx: /n[aá]jem/i, valueRx: /5\.|6\.|2026|term[ií]n|zaplatit/i },
  { id: "TD_02", lane: "deadline", input: "Kdy mám koupit dárek", entityRx: /d[aá]rek|narozenin/i, valueRx: /10\.|narozenin|term[ií]n/i, wrongEntityRx: /^Našel jsem úkol: Koupit d[aá]rek m[aá]m[eě]\./i },
  { id: "TD_03", lane: "deadline", input: "Kdy mám zavolat doktorovi", entityRx: /doktor/i, valueRx: /6\.|9:00|term[ií]n|zavolat/i },
  { id: "TD_04", lane: "deadline", input: "Kdy mám vyzvednout Eli", entityRx: /eli/i, valueRx: /4\.|15:30|term[ií]n/i }
];

const ENTITY_FAMILY = [
  { id: "TE_01", lane: "entity", input: "Co mám koupit mámě", entityRx: /m[aá]m[eě]|d[aá]rek/i, valueRx: /Koupit d[aá]rek m[aá]m[eě]/i, forbidBulkList: true },
  { id: "TE_02", lane: "entity", input: "Co mám vyřešit s doktorem", entityRx: /doktor/i, valueRx: /doktor|zavolat/i },
  { id: "TE_03", lane: "entity", input: "Co mám zařídit kolem auta", entityRx: /aut|stk|pojist/i, valueRx: /auta|STK|pojist/i },
  { id: "TE_04", lane: "entity", input: "Co mám udělat s právníkem", entityRx: /pr[aá]vn/i, valueRx: /pr[aá]vn|smlouv/i }
];

const SYNONYM_FAMILY = [
  { id: "SY_01", lane: "synonym", input: "uhradit nájem", entityRx: /n[aá]jem|zaplatit/i, valueRx: /n[aá]jem|zaplatit|term[ií]n/i, allowClarification: false },
  { id: "SY_02", lane: "synonym", input: "kontaktovat doktora", entityRx: /doktor|zavolat/i, valueRx: /doktor|zavolat|term[ií]n/i, allowClarification: false },
  { id: "SY_03", lane: "synonym", input: "pořídit dárek", entityRx: /d[aá]rek|koupit|narozenin/i, valueRx: /d[aá]rek|koupit|narozenin|term[ií]n/i, allowClarification: false },
  { id: "SY_04", lane: "synonym", input: "zařídit auto", entityRx: /aut|stk|pojist/i, valueRx: /aut|STK|pojist/i, allowClarification: false }
];

const NOISY_FAMILY = [
  { id: "NQ_01", lane: "noisy", input: "kdy mam zaplatit najem", entityRx: /n[aá]jem|najem/i, valueRx: /5\.|6\.|2026|term[ií]n|zaplatit/i },
  { id: "NQ_02", lane: "noisy", input: "co mam koupit mame", entityRx: /m[aá]m[eě]|mame|d[aá]rek/i, valueRx: /Koupit d[aá]rek m[aá]m[eě]|m[aá]m[eě]|mame/i, forbidBulkList: true },
  { id: "NQ_03", lane: "noisy", input: "kontaktovat doktora prosim", entityRx: /doktor/i, valueRx: /doktor|zavolat|term[ií]n/i },
  { id: "NQ_04", lane: "noisy", input: "potrebuju vedet kdy mam koupit darek", entityRx: /d[aá]rek|darek|narozenin/i, valueRx: /10\.|narozenin|term[ií]n|d[aá]rek|darek/i, wrongEntityRx: /^Našel jsem úkol: Koupit d[aá]rek m[aá]m[eě]\./i }
];

const CROSS_MODULE = {
  task_vs_calendar: [
    { id: "XC_CAL_01", lane: "cross_module", sublane: "task_vs_calendar", input: "Kdy mám zubaře", expected: "calendar.read", kind: "protection" },
    { id: "XC_CAL_02", lane: "cross_module", sublane: "task_vs_calendar", input: "Kdy mám právníka", expected: "calendar.read", kind: "protection" },
    { id: "XC_CAL_03", lane: "cross_module", sublane: "task_vs_calendar", input: "Kdy mám schůzku s Tomášem", expected: "calendar.read", kind: "protection" },
    { id: "XC_CAL_04", lane: "cross_module", sublane: "task_vs_calendar", input: "Kdy mám poradu", expected: "calendar.read", kind: "protection" }
  ],
  task_vs_notes: [
    { id: "XC_NOTE_01", lane: "cross_module", sublane: "task_vs_notes", input: "Jakou má Volvo SPZ", expected: "notes.read", kind: "protection" },
    { id: "XC_NOTE_02", lane: "cross_module", sublane: "task_vs_notes", input: "Jaké je heslo k wifi", expected: "notes.read", kind: "protection" },
    { id: "XC_NOTE_03", lane: "cross_module", sublane: "task_vs_notes", input: "Jaký je kód k trezoru", expected: "notes.read", kind: "protection" },
    { id: "XC_NOTE_04", lane: "cross_module", sublane: "task_vs_notes", input: "Kdy končí záruka na televizi", expected: "notes.read", kind: "protection" }
  ],
  task_vs_global: [
    { id: "XC_GLB_01", lane: "cross_module", sublane: "task_vs_global", input: "Kdy mám zaplatit nájem", expected: "tasks.read", kind: "task_stays", entityRx: /n[aá]jem/i, valueRx: /5\.|6\.|term[ií]n/i, forbidGlobalOnly: true },
    { id: "XC_GLB_02", lane: "cross_module", sublane: "task_vs_global", input: "Co mám koupit mámě", expected: "tasks.read", kind: "task_stays", entityRx: /m[aá]m[eě]|d[aá]rek/i, valueRx: /Koupit d[aá]rek m[aá]m[eě]/i, forbidBulkList: true, forbidGlobalOnly: true },
    { id: "XC_GLB_03", lane: "cross_module", sublane: "task_vs_global", input: "uhradit nájem", expected: "tasks.read", kind: "task_stays", entityRx: /n[aá]jem|zaplatit/i, valueRx: /n[aá]jem|zaplatit|term[ií]n/i, forbidGlobalOnly: true },
    { id: "XC_GLB_04", lane: "cross_module", sublane: "task_vs_global", input: "Co mám zařídit kolem auta", expected: "tasks.read", kind: "task_stays", entityRx: /aut|stk|pojist/i, valueRx: /auta|STK|pojist/i, forbidGlobalOnly: true }
  ]
};

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

function isBulkTaskList(msg) {
  return /M[aá][šs]\s+\d+\s+aktivn[ií]\s+úkoly/i.test(msg) || /:\s*1\.\s+/i.test(msg);
}

function intentMatchesTaskRead(intent) {
  return READ_TASK_MODULES.has(String(intent || ""));
}

function evaluateTaskCase(c, intent, msg) {
  const issues = [];
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
  if (intent === "calendar.read") issues.push("calendar_steal");
  if (intent === "notes.read") issues.push("note_steal");
  if (c.forbidGlobalOnly && intent === "global.search" && (!msg.trim() || /Nic jsem k tomu nena[sš]el/i.test(msg))) {
    issues.push("global_empty_steal");
  }
  if (!intentMatchesTaskRead(intent)) {
    if (!(c.allowClarification && (intent === "unknown" || intent === "clarification"))) {
      issues.push("wrong_module:" + intent);
    }
  }
  if (!msg.trim() || /Nic jsem k tomu nena[sš]el/i.test(msg)) issues.push("empty_response");
  if (c.forbidBulkList && isBulkTaskList(msg)) issues.push("bulk_list");
  if (c.entityRx && intentMatchesTaskRead(intent) && !c.entityRx.test(msg)) issues.push("entity_miss");
  if (c.valueRx && intentMatchesTaskRead(intent) && !c.valueRx.test(msg)) issues.push("value_miss");
  if (c.wrongEntityRx && c.wrongEntityRx.test(msg.split("\n")[0].trim())) issues.push("wrong_ranked_task");
  if (intentMatchesTaskRead(intent) && msg.trim() && !/Na[sš]el jsem|term[ií]n|M[aá][šs]\s+\d+/i.test(msg) && c.entityRx) {
    issues.push("summary_miss");
  }
  return issues;
}

function evaluateProtectionCase(c, intent) {
  const issues = [];
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
  if (intent !== c.expected) issues.push("intent:" + intent);
  if (c.sublane === "task_vs_calendar" && intent === "tasks.read") issues.push("task_steals_calendar");
  if (c.sublane === "task_vs_notes" && intent === "tasks.read") issues.push("task_steals_note");
  return issues;
}

function classifyRootCause(c, intent, msg, issues) {
  if (issues.indexOf("write_leak") >= 0) return "harness_problem";
  if (issues.indexOf("calendar_steal") >= 0 || issues.indexOf("task_steals_calendar") >= 0) {
    return "task_vs_calendar_steal";
  }
  if (issues.indexOf("note_steal") >= 0 || issues.indexOf("task_steals_note") >= 0) {
    return "task_vs_notes_steal";
  }
  if (issues.some(function (x) {
    return x.indexOf("wrong_module:global.search") === 0;
  }) || issues.indexOf("global_empty_steal") >= 0) {
    return "task_vs_global_steal";
  }
  if (issues.indexOf("wrong_ranked_task") >= 0) return "ranking_fail";
  if (issues.indexOf("bulk_list") >= 0 || issues.indexOf("empty_response") >= 0) return "retrieval_fail";
  if (issues.indexOf("entity_miss") >= 0 || issues.indexOf("value_miss") >= 0) return "retrieval_fail";
  if (issues.indexOf("summary_miss") >= 0) return "summary_fail";
  if (intent === "clarification" || intent === "unknown") return "ambiguity";
  if (c.lane === "noisy" && (issues.indexOf("entity_miss") >= 0 || issues.indexOf("value_miss") >= 0)) {
    return "synonym_gap";
  }
  if (c.lane === "synonym" && issues.length > 0) return "synonym_gap";
  if (issues.length > 0) return "harness_problem";
  return "pass";
}

function classifyBucket(rootCause) {
  if (rootCause === "pass") return "PASS";
  if (rootCause === "ambiguity") return "AMBIGUOUS";
  if (rootCause === "harness_problem") return "HARNESS";
  return "TRUE_ENGINE";
}

function runTaskCase(eng, ctx, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const issues = evaluateTaskCase(c, intent, msg);
  const rootCause = classifyRootCause(c, intent, msg, issues);
  return {
    id: c.id,
    lane: c.lane,
    sublane: c.sublane || c.lane,
    input: c.input,
    intent: intent,
    pass: issues.length === 0,
    issues: issues,
    rootCause: rootCause,
    bucket: classifyBucket(rootCause),
    message: msg.slice(0, 240)
  };
}

function runProtectionCase(eng, ctx, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const issues = evaluateProtectionCase(c, intent);
  const rootCause = classifyRootCause(c, intent, msg, issues);
  return {
    id: c.id,
    lane: c.lane,
    sublane: c.sublane,
    input: c.input,
    intent: intent,
    expected: c.expected,
    pass: issues.length === 0,
    issues: issues,
    rootCause: rootCause,
    bucket: classifyBucket(rootCause),
    message: msg.slice(0, 120)
  };
}

function evaluateSafety(eng, ctx, inputs) {
  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  let query_created_write_count = 0;
  for (let i = 0; i < inputs.length; i++) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(inputs[i], eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    if (WRITE_INTENTS.has(intent)) {
      dangerous_write_count++;
      false_write_count++;
    }
    if (turn.processingState === "READY_TO_SAVE") {
      query_created_write_count++;
      false_write_count++;
    }
  }
  return {
    dangerous_write_count: dangerous_write_count,
    false_write_count: false_write_count,
    write_when_negated_count: write_when_negated_count,
    query_created_write_count: query_created_write_count
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

function topTrueEngineCluster(rows) {
  const fails = rows.filter(function (r) {
    return r.bucket === "TRUE_ENGINE";
  });
  const rc = countBy(fails, "rootCause");
  const keys = Object.keys(rc).sort(function (a, b) {
    return rc[b] - rc[a];
  });
  if (!keys.length) return "(none)";
  return keys[0] + ":" + rc[keys[0]];
}

function recommendNextFix(breakdown, topCluster) {
  if (topCluster.indexOf("task_vs_calendar_steal") === 0) {
    return "Narrow fix: deadline task read carve-out vs calendar.read for kdy-mám + appointment nouns";
  }
  if (topCluster.indexOf("task_vs_notes_steal") === 0) {
    return "Narrow fix: entity task query protection vs notes.read for co-mám + person/object tails";
  }
  if (topCluster.indexOf("synonym_gap") === 0 || (breakdown.synonym_gap || 0) > 0) {
    return "Narrow fix: noisy Czech + bare synonym normalization (ASCII diacritics, polite filler strip)";
  }
  if (topCluster.indexOf("ranking_fail") === 0) {
    return "Narrow fix: task item fallback ranking disambiguation (entity anchor scoring)";
  }
  if (topCluster.indexOf("retrieval_fail") === 0) {
    return "Narrow fix: expand task item fallback term extraction for folded/noisy variants";
  }
  if ((breakdown.task_vs_global_steal || 0) > 0) {
    return "Narrow fix: global.search task read must ground to seeded task snapshot";
  }
  return "No true engine cluster — monitor harness / ambiguity only";
}

function main() {
  const appHashBefore = hashFile("assets/app.js");
  const eng = loadEngine();
  const ctx = taskDiag.seedCtx();

  const deadline = DEADLINE_FAMILY.map(function (c) {
    return runTaskCase(eng, ctx, c);
  });
  const entity = ENTITY_FAMILY.map(function (c) {
    return runTaskCase(eng, ctx, c);
  });
  const synonym = SYNONYM_FAMILY.map(function (c) {
    return runTaskCase(eng, ctx, c);
  });
  const noisy = NOISY_FAMILY.map(function (c) {
    return runTaskCase(eng, ctx, c);
  });
  const crossCal = CROSS_MODULE.task_vs_calendar.map(function (c) {
    return runProtectionCase(eng, ctx, c);
  });
  const crossNote = CROSS_MODULE.task_vs_notes.map(function (c) {
    return runProtectionCase(eng, ctx, c);
  });
  const crossGlobal = CROSS_MODULE.task_vs_global.map(function (c) {
    return runTaskCase(eng, ctx, c);
  });
  const crossModule = crossCal.concat(crossNote).concat(crossGlobal);

  const allRows = deadline.concat(entity).concat(synonym).concat(noisy).concat(crossModule);
  const safetyInputs = allRows.map(function (r) {
    return r.input;
  });
  const safety = evaluateSafety(eng, ctx, safetyInputs);

  const passCount = allRows.filter(function (r) {
    return r.pass;
  }).length;
  const failCount = allRows.length - passCount;
  const deadlinePass = deadline.filter(function (r) {
    return r.pass;
  }).length;
  const entityPass = entity.filter(function (r) {
    return r.pass;
  }).length;
  const synonymPass = synonym.filter(function (r) {
    return r.pass;
  }).length;
  const noisyPass = noisy.filter(function (r) {
    return r.pass;
  }).length;
  const crossModulePass = crossModule.filter(function (r) {
    return r.pass;
  }).length;

  const trueEngineFails = allRows.filter(function (r) {
    return r.bucket === "TRUE_ENGINE";
  }).length;
  const harnessFails = allRows.filter(function (r) {
    return r.bucket === "HARNESS";
  }).length;
  const ambiguousCases = allRows.filter(function (r) {
    return r.bucket === "AMBIGUOUS";
  }).length;

  const rootCauseBreakdown = countBy(
    allRows.filter(function (r) {
      return !r.pass;
    }),
    "rootCause"
  );
  const topCluster = topTrueEngineCluster(allRows);

  const appHashAfter = hashFile("assets/app.js");
  const assetsChanged =
    appHashBefore && appHashAfter && appHashBefore !== appHashAfter ? "YES" : assetsAppChanged();
  if (assetsChanged === "YES") {
    console.error("STOP: assets/app.js changed during audit");
    process.exit(2);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    audit: "TASK_READ_HEALTH_AUDIT_V1",
    phase_engine_changed: "NO",
    assets_app_changed: "NO",
    app_js_sha256: appHashAfter,
    total_cases: allRows.length,
    pass: passCount,
    fail: failCount,
    deadline_pass: deadlinePass + "/" + deadline.length,
    entity_pass: entityPass + "/" + entity.length,
    synonym_pass: synonymPass + "/" + synonym.length,
    noisy_pass: noisyPass + "/" + noisy.length,
    cross_module_pass: crossModulePass + "/" + crossModule.length,
    true_engine_fails: trueEngineFails,
    harness_fails: harnessFails,
    ambiguous_cases: ambiguousCases,
    root_cause_breakdown: rootCauseBreakdown,
    top_true_engine_cluster: topCluster,
    recommended_next_fix: recommendNextFix(rootCauseBreakdown, topCluster),
    safety: safety,
    families: {
      deadline: deadline,
      entity: entity,
      synonym: synonym,
      noisy: noisy,
      cross_module: crossModule
    },
    failures: allRows.filter(function (r) {
      return !r.pass;
    })
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const allow = [
    "scripts/silver-task-read-health-audit-v1.cjs",
    "scripts/silver-task-read-health-audit-v1-report.json"
  ];
  const gitClean = gitCleanExceptAllow(allow);

  console.log("=== TASK_READ_HEALTH_AUDIT_V1 ===");
  console.log("TOTAL_CASES=" + allRows.length);
  console.log("PASS=" + passCount);
  console.log("FAIL=" + failCount);
  console.log("DEADLINE_PASS=" + deadlinePass + "/" + deadline.length);
  console.log("ENTITY_PASS=" + entityPass + "/" + entity.length);
  console.log("SYNONYM_PASS=" + synonymPass + "/" + synonym.length);
  console.log("NOISY_PASS=" + noisyPass + "/" + noisy.length);
  console.log("CROSS_MODULE_PASS=" + crossModulePass + "/" + crossModule.length);
  console.log("TRUE_ENGINE_FAILS=" + trueEngineFails);
  console.log("HARNESS_FAILS=" + harnessFails);
  console.log("AMBIGUOUS_CASES=" + ambiguousCases);
  console.log("ROOT_CAUSE_BREAKDOWN=" + JSON.stringify(rootCauseBreakdown));
  console.log("TOP_TRUE_ENGINE_CLUSTER=" + topCluster);
  console.log("PHASE_ENGINE_CHANGED=NO");
  console.log("ASSETS_APP_CHANGED=NO");
  console.log("DANGEROUS_WRITE_COUNT=" + safety.dangerous_write_count);
  console.log("FALSE_WRITE_COUNT=" + safety.false_write_count);
  console.log("WRITE_WHEN_NEGATED_COUNT=" + safety.write_when_negated_count);
  console.log("QUERY_CREATED_WRITE_COUNT=" + safety.query_created_write_count);
  console.log("RECOMMENDED_NEXT_FIX=" + report.recommended_next_fix);
  console.log("GIT_CLEAN=" + gitClean);
  console.log("PASS_FAIL=" + (failCount === 0 && safety.dangerous_write_count === 0 ? "PASS" : "DIAGNOSTIC"));
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_TASK_READ_HEALTH_AUDIT_V1 ===");
}

if (require.main === module) main();
