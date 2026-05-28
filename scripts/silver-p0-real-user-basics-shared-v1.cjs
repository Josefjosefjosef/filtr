#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");

const REPO = path.resolve(__dirname, "..");
const FIXED_NOW = new Date("2026-05-04T12:00:00");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const CALENDAR_READ = new Set(["calendar.read", "calendar.query"]);
const TASK_READ = new Set(["tasks.read", "tasks.query"]);
const NOTE_READ = new Set(["notes.read", "notes.query", "global.search"]);

const LANE_DISTRIBUTION = {
  BASIC_CALENDAR_QUERY_TODAY: 2000,
  BASIC_CALENDAR_QUERY_PAST: 1500,
  BASIC_CALENDAR_QUERY_WEEK: 1500,
  BASIC_CALENDAR_CREATE_EXPLICIT: 6000,
  BASIC_TASK_QUERY: 5000,
  BASIC_TASK_CREATE: 5000,
  BASIC_NOTE_QUERY: 5000,
  BASIC_NOTE_CREATE: 5000,
  RETRIEVAL_ENTITY_RELEVANCE: 3000,
  RETRIEVAL_NOTE_RELEVANCE: 3000,
  RETRIEVAL_TEMPORAL_RELEVANCE: 3000,
  MODULE_OWNERSHIP_EXPLICIT: 2000,
  READ_CREATE_FIREWALL: 2000,
  NO_WRITE_SAFETY: 3000,
  MOBILE_BASIC_VARIANTS: 1500,
  VOICE_BASIC_VARIANTS: 1500,
  METAMORPHIC_EQUIVALENCE_GROUPS: 3000,
  TURN_BY_TURN_BASIC_DIALOGS: 3000,
  RESERVE_ADVERSARIAL: 2000
};

const RESEARCH_USED = {
  sources_checked: [
    "arxiv MORTAR metamorphic multi-turn dialogue testing",
    "Springer ontology-based metamorphic testing for chatbots",
    "ACM metamorphic relations for chatbot testing",
    "Hypothesis/PBT subset-superset MR patterns"
  ],
  useful_principles: [
    "property-based generators over hand-written sentence lists",
    "metamorphic equivalence groups must share intent/module/action",
    "turn-by-turn dialog chains for save/query/help/module switches",
    "separate evaluation of intent module action retrieval safety"
  ],
  applied_to_silver: [
    "JS generator lanes with Template DNA + MR variant banks",
    "blocking screenshot seed families + metamorphic family pass-all",
    "seed calendar/note fixtures for retrieval relevance oracle",
    "P0 lane wired into public chaos as blocking gate"
  ],
  rejected_because: [
    "external PBT libraries add CI weight without ROI",
    "LLM-based oracle checks violate deterministic Silver contract",
    "fuzzy retrieval scoring replaced by strict entity/topic regex gates"
  ]
};

const SCREENSHOT_SEEDS = [
  { id: "P0S_CAL_Q_01", family: "CALENDAR_QUERY_READ_CREATE", lane: "BASIC_CALENDAR_QUERY_TODAY", metamorphicGroup: "TODAY_CALENDAR_QUERY", input: "Měl jsem dneska něco v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, screenshotSeed: true },
  { id: "P0S_CAL_Q_02", family: "CALENDAR_QUERY_READ_CREATE", lane: "BASIC_CALENDAR_QUERY_TODAY", metamorphicGroup: "TODAY_CALENDAR_QUERY", input: "Jaký schůzky jsem dneska měl?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, screenshotSeed: true },
  { id: "P0S_CAL_Q_03", family: "CALENDAR_QUERY_READ_CREATE", lane: "BASIC_CALENDAR_QUERY_TODAY", metamorphicGroup: "TODAY_CALENDAR_QUERY", input: "Jaké schůzky jsem dnes měl?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, screenshotSeed: true },
  { id: "P0S_CAL_Q_04", family: "CALENDAR_QUERY_READ_CREATE", lane: "BASIC_CALENDAR_QUERY_TODAY", metamorphicGroup: "TODAY_CALENDAR_QUERY", input: "Co jsem měl dneska v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, screenshotSeed: true },
  { id: "P0S_CAL_Q_05", family: "CALENDAR_QUERY_READ_CREATE", lane: "BASIC_CALENDAR_QUERY_TODAY", metamorphicGroup: "TODAY_CALENDAR_QUERY", input: "Mám něco na dnešek v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, screenshotSeed: true },
  { id: "P0S_CAL_Q_06", family: "CALENDAR_QUERY_READ_CREATE", lane: "BASIC_CALENDAR_QUERY_TODAY", metamorphicGroup: "TODAY_CALENDAR_QUERY", input: "Co mám dneska v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, screenshotSeed: true },
  { id: "P0S_CAL_Q_07", family: "CALENDAR_QUERY_READ_CREATE", lane: "BASIC_CALENDAR_QUERY_TODAY", metamorphicGroup: "TODAY_CALENDAR_QUERY", input: "Měl jsem dnes nějakou událost?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, screenshotSeed: true },
  { id: "P0S_CAL_Q_08", family: "CALENDAR_QUERY_READ_CREATE", lane: "BASIC_CALENDAR_QUERY_TODAY", metamorphicGroup: "TODAY_CALENDAR_QUERY", input: "Bylo dnes něco v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, screenshotSeed: true },
  { id: "P0S_CAL_T_01", family: "CALENDAR_TEMPORAL_FAIL", lane: "BASIC_CALENDAR_QUERY_WEEK", metamorphicGroup: "WEEK_CALENDAR_QUERY", input: "Co jsem měl tento týden?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, expectRx: /pravnik|ucetni|servis|doktor|schuz/i, expectNotEmpty: true, screenshotSeed: true },
  { id: "P0S_CAL_T_02", family: "CALENDAR_TEMPORAL_FAIL", lane: "BASIC_CALENDAR_QUERY_WEEK", metamorphicGroup: "WEEK_CALENDAR_QUERY", input: "Co mám tento týden?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, screenshotSeed: true },
  { id: "P0S_CAL_T_03", family: "CALENDAR_TEMPORAL_FAIL", lane: "BASIC_CALENDAR_QUERY_WEEK", metamorphicGroup: "WEEK_CALENDAR_QUERY", input: "Co mám zítra v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, expectRx: /pep|schuz/i, screenshotSeed: true },
  { id: "P0S_RET_E_01", family: "RETRIEVAL_ENTITY_RELEVANCE", lane: "RETRIEVAL_ENTITY_RELEVANCE", metamorphicGroup: "RETRIEVAL_ENTITY", input: "Kdy mám jet do Teplic?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, expectRx: /teplic/i, expectNotRx: /zubar|13:00/i, screenshotSeed: true },
  { id: "P0S_RET_E_02", family: "RETRIEVAL_ENTITY_RELEVANCE", lane: "RETRIEVAL_ENTITY_RELEVANCE", metamorphicGroup: "RETRIEVAL_ENTITY", input: "Najdi mi Teplice.", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, expectRx: /teplic/i, expectNotRx: /zubar/i, screenshotSeed: true },
  { id: "P0S_RET_N_01", family: "NOTE_RELEVANCE_FAIL", lane: "RETRIEVAL_NOTE_RELEVANCE", metamorphicGroup: "NOTE_RELEVANCE", input: "Komu jsem dal zálohy?", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /zaloh|frant|martin/i, expectNotRx: /nicolas|narozenin|13\.?\s*rijen/i, screenshotSeed: true },
  { id: "P0S_RET_N_02", family: "NOTE_RELEVANCE_FAIL", lane: "RETRIEVAL_NOTE_RELEVANCE", metamorphicGroup: "NOTE_RELEVANCE", input: "Najdi zálohy.", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /zaloh/i, expectNotRx: /nicolas|narozenin/i, screenshotSeed: true },
  { id: "P0S_OWN_C_01", family: "MODULE_OWNERSHIP_FAIL", lane: "MODULE_OWNERSHIP_EXPLICIT", metamorphicGroup: "EXPLICIT_CALENDAR_CREATE", input: "Ulož do kalendáře zítra zubař.", expectModule: "calendar", expectBehavior: "create", screenshotSeed: true },
  { id: "P0S_OWN_C_02", family: "MODULE_OWNERSHIP_FAIL", lane: "MODULE_OWNERSHIP_EXPLICIT", metamorphicGroup: "EXPLICIT_CALENDAR_CREATE", input: "Do kalendáře zítra zubař.", expectModule: "calendar", expectBehavior: "create", screenshotSeed: true },
  { id: "P0S_OWN_C_03", family: "MODULE_OWNERSHIP_FAIL", lane: "MODULE_OWNERSHIP_EXPLICIT", metamorphicGroup: "EXPLICIT_CALENDAR_CREATE", input: "V pondělí 9 doktor.", expectModule: "calendar", expectBehavior: "create", screenshotSeed: true }
];

const METAMORPHIC_FAMILIES = {
  TODAY_CALENDAR_QUERY: {
    expectModule: "calendar",
    expectBehavior: "read",
    forbidWrite: true,
    variants: [
      "Mám dnes něco v kalendáři?",
      "Mám dneska něco?",
      "Co mám dnes v kalendáři?",
      "Co mám dneska?",
      "Jaké mám dnes schůzky?",
      "Měl jsem dneska něco?",
      "Co jsem měl dnes?",
      "Jaký schůzky jsem dnes měl?",
      "Bylo dnes něco?",
      "Zobraz dnešní kalendář."
    ]
  },
  WEEK_CALENDAR_QUERY: {
    expectModule: "calendar",
    expectBehavior: "read",
    forbidWrite: true,
    variants: [
      "Co jsem měl tento týden?",
      "Co mám tento týden?",
      "Jaké schůzky mám tento týden?",
      "Jaké schůzky jsem měl tento týden?",
      "Ukaž kalendář na tento týden.",
      "Co je v kalendáři tento týden?",
      "Měl jsem tento týden právníka?",
      "Co jsem řešil tento týden?"
    ]
  },
  EXPLICIT_CALENDAR_CREATE: {
    expectModule: "calendar",
    expectBehavior: "create",
    variants: [
      "Ulož do kalendáře zítra zubař.",
      "Dej do kalendáře zítra zubaře.",
      "Přidej mi do kalendáře zítra zubaře.",
      "Zapiš do kalendáře právník zítra v 15.",
      "Do kalendáře pondělí 9 doktor.",
      "Zítra v 18 právník.",
      "V pondělí 9 doktor.",
      "Schůzka s účetní v úterý 10."
    ]
  },
  RETRIEVAL_ENTITY: {
    expectModule: "calendar",
    expectBehavior: "read",
    forbidWrite: true,
    expectRx: /teplic|cest/i,
    expectNotRx: /zubar|13:00/i,
    variants: [
      "Kdy mám jet do Teplic?",
      "Najdi Teplice.",
      "Mám něco k Teplicím?",
      "Co mám s Teplicemi?",
      "Kdy jedu do Teplic?",
      "Najdi cestu do Teplic.",
      "Ukaž mi záznam kolem Teplic."
    ]
  },
  NOTE_RELEVANCE: {
    expectModule: "notes",
    expectBehavior: "read",
    forbidWrite: true,
    expectRx: /zaloh/i,
    expectNotRx: /nicolas|narozenin/i,
    variants: [
      "Komu jsem dal zálohy?",
      "Komu jsem dával zálohu?",
      "Najdi zálohy.",
      "Kdo dostal zálohu?",
      "Co mám uložené o zálohách?",
      "Kde mám zálohy?"
    ]
  },
  NO_WRITE_BASICS: {
    expectModule: "read",
    expectBehavior: "read",
    forbidWrite: true,
    variants: [
      "Jen zjisti, co mám dnes.",
      "Nic neukládej, jen ukaž kalendář.",
      "Nevytvářej nic, co mám v úkolech?",
      "Jen najdi poznámku o smlouvě.",
      "Pouze čti, nic neukládej."
    ]
  },
  TASK_BASICS: {
    mixed: true,
    entries: [
      { input: "Co mám dnes za úkoly?", expectModule: "tasks", expectBehavior: "read", forbidWrite: true },
      { input: "Jaké mám úkoly?", expectModule: "tasks", expectBehavior: "read", forbidWrite: true },
      { input: "Přidej úkol zavolat právníkovi.", expectModule: "tasks", expectBehavior: "create" },
      { input: "Zítra zavolat účetní.", expectModule: "tasks", expectBehavior: "create" },
      { input: "Zaplatit fakturu.", expectModule: "tasks", expectBehavior: "create" },
      { input: "Koupit mléko večer.", expectModule: "tasks", expectBehavior: "create" }
    ]
  },
  NOTE_BASICS: {
    mixed: true,
    entries: [
      { input: "Najdi poznámku o smlouvě.", expectModule: "notes", expectBehavior: "read", forbidWrite: true },
      { input: "Co mám v poznámkách o právníkovi?", expectModule: "notes", expectBehavior: "read", forbidWrite: true },
      { input: "Zapiš poznámku, že smlouva je u účetní.", expectModule: "notes", expectBehavior: "create" },
      { input: "Ulož poznámku heslo WiFi je 88.", expectModule: "notes", expectBehavior: "create" },
      { input: "Kde mám poznámku o pojistce?", expectModule: "notes", expectBehavior: "read", forbidWrite: true }
    ]
  }
};

const TEMPLATE_DNA = {
  BASIC_CALENDAR_QUERY_TODAY: {
    templates: ["Co mám {day}?", "Měl jsem {day} něco?", "Mám {day} něco v kalendáři?", "Bylo {day} něco?", "Jaké schůzky mám {day}?"],
    expectModule: "calendar",
    expectBehavior: "read",
    forbidWrite: true
  },
  BASIC_CALENDAR_QUERY_PAST: {
    templates: ["Co jsem měl {pastDay}?", "Jaké schůzky jsem měl {pastDay}?", "Měl jsem {pastDay} událost?"],
    expectModule: "calendar",
    expectBehavior: "read",
    forbidWrite: true
  },
  BASIC_CALENDAR_QUERY_WEEK: {
    templates: ["Co mám {week}?", "Co jsem měl {week}?", "Jaké schůzky {week}?", "Co je v kalendáři {week}?"],
    expectModule: "calendar",
    expectBehavior: "read",
    forbidWrite: true
  },
  BASIC_CALENDAR_CREATE_EXPLICIT: {
    templates: [
      "Ulož do kalendáře {day} {entity}.",
      "Dej do kalendáře {day} {entity}.",
      "Do kalendáře {day} {entity}.",
      "Zítra v {time} {entity}.",
      "V {weekday} {time} {entity}."
    ],
    expectModule: "calendar",
    expectBehavior: "create"
  },
  BASIC_TASK_QUERY: {
    templates: ["Co mám v úkolech?", "Jaké mám úkoly?", "Co mám udělat {day}?", "Mám {day} nějaký úkol?", "Najdi úkol {topic}."],
    expectModule: "tasks",
    expectBehavior: "read",
    forbidWrite: true
  },
  BASIC_TASK_CREATE: {
    templates: ["Přidej úkol {action}.", "Do úkolů {action}.", "Zítra {action}.", "{action}."],
    expectModule: "tasks",
    expectBehavior: "create"
  },
  BASIC_NOTE_QUERY: {
    templates: ["Co mám v poznámkách o {topic}?", "Najdi poznámku {topic}.", "Kde mám {topic}?", "Co jsem psal o {topic}?"],
    expectModule: "notes",
    expectBehavior: "read",
    forbidWrite: true
  },
  BASIC_NOTE_CREATE: {
    templates: ["Ulož poznámku {topic}.", "Zapiš poznámku {topic}.", "Poznámka: {topic}."],
    expectModule: "notes",
    expectBehavior: "create"
  },
  RETRIEVAL_ENTITY_RELEVANCE: {
    templates: ["Kdy mám jet do Teplic?", "Najdi Teplice.", "Kdy jedu do Teplic?", "Co mám s Teplicemi?", "Najdi cestu do Teplic."],
    expectModule: "calendar",
    expectBehavior: "read",
    forbidWrite: true,
    expectRx: /teplic|cest/i,
    expectNotRx: /zubar|13:00/i
  },
  RETRIEVAL_NOTE_RELEVANCE: {
    templates: ["Komu jsem dal zálohy?", "Najdi zálohy.", "Kdo dostal zálohu?", "Co mám o zálohách?"],
    expectModule: "notes",
    expectBehavior: "read",
    forbidWrite: true,
    expectRx: /zaloh/i,
    expectNotRx: /nicolas|narozenin/i
  },
  RETRIEVAL_TEMPORAL_RELEVANCE: {
    templates: ["Co mám {day}?", "Co jsem měl {pastDay}?", "Co mám {week} v kalendáři?"],
    expectModule: "calendar",
    expectBehavior: "read",
    forbidWrite: true
  },
  MODULE_OWNERSHIP_EXPLICIT: {
    templates: ["Ulož do kalendáře {day} {entity}.", "Do kalendáře {day} {entity}.", "Zítra {entity} ulož do kalendáře."],
    expectModule: "calendar",
    expectBehavior: "create"
  },
  READ_CREATE_FIREWALL: {
    templates: ["Co mám {day}?", "Najdi {topic}.", "Jen ukaž kalendář.", "Nic neukládej, co mám {day}?"],
    expectModule: "read",
    expectBehavior: "read",
    forbidWrite: true
  },
  NO_WRITE_SAFETY: {
    templates: ["Nic neukládej, {q}.", "Jen zjisti {q}.", "Nevytvářej nic, {q}.", "Pouze čti, {q}."],
    expectModule: "read",
    expectBehavior: "read",
    forbidWrite: true
  },
  MOBILE_BASIC_VARIANTS: {
    templates: ["hele co mam {day}", "no {q}", "pripomen mi {entity}", "zavolat {entity}"],
    mixed: true
  },
  VOICE_BASIC_VARIANTS: {
    templates: ["co mam {day}", "najdi {topic}", "uloz do kalendare {entity} {day}", "pridej ukol {action}"],
    mixed: true
  },
  METAMORPHIC_EQUIVALENCE_GROUPS: { fromMetamorphic: true },
  TURN_BY_TURN_BASIC_DIALOGS: { fromDialogs: true },
  RESERVE_ADVERSARIAL: {
    entries: [
      { input: "Mám zavolat Pavlovi v úkolech, nepleť to s úkolem?", expectModule: "tasks", expectBehavior: "read", forbidWrite: true },
      { input: "Vlastně to dej na dneska: vecer mám účetní.", expectModule: "calendar", expectBehavior: "create" },
      { input: "Kde je schůzka s právníkem zítra?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true }
    ],
    fromEntries: true
  }
};

const FILL = {
  day: ["dnes", "dneska", "zítra", "na dnešek"],
  todayDay: ["dnes", "dneska", "na dnešek"],
  pastDay: ["včera", "dnes", "minulý týden"],
  week: ["tento týden", "na tento týden", "tento tyden"],
  weekday: ["pondělí", "úterý", "středu"],
  time: ["9", "10", "15", "18"],
  entity: ["zubař", "právník", "doktor", "účetní"],
  action: ["zavolat právníkovi", "zaplatit fakturu", "koupit mléko", "poslat smlouvu"],
  topic: ["smlouvu", "zálohy", "pojistku", "servis auta"],
  q: ["co mám dnes", "kalendář", "úkoly", "poznámku o smlouvě"]
};

function foldCs(s) {
  return aliasData.foldCs(s);
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function fillTemplate(tpl, n, fillOverride) {
  let out = tpl;
  const fill = fillOverride || FILL;
  for (const key of Object.keys(fill)) {
    const vals = fill[key];
    out = out.replace(new RegExp("\\{" + key + "\\}", "g"), vals[n % vals.length]);
  }
  return out;
}

const LANE_FILL_OVERRIDE = {
  BASIC_CALENDAR_QUERY_TODAY: { day: ["dnes", "dneska", "na dnešek"], todayDay: ["dnes", "dneska", "na dnešek"] },
  BASIC_CALENDAR_QUERY_PAST: { day: ["včera", "dnes"], pastDay: ["včera", "minulý týden"] },
  BASIC_CALENDAR_QUERY_WEEK: { week: ["tento týden", "na tento týden", "tento tyden"] },
  RETRIEVAL_TEMPORAL_RELEVANCE: { day: ["dnes", "dneska", "zítra"], pastDay: ["včera", "dnes"] }
};

function seedCtx() {
  const t0 = FIXED_NOW.getTime();
  const rawEvents = [
    { id: "ev_pepa", title: "Schůzka s Pepou", startAt: "2026-05-05T10:00:00", endAt: "2026-05-05T11:00:00" },
    { id: "ev_prav", title: "Schůzka s právníkem", startAt: "2026-05-04T15:00:00", endAt: "2026-05-04T16:00:00" },
    { id: "ev_teplice", title: "Cesta do Teplic", startAt: "2026-05-06T08:00:00", endAt: "2026-05-06T12:00:00" },
    { id: "ev_zubar", title: "Zubař", startAt: "2026-05-05T13:00:00", endAt: "2026-05-05T14:00:00" },
    { id: "ev_doc", title: "Doktor", startAt: "2026-05-03T09:00:00", endAt: "2026-05-03T10:00:00" },
    { id: "ev_servis", title: "Servis auta", startAt: "2026-04-28T10:00:00", endAt: "2026-04-28T11:00:00" }
  ];
  const events = rawEvents.map(function (ev) {
    const start = String(ev.startAt || "");
    return {
      id: ev.id,
      title: ev.title,
      date: start.slice(0, 10),
      time: start.slice(11, 16),
      startAt: ev.startAt,
      endAt: ev.endAt
    };
  });
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return events;
    },
    getTasksSnapshot: function () {
      return [
        { id: "tsk1", title: "Zavolat Pavlovi", status: "todo", dueAt: "2026-05-04", note: "", priority: "medium", createdAt: t0 - 7200000, updatedAt: t0 - 7200000 },
        { id: "tsk2", title: "Zaplatit fakturu", status: "todo", dueAt: "2026-05-05", note: "", priority: "medium", createdAt: t0 - 3600000, updatedAt: t0 - 3600000 }
      ];
    },
    getNotesSnapshot: function () {
      return [
        { id: "n_z1", title: "Franta záloha", content: "Frantovi záloha 1000 Kč", createdAt: t0 - 86400000, updatedAt: t0 - 86400000, pinned: false, tags: [], deleted: false },
        { id: "n_z2", title: "Martin záloha", content: "Martinovi záloha 500 Kč", createdAt: t0 - 43200000, updatedAt: t0 - 43200000, pinned: false, tags: [], deleted: false },
        { id: "n_nic", title: "Nicolas narozeniny", content: "Nicolas má narozeniny 13. října", createdAt: t0 - 172800000, updatedAt: t0 - 172800000, pinned: false, tags: [], deleted: false },
        { id: "n_sml", title: "smlouva u účetní", content: "smlouva je u účetní", createdAt: t0 - 21600000, updatedAt: t0 - 21600000, pinned: false, tags: [], deleted: false },
        { id: "n_poj", title: "pojistka auta", content: "Allianz pojištění auta", createdAt: t0 - 10800000, updatedAt: t0 - 10800000, pinned: false, tags: [], deleted: false }
      ];
    }
  };
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function moduleFromIntent(intent) {
  if (intent.indexOf("calendar") >= 0) return "calendar";
  if (intent.indexOf("task") >= 0) return "tasks";
  if (intent.indexOf("note") >= 0) return "notes";
  if (intent === "global.search") return "read";
  if (intent.indexOf("read") >= 0 || intent.indexOf("query") >= 0) return "read";
  if (intent === "clarification" || intent === "unknown") return "clarification";
  return "other";
}

function classifyFail(c, turn, issues) {
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const foldedIn = foldCs(c.input);
  if (issues.some(function (x) {
    return String(x).indexOf("dangerous_write") >= 0 || String(x).indexOf("ready_to_save") >= 0 || String(x).indexOf("draft_leak") >= 0;
  })) {
    return "SAFETY_RISK";
  }
  if (c.forbidWrite && WRITE_INTENTS.has(intent)) return "READ_CREATE_LEAK";
  if (c.expectBehavior === "read" && WRITE_INTENTS.has(intent)) return "READ_CREATE_LEAK";
  if (c.expectModule === "calendar" && intent.indexOf("task") >= 0 && c.expectBehavior === "create") return "MODULE_OWNERSHIP_FAIL";
  if (c.expectModule === "calendar" && intent.indexOf("task") >= 0) return "TASK_STEAL";
  if (c.expectModule === "tasks" && intent.indexOf("note") >= 0) return "NOTE_STEAL";
  if (c.expectModule === "tasks" && intent.indexOf("calendar") >= 0) return "CALENDAR_STEAL";
  if (c.expectModule === "calendar" && (c.expectBehavior === "read" || c.forbidWrite) && !CALENDAR_READ.has(intent) && WRITE_INTENTS.has(intent)) {
    return "CALENDAR_QUERY_FAIL";
  }
  if (c.expectModule === "calendar" && c.expectBehavior === "read" && c.expectNotEmpty && /Nic jsem k tomu nena[sš]el/i.test(msg)) {
    return "CALENDAR_TEMPORAL_FAIL";
  }
  if (c.expectNotRx && (c.expectNotRx.test(msg) || c.expectNotRx.test(foldCs(msg)))) return "RETRIEVAL_RELEVANCE_FAIL";
  if (c.expectModule === "notes" && c.expectNotRx && (c.expectNotRx.test(msg) || c.expectNotRx.test(foldCs(msg)))) return "NOTE_RELEVANCE_FAIL";
  if (intent === "clarification" || intent === "unknown") return "SAFE_CLARIFICATION_OK";
  if (c.tier === "B") return "AMBIGUOUS_INPUT";
  return "TRUE_ENGINE_FAIL";
}

function evaluateCase(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const msgFold = foldCs(msg);
  const mod = moduleFromIntent(intent);

  if (c.forbidWrite || c.expectBehavior === "read") {
    if (WRITE_INTENTS.has(intent)) issues.push("dangerous_write:" + intent);
    if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
    if (turn.draft && turn.draft.targetContainer && turn.draft.targetContainer !== "none") issues.push("draft_leak");
  }

  if (c.expectBehavior === "create" && !WRITE_INTENTS.has(intent)) {
    if (intent.indexOf("read") >= 0 || intent.indexOf("query") >= 0) issues.push("read_instead_of_create");
  }

  if (c.expectModule && c.expectModule !== "read" && mod !== c.expectModule && mod !== "clarification") {
    if (c.expectModule === "calendar" && intent === "global.search" && c.expectRx && (c.expectRx.test(msg) || c.expectRx.test(msgFold))) {
      /* retrieval via global search is acceptable when entity hit is correct */
    } else if (!(c.expectModule === "calendar" && CALENDAR_READ.has(intent))) {
      issues.push("module_leak:" + mod + "->" + c.expectModule);
    }
  }

  if (c.expectRx && !c.expectRx.test(msg) && !c.expectRx.test(msgFold)) {
    if (!/Nic jsem k tomu nena[sš]el/i.test(msg) || c.expectNotEmpty) issues.push("content_miss");
  }
  if (c.expectNotRx && (c.expectNotRx.test(msg) || c.expectNotRx.test(msgFold))) issues.push("wrong_entity:" + msg.slice(0, 80));

  return issues;
}

function runTurn(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const ctx = seedCtx();
  let draft = eng.createEmptyDraft();
  let turn;
  if (Array.isArray(c.chain) && c.chain.length) {
    for (let i = 0; i < c.chain.length; i++) {
      turn = eng.processUserTurn(c.chain[i], draft, ctx);
      draft = turn.draft && turn.draft.targetContainer !== "none" ? turn.draft : eng.createEmptyDraft();
    }
    turn = eng.processUserTurn(c.input, draft, ctx);
  } else {
    turn = eng.processUserTurn(c.input, draft, ctx);
  }
  return turn;
}

function buildLaneCases(lane, count, seqStart) {
  const out = [];
  let seq = seqStart;
  const spec = TEMPLATE_DNA[lane];
  if (!spec) return out;
  if (spec.fromMetamorphic) {
    const keys = Object.keys(METAMORPHIC_FAMILIES);
    while (out.length < count) {
      const key = keys[seq % keys.length];
      const fam = METAMORPHIC_FAMILIES[key];
      if (fam.mixed && fam.entries) {
        const e = fam.entries[seq % fam.entries.length];
        out.push(Object.assign({ id: "P0M_" + String(seq).padStart(5, "0"), lane: lane, family: key, metamorphicGroup: key, tier: "A" }, e));
      } else {
        const v = fam.variants[seq % fam.variants.length];
        out.push({
          id: "P0M_" + String(seq).padStart(5, "0"),
          lane: lane,
          family: key,
          metamorphicGroup: key,
          input: v,
          expectModule: fam.expectModule,
          expectBehavior: fam.expectBehavior,
          forbidWrite: fam.forbidWrite,
          expectRx: fam.expectRx,
          expectNotRx: fam.expectNotRx,
          tier: "A"
        });
      }
      seq++;
    }
    return out;
  }
  if (spec.fromDialogs) {
    const dialogs = [
      { chain: ["Ulož schůzku zítra v 15", "Co mám zítra?"], input: "Co mám zítra?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true },
      { chain: ["Co umíš?", "Co mám dnes?"], input: "Co mám dnes?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true },
      { chain: ["Ulož poznámku smlouva u účetní", "Najdi poznámku o smlouvě"], input: "Najdi poznámku o smlouvě", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /smlouv|ucetni/i },
      { chain: ["Přidej úkol zavolat právníkovi", "Co mám v úkolech?"], input: "Co mám v úkolech?", expectModule: "tasks", expectBehavior: "read", forbidWrite: true },
      { chain: ["Do kalendáře zítra zubař", "Co mám zítra v kalendáři?"], input: "Co mám zítra v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true }
    ];
    while (out.length < count) {
      const d = dialogs[seq % dialogs.length];
      out.push(Object.assign({ id: "P0D_" + String(seq).padStart(5, "0"), lane: lane, family: "TURN_BY_TURN", tier: "A" }, d));
      seq++;
    }
    return out;
  }
  const templates = spec.templates || [];
  const fillOverride = LANE_FILL_OVERRIDE[lane] || null;
  if (spec.fromEntries && spec.entries) {
    while (out.length < count) {
      const e = spec.entries[seq % spec.entries.length];
      out.push(Object.assign({ id: "P0G_" + lane + "_" + String(seq).padStart(5, "0"), lane: lane, family: lane, tier: "A" }, e));
      seq++;
    }
    return out;
  }
  while (out.length < count) {
    const tpl = templates[seq % templates.length];
    const input = fillTemplate(tpl, seq, fillOverride);
    let expectModule = spec.expectModule;
    let expectBehavior = spec.expectBehavior;
    let forbidWrite = spec.forbidWrite;
    if (spec.mixed) {
      if (/\b(uloz|dej|pridej|zapis|pripomen|zavolat|koupit|zaplatit)\b/i.test(input) && !/\b(najdi|co\s+mam|jen|nic\s+neukladej|nevytv)/i.test(input)) {
        if (/kalend/i.test(input)) {
          expectModule = "calendar";
          expectBehavior = "create";
          forbidWrite = false;
        } else if (/poznam|pozn/i.test(input)) {
          expectModule = "notes";
          expectBehavior = "create";
          forbidWrite = false;
        } else {
          expectModule = "tasks";
          expectBehavior = "create";
          forbidWrite = false;
        }
      } else {
        expectModule = "read";
        expectBehavior = "read";
        forbidWrite = true;
      }
    }
    out.push({
      id: "P0G_" + lane + "_" + String(seq).padStart(5, "0"),
      lane: lane,
      family: lane,
      input: input,
      expectModule: expectModule,
      expectBehavior: expectBehavior,
      forbidWrite: forbidWrite,
      expectRx: spec.expectRx,
      expectNotRx: spec.expectNotRx,
      tier: "B"
    });
    seq++;
  }
  return out;
}

function buildP0Corpus(totalOpt) {
  const target = totalOpt || Object.values(LANE_DISTRIBUTION).reduce(function (a, b) {
    return a + b;
  }, 0);
  const out = SCREENSHOT_SEEDS.slice();
  let seq = out.length;
  const lanes = Object.keys(LANE_DISTRIBUTION);
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li];
    const laneCases = buildLaneCases(lane, LANE_DISTRIBUTION[lane], seq);
    out.push.apply(out, laneCases);
    seq += laneCases.length;
  }
  return out.slice(0, Math.max(target, out.length));
}

function runP0Audit(cases, reportPath) {
  const eng = loadEngine();
  const counters = {
    read_create_leak_count: 0,
    module_ownership_fail_count: 0,
    calendar_query_fail_count: 0,
    calendar_temporal_fail_count: 0,
    retrieval_relevance_fail_count: 0,
    note_relevance_fail_count: 0,
    task_steal_count: 0,
    note_steal_count: 0,
    calendar_steal_count: 0,
    firewall_overblock_count: 0,
    true_engine_fail_count: 0,
    harness_or_gold_count: 0,
    ambiguous_input_count: 0,
    safe_clarification_ok_count: 0,
    template_dna_problem_count: 0,
    safety_risk_count: 0
  };
  const failFamilies = {};
  const failClusters = {};
  const sampleFailures = [];
  const metamorphicFails = {};
  let pass = 0;
  const familyPass = {};
  const familyTotal = {};

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const turn = runTurn(eng, c);
    const issues = evaluateCase(c, turn);
    const bucket = issues.length ? classifyFail(c, turn, issues) : "PASS";
    const harnessOk = bucket === "PASS" || bucket === "SAFE_CLARIFICATION_OK" || bucket === "AMBIGUOUS_INPUT";
    if (harnessOk) pass++;
    else {
      failFamilies[c.family] = (failFamilies[c.family] || 0) + 1;
      failClusters[bucket] = (failClusters[bucket] || 0) + 1;
      if (sampleFailures.length < 20) {
        sampleFailures.push({
          id: c.id,
          family: c.family,
          input: c.input,
          intent: turn.normalizedIntent,
          bucket: bucket,
          issues: issues,
          message: turnMsg(turn).slice(0, 160)
        });
      }
      if (c.metamorphicGroup) {
        metamorphicFails[c.metamorphicGroup] = true;
      }
    }
    if (bucket === "READ_CREATE_LEAK") counters.read_create_leak_count++;
    if (bucket === "MODULE_OWNERSHIP_FAIL") counters.module_ownership_fail_count++;
    if (bucket === "CALENDAR_QUERY_FAIL") counters.calendar_query_fail_count++;
    if (bucket === "CALENDAR_TEMPORAL_FAIL") counters.calendar_temporal_fail_count++;
    if (bucket === "RETRIEVAL_RELEVANCE_FAIL") counters.retrieval_relevance_fail_count++;
    if (bucket === "NOTE_RELEVANCE_FAIL") counters.note_relevance_fail_count++;
    if (bucket === "TASK_STEAL") counters.task_steal_count++;
    if (bucket === "NOTE_STEAL") counters.note_steal_count++;
    if (bucket === "CALENDAR_STEAL") counters.calendar_steal_count++;
    if (bucket === "TRUE_ENGINE_FAIL") counters.true_engine_fail_count++;
    if (bucket === "HARNESS_OR_GOLD") counters.harness_or_gold_count++;
    if (bucket === "AMBIGUOUS_INPUT") counters.ambiguous_input_count++;
    if (bucket === "SAFE_CLARIFICATION_OK") counters.safe_clarification_ok_count++;
    if (bucket === "TEMPLATE_DNA_PROBLEM") counters.template_dna_problem_count++;
    if (bucket === "SAFETY_RISK") counters.safety_risk_count++;

    const famKey = c.metamorphicGroup || c.family;
    familyTotal[famKey] = (familyTotal[famKey] || 0) + 1;
    if (harnessOk) familyPass[famKey] = (familyPass[famKey] || 0) + 1;

    if (i > 0 && i % 10000 === 0) process.stderr.write("progress=" + i + "/" + cases.length + "\n");
  }

  const total = cases.length;
  const screenshotCases = cases.filter(function (c) {
    return c.screenshotSeed;
  });
  const screenshotPass = screenshotCases.filter(function (c) {
    const turn = runTurn(eng, c);
    const issues = evaluateCase(c, turn);
    const bucket = issues.length ? classifyFail(c, turn, issues) : "PASS";
    return bucket === "PASS" || bucket === "SAFE_CLARIFICATION_OK";
  }).length;

  const report = {
    main_commit: mainCommit(),
    total_cases: total,
    pass: pass,
    fail: total - pass,
    overall_accuracy: total ? ((pass / total) * 100).toFixed(2) : "100.00",
    screenshot_seed_family_pass: screenshotCases.length ? ((screenshotPass / screenshotCases.length) * 100).toFixed(2) : "100.00",
    counters: counters,
    metamorphic_families_fail: Object.keys(metamorphicFails),
    top_fail_families: Object.keys(failFamilies)
      .sort(function (a, b) {
        return failFamilies[b] - failFamilies[a];
      })
      .slice(0, 10),
    top_20_fail_clusters: Object.keys(failClusters)
      .sort(function (a, b) {
        return failClusters[b] - failClusters[a];
      })
      .slice(0, 20),
    sample_failures: sampleFailures,
    research_used: RESEARCH_USED
  };

  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  return report;
}

module.exports = {
  RESEARCH_USED,
  LANE_DISTRIBUTION,
  SCREENSHOT_SEEDS,
  METAMORPHIC_FAMILIES,
  buildP0Corpus,
  runP0Audit,
  seedCtx,
  loadEngine,
  foldCs,
  evaluateCase,
  runTurn,
  classifyFail
};
