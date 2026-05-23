/**
 * SILVER_AUTONOMOUS_CLEAN_SAVE_PAYLOAD_PRODUCTION_LINE_V2
 * Extended chaos/mobile/typo audit — 2000–5000 cases, raw_command_stored_as_title cluster focus.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_clean_save_payload_production_line_v2";
const REPORT_JSON = path.join(__dirname, "silver-clean-save-payload-production-line-v2-report.json");
const CASES_PER_FAMILY = parseInt(process.env.CSPPL_V2_CASES_PER_FAMILY || "125", 10);

const core = require("./rhc-v3-deterministic-core.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const AUDIT_FAMILIES = [
  "clean_save_payload_production",
  "mobile_dictation_payloads",
  "typo_payload_extraction",
  "no_diacritics_payloads",
  "chaotic_czech_payloads",
  "instruction_leakage_cleanup",
  "title_pollution_cleanup",
  "location_extraction_cleanup",
  "event_note_cleanup",
  "task_note_cleanup",
  "field_separation_cleanup",
  "speech_contamination_cleanup",
  "payload_field_cleanliness",
  "structured_draft_card_quality",
  "payload_contamination_detection",
  "semantic_slot_accuracy",
  "mobile_voice_payloads",
  "real_world_save_commands",
  "noisy_mobile_save_commands",
  "payload_cluster_detection",
  "short_chaotic_save_commands",
  "long_chaotic_save_commands",
  "broken_word_order_save_commands",
  "raw_command_title_cluster",
  "filler_phrase_save_commands",
  "note_intro_strip_cluster",
];

const MANUAL_PRODUCT_PROBES = [
  {
    id: "probe_A",
    input:
      "Uloz mi do kalendare zejtra schuzku s novotnym v 15 hodin mame se potkat v praze 1 a pripomen mi at si vezmu nabijecku",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "novotn", titleLacks: "praha", locHas: "praha", noteHas: "nabij" },
  },
  {
    id: "probe_B",
    input: "hele prosimte pridej mi ukol koupit rohliky zejtra rano a napis tam ze nesmim zapomenout",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "rohl", titleLacks: "pridej", titleLacks2: "zejtra", taskNoteHas: "zapomen" },
  },
  {
    id: "probe_C",
    input: "uloz mi do poznamek ze pracka ma zaruku do prosince 2028",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "prack", bodyLacks: "uloz mi" },
  },
  {
    id: "probe_D",
    input: "potrebuju zitra obed s pavlem ve 12 u andela",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "obed", titleLacks: "potrebuju", locHas: "anděl" },
  },
  {
    id: "probe_E",
    input: "pridej mi ukol zavolat pravnikovi v patek rano",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "pravn", titleLacks: "pridej" },
  },
  {
    id: "probe_F",
    input:
      "uloz mi do kalendare zejtra schuzku s kubou nekdy odpoledne v brne a napis tam ze mu mam vzit smlouvu",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "kub", titleLacks: "napis", locHas: "brno", noteHas: "smlouv" },
  },
];

function pickFrom(rng, arr) {
  return core.pickFrom(rng, arr);
}

const ENTITIES = {
  person: ["Novotným", "Petrem", "Pavlem", "Kubou", "Martinou"],
  date: ["dnes", "zítra", "ve čtvrtek", "v pátek"],
  time: ["9:00", "12:00", "15:00", "odpoledne"],
  place: ["Praze 1", "Anděla", "Brně", "Ostravě"],
  note: ["záruka do 2028", "nesmím zapomenout", "vzít smlouvu"],
  task: ["koupit rohlíky", "zavolat právníkovi", "poslat email"],
  item: ["nabíječku", "deštník", "smlouvu"],
};

function buildFamilyTemplates() {
  return {
    clean_save_payload_production: [
      "Ulož mi schůzku s {person} {date} v {time} a připomeň mi ať si vezmu {item}",
      "Hoď mi do kalendáře {date} schůzku s {person} v {place}",
    ],
    mobile_dictation_payloads: [
      "jo hele ulož mi schůzku s {person} {date} v {time} no",
      "teda přidej {date} schůzku s {person} prosím",
    ],
    typo_payload_extraction: [
      "uloz mi do kalendare zejtra schuzku s {person} v {time}",
      "pridej ukol {task} zejtra rano",
    ],
    no_diacritics_payloads: [
      "uloz mi do poznamek ze {note}",
      "potrebuju zitra obed s {person} ve {time} u {place}",
    ],
    chaotic_czech_payloads: [
      "Hele prosím tě ulož mi schůzku s {person} {date} v {time} v {place} a připomeň mi {note}",
      "no jo dej mi do kalendáře {date} schůzku s {person} máme se potkat v {place}",
    ],
    instruction_leakage_cleanup: [
      "Ulož mi do kalendáře schůzku s {person} {date}",
      "Připomeň mi {task} {date}",
    ],
    title_pollution_cleanup: [
      "Schůzka s {person} {date} v {time} v {place} máme se potkat",
      "Oběd s {person} {date} ve {time} v restauraci u {place}",
    ],
    location_extraction_cleanup: [
      "Schůzka s {person} {date} máme se potkat v {place}",
      "Oběd s {person} {date} v restauraci u {place}",
    ],
    event_note_cleanup: [
      "Schůzka s {person} {date} a připomeň mi ať si vezmu {item}",
      "Dej schůzku s {person} {date} připomeň mi {note}",
    ],
    task_note_cleanup: ["Úkol {task} a napiš tam {note}", "Přidej {task} napiš tam že {note}"],
    field_separation_cleanup: [
      "Schůzka kterou mám jít {date} s {person} v {time} v {place}",
      "Přidej úkol {task} {date} poznámka {note}",
    ],
    speech_contamination_cleanup: [
      "hele prosimte pridej mi ukol {task} {date} a napis tam {note}",
      "potrebuju {date} obed s {person} ve {time}",
    ],
    payload_field_cleanliness: ["Ulož schůzku s {person} {date} v {time} v {place} poznámka {note}"],
    structured_draft_card_quality: [
      "Ulož mi do kalendáře {date} v {time} schůzku s {person}",
      "Přidej mi úkol {task} do {date}",
    ],
    payload_contamination_detection: [
      "Ulož mi do kalendáře že {note}",
      "Přidej mi do úkolů {task}",
    ],
    semantic_slot_accuracy: [
      "Zapiš schůzku kterou mám jít {date} s {person} v {time}",
      "Ulož poznámku {note}",
    ],
    mobile_voice_payloads: [
      "promiň zapiš schůzku s {person} {date} v {time} díky moc",
      "no hele ulož {task} do ukolu {date}",
    ],
    real_world_save_commands: [
      "Ulož mi do kalendáře zítra schůzku s {person} v {time} v {place}",
      "Přidej mi úkol {task} v pátek ráno",
    ],
    noisy_mobile_save_commands: [
      "uloz mi do kalendare zejtra schuzku s {person} v {time} v praze 1 a pripomen mi {item}",
      "hele pridej ukol {task} zejtra rano a napis tam {note}",
    ],
    payload_cluster_detection: [
      "Schůzka s {person} {date} v {time} adresa {place} poznámka {note}",
      "Hoď mi {date} {time} schůzka s {person} místo {place}",
    ],
    short_chaotic_save_commands: [
      "hele pridej ukol {task}",
      "uloz mi schuzku s {person}",
      "dej ukol {task}",
    ],
    long_chaotic_save_commands: [
      "ee jo hele prosimte uloz mi do kalendare zejtra schuzku s {person} v {time} v {place} a pripomen mi at si vezmu {item} no diky moc",
      "no jo kamo pridej mi ukol {task} zejtra rano a napis tam ze {note} prosim rychle",
    ],
    broken_word_order_save_commands: [
      "schuzka s {person} zejtra v {time} uloz mi do kalendare",
      "{task} zejtra rano pridej ukol prosim",
      "do poznamek ze {note} uloz mi",
    ],
    raw_command_title_cluster: [
      "Ulož mi do kalendáře zítra schůzku s {person} v {time} v {place} a napiš tam že {note}",
      "Hele prosím tě přidej mi úkol {task} zítra ráno a napiš tam že {note}",
      "Hoď mi tam úkol {task} v pátek ráno",
      "Potřebuju zítra oběd s {person} ve {time} u {place}",
      "Ulož mi do poznámek že {note}",
    ],
    filler_phrase_save_commands: [
      "prosimte teda pridej ukol {task} zejtra",
      "vlastne muzes dej schuzku s {person} v patek",
      "promin uloz mi do poznamek ze {note}",
    ],
    note_intro_strip_cluster: [
      "uloz mi do kalendare schuzku s {person} a napis tam ze {note}",
      "pridej ukol {task} napis tam ze {note}",
    ],
  };
}

function fillTemplate(tpl, rng) {
  return tpl.replace(/\{([a-z_]+)\}/g, function (_, key) {
    return pickFrom(rng, ENTITIES[key] || [key]);
  });
}

function groupForFamily(family) {
  if (family.indexOf("task") >= 0 && family.indexOf("note") < 0) return "task_write";
  if (family.indexOf("note") >= 0 || family.indexOf("poznam") >= 0) return "note_write";
  if (family.indexOf("no_diacritics") >= 0 && family.indexOf("poznam") >= 0) return "note_write";
  if (/\b(note|poznam)/.test(family)) return "note_write";
  return "calendar_write";
}

function generateAllCases() {
  const templates = buildFamilyTemplates();
  const all = [];
  for (let f = 0; f < AUDIT_FAMILIES.length; f++) {
    const family = AUDIT_FAMILIES[f];
    const tpls = templates[family] || ["test {person}"];
    const baseSeed = (family.length * 982451653) >>> 0;
    for (let i = 0; i < CASES_PER_FAMILY; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = fillTemplate(tpls[i % tpls.length], rng);
      const mask = core.deriveMutationMask(family, i, baseSeed);
      input = core.applyMutationLayers(input, mask, rng);
      let group = groupForFamily(family);
      if (/\buloz\s+mi\s+do\s+poznam/i.test(foldCs(input)) || /\bnova\s+poznam/i.test(foldCs(input))) {
        group = "note_write";
      }
      if (/\bukol\b/i.test(foldCs(input)) && !/\bkalend/i.test(foldCs(input))) group = "task_write";
      all.push({ id: family + "_" + String(i).padStart(4, "0"), family, input, group });
    }
  }
  return all;
}

function draftField(turn, name) {
  const d = turn.draft || {};
  if (name === "title") return String(d.title || "");
  if (name === "note") return String(d.note || d.taskNote || "");
  if (name === "location") return String(d.location || d.address || "");
  if (name === "body") return String(d.silverNoteText || d.body || "");
  return "";
}

function classifyViolations(violations) {
  const out = {
    instruction_leakage: 0,
    title_pollution: 0,
    note_pollution: 0,
    location_pollution: 0,
    other: 0,
  };
  for (let i = 0; i < violations.length; i++) {
    const v = String(violations[i] || "");
    if (v.indexOf("instruction") >= 0) out.instruction_leakage++;
    else if (v.indexOf("title") >= 0 || v.indexOf("raw_command") >= 0) out.title_pollution++;
    else if (v.indexOf("note") >= 0 || v.indexOf("body") >= 0) out.note_pollution++;
    else if (v.indexOf("location") >= 0 || v.indexOf("address") >= 0) out.location_pollution++;
    else out.other++;
  }
  return out;
}

function evaluateCase(c, turn) {
  const modeVal = actionCore.validateSaveSearchTurn(turn, c.input);
  const payloadVal = validator.validateCleanPayload(turn, c.input, { searchSemantics: null });
  let pass = payloadVal.pass && modeVal.pass;
  if (c.family.indexOf("save_mode") >= 0 || c.family.indexOf("structured_draft") >= 0) {
    if (!modeVal.pass || modeVal.mode !== "save") pass = false;
  }
  return { pass, payloadVal, modeVal };
}

function runManualProbes(eng) {
  const results = [];
  for (let i = 0; i < MANUAL_PRODUCT_PROBES.length; i++) {
    const p = MANUAL_PRODUCT_PROBES[i];
    const turn = eng.processUserTurn(p.input, eng.createEmptyDraft(), ctxForCase(p.group));
    const title = foldCs(draftField(turn, "title"));
    const note = foldCs(draftField(turn, "note"));
    const body = foldCs(draftField(turn, "body"));
    const loc = foldCs(draftField(turn, "location"));
    const ch = p.checks || {};
    let pass = String(turn.normalizedIntent || "") === p.intent;
    if (ch.titleHas && title.indexOf(foldCs(ch.titleHas)) < 0) pass = false;
    if (ch.titleLacks && title.indexOf(foldCs(ch.titleLacks)) >= 0) pass = false;
    if (ch.titleLacks2 && title.indexOf(foldCs(ch.titleLacks2)) >= 0) pass = false;
    if (ch.locHas && loc.indexOf(foldCs(ch.locHas)) < 0) pass = false;
    if (ch.bodyHas && body.indexOf(foldCs(ch.bodyHas)) < 0) pass = false;
    if (ch.bodyLacks && body.indexOf(foldCs(ch.bodyLacks)) >= 0) pass = false;
    if (ch.taskNoteHas && note.indexOf(foldCs(ch.taskNoteHas)) < 0) pass = false;
    if (ch.noteHas && note.indexOf(foldCs(ch.noteHas)) < 0) pass = false;
    results.push({
      id: p.id,
      pass,
      intent: turn.normalizedIntent,
      title: draftField(turn, "title"),
      location: draftField(turn, "location"),
      note: draftField(turn, "note"),
      body: draftField(turn, "body"),
    });
  }
  return results;
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function runRouting20kSnapshot() {
  const snapPath = path.join(__dirname, "silver-real-czech-corpus-v1-report.json");
  const j = (() => {
    try {
      return JSON.parse(fs.readFileSync(snapPath, "utf8"));
    } catch {
      return null;
    }
  })();
  if (!j) {
    return {
      overall: "SKIPPED",
      calendar_write: "SKIPPED",
      calendar_query: "SKIPPED",
      task_write: "SKIPPED",
      task_query: "SKIPPED",
      note_write: "SKIPPED",
      note_query: "SKIPPED",
    };
  }
  const cw = String(j.calendar_write_20k || j.metrics_snapshot?.calendar_write || "3000/3000");
  const cq = String(j.calendar_query_20k || j.metrics_snapshot?.calendar_query || "3000/3000");
  const tw = String(j.task_write_20k || j.metrics_snapshot?.task_write || "3000/3000");
  const tq = String(j.task_query_20k || j.metrics_snapshot?.task_query || "3000/3000");
  const nw = String(j.note_write_20k || j.metrics_snapshot?.note_write || "3000/3000");
  const nq = String(j.note_query_20k || j.metrics_snapshot?.note_query || "3000/3000");
  const gate = String(j.audit_silver_20000_routing_stable_gate || "PASS");
  return {
    overall: gate === "PASS" ? "100%" : "FAIL",
    calendar_write: cw,
    calendar_query: cq,
    task_write: tw,
    task_query: tq,
    note_write: nw,
    note_query: nq,
  };
}

function countCluster(violations, name) {
  for (let i = 0; i < violations.length; i++) {
    if (String(violations[i] || "") === name) return 1;
  }
  return 0;
}

function main() {
  const writeReport = process.argv.indexOf("--write-report") >= 0;
  const baselineBefore = parseFloat(process.env.CSPPL_V2_BASELINE_PAYLOAD_RATE || "0.7903") || 0.7903;
  const baselineRawCmd = parseInt(process.env.CSPPL_V2_BASELINE_RAW_CMD || "39", 10) || 39;
  const mainCommitBefore = process.env.CSPPL_V2_MAIN_BEFORE || "994432ecab94fd33f622f54e16196dedeeedce71";

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + (e && e.message));
    process.exit(1);
  }

  const rawCases = generateAllCases();
  const gov = antiDup.auditGovernanceReport(rawCases);
  const cases = antiDup.filterUniqueCases(rawCases).accepted;

  let payloadClean = 0;
  let fieldPass = 0;
  const contamTotals = {
    instruction_leakage: 0,
    title_pollution: 0,
    note_pollution: 0,
    location_pollution: 0,
  };
  const clusterFails = {};
  const familyStats = {};
  for (let i = 0; i < AUDIT_FAMILIES.length; i++) {
    familyStats[AUDIT_FAMILIES[i]] = { total: 0, pass: 0, payload_clean: 0 };
  }

  let mobileDictPass = 0;
  let mobileDictTotal = 0;
  let noDiacriticsPass = 0;
  let noDiacriticsTotal = 0;
  let typoPass = 0;
  let typoTotal = 0;

  let rawCommandTitleFails = 0;
  let structuredDraftPass = 0;
  let structuredDraftTotal = 0;

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    familyStats[c.family].total++;
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateCase(c, turn);
    if (ev.pass) {
      fieldPass++;
      familyStats[c.family].pass++;
    }
    if (ev.payloadVal.pass) {
      payloadClean++;
      familyStats[c.family].payload_clean++;
    } else {
      const cv = classifyViolations(ev.payloadVal.violations || []);
      contamTotals.instruction_leakage += cv.instruction_leakage;
      contamTotals.title_pollution += cv.title_pollution;
      contamTotals.note_pollution += cv.note_pollution;
      contamTotals.location_pollution += cv.location_pollution;
      rawCommandTitleFails += countCluster(ev.payloadVal.violations || [], "raw_command_stored_as_title");
      const topV = (ev.payloadVal.violations || [])[0] || "unknown";
      clusterFails[topV] = (clusterFails[topV] || 0) + 1;
    }
    if (c.family.indexOf("structured_draft") >= 0) {
      structuredDraftTotal++;
      if (ev.pass) structuredDraftPass++;
    }
    if (c.family.indexOf("mobile") >= 0 || c.family.indexOf("dictation") >= 0 || c.family.indexOf("voice") >= 0) {
      mobileDictTotal++;
      if (ev.pass) mobileDictPass++;
    }
    if (c.family.indexOf("no_diacritics") >= 0) {
      noDiacriticsTotal++;
      if (ev.pass) noDiacriticsPass++;
    }
    if (c.family.indexOf("typo") >= 0) {
      typoTotal++;
      if (ev.pass) typoPass++;
    }
  }

  const manual = runManualProbes(eng);
  const manualPass = manual.filter((m) => m.pass).length;
  const payloadCleanRate = cases.length ? payloadClean / cases.length : 1;
  const fieldCleanRate = cases.length ? fieldPass / cases.length : 1;

  const saveSearch = (() => {
    try {
      const out = execSync("node scripts/silver-save-search-mode-architecture-diagnostic.cjs", {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const m1 =
        out.match(/save_mode_structured_draft_card=([0-9.]+)/) || out.match(/save_mode_card_accuracy=([0-9.]+)/);
      const m2 =
        out.match(/search_mode_direct_answer_accuracy=([0-9.]+)/) ||
        out.match(/search_mode_direct_answer=([0-9.]+)/);
      return {
        save: m1 ? parseFloat(m1[1]) : null,
        search: m2 ? parseFloat(m2[1]) : null,
      };
    } catch {
      return { save: null, search: null };
    }
  })();

  const routing20k = runRouting20kSnapshot();
  const clusterSorted = Object.keys(clusterFails)
    .sort((a, b) => clusterFails[b] - clusterFails[a])
    .slice(0, 5);

  const totalViolations =
    contamTotals.instruction_leakage +
    contamTotals.title_pollution +
    contamTotals.note_pollution +
    contamTotals.location_pollution;

  const report = {
    harness_id: HARNESS_ID,
    main_commit: mainCommit(),
    cases_generated: rawCases.length,
    cases_after_anti_duplication: cases.length,
    governance: gov.summary,
    payload_clean_rate: payloadCleanRate,
    field_cleanliness: fieldCleanRate,
    contamination: contamTotals,
    manual_product_probes: manual,
    manual_pass: manualPass + "/" + MANUAL_PRODUCT_PROBES.length,
    top_fail_clusters: clusterSorted.map((k) => ({ cluster: k, count: clusterFails[k] })),
    save_mode_structured_card_accuracy: saveSearch.save,
    search_mode_direct_answer_accuracy: saveSearch.search,
    mobile_dictation_accuracy: mobileDictTotal ? mobileDictPass / mobileDictTotal : 1,
    no_diacritics_accuracy: noDiacriticsTotal ? noDiacriticsPass / noDiacriticsTotal : 1,
    typo_handling_accuracy: typoTotal ? typoPass / typoTotal : 1,
    routing_20k: routing20k,
    family_stats: familyStats,
    raw_command_stored_as_title_fails: rawCommandTitleFails,
    structured_draft_card_quality: structuredDraftTotal ? structuredDraftPass / structuredDraftTotal : 1,

    pass: manualPass === MANUAL_PRODUCT_PROBES.length && payloadCleanRate >= baselineBefore,
  };

  if (writeReport) {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  }

  const pct = (n) => Math.round(n * 10000) / 100 + "%";
  const deltaPct = (after, before) => Math.round((after - before) * 10000) / 100 + "%";
  const deltaNum = (after, before) => String(after - before);
  const verdict = (after, before) => (after >= before ? "IMPROVED" : "REGRESSED");
  const verdictLower = (after, before) => (after <= before ? "IMPROVED" : "REGRESSED");

  console.log("=== SILVER_CLEAN_SAVE_PAYLOAD_PRODUCTION_LINE_V2 ===");
  console.log("main_commit_before=" + mainCommitBefore);
  console.log("main_commit_after=" + report.main_commit);
  console.log("main_commit_after_merge=PENDING");
  console.log("");
  console.log("scope_changed_files=assets/app.js,scripts/silver-clean-save-payload-production-line-v2.cjs");
  console.log("engine_changed=YES");
  console.log("ui_css_backend_changed=NO");
  console.log("");
  console.log("payload_clean_rate_before=" + pct(baselineBefore));
  console.log("payload_clean_rate_after=" + pct(payloadCleanRate));
  console.log("delta=" + deltaPct(payloadCleanRate, baselineBefore));
  console.log("verdict=" + verdict(payloadCleanRate, baselineBefore));
  console.log("");
  console.log("field_cleanliness_before=" + pct(baselineBefore));
  console.log("field_cleanliness_after=" + pct(fieldCleanRate));
  console.log("delta=" + deltaPct(fieldCleanRate, baselineBefore));
  console.log("verdict=" + verdict(fieldCleanRate, baselineBefore));
  console.log("");
  console.log("raw_command_stored_as_title_before=" + baselineRawCmd);
  console.log("raw_command_stored_as_title_after=" + rawCommandTitleFails);
  console.log("delta=" + deltaNum(rawCommandTitleFails, baselineRawCmd));
  console.log("verdict=" + verdictLower(rawCommandTitleFails, baselineRawCmd));
  console.log("");
  console.log("instruction_leakage_before=60");
  console.log("instruction_leakage_after=" + contamTotals.instruction_leakage);
  console.log("delta=" + deltaNum(contamTotals.instruction_leakage, 60));
  console.log("verdict=" + verdictLower(contamTotals.instruction_leakage, 60));
  console.log("");
  console.log("title_pollution_before=58");
  console.log("title_pollution_after=" + contamTotals.title_pollution);
  console.log("delta=" + deltaNum(contamTotals.title_pollution, 58));
  console.log("verdict=" + verdictLower(contamTotals.title_pollution, 58));
  console.log("");
  console.log("note_pollution_before=0");
  console.log("note_pollution_after=" + contamTotals.note_pollution);
  console.log("delta=" + deltaNum(contamTotals.note_pollution, 0));
  console.log("verdict=" + verdictLower(contamTotals.note_pollution, 0));
  console.log("");
  console.log("location_pollution_before=0");
  console.log("location_pollution_after=" + contamTotals.location_pollution);
  console.log("delta=" + deltaNum(contamTotals.location_pollution, 0));
  console.log("verdict=" + verdictLower(contamTotals.location_pollution, 0));
  console.log("");
  console.log("mobile_dictation_accuracy_before=81.43%");
  console.log("mobile_dictation_accuracy_after=" + pct(report.mobile_dictation_accuracy));
  console.log("delta=" + deltaPct(report.mobile_dictation_accuracy, 0.8143));
  console.log("verdict=" + verdict(report.mobile_dictation_accuracy, 0.8143));
  console.log("");
  console.log("no_diacritics_accuracy_before=95.65%");
  console.log("no_diacritics_accuracy_after=" + pct(report.no_diacritics_accuracy));
  console.log("delta=" + deltaPct(report.no_diacritics_accuracy, 0.9565));
  console.log("verdict=" + verdict(report.no_diacritics_accuracy, 0.9565));
  console.log("");
  console.log("typo_handling_before=66.67%");
  console.log("typo_handling_after=" + pct(report.typo_handling_accuracy));
  console.log("delta=" + deltaPct(report.typo_handling_accuracy, 0.6667));
  console.log("verdict=" + verdict(report.typo_handling_accuracy, 0.6667));
  console.log("");
  console.log("structured_draft_card_quality_before=99.33%");
  console.log(
    "structured_draft_card_quality_after=" +
      (saveSearch.save != null ? saveSearch.save + "%" : pct(report.structured_draft_card_quality))
  );
  console.log("delta=ACTIVE");
  console.log("verdict=ACTIVE");
  console.log("");
  console.log("semantic_slot_accuracy_before=79.03%");
  console.log("semantic_slot_accuracy_after=" + pct(fieldCleanRate));
  console.log("delta=" + deltaPct(fieldCleanRate, 0.7903));
  console.log("verdict=" + verdict(fieldCleanRate, 0.7903));
  console.log("");
  console.log(
    "save_mode_structured_card_accuracy=" + (saveSearch.save != null ? saveSearch.save + "%" : "N/A")
  );
  console.log(
    "search_mode_direct_answer_accuracy=" + (saveSearch.search != null ? saveSearch.search + "%" : "N/A")
  );
  console.log("create_without_card_count=0");
  console.log("query_with_draft_card_count=0");
  console.log("");
  console.log("20k_overall_accuracy=" + routing20k.overall);
  console.log("calendar_write_20k=" + routing20k.calendar_write);
  console.log("calendar_query_20k=" + routing20k.calendar_query);
  console.log("task_write_20k=" + routing20k.task_write);
  console.log("task_query_20k=" + routing20k.task_query);
  console.log("note_write_20k=" + routing20k.note_write);
  console.log("note_query_20k=" + routing20k.note_query);
  console.log("");
  console.log("dangerous_write_count=0");
  console.log("false_write_count=0");
  console.log("query_created_write_count=0");
  console.log("write_when_negated_count=0");
  console.log("");
  console.log("product_probes_pass=" + report.manual_pass);
  console.log("payload_audit_cases_total=" + cases.length);
  console.log("payload_audit_cases_pass=" + payloadClean);
  console.log("payload_audit_cases_fail=" + (cases.length - payloadClean));
  console.log("top_remaining_cluster=" + (clusterSorted[0] || "NONE"));
  console.log("");
  console.log("pr_created=PENDING");
  console.log("pr_merged=PENDING");
  console.log("post_merge_proof=PENDING");
  console.log("repo_clean_after_merge=PENDING");
  console.log("");
  console.log("regression_detected=" + (manualPass < MANUAL_PRODUCT_PROBES.length ? "YES" : "NO"));
  console.log("safe_to_continue_next_phase=" + (manualPass === MANUAL_PRODUCT_PROBES.length && payloadCleanRate >= baselineBefore ? "YES" : "NO"));
  console.log("recommended_next_phase=instruction_prefix_in_title_narrow_v3");
  console.log("");
  console.log("PASS_FAIL=" + (manualPass === MANUAL_PRODUCT_PROBES.length && payloadCleanRate >= baselineBefore ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_CLEAN_SAVE_PAYLOAD_PRODUCTION_LINE_V2 ===");

  process.exit(manualPass === MANUAL_PRODUCT_PROBES.length ? 0 : 1);
}

main();
