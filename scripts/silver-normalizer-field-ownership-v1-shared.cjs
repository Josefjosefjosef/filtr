/**
 * SILVER_NORMALIZER_FIELD_OWNERSHIP_V1 — shared probes, metrics, contamination taxonomy.
 */
"use strict";

const validator = require("./silver-clean-payload-validator-v1.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { foldCs } = harness;

const TITLE_REAL_UX_PACK = [
  { id: "T01", input: "Ulož mi na dnešek schůzku s Pavlem", group: "calendar_write", titleNeed: ["pavel", "schůz"], titleLacks: ["ulož", "dnesek"] },
  { id: "T02", input: "Připomeň mi dnes koupit mléko", group: "task_write", intent: "tasks.create", titleNeed: ["mlék", "koupit"], titleLacks: ["připomeň", "dnes"] },
  { id: "T03", input: "Na zítřek mi přidej poradu", group: "calendar_write", titleNeed: ["porad"], titleLacks: ["zítřek", "přidej"] },
  { id: "T04", input: "Do poznámky napiš PIN ke kartě", group: "note_write", intent: "notes.create", bodyNeed: ["pin"], bodyLacks: ["do poznámky"] },
  { id: "T05", input: "Ať nezapomenu vytisknout smlouvu", group: "task_write", intent: "tasks.create", titleNeed: ["smlouv", "vytisk"], titleLacks: ["nezapomenu"] },
  { id: "T06", input: "Jen mi připomeň servis auta", group: "task_write", intent: "tasks.create", titleNeed: ["servis"], titleLacks: ["připomeň", "jen"] },
  { id: "T07", input: "Chci si uložit schůzku s klientem", group: "calendar_write", titleNeed: ["klient", "schůz"], titleLacks: ["chci", "uložit"] },
  { id: "T08", input: "Potřebuji si zapsat poradu", group: "calendar_write", titleNeed: ["porad"], titleLacks: ["potřebuji", "zapsat"] },
  { id: "T09", input: "Zapiš mi meeting s týmem", group: "note_write", intent: "notes.create", bodyNeed: ["meeting", "tým"], bodyLacks: ["zapiš"] },
  { id: "T10", input: "Prosím ulož schůzku s doktorem", group: "calendar_write", titleNeed: ["doktor"], titleLacks: ["prosím", "ulož"] },
  { id: "T11", input: "Hele přidej mi poradu", group: "calendar_write", titleNeed: ["porad"], titleLacks: ["hele", "přidej"] },
  { id: "T12", input: "Jo a připomeň mi zavolat Petrovi", group: "task_write", intent: "tasks.create", titleNeed: ["petr", "zavol"], titleLacks: ["připomeň", "jo"] },
  { id: "T13", input: "Ještě přidej schůzku s Martinem", group: "calendar_write", titleNeed: ["martin"], titleLacks: ["ještě", "přidej"] },
  { id: "T14", input: "Jenom mi vytvoř úkol koupit chleba", group: "task_write", intent: "tasks.create", titleNeed: ["chleb", "koupit"], titleLacks: ["jenom", "vytvoř mi"] },
  {
    id: "T15",
    input: "Hele prosím tě ulož mi poradu s klientem zítra",
    group: "calendar_write",
    titleNeed: ["porad", "klient"],
    titleLacks: ["hele", "prosím tě", "ulož mi"],
  },
];

const FIELD_ISOLATION_REAL_UX = [
  {
    id: "F01",
    input: "Přidej schůzku s klientem v Brně zítra v 15 a do poznámky napiš že chce novou nabídku",
    group: "calendar_write",
    titleNeed: ["klient", "schůz"],
    locNeed: ["brno"],
    noteNeed: ["nabídk"],
    titleLacks: ["brno", "zítra", "poznámky"],
    noteLacks: ["schůzku s klientem", "v brně"],
  },
  {
    id: "F02",
    input: "Ulož poradu v Praze a připomeň mi vzít notebook",
    group: "calendar_write",
    titleNeed: ["porad"],
    locNeed: ["praha"],
    noteNeed: ["notebook"],
    titleLacks: ["praha", "připomeň"],
  },
  {
    id: "F03",
    input: "Přidej meeting s týmem v kanceláři a napiš do poznámky že přijde pozdě",
    group: "calendar_write",
    titleNeed: ["meeting", "tým"],
    locNeed: ["kancel"],
    noteNeed: ["pozd"],
    titleLacks: ["kancelář", "poznámky"],
  },
  {
    id: "F04",
    input: "Zapiš návštěvu doktora v Motole a připomeň mi vzít výsledky",
    group: "calendar_write",
    titleNeed: ["doktor", "návštěv"],
    locNeed: ["motol"],
    noteNeed: ["výsled"],
    titleLacks: ["motol", "připomeň"],
  },
  {
    id: "F05",
    input: "Přidej schůzku s právníkem v Brně a ještě napiš do poznámky že mám vzít smlouvu",
    group: "calendar_write",
    titleNeed: ["právník", "schůz"],
    locNeed: ["brno"],
    noteNeed: ["smlouv"],
    titleLacks: ["brno", "poznámky"],
  },
];

const WRAPPER_FORBIDDEN_IN_TITLE = [
  "připomeň mi",
  "ulož mi",
  "přidej mi",
  "vytvoř mi",
  "na dnešek",
  "na zítřek",
  "ať nezapomenu",
  "do poznámky napiš",
  "jen mi připomeň",
  "chci si uložit",
  "potřebuji si zapsat",
  "napiš mi",
  "poznamenej mi",
  "zapiš mi",
  "prosím ulož",
  "jen si poznamenej",
  "hele",
  "prosím tě",
  "jenom",
  "jo a",
];

function draftField(turn, name) {
  return validator.draftField(turn, name);
}

function classifyContamination(turn, raw, phase) {
  const violations = validator.validateCleanPayload(turn, raw).violations || [];
  const title = foldCs(draftField(turn, "title"));
  const note = foldCs(draftField(turn, "note"));
  const loc = foldCs(draftField(turn, "location"));
  const out = [];
  for (let i = 0; i < violations.length; i++) {
    const v = violations[i];
    let source = "validator";
    let fieldOwner = "title";
    if (v.indexOf("note") >= 0) fieldOwner = "note";
    else if (v.indexOf("location") >= 0 || v.indexOf("address") >= 0) fieldOwner = "location";
    else if (v.indexOf("body") >= 0) fieldOwner = "body";
    out.push({
      contamination_type: v,
      contamination_source: source,
      contamination_phase: phase,
      field_owner: fieldOwner,
      overwrite_chain: phase,
      cleanup_collision: v.indexOf("collision") >= 0 ? 1 : 0,
      persistence_collision: 0,
    });
  }
  if (title && payloadCore.hasInstructionLeakage(draftField(turn, "title"))) {
    out.push({
      contamination_type: "wrapper_in_title",
      contamination_source: "instruction_leakage",
      contamination_phase: phase,
      field_owner: "title",
      overwrite_chain: phase,
      cleanup_collision: 0,
      persistence_collision: 0,
    });
  }
  if (note && /\bdo\s+pozn[aá]m/.test(note)) {
    out.push({
      contamination_type: "note_wrapper_bleed",
      contamination_source: "note_clause_capture",
      contamination_phase: phase,
      field_owner: "note",
      overwrite_chain: phase,
      cleanup_collision: 0,
      persistence_collision: 0,
    });
  }
  if (title && loc && /\bbrno\b/.test(title) && /\bbrno\b/.test(loc)) {
    out.push({
      contamination_type: "location_in_title",
      contamination_source: "field_bleed",
      contamination_phase: phase,
      field_owner: "title",
      overwrite_chain: phase,
      cleanup_collision: 0,
      persistence_collision: 0,
    });
  }
  return out;
}

function evalTitleProbe(turn, p) {
  const title = foldCs(draftField(turn, "title"));
  const body = foldCs(draftField(turn, "body"));
  const reasons = [];
  if (p.intent && turn.normalizedIntent !== p.intent) reasons.push("intent");
  const ch = p;
  if (ch.titleNeed) {
    for (let i = 0; i < ch.titleNeed.length; i++) {
      if (title.indexOf(foldCs(ch.titleNeed[i])) < 0) reasons.push("title_need:" + ch.titleNeed[i]);
    }
  }
  if (ch.titleLacks) {
    for (let i = 0; i < ch.titleLacks.length; i++) {
      if (title.indexOf(foldCs(ch.titleLacks[i])) >= 0) reasons.push("title_lacks:" + ch.titleLacks[i]);
    }
  }
  if (ch.bodyNeed) {
    for (let i = 0; i < ch.bodyNeed.length; i++) {
      if (body.indexOf(foldCs(ch.bodyNeed[i])) < 0) reasons.push("body_need:" + ch.bodyNeed[i]);
    }
  }
  if (ch.bodyLacks) {
    for (let i = 0; i < ch.bodyLacks.length; i++) {
      if (body.indexOf(foldCs(ch.bodyLacks[i])) >= 0) reasons.push("body_lacks:" + ch.bodyLacks[i]);
    }
  }
  for (let wi = 0; wi < WRAPPER_FORBIDDEN_IN_TITLE.length; wi++) {
    const w = foldCs(WRAPPER_FORBIDDEN_IN_TITLE[wi]);
    if (w && title.indexOf(w) === 0) reasons.push("wrapper_prefix:" + WRAPPER_FORBIDDEN_IN_TITLE[wi]);
  }
  const pv = validator.validateCleanPayload(turn, p.input);
  if (!pv.pass && (pv.violations || []).some((v) => v.indexOf("title") >= 0 || v.indexOf("instruction") >= 0)) {
    reasons.push("validator:" + (pv.violations || []).join(","));
  }
  return { id: p.id, pass: reasons.length === 0, reasons, title: draftField(turn, "title") };
}

function evalFieldIsolationProbe(turn, p) {
  const title = foldCs(draftField(turn, "title"));
  const note = foldCs(draftField(turn, "note"));
  const loc = foldCs(draftField(turn, "location"));
  const reasons = [];
  if (p.titleNeed) {
    for (let i = 0; i < p.titleNeed.length; i++) {
      if (title.indexOf(foldCs(p.titleNeed[i])) < 0) reasons.push("title");
    }
  }
  if (p.locNeed) {
    for (let i = 0; i < p.locNeed.length; i++) {
      if (loc.indexOf(foldCs(p.locNeed[i])) < 0) reasons.push("loc");
    }
  }
  if (p.noteNeed) {
    for (let i = 0; i < p.noteNeed.length; i++) {
      if (note.indexOf(foldCs(p.noteNeed[i])) < 0) reasons.push("note");
    }
  }
  if (p.titleLacks) {
    for (let i = 0; i < p.titleLacks.length; i++) {
      if (title.indexOf(foldCs(p.titleLacks[i])) >= 0) reasons.push("title_bleed:" + p.titleLacks[i]);
    }
  }
  if (p.noteLacks) {
    for (let i = 0; i < p.noteLacks.length; i++) {
      if (note.indexOf(foldCs(p.noteLacks[i])) >= 0) reasons.push("note_bleed:" + p.noteLacks[i]);
    }
  }
  return { id: p.id, pass: reasons.length === 0, reasons };
}

function runTitlePack(eng) {
  let pass = 0;
  const fails = [];
  for (let i = 0; i < TITLE_REAL_UX_PACK.length; i++) {
    const p = TITLE_REAL_UX_PACK[i];
    const turn = eng.processUserTurn(p.input, eng.createEmptyDraft(), harness.ctxForCase(p.group));
    const r = evalTitleProbe(turn, p);
    if (r.pass) pass++;
    else fails.push(r);
  }
  return { total: TITLE_REAL_UX_PACK.length, pass, fails, accuracy: TITLE_REAL_UX_PACK.length ? pass / TITLE_REAL_UX_PACK.length : 1 };
}

function runFieldIsolationPack(eng) {
  let pass = 0;
  const fails = [];
  for (let i = 0; i < FIELD_ISOLATION_REAL_UX.length; i++) {
    const p = FIELD_ISOLATION_REAL_UX[i];
    const turn = eng.processUserTurn(p.input, eng.createEmptyDraft(), harness.ctxForCase(p.group));
    const r = evalFieldIsolationProbe(turn, p);
    if (r.pass) pass++;
    else fails.push(r);
  }
  return { total: FIELD_ISOLATION_REAL_UX.length, pass, fails, accuracy: FIELD_ISOLATION_REAL_UX.length ? pass / FIELD_ISOLATION_REAL_UX.length : 1 };
}

function countWrapperLeak(cases, eng) {
  let leak = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), harness.ctxForCase(c.group || "calendar_write"));
    const title = foldCs(draftField(turn, "title"));
    if (payloadCore.hasInstructionLeakage(draftField(turn, "title"))) leak++;
    else {
      for (let wi = 0; wi < WRAPPER_FORBIDDEN_IN_TITLE.length; wi++) {
        const w = foldCs(WRAPPER_FORBIDDEN_IN_TITLE[wi]);
        if (w && title.indexOf(w) === 0) {
          leak++;
          break;
        }
      }
    }
  }
  return leak;
}

module.exports = {
  TITLE_REAL_UX_PACK,
  FIELD_ISOLATION_REAL_UX,
  WRAPPER_FORBIDDEN_IN_TITLE,
  classifyContamination,
  evalTitleProbe,
  evalFieldIsolationProbe,
  runTitlePack,
  runFieldIsolationPack,
  countWrapperLeak,
  draftField,
};
