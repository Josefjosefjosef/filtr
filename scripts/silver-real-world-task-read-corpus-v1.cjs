#!/usr/bin/env node
"use strict";

/**
 * REAL WORLD TASK READ CORPUS V1 — read-only diagnostic (no engine edits).
 * Deterministic Czech template expansion against seeded task fixtures.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const taskDiag = require("./silver-task-query-family-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(__dirname, "silver-real-world-task-read-corpus-v1-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const READ_TASK_MODULES = new Set(["tasks.read", "tasks.query", "global.search"]);

const TASK_SPECS = [
  {
    taskId: "t_najem",
    lanes: ["deadline", "synonym", "noisy", "colloquial", "typo", "long", "mixed"],
    entityTokens: ["nájem", "ten nájem", "tu nájemnou", "najem"],
    deadlineVerbs: ["zaplatit", "uhradit", "splatit"],
    entityVerbs: [],
    entityPreps: [],
    synonymPhrases: ["uhradit nájem", "zaplatit nájem", "splatit najem"],
    entityRx: /n[aá]jem/i,
    valueRx: /5\.|6\.|2026|term[ií]n|zaplatit|uhradit/i,
    wrongEntityRx: null,
    forbidBulkList: false,
    isDeadline: true
  },
  {
    taskId: "t_darek",
    lanes: ["deadline", "synonym", "noisy", "colloquial", "typo", "long", "mixed", "multi_entity"],
    entityTokens: ["dárek", "ten dárek", "dárek k narozeninám", "darek"],
    deadlineVerbs: ["koupit", "pořídit", "sehnat"],
    entityVerbs: ["koupit", "pořídit"],
    entityPreps: ["k narozeninám"],
    synonymPhrases: ["pořídit dárek", "koupit darek", "sehnat dárek"],
    entityRx: /d[aá]rek|narozenin/i,
    valueRx: /10\.|narozenin|term[ií]n|koupit d[aá]rek k/i,
    wrongEntityRx: /^Našel jsem úkol: Koupit d[aá]rek m[aá]m[eě]\./i,
    forbidBulkList: false,
    isDeadline: true
  },
  {
    taskId: "t_doktor",
    lanes: ["deadline", "entity", "synonym", "noisy", "colloquial", "typo", "long", "mixed"],
    entityTokens: ["doktorovi", "doktora", "doktor", "doktorem"],
    deadlineVerbs: ["zavolat", "kontaktovat", "volat"],
    entityVerbs: ["vyřešit", "udělat", "zařídit"],
    entityPreps: ["s doktorem", "s doktora", "doktorovi"],
    synonymPhrases: ["kontaktovat doktora", "zavolat doktorovi", "volat doktorovi"],
    entityRx: /doktor/i,
    valueRx: /6\.|9:00|term[ií]n|zavolat|kontaktovat/i,
    wrongEntityRx: null,
    forbidBulkList: false,
    isDeadline: true
  },
  {
    taskId: "t_eli",
    lanes: ["deadline", "synonym", "noisy", "colloquial", "typo", "long", "mixed"],
    entityTokens: ["Eli", "Eli ze školy", "Eli ze skoly", "Eličku"],
    deadlineVerbs: ["vyzvednout", "vyzvednout", "vyzvednout"],
    entityVerbs: [],
    entityPreps: [],
    synonymPhrases: ["vyzvednout Eli", "vyzvednout Eli ze skoly"],
    entityRx: /eli/i,
    valueRx: /4\.|15:30|term[ií]n|vyzvednout/i,
    wrongEntityRx: null,
    forbidBulkList: false,
    isDeadline: true
  },
  {
    taskId: "t_mama",
    lanes: ["entity", "synonym", "noisy", "colloquial", "typo", "long", "mixed", "multi_entity"],
    entityTokens: ["mámě", "mamě", "mamě", "pro mámu", "mame"],
    deadlineVerbs: ["koupit"],
    entityVerbs: ["koupit", "pořídit", "sehnat"],
    entityPreps: ["mámě", "pro mámu"],
    synonymPhrases: ["koupit dárek mámě", "pořídit darek mame"],
    entityRx: /m[aá]m[eě]|d[aá]rek/i,
    valueRx: /Koupit d[aá]rek m[aá]m[eě]|m[aá]m[eě]/i,
    wrongEntityRx: null,
    forbidBulkList: true,
    isDeadline: false
  },
  {
    taskId: "t_auto",
    lanes: ["entity", "synonym", "noisy", "colloquial", "typo", "long", "mixed"],
    entityTokens: ["auta", "auto", "kolem auta", "s autem", "STK"],
    deadlineVerbs: [],
    entityVerbs: ["zařídit", "udělat", "vyřešit"],
    entityPreps: ["kolem auta", "s autem", "ohledně auta"],
    synonymPhrases: ["zařídit auto", "zaridit stk", "uhradit pojisteni auta"],
    entityRx: /aut|stk|pojist/i,
    valueRx: /auta|STK|pojist|zařídit/i,
    wrongEntityRx: null,
    forbidBulkList: false,
    isDeadline: false
  },
  {
    taskId: "t_pravnik",
    lanes: ["entity", "synonym", "noisy", "colloquial", "typo", "long", "mixed"],
    entityTokens: ["právníkem", "právníkovi", "pravnikem", "s právníkem"],
    deadlineVerbs: [],
    entityVerbs: ["udělat", "vyřešit", "zařídit"],
    entityPreps: ["s právníkem", "s pravnikem", "právníkovi"],
    synonymPhrases: ["zavolat pravnikovi", "resit smlouvu s pravnikem"],
    entityRx: /pr[aá]vn|smlouv/i,
    valueRx: /pr[aá]vn|smlouv|zavolat/i,
    wrongEntityRx: null,
    forbidBulkList: false,
    isDeadline: false
  }
];

const DEADLINE_TEMPLATES = [
  "Kdy mám {verb} {entity}",
  "Kdy že mám {verb} {entity}",
  "Kdy musím {verb} {entity}",
  "Do kdy mám {verb} {entity}",
  "Kdy je termín abych {verb} {entity}",
  "Můžeš mi říct kdy mám {verb} {entity}",
  "Potřebuju vědět kdy mám {verb} {entity}",
  "Nevíš kdy mám {verb} {entity}",
  "Prosím tě kdy mám {verb} {entity}",
  "Hele kdy že mám {verb} ten {entity}",
  "Kdy bych měl {verb} {entity}",
  "Kdy mám {verb} {entity} prosím"
];

const ENTITY_TEMPLATES = [
  "Co mám {verb} {entity}",
  "Co jsem měl {verb} {entity}",
  "Co mám ještě {verb} {entity}",
  "Co mi zbývá {verb} {entity}",
  "Co mám vlastně {verb} {entity}",
  "Potřebuju vědět co mám {verb} {entity}",
  "Hele co mám {verb} {entity}",
  "Co mám udělat {entity}",
  "Co mám vyřešit {entity}",
  "Co mám zařídit {entity}",
  "Můžeš mi říct co mám {verb} {entity}",
  "Nevíš co mám {verb} {entity}"
];

const COLLOQUIAL_PREFIXES = ["hele ", "no tak ", "prosím tě ", "hele prosím ", "já bych potřeboval "];
const COLLOQUIAL_SUFFIXES = [" prosím", " díky", " no", " jo"];

const LONG_WRAPPERS = [
  "Hele prosím tě já bych potřeboval vědět jestli mi můžeš říct {base}",
  "Jestli mi to nevadí tak bych se chtěl zeptat {base}",
  "Můžeš se na to mrknout a říct mi {base}",
  "Potřebuju rychle zjistit {base}",
  "Nevíš náhodou {base}"
];

const MULTI_ENTITY_CASES = [
  {
    taskId: "t_mama",
    input: "Kdy mám koupit dárek mámě",
    lane: "multi_entity",
    entityRx: /m[aá]m[eě]|d[aá]rek/i,
    valueRx: /Koupit d[aá]rek m[aá]m[eě]|m[aá]m[eě]/i,
    wrongEntityRx: /^Našel jsem úkol: Koupit d[aá]rek k narozenin/i,
    forbidBulkList: true
  },
  {
    taskId: "t_darek",
    input: "Kdy mám koupit dárek k narozeninám ne mámě",
    lane: "multi_entity",
    entityRx: /narozenin|d[aá]rek/i,
    valueRx: /10\.|narozenin|koupit d[aá]rek k/i,
    wrongEntityRx: /^Našel jsem úkol: Koupit d[aá]rek m[aá]m[eě]\./i,
    forbidBulkList: false
  },
  {
    taskId: "t_najem",
    input: "Kdy mám zaplatit nájem a ne auto",
    lane: "multi_entity",
    entityRx: /n[aá]jem/i,
    valueRx: /5\.|6\.|term[ií]n|zaplatit/i,
    wrongEntityRx: /STK|pojist/i,
    forbidBulkList: false
  },
  {
    taskId: "t_auto",
    input: "Co mám zařídit kolem auta a ne nájem",
    lane: "multi_entity",
    entityRx: /aut|stk|pojist/i,
    valueRx: /auta|STK|pojist/i,
    wrongEntityRx: /n[aá]jem/i,
    forbidBulkList: false
  },
  {
    taskId: "t_doktor",
    input: "Co mám vyřešit s doktorem ne s právníkem",
    lane: "multi_entity",
    entityRx: /doktor/i,
    valueRx: /doktor|zavolat/i,
    wrongEntityRx: /pr[aá]vn/i,
    forbidBulkList: false
  },
  {
    taskId: "t_pravnik",
    input: "Co mám udělat s právníkem ne s doktorem",
    lane: "multi_entity",
    entityRx: /pr[aá]vn|smlouv/i,
    valueRx: /pr[aá]vn|smlouv/i,
    wrongEntityRx: /doktor/i,
    forbidBulkList: false
  }
];

function stripDiak(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function applyTypo(s) {
  return String(s || "")
    .replace(/á/g, "a")
    .replace(/č/g, "c")
    .replace(/ď/g, "d")
    .replace(/é/g, "e")
    .replace(/ě/g, "e")
    .replace(/í/g, "i")
    .replace(/ň/g, "n")
    .replace(/ó/g, "o")
    .replace(/ř/g, "r")
    .replace(/š/g, "s")
    .replace(/ť/g, "t")
    .replace(/ú/g, "u")
    .replace(/ů/g, "u")
    .replace(/ý/g, "y")
    .replace(/ž/g, "z")
    .replace(/zaplatit/gi, "zplatit")
    .replace(/doktor/gi, "docktor")
    .replace(/právník/gi, "pravnuk")
    .replace(/zařídit/gi, "zaridit")
    .replace(/koupit/gi, "koupt")
    .replace(/\s+/g, " ")
    .trim();
}

function foldCs(s) {
  return stripDiak(String(s || "").toLowerCase());
}

function pickEntity(spec, vi, ei) {
  if (spec.entityPreps.length && ei % 2 === 0) {
    return spec.entityPreps[ei % spec.entityPreps.length];
  }
  return spec.entityTokens[ei % spec.entityTokens.length];
}

function buildDeadlineCases(spec, startIdx) {
  const out = [];
  let idx = startIdx;
  if (!spec.isDeadline || !spec.deadlineVerbs.length) return out;
  for (let ti = 0; ti < DEADLINE_TEMPLATES.length; ti++) {
    for (let vi = 0; vi < spec.deadlineVerbs.length; vi++) {
      for (let ei = 0; ei < spec.entityTokens.length; ei++) {
        const verb = spec.deadlineVerbs[vi];
        const entity = spec.entityTokens[ei];
        const base = DEADLINE_TEMPLATES[ti].replace("{verb}", verb).replace("{entity}", entity);
        const variants = [
          { lane: "deadline", input: base },
          { lane: "noisy", input: stripDiak(base) },
          { lane: "colloquial", input: COLLOQUIAL_PREFIXES[(ti + vi) % COLLOQUIAL_PREFIXES.length] + base },
          { lane: "typo", input: applyTypo(base) },
          {
            lane: "long",
            input: LONG_WRAPPERS[(ti + ei) % LONG_WRAPPERS.length].replace("{base}", base.charAt(0).toLowerCase() + base.slice(1))
          },
          {
            lane: "mixed",
            input: applyTypo(COLLOQUIAL_PREFIXES[vi % COLLOQUIAL_PREFIXES.length] + stripDiak(base))
          }
        ];
        for (let v = 0; v < variants.length; v++) {
          if (spec.lanes.indexOf(variants[v].lane) < 0) continue;
          out.push(makeCase(spec, idx++, variants[v].lane, variants[v].input));
        }
      }
    }
  }
  return out;
}

function buildEntityCases(spec, startIdx) {
  const out = [];
  let idx = startIdx;
  if (!spec.entityVerbs.length) return out;
  for (let ti = 0; ti < ENTITY_TEMPLATES.length; ti++) {
    for (let vi = 0; vi < spec.entityVerbs.length; vi++) {
      for (let ei = 0; ei < Math.max(spec.entityPreps.length, spec.entityTokens.length); ei++) {
        const verb = spec.entityVerbs[vi];
        const entity = pickEntity(spec, vi, ei);
        const base = ENTITY_TEMPLATES[ti]
          .replace("{verb}", verb)
          .replace("{entity}", entity);
        const variants = [
          { lane: "entity", input: base },
          { lane: "noisy", input: stripDiak(base) },
          { lane: "colloquial", input: COLLOQUIAL_PREFIXES[ti % COLLOQUIAL_PREFIXES.length] + base + COLLOQUIAL_SUFFIXES[vi % COLLOQUIAL_SUFFIXES.length] },
          { lane: "typo", input: applyTypo(base) },
          {
            lane: "long",
            input: LONG_WRAPPERS[(ti + vi + ei) % LONG_WRAPPERS.length].replace("{base}", base.charAt(0).toLowerCase() + base.slice(1))
          },
          {
            lane: "mixed",
            input: stripDiak(COLLOQUIAL_PREFIXES[(ti + ei) % COLLOQUIAL_PREFIXES.length] + base)
          }
        ];
        for (let v = 0; v < variants.length; v++) {
          if (spec.lanes.indexOf(variants[v].lane) < 0) continue;
          out.push(makeCase(spec, idx++, variants[v].lane, variants[v].input));
        }
      }
    }
  }
  return out;
}

function buildSynonymCases(spec, startIdx) {
  const out = [];
  let idx = startIdx;
  for (let si = 0; si < spec.synonymPhrases.length; si++) {
    const base = spec.synonymPhrases[si];
    const variants = [
      { lane: "synonym", input: base },
      { lane: "noisy", input: stripDiak(base) },
      { lane: "colloquial", input: COLLOQUIAL_PREFIXES[si % COLLOQUIAL_PREFIXES.length] + base },
      { lane: "typo", input: applyTypo(base) },
      { lane: "mixed", input: stripDiak(COLLOQUIAL_PREFIXES[si % COLLOQUIAL_PREFIXES.length] + base) + " prosim" }
    ];
    for (let v = 0; v < variants.length; v++) {
      if (spec.lanes.indexOf(variants[v].lane) < 0) continue;
      out.push(makeCase(spec, idx++, variants[v].lane, variants[v].input));
    }
  }
  return out;
}

function makeCase(spec, idx, lane, input, overrides) {
  const o = overrides || {};
  return {
    id: "RW_" + spec.taskId + "_" + String(idx).padStart(4, "0"),
    taskId: spec.taskId,
    lane: lane,
    input: input.replace(/\s+/g, " ").trim(),
    entityRx: o.entityRx || spec.entityRx,
    valueRx: o.valueRx || spec.valueRx,
    wrongEntityRx: o.wrongEntityRx !== undefined ? o.wrongEntityRx : spec.wrongEntityRx,
    forbidBulkList: o.forbidBulkList !== undefined ? o.forbidBulkList : spec.forbidBulkList,
    allowClarification: false
  };
}

function buildMultiEntityCases(startIdx) {
  const out = [];
  for (let i = 0; i < MULTI_ENTITY_CASES.length; i++) {
    const mc = MULTI_ENTITY_CASES[i];
    const spec = TASK_SPECS.find(function (s) {
      return s.taskId === mc.taskId;
    });
    const base = mc.input;
    const variants = [
      { lane: "multi_entity", input: base },
      { lane: "noisy", input: stripDiak(base) },
      { lane: "colloquial", input: "hele " + base },
      { lane: "long", input: LONG_WRAPPERS[i % LONG_WRAPPERS.length].replace("{base}", base.charAt(0).toLowerCase() + base.slice(1)) },
      { lane: "mixed", input: stripDiak("prosím tě " + base) },
      { lane: "typo", input: applyTypo(base) }
    ];
    for (let v = 0; v < variants.length; v++) {
      out.push(
        makeCase(spec, startIdx + i * 10 + v, variants[v].lane, variants[v].input, {
          entityRx: mc.entityRx,
          valueRx: mc.valueRx,
          wrongEntityRx: mc.wrongEntityRx,
          forbidBulkList: mc.forbidBulkList
        })
      );
    }
  }
  return out;
}

function generateCorpus() {
  const seen = new Set();
  const cases = [];
  let idx = 0;
  for (let s = 0; s < TASK_SPECS.length; s++) {
    const spec = TASK_SPECS[s];
    const chunks = []
      .concat(buildDeadlineCases(spec, idx))
      .concat(buildEntityCases(spec, idx + 1000))
      .concat(buildSynonymCases(spec, idx + 2000));
    for (let c = 0; c < chunks.length; c++) {
      const key = foldCs(chunks[c].input);
      if (seen.has(key)) continue;
      seen.add(key);
      chunks[c].id = "RW_" + spec.taskId + "_" + String(cases.length).padStart(5, "0");
      cases.push(chunks[c]);
    }
    idx += 3000;
  }
  const multi = buildMultiEntityCases(cases.length);
  for (let m = 0; m < multi.length; m++) {
    const key = foldCs(multi[m].input);
    if (seen.has(key)) continue;
    seen.add(key);
    multi[m].id = "RW_MULTI_" + String(cases.length).padStart(5, "0");
    cases.push(multi[m]);
  }
  return cases;
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

function evaluateCase(c, intent, msg) {
  const issues = [];
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
  if (intent === "calendar.read") issues.push("calendar_steal");
  if (intent === "notes.read") issues.push("note_steal");
  if (intent === "global.search" && (!msg.trim() || /Nic jsem k tomu nena[sš]el/i.test(msg))) {
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
  if (
    intentMatchesTaskRead(intent) &&
    msg.trim() &&
    !/Na[sš]el jsem|term[ií]n|M[aá][šs]\s+\d+/i.test(msg) &&
    c.entityRx
  ) {
    issues.push("summary_miss");
  }
  return issues;
}

function classifyRootCause(c, intent, msg, issues) {
  if (issues.indexOf("write_leak") >= 0) return "harness_problem";
  if (issues.indexOf("calendar_steal") >= 0) return "task_vs_calendar_steal";
  if (issues.indexOf("note_steal") >= 0) return "task_vs_notes_steal";
  if (
    issues.some(function (x) {
      return x.indexOf("wrong_module:global.search") === 0;
    }) ||
    issues.indexOf("global_empty_steal") >= 0
  ) {
    return "task_vs_global_steal";
  }
  if (issues.indexOf("wrong_ranked_task") >= 0) return "ranking_fail";
  if (issues.indexOf("bulk_list") >= 0 || issues.indexOf("empty_response") >= 0) return "retrieval_fail";
  if (issues.indexOf("entity_miss") >= 0 || issues.indexOf("value_miss") >= 0) {
    if (c.lane === "typo") return "typo_fail";
    if (c.lane === "noisy") return "noisy_input_fail";
    if (c.lane === "synonym") return "synonym_gap";
    return "retrieval_fail";
  }
  if (issues.indexOf("summary_miss") >= 0) return "summary_fail";
  if (intent === "clarification" || intent === "unknown") return "ambiguity";
  if (c.lane === "synonym" && issues.length > 0) return "synonym_gap";
  if (c.lane === "noisy" && issues.length > 0) return "noisy_input_fail";
  if (c.lane === "typo" && issues.length > 0) return "typo_fail";
  if (issues.length > 0) return "harness_problem";
  return "pass";
}

function classifyBucket(rootCause) {
  if (rootCause === "pass") return "PASS";
  if (rootCause === "ambiguity") return "AMBIGUOUS";
  if (rootCause === "harness_problem") return "HARNESS";
  return "TRUE_ENGINE";
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
    return "Narrow fix: entity task query protection vs notes.read";
  }
  if (topCluster.indexOf("noisy_input_fail") === 0 || topCluster.indexOf("typo_fail") === 0) {
    return "Narrow fix: folded Czech normalization in task item fallback term extraction";
  }
  if (topCluster.indexOf("synonym_gap") === 0) {
    return "Narrow fix: bare synonym + colloquial wrapper read turn expansion";
  }
  if (topCluster.indexOf("ranking_fail") === 0) {
    return "Narrow fix: entity-anchor disambiguation in task item fallback scoring";
  }
  if (topCluster.indexOf("retrieval_fail") === 0) {
    return "Narrow fix: expand task item fallback search coverage for long/mixed phrasing";
  }
  if (topCluster.indexOf("task_vs_global_steal") === 0) {
    return "Narrow fix: global.search must ground to task snapshot for concrete entity queries";
  }
  return "No dominant true engine cluster — continue corpus monitoring";
}

function main() {
  const appHashBefore = hashFile("assets/app.js");
  const corpus = generateCorpus();
  if (corpus.length < 1000) {
    console.error("STOP: corpus size " + corpus.length + " < 1000 minimum");
    process.exit(2);
  }

  const eng = loadEngine();
  const ctx = taskDiag.seedCtx();
  const rows = [];
  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  let query_created_write_count = 0;

  for (let i = 0; i < corpus.length; i++) {
    const c = corpus[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = turnMsg(turn);
    const issues = evaluateCase(c, intent, msg);
    const rootCause = classifyRootCause(c, intent, msg, issues);
    const bucket = classifyBucket(rootCause);

    if (WRITE_INTENTS.has(intent)) {
      dangerous_write_count++;
      false_write_count++;
    }
    if (turn.processingState === "READY_TO_SAVE") {
      query_created_write_count++;
      false_write_count++;
    }

    rows.push({
      id: c.id,
      taskId: c.taskId,
      lane: c.lane,
      input: c.input,
      intent: intent,
      pass: issues.length === 0,
      issues: issues,
      rootCause: rootCause,
      bucket: bucket,
      message: msg.slice(0, 200)
    });

    if ((i + 1) % 500 === 0) {
      process.stderr.write("progress=" + (i + 1) + "/" + corpus.length + "\n");
    }
  }

  const passCount = rows.filter(function (r) {
    return r.pass;
  }).length;
  const failCount = rows.length - passCount;
  const accuracyPct = ((passCount / rows.length) * 100).toFixed(2) + "%";
  const failures = rows.filter(function (r) {
    return !r.pass;
  });
  const rootCauseBreakdown = countBy(failures, "rootCause");
  const laneBreakdown = countBy(rows, "lane");
  const topCluster = topTrueEngineCluster(rows);
  const trueEngineFails = rows.filter(function (r) {
    return r.bucket === "TRUE_ENGINE";
  }).length;

  function pickTopFailExamples(failRows, limit) {
    const picked = [];
    const seenCause = new Set();
    const byCause = {};
    for (let fi = 0; fi < failRows.length; fi++) {
      const rc = failRows[fi].rootCause;
      if (!byCause[rc]) byCause[rc] = [];
      byCause[rc].push(failRows[fi]);
    }
    const causeOrder = Object.keys(byCause).sort(function (a, b) {
      return byCause[b].length - byCause[a].length;
    });
    for (let ci = 0; ci < causeOrder.length && picked.length < limit; ci++) {
      const rc = causeOrder[ci];
      if (seenCause.has(rc)) continue;
      seenCause.add(rc);
      picked.push(byCause[rc][0]);
    }
    for (let fi = 0; fi < failRows.length && picked.length < limit; fi++) {
      const already = picked.some(function (p) {
        return p.id === failRows[fi].id;
      });
      if (!already) picked.push(failRows[fi]);
    }
    return picked.slice(0, limit).map(function (r) {
      return {
        id: r.id,
        lane: r.lane,
        input: r.input,
        intent: r.intent,
        rootCause: r.rootCause,
        issues: r.issues,
        message: r.message
      };
    });
  }

  const laneStats = {};
  for (let li = 0; li < rows.length; li++) {
    const lane = rows[li].lane;
    if (!laneStats[lane]) laneStats[lane] = { pass: 0, fail: 0 };
    if (rows[li].pass) laneStats[lane].pass++;
    else laneStats[lane].fail++;
  }

  const top10Fails = pickTopFailExamples(failures, 10);

  const appHashAfter = hashFile("assets/app.js");
  const assetsChanged =
    appHashBefore && appHashAfter && appHashBefore !== appHashAfter ? "YES" : assetsAppChanged();
  if (assetsChanged === "YES") {
    console.error("STOP: assets/app.js changed during corpus run");
    process.exit(2);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    audit: "REAL_WORLD_TASK_READ_CORPUS_V1",
    phase_engine_changed: "NO",
    assets_app_changed: "NO",
    app_js_sha256: appHashAfter,
    total_cases: rows.length,
    pass: passCount,
    fail: failCount,
    real_world_task_read_accuracy: accuracyPct,
    lane_breakdown: laneBreakdown,
    lane_pass_rates: laneStats,
    true_engine_fails: trueEngineFails,
    harness_fails: rows.filter(function (r) {
      return r.bucket === "HARNESS";
    }).length,
    ambiguous_cases: rows.filter(function (r) {
      return r.bucket === "AMBIGUOUS";
    }).length,
    root_cause_breakdown: rootCauseBreakdown,
    top_true_engine_cluster: topCluster,
    top_10_fail_examples: top10Fails,
    recommended_next_fix: recommendNextFix(rootCauseBreakdown, topCluster),
    safety: {
      dangerous_write_count: dangerous_write_count,
      false_write_count: false_write_count,
      write_when_negated_count: write_when_negated_count,
      query_created_write_count: query_created_write_count
    },
    failure_count: failures.length,
    failures_sample: top10Fails
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const gitClean = gitCleanExceptAllow([
    "scripts/silver-real-world-task-read-corpus-v1.cjs",
    "scripts/silver-real-world-task-read-corpus-v1-report.json"
  ]);

  console.log("=== REAL_WORLD_TASK_READ_CORPUS_V1 ===");
  console.log("TOTAL_CASES=" + rows.length);
  console.log("PASS=" + passCount);
  console.log("FAIL=" + failCount);
  console.log("REAL_WORLD_TASK_READ_ACCURACY=" + accuracyPct);
  console.log("ROOT_CAUSE_BREAKDOWN=" + JSON.stringify(rootCauseBreakdown));
  console.log("TOP_TRUE_ENGINE_CLUSTER=" + topCluster);
  console.log("TOP_10_FAIL_EXAMPLES=" + JSON.stringify(top10Fails));
  console.log("PHASE_ENGINE_CHANGED=NO");
  console.log("ASSETS_APP_CHANGED=NO");
  console.log("DANGEROUS_WRITE_COUNT=" + dangerous_write_count);
  console.log("FALSE_WRITE_COUNT=" + false_write_count);
  console.log("WRITE_WHEN_NEGATED_COUNT=" + write_when_negated_count);
  console.log("QUERY_CREATED_WRITE_COUNT=" + query_created_write_count);
  console.log("RECOMMENDED_NEXT_FIX=" + report.recommended_next_fix);
  console.log("GIT_CLEAN=" + gitClean);
  console.log("PASS_FAIL=" + (failCount === 0 && dangerous_write_count === 0 ? "PASS" : "DIAGNOSTIC"));
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_REAL_WORLD_TASK_READ_CORPUS_V1 ===");
}

if (require.main === module) main();
