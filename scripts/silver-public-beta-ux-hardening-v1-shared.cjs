#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const helpGov = require("./silver-help-guidance-render-governance-v1-shared.cjs");
const stateGov = require("./silver-state-governance-audit-shared.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");

const REPO = path.resolve(__dirname, "..");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const STATIC_ASSISTANT = new Set(["assistant.capability", "assistant.help", "assistant.guidance"]);

const AUDIT_FAMILIES = [
  "help_tier_b_chaos",
  "onboarding_chaos_mobile",
  "spoken_czech_help",
  "confused_user_help",
  "dirty_czech_onboarding",
  "capability_question_mutations",
  "conversational_guidance_quality",
  "conversational_naturalness",
  "retrieval_ranking_quality",
  "retrieval_candidate_priority",
  "lexical_ranking_validation",
  "exact_vs_partial_match",
  "recency_ranking",
  "temporal_relevance_ranking",
  "title_vs_note_priority",
  "long_session_isolation",
  "stale_context_reset",
  "orchestration_cross_turn_isolation",
  "stale_payload_protection",
  "stale_clarification_protection",
  "public_beta_conversation_chaos",
  "mutation_robustness",
  "onboarding_realism",
  "realistic_mobile_help",
  "public_beta_confused_users",
  "conversational_followup_turns",
  "retrieval_trust_realism",
  "capability_help_realism",
  "update_after_help_flow",
  "search_after_save_flow"
];

const TIER_A_REPLAY = [
  { id: "PBUX_REPLAY_001", family: "help_tier_b_chaos", input: "jak mam napsat ukol", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_002", family: "help_tier_b_chaos", input: "co mam napsat aby si to pochopil", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_003", family: "confused_user_help", input: "hej jak ti mam rict ze chci pripomenout doktora", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_004", family: "help_tier_b_chaos", input: "jak to mam vlastne napsat", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_005", family: "help_tier_b_chaos", input: "jak mam napsat schuzku", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_006", family: "help_tier_b_chaos", input: "co mam napsat aby si to udelal", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_007", family: "help_tier_b_chaos", input: "jak se to dela", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_008", family: "help_tier_b_chaos", input: "jak mam ulozit neco do kalendare", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_009", family: "help_tier_b_chaos", input: "co ti mam napsat", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_010", family: "onboarding_realism", input: "Jak fungují úkoly?", mode: "help", tier: "A" },
  { id: "PBUX_REPLAY_011", family: "retrieval_ranking_quality", input: "Najdi tu poznámku o tričku", mode: "retrieval_rank", tier: "A", expectNoteId: "n_shirt_new" },
  { id: "PBUX_REPLAY_012", family: "retrieval_ranking_quality", input: "Najdi to jak jsem psal o doktorovi", mode: "retrieval_rank", tier: "A", expectNoteId: "n_doctor_new" },
  { id: "PBUX_REPLAY_013", family: "long_session_isolation", input: "HELP_THEN_SAVE_CHAIN", mode: "long_session", tier: "A" },
  { id: "PBUX_REPLAY_014", family: "search_after_save_flow", input: "SEARCH_AFTER_SAVE_CHAIN", mode: "long_session", tier: "A" }
];

const FAMILY_TEMPLATES = {
  help_tier_b_chaos: [
    "jak mam napsat ukol",
    "co ti mam napsat",
    "jak to mam napsat",
    "jak mam dat schuzku",
    "jak mam ulozit poznamku",
    "jak mam hledat",
    "co vsechno umis",
    "jak fungujes",
    "co mam napsat aby si to udelal",
    "jak mam zadat pripominku",
    "jak funguje vyhledavani",
    "jak funguje kalendar",
    "co mam napsat abys to pochopil",
    "jak mam zadat vice veci najednou"
  ],
  onboarding_chaos_mobile: ["jak zacit", "jak to pouzivat", "napoveda", "pomoc", "kdo jsi", "jak funguje silver"],
  spoken_czech_help: ["mluv cesky", "fungujes offline", "jak mi mas rozumet", "potrebujes internet"],
  confused_user_help: ["nevím co napsat", "jsem zmateny", "pomoc nechci nic ukladat", "fakt nechapu jak to funguje"],
  dirty_czech_onboarding: ["jak funguju ukoly", "co umis", "jak ulozit schuzku", "jak funguje kalendar"],
  capability_question_mutations: ["co umis", "co dokazes", "umis kalendar", "umis hledat", "co se da ulozit"],
  conversational_guidance_quality: ["dej mi priklad prikazu", "jak mam formulovat prikazy", "ukaz priklad schuzky"],
  conversational_naturalness: ["jak funguje silver", "s cim mi pomuzes", "jak funguje vyhledavani"],
  retrieval_ranking_quality: ["najdi poznamku o tricku kuby", "najdi poznamku o doktorovi", "najdi to o kubovi"],
  retrieval_candidate_priority: ["najdi triko kuby", "najdi schuzku s doktorem"],
  lexical_ranking_validation: ["najdi pin ke karte", "najdi velikost tricka"],
  exact_vs_partial_match: ["najdi tricko kateriny", "najdi poznamku pin"],
  recency_ranking: ["najdi co jsem resil s kubou", "najdi poznamku o kubovi"],
  temporal_relevance_ranking: ["najdi co jsem resil minulej tejden", "najdi co jsem resil vcera"],
  title_vs_note_priority: ["najdi poznamku triko", "najdi narozeniny kateriny"],
  long_session_isolation: ["LONG_HELP_SAVE_CHAIN"],
  stale_context_reset: ["LONG_HELP_SEARCH_CHAIN"],
  orchestration_cross_turn_isolation: ["LONG_SAVE_HELP_CHAIN"],
  stale_payload_protection: ["LONG_SAVE_CLARIFY_HELP"],
  stale_clarification_protection: ["LONG_CLARIFY_HELP_CHAIN"],
  public_beta_conversation_chaos: ["hele co umis", "no silver jak fungujou ukoly", "vole jak to funguje"],
  mutation_robustness: ["jak mam napsat ukol", "co ti mam napsat", "jak funguje kalendar"],
  onboarding_realism: ["jak zacit se silver", "jak to pouzivat", "co mam delat prvni"],
  realistic_mobile_help: ["hele jak ulozit schuzku", "no co umis", "kratce jak fungujou ukoly"],
  public_beta_confused_users: ["nevím jak to napsat", "jak to mam vlastne napsat", "co mam napsat"],
  conversational_followup_turns: ["LONG_FOLLOWUP_CHAIN"],
  retrieval_trust_realism: ["najdi poznamku o triku", "kde je poznamka o doktorovi"],
  capability_help_realism: ["umis ukladat do kalendare", "dokazes mi ulozit neco"],
  update_after_help_flow: ["LONG_HELP_UPDATE_CHAIN"],
  search_after_save_flow: ["LONG_SAVE_SEARCH_CHAIN"]
};

const PREFIXES = ["", "Hele ", "No ", "Silver ", "Prosím ", "Krátce ", "Vlastně "];
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
  if (family.indexOf("retrieval") >= 0 || family.indexOf("lexical") >= 0 || family.indexOf("recency") >= 0) {
    return "retrieval_rank";
  }
  if (family.indexOf("temporal_relevance") >= 0 || family.indexOf("exact_vs") >= 0 || family.indexOf("title_vs") >= 0) {
    return "retrieval_rank";
  }
  if (family.indexOf("long_session") >= 0 || family.indexOf("stale") >= 0 || family.indexOf("orchestration") >= 0) {
    return "long_session";
  }
  if (family.indexOf("search_after") >= 0 || family.indexOf("update_after") >= 0 || family.indexOf("followup") >= 0) {
    return "long_session";
  }
  return "help";
}

function buildRankingSeedCtx() {
  const n = new Date("2026-05-04T12:00:00");
  const oldTs = n.getTime() - 120 * 86400000;
  const newTs = n.getTime() - 2 * 86400000;
  return {
    now: n,
    getEventsSnapshot: function () {
      return [
        { id: "e_doc_old", date: "2026-01-10", time: "09:00", title: "Doktor starý", address: "", note: "stará návštěva" },
        { id: "e_doc_new", date: "2026-05-10", time: "10:00", title: "Schůzka s doktorem", address: "", note: "nová kontrola" }
      ];
    },
    getTasksSnapshot: function () {
      return [];
    },
    getNotesSnapshot: function () {
      return [
        {
          id: "n_shirt_old",
          title: "Kuba staré",
          content: "dávno jsme řešili tričko s Kubou velikost S",
          createdAt: oldTs,
          updatedAt: oldTs,
          pinned: false,
          tags: [],
          deleted: false
        },
        {
          id: "n_shirt_new",
          title: "Tričko Kuby",
          content: "Kuba má tričko velikost M — aktuální",
          createdAt: newTs,
          updatedAt: newTs,
          pinned: false,
          tags: [],
          deleted: false
        },
        {
          id: "n_doctor_old",
          title: "Doktor poznámka stará",
          content: "starý záznam o doktorovi",
          createdAt: oldTs,
          updatedAt: oldTs,
          pinned: false,
          tags: [],
          deleted: false
        },
        {
          id: "n_doctor_new",
          title: "Doktor",
          content: "jak jsem psal o doktorovi — kontrola v květnu",
          createdAt: newTs,
          updatedAt: newTs,
          pinned: true,
          tags: [],
          deleted: false
        },
        {
          id: "n_pin",
          title: "PIN",
          content: "pin ke kartě je doma",
          createdAt: oldTs,
          updatedAt: oldTs,
          pinned: false,
          tags: [],
          deleted: false
        }
      ];
    }
  };
}

function buildCorpusV1(targetCount) {
  const cases = [];
  for (let i = 0; i < TIER_A_REPLAY.length; i++) {
    cases.push(Object.assign({}, TIER_A_REPLAY[i]));
  }
  const budgets = {
    help_tier_b_chaos: 120,
    onboarding_chaos_mobile: 40,
    spoken_czech_help: 40,
    confused_user_help: 50,
    dirty_czech_onboarding: 50,
    capability_question_mutations: 50,
    conversational_guidance_quality: 40,
    conversational_naturalness: 40,
    retrieval_ranking_quality: 50,
    retrieval_candidate_priority: 40,
    lexical_ranking_validation: 40,
    exact_vs_partial_match: 35,
    recency_ranking: 35,
    temporal_relevance_ranking: 35,
    title_vs_note_priority: 35,
    long_session_isolation: 45,
    stale_context_reset: 40,
    orchestration_cross_turn_isolation: 40,
    stale_payload_protection: 40,
    stale_clarification_protection: 35,
    public_beta_conversation_chaos: 50,
    mutation_robustness: 50,
    onboarding_realism: 45,
    realistic_mobile_help: 45,
    public_beta_confused_users: 45,
    conversational_followup_turns: 35,
    retrieval_trust_realism: 40,
    capability_help_realism: 40,
    update_after_help_flow: 35,
    search_after_save_flow: 35
  };
  const rng = core.mulberry32(0x50425558);
  let n = cases.length;
  const perFamilyDefault = Math.max(30, Math.ceil((targetCount - cases.length) / AUDIT_FAMILIES.length));
  for (let f = 0; f < AUDIT_FAMILIES.length; f++) {
    const family = AUDIT_FAMILIES[f];
    const tpls = FAMILY_TEMPLATES[family] || ["co umis"];
    const count = budgets[family] || perFamilyDefault;
    for (let i = 0; i < count; i++) {
      n++;
      const base = tpls[i % tpls.length];
      if (base.indexOf("LONG_") === 0 || base.indexOf("CHAIN") > 0) {
        cases.push({ id: "PBUX_" + String(n).padStart(6, "0"), family: family, input: base, mode: modeForFamily(family), tier: "B" });
        continue;
      }
      const pfx = PREFIXES[Math.floor(rng() * PREFIXES.length)];
      const sfx = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
      const chaos = CHAOS_FILLERS[Math.floor(rng() * CHAOS_FILLERS.length)];
      let input = chaos + pfx + base + sfx;
      const mask = core.deriveMutationMask(family, i, 0x50425558);
      input = core.applyMutationLayers(input, mask, rng);
      cases.push({
        id: "PBUX_" + family.slice(0, 8).toUpperCase() + "_" + String(n).padStart(6, "0"),
        family: family,
        input: input,
        mode: modeForFamily(family),
        tier: "B"
      });
    }
  }
  while (cases.length < targetCount) {
    n++;
    const family = AUDIT_FAMILIES[n % AUDIT_FAMILIES.length];
    const tpls = FAMILY_TEMPLATES[family] || ["jak mam napsat ukol"];
    const base = tpls[n % tpls.length];
    const mask = core.deriveMutationMask(family, n, 0x50425558);
    let input = core.applyMutationLayers(base, mask, rng);
    cases.push({
      id: "PBUX_PAD_" + String(n).padStart(6, "0"),
      family: family,
      input: input,
      mode: modeForFamily(family),
      tier: "B"
    });
  }
  return cases.slice(0, targetCount);
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function runLongSessionChain(eng, chainId, ctx) {
  const issues = [];
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  let prev = eng.createEmptyDraft();
  const steps =
    chainId === "HELP_THEN_SAVE_CHAIN" || chainId === "LONG_HELP_SAVE_CHAIN"
      ? ["Jak fungují úkoly?", "Připomeň mi zítra koupit mléko"]
      : chainId === "SEARCH_AFTER_SAVE_CHAIN" || chainId === "LONG_SAVE_SEARCH_CHAIN"
        ? ["Zítra v 10 schůzka s Kubou", "Najdi poznámku o tričku"]
        : chainId === "LONG_HELP_SEARCH_CHAIN"
          ? ["co ti mám napsat", "Najdi poznámku o tričku Kateřiny"]
          : chainId === "LONG_SAVE_HELP_CHAIN"
            ? ["Zítra v 10 schůzka", "Jak funguje kalendář?"]
            : chainId === "LONG_SAVE_CLARIFY_HELP"
              ? ["Schůzka zítra", "Ne", "Co mám napsat?"]
              : chainId === "LONG_CLARIFY_HELP_CHAIN"
                ? ["Přesuň schůzku", "Jak mám napsat úkol?"]
                : chainId === "LONG_HELP_UPDATE_CHAIN"
                  ? ["Jak funguje kalendář?", "Dnešní schůzku s Novákem přesuň na 22"]
                  : chainId === "LONG_FOLLOWUP_CHAIN"
                    ? ["Jak mám napsat schůzku?", "A co úkol?"]
                    : ["Jak funguje kalendář?", "Co mám dnes v kalendáři?"];
  let helpTurn = null;
  let lastTurn = null;
  for (let si = 0; si < steps.length; si++) {
    lastTurn = eng.processUserTurn(steps[si], prev, ctx || harness.ctxForCase("calendar_write"));
    if (STATIC_ASSISTANT.has(String(lastTurn.normalizedIntent || ""))) helpTurn = lastTurn;
    prev = lastTurn.draft && lastTurn.draft.targetContainer !== "none" ? lastTurn.draft : prev;
  }
  if (chainId.indexOf("HELP") >= 0 && helpTurn) {
    const shell = helpGov.turnWouldLeakSaveShell(helpTurn, eng);
    for (let hi = 0; hi < shell.length; hi++) issues.push(shell[hi]);
  }
  if (chainId.indexOf("SAVE") >= 0 || chainId.indexOf("SEARCH") >= 0) {
    const intent = String(lastTurn.normalizedIntent || "");
    if (chainId.indexOf("SEARCH") >= 0 && WRITE_INTENTS.has(intent)) issues.push("search_save_contamination:" + intent);
    if (chainId.indexOf("HELP") >= 0 && steps.length > 1 && WRITE_INTENTS.has(intent) && chainId.indexOf("UPDATE") < 0) {
      void intent;
    }
  }
  const peek = eng.iuSilverSessionStateGovernancePeekV1 ? eng.iuSilverSessionStateGovernancePeekV1() : {};
  if (helpTurn && peek.draftRegistryCount > 2 && chainId.indexOf("SAVE") < 0) {
    issues.push("help_draft_registry_growth:" + peek.draftRegistryCount);
  }
  return { issues, lastTurn, helpTurn };
}

function evaluateRetrievalRank(eng, c, ctx) {
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (WRITE_INTENTS.has(intent)) issues.push("retrieval_write_leak:" + intent);
  const sr = turn.silverSearchResult || (turn.readAnswer && turn.readAnswer.silverSearch);
  const br = sr && sr.bestResult;
  const note = br && br.payload && br.payload.note;
  if (c.expectNoteId && note && String(note.id) !== c.expectNoteId) {
    issues.push("wrong_top_candidate:" + String(note.id) + "!=" + c.expectNoteId);
  }
  if (c.expectNoteId && (!note || !note.id)) {
    if (intent.indexOf(".read") < 0 && ps !== "READ_OK") issues.push("missing_top_candidate");
    else if (intent.indexOf(".read") >= 0) issues.push("missing_top_candidate");
    else issues.push("missing_top_candidate");
  }
  return { issues, turn };
}

function evaluateCase(eng, c, ctxHelp, ctxRank) {
  const mode = c.mode || modeForFamily(c.family);
  if (mode === "long_session" || (c.input && c.input.indexOf("CHAIN") > 0)) {
    const chainId = c.input.indexOf("CHAIN") > 0 ? c.input : "LONG_HELP_SAVE_CHAIN";
    const r = runLongSessionChain(eng, chainId, ctxRank);
    return { id: c.id, family: c.family, input: c.input, issues: r.issues, pass: r.issues.length === 0, turn: r.lastTurn };
  }
  if (mode === "retrieval_rank") {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const r = evaluateRetrievalRank(eng, c, ctxRank);
    return { id: c.id, family: c.family, input: c.input, issues: r.issues, pass: r.issues.length === 0, turn: r.turn };
  }
  const r = helpGov.runHelpGovernanceCase(eng, c);
  r.family = c.family;
  return r;
}

function runAudit(harnessId, cases, reportPath, extra) {
  const eng = harness.loadEngine();
  const ctxHelp = harness.ctxForCase("calendar_write");
  const ctxRank = buildRankingSeedCtx();
  const results = [];
  let pass = 0;
  let helpContamination = 0;
  let placeholderCount = 0;
  let wrongTop = 0;
  let staleLeaks = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = evaluateCase(eng, c, ctxHelp, ctxRank);
    results.push(r);
    if (r.pass) pass++;
    else {
      for (let j = 0; j < r.issues.length; j++) {
        const iss = r.issues[j];
        if (iss.indexOf("write_intent") >= 0 || iss.indexOf("save_processing") >= 0 || iss.indexOf("draft_") >= 0) {
          helpContamination++;
        }
        if (iss.indexOf("placeholder") >= 0) placeholderCount++;
        if (iss.indexOf("wrong_top") >= 0) wrongTop++;
        if (iss.indexOf("stale") >= 0 || iss.indexOf("registry_growth") >= 0) staleLeaks++;
      }
    }
  }
  const total = cases.length;
  const helpCases = cases.filter(function (x) {
    return (x.mode || modeForFamily(x.family)) === "help";
  }).length;
  const retrievalCases = cases.filter(function (x) {
    return (x.mode || modeForFamily(x.family)) === "retrieval_rank";
  }).length;
  const longCases = cases.filter(function (x) {
    return (x.mode || modeForFamily(x.family)) === "long_session";
  }).length;
  const mobileCases = cases.filter(function (x) {
    return x.family.indexOf("mobile") >= 0 || x.family.indexOf("chaos") >= 0;
  }).length;
  const report = Object.assign(
    {
      harness_id: harnessId,
      main_commit: mainCommit(),
      cases_total: total,
      pass_count: pass,
      fail_count: total - pass,
      accuracy_pct: total ? Math.round((pass / total) * 1000) / 10 : 0,
      help_contamination_count: helpContamination,
      placeholder_answer_count: placeholderCount,
      wrong_top_candidate_count: wrongTop,
      stale_context_leaks: staleLeaks,
      generated_cases: total,
      help_cases: helpCases,
      retrieval_cases: retrievalCases,
      long_session_cases: longCases,
      mobile_cases: mobileCases,
      audit_families: AUDIT_FAMILIES.slice(),
      fails: results.filter(function (x) {
        return !x.pass;
      }).slice(0, 40)
    },
    extra || {}
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return { report, eng };
}

function filterFamilies(cases, families) {
  const set = new Set(families);
  return cases.filter(function (c) {
    return set.has(c.family);
  });
}

function filterMode(cases, mode) {
  return cases.filter(function (c) {
    return (c.mode || modeForFamily(c.family)) === mode;
  });
}

function printHeader(tag, report, minPct) {
  console.log("=== " + tag.toUpperCase() + " ===");
  console.log("cases_total=" + report.cases_total);
  console.log("pass_count=" + report.pass_count);
  console.log("accuracy_pct=" + report.accuracy_pct);
  console.log("help_contamination_count=" + report.help_contamination_count);
  console.log("wrong_top_candidate_count=" + report.wrong_top_candidate_count);
  console.log("stale_context_leaks=" + report.stale_context_leaks);
  console.log("PASS_FAIL=" + (report.pass_count === report.cases_total ? "PASS" : "FAIL"));
  console.log("=== END_" + tag.toUpperCase() + " ===");
  if (report.help_contamination_count > 0) return false;
  if (minPct != null && report.accuracy_pct < minPct) return false;
  return report.pass_count === report.cases_total;
}

module.exports = {
  AUDIT_FAMILIES,
  TIER_A_REPLAY,
  buildCorpusV1,
  buildRankingSeedCtx,
  runAudit,
  filterFamilies,
  filterMode,
  printHeader,
  evaluateCase,
  modeForFamily
};
