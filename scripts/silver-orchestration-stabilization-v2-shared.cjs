#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const capShared = require("./silver-line-o-capability-audit-shared.cjs");
const saveShared = require("./silver-save-understanding-audit-shared.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");

const REPO = path.resolve(__dirname, "..");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const STATIC_ASSISTANT = new Set(["assistant.capability", "assistant.help", "assistant.guidance"]);

const WRAPPER_LEAK_TOKENS = [
  "pripomen mi",
  "uloz mi",
  "pridej mi",
  "vytvor mi",
  "na dnesek",
  "na zitrek",
  "at nezapomenu",
  "do poznamky napis",
  "jen mi pripomen",
  "chci si ulozit",
  "potrebuji si zapsat",
  "napis mi",
  "poznamenej mi",
  "zapis mi",
  "prosim uloz",
  "jen si poznamenej",
  "a jeste tam pridej",
  "a napis tam",
  "k tomu jeste napis",
  "a pripomen mi",
  "dneska koupit",
  "dneska zavolat"
];

const HELP_SEED_PACK = [
  "Jak uložím něco do kalendáře",
  "Jak vytvořím úkol",
  "Jak fungují připomínky",
  "Jak fungují úkoly",
  "Jak fungují poznámky",
  "Jak funguje ukládání",
  "Co mám napsat aby se vytvořila schůzka",
  "Jak zadám schůzku",
  "Jak zadám úkol",
  "Jak zadám připomínku",
  "Jak přidám poznámku",
  "Co umíš",
  "S čím mi pomůžeš",
  "Jak funguje Silver",
  "Jak funguje kalendář",
  "Jak funguje vyhledávání",
  "Jak fungují follow-upy",
  "Jak funguje pokračování konverzace",
  "Jak fungují drafty",
  "Jak funguje ukládání do poznámek",
  "Jak fungují připomínky v kalendáři",
  "Jak funguje hledání",
  "Jak funguje plánování",
  "Jak mám napsat připomínku",
  "Jak mám napsat schůzku",
  "Jak mám napsat úkol",
  "Jak mám napsat poznámku",
  "Jak mám vytvořit schůzku",
  "Jak mám vytvořit úkol",
  "Jak mám vytvořit poznámku",
  "Jak mám vytvořit připomínku",
  "Co se dá ukládat",
  "Umíš připomínky",
  "Umíš kalendář",
  "Umíš poznámky",
  "Umíš úkoly",
  "Jak funguje přidávání schůzek",
  "Jak funguje ukládání úkolů",
  "Jak fungují poznámky v Silveru",
  "Co mám napsat aby sis něco zapamatoval",
  "Jak funguje zapamatování",
  "Jak funguje navazování",
  "Jak funguje pokračování",
  "Jak funguje agenda",
  "Jak funguje organizace dne",
  "Co všechno umíš uložit",
  "Jak funguje vytvoření události",
  "Jak funguje vytvoření připomínky",
  "Jak funguje vytvoření úkolu",
  "Jak funguje vytvoření poznámky",
  "Jak funguje plánování schůzek",
  "Jak funguje vytváření schůzek",
  "Jak funguje přidání schůzky",
  "Jak funguje přidání úkolu",
  "Jak funguje přidání poznámky",
  "Jak funguje reminder",
  "Jak fungují follow-up připomínky",
  "Jak funguje připomenutí",
  "Co když chci jen poradit",
  "Co když nechci nic ukládat",
  "Jen mi poraď jak vytvořit schůzku",
  "Jen mi vysvětli jak fungují úkoly",
  "Jen mi ukaž příklad vytvoření poznámky",
  "Dej mi příklad vytvoření schůzky",
  "Dej mi příklad vytvoření úkolu",
  "Dej mi příklad vytvoření poznámky",
  "Napiš mi příklad jak uložit schůzku",
  "Napiš mi příklad jak vytvořit úkol",
  "Napiš mi příklad jak vytvořit připomínku",
  "Napiš mi příklad jak vytvořit poznámku"
];

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function foldCs(s) {
  return harness.foldCs ? harness.foldCs(s) : capShared.foldCs(s);
}

function titleHasWrapperLeak(title) {
  const f = foldCs(String(title || ""));
  if (!f || f.length < 3) return false;
  for (let i = 0; i < WRAPPER_LEAK_TOKENS.length; i++) {
    if (f.indexOf(foldCs(WRAPPER_LEAK_TOKENS[i])) >= 0) return WRAPPER_LEAK_TOKENS[i];
  }
  return false;
}

function buildHelpGuidanceCorpusV2(targetCount) {
  const cases = [];
  let n = 0;
  const prefixes = ["", "Hele ", "Prosím ", "Krátce ", "No ", "Vlastně ", "Řekni mi "];
  const suffixes = ["", "?", " prosím?", " stručně?"];
  const topics = ["calendar", "tasks", "notes", "reminders", "search", "silver", "general", "save", "continuation"];
  function add(c) {
    n++;
    cases.push(Object.assign({ id: "HGF_" + String(n).padStart(5, "0") }, c));
  }
  for (let si = 0; si < HELP_SEED_PACK.length; si++) {
    const seed = HELP_SEED_PACK[si];
    for (let pi = 0; pi < prefixes.length; pi++) {
      for (let su = 0; su < suffixes.length; su++) {
        add({
          input: prefixes[pi] + seed + suffixes[su],
          relaxed: true,
          topic: topics[si % topics.length]
        });
        if (cases.length >= targetCount) return cases;
      }
    }
  }
  const variants = [
    "jak funguje {mod}",
    "umíš {mod}",
    "co mám napsat pro {mod}",
    "jen mi poraď jak použít {mod}",
    "dej mi příklad pro {mod}",
    "jak mám napsat {mod}"
  ];
  const mods = ["kalendář", "úkoly", "poznámky", "připomínky", "schůzku", "úkol", "poznámku", "ukládání", "vyhledávání"];
  const rng = core.mulberry32(0x4f524348);
  while (cases.length < targetCount) {
    const v = variants[Math.floor(rng() * variants.length)];
    const m = mods[Math.floor(rng() * mods.length)];
    const p = prefixes[Math.floor(rng() * prefixes.length)];
    const s = suffixes[Math.floor(rng() * suffixes.length)];
    add({ input: p + v.replace("{mod}", m) + s, relaxed: true, topic: "general" });
  }
  return cases;
}

function buildWrapperHierarchyCases() {
  return [
    { id: "WH01", input: "Ulož mi na dnešek schůzku s Pavlíkem", expect: "calendar", titleNeed: ["pavlik", "schuz"], titleMustNot: WRAPPER_LEAK_TOKENS },
    { id: "WH02", input: "Připomeň mi dneska koupit mléko", expect: "task", titleNeed: ["mlek"], titleMustNot: ["dneska", "pripomen"] },
    { id: "WH03", input: "Na zítřek mi vytvoř schůzku s doktorem", expect: "calendar", titleNeed: ["doktor", "schuz"], titleMustNot: ["na zitrek", "vytvor"] },
    { id: "WH04", input: "Do poznámky napiš že mám zavolat Petrovi", expect: "notes", noteNeed: ["petr", "zavolat"] },
    { id: "WH05", input: "Ať nezapomenu zítra koupit chleba", expect: "task", titleNeed: ["chleb"] },
    { id: "WH06", input: "Jen mi připomeň poradu", expect: "task", titleNeed: ["porad"] },
    { id: "WH07", input: "Chci si uložit schůzku s Martinem", expect: "calendar", titleNeed: ["martin", "schuz"] },
    {
      id: "WH08",
      input: "Potřebuji si zapsat poradu",
      expect: "calendar",
      titleNeed: ["porad"],
      allowIntents: ["calendar.create", "create.storage_disambiguation"]
    },
    { id: "WH09", input: "Zapiš mi schůzku s klientem", expect: "calendar", titleNeed: ["klient", "schuz"] },
    { id: "WH10", input: "Prosím ulož schůzku s Tondou", expect: "calendar", titleNeed: ["tonda", "schuz"] },
    { id: "WH11", input: "Jen si poznamenej že mám zavolat", expect: "notes", noteNeed: ["zavolat"] },
    { id: "WH12", input: "Na dnešek mi zapiš poradu", expect: "calendar", titleNeed: ["porad"], titleMustNot: ["na dnesek", "dnesek"] },
    { id: "WH13", input: "Na zítřek připomeň servis auta", expect: "task", titleNeed: ["servis"] },
    { id: "WH14", input: "Do poznámky napiš PIN ke kartě", expect: "notes", noteNeed: ["pin"] },
  ];
}

function buildReminderSemanticsCases() {
  const pure = [
    "Připomeň mi koupit mléko",
    "Připomeň mi zavolat doktorovi",
    "Připomeň mi zaplatit nájem",
    "Připomeň mi servis auta",
    "Připomeň mi zítra koupit vodu",
    "Připomeň mi dnes zavolat mámě"
  ];
  const attached = [
    "Připomeň mi zítra v 15 schůzku s doktorem",
    "Připomeň mi dnes v 18 poradu",
    "Připomeň mi schůzku s právníkem",
    "Připomeň mi poradu s týmem"
  ];
  const cal = [
    "Ulož schůzku s doktorem zítra v 15",
    "Přidej poradu dnes v 18",
    "Vytvoř schůzku s klientem na zítřek"
  ];
  const cases = [];
  let n = 0;
  function add(input, expect, extra) {
    n++;
    cases.push(Object.assign({ id: "RS_" + String(n).padStart(3, "0"), input: input, expect: expect }, extra || {}));
  }
  pure.forEach(function (p) {
    add(p, "task", {});
  });
  attached.forEach(function (p) {
    add(p, "calendar", { titleNeed: ["schuz", "porad", "doktor", "pravn", "tym"] });
  });
  cal.forEach(function (p) {
    add(p, "calendar", { titleNeed: ["schuz", "porad", "doktor", "klient"] });
  });
  return cases;
}

function buildPrimarySecondaryCases() {
  return [
    {
      id: "PS01",
      input: "Ulož zítra schůzku s Tondou a připomeň mi vzít kalkulačku",
      expect: "mixed_calendar",
      titleNeed: ["tonda", "schuz"],
      requireCompanionTask: true
    },
    {
      id: "PS02",
      input: "Přidej poradu na pátek a připomeň mi vytisknout smlouvu",
      expect: "mixed_calendar",
      titleNeed: ["porad"],
      requireCompanionTask: true
    },
    {
      id: "PS03",
      input: "Zapiš schůzku s klientem a do poznámky napiš že chce novou nabídku",
      expect: "mixed_calendar",
      titleNeed: ["klient"],
      noteNeed: ["nabid"]
    },
    {
      id: "PS04",
      input: "Přidej schůzku s doktorem a připomeň mi vzít výsledky",
      expect: "mixed_calendar",
      titleNeed: ["doktor"],
      requireCompanionTask: true
    },
    {
      id: "PS05",
      input: "Ulož meeting a napiš do poznámky že mám vzít notebook",
      expect: "mixed_calendar",
      titleNeed: ["meeting"],
      noteNeed: ["notebook"]
    }
  ];
}

function buildStorageOwnershipCases() {
  return [
    {
      id: "SO01",
      input: "Do poznámek napiš PIN ke kartě",
      expect: "notes",
      noteNeed: ["pin"],
      titleMustNot: ["poznam"]
    },
    { id: "SO02", input: "Přidej úkol koupit mléko", expect: "task", titleNeed: ["mlek"] },
    { id: "SO03", input: "Přidej do kalendáře schůzku s klientem", expect: "calendar", titleNeed: ["klient", "schuz"] },
    { id: "SO04", input: "Přidej úkol zavolat Petrovi", expect: "task", titleNeed: ["petr", "zavolat"] },
    { id: "SO05", input: "Přidej schůzku a připomeň mi vzít notebook", expect: "mixed_calendar", titleNeed: ["schuz"], requireCompanionTask: true }
  ];
}

function runHelpFirewallAudit(harnessId, cases, reportPath) {
  const results = [];
  let pass = 0;
  let draftLeaks = 0;
  let payloadLeaks = 0;
  for (let i = 0; i < cases.length; i++) {
    const r = capShared.runCapabilityCase(harness.loadEngine(), cases[i]);
    results.push(r);
    if (r.pass) pass++;
    else {
      for (let j = 0; j < r.issues.length; j++) {
        if (r.issues[j].indexOf("unexpected_draft") >= 0) draftLeaks++;
        if (r.issues[j].indexOf("unexpected_write") >= 0 || r.issues[j].indexOf("capability_must_not_write") >= 0) {
          payloadLeaks++;
        }
      }
    }
  }
  const total = cases.length;
  const report = {
    harness_id: harnessId,
    main_commit: mainCommit(),
    cases_total: total,
    pass_count: pass,
    fail_count: total - pass,
    draft_card_leaks: draftLeaks,
    guidance_payload_leaks: payloadLeaks,
    fails: results.filter(function (x) {
      return !x.pass;
    })
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("=== " + harnessId.toUpperCase() + " ===");
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("fail_count=" + (total - pass));
  console.log("draft_card_leaks=" + draftLeaks);
  console.log("guidance_payload_leaks=" + payloadLeaks);
  console.log("PASS_FAIL=" + (pass === total ? "PASS" : "FAIL"));
  console.log("=== END_" + harnessId.toUpperCase() + " ===");
  return { ok: pass === total, report: report };
}

function runSaveAuditExtended(harnessId, cases, reportPath, extraCheck) {
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_write");
  const results = [];
  let pass = 0;
  let wrapperLeaks = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c.expectNotCapability) {
      const cr = capShared.runCapabilityCase(eng, c);
      results.push(cr);
      if (cr.pass) pass++;
      continue;
    }
    const runC = Object.assign({}, c);
    if (c.allowIntents) delete runC.expect;
    const r = saveShared.runCase(eng, runC, ctx);
    if (c.allowIntents) {
      r.issues = (r.issues || []).filter(function (iss) {
        return iss.indexOf("intent_expected_") !== 0;
      });
      if (c.allowIntents.indexOf(r.intent) < 0) {
        r.issues.push("intent_not_allowed:" + r.intent);
      }
      r.pass = r.issues.length === 0;
    }
    const title = r.title || "";
    const leak = titleHasWrapperLeak(title);
    if (leak) {
      r.issues.push("wrapper_leak:" + leak);
      r.pass = false;
      wrapperLeaks++;
    }
    if (extraCheck) extraCheck(r, c, eng);
    results.push(r);
    if (r.pass) pass++;
  }
  const total = cases.length;
  const report = {
    harness_id: harnessId,
    main_commit: mainCommit(),
    cases_total: total,
    pass_count: pass,
    fail_count: total - pass,
    wrapper_leak_count: wrapperLeaks,
    fails: results.filter(function (x) {
      return !x.pass;
    })
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("=== " + harnessId.toUpperCase() + " ===");
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("wrapper_leak_count=" + wrapperLeaks);
  console.log("PASS_FAIL=" + (pass === total ? "PASS" : "FAIL"));
  console.log("=== END_" + harnessId.toUpperCase() + " ===");
  return { ok: pass === total, report: report };
}

function primarySecondaryExtraCheck(r, c) {
  if (c.requireCompanionTask && !(r.turn && r.turn.silverCompanionTaskDraft)) {
    r.issues.push("missing_companion_task");
    r.pass = false;
  }
  if (c.noteNeed && r.turn && r.turn.draft) {
    const note = String(r.turn.draft.note || "").trim();
    const tokens = Array.isArray(c.noteNeed) ? c.noteNeed : [c.noteNeed];
    const f = foldCs(note);
    let hit = false;
    for (let i = 0; i < tokens.length; i++) {
      if (f.indexOf(foldCs(tokens[i])) >= 0) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      r.issues.push("note_missing");
      r.pass = false;
    }
  }
}

function buildRealUxChaosCases(targetCount) {
  const rng = core.mulberry32(0x52554832);
  const cases = [];
  const templates = [
    "uloz mi {date} schuzku s {person} a pripomen mi {task}",
    "hele prosim {date} porada s {person} a do poznamky {note}",
    "pripomen mi {task} {date}",
    "do poznamek napis {note} a pridej ukol {task}",
    "na {date} schuzka s {person} v {place}",
    "ee no {date} doktor a jeste ukol {task}",
    "jen mi pripomen {task}",
    "vlastne ne pockej {date} servis auta"
  ];
  const dates = ["dnes", "zitra", "na patek", "ve stredu", "dneska", "na dnesek"];
  const people = ["Novotnym", "Pavlem", "Tondou", "doktorem", "klientem"];
  const tasks = ["koupit mleko", "zavolat Petrovi", "vzit smlouvu", "odeslat fakturu"];
  const notes = ["PIN 1234", "heslo wifi", "adresa kancelare"];
  const places = ["Praze", "Brne", "namesti"];
  let n = 0;
  while (cases.length < targetCount) {
    const t = templates[Math.floor(rng() * templates.length)];
    const input = t
      .replace("{date}", dates[Math.floor(rng() * dates.length)])
      .replace("{person}", people[Math.floor(rng() * people.length)])
      .replace("{task}", tasks[Math.floor(rng() * tasks.length)])
      .replace("{note}", notes[Math.floor(rng() * notes.length)])
      .replace("{place}", places[Math.floor(rng() * places.length)]);
    n++;
    cases.push({
      id: "RUX_" + String(n).padStart(5, "0"),
      input: input,
      expect: input.indexOf("poznam") >= 0 ? "notes" : input.indexOf("ukol") >= 0 ? "task" : "calendar",
      relaxed: true
    });
  }
  return cases;
}

module.exports = {
  REPO,
  mainCommit,
  foldCs,
  WRITE_INTENTS,
  STATIC_ASSISTANT,
  WRAPPER_LEAK_TOKENS,
  buildHelpGuidanceCorpusV2,
  buildWrapperHierarchyCases,
  buildReminderSemanticsCases,
  buildPrimarySecondaryCases,
  buildStorageOwnershipCases,
  buildRealUxChaosCases,
  runHelpFirewallAudit,
  runSaveAuditExtended,
  primarySecondaryExtraCheck,
  titleHasWrapperLeak
};
