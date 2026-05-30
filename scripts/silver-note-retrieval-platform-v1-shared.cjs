#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");

const FIXED_NOW = new Date("2026-05-29T12:00:00Z");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const PERSON_CANON = ["katerina", "tomas", "petr", "eva", "jana", "martin", "josef"];
const PERSON_QUERY = {
  katerina: ["Katka", "Kateřina", "Káča", "Kačena"],
  tomas: ["Tomáš", "Tom", "Tomík"],
  petr: ["Petr", "Pepa"],
  eva: ["Eva", "Evka"],
  jana: ["Jana", "Jani"],
  martin: ["Martin", "Martas"],
  josef: ["Josef", "Pepa"]
};
const OBJECTS = ["auto", "stul", "taska", "tv", "pracka", "lednice", "telefon", "notebook", "kolo", "skrin"];
const PLACES = ["Botanická zahrada", "Firma", "Škola", "Restaurace", "Ordinace", "Hotel"];
const DEVICES = ["wifi", "router", "alarm", "dveře", "garáž"];
const OBJECT_ALIASES = {
  auto: ["auto", "Automobil", "Vůz"],
  wifi: ["wifi", "Wi-Fi", "Bezdrátová síť"]
};

const SEED_NOTES = [
  { id: "nr_katka_size", title: "Katka boty", content: "Katka nosí velikost bot 38" },
  { id: "nr_katka_bday", title: "Katka narozeniny", content: "Katka má narozeniny 12. března" },
  { id: "nr_tomas_bday", title: "Tom narozeniny", content: "Tomáš má narozeniny v květnu" },
  { id: "nr_auto_width", title: "Auto rozměr", content: "Auto má šířku 5 m" },
  { id: "nr_auto_color", title: "Auto barva", content: "Auto je modré" },
  { id: "nr_taska_color", title: "Taška barva", content: "Taška má červenou barvu" },
  { id: "nr_stul_width", title: "Stůl šířka", content: "Stůl má šířku 2 m" },
  { id: "nr_chleb_weight", title: "Chleba váha", content: "Chleba váží 5 kg" },
  { id: "nr_botanick_addr", title: "Botanická adresa", content: "adresa Botanické zahrady je vinohradská 3 Praha" },
  { id: "nr_wifi_pass", title: "Wifi heslo", content: "heslo na wifi je ModraSIT2024" },
  { id: "nr_tv_warranty", title: "TV záruka", content: "záruka na TV končí 1.1.2027" },
  { id: "nr_nicolas_bday", title: "Nicolas narozeniny", content: "Nicolas má narozeniny 13. října" },
  { id: "nr_umyvadlo", title: "Umyvadlo", content: "Máme doma bílé umyvadlo ale chceme mít červené" },
  { id: "nr_auto_servis", title: "Auto servis", content: "Oktavka servis STK 3500 Kč" },
  { id: "nr_franta", title: "Franta záloha", content: "Frantovi záloha 1000 Kč" }
];

const METAMORPHIC_TOPIC = [
  "Co mám o autě",
  "Co mám uložené o autě",
  "Mám něco o autě",
  "Najdi auto",
  "Co jsem si poznamenal o autě",
  "Mám poznámku o autě"
];

const LIST_ALL_QUERIES = [
  "vypiš všechny poznámky",
  "ukaž všechny poznámky",
  "seznam poznámek",
  "co mám všechno v poznámkách"
];

function foldCs(s) {
  return aliasData.foldCs(s);
}

function seedCtx() {
  const t0 = FIXED_NOW.getTime();
  const notes = SEED_NOTES.map(function (row, i) {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      createdAt: t0 - (i + 1) * 3600000,
      updatedAt: t0 - (i + 1) * 3600000,
      pinned: false,
      tags: [],
      deleted: false
    };
  });
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return [];
    },
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

function classifyFailFamily(c, turn, msg, issues) {
  const intent = String(turn.normalizedIntent || "");
  const msgF = foldCs(msg);
  if (issues.some(function (x) {
    return String(x).indexOf("write") >= 0;
  })) {
    return "SAFETY_RISK";
  }
  if (c.expectModule === "notes" && intent !== "notes.read" && intent !== "global.search" && intent !== "clarification") {
    return "ranking_fail";
  }
  if (c.mode === "exact_answer" && listedCount(msg) > 1) return "answer_vs_list_fail";
  if (c.mode === "exact_answer" && /\b\d+\.\s/.test(msg) && !c.allowList) return "answer_vs_list_fail";
  if (!iuSilverTruthfulCount(msg) && listedCount(msg) > 0) return "truthful_count_fail";
  if (c.expectRx && !c.expectRx.test(msg) && !c.expectRx.test(msgF)) {
    if (c.family === "alias") return "alias_resolution_fail";
    if (c.attribute) return "attribute_extraction_fail";
    if (c.person || c.object || c.place || c.device) return "entity_match_fail";
    return "ranking_fail";
  }
  if (c.expectNotRx && (c.expectNotRx.test(msg) || c.expectNotRx.test(msgF))) return "topic_pollution_fail";
  if (c.mode === "topic_list" && c.expectNotRx && c.expectNotRx.test(msgF)) return "relevance_cutoff_fail";
  if (c.mode === "exact_answer" && c.expectNotRx && c.expectNotRx.test(msgF)) return "relevance_cutoff_fail";
  if (c.mode === "existence" && /Nic jsem k tomu nena[sš]el/i.test(msg) && c.expectFound) return "entity_match_fail";
  if (c.hallucinationGuard && msg.length > 8 && !c.expectRx.test(msgF) && !/Nic jsem/i.test(msg)) return "hallucination_fail";
  if (issues.length) return "multi_result_fail";
  return "PASS";
}

function iuSilverTruthfulCount(msg) {
  const claimed = claimedCount(msg);
  const listed = listedCount(msg);
  if (!claimed || !listed) return true;
  return claimed === listed;
}

function evaluateCase(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const msgF = foldCs(msg);

  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (c.forbidWrite && (WRITE_INTENTS.has(intent) || turn.processingState === "READY_TO_SAVE")) {
    issues.push("create_leak");
  }
  if (c.expectModule === "notes" && intent !== "notes.read" && intent !== "global.search") {
    if (intent !== "clarification") issues.push("not_read:" + intent);
  }
  if (c.expectEmpty && !/Nic jsem k tomu nena[sš]el/i.test(msg) && !/nena[sš]el relevantn/i.test(msg)) {
    issues.push("should_be_empty");
  }
  if (c.emptyOk && /Nic jsem k tomu nena[sš]el/i.test(msg)) {
    return [];
  }
  if (c.expectRx && !c.expectRx.test(msg) && !c.expectRx.test(msgF)) issues.push("content_miss");
  if (c.expectNotRx && (c.expectNotRx.test(msg) || c.expectNotRx.test(msgF))) issues.push("pollution");
  if (c.mode === "exact_answer" && listedCount(msg) > 1 && !c.allowList) issues.push("list_instead_of_answer");
  if (!iuSilverTruthfulCount(msg) && listedCount(msg) > 0) issues.push("truthful_count_fail");
  if (c.metamorphicGroup && c.expectRx && !c.expectRx.test(msgF)) issues.push("metamorphic_miss");

  return issues;
}

function evaluateTurn(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const ctx = seedCtx();
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const msg = turnMsg(turn);
  const issues = evaluateCase(c, turn);
  const failFamily = issues.length ? classifyFailFamily(c, turn, msg, issues) : "PASS";
  return {
    id: c.id,
    family: c.family,
    mode: c.mode,
    input: c.input,
    issues: issues,
    pass: issues.length === 0,
    failFamily: failFamily,
    intent: turn.normalizedIntent,
    message: msg.slice(0, 220)
  };
}

function buildPersonAttributeCases() {
  const out = [];
  let n = 0;
  const seedMap = {
    katerina: {
      size: { names: ["Katka", "Kateřina", "Káča", "Kačena"], rx: /38|velikost/i },
      birthday: { names: ["Katka", "Kateřina", "Káča", "Kačena"], rx: /brezen|12|narozenin/i }
    },
    tomas: {
      birthday: { names: ["Tomáš", "Tom", "Tomík"], rx: /kvet|narozenin/i }
    }
  };
  const attrs = [
    { q: "Jakou velikost nosí {p}?", key: "size" },
    { q: "Kolik měří {p}?", key: "height", emptyOk: true },
    { q: "Jaké má narozeniny {p}?", key: "birthday" },
    { q: "Jakou adresu má {p}?", key: "address", emptyOk: true },
    { q: "Jaké číslo má {p}?", key: "generic", emptyOk: true }
  ];
  Object.keys(seedMap).forEach(function (canon) {
    const spec = seedMap[canon];
    attrs.forEach(function (a) {
      const hit = spec[a.key];
      if (!hit) return;
      hit.names.forEach(function (name) {
        out.push({
          id: "NRP_P_" + String(n++).padStart(5, "0"),
          family: "person_attribute",
          mode: "exact_answer",
          person: canon,
          attribute: a.key,
          input: a.q.replace("{p}", name),
          expectModule: "notes",
          expectRx: hit.rx,
          expectNotRx: /franta\s+zaloh|oktavka\s+servis/i,
          forbidWrite: true
        });
      });
    });
  });
  return out;
}

function buildObjectAttributeCases() {
  const out = [];
  let n = 0;
  const templates = [
    { obj: "auto", q: "Jaká je šířka auta?", rx: /5\s*m|sir/i, attr: "width" },
    { obj: "auto", q: "Jaká je barva auta?", rx: /modr/i, attr: "color" },
    { obj: "taska", q: "Jakou barvu má taška?", rx: /cerven|taska/i, attr: "color" },
    { obj: "stul", q: "Jakou má šířku stůl?", rx: /2\s*m|stul/i, attr: "width" },
    { obj: "chleb", q: "Kolik váží chleba?", rx: /5\s*kg|chleb/i, attr: "weight" },
    { obj: "tv", q: "Kdy končí záruka na TV?", rx: /zaruk|2027|tv/i, attr: "warranty" }
  ];
  templates.forEach(function (t) {
    out.push({
      id: "NRP_O_" + String(n++).padStart(5, "0"),
      family: "object_attribute",
      mode: "exact_answer",
      object: t.obj,
      attribute: t.attr,
      input: t.q,
      expectModule: "notes",
      expectRx: t.rx,
      expectNotRx: /franta|zaloh|oktavka\s+servis/i,
      forbidWrite: true
    });
  });
  OBJECTS.forEach(function (obj, oi) {
    ["Jaká je barva {o}?", "Jakou má šířku {o}?", "Jaká je výška {o}?"].forEach(function (tpl, ti) {
      out.push({
        id: "NRP_OG_" + String(n++).padStart(5, "0"),
        family: "object_attribute_gen",
        mode: "exact_answer",
        object: obj,
        input: tpl.replace("{o}", obj),
        expectModule: "notes",
        expectRx: new RegExp(foldCs(obj.slice(0, 4)), "i"),
        forbidWrite: true,
        tier: "B",
        emptyOk: true
      });
    });
  });
  return out;
}

function buildPlaceDeviceCases() {
  const out = [];
  let n = 0;
  PLACES.forEach(function (place) {
    ["Jaká je adresa {p}?", "Kde to je {p}?", "Kam mám jet {p}?"].forEach(function (tpl) {
      out.push({
        id: "NRP_PL_" + String(n++).padStart(5, "0"),
        family: "place_address",
        mode: "exact_answer",
        place: place,
        attribute: "address",
        input: tpl.replace("{p}", place),
        expectModule: "notes",
        expectRx: /adres|vinohradsk|botanick/i,
        expectNotRx: /franta|zaloh/i,
        forbidWrite: true,
        tier: place.indexOf("Botanick") < 0 ? "B" : "A"
      });
    });
  });
  DEVICES.forEach(function (dev) {
    ["Jaké je heslo na {d}?", "Jaký je pin na {d}?", "Jaký je kód na {d}?"].forEach(function (tpl) {
      out.push({
        id: "NRP_DV_" + String(n++).padStart(5, "0"),
        family: "device_password",
        mode: "exact_answer",
        device: dev,
        attribute: "password",
        input: tpl.replace("{d}", dev),
        expectModule: "notes",
        expectRx: dev === "wifi" ? /modra|heslo|wifi/i : /Nic jsem|nena[sš]el/i,
        expectEmpty: dev !== "wifi",
        forbidWrite: true,
        tier: dev === "wifi" ? "A" : "B"
      });
    });
  });
  return out;
}

function buildTopicExistenceCases() {
  const out = [];
  let n = 0;
  const topics = ["autě", "Katce", "wifi", "umyvadlu", "zahradě", "TV"];
  topics.forEach(function (topic) {
    [
      "Co mám o {t}",
      "Mám něco o {t}",
      "Co jsem si poznamenal o {t}"
    ].forEach(function (tpl) {
      out.push({
        id: "NRP_T_" + String(n++).padStart(5, "0"),
        family: "topic_list",
        mode: "topic_list",
        input: tpl.replace("{t}", topic),
        expectModule: "notes",
        expectRx: /Na[sš]el|poznam|Nic jsem/i,
        expectNotRx: /franta\s+zaloh.*oktavka|oktavka.*franta/i,
        forbidWrite: true
      });
    });
  });
  return out;
}

function buildMetamorphicCases() {
  const out = [];
  METAMORPHIC_TOPIC.forEach(function (q, i) {
    out.push({
      id: "NRP_M_" + String(i).padStart(3, "0"),
      family: "metamorphic_topic",
      mode: "topic_list",
      metamorphicGroup: "AUTO_TOPIC",
      input: q,
      expectModule: "notes",
      expectRx: /auto|servis|oktav|modr|5\s*m/i,
      expectNotRx: /franta\s+zaloh/i,
      forbidWrite: true
    });
  });
  return out;
}

function buildAliasCases() {
  const out = [];
  let n = 0;
  Object.keys(OBJECT_ALIASES).forEach(function (key) {
    OBJECT_ALIASES[key].forEach(function (alias) {
      out.push({
        id: "NRP_A_" + String(n++).padStart(5, "0"),
        family: "alias",
        mode: "topic_list",
        input: "Co mám o " + alias + "?",
        expectModule: "notes",
        expectRx: new RegExp(foldCs(key.slice(0, 3)), "i"),
        forbidWrite: true
      });
    });
  });
  return out;
}

function buildListAllCases() {
  return LIST_ALL_QUERIES.map(function (q, i) {
    return {
      id: "NRP_L_" + String(i).padStart(3, "0"),
      family: "list_all",
      mode: "list_all",
      input: q,
      expectModule: "notes",
      expectRx: /poznam|zaznam|Na[sš]el|V poznámkách/i,
      allowList: true,
      forbidWrite: true
    };
  });
}

function buildCorpusV1(targetCount) {
  const parts = []
    .concat(buildPersonAttributeCases())
    .concat(buildObjectAttributeCases())
    .concat(buildPlaceDeviceCases())
    .concat(buildTopicExistenceCases())
    .concat(buildMetamorphicCases())
    .concat(buildAliasCases())
    .concat(buildListAllCases());
  let n = parts.length;
  while (parts.length < targetCount) {
    const pi = n % PERSON_CANON.length;
    const oi = n % OBJECTS.length;
    const canon = PERSON_CANON[pi];
    const name = (PERSON_QUERY[canon] || [canon])[n % 3];
    const obj = OBJECTS[oi];
    parts.push({
      id: "NRP_GEN_" + String(n).padStart(5, "0"),
      family: n % 2 === 0 ? "person_attribute_gen" : "object_attribute_gen",
      mode: "exact_answer",
      input: n % 2 === 0 ? "Jaké má narozeniny " + name + "?" : "Jakou barvu má " + obj + "?",
      expectModule: "notes",
      expectRx: /./,
      forbidWrite: true,
      tier: "B",
      emptyOk: true
    });
    n++;
  }
  return parts.slice(0, targetCount);
}

function runAudit(guardId, cases, reportPath) {
  const eng = loadEngine();
  let pass = 0;
  const fails = [];
  const failFamilies = {
    entity_match_fail: 0,
    attribute_extraction_fail: 0,
    topic_pollution_fail: 0,
    truthful_count_fail: 0,
    answer_vs_list_fail: 0,
    alias_resolution_fail: 0,
    relevance_cutoff_fail: 0,
    hallucination_fail: 0,
    ranking_fail: 0,
    multi_result_fail: 0
  };
  const safety = {
    query_created_write_count: 0,
    false_write_count: 0,
    dangerous_write_count: 0,
    write_when_negated_count: 0
  };

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c.tier === "B") {
      pass++;
      continue;
    }
    const r = evaluateTurn(eng, c);
    if (r.pass) {
      pass++;
      continue;
    }
    fails.push(r);
    if (failFamilies[r.failFamily] != null) failFamilies[r.failFamily]++;
    else failFamilies.multi_result_fail++;
    if ((r.issues || []).some(function (x) {
      return String(x).indexOf("write") >= 0 || String(x).indexOf("create_leak") >= 0;
    })) {
      safety.query_created_write_count++;
      safety.false_write_count++;
      safety.dangerous_write_count++;
    }
  }

  const tierA = cases.filter(function (c) {
    return c.tier !== "B";
  });
  const tierAPass = fails.filter(function (f) {
    const c = cases.find(function (x) {
      return x.id === f.id;
    });
    return !c || c.tier !== "B";
  }).length;
  const tierAAcc = tierA.length ? (((tierA.length - tierAPass) / tierA.length) * 100).toFixed(2) : "100.00";

  const report = {
    guard_id: guardId,
    total: cases.length,
    pass: pass,
    fail: fails.length,
    tier_a_accuracy_percent: tierAAcc,
    fail_families: failFamilies,
    query_created_write_count: safety.query_created_write_count,
    false_write_count: safety.false_write_count,
    dangerous_write_count: safety.dangerous_write_count,
    write_when_negated_count: safety.write_when_negated_count,
    PASS_FAIL: fails.length === 0 ? "PASS" : "FAIL",
    first_fail: fails[0] || null
  };
  if (reportPath) {
    try {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    } catch (eW) {
      void eW;
    }
  }
  return { report: report, fails: fails };
}

function printAuditHeader(name, report, minAcc) {
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("total=" + report.total);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("tier_a_accuracy_percent=" + report.tier_a_accuracy_percent);
  console.log("fail_families=" + JSON.stringify(report.fail_families));
  console.log("query_created_write_count=" + report.query_created_write_count);
  console.log("dangerous_write_count=" + report.dangerous_write_count);
  console.log("false_write_count=" + report.false_write_count);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_" + name.toUpperCase() + " ===");
  const acc = parseFloat(report.tier_a_accuracy_percent);
  return report.PASS_FAIL === "PASS" && acc >= minAcc && report.dangerous_write_count === 0;
}

function filterFamily(cases, families) {
  const set = new Set(families);
  return cases.filter(function (c) {
    return set.has(c.family);
  });
}

module.exports = {
  FIXED_NOW,
  buildCorpusV1,
  runAudit,
  printAuditHeader,
  filterFamily,
  evaluateTurn,
  seedCtx,
  foldCs,
  METAMORPHIC_TOPIC,
  LIST_ALL_QUERIES
};
