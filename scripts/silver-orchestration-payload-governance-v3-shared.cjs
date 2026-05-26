#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const saveShared = require("./silver-save-understanding-audit-shared.cjs");
const v2 = require("./silver-orchestration-stabilization-v2-shared.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");

const REPO = path.resolve(__dirname, "..");
const WRITE_INTENTS = v2.WRITE_INTENTS;

/** PAYLOAD PERSISTENCE CONTRACT V1 — slot metadata for orchestration governance. */
const PAYLOAD_PERSISTENCE_CONTRACT_V1 = {
  harness_id: "silver_payload_persistence_contract_v1",
  slots: {
    title: {
      origin: "calendar_head",
      protected_owner: "calendar.create",
      overwrite_policy: "primary_only",
      persistence_state: "protected",
      orchestration_priority: 100,
      propagation_guarantees: ["no_wrapper_leak", "no_companion_overwrite"]
    },
    location: {
      origin: "calendar_head",
      protected_owner: "calendar.create",
      overwrite_policy: "primary_only",
      persistence_state: "protected",
      orchestration_priority: 90,
      propagation_guarantees: ["no_truncation", "no_title_contamination"]
    },
    note: {
      origin: "embedded_tail",
      protected_owner: "calendar.create",
      overwrite_policy: "embedded_before_companion",
      persistence_state: "protected",
      orchestration_priority: 95,
      propagation_guarantees: ["no_companion_task_preempt", "no_late_stage_wipe"]
    },
    companion_task: {
      origin: "secondary_intent",
      protected_owner: "tasks.create",
      overwrite_policy: "secondary_never_overwrites_primary",
      persistence_state: "isolated",
      orchestration_priority: 40,
      propagation_guarantees: ["must_not_clear_event_note"]
    }
  }
};

const EMBEDDED_REMINDER_REAL_UX = [
  {
    id: "ER01",
    input: "Ulož mi zítra v 15 schůzku s Jakubem a připomeň mi ať si sebou vezmu mobilní telefon",
    noteNeed: ["mobil", "vzit"],
    titleMustNot: ["pripom"]
  },
  {
    id: "ER02",
    input: "Přidej poradu s klientem a připomeň mi vzít notebook",
    noteNeed: ["notebook", "vzit"]
  },
  {
    id: "ER03",
    input: "Zapiš schůzku s doktorem a připomeň mi vzít výsledky",
    noteNeed: ["vysled", "vzit"]
  },
  {
    id: "ER04",
    input: "Ulož meeting s týmem a připomeň mi vytisknout smlouvu",
    noteNeed: ["smlouv", "vytisk"]
  },
  {
    id: "ER05",
    input: "Přidej schůzku s Pavlem a do poznámky napiš že přijde pozdě",
    noteNeed: ["pozd"]
  },
  {
    id: "ER06",
    input: "Zapiš návštěvu právníka a připomeň mi vzít dokumenty",
    noteNeed: ["dokument", "vzit"]
  },
  {
    id: "ER07",
    input: "Ulož poradu a ještě mi připomeň poslat prezentaci",
    noteNeed: ["prezentac", "poslat"]
  },
  {
    id: "ER08",
    input: "Přidej schůzku a napiš do poznámky že klient chce novou nabídku",
    noteNeed: ["nabidk"]
  },
  {
    id: "ER09",
    input: "Ulož servis auta a připomeň mi zkontrolovat pneu",
    noteNeed: ["pneu"]
  },
  {
    id: "ER10",
    input: "Přidej meeting a připomeň mi zavolat Janě",
    noteNeed: ["jan", "zavolat"]
  }
];

const MULTI_STORAGE_CHAOS_PACK = [
  {
    id: "MS01",
    input: "Do poznámek napiš PIN a připomeň mi koupit mléko",
    expect: "notes",
    noteNeed: ["pin"]
  },
  {
    id: "MS02",
    input: "Přidej schůzku zítra a vytvoř úkol vytisknout smlouvu",
    expect: "mixed_calendar",
    requireCompanionTask: true,
    titleNeed: ["schuz"]
  },
  {
    id: "MS03",
    input: "Ulož meeting zítra a napiš do poznámky adresu",
    expect: "mixed_calendar",
    noteNeed: ["adres"]
  },
  {
    id: "MS04",
    input: "Přidej poradu a připomeň mi zavolat Petrovi",
    expect: "mixed_calendar",
    noteNeed: ["petr", "zavolat"],
    forbidCompanion: true
  },
  {
    id: "MS05",
    input: "Do poznámek napiš heslo wifi",
    expect: "notes",
    noteNeed: ["heslo"]
  },
  {
    id: "MS06",
    input: "Přidej schůzku a ještě vytvoř úkol poslat nabídku",
    expect: "mixed_calendar",
    requireCompanionTask: true
  },
  {
    id: "MS07",
    input: "Ulož návštěvu servisu v pátek a napiš do poznámky číslo pojistky",
    expect: "mixed_calendar",
    noteNeed: ["pojist"]
  },
  {
    id: "MS08",
    input: "Přidej meeting a připomeň mi vzít notebook",
    expect: "mixed_calendar",
    noteNeed: ["notebook", "vzit"],
    forbidCompanion: true
  },
  {
    id: "MS09",
    input: "Ulož schůzku zítra a vytvoř úkol vytisknout dokumenty",
    expect: "mixed_calendar",
    requireCompanionTask: true
  },
  {
    id: "MS10",
    input: "Přidej poradu a napiš do poznámky že klient přijde pozdě",
    expect: "mixed_calendar",
    noteNeed: ["pozd"]
  }
];

const ORCHESTRATION_ORDERING_CASES = [
  {
    id: "OO01",
    input: "Ulož mi pozítří schůzku s Jakubem potkáme se na Štvanici a připomeň mi ať si sebou vezmu mobilní telefon",
    expect: "calendar",
    noteNeed: ["mobil"],
    forbidCompanion: true
  },
  {
    id: "OO02",
    input: "Přidej poradu s klientem a připomeň mi vzít notebook",
    expect: "calendar",
    noteNeed: ["notebook"],
    forbidCompanion: true
  },
  {
    id: "OO03",
    input: "Přidej schůzku zítra a vytvoř úkol vytisknout smlouvu",
    expect: "mixed_calendar",
    requireCompanionTask: true
  }
];

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function foldCs(s) {
  return v2.foldCs(s);
}

function noteFolded(turn) {
  return foldCs(String((turn.draft && turn.draft.note) || ""));
}

function runEmbeddedCase(eng, c, ctx) {
  const r = saveShared.runCase(eng, Object.assign({ expect: "mixed_calendar" }, c), ctx);
  const turn = r.turn || {};
  const issues = r.issues ? r.issues.slice() : [];
  if (c.forbidCompanion && turn.silverCompanionTaskDraft) {
    issues.push("companion_task_preempted_embedded_note");
  }
  if (c.requireCompanionTask && !turn.silverCompanionTaskDraft) {
    issues.push("missing_companion_task");
  }
  if (c.noteNeed) {
    const f = noteFolded(turn);
    const tokens = Array.isArray(c.noteNeed) ? c.noteNeed : [c.noteNeed];
    let hit = false;
    for (let i = 0; i < tokens.length; i++) {
      if (f.indexOf(foldCs(tokens[i])) >= 0) {
        hit = true;
        break;
      }
    }
    if (!hit) issues.push("embedded_tail_drop");
  }
  if (c.titleMustNot) {
    const tf = foldCs(String((turn.draft && turn.draft.title) || ""));
    const tokens = Array.isArray(c.titleMustNot) ? c.titleMustNot : [c.titleMustNot];
    for (let i = 0; i < tokens.length; i++) {
      if (tf.indexOf(foldCs(tokens[i])) >= 0) issues.push("title_contamination:" + tokens[i]);
    }
  }
  r.issues = issues;
  r.pass = issues.length === 0;
  return r;
}

function runMultiStorageCase(eng, c, ctx) {
  if (c.expect === "notes") {
    return saveShared.runCase(eng, c, ctx);
  }
  return runEmbeddedCase(eng, c, ctx);
}

function buildRealUxPayloadChaosCasesV3(targetCount) {
  const rng = core.mulberry32(0x4f52434833);
  const cases = [];
  const templates = [
    "uloz mi {date} schuzku s {person} a pripomen mi {task}",
    "hele prosim {date} porada s {person} a do poznamky {note}",
    "pripomen mi {task} {date}",
    "do poznamek napis {note} a pridej ukol {task}",
    "na {date} schuzka s {person} v {place}",
    "ee no {date} doktor a jeste ukol {task}",
    "jen mi pripomen {task}",
    "vlastne ne pockej {date} servis auta",
    "uloz meeting a pripomen mi {task}",
    "pridej schuzku a napis do poznamky {note}",
    "zapis navstevu {person} a pripomen mi {task}",
    "uloz poradu a jeste mi pripomen {task}",
    "pridej schuzku s {person} a vytvor ukol {task}",
    "do poznamek napis {note} a pridej schuzku s {person}",
    "na {date} porada a pripomen mi vzit {thing}"
  ];
  const dates = ["dnes", "zitra", "na patek", "ve stredu", "dneska", "na dnesek", "pozitri"];
  const people = ["Novotnym", "Pavlem", "Tondou", "doktorem", "klientem", "pravnikem"];
  const tasks = ["koupit mleko", "zavolat Petrovi", "vzit smlouvu", "odeslat fakturu", "vzit notebook"];
  const notes = ["PIN 1234", "heslo wifi", "adresa kancelare", "klient chce novou nabidku"];
  const places = ["Praze", "Brne", "namesti"];
  const things = ["notebook", "dokumenty", "vysledky", "mobil"];
  let n = 0;
  while (cases.length < targetCount) {
    const t = templates[Math.floor(rng() * templates.length)];
    const input = t
      .replace("{date}", dates[Math.floor(rng() * dates.length)])
      .replace("{person}", people[Math.floor(rng() * people.length)])
      .replace("{task}", tasks[Math.floor(rng() * tasks.length)])
      .replace("{note}", notes[Math.floor(rng() * notes.length)])
      .replace("{place}", places[Math.floor(rng() * places.length)])
      .replace("{thing}", things[Math.floor(rng() * things.length)]);
    n++;
    cases.push({
      id: "RUX3_" + String(n).padStart(5, "0"),
      input: input,
      chaos_kind:
        input.indexOf("poznam") >= 0
          ? "multi_storage"
          : input.indexOf("ukol") >= 0
            ? "orchestration"
            : input.indexOf("pripomen") >= 0
              ? "embedded_reminder"
              : "payload"
    });
  }
  return cases;
}

function classifyOverwriteFailure(r, c) {
  const turn = r.turn || {};
  if (r.issues.indexOf("companion_task_preempted_embedded_note") >= 0) {
    return {
      overwrite_phase: "multi_intent_bootstrap",
      slot_owner: "tasks.create",
      collision_source: "companion_task_branch",
      payload_replacement_point: "silverCompanionTaskDraft"
    };
  }
  if (r.issues.indexOf("embedded_tail_drop") >= 0 || r.issues.some(function (x) {
    return x.indexOf("note_missing") === 0;
  })) {
    return {
      overwrite_phase: "embedded_note_propagation",
      slot_owner: "calendar.create",
      collision_source: "late_note_drop_or_companion",
      payload_replacement_point: "draft.note"
    };
  }
  if (r.issues.some(function (x) {
    return x.indexOf("title_pollution") === 0 || x.indexOf("title_contamination") === 0;
  })) {
    return {
      overwrite_phase: "title_cleanup",
      slot_owner: "calendar.create",
      collision_source: "wrapper_leak",
      payload_replacement_point: "draft.title"
    };
  }
  if (turn.normalizedIntent === "clarification" && c.expect !== "clarification") {
    return {
      overwrite_phase: "dual_write_clarification",
      slot_owner: "none",
      collision_source: "orchestration_ordering",
      payload_replacement_point: "normalizedIntent"
    };
  }
  return {
    overwrite_phase: "unknown",
    slot_owner: String(turn.normalizedIntent || ""),
    collision_source: (r.issues[0] || "unspecified"),
    payload_replacement_point: "n/a"
  };
}

module.exports = {
  REPO,
  WRITE_INTENTS,
  PAYLOAD_PERSISTENCE_CONTRACT_V1,
  EMBEDDED_REMINDER_REAL_UX,
  MULTI_STORAGE_CHAOS_PACK,
  ORCHESTRATION_ORDERING_CASES,
  mainCommit,
  foldCs,
  runEmbeddedCase,
  runMultiStorageCase,
  buildRealUxPayloadChaosCasesV3,
  classifyOverwriteFailure
};
