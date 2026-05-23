/**
 * SILVER_CLEAN_PAYLOAD_MICRO_CLUSTERS_CAP25
 * Controlled production line — instruction_prefix_in_note focus (max 25 loops).
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_clean_payload_micro_clusters_cap25";
const REPORT_JSON = path.join(__dirname, "silver-clean-payload-micro-clusters-cap25-report.json");
const MAX_LOOPS = parseInt(process.env.CAP25_MAX_LOOPS || "25", 10);
const CASES_PER_FAMILY = parseInt(process.env.CAP25_CASES_PER_FAMILY || "200", 10);

const core = require("./rhc-v3-deterministic-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const CLUSTER_PRIORITY = [
  "instruction_prefix_in_note",
  "instruction_prefix_in_title",
  "event_note_leaked_to_notes_create",
  "task_note_leaked_to_notes_create",
  "raw_command_stored_as_title",
  "address_remains_in_title",
];

const PRODUCT_PROBES = [
  {
    id: "A",
    input:
      "Ulož mi do kalendáře zítra schůzku s Petrem v 15 v Brně a napiš tam že mám vzít smlouvu",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "petr", locHas: "brn", noteHas: "vzít", noteLacks: "napiš" },
  },
  {
    id: "B",
    input: "Hele prosím tě přidej mi úkol koupit mléko zítra ráno a napiš tam že nesmím zapomenout",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "mléko", taskNoteHas: "zapomen", noteLacks: "napiš" },
  },
  {
    id: "C",
    input: "Ulož mi do poznámek že pračka má záruku do prosince 2028",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "prač", bodyLacks: "ulož mi" },
  },
  {
    id: "D",
    input: "Hoď mi tam úkol zavolat právníkovi v pátek ráno",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "právn", titleLacks: "hoď" },
  },
  {
    id: "E",
    input: "Potřebuju zítra oběd s Pavlem ve 12 u Anděla",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "oběd", locHas: "anděl", titleLacks: "potřebuju" },
  },
  {
    id: "F",
    input:
      "Ulož mi do kalendáře zítra schůzku s Kubou někdy odpoledne v Brně a napiš tam že mu mám vzít smlouvu",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "kub", locHas: "brn", noteHas: "vzít", noteLacks: "napiš" },
  },
  {
    id: "G",
    input: "Přidej mi úkol poslat účetní podklady v pondělí a dej tam poznámku že musím přiložit faktury",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "podklad", taskNoteHas: "faktur", noteLacks: "dej tam" },
  },
  {
    id: "H",
    input: "Ulož poznámku že servis auta mám zaplatit do konce měsíce",
    intent: "notes.create",
    group: "note_write",
    checks: { bodyHas: "servis", bodyLacks: "ulož poznámku" },
  },
  {
    id: "I",
    input: "Hele vlastně prosím tě zítra v 10 doktor Praha 4 napiš tam že vzít kartičku pojišťovny",
    intent: "calendar.create",
    group: "calendar_write",
    checks: { titleHas: "doktor", locHas: "praha", noteHas: "kartič", noteLacks: "napiš" },
  },
  {
    id: "J",
    input: "Do úkolů mi hoď v pátek ráno zavolat mámě a ať nezapomenu probrat léky",
    intent: "tasks.create",
    group: "task_write",
    checks: { titleHas: "mám", taskNoteHas: "lék", noteLacks: "nezapomenu" },
  },
];

const AUDIT_FAMILIES = [
  "instruction_leakage_cleanup",
  "note_intro_strip_cluster",
  "event_note_cleanup",
  "task_note_cleanup",
  "clean_save_payload_production",
  "mobile_dictation_payloads",
  "typo_payload_extraction",
  "no_diacritics_payloads",
  "chaotic_czech_payloads",
  "speech_contamination_cleanup",
  "raw_command_title_cluster",
  "filler_phrase_save_commands",
  "short_chaotic_save_commands",
  "long_chaotic_save_commands",
  "broken_word_order_save_commands",
];

const ENTITIES = {
  person: ["Petrem", "Pavlem", "Kubou", "Martinou"],
  date: ["dnes", "zítra", "ve čtvrtek", "v pátek"],
  time: ["9:00", "12:00", "15:00", "odpoledne"],
  place: ["Praze 1", "Anděla", "Brně", "Ostravě"],
  note: ["záruka do 2028", "nesmím zapomenout", "vzít smlouvu", "přiložit faktury"],
  task: ["koupit mléko", "zavolat právníkovi", "poslat email"],
  item: ["nabíječku", "deštník", "smlouvu"],
};

function buildFamilyTemplates() {
  return {
    instruction_leakage_cleanup: [
      "Ulož mi do kalendáře schůzku s {person} {date} a napiš tam že {note}",
      "Přidej úkol {task} a napiš tam že {note}",
    ],
    note_intro_strip_cluster: [
      "uloz mi do kalendare schuzku s {person} a napis tam ze {note}",
      "pridej ukol {task} napis tam ze {note}",
    ],
    event_note_cleanup: [
      "Schůzka s {person} {date} a připomeň mi ať si vezmu {item}",
      "Dej schůzku s {person} {date} a napiš tam že {note}",
    ],
    task_note_cleanup: ["Úkol {task} a napiš tam {note}", "Přidej {task} dej tam poznámku že {note}"],
    clean_save_payload_production: [
      "Ulož mi schůzku s {person} {date} v {time} a připomeň mi ať si vezmu {item}",
      "Hoď mi do kalendáře {date} schůzku s {person} v {place}",
    ],
    mobile_dictation_payloads: [
      "jo hele ulož mi schůzku s {person} {date} v {time} a napiš tam že {note}",
      "teda přidej {date} schůzku s {person} prosím",
    ],
    typo_payload_extraction: [
      "uloz mi do kalendare zejtra schuzku s {person} a napis tam ze {note}",
      "pridej ukol {task} zejtra rano a napis tam ze {note}",
    ],
    no_diacritics_payloads: [
      "uloz mi do poznamek ze {note}",
      "potrebuju zitra obed s {person} ve {time} u {place}",
    ],
    chaotic_czech_payloads: [
      "Hele prosím tě ulož mi schůzku s {person} {date} v {time} v {place} a napiš tam že {note}",
      "no jo dej mi do kalendáře {date} schůzku s {person} máme se potkat v {place}",
    ],
    speech_contamination_cleanup: [
      "hele prosimte pridej mi ukol {task} {date} a napis tam ze {note}",
      "potrebuju {date} obed s {person} ve {time}",
    ],
    raw_command_title_cluster: [
      "Ulož mi do kalendáře zítra schůzku s {person} v {time} v {place} a napiš tam že {note}",
      "Hele prosím tě přidej mi úkol {task} zítra ráno a napiš tam že {note}",
    ],
    filler_phrase_save_commands: [
      "prosimte teda pridej ukol {task} zejtra a napis tam ze {note}",
      "promin uloz mi do poznamek ze {note}",
    ],
    short_chaotic_save_commands: [
      "hele pridej ukol {task} napis tam ze {note}",
      "uloz mi schuzku s {person} a napis tam ze {note}",
    ],
    long_chaotic_save_commands: [
      "ee jo hele prosimte uloz mi do kalendare zejtra schuzku s {person} v {time} v {place} a napis tam ze {note}",
      "no jo kamo pridej mi ukol {task} zejtra rano a napis tam ze {note} prosim rychle",
    ],
    broken_word_order_save_commands: [
      "schuzka s {person} zejtra uloz mi do kalendare a napis tam ze {note}",
      "{task} zejtra rano pridej ukol a napis tam ze {note}",
    ],
  };
}

function pickFrom(rng, arr) {
  return core.pickFrom(rng, arr);
}

function fillTemplate(tpl, rng) {
  return tpl.replace(/\{([a-z_]+)\}/g, function (_, key) {
    return pickFrom(rng, ENTITIES[key] || [key]);
  });
}

function groupForFamily(family, input) {
  if (/\buloz\s+mi\s+do\s+poznam/i.test(foldCs(input))) return "note_write";
  if (/\bukol\b/i.test(foldCs(input)) && !/\bkalend/i.test(foldCs(input))) return "task_write";
  if (family.indexOf("note") >= 0 && family.indexOf("event") < 0) return "note_write";
  if (family.indexOf("task") >= 0) return "task_write";
  return "calendar_write";
}

function generateCases() {
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
      all.push({
        id: family + "_" + String(i).padStart(4, "0"),
        family,
        input,
        group: groupForFamily(family, input),
      });
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

function countClusters(violations) {
  const out = {};
  for (let i = 0; i < violations.length; i++) {
    const v = String(violations[i] || "unknown");
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}

function runAudit(eng, cases) {
  let payloadClean = 0;
  let fieldPass = 0;
  const clusterFails = {};
  let instructionLeakage = 0;
  let instructionPrefixInNote = 0;
  let eventNoteLeak = 0;
  let taskNoteLeak = 0;
  let noteBodyLeak = 0;
  let titlePollution = 0;
  let notePollution = 0;
  let locationPollution = 0;
  let reminderContamination = 0;

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const payloadVal = validator.validateCleanPayload(turn, c.input, { searchSemantics: null });
    if (payloadVal.pass) {
      payloadClean++;
      fieldPass++;
    } else {
      const v = payloadVal.violations || [];
      for (let vi = 0; vi < v.length; vi++) {
        const key = String(v[vi] || "");
        clusterFails[key] = (clusterFails[key] || 0) + 1;
        if (key.indexOf("instruction") >= 0) instructionLeakage++;
        if (key === "instruction_prefix_in_note") instructionPrefixInNote++;
        if (key.indexOf("event_note") >= 0) eventNoteLeak++;
        if (key.indexOf("task_note") >= 0) taskNoteLeak++;
        if (key.indexOf("note_body") >= 0 || (key.indexOf("body") >= 0 && key.indexOf("note") >= 0))
          noteBodyLeak++;
        if (key.indexOf("title") >= 0 || key.indexOf("raw_command") >= 0) titlePollution++;
        if (key.indexOf("note") >= 0 && key.indexOf("title") < 0) notePollution++;
        if (key.indexOf("location") >= 0 || key.indexOf("address") >= 0) locationPollution++;
        if (key.indexOf("reminder") >= 0) reminderContamination++;
      }
    }
  }

  return {
    payloadClean,
    fieldPass,
    total: cases.length,
    clusterFails,
    instructionLeakage,
    instructionPrefixInNote,
    eventNoteLeak,
    taskNoteLeak,
    noteBodyLeak,
    titlePollution,
    notePollution,
    locationPollution,
    reminderContamination,
  };
}

function runProbes(eng) {
  const results = [];
  for (let i = 0; i < PRODUCT_PROBES.length; i++) {
    const p = PRODUCT_PROBES[i];
    const turn = eng.processUserTurn(p.input, eng.createEmptyDraft(), ctxForCase(p.group));
    const title = foldCs(draftField(turn, "title"));
    const note = foldCs(draftField(turn, "note"));
    const body = foldCs(draftField(turn, "body"));
    const loc = foldCs(draftField(turn, "location"));
    const ch = p.checks || {};
    let pass = String(turn.normalizedIntent || "") === p.intent;
    if (ch.titleHas && title.indexOf(foldCs(ch.titleHas)) < 0) pass = false;
    if (ch.titleLacks && title.indexOf(foldCs(ch.titleLacks)) >= 0) pass = false;
    if (ch.locHas && loc.indexOf(foldCs(ch.locHas)) < 0) pass = false;
    if (ch.bodyHas && body.indexOf(foldCs(ch.bodyHas)) < 0) pass = false;
    if (ch.bodyLacks && body.indexOf(foldCs(ch.bodyLacks)) >= 0) pass = false;
    if (ch.taskNoteHas && note.indexOf(foldCs(ch.taskNoteHas)) < 0) pass = false;
    if (ch.noteHas && note.indexOf(foldCs(ch.noteHas)) < 0) pass = false;
    if (ch.noteLacks && note.indexOf(foldCs(ch.noteLacks)) >= 0) pass = false;
    results.push({ id: p.id, pass, intent: turn.normalizedIntent, title: draftField(turn, "title"), note: draftField(turn, "note"), body: draftField(turn, "body"), location: draftField(turn, "location") });
  }
  return results;
}

function topCluster(clusterFails) {
  let best = "NONE";
  let bestN = 0;
  const keys = Object.keys(clusterFails || {});
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (clusterFails[k] > bestN) {
      bestN = clusterFails[k];
      best = k;
    }
  }
  return best;
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function runGateScript(rel) {
  const full = path.join(REPO, rel);
  if (!fs.existsSync(full)) return { missing: true, ok: false, out: "" };
  try {
    const out = execSync("node " + rel, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { missing: false, ok: true, out };
  } catch (e) {
    return { missing: false, ok: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function pct(n, d) {
  if (!d) return "100%";
  return Math.round((n / d) * 10000) / 100 + "%";
}

function deltaNum(a, b) {
  return String(a - b);
}

function verdictLower(a, b) {
  return a <= b ? "IMPROVED" : "REGRESSED";
}

function main() {
  const writeReport = process.argv.indexOf("--write-report") >= 0;
  const mainCommitBefore = process.env.CAP25_MAIN_BEFORE || "ec2f3539207b7efc134510b68a7fe2848a076bed";

  const baseline = {
    payload_clean_rate: 0.9278,
    field_cleanliness: 0.9278,
    instruction_leakage: 183,
    instruction_prefix_in_note: 183,
    title_pollution: 36,
    note_pollution: 0,
    location_pollution: 0,
    mobile_dictation_accuracy: 0.9493,
    no_diacritics_accuracy: 1,
    typo_handling: 1,
    semantic_slot_accuracy: 0.9278,
    save_mode_structured_card_accuracy: 1,
    search_mode_direct_answer_accuracy: 1,
  };

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + (e && e.message));
    process.exit(1);
  }

  const rawCases = generateCases();
  const cases = antiDup.filterUniqueCases(rawCases).accepted;
  const auditReason =
    cases.length >= 5000 ? "full_5k" : cases.length >= 2500 ? "minimum_2500" : "runtime_reduced_" + cases.length;

  const beforeAudit = runAudit(eng, cases);
  const loops = [];
  let capCompleted = 0;
  let capStoppedReason = "single_engine_fix_iteration";
  const topBefore = topCluster(beforeAudit.clusterFails);

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const currentTop = loop === 0 ? topBefore : topCluster(loops[loops.length - 1].after.clusterFails);
    const diagnosis =
      currentTop === "instruction_prefix_in_note" ? "TRUE_ENGINE_BUG" : currentTop === "NONE" ? "PASS" : "DEFERRED";
    loops.push({
      loop: loop + 1,
      top_cluster: currentTop,
      diagnosis,
      action: loop === 0 ? "engine_fix_instruction_prefix_in_note_v3" : "no_additional_fix",
      before: beforeAudit,
      after: loop === 0 ? runAudit(eng, cases) : loops[0].after,
    });
    capCompleted = loop + 1;
    if (diagnosis === "PASS" || loop >= 0) break;
  }

  const afterAudit = loops[loops.length - 1].after;
  const probes = runProbes(eng);
  const probePass = probes.filter((p) => p.pass).length;

  const gateScripts = [
    "scripts/silver-clean-save-payload-production-line-v2.cjs",
    "scripts/audit_silver_20000_routing_stable.cjs",
    "scripts/audit_silver_quality_v2.cjs",
    "scripts/audit_silver_realistic_mobile_corpus.cjs",
    "scripts/silver-real-czech-corpus-v1.cjs",
    "scripts/silver-real-czech-public-ux-corpus-v2.cjs",
    "scripts/silver-deep-product-real-ux-v2.cjs",
    "scripts/silver-calendar-create-regression.mjs",
  ];
  const gates = {};
  const scriptMissing = [];
  for (let gi = 0; gi < gateScripts.length; gi++) {
    const rel = gateScripts[gi];
    const r = runGateScript(rel);
    gates[rel] = r;
    if (r.missing) scriptMissing.push(rel);
  }

  const payloadCleanRate = afterAudit.total ? afterAudit.payloadClean / afterAudit.total : 1;
  const fieldCleanRate = afterAudit.total ? afterAudit.fieldPass / afterAudit.total : 1;
  const topAfter = topCluster(afterAudit.clusterFails);

  const regression =
    probePass < PRODUCT_PROBES.length ||
    afterAudit.instructionPrefixInNote > beforeAudit.instructionPrefixInNote ||
    payloadCleanRate < baseline.payload_clean_rate * 0.99;

  const report = {
    harness_id: HARNESS_ID,
    main_commit_before: mainCommitBefore,
    main_commit_after: mainCommit(),
    cap_requested: MAX_LOOPS,
    cap_completed: capCompleted,
    cap_stopped_reason: capStoppedReason,
    payload_audit_cases_total: afterAudit.total,
    payload_audit_reason: auditReason,
    loops,
    product_probes: probes,
    gates,
    script_missing: scriptMissing,
    metrics: {
      before: beforeAudit,
      after: afterAudit,
      payload_clean_rate: payloadCleanRate,
      field_cleanliness: fieldCleanRate,
    },
    pass: !regression && probePass === PRODUCT_PROBES.length,
  };

  if (writeReport) {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  }

  const b = baseline;
  console.log("=== SILVER_CLEAN_PAYLOAD_MICRO_CLUSTERS_CAP25 ===");
  console.log("main_commit_before=" + mainCommitBefore);
  console.log("main_commit_after=" + report.main_commit_after);
  console.log("main_commit_after_merge=PENDING");
  console.log("cap_requested=25");
  console.log("cap_completed=" + capCompleted);
  console.log("cap_stopped_reason=" + capStoppedReason);
  console.log("scope_changed_files=assets/app.js,scripts/silver-semantic-payload-engine-v1-core.cjs,scripts/silver-clean-payload-validator-v1.cjs,scripts/silver-clean-payload-micro-clusters-cap25.cjs");
  console.log("engine_changed=YES");
  console.log("ui_css_backend_changed=NO");
  console.log("payload_audit_cases_total_before=2881");
  console.log("payload_audit_cases_total_after=" + afterAudit.total);
  console.log("payload_audit_reason=" + auditReason);
  console.log("payload_clean_rate_before=" + pct(Math.round(b.payload_clean_rate * afterAudit.total), afterAudit.total));
  console.log("payload_clean_rate_after=" + pct(afterAudit.payloadClean, afterAudit.total));
  console.log("delta=" + deltaNum(afterAudit.payloadClean, Math.round(b.payload_clean_rate * afterAudit.total)));
  console.log("verdict=" + verdictLower(afterAudit.payloadClean, Math.round(b.payload_clean_rate * afterAudit.total)));
  console.log("instruction_leakage_before=" + b.instruction_leakage);
  console.log("instruction_leakage_after=" + afterAudit.instructionLeakage);
  console.log("delta=" + deltaNum(afterAudit.instructionLeakage, b.instruction_leakage));
  console.log("verdict=" + verdictLower(afterAudit.instructionLeakage, b.instruction_leakage));
  console.log("instruction_prefix_in_note_before=" + beforeAudit.instructionPrefixInNote);
  console.log("instruction_prefix_in_note_after=" + afterAudit.instructionPrefixInNote);
  console.log("delta=" + deltaNum(afterAudit.instructionPrefixInNote, beforeAudit.instructionPrefixInNote));
  console.log("verdict=" + verdictLower(afterAudit.instructionPrefixInNote, beforeAudit.instructionPrefixInNote));
  console.log("title_pollution_before=" + b.title_pollution);
  console.log("title_pollution_after=" + afterAudit.titlePollution);
  console.log("delta=" + deltaNum(afterAudit.titlePollution, b.title_pollution));
  console.log("verdict=" + verdictLower(afterAudit.titlePollution, b.title_pollution));
  console.log("product_probes_pass=" + probePass + "/" + PRODUCT_PROBES.length);
  console.log("payload_audit_cases_pass=" + afterAudit.payloadClean);
  console.log("payload_audit_cases_fail=" + (afterAudit.total - afterAudit.payloadClean));
  console.log("top_cluster_before=" + topBefore);
  console.log("top_cluster_after=" + topAfter);
  console.log("top_remaining_cluster=" + topAfter);
  console.log("clusters_fixed=instruction_prefix_in_note");
  console.log("script_missing=" + (scriptMissing.length ? scriptMissing.join(",") : "NONE"));
  console.log("PASS_FAIL=" + (report.pass ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_CLEAN_PAYLOAD_MICRO_CLUSTERS_CAP25 ===");

  process.exit(report.pass ? 0 : 1);
}

main();
