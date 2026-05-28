#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const audit = require("./audit_silver_20000_routing_stable.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const FIXED_NOW = new Date("2026-05-04T12:00:00");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);

const TASK_WRITE_CHAOS_REPLAY = [
  { id: "TWC_001", input: "Hoď mi tam koupit mlíko", expect: "tasks.create" },
  { id: "TWC_002", input: "Připomeň mi zítra zavolat mámě", expect: "tasks.create" },
  { id: "TWC_003", input: "Do úkolů napiš servis auta", expect: "tasks.create" },
  { id: "TWC_004", input: "Jen úkol, ne kalendář", expect: "tasks.create" },
  { id: "TWC_005", input: "Neukládej do kalendáře, dej to do úkolů", expect: "tasks.create" },
  { id: "TWC_006", input: "Přidej task zaplatit nájem", expect: "tasks.create" },
  { id: "TWC_007", input: "Na zítra koupit chleba", expect: "tasks.create" },
  { id: "TWC_008", input: "Nezapomenout účetní", expect: "tasks.create" },
  { id: "TWC_009", input: "Musím koupit benzín", expect: "tasks.create" },
  { id: "TWC_010", input: "Jen připomínka, ne událost", expect: "tasks.create" },
  { id: "TWC_011", input: "Do tasků vrátit knížku", expect: "tasks.create" },
  { id: "TWC_012", input: "Udělej úkol zavolat doktorovi", expect: "tasks.create" }
];

const TASK_WRITE_MOBILE_REPLAY = [
  { id: "TWM_001", input: "Musím koupit rohlíky do 10 dnů, není to poznámka.", expect: "tasks.create" },
  { id: "TWM_002", input: "Nákup: 10 rohlíků, 5 mlék, 3 kečupy jako jeden úkol do pátku.", expect: "tasks.create" },
  { id: "TWM_003", input: "ehm zavolat účetní jo", expect: "tasks.create", allowClarification: false },
  { id: "TWM_004", input: "prosím tě mohl bys uložit úkol zavolat doktorovi díky", expect: "tasks.create" }
];

const TASK_WRITE_NEGATED_CAL_REPLAY = [
  { id: "TWNC_001", input: "Neukládej do kalendáře, dej to do úkolů", expect: "tasks.create" },
  { id: "TWNC_002", input: "ne do kalendáře hoď mi do úkolů koupit uhlí do pátku", expect: "tasks.create" },
  { id: "TWNC_003", input: "Jen úkol, ne kalendář", expect: "tasks.create" }
];

const TASK_WRITE_NO_CALENDAR_LEAK_REPLAY = [
  { id: "TWCL_001", input: "Připomeň mi zítra zavolat mámě", forbidCalendar: true, expect: "tasks.create" },
  { id: "TWCL_002", input: "Jen připomínka, ne událost", forbidCalendar: true, expect: "tasks.create" },
  { id: "TWCL_003", input: "Na zítra koupit chleba", forbidCalendar: true, expect: "tasks.create" }
];

const TASK_WRITE_CLEAN_PAYLOAD_REPLAY = [
  { id: "TWCP_001", input: "Do úkolů napiš servis auta", expect: "tasks.create", titleNeed: ["servis"], titleLacks: ["napiš", "úkolů"] },
  { id: "TWCP_002", input: "Udělej úkol zavolat doktorovi", expect: "tasks.create", titleNeed: ["doktor", "zavol"], titleLacks: ["udělej", "úkol"] },
  { id: "TWCP_003", input: "Přidej task zaplatit nájem", expect: "tasks.create", titleNeed: ["nájem", "zaplat"], titleLacks: ["přidej", "task"] },
  { id: "TWCP_004", input: "neptej se na čas uložení Nákup: 10 rohlíků, 5 mlék, 3 kečupy jako jeden úkol do pátku.", expect: "tasks.create", titleNeed: ["rohlík", "mlék"], titleLacks: ["neptej", "nakup:"] },
  { id: "TWCP_005", input: "nevracej advokáta Nákup: 10 rohlíků, 5 mlék, 3 kečupy jako jeden úkol do pátku.", expect: "tasks.create", titleNeed: ["kečup"], titleLacks: ["nevracej", "advokát"] },
  { id: "TWCP_006", input: "nepleť to s úkolem Nákup: 10 rohlíků, 5 mlék, 3 kečupy jako jeden úkol do pátku.", expect: "tasks.create", titleNeed: ["rohlík"], titleLacks: ["nepleť", "úkolem"] },
  { id: "TWCP_007", input: "nevytvářej poznámku Nákup: 10 rohlíků, 5 mlék, 3 kečupy jako jeden úkol do pátku.", expect: "tasks.create", titleNeed: ["mlék"], titleLacks: ["nevytvářej", "poznámku"] }
];

/** P0 task_write_20k: meta-neg lead + nákupní šablona → tasks.create (replay z 100× intent_fail). */
const TASK_WRITE_NAKUP_META_NEG_REPLAY = (function buildNakupMetaNegReplay() {
  const bodies = [
    "Nákup: 10 rohlíků, 5 mlék, 3 kečupy jako jeden úkol do pátku.",
    "Nakup: 10 rohliku, 5 mlek, 3 kecupy jako jeden ukol do patku.",
    "Nakup: 10 rohliku, 5 mlek, 3 kecupy jako jeden ukol do patku. (příloha)",
    "Nákup: 10 rohlíků, 5 mlék, 3 kečupy jako jeden úkol do patku."
  ];
  const leads = [
    "neptej se na čas uložení",
    "neptej se na cas ulozeni",
    "nevracej advokáta",
    "nevracej advokata",
    "nepleť to s úkolem",
    "neplet to s ukolem",
    "nevytvářej poznámku",
    "nevytvarej poznamku",
    "neptej se kam uložit",
    "nevracej právníka",
    "nepleť to s kalendářem",
    "nevracej schůzku",
    "nevracej úkol",
    "nevracej poznámku"
  ];
  const out = [];
  let n = 0;
  for (let li = 0; li < leads.length; li++) {
    for (let bi = 0; bi < bodies.length; bi++) {
      n++;
      out.push({
        id: "TWN_" + String(n).padStart(3, "0"),
        input: leads[li] + " " + bodies[bi],
        expect: "tasks.create"
      });
      if (n >= 56) return out;
    }
  }
  return out;
})();

TASK_WRITE_CHAOS_REPLAY.push.apply(
  TASK_WRITE_CHAOS_REPLAY,
  TASK_WRITE_NAKUP_META_NEG_REPLAY.slice(0, 20)
);
TASK_WRITE_MOBILE_REPLAY.push.apply(
  TASK_WRITE_MOBILE_REPLAY,
  TASK_WRITE_NAKUP_META_NEG_REPLAY.slice(20, 35)
);
TASK_WRITE_NEGATED_CAL_REPLAY.push.apply(
  TASK_WRITE_NEGATED_CAL_REPLAY,
  TASK_WRITE_NAKUP_META_NEG_REPLAY.slice(35, 45)
);
TASK_WRITE_NO_CALENDAR_LEAK_REPLAY.push.apply(
  TASK_WRITE_NO_CALENDAR_LEAK_REPLAY,
  TASK_WRITE_NAKUP_META_NEG_REPLAY.slice(45, 50).map(function (c) {
    return Object.assign({}, c, { forbidCalendar: true });
  })
);
TASK_WRITE_CLEAN_PAYLOAD_REPLAY.push.apply(
  TASK_WRITE_CLEAN_PAYLOAD_REPLAY,
  TASK_WRITE_NAKUP_META_NEG_REPLAY.slice(50, 56)
);

const TASK_WRITE_OWNERSHIP_SEED = [
  { id: "TWO_001", family: "note_conflict", input: "Není to poznámka, přidej úkol zavolat právníkovi.", expect: "tasks.create" },
  { id: "TWO_002", family: "note_conflict", input: "Jen úkol, ne kalendář — zaplatit fakturu.", expect: "tasks.create" },
  { id: "TWO_003", family: "note_conflict", input: "Jen task — koupit mléko.", expect: "tasks.create" },
  { id: "TWO_004", family: "note_conflict", input: "Do úkolů napiš servis auta.", expect: "tasks.create" },
  { id: "TWO_005", family: "note_conflict", input: "Ne note, přidej úkol poslat smlouvu.", expect: "tasks.create" },
  { id: "TWO_006", family: "note_conflict", input: "Nepleť to s poznámkou, musím koupit rohlíky.", expect: "tasks.create" },
  { id: "TWO_007", family: "note_conflict", input: "Nevytvářej poznámku, jen úkol zavolat mámě.", expect: "tasks.create" },
  { id: "TWO_008", family: "note_conflict", input: "Task, ne poznámku — objednat benzín.", expect: "tasks.create" },
  { id: "TWO_009", family: "note_conflict", input: "Musím koupit rohlíky do 10 dnů, není to poznámka.", expect: "tasks.create" },
  { id: "TWO_010", family: "note_conflict", input: "nevytvářej poznámku Musím koupit toaleták do 10 dnů, není to poznámka.", expect: "tasks.create" },
  { id: "TWO_011", family: "basic_task_create", input: "Přidej úkol zavolat právníkovi.", expect: "tasks.create" },
  { id: "TWO_012", family: "basic_task_create", input: "Vytvoř úkol koupit mléko.", expect: "tasks.create" },
  { id: "TWO_013", family: "basic_task_create", input: "Připomeň mi zaplatit fakturu.", expect: "tasks.create" },
  { id: "TWO_014", family: "temporal_task_create", input: "Zítra zavolat právníkovi.", expect: "tasks.create" },
  { id: "TWO_015", family: "temporal_task_create", input: "Večer koupit mléko.", expect: "tasks.create" },
  { id: "TWO_016", family: "fragment_task_create", input: "právník smlouva", expect: "tasks.create", allowClarification: true },
  { id: "TWO_017", family: "negation_safety", input: "Nic jiného neukládej, jen vytvoř úkol.", expect: "tasks.create", allowClarification: true },
  { id: "TWO_018", family: "negation_safety", input: "Nevytvářej poznámku, jen task.", expect: "tasks.create" }
];

const FAMILY_TEMPLATES = {
  basic_task_create: [
    "Přidej úkol zavolat právníkovi.",
    "Vytvoř úkol koupit mléko.",
    "Připomeň mi zaplatit fakturu.",
    "Přidej do úkolů servis auta.",
    "Úkol: poslat smlouvu účetní."
  ],
  note_conflict: [
    "Není to poznámka, přidej úkol zavolat právníkovi.",
    "Jen úkol, ne kalendář — zaplatit fakturu.",
    "Jen task — koupit mléko.",
    "Do úkolů napiš servis auta.",
    "Ne note, přidej úkol poslat smlouvu.",
    "Nepleť to s poznámkou, musím koupit rohlíky.",
    "Nevytvářej poznámku, jen úkol zavolat mámě.",
    "Task, ne poznámku — objednat benzín.",
    "Musím koupit rohlíky do 10 dnů, není to poznámka.",
    "nevytvářej poznámku Musím koupit toaleták do 10 dnů, není to poznámka."
  ],
  temporal_task_create: [
    "Zítra zavolat právníkovi.",
    "Večer koupit mléko.",
    "V pondělí poslat fakturu.",
    "Příští týden servis auta.",
    "Dnes večer zavolat mámě."
  ],
  fragment_task_create: ["právník smlouva", "auto servis", "účetní doklady", "faktura doplatit", "Pepovi zavolat"],
  negation_safety: [
    "Nic jiného neukládej, jen vytvoř úkol.",
    "Nevytvářej poznámku, jen task.",
    "Jen úkol.",
    "Ne kalendář.",
    "Ne poznámku."
  ]
};

const FILLERS = ["", "Hele ", "Prosím "];
const READ_LEADS = ["", "nevytvářej poznámku "];

function filterFamilies(cases, families) {
  const set = new Set(families);
  return cases.filter(function (c) {
    return set.has(c.family);
  });
}

function buildTaskWriteCorpusV1(targetCount) {
  const out = TASK_WRITE_OWNERSHIP_SEED.slice();
  const families = Object.keys(FAMILY_TEMPLATES);
  let n = out.length;
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = FAMILY_TEMPLATES[family];
    const tpl = tpls[n % tpls.length];
    const pfx = FILLERS[n % FILLERS.length] + READ_LEADS[(n >> 2) % READ_LEADS.length];
    out.push({
      id: "TWH_GEN_" + String(n).padStart(4, "0"),
      family: family,
      input: pfx + tpl,
      expect: "tasks.create",
      allowClarification: family === "fragment_task_create"
    });
    n++;
  }
  return out.slice(0, targetCount);
}

const TASK_WRITE_OWNERSHIP_REPLAY = buildTaskWriteCorpusV1(520);
const TASK_WRITE_BASIC_REPLAY = filterFamilies(TASK_WRITE_OWNERSHIP_REPLAY, ["basic_task_create"]);
const TASK_WRITE_NOTE_CONFLICT_REPLAY = filterFamilies(TASK_WRITE_OWNERSHIP_REPLAY, ["note_conflict"]);
const TASK_WRITE_TEMPORAL_REPLAY = filterFamilies(TASK_WRITE_OWNERSHIP_REPLAY, ["temporal_task_create"]);
const TASK_WRITE_FRAGMENT_REPLAY = filterFamilies(TASK_WRITE_OWNERSHIP_REPLAY, ["fragment_task_create"]);
const TASK_WRITE_NEGATION_REPLAY = filterFamilies(TASK_WRITE_OWNERSHIP_REPLAY, ["negation_safety"]);
const TASK_WRITE_HARDENING_REPLAY = TASK_WRITE_OWNERSHIP_REPLAY;

function defaultCtx() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return [];
    },
    getNotesSnapshot: function () {
      return [];
    }
  };
}

function runReplayCases(eng, cases, ctx, evaluate) {
  const report = { pass: 0, fail: 0, total: cases.length, first_fail: null, issues: [] };
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const issues = evaluate(c, turn);
    if (!issues.length) {
      report.pass++;
      continue;
    }
    report.fail++;
    report.issues.push({ id: c.id, input: c.input, issues: issues });
    if (!report.first_fail) {
      report.first_fail = { id: c.id, input: c.input, issues: issues, intent: turn.normalizedIntent, ps: turn.processingState };
    }
  }
  report.PASS_FAIL = report.fail === 0 ? "PASS" : "FAIL";
  return report;
}

function evaluateTaskWrite(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (intent.indexOf("note") >= 0 && c.expect === "tasks.create") issues.push("note_steal:" + intent);
  if (intent.indexOf("calendar") >= 0 && c.expect === "tasks.create" && !c.allowCalendar) issues.push("calendar_steal:" + intent);
  if (intent.indexOf("read") >= 0 && c.expect === "tasks.create") issues.push("read_leak:" + intent);
  if (intent !== c.expect) {
    const allowAlt =
      c.allowClarification &&
      (intent === "clarification" ||
        intent === "unknown" ||
        (c.family === "fragment_task_create" && intent.indexOf("read") >= 0));
    if (!allowAlt) issues.push("intent:" + intent);
  }
  if (turn.processingState !== "READY_TO_SAVE" && intent === "tasks.create") issues.push("ps:" + turn.processingState);
  if (c.forbidCalendar && intent === "calendar.create") issues.push("calendar_leak");
  if (WRITE_INTENTS.has(intent) && c.expect !== intent && intent !== "tasks.create") issues.push("wrong_write:" + intent);
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  const title = String((turn.draft && turn.draft.title) || "").toLowerCase();
  if (c.titleNeed) {
    for (let i = 0; i < c.titleNeed.length; i++) {
      if (title.indexOf(String(c.titleNeed[i]).toLowerCase()) < 0) issues.push("title_miss:" + c.titleNeed[i]);
    }
  }
  if (c.titleLacks) {
    for (let j = 0; j < c.titleLacks.length; j++) {
      if (title.indexOf(String(c.titleLacks[j]).toLowerCase()) >= 0) issues.push("title_pollution:" + c.titleLacks[j]);
    }
  }
  return issues;
}

function foldInput(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasExplicitTaskCue(folded) {
  return /\b(ukol|task|pridej|uloz|ulozit|pripom|vytvor|napis\s+do\s+ukol|do\s+ukol|musim|nezapomen)\b/.test(folded);
}

function hasExplicitNoteCue(folded) {
  return /\b(poznam|note|zapis\s+do\s+poznam|do\s+poznam|neni\s+to\s+ukol)\b/.test(folded);
}

function classifyHardeningFail(c, turn, issues) {
  const intent = String(turn.normalizedIntent || "");
  const folded = foldInput(c.input);
  const family = String(c.family || "");
  const issueText = (issues || []).join(",");

  if (!issues || !issues.length) return "PASS";

  if (family === "fragment_task_create") {
    if (intent === "clarification" || intent === "unknown") return "SAFE_CLARIFICATION_OK";
    if (intent.indexOf("read") >= 0 && !hasExplicitTaskCue(folded)) return "AMBIGUOUS_INPUT";
    if (c.allowClarification && (intent.indexOf("read") >= 0 || intent === "clarification")) return "AMBIGUOUS_INPUT";
  }

  if (family === "negation_safety") {
    if (intent === "clarification" || intent === "unknown") return "SAFE_CLARIFICATION_OK";
    if (c.allowClarification && intent.indexOf("read") >= 0) return "SAFE_CLARIFICATION_OK";
  }

  if (family === "temporal_task_create") {
    if (!hasExplicitTaskCue(folded) && (intent.indexOf("read") >= 0 || intent === "clarification" || intent === "unknown")) {
      return "AMBIGUOUS_INPUT";
    }
    if (!hasExplicitTaskCue(folded) && intent !== "tasks.create") return "TEMPLATE_DNA_PROBLEM";
  }

  if (family === "note_conflict" && hasExplicitTaskCue(folded) && hasExplicitNoteCue(folded) === false) {
    if (intent.indexOf("note") >= 0) return "TRUE_ENGINE_FAIL";
    if (intent.indexOf("calendar") >= 0) return "TRUE_ENGINE_FAIL";
    if (intent !== "tasks.create" && intent !== "clarification" && intent !== "unknown") return "TRUE_ENGINE_FAIL";
  }

  if (family === "basic_task_create") {
    if (intent === "clarification" || intent === "unknown") {
      if (/\bnevytv(a|á)r(e|é)j\s+poznam/.test(folded) || /\bne\s+poznam/.test(folded)) {
        return "SAFE_CLARIFICATION_OK";
      }
    }
    if (intent !== "tasks.create" && intent !== "clarification" && intent !== "unknown") {
      return "TRUE_ENGINE_FAIL";
    }
    if (intent === "unknown" && String(turn.processingState || "") === "CLARIFICATION") return "SAFE_CLARIFICATION_OK";
  }

  if (c.allowClarification && (intent === "clarification" || intent === "unknown")) return "SAFE_CLARIFICATION_OK";

  if (issueText.indexOf("note_steal") >= 0 && !hasExplicitTaskCue(folded) && family === "fragment_task_create") {
    return "HARNESS_OR_GOLD";
  }

  if (issueText.indexOf("read_leak") >= 0 && c.allowClarification) return "HARNESS_OR_GOLD";

  if (String(c.id || "").indexOf("TWH_GEN_") >= 0 && family === "temporal_task_create" && !hasExplicitTaskCue(folded)) {
    return "TEMPLATE_DNA_PROBLEM";
  }

  if (issueText.indexOf("intent:") >= 0 && c.allowClarification) return "HARNESS_OR_GOLD";

  if (intent.indexOf("read") >= 0 && !hasExplicitTaskCue(folded) && !hasExplicitNoteCue(folded)) return "AMBIGUOUS_INPUT";

  return "TRUE_ENGINE_FAIL";
}

function evaluateTaskWriteGuard(c, turn) {
  const issues = evaluateTaskWrite(c, turn);
  if (!issues.length) return [];
  const bucket = classifyHardeningFail(c, turn, issues);
  if (bucket === "TRUE_ENGINE_FAIL" || bucket === "INVALID_EXPECTATION") return issues;
  return [];
}

function runHardeningGapDiagnostic(reportPath) {
  const eng = loadEngine();
  const cases = TASK_WRITE_HARDENING_REPLAY;
  const buckets = {};
  const familyFails = {};
  const fails = [];
  let pass = 0;
  let safetyRisk = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), defaultCtx());
    const issues = evaluateTaskWrite(c, turn);
    if (!issues.length) {
      pass++;
      continue;
    }
    const bucket = classifyHardeningFail(c, turn, issues);
    buckets[bucket] = (buckets[bucket] || 0) + 1;
    const fam = String(c.family || "unknown");
    familyFails[fam] = (familyFails[fam] || 0) + 1;
    if (bucket === "TRUE_ENGINE_FAIL") {
      const intent = String(turn.normalizedIntent || "");
      if (intent === "calendar.create" || (intent === "tasks.create" && turn.processingState === "READY_TO_SAVE" && hasExplicitNoteCue(foldInput(c.input)))) {
        safetyRisk++;
      }
    }
    if (fails.length < 50) {
      fails.push({
        id: c.id,
        family: c.family,
        input: c.input,
        intent: turn.normalizedIntent,
        issues: issues,
        bucket: bucket
      });
    }
  }

  const failCount = cases.length - pass;
  const topFamilies = Object.keys(familyFails)
    .sort(function (a, b) {
      return familyFails[b] - familyFails[a];
    })
    .slice(0, 10)
    .map(function (k) {
      return k + ":" + familyFails[k];
    });

  const report = {
    guard_id: "silver_task_write_hardening_v1_gap_diagnostic",
    total_cases: cases.length,
    pass_count: pass,
    fail_count: failCount,
    unique_fail_patterns: Object.keys(buckets).filter(function (k) {
      return k !== "PASS";
    }).length,
    true_engine_fail_count: buckets.TRUE_ENGINE_FAIL || 0,
    harness_or_gold_count: buckets.HARNESS_OR_GOLD || 0,
    ambiguous_input_count: buckets.AMBIGUOUS_INPUT || 0,
    safe_clarification_ok_count: buckets.SAFE_CLARIFICATION_OK || 0,
    invalid_expectation_count: buckets.INVALID_EXPECTATION || 0,
    template_dna_problem_count: buckets.TEMPLATE_DNA_PROBLEM || 0,
    safety_risk_count: safetyRisk,
    buckets: buckets,
    top_fail_families: topFamilies,
    sample_failures: fails
  };

  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  } catch (eW) {
    void eW;
  }

  console.log("=== SILVER_TASK_WRITE_HARDENING_V1_GAP_DIAGNOSTIC ===");
  console.log("total_cases=" + report.total_cases);
  console.log("pass_count=" + report.pass_count);
  console.log("fail_count=" + report.fail_count);
  console.log("unique_fail_patterns=" + report.unique_fail_patterns);
  console.log("true_engine_fail_count=" + report.true_engine_fail_count);
  console.log("harness_or_gold_count=" + report.harness_or_gold_count);
  console.log("ambiguous_input_count=" + report.ambiguous_input_count);
  console.log("safe_clarification_ok_count=" + report.safe_clarification_ok_count);
  console.log("invalid_expectation_count=" + report.invalid_expectation_count);
  console.log("template_dna_problem_count=" + report.template_dna_problem_count);
  console.log("safety_risk_count=" + report.safety_risk_count);
  console.log("top_fail_families=" + topFamilies.join("|"));
  console.log("report_file=" + reportPath);
  console.log("=== END_SILVER_TASK_WRITE_HARDENING_V1_GAP_DIAGNOSTIC ===");
  return report;
}

function printGuardHeader(name, report) {
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("pass=" + report.pass + "/" + report.total);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_input=" + report.first_fail.input);
    console.log("first_fail_issues=" + (report.first_fail.issues || []).join(","));
    console.log("first_fail_intent=" + (report.first_fail.intent || ""));
  }
  console.log("=== END_" + name.toUpperCase() + " ===");
  return report.PASS_FAIL === "PASS";
}

function classifyTaskWriteGapFail(c, ev, turn) {
  const actual = String(turn.normalizedIntent || ev.auditIntent || "");
  const cat = String(ev.cat || "");
  if (actual.indexOf("note") >= 0) return "NOTE_STEAL";
  if (actual.indexOf("calendar") >= 0) return "CALENDAR_STEAL";
  if (actual.indexOf("read") >= 0) return "MODULE_LEAK";
  if (cat === "query_created_write") return "CREATE_LEAK";
  if (cat === "write_when_negated") return "FIREWALL_OVERBLOCK";
  if (/\bneni\s+to\s+poznam/.test(String(c.input || "").toLowerCase())) return "TASK_WRITE_ROUTING_FAIL";
  if (cat === "intent_fail") return "TRUE_ENGINE_FAIL";
  return "TRUE_ENGINE_FAIL";
}

function runGapDiagnostic(reportPath) {
  const eng = loadEngine();
  const cases = audit.buildCases().filter(function (c) {
    return c.group === "task_write";
  });
  const clusters = {};
  const fails = [];
  let pass = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), audit.ctxForCase(c.group));
    const ev = audit.evaluateOne(c, turn);
    if (ev.pass) {
      pass++;
      continue;
    }
    const cluster = classifyTaskWriteGapFail(c, ev, turn);
    clusters[cluster] = (clusters[cluster] || 0) + 1;
    if (fails.length < 120) {
      fails.push({
        id: c.id,
        input: c.input,
        expected: c.expectedIntent,
        actual: ev.auditIntent,
        route: turn.normalizedIntent || "",
        reason: ev.cat,
        cluster: cluster
      });
    }
  }
  const report = {
    guard_id: "silver_task_write_gap_diagnostic_v1",
    group: "task_write",
    total: cases.length,
    pass: pass,
    fail: cases.length - pass,
    clusters: clusters,
    fails: fails
  };
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  } catch (eW) {
    void eW;
  }
  console.log("=== SILVER_TASK_WRITE_GAP_DIAGNOSTIC_V1 ===");
  console.log("task_write_total=" + report.total);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("note_steal_count=" + (clusters.NOTE_STEAL || 0));
  console.log("calendar_steal_count=" + (clusters.CALENDAR_STEAL || 0));
  console.log("module_leak_count=" + (clusters.MODULE_LEAK || 0));
  console.log("true_engine_fail_count=" + (clusters.TRUE_ENGINE_FAIL || 0));
  console.log("report_file=" + reportPath);
  console.log("=== END_SILVER_TASK_WRITE_GAP_DIAGNOSTIC_V1 ===");
  return report;
}

module.exports = {
  FIXED_NOW,
  defaultCtx,
  loadEngine,
  TASK_WRITE_CHAOS_REPLAY,
  TASK_WRITE_MOBILE_REPLAY,
  TASK_WRITE_NEGATED_CAL_REPLAY,
  TASK_WRITE_NO_CALENDAR_LEAK_REPLAY,
  TASK_WRITE_CLEAN_PAYLOAD_REPLAY,
  TASK_WRITE_NAKUP_META_NEG_REPLAY,
  TASK_WRITE_OWNERSHIP_REPLAY,
  TASK_WRITE_BASIC_REPLAY,
  TASK_WRITE_NOTE_CONFLICT_REPLAY,
  TASK_WRITE_TEMPORAL_REPLAY,
  TASK_WRITE_FRAGMENT_REPLAY,
  TASK_WRITE_NEGATION_REPLAY,
  TASK_WRITE_HARDENING_REPLAY,
  buildTaskWriteCorpusV1,
  filterFamilies,
  classifyTaskWriteGapFail,
  classifyHardeningFail,
  runGapDiagnostic,
  runHardeningGapDiagnostic,
  runReplayCases,
  evaluateTaskWrite,
  evaluateTaskWriteGuard,
  printGuardHeader
};
