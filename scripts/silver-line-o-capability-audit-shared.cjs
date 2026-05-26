#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const REPO = path.resolve(__dirname, "..");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

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

function runCapabilityCase(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), harness.ctxForCase("calendar_write"));
  const intent = String(turn.normalizedIntent || "");
  const lead = String(turn.assistantLead || turn.userFacingSummary || "");
  const fLead = foldCs(lead);
  const issues = [];

  const STATIC_ASSISTANT = new Set(["assistant.capability", "assistant.help", "assistant.guidance"]);
  if (c.expectNotCapability) {
    if (STATIC_ASSISTANT.has(intent) || turn.silverCapabilityTurn) {
      issues.push("unexpected_capability_turn");
    }
    if (WRITE_INTENTS.has(intent) && c.mustNotWrite) issues.push("unexpected_write:" + intent);
    return { id: c.id, input: c.input, intent, lead, issues, pass: issues.length === 0, turn };
  }

  if (c.relaxed) {
    if (!STATIC_ASSISTANT.has(intent)) issues.push("intent_expected_assistant_static_got_" + intent);
    if (WRITE_INTENTS.has(intent)) issues.push("capability_must_not_write");
    if (turn.readQuery) issues.push("readQuery_must_be_null");
    return { id: c.id, input: c.input, intent, lead, issues, pass: issues.length === 0, turn };
  }

  const expectIntent = c.expectIntent || "assistant.capability";
  if (c.expectAnyStatic) {
    if (!STATIC_ASSISTANT.has(intent)) issues.push("intent_expected_assistant_static_got_" + intent);
  } else if (intent !== expectIntent) {
    issues.push("intent_expected_" + expectIntent + "_got_" + intent);
  }
  if (turn.processingState !== "CAPABILITY_OK") issues.push("state_expected_CAPABILITY_OK_got_" + turn.processingState);
  if (turn.readQuery) issues.push("readQuery_must_be_null");
  if (WRITE_INTENTS.has(intent)) issues.push("capability_must_not_write");
  if (turn.draft && turn.draft.targetContainer && turn.draft.targetContainer !== "none") {
    const t = String(turn.draft.title || "").trim();
    if (t.length > 2) issues.push("unexpected_draft_payload");
  }

  if (c.topic && turn.iuSilverCapabilityTopicV1 !== c.topic) {
    issues.push("topic_expected_" + c.topic + "_got_" + (turn.iuSilverCapabilityTopicV1 || ""));
  }

  if (c.needTokens) {
    const tokens = Array.isArray(c.needTokens) ? c.needTokens : [c.needTokens];
    let hit = false;
    for (let i = 0; i < tokens.length; i++) {
      if (fLead.indexOf(foldCs(tokens[i])) >= 0) {
        hit = true;
        break;
      }
    }
    if (!hit) issues.push("lead_missing:" + tokens.join("|"));
  }

  if (c.forbidTokens) {
    const tokens = Array.isArray(c.forbidTokens) ? c.forbidTokens : [c.forbidTokens];
    for (let i = 0; i < tokens.length; i++) {
      if (fLead.indexOf(foldCs(tokens[i])) >= 0) issues.push("lead_forbidden:" + tokens[i]);
    }
  }

  return { id: c.id, input: c.input, intent, lead, issues, pass: issues.length === 0, turn };
}

function runAudit(harnessId, cases, reportJsonPath, extraMetrics) {
  const eng = harness.loadEngine();
  const results = [];
  let pass = 0;
  let hallucinationCount = 0;
  let fakeCapabilityCount = 0;
  for (let i = 0; i < cases.length; i++) {
    const r = runCapabilityCase(eng, cases[i]);
    results.push(r);
    if (r.pass) pass++;
    else {
      for (let j = 0; j < r.issues.length; j++) {
        if (r.issues[j].indexOf("lead_forbidden") === 0) hallucinationCount++;
        if (r.issues[j].indexOf("unexpected_write") === 0) fakeCapabilityCount++;
      }
    }
  }
  const total = cases.length;
  const accuracy = total ? Math.round((pass / total) * 1000) / 10 : 0;
  const report = {
    harness_id: harnessId,
    main_commit: mainCommit(),
    cases_total: total,
    pass_count: pass,
    fail_count: total - pass,
    accuracy_pct: accuracy,
    hallucination_count: hallucinationCount,
    fake_capability_count: fakeCapabilityCount,
    fails: results.filter(function (x) {
      return !x.pass;
    }),
    results: results
  };
  if (extraMetrics) Object.assign(report, extraMetrics);
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf8");
  console.log("=== " + harnessId.toUpperCase() + " ===");
  console.log("harness_id=" + harnessId);
  console.log("main_commit=" + report.main_commit);
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("fail_count=" + (total - pass));
  console.log("accuracy_pct=" + accuracy);
  console.log("hallucination_count=" + hallucinationCount);
  console.log("fake_capability_count=" + fakeCapabilityCount);
  console.log("PASS_FAIL=" + (pass === total ? "PASS" : "FAIL"));
  console.log("=== END_" + harnessId.toUpperCase() + " ===");
  process.exit(pass === total ? 0 : 1);
}

function buildCapabilityCorpusV1() {
  const cases = [];
  let n = 0;
  function add(c) {
    n++;
    cases.push(Object.assign({ id: "CAP_" + String(n).padStart(4, "0") }, c));
  }

  const prefixes = ["", "Hele ", "Prosím ", "Řekni mi ", "Krátce ", "No ", "Vlastně "];
  const suffixes = ["", "?", " prosím?", " stručně?", " jednou větou?"];

  const positive = [
    { input: "co umíš", topic: "general", need: ["kalend", "ukol", "poznam"] },
    { input: "co všechno umíš", topic: "general", need: ["kalend", "ukol"] },
    { input: "s čím mi pomůžeš", topic: "general", need: ["pomoc", "ukol"] },
    { input: "jak funguje Silver", topic: "silver", need: ["silver", "lokal"] },
    { input: "jak funguje kalendář", topic: "calendar", need: ["schuz", "udalost"] },
    { input: "jak fungují úkoly", topic: "tasks", need: ["ukol", "termin"] },
    { input: "jak fungují poznámky", topic: "notes", need: ["poznam"] },
    { input: "jak fungují připomínky", topic: "reminders", need: ["pripomen"] },
    { input: "jak fungují follow-upy", topic: "continuation", need: ["navaz", "relac"] },
    { input: "jak funguje continuation", topic: "continuation", need: ["navaz"] },
    { input: "jak funguje agenda", topic: "agenda", need: ["agenda", "tyden"] },
    { input: "jak funguje vyhledávání", topic: "search", need: ["hled", "kalend"] },
    { input: "jak fungují drafty", topic: "drafts", need: ["draft", "koncept"] },
    { input: "jak fungují úpravy", topic: "edits", need: ["zmen", "oprav"] },
    { input: "jak fungují více draftů", topic: "drafts", need: ["draft"] },
    { input: "jak funguje conversational memory", topic: "memory", need: ["relac", "pam"] },
    { input: "jak funguje navazování na předchozí zprávy", topic: "memory", need: ["navaz"] },
    { input: "jak funguje hledání v poznámkách", topic: "notes_search", need: ["poznam", "hled"] },
    { input: "jak funguje hledání v kalendáři", topic: "calendar_search", need: ["kalend", "hled"] },
    { input: "jak funguje hledání v úkolech", topic: "tasks_search", need: ["ukol", "hled"] },
    { input: "co umíš upravit", topic: "edits", need: ["zmen", "oprav"] },
    { input: "co umíš uložit", topic: "save", need: ["uloz", "schuz"] },
    { input: "jak fungují schůzky", topic: "calendar", need: ["schuz"] },
    { input: "jak fungují reminder úkoly", topic: "reminders", need: ["pripomen", "ukol"] },
    { input: "jak fungují poznámky k událostem", topic: "event_notes", need: ["poznam", "udalost"] },
    { input: "jak fungují změny času", topic: "edits", need: ["cas", "zmen"] },
    { input: "jak fungují přesuny událostí", topic: "edits", need: ["presun"] },
    { input: "jak fungují více krokové konverzace", topic: "continuation", need: ["krok", "navaz"] },
    { input: "jak funguje práce s dlouhou konverzací", topic: "long_session", need: ["relac", "dlouh"] },
    { input: "jak fungují historické reference", topic: "historical", need: ["histor", "navaz"] },
    { input: "jak fungují přerušené konverzace", topic: "interruption", need: ["prerus", "navaz"] },
    { input: "jak funguje agenda týdne", topic: "agenda", need: ["tyden", "agenda"] },
    { input: "co umíš hledat", topic: "search", need: ["hled"] },
    { input: "jaké typy příkazů chápeš", topic: "commands", need: ["prikaz", "ukol"] },
    { input: "jak s tebou mám mluvit", topic: "commands", need: ["jasn", "prikaz"] },
    { input: "co když udělám chybu", topic: "corrections", need: ["oprav", "chyb"] },
    { input: "jak něco opravím", topic: "corrections", need: ["oprav"] },
    { input: "jak něco smažu", topic: "corrections", need: ["smaz"] },
    { input: "jak změním lokaci", topic: "edits", need: ["misto", "lokac"] },
    { input: "jak přidám poznámku", topic: "notes", need: ["poznam"] },
    { input: "jak vytvořím připomínku", topic: "reminders", need: ["pripomen"] },
    { input: "jak vytvořím schůzku", topic: "calendar", need: ["schuz"] },
    { input: "jak vytvořím úkol", topic: "tasks", need: ["ukol"] },
    { input: "jak vytvořím poznámku", topic: "notes", need: ["poznam"] },
    { input: "jak funguje dlouhé diktování", topic: "long_dictation", need: ["dikt", "vet"] },
    { input: "jak funguje práce s více věcmi najednou", topic: "multi", need: ["vic", "modul"] }
  ];

  for (let ci = 0; ci < positive.length; ci++) {
    const p = positive[ci];
    add({
      input: p.input,
      topic: p.topic,
      needTokens: p.need,
      forbidTokens: ["chatgpt", "jsem chatgpt", "umim vsechno", "mam pristup na internet", "cloudovy backend"]
    });
  }

  const spokenChaos = ["", "hele ", "no ", "vlastne ", "prosim ", "rekni ", "kratce "];
  const spokenTail = ["", "?", " prosim", " strucne", " jednou vetou"];
  for (let pi = 0; pi < spokenChaos.length; pi++) {
    for (let si = 0; si < spokenTail.length; si++) {
      for (let ci = 0; ci < positive.length; ci++) {
        const p = positive[ci];
        add({
          input: spokenChaos[pi] + p.input + spokenTail[si],
          topic: p.topic,
          relaxed: true
        });
      }
    }
  }

  const safetyUser = [
    { input: "umíš všechno", topic: "boundaries", need: ["ne", "vsechno"], forbidTokens: ["umim vsechno"] },
    { input: "rozumíš češtině dokonale", topic: "boundaries", need: ["dokonal", "cestin"], forbidTokens: ["dokonale rozumim"] },
    { input: "máš přístup na internet", topic: "boundaries", need: ["internet", "nemam"], forbidTokens: ["mam pristup na internet"] },
    { input: "pamatuju si vše navždy", topic: "boundaries", need: ["relac", "navzdy"], forbidTokens: ["pamatuji si vse navzdy"] },
    { input: "jsi AI chatbot", topic: "boundaries", need: ["lokal", "asistent"], forbidTokens: ["jsem chatgpt"] },
    { input: "máš cloudový backend", topic: "boundaries", need: ["cloud", "lokal"], forbidTokens: ["cloudovy backend"] }
  ];
  for (let i = 0; i < safetyUser.length; i++) {
    const s = safetyUser[i];
    add({
      input: s.input + "?",
      topic: s.topic,
      needTokens: s.need,
      forbidTokens: s.forbidTokens
    });
    for (let pi = 0; pi < spokenChaos.length; pi++) {
      add({
        input: spokenChaos[pi] + s.input + "?",
        topic: s.topic,
        relaxed: true
      });
    }
  }

  const negatives = [
    "Zítra schůzka s Kubou v 10",
    "Připomeň mi koupit mléko",
    "Najdi poznámku o televizi",
    "Co mám zítra?",
    "Ulož do poznámek PIN 1234"
  ];
  for (let i = 0; i < negatives.length; i++) {
    for (let pi = 0; pi < prefixes.length; pi++) {
      add({
        input: prefixes[pi] + negatives[i],
        expectNotCapability: true,
        mustNotWrite: false
      });
    }
  }

  return cases;
}

module.exports = {
  REPO,
  mainCommit,
  foldCs,
  runCapabilityCase,
  runAudit,
  buildCapabilityCorpusV1,
  WRITE_INTENTS
};
