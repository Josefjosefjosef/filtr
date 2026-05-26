#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const capShared = require("./silver-line-o-capability-audit-shared.cjs");
const orchShared = require("./silver-orchestration-stabilization-v2-shared.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");

const REPO = path.resolve(__dirname, "..");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const STATIC_ASSISTANT = new Set(["assistant.capability", "assistant.help", "assistant.guidance"]);

const CRITICAL_HELP_PACK = [
  "Co umíš?",
  "Silvere co všechno umíš?",
  "Na co jsou úkoly?",
  "Jak fungují úkoly?",
  "Jak fungují poznámky?",
  "Jak funguje kalendář?",
  "Jak fungují připomínky?",
  "Jak můžu něco vyhledat v kalendáři?",
  "Jak funguje vyhledávání?",
  "Jak vytvořím schůzku?",
  "Jak vytvořím úkol?",
  "Jak vytvořím poznámku?",
  "Jak fungují follow-upy?",
  "Co všechno umíš uložit?",
  "Umíš připomínky?",
  "Umíš kalendář?",
  "Umíš poznámky?",
  "Umíš úkoly?",
  "Jak funguje Silver?",
  "Jak funguje pokračování konverzace?",
  "Jak fungují drafty?",
  "Jak funguje agenda?",
  "Jak funguje organizace dne?",
  "Co když nechci nic ukládat?",
  "Jen mi vysvětli jak fungují úkoly",
  "Jen mi ukaž příklad vytvoření schůzky",
  "Jak najdu starou poznámku?",
  "Jak hledat v kalendáři?",
  "Jak funguje hledání?",
  "Jak funguje připomenutí?",
  "Jak fungují termíny?",
  "K čemu jsou poznámky?",
  "Na co je kalendář?",
  "Jak funguje ukládání?",
  "Jak funguje vyhledávání poznámek?",
  "Jak fungují připomínky v kalendáři?",
  "Jak fungují úkoly bez termínu?",
  "Jak funguje plánování?",
  "Co se dá ukládat?",
  "Jak mám napsat schůzku?",
  "Jak mám napsat připomínku?",
  "Jak mám napsat poznámku?",
  "Jak mám napsat úkol?",
  "Jak uložím něco do kalendáře?"
];

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function foldCs(s) {
  return capShared.foldCs(s);
}

function buildHelpChaosCorpusV1(targetCount) {
  const base = orchShared.buildHelpGuidanceCorpusV2(Math.min(targetCount, 12000));
  const cases = base.slice();
  let n = cases.length;
  const prefixes = ["", "Hele ", "Prosím ", "Krátce ", "No ", "Vlastně ", "Řekni mi ", "Silver "];
  const suffixes = ["", "?", " prosím?", " stručně?"];
  const emotional = [
    "nevím jak ",
    "fakt nechápu ",
    "můžeš mi říct ",
    "potřebuju vědět ",
    "urgentně "
  ];
  const rng = core.mulberry32(0x48454c50);
  for (let i = 0; i < CRITICAL_HELP_PACK.length; i++) {
    cases.push({ id: "HCRIT_" + String(i + 1).padStart(4, "0"), input: CRITICAL_HELP_PACK[i], relaxed: true, topic: "critical" });
  }
  const templates = [
    "{pfx}jak funguje {mod}{suf}",
    "{pfx}na co jsou {mod}{suf}",
    "{pfx}umíš {mod}{suf}",
    "{pfx}co umíš s {mod}{suf}",
    "{pfx}jak hledat v {mod}{suf}",
    "{pfx}jen mi vysvětli {mod}{suf}",
    "{pfx}dej mi příklad {mod}{suf}"
  ];
  const mods = ["kalendář", "úkoly", "poznámky", "připomínky", "schůzku", "vyhledávání", "Silver"];
  while (cases.length < targetCount) {
    const t = templates[Math.floor(rng() * templates.length)];
    const m = mods[Math.floor(rng() * mods.length)];
    const p = prefixes[Math.floor(rng() * prefixes.length)];
    const s = suffixes[Math.floor(rng() * suffixes.length)];
    const e = emotional[Math.floor(rng() * emotional.length)];
    const useEmo = rng() > 0.7;
    n++;
    cases.push({
      id: "HCHAOS_" + String(n).padStart(6, "0"),
      input: (useEmo ? e : "") + t.replace("{pfx}", p).replace("{mod}", m).replace("{suf}", s),
      relaxed: true,
      topic: "chaos"
    });
  }
  return cases.slice(0, targetCount);
}

function turnWouldLeakSaveShell(turn, eng) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  if (eng && typeof eng.iuSilverIsHelpGuidanceRenderModeV1 === "function") {
    if (!eng.iuSilverIsHelpGuidanceRenderModeV1(turn)) issues.push("help_render_mode_off");
  }
  if (WRITE_INTENTS.has(intent)) issues.push("write_intent:" + intent);
  if (ps === "NEEDS_CLARIFICATION" || ps === "READY_TO_SAVE" || ps === "STORAGE_DISAMBIGUATION") {
    issues.push("save_processing_state:" + ps);
  }
  if (turn.clarificationReason && String(turn.clarificationReason).indexOf("ambiguous") >= 0) {
    issues.push("false_clarification:" + turn.clarificationReason);
  }
  const d = turn.draft || {};
  const title = String(d.title || "").trim();
  const note = String(d.silverNoteText || "").trim();
  if (title.length > 2) issues.push("draft_title_leak");
  if (note.length > 2 && d.targetContainer === "notes") issues.push("draft_note_leak");
  if (d.targetContainer === "calendar" || d.targetContainer === "tasks") issues.push("draft_container_leak:" + d.targetContainer);
  if (turn.storageDisambiguation) issues.push("storage_disambiguation_leak");
  return issues;
}

function runHelpGovernanceCase(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), harness.ctxForCase("calendar_write"));
  const intent = String(turn.normalizedIntent || "");
  const issues = [];

  if (!STATIC_ASSISTANT.has(intent)) issues.push("intent_expected_assistant_static_got_" + intent);
  if (turn.processingState !== "CAPABILITY_OK") issues.push("state_expected_CAPABILITY_OK_got_" + turn.processingState);
  if (WRITE_INTENTS.has(intent)) issues.push("capability_must_not_write");
  if (turn.readQuery) issues.push("readQuery_must_be_null");

  const shellIssues = turnWouldLeakSaveShell(turn, eng);
  for (let i = 0; i < shellIssues.length; i++) issues.push(shellIssues[i]);

  if (c.requireQuestion && !/\?/.test(c.input)) issues.push("case_missing_question_mark");

  return { id: c.id, input: c.input, intent, issues, pass: issues.length === 0, turn };
}

function runHelpGovernanceAudit(harnessId, cases, reportPath, extra) {
  const eng = harness.loadEngine();
  const results = [];
  let pass = 0;
  let saveShellLeaks = 0;
  let falseClarification = 0;
  let draftLeaks = 0;
  for (let i = 0; i < cases.length; i++) {
    const r = runHelpGovernanceCase(eng, cases[i]);
    results.push(r);
    if (r.pass) pass++;
    else {
      for (let j = 0; j < r.issues.length; j++) {
        const iss = r.issues[j];
        if (iss.indexOf("write_intent") === 0 || iss.indexOf("save_processing") === 0) saveShellLeaks++;
        if (iss.indexOf("false_clarification") === 0 || iss.indexOf("ambiguous") >= 0) falseClarification++;
        if (iss.indexOf("draft_") === 0) draftLeaks++;
      }
    }
  }
  const total = cases.length;
  const accuracy = total ? Math.round((pass / total) * 1000) / 10 : 0;
  const report = Object.assign(
    {
      harness_id: harnessId,
      main_commit: mainCommit(),
      cases_total: total,
      pass_count: pass,
      fail_count: total - pass,
      accuracy_pct: accuracy,
      save_shell_leaks: saveShellLeaks,
      false_clarification_count: falseClarification,
      draft_card_leaks: draftLeaks,
      fails: results.filter(function (x) {
        return !x.pass;
      })
    },
    extra || {}
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { ok: pass === total, report, eng };
}

function printAuditHeader(harnessId, report) {
  console.log("=== " + harnessId.toUpperCase() + " ===");
  console.log("cases_total=" + report.cases_total);
  console.log("pass_count=" + report.pass_count);
  console.log("fail_count=" + report.fail_count);
  console.log("accuracy_pct=" + report.accuracy_pct);
  console.log("save_shell_leaks=" + report.save_shell_leaks);
  console.log("false_clarification_count=" + report.false_clarification_count);
  console.log("draft_card_leaks=" + report.draft_card_leaks);
  console.log("PASS_FAIL=" + (report.pass_count === report.cases_total ? "PASS" : "FAIL"));
  console.log("=== END_" + harnessId.toUpperCase() + " ===");
}

function runRuntimeDiagnostic(eng, cases) {
  const branches = {};
  const leaks = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), harness.ctxForCase("calendar_write"));
    const branch =
      (eng.iuSilverIsHelpGuidanceRenderModeV1 && eng.iuSilverIsHelpGuidanceRenderModeV1(turn) ? "help_render" : "non_help") +
      ":" +
      String(turn.normalizedIntent || "") +
      ":" +
      String(turn.processingState || "");
    branches[branch] = (branches[branch] || 0) + 1;
    const shell = turnWouldLeakSaveShell(turn, eng);
    if (shell.length) {
      leaks.push({ id: c.id, input: c.input, branch, issues: shell, turn_intent: turn.normalizedIntent });
    }
  }
  return { branches, leaks };
}

module.exports = {
  REPO,
  mainCommit,
  CRITICAL_HELP_PACK,
  WRITE_INTENTS,
  STATIC_ASSISTANT,
  buildHelpChaosCorpusV1,
  runHelpGovernanceCase,
  runHelpGovernanceAudit,
  printAuditHeader,
  turnWouldLeakSaveShell,
  runRuntimeDiagnostic
};
