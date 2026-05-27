#!/usr/bin/env node
"use strict";

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
  if (intent !== c.expect) {
    if (!(c.allowClarification && intent === "clarification")) issues.push("intent:" + intent);
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
  runReplayCases,
  evaluateTaskWrite,
  printGuardHeader
};
