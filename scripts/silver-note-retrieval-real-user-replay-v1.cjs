#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const shared = require("./silver-note-retrieval-platform-v1-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT = path.join(__dirname, "silver-note-retrieval-real-user-replay-report.json");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const REPLAY_EXTRA_NOTES = [
  { id: "nr_tatka_bday", title: "Táta narozeniny", content: "táta má narozeniny v říjnu" },
  { id: "nr_dvere_pin", title: "Dveře PIN", content: "PIN na dveře je 1234" }
];

const FAMILY_SPECS = {
  A: {
    name: "TOPIC_RETRIEVAL_AUTO",
    mode: "topic_list",
    canonical: [
      "Co mám o autě",
      "Co mám uložené o autě",
      "Co jsem si poznamenal o autě",
      "Mám něco o autě",
      "Najdi auto"
    ],
    metamorphic: ["Mám poznámku o autě", "Co vím o autě", "Ukaž poznámky o autě"],
    turnChain: ["Mám něco o autě?", "Ukaž mi detaily o autě"],
    expectRx: /auto|servis|oktav|modr|5\s*m/i,
    expectNotRx: /wifi|dver|katk|franta\s+zaloh|umyvadl/i
  },
  B: {
    name: "PERSON_RETRIEVAL_KATKA",
    mode: "topic_list",
    canonical: [
      "Co mám o Katce",
      "Mám něco o Katce",
      "Najdi Katku",
      "Co mám ke Katce"
    ],
    metamorphic: ["Mám v poznámkách něco o Katce?", "Ukaž poznámky o Katce"],
    turnChain: ["Mám něco o Katce?", "Ukaž poznámky o Katce"],
    expectRx: /katk|38|brezen|12/i,
    expectNotRx: /franta\s+zaloh|oktav|wifi|umyvadl/i
  },
  C: {
    name: "ATTRIBUTE_EXTRACTION_KATKA_SIZE",
    mode: "exact_answer",
    canonical: [
      "Jakou velikost nosí Katka",
      "Jakou velikost má Katka",
      "Velikost šatů Katky"
    ],
    metamorphic: ["Jakou velikost bot má Katka?", "Kolik má Katka na boty?"],
    turnChain: ["Mám něco o Katce?", "Jakou velikost nosí Katka?"],
    expectRx: /38|velikost/i,
    expectNotRx: /franta|oktav|wifi/i
  },
  D: {
    name: "WIFI_PASSWORD",
    mode: "exact_answer",
    canonical: [
      "Jaké je heslo na wifi",
      "Jaké mám heslo na wifi",
      "Najdi heslo na wifi"
    ],
    metamorphic: ["Kde mám heslo k wifi?", "Jaké je wifi heslo?", "Co mám na wifi heslo?"],
    turnChain: ["Mám něco o wifi?", "Jaké je heslo na wifi?"],
    expectRx: /modra|heslo|wifi/i,
    expectNotRx: /franta|oktav|katk\s+boty|umyvadl/i
  },
  E: {
    name: "BOTANICKA_ZAHRADA",
    mode: "exact_answer",
    canonical: [
      "Jaká je adresa botanické zahrady",
      "Kde je botanická zahrada",
      "Najdi adresu botanické zahrady"
    ],
    metamorphic: ["Kam mám jet na botanickou zahradu?", "Jaká je adresa Botanické zahrady?"],
    turnChain: ["Mám něco o botanické zahradě?", "Jaká je adresa botanické zahrady?"],
    expectRx: /vinohradsk|botanick|adres/i,
    expectNotRx: /franta|upresni/i
  },
  F: {
    name: "TV_ZARUKA",
    mode: "exact_answer",
    canonical: [
      "Kdy končí záruka na televizi",
      "Dokdy má TV záruku",
      "Najdi záruku na TV"
    ],
    metamorphic: [
      "Kdy mi končí záruka na televizi?",
      "Do kdy mám záruku na TV?",
      "Kdy končí záruka na telku?"
    ],
    turnChain: ["Mám něco o TV?", "Kdy končí záruka na televizi?"],
    expectRx: /zaruk|2027|tv/i,
    expectNotRx: /ukol|najem|spz|42/i
  },
  G: {
    name: "NAROZENINY",
    mode: "exact_answer",
    canonical: [
      "Kdy má Tomáš narozeniny",
      "Kdy má Nicolas narozeniny",
      "Kdy má táta narozeniny"
    ],
    metamorphic: ["Kdy má Tom narozeniny?", "Kdy má nicolas narozeniny?", "Kdy má tata narozeniny?"],
    turnChain: ["Mám něco o Tomášovi?", "Kdy má Tomáš narozeniny?"],
    expectRxByQuery: {
      tomas: /tomas|kvet|kveten|kvetna/i,
      nicolas: /nicolas|nikolas|13|rijen|rijna/i,
      tata: /tat|rijen|rijna/i
    },
    expectNotRx: /upresni|kalend|kluk|10:00/i
  },
  H: {
    name: "UMYVADLO",
    mode: "topic_list",
    canonical: ["Jakou barvu má umyvadlo", "Mám něco o umyvadle"],
    metamorphic: ["Co mám o umyvadle?", "Najdi umyvadlo v poznámkách"],
    turnChain: ["Mám něco o umyvadle?", "Jakou barvu má umyvadlo?"],
    expectRx: /umyvadl|bily|cerven/i,
    expectNotRx: /franta|oktav|wifi|katk/i
  },
  I: {
    name: "TRUTHFUL_COUNTS",
    mode: "topic_list",
    canonical: ["Co mám o autě", "Mám něco o Katce", "Co mám o umyvadle"],
    metamorphic: ["Ukaž poznámky o autě", "Najdi Katku v poznámkách"],
    expectRx: /./,
    requireTruthfulCount: true
  },
  J: {
    name: "EXACT_ANSWER_VS_LIST",
    mode: "exact_answer",
    canonical: [
      "Jaké je heslo na wifi",
      "Jakou barvu má umyvadlo",
      "Jaká je adresa botanické zahrady",
      "Jaká je šířka auta",
      "Kdy končí záruka na televizi",
      "Jakou velikost nosí Katka"
    ],
    metamorphic: [
      "Jaký je PIN na dveře",
      "Jakou má šířku stůl?",
      "Kdy má Nicolas narozeniny?"
    ],
    expectExactAnswer: true,
    expectRx: /./
  }
};

function foldCs(s) {
  return aliasData.foldCs(s);
}

function stripDiacriticsQuery(q) {
  return foldCs(q);
}

function mobileVoiceQuery(q) {
  return foldCs(String(q || "").toLowerCase().replace(/[?.!]/g, "").trim());
}

function replaySeedCtx() {
  const base = shared.seedCtx();
  const t0 = shared.FIXED_NOW.getTime();
  const extra = REPLAY_EXTRA_NOTES.map(function (row, i) {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      createdAt: t0 - (base.getNotesSnapshot().length + i + 1) * 3600000,
      updatedAt: t0 - (base.getNotesSnapshot().length + i + 1) * 3600000,
      pinned: false,
      tags: [],
      deleted: false
    };
  });
  const notes = base.getNotesSnapshot().concat(extra);
  return {
    now: base.now,
    getEventsSnapshot: base.getEventsSnapshot,
    getTasksSnapshot: base.getTasksSnapshot,
    getNotesSnapshot: function () {
      return notes;
    }
  };
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function listedCount(msg) {
  return (String(msg || "").match(/^\d+\.\s/gm) || []).length;
}

function claimedCount(msg) {
  const m = String(msg || "").match(/na[sš]el jsem\s+(\d+)\s+z[aá]znam/i);
  return m ? parseInt(m[1], 10) : 0;
}

function iuSilverTruthfulCount(msg) {
  const claimed = claimedCount(msg);
  const listed = listedCount(msg);
  if (!claimed || !listed) return true;
  return claimed === listed;
}

function pickExpectRx(familyKey, spec, input) {
  if (spec.expectRxByQuery) {
    const f = foldCs(input);
    if (/nicolas/.test(f)) return spec.expectRxByQuery.nicolas;
    if (/tata|tatka|tata/.test(f)) return spec.expectRxByQuery.tata;
    if (/tomas|tom\b/.test(f)) return spec.expectRxByQuery.tomas;
    return spec.expectRxByQuery.tomas;
  }
  return spec.expectRx;
}

function makeCase(familyKey, spec, input, variant, chainOpt) {
  const expectRx = pickExpectRx(familyKey, spec, input);
  const c = {
    id: "NRUR_" + familyKey + "_" + variant + "_" + foldCs(input).slice(0, 24).replace(/\W+/g, "_"),
    replayFamily: familyKey,
    family: spec.name,
    mode: spec.mode,
    variant: variant,
    input: input,
    expectModule: "notes",
    expectRx: expectRx,
    expectNotRx: spec.expectNotRx,
    forbidWrite: true,
    tier: "A"
  };
  if (spec.requireTruthfulCount) c.requireTruthfulCount = true;
  if (spec.expectExactAnswer) c.expectExactAnswer = true;
  if (chainOpt) {
    c.turnChain = chainOpt;
    c.variant = "turn_by_turn";
  }
  return c;
}

function expandFamilyCases(familyKey, spec) {
  const out = [];
  const buckets = [
    { variant: "canonical", list: spec.canonical || [] },
    { variant: "metamorphic", list: spec.metamorphic || [] },
    { variant: "no_diacritics", list: (spec.canonical || []).concat(spec.metamorphic || []).map(stripDiacriticsQuery) },
    { variant: "mobile_voice", list: (spec.canonical || []).concat(spec.metamorphic || []).map(mobileVoiceQuery) }
  ];
  buckets.forEach(function (b) {
    b.list.forEach(function (q) {
      if (!q || !String(q).trim()) return;
      out.push(makeCase(familyKey, spec, String(q).trim(), b.variant));
    });
  });
  if (spec.turnChain && spec.turnChain.length >= 2) {
    out.push(makeCase(familyKey, spec, spec.turnChain[spec.turnChain.length - 1], "turn_by_turn", spec.turnChain));
  }
  return out;
}

function buildRealUserReplayCorpus() {
  const out = [];
  Object.keys(FAMILY_SPECS).forEach(function (key) {
    out.push.apply(out, expandFamilyCases(key, FAMILY_SPECS[key]));
  });
  return out;
}

function evaluateReplayCase(c, turn, msg) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const msgF = foldCs(msg);

  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (c.expectModule === "notes" && intent !== "notes.read" && intent !== "global.search" && intent !== "clarification") {
    issues.push("not_read:" + intent);
  }
  if (c.expectRx && !c.expectRx.test(msg) && !c.expectRx.test(msgF)) issues.push("content_miss");
  if (c.expectNotRx && (c.expectNotRx.test(msg) || c.expectNotRx.test(msgF))) issues.push("pollution");
  if (c.mode === "exact_answer" || c.expectExactAnswer) {
    if (listedCount(msg) > 1) issues.push("list_instead_of_answer");
  }
  if (c.requireTruthfulCount && listedCount(msg) > 0 && !iuSilverTruthfulCount(msg)) {
    issues.push("truthful_count_fail");
  }
  if (c.mode === "exact_answer" && listedCount(msg) > 1 && !c.allowList) {
    issues.push("answer_vs_list_fail");
  }
  return issues;
}

function evaluateTurnChain(eng, c) {
  const ctx = replaySeedCtx();
  let draft = eng.createEmptyDraft();
  let lastTurn = null;
  let lastMsg = "";
  for (let i = 0; i < c.turnChain.length; i++) {
    lastTurn = eng.processUserTurn(c.turnChain[i], draft, ctx);
    lastMsg = turnMsg(lastTurn);
    draft =
      lastTurn.processingState === "READY_TO_SAVE" && lastTurn.draft
        ? lastTurn.draft
        : eng.createEmptyDraft();
  }
  const issues = evaluateReplayCase(c, lastTurn, lastMsg);
  return {
    id: c.id,
    replayFamily: c.replayFamily,
    family: c.family,
    variant: c.variant,
    input: c.turnChain.join(" -> "),
    issues: issues,
    pass: issues.length === 0,
    intent: lastTurn.normalizedIntent,
    message: lastMsg.slice(0, 220)
  };
}

function evaluateSingleTurn(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const ctx = replaySeedCtx();
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const msg = turnMsg(turn);
  const issues = evaluateReplayCase(c, turn, msg);
  return {
    id: c.id,
    replayFamily: c.replayFamily,
    family: c.family,
    variant: c.variant,
    input: c.input,
    issues: issues,
    pass: issues.length === 0,
    intent: turn.normalizedIntent,
    message: msg.slice(0, 220)
  };
}

function runRealUserReplayAudit(cases, reportPath) {
  const eng = loadEngine();
  let pass = 0;
  const fails = [];
  const familyStats = {};
  const safety = {
    query_created_write_count: 0,
    false_write_count: 0,
    dangerous_write_count: 0,
    write_when_negated_count: 0
  };

  Object.keys(FAMILY_SPECS).forEach(function (k) {
    familyStats[k] = { pass: 0, total: 0 };
  });

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = c.turnChain ? evaluateTurnChain(eng, c) : evaluateSingleTurn(eng, c);
    familyStats[c.replayFamily].total++;
    if (r.pass) {
      pass++;
      familyStats[c.replayFamily].pass++;
      continue;
    }
    fails.push(r);
    if ((r.issues || []).some(function (x) {
      return String(x).indexOf("write") >= 0;
    })) {
      safety.query_created_write_count++;
      safety.false_write_count++;
      safety.dangerous_write_count++;
    }
  }

  const familyPass = {};
  Object.keys(familyStats).forEach(function (k) {
    familyPass[k] = familyStats[k].total === familyStats[k].pass ? "PASS" : "FAIL";
  });

  const report = {
    guard_id: "note_retrieval_real_user_replay_v1",
    real_user_cases: Object.keys(FAMILY_SPECS).length,
    replay_cases: cases.length,
    total: cases.length,
    pass: pass,
    fail: fails.length,
    replay_pass_rate: cases.length ? ((pass / cases.length) * 100).toFixed(2) : "100.00",
    family_pass: familyPass,
    all_fail_families_pass: Object.keys(familyPass).every(function (k) {
      return familyPass[k] === "PASS";
    })
      ? "YES"
      : "NO",
    real_user_replay_pass: fails.length === 0 ? "YES" : "NO",
    query_created_write_count: safety.query_created_write_count,
    false_write_count: safety.false_write_count,
    dangerous_write_count: safety.dangerous_write_count,
    write_when_negated_count: safety.write_when_negated_count,
    PASS_FAIL: fails.length === 0 && safety.dangerous_write_count === 0 ? "PASS" : "FAIL",
    first_fail: fails[0] || null,
    first_fails: fails.slice(0, 8),
    engine_gap_families: fails.length
      ? {
          B: fails.some(function (f) {
            return f.replayFamily === "B";
          })
            ? "person_dative_inflection_katce_missing_from_alias_registry"
            : "PASS",
          H: fails.some(function (f) {
            return f.replayFamily === "H";
          })
            ? "topic_locative_umyvadlu_missing_from_normalization_registry"
            : "PASS"
        }
      : { B: "PASS", H: "PASS" }
  };

  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  }
  return { report: report, fails: fails, familyStats: familyStats };
}

function printReplayBanner(report) {
  console.log("=== NOTE_RETRIEVAL_REAL_USER_REPLAY_V1 ===");
  console.log("real_user_cases=" + report.real_user_cases);
  console.log("replay_cases=" + report.replay_cases);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("replay_pass_rate=" + report.replay_pass_rate);
  Object.keys(report.family_pass || {}).forEach(function (k) {
    console.log("FAMILY_" + k + "=" + report.family_pass[k]);
  });
  console.log("real_user_replay_pass=" + report.real_user_replay_pass);
  console.log("all_fail_families_pass=" + report.all_fail_families_pass);
  console.log("query_created_write_count=" + report.query_created_write_count);
  console.log("dangerous_write_count=" + report.dangerous_write_count);
  console.log("false_write_count=" + report.false_write_count);
  console.log("write_when_negated_count=" + report.write_when_negated_count);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  if (report.first_fail) {
    console.log("first_fail_family=" + report.first_fail.replayFamily);
    console.log("first_fail_input=" + report.first_fail.input);
  }
  console.log("=== END_NOTE_RETRIEVAL_REAL_USER_REPLAY_V1 ===");
}

function main() {
  const cases = buildRealUserReplayCorpus();
  const res = runRealUserReplayAudit(cases, REPORT);
  printReplayBanner(res.report);
  const ok =
    res.report.real_user_replay_pass === "YES" &&
    res.report.all_fail_families_pass === "YES" &&
    res.report.dangerous_write_count === 0 &&
    res.report.PASS_FAIL === "PASS";
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  FAMILY_SPECS,
  buildRealUserReplayCorpus,
  runRealUserReplayAudit,
  printReplayBanner,
  REPORT
};
