#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");

const REPO = path.resolve(__dirname, "..");
const FIXED_NOW = new Date("2026-05-29T12:00:00");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const NOTE_READ = new Set(["notes.read", "notes.query", "global.search"]);
const TASK_READ = new Set(["tasks.read", "tasks.query"]);
const CAL_READ = new Set(["calendar.read", "calendar.query"]);

const LANE_DISTRIBUTION = {
  NOTES_SEARCH_READ: 10000,
  TASKS_SEARCH_READ: 10000,
  CALENDAR_METAMORPHIC: 8000,
  CROSS_MODULE: 8000,
  STRUCTURED_EXTRACTION: 5000,
  NEGATIVE_NO_RESULT: 5000,
  MOBILE_VOICE_VARIANT: 4000
};

const SCREENSHOT_NOTES = [
  "auto má SPZ 42",
  "záruka na TV končí 1.1.2027",
  "Nicolas má narozeniny 13. října",
  "taťka má narozeniny v říjnu",
  "tomáš má narozeniny v květnu",
  "Auto má šířku 5 m",
  "Taška má červenou barvu",
  "Dneska jsem dal Pepovi zálohu 500 Kč",
  "To auto jezdí rychlostí až 200 kilometrů",
  "Dneska jsem dal Frantovi zálohu 1000 Kč",
  "Chleba váží 5 kg",
  "TV má záruku do listopadu 2026",
  "Máme doma bílé umyvadlo ale chceme mít červené",
  "Petrovi jsem dal zálohu 500 Kč",
  "adresa Botanický zahrady je vinohradská 3 Praha",
  "Stůl má šířku 2 m",
  "adresa Botanické zahrady je vinohradská 3 Praha"
];

const SCREENSHOT_SEEDS = [
  { id: "SS_CAL_SAVE_01", family: "calendar_save_field_isolation_and_note_cleanup", lane: "CROSS_MODULE", blocking: false, input: "Do kalendáře: zítra v 15 hod. schůzka s Tomášem adresa Praha jedna do poznámky mi přidej ať si sebou vezmu deštník", expectModule: "calendar", expectBehavior: "create", expectRx: /schuz|tomas|praha/i },
  { id: "SS_NOTE_CREATE_01", family: "explicit_note_create_routed_to_note_search", lane: "NOTES_SEARCH_READ", blocking: true, input: "Do poznámkách: záruka na TV mi končí 1.1.2027", expectModule: "notes", expectBehavior: "create", expectRx: /zaruk|tv/i, forbidRead: true },
  { id: "SS_NOTE_REL_01", family: "notes_relevance_overbroad_fallback", lane: "NOTES_SEARCH_READ", blocking: true, input: "Kdy mi končí záruka na televizi?", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /zaruk.*tv|tv.*zaruk/i, expectNotRx: /spz|42/i, notesSubset: ["záruka na TV končí 1.1.2027", "auto má SPZ 42"] },
  { id: "SS_NOTE_REL_02", family: "notes_relevance_overbroad_fallback", lane: "NOTES_SEARCH_READ", blocking: true, input: "Kdy končí záruka na televizi mi", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /tv.*zaruk|zaruk.*tv|listopad/i, expectNotRx: /chleba|franta\s+zaloh/i, notesSubset: ["TV má záruku do listopadu 2026", "Chleba váží 5 kg", "Franta záloha", "Pepa záloha", "auto rychlost"] },
  { id: "SS_NOTE_MOD_01", family: "wrong_dataset_task_result_for_note_query", lane: "CROSS_MODULE", blocking: true, input: "Dokdy má TV záruku", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /zaruk|tv/i, expectNotRx: /najem|ukol/i },
  { id: "SS_PERSON_01", family: "person_birthday_note_query_not_recognized", lane: "NOTES_SEARCH_READ", blocking: true, input: "Kdy má nicolas narozeniny", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /nicolas|13.*rijen/i, expectNotRx: /upresni|kalend/i },
  { id: "SS_PERSON_02", family: "family_member_birthday_note_query_not_recognized", lane: "NOTES_SEARCH_READ", blocking: true, input: "Kdy má táta narozeniny", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /tat|rijen/i, expectNotRx: /upresni/i },
  { id: "SS_PERSON_03", family: "person_birthday_note_query_not_recognized", lane: "NOTES_SEARCH_READ", blocking: true, input: "Kdy má Tomáš narozeniny", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /tomas|kvet/i, expectNotRx: /upresni/i },
  { id: "SS_PERSON_04", family: "wrong_dataset_calendar_result_for_person_note_query", lane: "CROSS_MODULE", blocking: true, input: "Najdi mi kdy má nicolas narozeniny", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /nicolas|narozenin/i, expectNotRx: /kluk|10:00/i },
  { id: "SS_PERSON_05", family: "notes_person_entity_filtering_fail", lane: "NOTES_SEARCH_READ", blocking: true, input: "Najdi mi v poznámkách kdy má nicolas narozeniny", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /nicolas/i, expectNotRx: /tomas|tatka/i },
  { id: "SS_PERSON_06", family: "notes_person_entity_filtering_fail", lane: "NOTES_SEARCH_READ", blocking: true, input: "Máš v poznámkách něco o Nicolasovi?", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /nicolas|nenašel|nenašla/i, expectNotRx: /tomas|tatka|pep/i },
  { id: "SS_WIFI_01", family: "notes_direct_fact_retrieval_miss", lane: "NOTES_SEARCH_READ", blocking: true, input: "Jaké je heslo na wifi?", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectEmptyOrMiss: true, expectNotRx: /spz|narozenin|zaloh/i },
  { id: "SS_OBJ_01", family: "notes_object_property_relevance_and_filtering", lane: "NOTES_SEARCH_READ", blocking: true, input: "Jakou barvu má taška?", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /cerven|taska/i, expectNotRx: /tomas|tatka/i },
  { id: "SS_ADDR_01", family: "notes_address_question_not_recognized_as_read", lane: "NOTES_SEARCH_READ", blocking: true, input: "Jaká je adresa Botanické zahrady?", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /vinohradsk|botanick/i, expectNotRx: /upresni/i },
  { id: "SS_TASK_LEAK_01", family: "task_search_question_to_create_leak", lane: "TASKS_SEARCH_READ", blocking: true, input: "Kdy mám zavolat dědovi?", expectModule: "tasks", expectBehavior: "read", forbidWrite: true, expectRx: /ded|31/i },
  { id: "SS_TASK_LEAK_02", family: "task_search_question_to_create_leak", lane: "TASKS_SEARCH_READ", blocking: true, input: "Kdy mám koupit mámě kytku?", expectModule: "tasks", expectBehavior: "read", forbidWrite: true, expectRx: /kyt/i },
  { id: "SS_TASK_LEAK_03", family: "task_search_question_to_create_leak", lane: "TASKS_SEARCH_READ", blocking: true, input: "Do kdy mám zaplatit nájem?", expectModule: "tasks", expectBehavior: "read", forbidWrite: true, expectRx: /najem|31/i },
  { id: "SS_TASK_TOP_01", family: "task_topic_filtering_returns_all_tasks", lane: "TASKS_SEARCH_READ", blocking: true, input: "Mám v úkolech něco o kytce?", expectModule: "tasks", expectBehavior: "read", forbidWrite: true, expectRx: /kyt/i, expectNotRx: /ded|najem/i },
  { id: "SS_CAL_META_01", family: "calendar_tomorrow_query_metamorphic_inconsistency", lane: "CALENDAR_METAMORPHIC", blocking: true, metamorphicGroup: "TOMORROW_AGENDA", input: "Co mám zítra v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, expectRx: /kluk|noe|petr/i },
  { id: "SS_CAL_META_02", family: "calendar_tomorrow_query_metamorphic_inconsistency", lane: "CALENDAR_METAMORPHIC", blocking: true, metamorphicGroup: "TOMORROW_AGENDA", input: "Co mám na zítra v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, expectRx: /kluk|noe|petr/i },
  { id: "SS_CAL_META_03", family: "calendar_tomorrow_query_metamorphic_inconsistency", lane: "CALENDAR_METAMORPHIC", blocking: true, metamorphicGroup: "TOMORROW_AGENDA", input: "Mám něco na zítra v kalendáři?", expectModule: "calendar", expectBehavior: "read", forbidWrite: true, expectRx: /kluk|noe|petr/i },
  { id: "SS_STRUCT_01", family: "notes_structured_money_person_amount_extraction", lane: "STRUCTURED_EXTRACTION", blocking: true, input: "Komu jsem dal zálohy?", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /frant|pep|petr/i, expectNotRx: /umyvadlo|tv\s+zaruk/i },
  { id: "SS_STRUCT_02", family: "notes_structured_money_person_amount_extraction", lane: "STRUCTURED_EXTRACTION", blocking: true, input: "Vypiš mi jména lidí a u nich částky kolik dostali zálohu.", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /frant|pep|petr/i, expectNamesAndAmounts: true },
  { id: "SS_CROSS_01", family: "note_query_wrong_module_contamination", lane: "CROSS_MODULE", blocking: true, input: "Dokdy má TV záruku?", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectNotRx: /najem|ukol/i },
  { id: "SS_CROSS_02", family: "direct_fact_question_unnecessary_storage_disambiguation", lane: "CROSS_MODULE", blocking: true, input: "Jakou má šířku stůl?", expectModule: "notes", expectBehavior: "read", forbidWrite: true, expectRx: /stul|2\s*m/i, expectNotRx: /upresni/i }
];

const METAMORPHIC_FAMILIES = {
  TOMORROW_AGENDA: {
    expectModule: "calendar",
    expectBehavior: "read",
    forbidWrite: true,
    expectRx: /kluk|noe|petr/i,
    variants: [
      "Co mám zítra v kalendáři?",
      "Co mám na zítra v kalendáři?",
      "Mám něco zítra v kalendáři?",
      "Mám něco na zítra v kalendáři?",
      "Jaké mám zítra události?",
      "Ukaž zítřejší kalendář.",
      "Co je zítra v kalendáři?",
      "Mám zítra nějakou schůzku?",
      "Zobraz zítra v kalendáři."
    ]
  },
  WARRANTY_NOTE: {
    expectModule: "notes",
    expectBehavior: "read",
    forbidWrite: true,
    expectRx: /zaruk|tv/i,
    expectNotRx: /spz|najem/i,
    variants: [
      "Kdy mi končí záruka na televizi?",
      "Kdy končí záruka na TV?",
      "Dokdy má TV záruku?",
      "Do kdy mám záruku na televizi?",
      "Najdi záruku na TV.",
      "Mám někde poznámku o záruce televize?",
      "Kdy končí záruka na telku?"
    ]
  },
  TASK_DUE_READ: {
    expectModule: "tasks",
    expectBehavior: "read",
    forbidWrite: true,
    variants: [
      "Kdy mám zavolat dědovi?",
      "Kdy mám koupit mámě kytku?",
      "Do kdy mám zaplatit nájem?",
      "Kdy mám zaplatit nájem?",
      "Kdy mám volat dědovi?",
      "Do kdy je nájem?",
      "Kdy mám splnit úkol s nájmem?"
    ]
  }
};

const TEMPLATE_DNA = {
  NOTES_SEARCH_READ: {
    templates: [
      "Jakou barvu má {object}?",
      "Kolik váží {object}?",
      "Jakou má šířku {object}?",
      "Kdy má {person} narozeniny?",
      "Mám v poznámkách něco o {object}?",
      "Najdi {topic} v poznámkách.",
      "Jaká je adresa {place}?",
      "Kde je {place}?",
      "Kdy končí záruka na {object}?",
      "Co mám poznamenané o {object}?"
    ],
    expectModule: "notes",
    expectBehavior: "read",
    forbidWrite: true
  },
  TASKS_SEARCH_READ: {
    templates: [
      "Kdy mám {action} {person}?",
      "Do kdy mám {action}?",
      "Mám v úkolech něco o {topic}?",
      "Najdi úkol s {topic}.",
      "Co mám v úkolech k {person}?",
      "Kdy mám splnit {topic}?"
    ],
    expectModule: "tasks",
    expectBehavior: "read",
    forbidWrite: true
  },
  CALENDAR_METAMORPHIC: { fromMetamorphic: true, metamorphicKeys: ["TOMORROW_AGENDA"] },
  CROSS_MODULE: {
    templates: [
      "Dokdy má TV záruku?",
      "Jaká je adresa {place}?",
      "Jakou má šířku {object}?",
      "Kdy má {person} narozeniny?",
      "Jaké je heslo na wifi?",
      "Kolik váží {object}?"
    ],
    expectModule: "notes",
    expectBehavior: "read",
    forbidWrite: true
  },
  STRUCTURED_EXTRACTION: {
    templates: [
      "Komu jsem dal zálohy?",
      "Kolik jsem komu dal zálohu?",
      "Kdo dostal zálohu a kolik?",
      "Najdi všechny zálohy.",
      "Kolik je celkem na zálohách?",
      "Vypiš zálohy podle osob."
    ],
    expectModule: "notes",
    expectBehavior: "read",
    forbidWrite: true,
    expectRx: /frant|pep|petr|zaloh/i
  },
  NEGATIVE_NO_RESULT: {
    templates: [
      "Jaké je heslo na wifi?",
      "Kde mám heslo k wifi?",
      "Najdi heslo na wifi.",
      "Mám poznámku o hesle wifi?",
      "Co mám o wifi hesle?"
    ],
    expectModule: "notes",
    expectBehavior: "read",
    forbidWrite: true,
    expectEmptyOrMiss: true
  },
  MOBILE_VOICE_VARIANT: {
    templates: [
      "kdy ma {person} narozeniny",
      "dokdy ma tv zaruku",
      "mam neco na zitra v kalendari",
      "kdy mam zavolat dedovi",
      "komu jsem dal zalohy",
      "jaka je adresa botanicke zahrady",
      "jakou barvu ma taska",
      "mam v ukolech neco o kytce"
    ],
    expectModule: "read",
    expectBehavior: "read",
    forbidWrite: true,
    mixed: true
  }
};

const FILL = {
  person: ["Nicolas", "Tomáš", "táta", "Franta", "Pepa", "Petr", "děda", "máma"],
  object: ["taška", "auto", "stůl", "chleba", "umyvadlo", "TV", "televize"],
  topic: ["kytku", "nájem", "zálohy", "záruku", "dědu"],
  place: ["Botanické zahrady", "Botanická zahrada"],
  action: ["zavolat", "koupit", "zaplatit", "splnit"]
};

function foldCs(s) {
  return aliasData.foldCs(s);
}

function notesRuntime(subset) {
  const src = Array.isArray(subset) && subset.length ? subset : SCREENSHOT_NOTES;
  const t0 = FIXED_NOW.getTime();
  return src.map(function (content, i) {
    return {
      id: "ssn_" + i,
      title: content.slice(0, 48),
      content: content,
      createdAt: t0 - (i + 1) * 3600000,
      updatedAt: t0 - (i + 1) * 3600000,
      pinned: false,
      tags: [],
      deleted: false
    };
  });
}

function tasksRuntime() {
  return [
    { id: "sst1", title: "Koupit mámě kytku", done: false, dueDate: null, note: "" },
    { id: "sst2", title: "Zavolat v neděli dědovi", done: false, dueDate: "2026-05-31", note: "" },
    { id: "sst3", title: "V neděli zaplatit nájem", done: false, dueDate: "2026-05-31", note: "" }
  ];
}

function eventsRuntime() {
  const raw = [
    { id: "sse1", title: "Kluk", startAt: "2026-05-30T10:00:00", endAt: "2026-05-30T11:00:00" },
    { id: "sse2", title: "Noe", startAt: "2026-05-30T13:00:00", endAt: "2026-05-30T14:00:00" },
    { id: "sse3", title: "Petr", startAt: "2026-05-30T18:00:00", endAt: "2026-05-30T19:00:00" }
  ];
  return raw.map(function (ev) {
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
}

function seedCtx(c) {
  const notes = notesRuntime(c && c.notesSubset);
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return eventsRuntime();
    },
    getTasksSnapshot: function () {
      return tasksRuntime();
    },
    getNotesSnapshot: function () {
      return notes;
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
  return "other";
}

function fillTemplate(tpl, n) {
  let out = tpl;
  for (const key of Object.keys(FILL)) {
    const vals = FILL[key];
    out = out.replace(new RegExp("\\{" + key + "\\}", "g"), vals[n % vals.length]);
  }
  return out;
}

function evaluateCase(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const msgFold = foldCs(msg);
  const mod = moduleFromIntent(intent);

  if (c.forbidWrite || c.expectBehavior === "read") {
    if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
    if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
    if (turn.draft && turn.draft.targetContainer && turn.draft.targetContainer !== "none") issues.push("draft_leak");
  }

  if (c.expectBehavior === "create") {
    if (!WRITE_INTENTS.has(intent)) issues.push("create_miss:" + intent);
    else if (c.expectModule === "notes" && intent !== "notes.create") issues.push("create_miss:" + intent);
    else if (c.expectModule === "calendar" && intent !== "calendar.create") issues.push("create_miss:" + intent);
    else if (c.expectModule === "tasks" && intent !== "tasks.create") issues.push("create_miss:" + intent);
    if (c.forbidRead && (NOTE_READ.has(intent) || intent.indexOf("read") >= 0)) issues.push("read_instead_of_create");
  }

  if (c.expectModule && c.expectModule !== "read" && mod !== c.expectModule && mod !== "clarification") {
    issues.push("module_leak:" + mod);
  }

  if (intent === "clarification" && c.expectBehavior === "read" && !c.allowClarification) {
    issues.push("clarification_instead_of_read");
  }

  if (c.expectRx && !c.expectRx.test(msg) && !c.expectRx.test(msgFold)) {
    const createDraftOk = c.expectBehavior === "create" && turn.processingState === "READY_TO_SAVE";
    if (!createDraftOk && (!c.expectEmptyOrMiss || !/nena[sš]el/i.test(msg))) issues.push("content_miss");
  }
  if (c.expectNotRx && (c.expectNotRx.test(msg) || c.expectNotRx.test(msgFold))) issues.push("overbroad:" + msg.slice(0, 80));
  if (c.expectEmptyOrMiss && !/nena[sš]el|nenašel|nenašla|žádný relevantní/i.test(msg) && !c.expectRx) {
    if (!/nena[sš]el/i.test(msg)) issues.push("should_be_empty");
  }
  if (c.expectNamesAndAmounts) {
    const hasName = /frant|pep|petr/i.test(msg);
    const hasAmt = /500|1000|2000|kč/i.test(msg);
    if (!hasName || !hasAmt) issues.push("structured_extraction_fail");
  }

  return issues;
}

function classifyFamily(c, turn, issues) {
  if (!issues.length) return "PASS";
  const intent = String(turn.normalizedIntent || "");
  if (issues.some(function (x) {
    return String(x).indexOf("write_leak") >= 0 || String(x).indexOf("ready_to_save") >= 0;
  })) {
    return "SAFETY_RISK";
  }
  if (c.family) return c.family;
  if (c.expectModule === "tasks" && WRITE_INTENTS.has(intent)) return "task_search_question_to_create_leak";
  if (c.expectModule === "notes" && intent.indexOf("task") >= 0) return "wrong_dataset_task_result_for_note_query";
  if (issues.some(function (x) {
    return String(x).indexOf("clarification") >= 0;
  })) {
    return "direct_fact_question_unnecessary_storage_disambiguation";
  }
  if (issues.some(function (x) {
    return String(x).indexOf("overbroad") >= 0;
  })) {
    return "notes_relevance_overbroad_fallback";
  }
  if (issues.some(function (x) {
    return String(x).indexOf("structured") >= 0;
  })) {
    return "notes_structured_money_person_amount_extraction";
  }
  return "TRUE_ENGINE_FAIL";
}

function runTurn(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const ctx = seedCtx(c);
  return eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
}

function buildLaneCases(lane, count, seqStart) {
  const out = [];
  let seq = seqStart;
  const spec = TEMPLATE_DNA[lane];
  if (!spec) return out;
  if (spec.fromMetamorphic) {
    const keys = spec.metamorphicKeys || Object.keys(METAMORPHIC_FAMILIES);
    while (out.length < count) {
      const key = keys[seq % keys.length];
      const fam = METAMORPHIC_FAMILIES[key];
      const v = fam.variants[seq % fam.variants.length];
      out.push({
        id: "SRU_M_" + String(seq).padStart(5, "0"),
        lane: lane,
        family: key === "TOMORROW_AGENDA" ? "calendar_tomorrow_query_metamorphic_inconsistency" : key,
        metamorphicGroup: key,
        input: v,
        expectModule: fam.expectModule,
        expectBehavior: fam.expectBehavior,
        forbidWrite: fam.forbidWrite,
        expectRx: fam.expectRx,
        expectNotRx: fam.expectNotRx,
        tier: "A"
      });
      seq++;
    }
    return out;
  }
  const templates = spec.templates || [];
  while (out.length < count) {
    const tpl = templates[seq % templates.length];
    const input = fillTemplate(tpl, seq);
    let expectModule = spec.expectModule;
    let expectBehavior = spec.expectBehavior;
    let forbidWrite = spec.forbidWrite;
    if (spec.mixed) {
      if (/\b(kalend|zitra|schuz)\b/i.test(input)) expectModule = "calendar";
      else if (/\b(ukol|kyt|ded|najem)\b/i.test(input)) expectModule = "tasks";
      else expectModule = "notes";
      expectBehavior = "read";
      forbidWrite = true;
    }
    out.push({
      id: "SRU_G_" + lane + "_" + String(seq).padStart(5, "0"),
      lane: lane,
      family: lane,
      input: input,
      expectModule: expectModule,
      expectBehavior: expectBehavior,
      forbidWrite: forbidWrite,
      expectRx: spec.expectRx,
      expectEmptyOrMiss: spec.expectEmptyOrMiss,
      tier: "B"
    });
    seq++;
  }
  return out;
}

function buildScreenshotCorpus(totalOpt) {
  const target =
    totalOpt ||
    Object.values(LANE_DISTRIBUTION).reduce(function (a, b) {
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

function bumpCounter(counters, family, issues, intent, c) {
  if (!issues.length) return;
  if (issues.some(function (x) {
    return String(x).indexOf("write_leak") >= 0 || String(x).indexOf("ready_to_save") >= 0;
  })) {
    counters.safety_risk_count++;
  }
  if (family === "task_search_question_to_create_leak" || (c.expectModule === "tasks" && WRITE_INTENTS.has(intent))) {
    counters.task_search_to_create_leak_count++;
  }
  if (family.indexOf("wrong_dataset") >= 0 || family === "note_query_wrong_module_contamination") {
    counters.note_query_wrong_module_count++;
  }
  if (family === "calendar_tomorrow_query_metamorphic_inconsistency") {
    counters.calendar_metamorphic_fail_count++;
  }
  if (family === "direct_fact_question_unnecessary_storage_disambiguation") {
    counters.direct_fact_disambiguation_count++;
  }
  if (family === "notes_relevance_overbroad_fallback" || issues.some(function (x) {
    return String(x).indexOf("overbroad") >= 0;
  })) {
    counters.notes_overbroad_fallback_count++;
  }
  if (family === "task_topic_filtering_returns_all_tasks") {
    counters.tasks_overbroad_fallback_count++;
  }
  if (family === "notes_structured_money_person_amount_extraction") {
    counters.structured_extraction_fail_count++;
  }
  if (family.indexOf("person") >= 0 || family.indexOf("entity_filter") >= 0) {
    counters.person_entity_filter_fail_count++;
  }
  if (family.indexOf("object_property") >= 0) {
    counters.object_property_filter_fail_count++;
  }
  if (issues.some(function (x) {
    return String(x).indexOf("content_miss") >= 0;
  }) && c.blocking) {
    counters.retrieval_miss_count++;
  }
}

function runScreenshotAudit(cases, reportPath) {
  const eng = loadEngine();
  let pass = 0;
  let fail = 0;
  const counters = {
    task_search_to_create_leak_count: 0,
    note_query_wrong_module_count: 0,
    calendar_metamorphic_fail_count: 0,
    direct_fact_disambiguation_count: 0,
    retrieval_miss_count: 0,
    notes_overbroad_fallback_count: 0,
    tasks_overbroad_fallback_count: 0,
    structured_extraction_fail_count: 0,
    person_entity_filter_fail_count: 0,
    object_property_filter_fail_count: 0,
    ranking_order_fail_count: 0,
    notes_read_pass: 0,
    notes_read_fail: 0,
    tasks_read_pass: 0,
    tasks_read_fail: 0,
    calendar_read_pass: 0,
    calendar_read_fail: 0,
    true_engine_fail_count: 0,
    harness_or_gold_count: 0,
    safe_clarification_ok_count: 0,
    template_dna_problem_count: 0,
    safety_risk_count: 0
  };
  const familyFails = {};
  const metamorphicGroups = {};
  let screenshotPass = 0;
  let screenshotTotal = 0;
  const firstFails = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const turn = runTurn(eng, c);
    const issues = evaluateCase(c, turn);
    const family = classifyFamily(c, turn, issues);
    const intent = String(turn.normalizedIntent || "");
    const ok = issues.length === 0;

    if (ok) pass++;
    else {
      fail++;
      bumpCounter(counters, family, issues, intent, c);
      familyFails[family] = (familyFails[family] || 0) + 1;
      if (family === "TRUE_ENGINE_FAIL") counters.true_engine_fail_count++;
      if (c.tier === "B") counters.template_dna_problem_count++;
      if (firstFails.length < 12) {
        firstFails.push({ id: c.id, family: family, input: c.input, intent: intent, issues: issues, msg: turnMsg(turn).slice(0, 160) });
      }
    }

    if (c.blocking) {
      screenshotTotal++;
      if (ok) screenshotPass++;
    }

    if (c.metamorphicGroup) {
      if (!metamorphicGroups[c.metamorphicGroup]) metamorphicGroups[c.metamorphicGroup] = { pass: 0, total: 0 };
      metamorphicGroups[c.metamorphicGroup].total++;
      if (ok) metamorphicGroups[c.metamorphicGroup].pass++;
    }

    if (c.expectModule === "notes" && c.expectBehavior === "read") {
      if (ok) counters.notes_read_pass++;
      else counters.notes_read_fail++;
    }
    if (c.expectModule === "tasks" && c.expectBehavior === "read") {
      if (ok) counters.tasks_read_pass++;
      else counters.tasks_read_fail++;
    }
    if (c.expectModule === "calendar" && c.expectBehavior === "read") {
      if (ok) counters.calendar_read_pass++;
      else counters.calendar_read_fail++;
    }
  }

  const total = cases.length;
  const accuracy = total ? ((pass / total) * 100).toFixed(2) : "100.00";
  const screenshotPct = screenshotTotal ? ((screenshotPass / screenshotTotal) * 100).toFixed(2) : "100.00";
  const topFamilies = Object.keys(familyFails)
    .sort(function (a, b) {
      return familyFails[b] - familyFails[a];
    })
    .slice(0, 5);

  const metamorphicFails = Object.keys(metamorphicGroups).filter(function (k) {
    const g = metamorphicGroups[k];
    return g.pass < g.total;
  });

  const report = {
    total_cases: total,
    pass: pass,
    fail: fail,
    overall_accuracy: accuracy,
    screenshot_seeds_total: screenshotTotal,
    screenshot_seeds_pass: screenshotPass,
    screenshot_seed_family_pass: screenshotPct,
    counters: counters,
    top_fail_families: topFamilies.map(function (k) {
      return k + "=" + familyFails[k];
    }),
    metamorphic_families_fail: metamorphicFails,
    first_fails: firstFails,
    recommended_fix_order: topFamilies,
    safe_to_fix: counters.safety_risk_count === 0 ? "YES" : "NO",
    stop_reason: counters.safety_risk_count > 0 ? "safety_risk" : ""
  };

  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}

module.exports = {
  REPO: REPO,
  FIXED_NOW: FIXED_NOW,
  LANE_DISTRIBUTION: LANE_DISTRIBUTION,
  SCREENSHOT_SEEDS: SCREENSHOT_SEEDS,
  METAMORPHIC_FAMILIES: METAMORPHIC_FAMILIES,
  buildScreenshotCorpus: buildScreenshotCorpus,
  runScreenshotAudit: runScreenshotAudit,
  seedCtx: seedCtx,
  foldCs: foldCs,
  evaluateCase: evaluateCase
};
