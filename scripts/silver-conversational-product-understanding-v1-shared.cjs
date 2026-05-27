#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const helpGov = require("./silver-help-guidance-render-governance-v1-shared.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");

const REPO = path.resolve(__dirname, "..");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const STATIC_ASSISTANT = new Set(["assistant.capability", "assistant.help", "assistant.guidance"]);
const READ_INTENTS_OK = /\.(read|query)$|global\.search|silver\.salutation_preference/;

const AUDIT_FAMILIES = [
  "capability_help_questions",
  "instructional_questions",
  "save_vs_help_confusion",
  "search_vs_save_confusion",
  "conversational_meta_questions",
  "assistant_capability_questions",
  "calendar_analytics_queries",
  "retrieval_grounding_queries",
  "hallucination_prevention_queries",
  "guidance_without_save",
  "how_to_questions",
  "can_you_questions",
  "what_can_you_do_questions",
  "explain_features_queries",
  "conversational_assistant_questions",
  "capability_vs_storage_confusion",
  "analytics_vs_create_confusion",
  "retrieval_truthfulness_queries",
  "unsupported_capability_questions",
  "offline_capability_questions"
];

/** Tier-A permanent replay — screenshot UX cluster V1 */
const TIER_A_REPLAY_PACK = [
  { id: "REPLAY_001", family: "capability_vs_storage_confusion", input: "Co můžu uložit", mode: "help", tier: "A" },
  { id: "REPLAY_002", family: "how_to_questions", input: "Jak něco uložím", mode: "help", tier: "A" },
  { id: "REPLAY_003", family: "instructional_questions", input: "Jak něco uložím do kalendáře", mode: "help", tier: "A" },
  {
    id: "REPLAY_004",
    family: "calendar_analytics_queries",
    input: "Kolik jsem měl schůzek minulý týden od pondělí do neděle",
    mode: "analytics",
    tier: "A"
  },
  { id: "REPLAY_005", family: "conversational_meta_questions", input: "Můžeš mě oslovovat jménem?", mode: "meta", tier: "A" },
  { id: "REPLAY_006", family: "assistant_capability_questions", input: "S čím mi můžeš pomoct", mode: "help", tier: "A" },
  {
    id: "REPLAY_007",
    family: "hallucination_prevention_queries",
    input: "Najdi mi kdy má Nicolas narozeniny",
    mode: "retrieval_empty",
    tier: "A",
    forbidNeedles: ["narozeniny teta", "12. května"]
  },
  { id: "REPLAY_008", family: "what_can_you_do_questions", input: "Co všechno dokážeš", mode: "help", tier: "A" },
  { id: "REPLAY_009", family: "can_you_questions", input: "Umíš vyhledávat v kalendáři?", mode: "help", tier: "A" }
];

const FAMILY_TEMPLATES = {
  capability_help_questions: [
    "co umíš",
    "co všechno umíš",
    "s čím pomůžeš",
    "s čím mi můžeš pomoct",
    "nápověda",
    "pomoc"
  ],
  instructional_questions: [
    "jak něco uložím",
    "jak něco uložit",
    "jak uložit schůzku",
    "jak funguje kalendář",
    "jak fungují úkoly",
    "jak fungují poznámky"
  ],
  save_vs_help_confusion: [
    "co můžu uložit",
    "co se dá uložit",
    "kam se ukládají data",
    "co umíš uložit"
  ],
  search_vs_save_confusion: [
    "umíš hledat v kalendáři",
    "umíš vyhledávat",
    "jak hledat schůzky",
    "jak vyhledat v poznámkách"
  ],
  conversational_meta_questions: [
    "můžeš mě oslovovat jménem",
    "můžeš mluvit normálně",
    "mluvíš česky",
    "kdo jsi",
    "jak funguješ"
  ],
  assistant_capability_questions: [
    "co všechno dokážeš",
    "co dokážeš",
    "s čím mi pomůžeš",
    "co umí silver"
  ],
  calendar_analytics_queries: [
    "kolik jsem měl schůzek minulý týden",
    "kolik mám úkolů",
    "kolik mám poznámek",
    "kolik mám akcí tento měsíc",
    "kolik mám dnes schůzek"
  ],
  retrieval_grounding_queries: [
    "najdi narozeniny",
    "najdi kdy má narozeniny",
    "víš kdy má narozeniny",
    "co víš o dokumentech",
    "najdi schůzky s Petrem"
  ],
  hallucination_prevention_queries: [
    "najdi mi kdy má Nicolas narozeniny",
    "kdy má XYZ narozeniny",
    "co víš o NeexistujícíOsobě"
  ],
  guidance_without_save: [
    "jen mi vysvětli úkoly",
    "co když nechci nic ukládat",
    "jen mi ukaž příklad schůzky"
  ],
  how_to_questions: [
    "jak něco uložím do kalendáře",
    "jak vytvořím úkol",
    "jak zadám připomínku"
  ],
  can_you_questions: [
    "umíš připomínky",
    "umíš hledat schůzky",
    "umíš kalendář",
    "můžeš hledat v poznámkách"
  ],
  what_can_you_do_questions: [
    "co všechno dokážeš",
    "co umíš",
    "co všechno umíš uložit"
  ],
  explain_features_queries: [
    "jak funguje silver",
    "jak fungují drafty",
    "jak funguje vyhledávání",
    "na co jsou poznámky"
  ],
  conversational_assistant_questions: [
    "jak s tebou mám mluvit",
    "můžeš mluvit česky",
    "funguješ offline"
  ],
  capability_vs_storage_confusion: [
    "co můžu uložit",
    "můžu uložit něco do cloudu",
    "kam jdou data"
  ],
  analytics_vs_create_confusion: [
    "kolik schůzek minulý týden",
    "kolik úkolů mám",
    "kolik poznámek",
    "kolik akcí tento měsíc"
  ],
  retrieval_truthfulness_queries: [
    "najdi PIN ke kartě",
    "kde mám dokumenty v poznámkách",
    "co mám o narozeninách v poznámkách"
  ],
  unsupported_capability_questions: [
    "umíš googlit",
    "jsi chatgpt",
    "máš přístup na internet"
  ],
  offline_capability_questions: [
    "funguješ offline",
    "potřebuješ internet",
    "co děláš bez internetu",
    "ukládá se to do cloudu",
    "kde jsou data"
  ]
};

const PREFIXES = ["", "Hele ", "Prosím ", "Krátce ", "No ", "Silver ", "Řekni mi "];
const SUFFIXES = ["", "?", " prosím?", " stručně?"];
const CHAOS_FILLERS = ["", "fakt ", "nevím ", "urgentně ", "můžeš mi říct "];

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function modeForFamily(family) {
  if (family === "calendar_analytics_queries" || family === "analytics_vs_create_confusion") return "analytics";
  if (family === "conversational_meta_questions" || family === "conversational_assistant_questions") return "meta";
  if (
    family === "retrieval_grounding_queries" ||
    family === "hallucination_prevention_queries" ||
    family === "retrieval_truthfulness_queries"
  ) {
    return "retrieval";
  }
  if (family === "hallucination_prevention_queries") return "retrieval_empty";
  return "help";
}

function buildSeedCtx() {
  const now = new Date("2026-05-04T12:00:00");
  return {
    now: now,
    getEventsSnapshot: function () {
      return [
        { id: "e1", date: "2026-04-28", time: "10:00", title: "Schůzka A", address: "", note: "" },
        { id: "e2", date: "2026-04-29", time: "11:00", title: "Schůzka B", address: "", note: "" },
        { id: "e3", date: "2026-05-04", time: "10:15", title: "Schůzka s Tomášem", address: "", note: "" }
      ];
    },
    getTasksSnapshot: function () {
      return [{ id: "t1", title: "koupit mléko", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }];
    },
    getNotesSnapshot: function () {
      return [
        {
          id: "n_narozeniny",
          title: "Narozeniny",
          content: "teta má narozeniny 12. května",
          createdAt: 1,
          updatedAt: 1,
          pinned: false,
          tags: [],
          deleted: false
        },
        { id: "n_pin", title: "PIN", content: "pin ke kartě je doma", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
      ];
    }
  };
}

function buildCorpusV1(targetCount) {
  const cases = [];
  for (let i = 0; i < TIER_A_REPLAY_PACK.length; i++) {
    const r = TIER_A_REPLAY_PACK[i];
    cases.push({
      id: r.id,
      family: r.family,
      input: r.input,
      mode: r.mode,
      tier: "A",
      forbidNeedles: r.forbidNeedles || null
    });
  }
  const perFamily = Math.max(40, Math.ceil((targetCount - cases.length) / AUDIT_FAMILIES.length));
  const rng = core.mulberry32(0x43505531);
  let n = cases.length;
  for (let f = 0; f < AUDIT_FAMILIES.length; f++) {
    const family = AUDIT_FAMILIES[f];
    const tpls = FAMILY_TEMPLATES[family] || ["co umíš"];
    for (let i = 0; i < perFamily; i++) {
      n++;
      const base = tpls[i % tpls.length];
      const pfx = PREFIXES[Math.floor(rng() * PREFIXES.length)];
      const sfx = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
      const chaos = CHAOS_FILLERS[Math.floor(rng() * CHAOS_FILLERS.length)];
      let input = chaos + pfx + base + sfx;
      const mask = core.deriveMutationMask(family, i, 0x43505531);
      input = core.applyMutationLayers(input, mask, rng);
      cases.push({
        id: "CPU_" + family.slice(0, 8).toUpperCase() + "_" + String(n).padStart(6, "0"),
        family: family,
        input: input,
        mode: modeForFamily(family),
        tier: "B"
      });
    }
  }
  return cases.slice(0, targetCount);
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function evaluateCase(eng, c, ctx) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx || harness.ctxForCase("calendar_write"));
  const intent = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const issues = [];
  const mode = c.mode || modeForFamily(c.family);

  if (mode === "help") {
    if (!STATIC_ASSISTANT.has(intent)) issues.push("help_expected_assistant_got_" + intent);
    if (ps !== "CAPABILITY_OK") issues.push("help_state_expected_CAPABILITY_OK_got_" + ps);
    const shell = helpGov.turnWouldLeakSaveShell(turn, eng);
    for (let i = 0; i < shell.length; i++) issues.push(shell[i]);
  } else if (mode === "analytics") {
    if (WRITE_INTENTS.has(intent)) issues.push("analytics_must_not_create:" + intent);
    if (ps === "READY_TO_SAVE" || ps === "NEEDS_CLARIFICATION" || ps === "STORAGE_DISAMBIGUATION") {
      issues.push("analytics_save_shell:" + ps);
    }
    if (!READ_INTENTS_OK.test(intent) && intent !== "calendar.read" && intent !== "tasks.read" && intent !== "notes.read") {
      if (intent === "clarification") issues.push("analytics_generic_clarification");
    }
    const d = turn.draft || {};
    if (String(d.title || "").trim().length > 2) issues.push("analytics_draft_leak");
  } else if (mode === "meta") {
    const okMeta =
      intent === "silver.salutation_preference" || STATIC_ASSISTANT.has(intent) || (READ_INTENTS_OK.test(intent) && ps === "READ_OK");
    if (!okMeta) issues.push("meta_expected_salutation_or_help_got_" + intent);
    if (WRITE_INTENTS.has(intent)) issues.push("meta_must_not_write");
  } else if (mode === "retrieval" || mode === "retrieval_empty") {
    if (WRITE_INTENTS.has(intent)) issues.push("retrieval_must_not_create:" + intent);
    if (mode === "retrieval_empty") {
      const msg = foldCs(turnMsg(turn));
      if (msg.indexOf("nic jsem") < 0 && msg.indexOf("nenasel") < 0) issues.push("retrieval_must_admit_empty");
      if (c.forbidNeedles) {
        for (let i = 0; i < c.forbidNeedles.length; i++) {
          if (msg.indexOf(foldCs(c.forbidNeedles[i])) >= 0) issues.push("hallucination_forbidden:" + c.forbidNeedles[i]);
        }
      }
    }
  }

  return { id: c.id, family: c.family, input: c.input, intent, ps, issues, pass: issues.length === 0, turn };
}

function runAudit(harnessId, cases, reportPath, extraMetrics) {
  const eng = harness.loadEngine();
  const ctx = buildSeedCtx();
  const results = [];
  let pass = 0;
  let helpSaveLeaks = 0;
  let queryCreateLeaks = 0;
  let hallucinationLeaks = 0;
  for (let i = 0; i < cases.length; i++) {
    const r = evaluateCase(eng, cases[i], ctx);
    results.push(r);
    if (r.pass) pass++;
    else {
      let caseHelpSave = false;
      let caseQueryCreate = false;
      let caseHallucination = false;
      for (let j = 0; j < r.issues.length; j++) {
        const iss = r.issues[j];
        if (
          iss.indexOf("write_intent") === 0 ||
          iss.indexOf("save_processing") === 0 ||
          iss.indexOf("storage_disambiguation") === 0 ||
          iss.indexOf("draft_") === 0
        ) {
          caseHelpSave = true;
        }
        if (iss.indexOf("analytics_must_not_create") >= 0 || iss.indexOf("analytics_save_shell") >= 0) {
          caseQueryCreate = true;
        }
        if (iss.indexOf("hallucination") >= 0) caseHallucination = true;
      }
      if (caseHelpSave) helpSaveLeaks++;
      if (caseQueryCreate) queryCreateLeaks++;
      if (caseHallucination) hallucinationLeaks++;
    }
  }
  const total = cases.length;
  const tierA = cases.filter(function (x) {
    return x.tier === "A";
  });
  let tierAPass = 0;
  let tierAHelpSaveLeaks = 0;
  let tierAQueryCreateLeaks = 0;
  for (let i = 0; i < results.length; i++) {
    if (cases[i].tier === "A") {
      if (results[i].pass) tierAPass++;
      else {
        for (let j = 0; j < results[i].issues.length; j++) {
          const iss = results[i].issues[j];
          if (
            iss.indexOf("write_intent") === 0 ||
            iss.indexOf("save_processing") === 0 ||
            iss.indexOf("storage_disambiguation") === 0 ||
            iss.indexOf("draft_") === 0
          ) {
            tierAHelpSaveLeaks++;
            break;
          }
        }
        for (let j = 0; j < results[i].issues.length; j++) {
          if (results[i].issues[j].indexOf("analytics_must_not_create") >= 0) {
            tierAQueryCreateLeaks++;
            break;
          }
        }
      }
    }
  }
  const report = Object.assign(
    {
      harness_id: harnessId,
      main_commit: mainCommit(),
      cases_total: total,
      pass_count: pass,
      fail_count: total - pass,
      accuracy_pct: total ? Math.round((pass / total) * 1000) / 10 : 0,
      tier_a_total: tierA.length,
      tier_a_pass: tierAPass,
      tier_a_save_leaks: tierAHelpSaveLeaks,
      tier_a_query_create_leaks: tierAQueryCreateLeaks,
      help_save_leaks: helpSaveLeaks,
      query_create_leaks: queryCreateLeaks,
      hallucination_leaks: hallucinationLeaks,
      audit_families: AUDIT_FAMILIES.slice(),
      fails: results.filter(function (x) {
        return !x.pass;
      }),
      results: results
    },
    extraMetrics || {}
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return { report, eng };
}

function printAuditHeader(tag, report, minPct) {
  console.log("=== " + tag.toUpperCase() + " ===");
  console.log("cases_total=" + report.cases_total);
  console.log("pass_count=" + report.pass_count);
  console.log("fail_count=" + report.fail_count);
  console.log("accuracy_pct=" + report.accuracy_pct);
  console.log("tier_a_pass=" + report.tier_a_pass + "/" + report.tier_a_total);
  console.log("tier_a_save_leaks=" + (report.tier_a_save_leaks || 0));
  console.log("help_save_leaks=" + report.help_save_leaks);
  console.log("query_create_leaks=" + report.query_create_leaks);
  console.log("hallucination_leaks=" + report.hallucination_leaks);
  if (minPct != null) console.log("min_pass_pct=" + minPct);
  const accuracyOk = minPct == null ? true : report.accuracy_pct >= minPct;
  const ok =
    report.tier_a_pass === report.tier_a_total &&
    (report.tier_a_save_leaks || 0) === 0 &&
    (report.tier_a_query_create_leaks || 0) === 0 &&
    report.hallucination_leaks === 0 &&
    accuracyOk;
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_" + tag.toUpperCase() + " ===");
  return ok;
}

module.exports = {
  AUDIT_FAMILIES,
  TIER_A_REPLAY_PACK,
  buildCorpusV1,
  buildSeedCtx,
  evaluateCase,
  runAudit,
  printAuditHeader,
  mainCommit
};
