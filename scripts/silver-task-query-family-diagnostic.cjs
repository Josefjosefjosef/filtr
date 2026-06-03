#!/usr/bin/env node
"use strict";

/**
 * SILVER TASK QUERY FAMILY DIAGNOSTIC — read-only.
 * Families: A) task overview query variants, B) concrete task item search.
 * No engine edits. Writes silver-task-query-family-report.json.
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(__dirname, "silver-task-query-family-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const READ_TASK_MODULES = new Set(["tasks.read", "tasks.query", "global.search"]);

const FIXED_NOW = new Date(2026, 5, 3, 12, 0, 0);

const OVERVIEW_FAMILY = [
  { id: "OV_01", input: "Jaké mám úkoly", expected: "tasks.read", expectKind: "active_list" },
  { id: "OV_02", input: "Co mám za úkoly", expected: "tasks.read", expectKind: "active_list" },
  { id: "OV_03", input: "Co mám v úkolech", expected: "tasks.read", expectKind: "active_list" },
  { id: "OV_04", input: "Jaké mám aktivní úkoly", expected: "tasks.read", expectKind: "active_list" },
  { id: "OV_05", input: "Co mám ještě udělat", expected: "tasks.read", expectKind: "active_list" },
  { id: "OV_06", input: "Co mě čeká", expected: "tasks.read", expectKind: "active_list" },
  { id: "OV_07", input: "Jaké mám hotové úkoly", expected: "tasks.read", expectKind: "status_done" },
  { id: "OV_08", input: "Co mám rozdělané", expected: "tasks.read", expectKind: "status_in_progress" },
  { id: "OV_09", input: "Jaké mám nesplněné úkoly", expected: "tasks.read", expectKind: "status_todo" }
];

const ITEM_SEARCH_FAMILY = [
  {
    id: "IS_01",
    input: "Kdy mám zaplatit nájem",
    expected: "tasks.read",
    taskId: "t_najem",
    entityRx: /najem|nájem/i,
    valueRx: /5\.|6\.|2026|12:00|termín|bez termínu/i
  },
  {
    id: "IS_02",
    input: "Co mám koupit mámě",
    expected: "tasks.read",
    taskId: "t_mama",
    entityRx: /m[aá]m[eě]|darek/i,
    valueRx: /Koupit d[aá]rek m[aá]m[eě]|m[aá]m[eě]/i,
    forbidBulkList: true
  },
  {
    id: "IS_03",
    input: "Kdy mám vyzvednout Eli",
    expected: "tasks.read",
    taskId: "t_eli",
    entityRx: /eli/i,
    valueRx: /4\.|6\.|15:30|termín/i
  },
  {
    id: "IS_04",
    input: "Co mám udělat s právníkem",
    expected: "tasks.read",
    taskId: "t_pravnik",
    entityRx: /pravn|právn/i,
    valueRx: /pravnik|právník|smlouv/i
  },
  {
    id: "IS_05",
    input: "Kdy mám zavolat doktorovi",
    expected: "tasks.read",
    taskId: "t_doktor",
    entityRx: /doktor/i,
    valueRx: /6\.|9:00|termín|zavolat doktorovi/i
  },
  {
    id: "IS_06",
    input: "Co mám zařídit kolem auta",
    expected: "tasks.read",
    taskId: "t_auto",
    entityRx: /aut|stk|pojist/i,
    valueRx: /auta|STK|pojist/i
  },
  {
    id: "IS_07",
    input: "Kdy mám koupit dárek",
    expected: "tasks.read",
    taskId: "t_darek",
    entityRx: /d[aá]rek|narozenin/i,
    valueRx: /narozenin|10\.|koupit darek k/i,
    wrongEntityRx: /^Našel jsem úkol: Koupit darek mame\./i
  }
];

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

function seedTasks() {
  return [
    {
      id: "t_najem",
      title: "Zaplatit nájem",
      status: "todo",
      dueAt: "2026-06-05",
      dueTime: "12:00",
      note: "",
      priority: "medium",
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: "t_mama",
      title: "Koupit dárek mámě",
      status: "todo",
      dueAt: null,
      dueTime: null,
      note: "",
      priority: "medium",
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: "t_eli",
      title: "Vyzvednout Eli ze školy",
      status: "todo",
      dueAt: "2026-06-04",
      dueTime: "15:30",
      note: "",
      priority: "high",
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: "t_pravnik",
      title: "Zavolat právníkovi ohledně smlouvy",
      status: "in_progress",
      dueAt: null,
      dueTime: null,
      note: "",
      priority: "medium",
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: "t_doktor",
      title: "Zavolat doktorovi",
      status: "todo",
      dueAt: "2026-06-06",
      dueTime: "09:00",
      note: "",
      priority: "medium",
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: "t_auto",
      title: "Zařídit STK a pojištění auta",
      status: "todo",
      dueAt: null,
      dueTime: null,
      note: "",
      priority: "medium",
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: "t_darek",
      title: "Koupit dárek k narozeninám",
      status: "todo",
      dueAt: "2026-06-10",
      dueTime: null,
      note: "",
      priority: "medium",
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: "t_done",
      title: "Objednat toner",
      status: "done",
      dueAt: null,
      dueTime: null,
      note: "",
      priority: "low",
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: "t_prog",
      title: "Dokončit prezentaci",
      status: "in_progress",
      dueAt: null,
      dueTime: null,
      note: "",
      priority: "high",
      createdAt: 1,
      updatedAt: 1
    }
  ];
}

function seedCtx() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return seedTasks();
    },
    getNotesSnapshot: function () {
      return [];
    }
  };
}

function intentMatchesTaskRead(intent) {
  return READ_TASK_MODULES.has(String(intent || ""));
}

function isBulkTaskList(msg) {
  return /M[aá][šs]\s+\d+\s+aktivn[ií]\s+úkoly/i.test(msg) || /:\s*1\.\s+/i.test(msg);
}

function evaluateOverviewPass(c, intent, msg) {
  const issues = [];
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
  if (!intentMatchesTaskRead(intent)) issues.push("wrong_module:" + intent);
  if (!msg.trim() || /Nic jsem k tomu nenašel/i.test(msg)) issues.push("empty_response");
  if (c.expectKind === "status_done") {
    if (!/Objednat toner|hotov/i.test(msg)) issues.push("status_done_miss");
  }
  if (c.expectKind === "status_in_progress") {
    if (isBulkTaskList(msg) || !/prezentac|rozd[eě]lan|in.?progress|pravnik/i.test(msg)) {
      issues.push("status_in_progress_miss");
    }
  }
  if (c.expectKind === "status_todo") {
    if (isBulkTaskList(msg)) issues.push("status_todo_miss");
  }
  return issues;
}

function evaluateItemPass(c, intent, msg) {
  const issues = [];
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
  if (intent === "calendar.read") issues.push("calendar_steal");
  if (intent === "notes.read") issues.push("note_steal");
  if (!intentMatchesTaskRead(intent)) issues.push("wrong_module:" + intent);
  if (!msg.trim() || /Nic jsem k tomu nenašel/i.test(msg)) issues.push("empty_response");
  if (c.forbidBulkList && isBulkTaskList(msg)) issues.push("bulk_list_not_entity");
  if (c.entityRx && intentMatchesTaskRead(intent) && !c.entityRx.test(msg)) issues.push("entity_miss");
  if (c.valueRx && intentMatchesTaskRead(intent) && !c.valueRx.test(msg)) issues.push("value_miss");
  if (c.wrongEntityRx && c.wrongEntityRx.test(msg.split("\n")[0].trim())) issues.push("wrong_ranked_task");
  return issues;
}

function classifyOverview(c, intent, msg, issues) {
  const f = foldCs(c.input);
  if (issues.indexOf("write_leak") >= 0) {
    return { classification: "TRUE_ENGINE_FAIL", rootCause: "query_write_leak" };
  }
  if (issues.some(function (x) {
    return x.indexOf("wrong_module:notes.read") === 0;
  })) {
    if (/\bza\s+ukol/.test(f) || /\baktivn/.test(f)) {
      return { classification: "SYNONYM_GAP", rootCause: "overview_phrase_missing_task_module_cue" };
    }
    return { classification: "TRUE_ENGINE_FAIL", rootCause: "note_module_steals_task_overview" };
  }
  if (issues.some(function (x) {
    return x.indexOf("wrong_module:global.search") === 0;
  })) {
    return { classification: "SYNONYM_GAP", rootCause: "vague_future_queue_not_mapped_to_tasks" };
  }
  if (issues.indexOf("empty_response") >= 0) {
    return { classification: "SYNONYM_GAP", rootCause: "overview_empty_read_answer" };
  }
  if (issues.indexOf("status_in_progress_miss") >= 0 || issues.indexOf("status_todo_miss") >= 0) {
    return { classification: "RETRIEVAL_FAIL", rootCause: "task_status_filter_not_applied" };
  }
  if (issues.length === 0) {
    return { classification: "SAFE_CLARIFICATION_OK", rootCause: "overview_ok" };
  }
  return { classification: "HARNESS_GAP", rootCause: issues.join("|") };
}

function classifyItem(c, intent, msg, issues) {
  const f = foldCs(c.input);
  if (issues.indexOf("write_leak") >= 0) {
    return { classification: "TRUE_ENGINE_FAIL", rootCause: "query_write_leak" };
  }
  if (issues.indexOf("calendar_steal") >= 0) {
    return { classification: "TRUE_ENGINE_FAIL", rootCause: "kdy_cue_routed_to_calendar_not_task_deadline" };
  }
  if (issues.indexOf("note_steal") >= 0) {
    if (/\bpravn/.test(f) || /\bkolem\s+aut/.test(f)) {
      return { classification: "TRUE_ENGINE_FAIL", rootCause: "entity_task_query_note_steal" };
    }
    return { classification: "TRUE_ENGINE_FAIL", rootCause: "note_module_steals_task_item_search" };
  }
  if (issues.indexOf("bulk_list_not_entity") >= 0) {
    return { classification: "RETRIEVAL_FAIL", rootCause: "entity_query_returns_full_task_list" };
  }
  if (issues.indexOf("wrong_ranked_task") >= 0) {
    return { classification: "RETRIEVAL_FAIL", rootCause: "task_search_rank_wrong_candidate" };
  }
  if (issues.indexOf("empty_response") >= 0) {
    return { classification: "RETRIEVAL_FAIL", rootCause: "task_item_empty_after_route" };
  }
  if (issues.indexOf("entity_miss") >= 0 || issues.indexOf("value_miss") >= 0) {
    return { classification: "RETRIEVAL_FAIL", rootCause: "task_entity_not_surfaced_in_answer" };
  }
  if (issues.length === 0) {
    return { classification: "SAFE_CLARIFICATION_OK", rootCause: "item_search_ok" };
  }
  if (intent === "clarification" || intent === "unknown") {
    return { classification: "AMBIGUITY", rootCause: "clarification_on_concrete_task_fixture" };
  }
  return { classification: "HARNESS_GAP", rootCause: issues.join("|") };
}

function runCase(eng, ctx, family, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const issues =
    family === "overview"
      ? evaluateOverviewPass(c, intent, msg)
      : evaluateItemPass(c, intent, msg);
  const pass = issues.length === 0;
  const cls =
    family === "overview"
      ? classifyOverview(c, intent, msg, issues)
      : classifyItem(c, intent, msg, issues);
  return {
    id: c.id,
    family: family,
    INPUT: c.input,
    EXPECTED: c.expected,
    ACTUAL: intent,
    MODULE: intent,
    NORMALIZED_INTENT: intent,
    RESPONSE: msg.slice(0, 320),
    PROCESSING_STATE: String(turn.processingState || ""),
    ISSUES: issues,
    PASS: pass,
    ROOT_CAUSE: cls.rootCause,
    CLASSIFICATION: cls.classification
  };
}

function countBy(rows, key) {
  const m = {};
  for (let i = 0; i < rows.length; i++) {
    const k = rows[i][key] || "unknown";
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function topClusters(rows) {
  const m = countBy(rows, "ROOT_CAUSE");
  const arr = Object.keys(m)
    .map(function (k) {
      const subset = rows.filter(function (r) {
        return r.ROOT_CAUSE === k;
      });
      const productFail = subset.filter(function (r) {
        return (
          r.CLASSIFICATION === "TRUE_ENGINE_FAIL" || r.CLASSIFICATION === "RETRIEVAL_FAIL"
        );
      }).length;
      let severity = "LOW";
      if (productFail >= 3) severity = "HIGH";
      else if (productFail >= 1) severity = "MEDIUM";
      return {
        ROOT_CAUSE: k,
        COUNT: m[k],
        SEVERITY: severity,
        TRUE_PRODUCT_FAIL_COUNT: productFail,
        CLASSIFICATIONS: countBy(subset, "CLASSIFICATION")
      };
    })
    .sort(function (a, b) {
      return b.COUNT - a.COUNT;
    });
  return arr.slice(0, 5);
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function pathFromPorcelain(line) {
  const raw = String(line || "").trim();
  if (raw.length < 4) return raw.replace(/\\/g, "/");
  return raw.slice(3).trim().replace(/\\/g, "/");
}

function gitCleanExceptAllow(allowRel) {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const allow = allowRel.map(function (p) {
      return p.replace(/\\/g, "/");
    });
    const bad = lines.filter(function (l) {
      const pathPart = pathFromPorcelain(l);
      for (let i = 0; i < allow.length; i++) {
        if (pathPart === allow[i] || pathPart.endsWith("/" + allow[i])) return false;
      }
      return true;
    });
    return bad.length === 0 ? "YES" : "NO";
  } catch {
    return "NO";
  }
}

function parse20kTaskQuery(out) {
  const m = /task_query=(\d+)\/3000/.exec(String(out || ""));
  return m ? m[1] + "/3000" : "UNKNOWN";
}

function parse20kSafety(out) {
  const m = /query_created_write_count=(\d+)/.exec(String(out || ""));
  return m ? Number(m[1]) : -1;
}

function runGate(rel) {
  const script = path.join(REPO, rel);
  const r = spawnSync(process.execPath, [script], {
    cwd: REPO,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

function runNpm(scriptName) {
  const r = spawnSync("npm", ["run", scriptName], {
    cwd: REPO,
    encoding: "utf8",
    stdio: "pipe",
    shell: true,
    maxBuffer: 32 * 1024 * 1024
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

function recommendNextScope(counts, clusters) {
  const calSteal = counts.TRUE_ENGINE_FAIL || 0;
  const retrieval = counts.RETRIEVAL_FAIL || 0;
  const synonym = counts.SYNONYM_GAP || 0;
  if (calSteal >= 3) {
    return "P1: task deadline read must win over calendar.read for kdy-mám + task-entity tails; then entity note-steal carve-outs";
  }
  if (retrieval >= 4) {
    return "P1: task item retrieval ranking + optional task-read fallback search (mirror note fallback pattern)";
  }
  if (synonym >= 2) {
    return "P1: task overview synonym normalization (za úkoly, aktivní úkoly, co mě čeká)";
  }
  return "P2: narrow synonym pass; validate with expanded harness before engine changes";
}

function main() {
  const eng = loadEngine();
  const ctx = seedCtx();
  const overviewRows = [];
  const itemRows = [];

  for (let i = 0; i < OVERVIEW_FAMILY.length; i++) {
    overviewRows.push(runCase(eng, ctx, "overview", OVERVIEW_FAMILY[i]));
  }
  for (let j = 0; j < ITEM_SEARCH_FAMILY.length; j++) {
    itemRows.push(runCase(eng, ctx, "item_search", ITEM_SEARCH_FAMILY[j]));
  }

  const allRows = overviewRows.concat(itemRows);
  const classCounts = countBy(allRows, "CLASSIFICATION");
  const clusters = topClusters(allRows);
  const overviewPass = overviewRows.filter(function (r) {
    return r.PASS;
  }).length;
  const itemPass = itemRows.filter(function (r) {
    return r.PASS;
  }).length;

  const report = {
    generatedAt: new Date().toISOString(),
    mainCommit: mainCommit(),
    engineChanged: false,
    filesCreated: [
      "scripts/silver-task-query-family-diagnostic.cjs",
      "scripts/silver-task-query-family-report.json"
    ],
    overview_family: overviewRows,
    item_search_family: itemRows,
    classification_counts: classCounts,
    top_clusters: clusters,
    summary: {
      overview_pass: overviewPass + "/" + overviewRows.length,
      item_search_pass: itemPass + "/" + itemRows.length,
      TRUE_ENGINE_FAIL_COUNT: classCounts.TRUE_ENGINE_FAIL || 0,
      RETRIEVAL_FAIL_COUNT: classCounts.RETRIEVAL_FAIL || 0,
      SYNONYM_GAP_COUNT: classCounts.SYNONYM_GAP || 0,
      AMBIGUITY_COUNT: classCounts.AMBIGUITY || 0,
      HARNESS_GAP_COUNT: classCounts.HARNESS_GAP || 0,
      GOLD_LABEL_PROBLEM_COUNT: classCounts.GOLD_LABEL_PROBLEM || 0,
      SAFE_CLARIFICATION_OK_COUNT: classCounts.SAFE_CLARIFICATION_OK || 0
    },
    recommendations: {
      A_synonyms_sufficient:
        (classCounts.SYNONYM_GAP || 0) > 0 &&
        (classCounts.TRUE_ENGINE_FAIL || 0) <= (classCounts.SYNONYM_GAP || 0)
          ? "PARTIAL — overview phrases bez explicitního „úkol“ potřebují synonym mapu"
          : "NO — wrong-module steals převažují nad čistými synonymy",
      B_task_fallback_search_needed:
        (classCounts.RETRIEVAL_FAIL || 0) >= 3
          ? "YES — entity dotazy vrací bulk list nebo špatný kandidát; fallback search by pomohl"
          : "MAYBE — jen pokud routing opraven",
      C_task_overview_normalization_needed:
        overviewPass < overviewRows.length
          ? "YES — status filtry (rozdělané/nesplněné) a vague queue (co mě čeká)"
          : "LOW",
      D_gold_harness_only:
        (classCounts.HARNESS_GAP || 0) + (classCounts.GOLD_LABEL_PROBLEM || 0) >
        (classCounts.TRUE_ENGINE_FAIL || 0) + (classCounts.RETRIEVAL_FAIL || 0)
          ? "LIKELY"
          : "NO — produkční routing/retrieval fail dominuje"
    }
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const runProof = process.argv.indexOf("--proof") >= 0;
  let smoke = "SKIPPED";
  let taskQuery20k = "SKIPPED";
  let noteRetrieval = "SKIPPED";
  let prodProof = "SKIPPED";
  let safetyCounters = "SKIPPED";
  let gitClean = gitCleanExceptAllow([
    "scripts/silver-task-query-family-diagnostic.cjs",
    "scripts/silver-task-query-family-report.json"
  ]);

  if (runProof) {
    const s1 = runNpm("smoke");
    smoke = s1.ok ? "PASS" : "FAIL";
    const s2 = runGate("scripts/audit_silver_20000_routing_stable.cjs");
    taskQuery20k = parse20kTaskQuery(s2.out);
    const s3 = runGate("scripts/silver-note-answer-quality-fallback-diagnostic.cjs");
    noteRetrieval = s3.ok ? "PASS" : "FAIL";
    let safetySum = allRows.filter(function (r) {
      return r.ISSUES && r.ISSUES.indexOf("write_leak") >= 0;
    }).length;
    try {
      const nr = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "silver-note-answer-quality-fallback-report.json"),
          "utf8"
        )
      );
      if (nr.safety_family) {
        for (let si = 0; si < nr.safety_family.length; si++) {
          if (!nr.safety_family[si].pass) safetySum++;
        }
      }
    } catch (eN) {
      void eN;
    }
    safetyCounters = String(safetySum);
    const s4 = runNpm("silver-prod-proof");
    prodProof = s4.ok ? "PASS" : "FAIL";
    const noteSideReport = path.join(__dirname, "silver-note-answer-quality-fallback-report.json");
    try {
      if (fs.existsSync(noteSideReport)) fs.unlinkSync(noteSideReport);
    } catch (eDel) {
      void eDel;
    }
    gitClean = gitCleanExceptAllow([
      "scripts/silver-task-query-family-diagnostic.cjs",
      "scripts/silver-task-query-family-report.json"
    ]);
  }

  const passFail =
    !runProof ||
    (smoke === "PASS" &&
      taskQuery20k === "3000/3000" &&
      noteRetrieval === "PASS" &&
      prodProof === "PASS" &&
      safetyCounters === "0" &&
      gitClean === "YES")
      ? "PASS"
      : "FAIL";

  console.log("=== SILVER_TASK_QUERY_DIAGNOSTIC ===");
  console.log("MAIN_COMMIT=" + report.mainCommit);
  console.log("ENGINE_CHANGED=false");
  console.log("FILES_CREATED=scripts/silver-task-query-family-diagnostic.cjs,scripts/silver-task-query-family-report.json");
  for (let c = 0; c < Math.min(5, clusters.length); c++) {
    const cl = clusters[c];
    console.log("TOP_CLUSTER_" + (c + 1) + "=" + cl.ROOT_CAUSE);
    console.log("COUNT=" + cl.COUNT);
    console.log("SEVERITY=" + cl.SEVERITY);
    console.log("TRUE_PRODUCT_FAIL_COUNT=" + cl.TRUE_PRODUCT_FAIL_COUNT);
    console.log("ROOT_CAUSE=" + cl.ROOT_CAUSE);
  }
  for (let c = clusters.length; c < 5; c++) {
    console.log("TOP_CLUSTER_" + (c + 1) + "=(none)");
    console.log("COUNT=0");
    console.log("ROOT_CAUSE=(none)");
  }
  console.log(
    "TASK_OVERVIEW_STATUS=" +
      overviewPass +
      "/" +
      overviewRows.length +
      " pass (" +
      (overviewRows.length - overviewPass) +
      " fail)"
  );
  console.log(
    "TASK_ITEM_SEARCH_STATUS=" +
      itemPass +
      "/" +
      itemRows.length +
      " pass (" +
      (itemRows.length - itemPass) +
      " fail)"
  );
  console.log("TRUE_ENGINE_FAIL_COUNT=" + (classCounts.TRUE_ENGINE_FAIL || 0));
  console.log("RETRIEVAL_FAIL_COUNT=" + (classCounts.RETRIEVAL_FAIL || 0));
  console.log("SYNONYM_GAP_COUNT=" + (classCounts.SYNONYM_GAP || 0));
  console.log("AMBIGUITY_COUNT=" + (classCounts.AMBIGUITY || 0));
  console.log("HARNESS_GAP_COUNT=" + (classCounts.HARNESS_GAP || 0));
  console.log("GOLD_LABEL_PROBLEM_COUNT=" + (classCounts.GOLD_LABEL_PROBLEM || 0));
  console.log("RECOMMENDED_NEXT_SCOPE=" + recommendNextScope(classCounts, clusters));
  console.log("SMOKE=" + smoke);
  console.log("TASK_QUERY_20K=" + taskQuery20k);
  console.log("NOTE_RETRIEVAL=" + noteRetrieval);
  console.log("PROD_PROOF=" + prodProof);
  console.log("SAFETY_COUNTERS=" + safetyCounters);
  console.log("GIT_CLEAN=" + gitClean);
  console.log("PASS_FAIL=" + passFail);
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_SILVER_TASK_QUERY_DIAGNOSTIC ===");

  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  OVERVIEW_FAMILY: OVERVIEW_FAMILY,
  ITEM_SEARCH_FAMILY: ITEM_SEARCH_FAMILY,
  seedCtx: seedCtx,
  runCase: runCase
};
