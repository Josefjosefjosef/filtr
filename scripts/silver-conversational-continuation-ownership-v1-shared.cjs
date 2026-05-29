#!/usr/bin/env node
"use strict";

const fs = require("fs");
const lsf = require("./silver-long-session-firewall-v1-shared.cjs");
const own = require("./silver-conversational-ownership-v1-shared.cjs");

const WRITE_INTENTS = own.WRITE_INTENTS;

const STATIC_FAMILIES = [
  {
    id: "CCO_COV_CAP_0019",
    family: "query_to_save",
    chain: ["Co mám zítra?", "A ulož si ještě že servis je v úterý"],
    input: "A ulož si ještě že servis je v úterý",
    expectModule: "notes",
    allowWriteLast: true
  },
  {
    id: "CCO_A_001",
    family: "note_continuation",
    chain: ["Ulož poznámku že auto jde do servisu.", "A ulož si ještě že servis je v úterý."],
    input: "A ulož si ještě že servis je v úterý.",
    expectModule: "notes",
    allowWriteLast: true
  },
  {
    id: "CCO_B_001",
    family: "calendar_continuation",
    chain: ["Zapiš do kalendáře servis auta.", "A ulož si ještě že servis je v úterý."],
    input: "A ulož si ještě že servis je v úterý.",
    expectModule: "notes",
    allowWriteLast: true
  },
  {
    id: "CCO_C_001",
    family: "query_to_save",
    chain: ["Co mám v kalendáři?", "A ulož si ještě že servis je v úterý."],
    input: "A ulož si ještě že servis je v úterý.",
    expectModule: "notes",
    allowWriteLast: true
  },
  {
    id: "CCO_D_001",
    family: "task_true_positive",
    chain: ["Co mám za úkoly?", "A přidej ještě zavolat servis."],
    input: "A přidej ještě zavolat servis.",
    expectModule: "tasks",
    allowWriteLast: true
  },
  {
    id: "CCO_E_001",
    family: "appointment_continuation",
    chain: ["Zapiš do kalendáře servis auta.", "A ještě v úterý v 15."],
    input: "A ještě v úterý v 15.",
    expectModule: "calendar",
    allowWriteLast: true
  },
  {
    id: "CCO_F_001",
    family: "note_memory_continuation",
    chain: ["Ulož poznámku že smlouva je u účetní.", "A ještě že servis je v úterý."],
    input: "A ještě že servis je v úterý.",
    expectModule: "notes",
    allowWriteLast: true
  }
];

const TEMPLATE_BANK = {
  note_continuation: {
    turn1: ["Ulož poznámku že {topic} jde do servisu.", "Zapiš poznámku o {topic}.", "Ulož si informaci o {topic}."],
    turn2: [
      "A ulož si ještě že servis je v {day}.",
      "A ulož si že {topic} je v {day}.",
      "A ještě že servis je v {day}."
    ],
    expectModule: "notes"
  },
  calendar_continuation: {
    turn1: ["Zapiš do kalendáře servis {topic}.", "Dej do kalendáře {topic} {day}.", "Ulož schůzku {topic} {day}."],
    turn2: [
      "A ulož si ještě že servis je v {day2}.",
      "A ulož si že {topic} je v {day2}.",
      "A ještě v {day2} v {time}."
    ],
    expectModule: "notes"
  },
  query_to_save: {
    turn1: ["Co mám {day}?", "Co mám v kalendáři?", "Co mám v poznámkách o {topic}?"],
    turn2: [
      "A ulož si ještě že servis je v {day2}.",
      "A ulož si že {topic} je v {day2}.",
      "Ulož si že Pepa dluží {amount}."
    ],
    expectModule: "notes"
  },
  task_true_positive: {
    turn1: ["Co mám za úkoly?", "Co mám v úkolech?", "Najdi úkol {w}."],
    turn2: [
      "A přidej ještě zavolat {entity}.",
      "A přidej úkol {w}.",
      "Přidej ještě {w}."
    ],
    expectModule: "tasks"
  },
  appointment_continuation: {
    turn1: ["Zapiš do kalendáře servis {topic}.", "Ulož schůzku {topic} {day}."],
    turn2: ["A ještě v {day2} v {time}.", "A v {day2} v {time}.", "A ještě {day2} v {time}."],
    expectModule: "calendar"
  },
  note_memory_continuation: {
    turn1: [
      "Ulož poznámku že smlouva je u {entity}.",
      "Zapamatuj si že {topic} je u {entity}.",
      "Poznamenej si že {topic} je hotové."
    ],
    turn2: [
      "A ještě že servis je v {day}.",
      "A ulož si ještě že servis je v {day}.",
      "A ulož si že {topic} je v {day}."
    ],
    expectModule: "notes"
  },
  cross_module: {
    turn1: ["Ulož poznámku o {topic}.", "Zapiš do kalendáře {topic} {day}.", "Ulož úkol {w}."],
    turn2: [
      "A ulož si ještě že servis je v {day2}.",
      "A přidej ještě zavolat {entity}.",
      "Co mám {day2}?"
    ],
    expectModule: "notes"
  }
};

const FILLERS = ["", "Hele ", "Prosím ", "No ", "Vlastně "];
const PREFIXES = ["", "A ", "Tak ", "Dobře "];
const TOPICS = ["auto", "smlouva", "pojištění", "servis", "záloha"];
const DAYS = ["úterý", "pondělí", "středu", "pátek", "zítra"];
const TIMES = ["10:00", "15:00", "9:00", "14:30"];
const ENTITIES = ["servis", "účetní", "právník", "Pepa"];
const WORK = ["zavolat servis", "koupit mléko", "poslat fakturu", "zkontrolovat smlouvu"];
const AMOUNTS = ["500", "1200", "3000"];

function fillTpl(s, n) {
  return String(s || "")
    .replace(/\{topic\}/g, TOPICS[n % TOPICS.length])
    .replace(/\{day\}/g, DAYS[n % DAYS.length])
    .replace(/\{day2\}/g, DAYS[(n + 1) % DAYS.length])
    .replace(/\{time\}/g, TIMES[n % TIMES.length])
    .replace(/\{entity\}/g, ENTITIES[n % ENTITIES.length])
    .replace(/\{w\}/g, WORK[n % WORK.length])
    .replace(/\{amount\}/g, AMOUNTS[n % AMOUNTS.length]);
}

function foldInput(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function expectModuleForCase(family, input) {
  const inf = foldInput(input);
  if (family === "task_true_positive") return "tasks";
  if (/\b(pridej\s+jeste|pridej\s+ukol|uloz\s+ukol|dej\s+do\s+ukol)\b/.test(inf)) return "tasks";
  if (/\buloz\s+si\b/.test(inf) || /\ba\s+jeste\s+ze\b/.test(inf)) return "notes";
  if (/^\s*a\s+jeste\s+v\s+/.test(input) || /^\s*a\s+v\s+/.test(input)) return "calendar";
  if (/\b(v|ve)\s+\d{1,2}/.test(inf) && /\b(utery|pondeli|zitra|stredu|ctvrtek|patek)\b/.test(inf)) return "calendar";
  if (/\bco\s+mam\b/.test(inf)) return "calendar";
  if (/\bpoznam/.test(inf)) return "notes";
  if (/\b(kalend|schuz)\b/.test(inf)) return "calendar";
  if (/\bukol/.test(inf)) return "tasks";
  if (family === "appointment_continuation") return "calendar";
  return "notes";
}

function metamorphicVariants(input) {
  const base = String(input || "").trim();
  const out = [base];
  const noDiac = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (noDiac !== base) out.push(noDiac);
  if (!/^a\s/i.test(base)) out.push("A " + base.charAt(0).toLowerCase() + base.slice(1));
  if (!/jeste/i.test(base) && /uloz\s+si/i.test(base)) {
    out.push(base.replace(/uloz\s+si/i, "uloz si jeste"));
  }
  return out.filter(function (v, i, arr) {
    return v && arr.indexOf(v) === i;
  });
}

function buildCorpusV1(targetCount) {
  const out = STATIC_FAMILIES.slice();
  const families = Object.keys(TEMPLATE_BANK);
  let n = out.length;
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpl = TEMPLATE_BANK[family];
    const t1 = fillTpl(tpl.turn1[n % tpl.turn1.length], n);
    const t2raw = fillTpl(tpl.turn2[n % tpl.turn2.length], n);
    const filler = FILLERS[n % FILLERS.length];
    const prefix = PREFIXES[(n >> 2) % PREFIXES.length];
    const chain = [filler + t1, filler + prefix + t2raw];
    const input = chain[chain.length - 1];
    let expectModule = expectModuleForCase(family, input);
    if (family === "cross_module") {
      if (/\bpridej\b/.test(input) && /\b(zavolat|koupit|poslat)\b/.test(input)) expectModule = "tasks";
      else if (/\bco\s+mam\b/i.test(input)) expectModule = "calendar";
      else expectModule = expectModuleForCase("cross_module", input);
    }
    out.push({
      id: "CCO_GEN_" + String(n).padStart(5, "0"),
      family: family,
      chain: chain,
      input: input,
      expectModule: expectModule,
      allowWriteLast: true,
      tier: "B"
    });
    if (n % 7 === 0 && family !== "task_true_positive") {
      const variants = metamorphicVariants(input);
      for (let vi = 1; vi < variants.length && out.length < targetCount; vi++) {
        const vInput = filler + prefix + variants[vi];
        out.push({
          id: "CCO_META_" + String(n).padStart(5, "0") + "_" + vi,
          family: family + "_meta",
          chain: [chain[0], vInput],
          input: vInput,
          expectModule: expectModule,
          allowWriteLast: true,
          tier: "C"
        });
      }
    }
    n++;
  }
  return out.slice(0, targetCount);
}

function moduleOfIntent(intent) {
  const i = String(intent || "");
  if (i.indexOf("calendar") === 0) return "calendar";
  if (i.indexOf("tasks") === 0) return "tasks";
  if (i.indexOf("notes") === 0) return "notes";
  return "other";
}

function evaluateCase(eng, c, ctx) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const steps = Array.isArray(c.chain) && c.chain.length ? c.chain : [c.input];
  let prev = eng.createEmptyDraft();
  let last = null;
  const trace = [];
  for (let i = 0; i < steps.length; i++) {
    last = eng.processUserTurn(steps[i], prev, ctx);
    trace.push({
      step: i + 1,
      input: steps[i],
      intent: last && last.normalizedIntent,
      module: moduleOfIntent(last && last.normalizedIntent),
      processingState: last && last.processingState,
      governor: !!(last && last.silverContinuationOwnershipGovernorV1),
      mobileVoice: !!(last && last.silverMobileVoiceFragmentTaskCreateV1)
    });
    const isLast = i === steps.length - 1;
    if (!isLast) {
      const midIntent = String(last.normalizedIntent || "");
      if (WRITE_INTENTS.has(midIntent)) prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : prev;
      else prev = eng.createEmptyDraft();
    } else {
      prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : eng.createEmptyDraft();
    }
  }
  const issues = [];
  const intent = String(last.normalizedIntent || "");
  const mod = moduleOfIntent(intent);
  if (c.expectModule && mod !== c.expectModule && WRITE_INTENTS.has(intent)) {
    issues.push("module_leak:" + intent + ":expected=" + c.expectModule);
  }
  if (c.expectModule === "notes" && intent === "tasks.create") {
    issues.push("ownership_drift:tasks.create");
  }
  if (c.expectModule === "tasks" && intent === "notes.create" && c.family.indexOf("task") >= 0) {
    issues.push("ownership_steal:notes.create");
  }
  return {
    id: c.id,
    family: c.family,
    input: c.input,
    chain: c.chain,
    issues: issues,
    pass: issues.length === 0,
    intent: intent,
    expectModule: c.expectModule,
    trace: trace
  };
}

function runAudit(guardId, cases, reportPath, extraMeta) {
  const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
  const eng = loadEngine();
  const ctx = lsf.seedCtx();
  let pass = 0;
  const fails = [];
  for (let i = 0; i < cases.length; i++) {
    const r = evaluateCase(eng, cases[i], ctx);
    if (r.pass) pass++;
    else fails.push(r);
  }
  const report = Object.assign(
    {
      guard_id: guardId,
      total: cases.length,
      pass: pass,
      fail: fails.length,
      accuracy_pct: cases.length ? (pass / cases.length) * 100 : 100,
      PASS_FAIL: fails.length === 0 ? "PASS" : "FAIL",
      first_fail: fails[0] || null,
      generator_based: true,
      replay_governed: true,
      property_based: true,
      metamorphic: true
    },
    extraMeta || {}
  );
  if (reportPath) {
    try {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    } catch (eW) {
      void eW;
    }
  }
  return { report: report, fails: fails };
}

function printHeader(name, report) {
  const ok = report.fail === 0;
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("pass=" + report.pass + "/" + report.total);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_family=" + report.first_fail.family);
    console.log("first_fail_input=" + report.first_fail.input);
    console.log("first_fail_issues=" + (report.first_fail.issues || []).join(","));
  }
  console.log("=== END_" + name.toUpperCase() + " ===");
  return ok;
}

function diagnoseCovCap0019() {
  const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
  const eng = loadEngine();
  const ctx = lsf.seedCtx();
  const chain = ["Co mám zítra?", "A ulož si ještě že servis je v úterý"];
  let prev = eng.createEmptyDraft();
  const steps = [];
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  for (let i = 0; i < chain.length; i++) {
    const turn = eng.processUserTurn(chain[i], prev, ctx);
    steps.push({
      turn: i + 1,
      rawInput: chain[i],
      normalizedQuery: chain[i],
      intent: turn.normalizedIntent,
      module: moduleOfIntent(turn.normalizedIntent),
      processingState: turn.processingState,
      continuationGovernor: !!turn.silverContinuationOwnershipGovernorV1,
      mobileVoiceFragment: !!turn.silverMobileVoiceFragmentTaskCreateV1,
      draftTarget: turn.draft && turn.draft.targetContainer
    });
    const midIntent = String(turn.normalizedIntent || "");
    if (WRITE_INTENTS.has(midIntent)) prev = turn.draft && turn.draft.targetContainer !== "none" ? turn.draft : prev;
    else prev = eng.createEmptyDraft();
  }
  const last = steps[steps.length - 1];
  return {
    case_id: "COV_CAP_0019",
    input: chain[1],
    chain: chain,
    expected_module: "notes",
    actual_module: last.module,
    actual_intent: last.intent,
    pass: last.module === "notes",
    root_cause_hypothesis:
      last.intent === "tasks.create"
        ? "mobile_voice_fragment_or_missing_uloz_si_memory_cue_before_governor"
        : null,
    classification: last.module === "notes" ? "FIXED" : "TRUE_ENGINE_FAIL",
    turn_by_turn: steps,
    analysis: {
      normalizedQuery: chain[1],
      previousTurnOwnership: steps[0] && steps[0].module,
      continuationMemory: "save_after_search",
      moduleCarryOver: steps[0] && steps[0].module,
      actionCarryOver: "query_to_save",
      saveQueryCarryOver: true,
      implicitNoteCue: /\buloz\s+si\b/i.test(chain[1]),
      appointmentEntity: /\bservis\b/i.test(chain[1]),
      temporalSlot: /\b[uú]ter[yý]\b/i.test(chain[1]),
      noteStyleSentence: /\buloz\s+si\s+jeste\s+ze\b/i.test(chain[1]),
      taskStyleImperative: false,
      mobileVoiceFragmentFired: !!last.mobileVoiceFragment,
      continuationGovernorFired: !!last.continuationGovernor
    }
  };
}

module.exports = {
  buildCorpusV1,
  runAudit,
  printHeader,
  diagnoseCovCap0019,
  STATIC_FAMILIES
};
