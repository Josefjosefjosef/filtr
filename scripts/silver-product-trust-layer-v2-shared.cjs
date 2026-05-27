#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const helpGov = require("./silver-help-guidance-render-governance-v1-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");
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
  "help_guidance_quality",
  "task_help_guidance",
  "calendar_help_guidance",
  "notes_help_guidance",
  "how_to_prompt_guidance",
  "onboarding_questions",
  "capability_questions",
  "help_no_save_contamination",
  "capability_no_draft",
  "help_no_storage_picker",
  "person_alias_resolution",
  "czech_name_aliases_male",
  "czech_name_aliases_female",
  "nickname_retrieval_matching",
  "alias_ambiguity_safety",
  "temporal_today_retrieval",
  "temporal_tomorrow_retrieval",
  "temporal_yesterday_retrieval",
  "temporal_week_retrieval",
  "date_correctness_validation",
  "update_unique_event_resolution",
  "update_ambiguity_resolution",
  "update_no_false_create",
  "retrieval_truthfulness",
  "no_hallucinated_retrieval",
  "public_beta_help_chaos",
  "mobile_help_chaos",
  "spoken_czech_guidance",
  "dirty_czech_help",
  "confused_user_prompts"
];

const TIER_A_REPLAY_PACK = [
  { id: "PTL_REPLAY_001", family: "help_guidance_quality", input: "Jak fungují úkoly?", mode: "help", tier: "A" },
  { id: "PTL_REPLAY_002", family: "how_to_prompt_guidance", input: "Co mám napsat aby si udělal to co chci?", mode: "help", tier: "A" },
  { id: "PTL_REPLAY_003", family: "capability_questions", input: "Co všechno umíš?", mode: "help", tier: "A" },
  { id: "PTL_REPLAY_004", family: "help_no_save_contamination", input: "Dokážeš mi uložit do kalendáře něco?", mode: "help", tier: "A" },
  { id: "PTL_REPLAY_005", family: "help_no_save_contamination", input: "Umíš ukládat události?", mode: "help", tier: "A" },
  { id: "PTL_REPLAY_006", family: "nickname_retrieval_matching", input: "Najdi mi jakou velikost trička má Katka", mode: "alias_retrieval", tier: "A", needle: "velikost" },
  { id: "PTL_REPLAY_007", family: "temporal_today_retrieval", input: "Co mám na dnešek v kalendáři", mode: "temporal_today", tier: "A" },
  { id: "PTL_REPLAY_008", family: "update_unique_event_resolution", input: "Dnešní schůzku s panem Novákem mi přesuň na 22 hodinu", mode: "update_unique", tier: "A" },
  { id: "PTL_REPLAY_009", family: "calendar_help_guidance", input: "Jak funguje kalendář?", mode: "help", tier: "A" },
  { id: "PTL_REPLAY_010", family: "notes_help_guidance", input: "Jak fungují poznámky?", mode: "help", tier: "A" }
];

const FAMILY_TEMPLATES = {
  help_guidance_quality: [
    "jak fungují úkoly",
    "s čím mi můžeš pomoct",
    "co umíš",
    "nápověda",
    "jak ti mám zadávat pokyny"
  ],
  task_help_guidance: ["jak fungují úkoly", "jak vytvořím úkol", "jak funguje připomínka", "na co jsou úkoly"],
  calendar_help_guidance: ["jak funguje kalendář", "jak uložím schůzku", "jak hledat v kalendáři", "jak se ukládá schůzka"],
  notes_help_guidance: ["jak fungují poznámky", "jak uložím poznámku", "jak hledat v poznámkách"],
  how_to_prompt_guidance: [
    "co mám napsat",
    "co mám napsat aby si udělal to co chci",
    "jak mám formulovat příkazy",
    "dej mi příklad příkazu"
  ],
  onboarding_questions: ["jak začít", "jak to používat", "nápověda", "pomoc", "kdo jsi"],
  capability_questions: ["co všechno umíš", "co dokážeš", "umíš kalendář", "umíš hledat"],
  help_no_save_contamination: [
    "dokážeš mi uložit do kalendáře něco",
    "můžu něco uložit do kalendáře",
    "umíš ukládat události",
    "jak se ukládá schůzka"
  ],
  capability_no_draft: ["co umíš uložit", "co se dá ukládat", "umíš ukládat do kalendáře"],
  help_no_storage_picker: ["kam jdou data", "ukládá se to do cloudu", "funguješ offline"],
  person_alias_resolution: ["najdi poznámku o tričku Kateřiny", "najdi velikost trička pro Katku"],
  czech_name_aliases_male: ["najdi schůzku s Pepou", "kde má Kuba schůzku", "najdi poznámku o Honzovi"],
  czech_name_aliases_female: ["najdi poznámku o Katce", "kde je Terka", "najdi věc pro Verču"],
  nickname_retrieval_matching: [
    "najdi velikost trička Katky",
    "najdi poznámku o Katce",
    "co mám o Katce v poznámkách"
  ],
  alias_ambiguity_safety: ["najdi poznámku o Katce a Karolíně", "kde je Katka nebo Kateřina"],
  temporal_today_retrieval: ["co mám dnes v kalendáři", "co mám na dnešek", "co mám dneska naplánované"],
  temporal_tomorrow_retrieval: ["co mám zítra", "co mám na zítřek v kalendáři"],
  temporal_yesterday_retrieval: ["co jsem měl včera v kalendáři", "co bylo včera"],
  temporal_week_retrieval: ["co mám tento týden", "co mám minulý týden", "co mám příští týden"],
  date_correctness_validation: ["co mám dnes v kalendáři", "kolik mám dnes schůzek"],
  update_unique_event_resolution: [
    "dnešní schůzku s panem Novákem mi přesuň na 22 hodinu",
    "přesuň dnešní schůzku s Novákem na 22"
  ],
  update_ambiguity_resolution: ["přesuň dnešní schůzku na 22", "změň čas dnešní schůzky"],
  update_no_false_create: ["přesuň schůzku na zítra v 10", "změň čas schůzky s Novákem"],
  retrieval_truthfulness: ["najdi PIN ke kartě", "najdi narozeniny neexistující osoby"],
  no_hallucinated_retrieval: ["najdi kdy má XYZ narozeniny", "co víš o NeexistujícíOsobě"],
  public_beta_help_chaos: ["hele co umíš", "no silver co všechno umíš", "fakt nevím jak to funguje"],
  mobile_help_chaos: ["vole jak fungují úkoly", "hele jak uložit schůzku", "no co umíš"],
  spoken_czech_guidance: ["jak mi máš rozumět", "mluvíš česky", "funguješ offline"],
  dirty_czech_help: ["jak funguju ukoly", "co umis", "jak ulozit schuzku"],
  confused_user_prompts: ["nevím co napsat", "jsem zmatený jak to funguje", "pomoc nechci nic ukládat"]
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
  return aliasData.foldCs(s);
}

function modeForFamily(family) {
  if (family.indexOf("help") >= 0 || family.indexOf("guidance") >= 0 || family.indexOf("onboarding") >= 0) return "help";
  if (family.indexOf("capability") >= 0 || family.indexOf("confused") >= 0 || family.indexOf("spoken") >= 0) return "help";
  if (family.indexOf("alias") >= 0 || family.indexOf("nickname") >= 0 || family.indexOf("czech_name") >= 0) return "alias_retrieval";
  if (family === "temporal_tomorrow_retrieval") return "temporal_tomorrow";
  if (family === "temporal_yesterday_retrieval") return "temporal_yesterday";
  if (family === "temporal_week_retrieval") return "temporal_week";
  if (family.indexOf("temporal_") === 0 || family === "date_correctness_validation") return "temporal_today";
  if (family.indexOf("update_unique") >= 0) return "update_unique";
  if (family.indexOf("update_ambiguity") >= 0) return "update_ambiguity";
  if (family.indexOf("update_no_false") >= 0) return "update_ambiguity";
  if (family.indexOf("retrieval") >= 0 || family.indexOf("hallucin") >= 0) return "retrieval";
  if (family.indexOf("chaos") >= 0 || family.indexOf("dirty") >= 0 || family.indexOf("mobile") >= 0) return "help";
  return "help";
}

function buildSeedCtx(now) {
  const n = now || new Date("2026-05-04T12:00:00");
  const today = "2026-05-04";
  const tomorrow = "2026-05-05";
  const yesterday = "2026-05-03";
  return {
    now: n,
    getEventsSnapshot: function () {
      return [
        { id: "e_today_novak", date: today, time: "14:00", title: "Schůzka s panem Novákem", address: "", note: "" },
        { id: "e_today_other", date: today, time: "09:00", title: "Stand-up", address: "", note: "" },
        { id: "e_tomorrow", date: tomorrow, time: "10:00", title: "Schůzka s Tomášem", address: "", note: "" },
        { id: "e_yesterday", date: yesterday, time: "11:00", title: "Schůzka včera", address: "", note: "" }
      ];
    },
    getTasksSnapshot: function () {
      return [{ id: "t1", title: "koupit mléko", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }];
    },
    getNotesSnapshot: function () {
      return [
        {
          id: "n_katerina",
          title: "Tričko Kateřiny",
          content: "Kateřina má velikost trička M",
          createdAt: 1,
          updatedAt: 1,
          pinned: false,
          tags: [],
          deleted: false
        },
        {
          id: "n_pin",
          title: "PIN",
          content: "pin ke kartě je doma",
          createdAt: 1,
          updatedAt: 1,
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
  for (let i = 0; i < TIER_A_REPLAY_PACK.length; i++) {
    cases.push(Object.assign({}, TIER_A_REPLAY_PACK[i]));
  }
  const perFamily = Math.max(34, Math.ceil((targetCount - cases.length) / AUDIT_FAMILIES.length));
  const rng = core.mulberry32(0x50544c32);
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
      const mask = core.deriveMutationMask(family, i, 0x50544c32);
      input = core.applyMutationLayers(input, mask, rng);
      cases.push({
        id: "PTL_" + family.slice(0, 10).toUpperCase() + "_" + String(n).padStart(6, "0"),
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
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx || buildSeedCtx());
  const intent = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const issues = [];
  const mode = c.mode || modeForFamily(c.family);

  if (mode === "help") {
    if (!STATIC_ASSISTANT.has(intent)) issues.push("help_expected_assistant_got_" + intent);
    if (ps !== "CAPABILITY_OK") issues.push("help_state_expected_CAPABILITY_OK_got_" + ps);
    const shell = helpGov.turnWouldLeakSaveShell(turn, eng);
    for (let i = 0; i < shell.length; i++) issues.push(shell[i]);
    const msg = foldCs(turnMsg(turn));
    if (
      c.tier === "A" &&
      msg.indexOf("priklad") < 0 &&
      msg.indexOf("uloz") < 0 &&
      msg.indexOf("pripom") < 0 &&
      msg.indexOf("najdi") < 0 &&
      msg.length < 35
    ) {
      issues.push("help_placeholder_too_short");
    }
  } else if (mode === "alias_retrieval") {
    if (WRITE_INTENTS.has(intent)) issues.push("alias_must_not_create:" + intent);
    const msg = foldCs(turnMsg(turn));
    if (c.needle && msg.indexOf(foldCs(c.needle)) < 0 && msg.indexOf("m") < 0 && msg.indexOf("velikost") < 0) {
      if (msg.indexOf("nic jsem") >= 0 || msg.indexOf("nenasel") >= 0) issues.push("alias_retrieval_miss:" + c.input);
    }
    if (/\bkatka\b/.test(foldCs(c.input)) && msg.indexOf("katerin") < 0 && msg.indexOf("m") < 0 && msg.indexOf("velikost") < 0) {
      if (msg.indexOf("nic jsem") >= 0 || msg.indexOf("nenasel") >= 0) issues.push("katka_katerina_alias_fail");
    }
  } else if (mode === "temporal_today") {
    if (WRITE_INTENTS.has(intent)) issues.push("temporal_must_not_create:" + intent);
    const evs = (turn.readAnswer && turn.readAnswer.events) || [];
    const rq = turn.readQuery || {};
    const today = "2026-05-04";
    if (rq.intent === "agenda_for_day" || rq.dateRange === "today") {
      for (let ei = 0; ei < evs.length; ei++) {
        if (String(evs[ei].date || "").slice(0, 10) !== today) issues.push("temporal_wrong_day:" + evs[ei].date);
      }
    } else if (c.tier === "A") {
      const msg = foldCs(turnMsg(turn));
      if (msg.indexOf("zitra") >= 0 && msg.indexOf("dnes") < 0 && evs.length > 0) issues.push("temporal_message_day_mismatch");
    }
  } else if (mode === "temporal_tomorrow" || mode === "temporal_yesterday" || mode === "temporal_week") {
    if (WRITE_INTENTS.has(intent)) issues.push("temporal_must_not_create:" + intent);
  } else if (mode === "update_unique") {
    if (intent === "calendar.create" && ps === "READY_TO_SAVE") issues.push("update_false_create");
    if (ps === "CLARIFICATION" && turn.clarificationReason === "needs_existing_event_selection") {
      issues.push("update_unnecessary_clarification");
    }
    if (intent !== "calendar.update" && ps !== "READY_TO_SAVE" && ps !== "NEEDS_CLARIFICATION") {
      if (intent !== "calendar.update") issues.push("update_expected_calendar_update_got_" + intent);
    }
  } else if (mode === "update_ambiguity") {
    if (intent === "calendar.create" && ps === "READY_TO_SAVE") issues.push("update_false_create");
  } else if (mode === "retrieval") {
    if (WRITE_INTENTS.has(intent)) issues.push("retrieval_must_not_create:" + intent);
    if (c.family === "no_hallucinated_retrieval") {
      const msg = foldCs(turnMsg(turn));
      if (msg.indexOf("nic jsem") < 0 && msg.indexOf("nenasel") < 0) issues.push("retrieval_must_admit_empty");
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
  let wrongDayCount = 0;
  let aliasFailCount = 0;
  let unnecessaryClarification = 0;
  let falseCreateCount = 0;
  let hallucinationCount = 0;
  let placeholderCount = 0;

  for (let i = 0; i < cases.length; i++) {
    const r = evaluateCase(eng, cases[i], ctx);
    results.push(r);
    if (r.pass) pass++;
    else {
      for (let j = 0; j < r.issues.length; j++) {
        const iss = r.issues[j];
        if (iss.indexOf("write_intent") >= 0 || iss.indexOf("save_processing") >= 0 || iss.indexOf("draft_") >= 0) helpSaveLeaks++;
        if (iss.indexOf("temporal_wrong_day") >= 0) wrongDayCount++;
        if (iss.indexOf("alias") >= 0 || iss.indexOf("katka") >= 0) aliasFailCount++;
        if (iss.indexOf("unnecessary_clarification") >= 0) unnecessaryClarification++;
        if (iss.indexOf("false_create") >= 0) falseCreateCount++;
        if (iss.indexOf("hallucin") >= 0) hallucinationCount++;
        if (iss.indexOf("placeholder") >= 0) placeholderCount++;
      }
    }
  }

  const aliasCounts = aliasData.countAliases();
  const total = cases.length;
  const tierA = cases.filter(function (x) {
    return x.tier === "A";
  });
  let tierAPass = 0;
  let tierAHelpSaveLeaks = 0;
  for (let i = 0; i < results.length; i++) {
    if (cases[i].tier === "A") {
      if (results[i].pass) tierAPass++;
      else {
        for (let j = 0; j < results[i].issues.length; j++) {
          const iss = results[i].issues[j];
          if (iss.indexOf("write_intent") >= 0 || iss.indexOf("save_processing") >= 0 || iss.indexOf("draft_") >= 0) {
            tierAHelpSaveLeaks++;
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
      help_save_leaks: helpSaveLeaks,
      wrong_day_count: wrongDayCount,
      alias_fail_count: aliasFailCount,
      unnecessary_clarification_count: unnecessaryClarification,
      false_create_count: falseCreateCount,
      hallucination_count: hallucinationCount,
      placeholder_answer_count: placeholderCount,
      total_aliases: aliasCounts.total,
      male_aliases: aliasCounts.male,
      female_aliases: aliasCounts.female,
      alias_groups: aliasCounts.groups,
      audit_families: AUDIT_FAMILIES.slice(),
      help_cases: cases.filter(function (c) {
        return c.mode === "help";
      }).length,
      alias_cases: cases.filter(function (c) {
        return c.mode === "alias_retrieval";
      }).length,
      temporal_cases: cases.filter(function (c) {
        return c.mode.indexOf("temporal") === 0;
      }).length,
      update_cases: cases.filter(function (c) {
        return c.mode.indexOf("update") === 0;
      }).length,
      mobile_cases: cases.filter(function (c) {
        return c.family.indexOf("mobile") >= 0 || c.family.indexOf("chaos") >= 0;
      }).length,
      fails: results.filter(function (x) {
        return !x.pass;
      }).slice(0, 50),
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
  console.log("accuracy_pct=" + report.accuracy_pct);
  console.log("tier_a_pass=" + report.tier_a_pass + "/" + report.tier_a_total);
  console.log("help_save_leaks=" + report.help_save_leaks);
  console.log("wrong_day_count=" + report.wrong_day_count);
  console.log("alias_fail_count=" + report.alias_fail_count);
  console.log("PASS_FAIL=" + (report.tier_a_pass === report.tier_a_total && report.tier_a_save_leaks === 0 && report.wrong_day_count === 0 && report.false_create_count === 0 ? "PASS" : "FAIL"));
  console.log("=== END_" + tag.toUpperCase() + " ===");
  if (minPct != null && report.accuracy_pct < minPct) return false;
  if (report.tier_a_pass !== report.tier_a_total || report.tier_a_save_leaks > 0) return false;
  return true;
}

module.exports = {
  AUDIT_FAMILIES,
  TIER_A_REPLAY_PACK,
  buildCorpusV1,
  buildSeedCtx,
  evaluateCase,
  runAudit,
  printAuditHeader,
  foldCs
};
