/**
 * SILVER_NORMALIZER_TITLE_CLEANING_V1 — shared corpus, probes, replay governance.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./rhc-v3-deterministic-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const fieldShared = require("./silver-normalizer-field-ownership-v1-shared.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPO = path.resolve(__dirname, "..");

const AUDIT_FAMILIES = [
  "title_pollution_cleanup",
  "conversational_residue_cleanup",
  "mobile_filler_cleanup",
  "wrapper_contamination_cleanup",
  "payload_cleanliness_checks",
  "dirty_czech_title_cleanup",
  "colloquial_noise_cleanup",
  "conversational_tail_cleanup",
  "save_payload_cleanliness",
  "note_payload_cleanup",
  "task_payload_cleanup",
  "calendar_payload_cleanup",
  "semantic_preservation_checks",
  "cleanup_without_semantic_loss",
  "cleanup_vs_overtrim",
  "filler_vs_meaning_boundary",
  "assistant_wrapper_cleanup",
  "spoken_czech_cleanup",
  "chaos_mobile_cleanup",
  "long_conversation_residue_cleanup",
];

const FILLER_TOKENS = [
  "hele",
  "tyjo",
  "prosimte",
  "prosím tě",
  "btw",
  "ehm",
  "no tak",
  "jakoby",
  "vlastně",
  "jo",
  "dik",
  "díky",
  "pls",
  "jako",
  "no",
  "hm",
  "aha",
  "jojo",
  "okej",
  "ok",
  "víš co",
  "počkej",
  "moment",
  "čau",
  "zdar",
];

const TIER_A_REPLAY_PACK = [
  {
    id: "REPLAY_TC01",
    tier: "A",
    family: "conversational_residue_cleanup",
    input: "hele prosím tě zítra schůzka s Kubou jo díky",
    group: "calendar_write",
    intent: "calendar.create",
    titleNeed: ["kub", "schůz"],
    titleLacks: ["hele", "prosím", "díky", "jo"],
    locOptional: true,
  },
  {
    id: "REPLAY_TC02",
    tier: "A",
    family: "note_payload_cleanup",
    input: "tyjo prosimte napis poznamku ze smlouva je na stole dik",
    group: "note_write",
    intent: "notes.create",
    bodyNeed: ["smlouv", "stole"],
    bodyLacks: ["tyjo", "prosim", "dik", "napiš pozn"],
  },
  {
    id: "REPLAY_TC03",
    tier: "A",
    family: "task_payload_cleanup",
    input: "ehm zavolat účetní jo",
    group: "task_write",
    intent: "tasks.create",
    titleNeed: ["účet", "zavol"],
    titleLacks: ["ehm", "jo", "zítra"],
  },
  {
    id: "REPLAY_TC04",
    tier: "A",
    family: "title_pollution_cleanup",
    input: "no tak přidej schůzku s Petrem",
    group: "calendar_write",
    intent: "calendar.create",
    titleNeed: ["petr", "schůz"],
    titleLacks: ["no tak", "přidej"],
  },
  {
    id: "REPLAY_TC05",
    tier: "A",
    family: "note_payload_cleanup",
    input: "hele btw uloz do poznámek heslo wifi je abc",
    group: "note_write",
    intent: "notes.create",
    bodyNeed: ["wifi", "heslo"],
    bodyLacks: ["hele", "btw", "uloz"],
  },
  {
    id: "REPLAY_TC06",
    tier: "A",
    family: "task_payload_cleanup",
    input: "prosím tě mohl bys uložit úkol zavolat doktorovi díky",
    group: "task_write",
    intent: "tasks.create",
    titleNeed: ["doktor", "zavol"],
    titleLacks: ["prosím", "mohl", "díky", "uložit úkol"],
  },
  {
    id: "REPLAY_TC07",
    tier: "A",
    family: "semantic_preservation_checks",
    input: "zítra v 10 schůzka s Kubou v Praze",
    group: "calendar_write",
    intent: "calendar.create",
    titleNeed: ["kub", "schůz"],
    titleLacks: ["zítra", "praha", "10"],
    locNeed: ["praha"],
    metaDate: "certain",
    metaTime: "certain",
  },
];

const ENTITIES = {
  person: ["Kubou", "Petrem", "Pavlem", "Martinou", "Novotným"],
  date: ["dnes", "zítra", "ve čtvrtek", "v pátek"],
  time: ["9:00", "10:00", "15:00", "odpoledne"],
  place: ["Praze", "Brně", "Ostravě", "Anděla"],
  task: ["zavolat účetní", "koupit mléko", "poslat email", "zavolat doktorovi"],
  note: ["smlouva je na stole", "heslo wifi je abc", "PIN ke kartě"],
  filler: ["hele", "tyjo", "ehm", "no tak", "btw", "prosimte"],
  tail: ["jo díky", "dik", "no jo", "pls"],
};

function buildFamilyTemplates() {
  return {
    title_pollution_cleanup: [
      "{filler} prosím tě {date} schůzka s {person} {tail}",
      "no tak přidej schůzku s {person}",
      "{filler} ulož mi {date} poradu s {person}",
    ],
    conversational_residue_cleanup: [
      "{filler} prosím tě {date} schůzka s {person} {tail}",
      "ehm {date} v {time} zavolat {person} jo",
      "víš co {filler} připomeň mi {task} {tail}",
    ],
    mobile_filler_cleanup: [
      "jo hele {filler} ulož mi schůzku s {person} {date} no",
      "teda {filler} přidej {date} schůzku s {person} prosím",
    ],
    wrapper_contamination_cleanup: [
      "prosím tě mohl bys uložit úkol {task} díky",
      "jenom mi připomeň {task} {date}",
      "chci si uložit schůzku s {person}",
    ],
    payload_cleanliness_checks: [
      "Ulož mi {date} schůzku s {person} v {time} v {place}",
      "Do poznámky napiš {note}",
    ],
    dirty_czech_title_cleanup: [
      "uloz mi do kalendare zejtra schuzku s {person}",
      "pridej ukol {task} zejtra rano",
      "hele prosimte napis poznamku ze {note}",
    ],
    colloquial_noise_cleanup: [
      "{filler} {filler} přidej schůzku s {person} {tail}",
      "no jo {filler} dej mi do kalendáře {date} schůzku s {person}",
    ],
    conversational_tail_cleanup: [
      "přidej schůzku s {person} {tail}",
      "ulož mi úkol {task} {tail}",
      "napiš do poznámek {note} {tail}",
    ],
    save_payload_cleanliness: [
      "Ulož mi schůzku s {person} {date} v {time} a připomeň mi ať si vezmu deštník",
      "Hoď mi do kalendáře {date} schůzku s {person} v {place}",
    ],
    note_payload_cleanup: [
      "{filler} uloz do poznamek {note}",
      "tyjo prosimte napis poznamku ze {note} dik",
      "hele btw uloz do poznamek {note}",
    ],
    task_payload_cleanup: [
      "{filler} {date} v {time} {task} jo",
      "prosim te mohl bys ulozit ukol {task} diky",
      "ehm připomeň mi {task} {tail}",
    ],
    calendar_payload_cleanup: [
      "{date} v {time} schůzka s {person} v {place}",
      "{filler} {date} schůzka s {person} v {place} {tail}",
      "zitra v 10 schuzka s {person} v {place}",
    ],
    semantic_preservation_checks: [
      "{date} v {time} schůzka s {person} v {place}",
      "schůzka s {person} {date} v {time} v {place}",
    ],
    cleanup_without_semantic_loss: [
      "{filler} {date} v {time} schůzka s {person} v {place} {tail}",
      "hele prosím tě ulož mi poradu s {person} {date} v {place}",
    ],
    cleanup_vs_overtrim: [
      "Přidej schůzku s klientem v Brně zítra v 15",
      "Ulož poradu v Praze a připomeň mi vzít notebook",
    ],
    filler_vs_meaning_boundary: [
      "schůzka s {person} v {place}",
      "úkol {task}",
      "poznámka {note}",
    ],
    assistant_wrapper_cleanup: [
      "Silver prosím ulož schůzku s {person}",
      "hele Silvere přidej {task}",
    ],
    spoken_czech_cleanup: [
      "{filler} no tak {filler} {date} schůzku s {person} jo",
      "tyjo prosimte {task} {tail}",
    ],
    chaos_mobile_cleanup: [
      "jo hele {filler} uloz mi schuzku s {person} {date} v {time} no dik",
      "teda ee {filler} pridej ukol {task} zejtra rano pls",
    ],
    long_conversation_residue_cleanup: [
      "no jo hele vlastně {filler} prosím tě {date} schůzka s {person} v {place} jo díky",
      "ee teda {filler} můžeš silver ulož mi {task} {tail}",
    ],
  };
}

function groupForFamily(family) {
  if (family.indexOf("note") >= 0) return "note_write";
  if (family.indexOf("task") >= 0) return "task_write";
  return "calendar_write";
}

function draftField(turn, name) {
  return validator.draftField(turn, name);
}

function hasFillerLeak(text, lacks) {
  const fold = foldCs(String(text || ""));
  if (!fold) return false;
  for (let i = 0; i < (lacks || []).length; i++) {
    const w = foldCs(lacks[i]);
    if (w && fold.indexOf(w) >= 0) return true;
  }
  return false;
}

function evalProbe(turn, p) {
  const reasons = [];
  if (p.intent && turn.normalizedIntent !== p.intent) reasons.push("intent:" + turn.normalizedIntent);
  const title = foldCs(draftField(turn, "title"));
  const body = foldCs(draftField(turn, "body"));
  const note = foldCs(draftField(turn, "note"));
  const loc = foldCs(draftField(turn, "location"));
  const payload = body || note;

  if (p.titleNeed) {
    for (let i = 0; i < p.titleNeed.length; i++) {
      if (title.indexOf(foldCs(p.titleNeed[i])) < 0) reasons.push("title_need:" + p.titleNeed[i]);
    }
  }
  if (p.titleLacks) {
    for (let i = 0; i < p.titleLacks.length; i++) {
      if (title.indexOf(foldCs(p.titleLacks[i])) >= 0) reasons.push("title_lacks:" + p.titleLacks[i]);
    }
  }
  if (p.bodyNeed) {
    for (let i = 0; i < p.bodyNeed.length; i++) {
      if (payload.indexOf(foldCs(p.bodyNeed[i])) < 0) reasons.push("body_need:" + p.bodyNeed[i]);
    }
  }
  if (p.bodyLacks) {
    for (let i = 0; i < p.bodyLacks.length; i++) {
      if (payload.indexOf(foldCs(p.bodyLacks[i])) >= 0) reasons.push("body_lacks:" + p.bodyLacks[i]);
    }
  }
  if (p.locNeed) {
    for (let i = 0; i < p.locNeed.length; i++) {
      if (loc.indexOf(foldCs(p.locNeed[i])) < 0) reasons.push("loc_need:" + p.locNeed[i]);
    }
  }
  if (p.metaDate && turn.draft && turn.draft.meta && turn.draft.meta.date !== p.metaDate) {
    reasons.push("meta_date");
  }
  if (p.metaTime && turn.draft && turn.draft.meta && turn.draft.meta.time !== p.metaTime) {
    reasons.push("meta_time");
  }
  if (title && payloadCore.hasInstructionLeakage(draftField(turn, "title"))) {
    reasons.push("wrapper_in_title");
  }
  const pv = validator.validateCleanPayload(turn, p.input);
  if (!pv.pass) {
    const tv = (pv.violations || []).filter(function (v) {
      return v.indexOf("title") >= 0 || v.indexOf("instruction") >= 0 || v.indexOf("note") >= 0;
    });
    if (tv.length) reasons.push("validator:" + tv.join(","));
  }
  return { pass: reasons.length === 0, reasons, title: draftField(turn, "title"), body: payload };
}

function hasLeadingFillerLeak(text) {
  const fold = foldCs(String(text || "").trim());
  if (!fold) return false;
  return /^(hele|tyjo|prosimte|prosim|prosím|ehm|no tak|btw|pls|hm|aha|jojo|okej|jo|no|vlastne|vlastně|jakoby)\b/.test(fold);
}

function evalGeneratedCase(turn, c) {
  const reasons = [];
  const intent = String(turn.normalizedIntent || "");
  if (c.replay) {
    if (intent.indexOf(".create") < 0) reasons.push("intent");
  } else if (intent === "create.storage_disambiguation") {
    if (c.family === "note_payload_cleanup" || c.family === "payload_cleanliness_checks") {
      reasons.push("storage_disambiguation");
    }
  }

  const title = draftField(turn, "title");
  const body = draftField(turn, "body");
  const note = draftField(turn, "note");
  const payload = body || note;

  if (intent.indexOf(".create") >= 0) {
    if (title && payloadCore.hasInstructionLeakage(title)) reasons.push("title_wrapper");
    if (title && hasLeadingFillerLeak(title)) reasons.push("title_filler");
    if (payload && hasLeadingFillerLeak(payload)) reasons.push("payload_filler");
  }

  if (c.family === "semantic_preservation_checks" || c.family === "cleanup_without_semantic_loss") {
    const loc = foldCs(draftField(turn, "location"));
    if (c.input.indexOf("Praze") >= 0 || c.input.indexOf("praze") >= 0) {
      if (loc.indexOf("praha") < 0 && loc.indexOf("praze") < 0) reasons.push("semantic_loc_loss");
    }
    if (/\bv\s+10\b/i.test(c.input) && turn.draft && turn.draft.meta && turn.draft.meta.time !== "certain") {
      reasons.push("semantic_time_loss");
    }
  }

  if (c.family === "cleanup_vs_overtrim" || c.family === "filler_vs_meaning_boundary") {
    const foldT = foldCs(title);
    const foldP = foldCs(payload);
    if (intent.indexOf(".create") >= 0 && !foldT && !foldP) reasons.push("overtrim_empty");
    if (intent.indexOf(".create") >= 0 && foldT && foldT.length < 3 && c.input.length > 20) reasons.push("overtrim_short");
  }

  if (intent.indexOf(".create") >= 0) {
    const pv = validator.validateCleanPayload(turn, c.input);
    if (!pv.pass) {
      const tv = (pv.violations || []).filter(function (v) {
        return v.indexOf("title") >= 0 || v.indexOf("instruction") >= 0;
      });
      if (tv.length) reasons.push("payload:" + tv[0]);
    }
  }

  return { pass: reasons.length === 0, reasons };
}

function buildCorpusV1(targetCases) {
  const templates = buildFamilyTemplates();
  const rawCases = [];
  const perFamily = Math.max(8, Math.ceil(targetCases / AUDIT_FAMILIES.length));
  for (let fi = 0; fi < AUDIT_FAMILIES.length; fi++) {
    const family = AUDIT_FAMILIES[fi];
    const tpls = templates[family] || ["test {person}"];
    const baseSeed = ((family.length * 982451653) ^ 0x5449544c) >>> 0;
    for (let i = 0; i < perFamily; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = String(tpls[i % tpls.length] || "")
        .replace(/\{([a-z_]+)\}/g, function (_, key) {
          const pool = ENTITIES[key] || [key];
          return core.pickFrom(rng, pool);
        });
      const mask = core.deriveMutationMask(family, i, baseSeed);
      input = core.applyMutationLayers(input, mask, rng);
      rawCases.push({
        id: family + "_" + String(i).padStart(4, "0"),
        family,
        input,
        group: groupForFamily(family),
      });
    }
  }
  for (let ri = 0; ri < TIER_A_REPLAY_PACK.length; ri++) {
    rawCases.push(Object.assign({ replay: true, tier: "A" }, TIER_A_REPLAY_PACK[ri]));
  }
  const filtered = antiDup.filterUniqueCases(rawCases);
  const cases = filtered.accepted.slice();
  for (let ri = 0; ri < TIER_A_REPLAY_PACK.length; ri++) {
    const r = TIER_A_REPLAY_PACK[ri];
    if (!cases.some(function (c) {
      return c.id === r.id;
    })) {
      cases.push(Object.assign({ replay: true, tier: "A" }, r));
    }
  }
  return cases;
}

function mainCommit() {
  try {
    return require("child_process").execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function runTitleCleaningAudit(opts) {
  const options = opts || {};
  const harnessId = options.harnessId || "silver_normalizer_title_cleaning_v1";
  const targetCases = parseInt(process.env.SNTC_CASES || options.targetCases || "800", 10);
  const minAccuracy = parseFloat(process.env.SNTC_MIN_ACCURACY || options.minAccuracy || "0.93", 10);
  const familyFilter = options.familyFilter || null;
  const reportPath = path.join(__dirname, options.reportFile || "silver-normalizer-title-cleaning-v1-report.json");

  const eng = loadEngine();
  let cases = buildCorpusV1(targetCases);
  if (familyFilter && familyFilter.length) {
    cases = cases.filter(function (c) {
      return familyFilter.indexOf(c.family) >= 0 || c.replay;
    });
  }

  let pass = 0;
  let tierAPass = 0;
  let tierATotal = 0;
  const fails = [];
  const familyStats = {};

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    let ev;
    if (c.replay || c.titleNeed || c.bodyNeed) {
      ev = evalProbe(turn, c);
      if (c.tier === "A") {
        tierATotal++;
        if (ev.pass) tierAPass++;
      }
    } else {
      ev = evalGeneratedCase(turn, c);
    }
    if (!familyStats[c.family]) familyStats[c.family] = { pass: 0, total: 0 };
    familyStats[c.family].total++;
    if (ev.pass) {
      pass++;
      familyStats[c.family].pass++;
    } else {
      fails.push({ id: c.id, family: c.family, input: c.input, reasons: ev.reasons, title: ev.title });
    }
  }

  const titlePack = fieldShared.runTitlePack(eng);
  const accuracy = cases.length ? pass / cases.length : 1;
  const report = {
    harness_id: harnessId,
    main_commit: mainCommit(),
    audit_families: AUDIT_FAMILIES,
    generated_cases: cases.length,
    mobile_cases: cases.filter(function (c) {
      return c.family.indexOf("mobile") >= 0 || c.family.indexOf("chaos") >= 0;
    }).length,
    dirty_czech_cases: cases.filter(function (c) {
      return c.family.indexOf("dirty") >= 0 || c.family.indexOf("spoken") >= 0;
    }).length,
    spoken_cases: cases.filter(function (c) {
      return c.family.indexOf("spoken") >= 0 || c.family.indexOf("conversational") >= 0;
    }).length,
    filler_cases: cases.filter(function (c) {
      return c.family.indexOf("filler") >= 0 || c.family.indexOf("colloquial") >= 0;
    }).length,
    wrapper_cases: cases.filter(function (c) {
      return c.family.indexOf("wrapper") >= 0 || c.family.indexOf("assistant") >= 0;
    }).length,
    chaos_cases: cases.filter(function (c) {
      return c.family.indexOf("chaos") >= 0 || c.family.indexOf("mobile") >= 0;
    }).length,
    accuracy,
    tier_a_pass: tierAPass,
    tier_a_total: tierATotal,
    title_cleanup_accuracy: titlePack.accuracy,
    real_ux_pass: titlePack.pass + "/" + titlePack.total,
    family_stats: familyStats,
    fails: fails.slice(0, 40),
    replay_guards_added: TIER_A_REPLAY_PACK.length,
    cleanup_rules_added: FILLER_TOKENS.length,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const ok = accuracy >= minAccuracy && titlePack.accuracy >= minAccuracy && tierAPass === tierATotal;

  return { ok, report, accuracy, titlePack, fails };
}

function printBanner(prefix, res) {
  const rep = res.report;
  console.log("=== " + prefix + " ===");
  console.log("generated_cases=" + rep.generated_cases);
  console.log("accuracy=" + (rep.accuracy * 100).toFixed(2) + "%");
  console.log("title_cleanup_accuracy=" + (rep.title_cleanup_accuracy * 100).toFixed(2) + "%");
  console.log("tier_a_pass=" + rep.tier_a_pass + "/" + rep.tier_a_total);
  console.log("real_ux_pass=" + rep.real_ux_pass);
  console.log("fail_count=" + (rep.fails || []).length);
  console.log("PASS_FAIL=" + (res.ok ? "PASS" : "FAIL"));
  console.log("=== END_" + prefix + " ===");
}

const GUARD_FAMILY_MAP = {
  title_cleaning: ["title_pollution_cleanup", "conversational_tail_cleanup"],
  conversational_residue: ["conversational_residue_cleanup", "conversational_tail_cleanup", "colloquial_noise_cleanup"],
  mobile_chaos: ["mobile_filler_cleanup", "chaos_mobile_cleanup", "spoken_czech_cleanup"],
  wrapper: ["wrapper_contamination_cleanup", "assistant_wrapper_cleanup"],
  semantic_preservation: ["semantic_preservation_checks", "cleanup_without_semantic_loss"],
  no_overtrim: ["cleanup_vs_overtrim", "filler_vs_meaning_boundary"],
  field_cleanup_isolation: ["calendar_payload_cleanup", "task_payload_cleanup", "note_payload_cleanup"],
  payload_cleanliness: ["payload_cleanliness_checks", "save_payload_cleanliness"],
  dirty_czech: ["dirty_czech_title_cleanup", "spoken_czech_cleanup"],
  long_conversation: ["long_conversation_residue_cleanup", "conversational_residue_cleanup"],
};

const GUARD_MIN_ACCURACY = {
  wrapper: 0.91,
  default: 0.93,
};

function runGuard(guardKey, harnessId, reportFile) {
  const families = GUARD_FAMILY_MAP[guardKey] || AUDIT_FAMILIES;
  const minAcc = GUARD_MIN_ACCURACY[guardKey] || GUARD_MIN_ACCURACY.default;
  const res = runTitleCleaningAudit({
    harnessId,
    reportFile,
    familyFilter: families,
    minAccuracy: parseFloat(process.env.SNTC_MIN_ACCURACY || String(minAcc), 10),
  });
  printBanner(harnessId.toUpperCase(), res);
  return res.ok ? 0 : 1;
}

module.exports = {
  AUDIT_FAMILIES,
  FILLER_TOKENS,
  TIER_A_REPLAY_PACK,
  buildCorpusV1,
  runTitleCleaningAudit,
  runGuard,
  printBanner,
  GUARD_FAMILY_MAP,
  evalProbe,
};
