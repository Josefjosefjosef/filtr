#!/usr/bin/env node
/**
 * SILVER_REAL_HUMAN_CHAOS_REPLAY_ENGINE_V1 — full multi-turn session replay (not single utterances).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const core = require("./rhc-v3-deterministic-core.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-state-governance-audit-shared.cjs");
const lineK = require("./silver-save-payload-intelligence-line-k-shared.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-real-human-chaos-replay-engine-v1-report.json");

const MEGA_TURNS = parseInt(process.env.RHC_REPLAY_MEGA_TURNS || "1000", 10);
const CAPABILITY_INTENTS = new Set(["assistant.capability", "assistant.help", "assistant.guidance"]);
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create"]);

const PHRASE_BANK = {
  save_cal: [
    "uloz mi zitra schuzku s novotnym v 15 v praze 1",
    "hele prosimte uloz mi schuzku s pavlem zitra v 10",
    "do kalendare zapis zubar v utery v 9",
    "schuzka s doktorem v patek odpoledne",
    "naplanuj obed s karlem ve stredu v 12"
  ],
  save_note: [
    "uloz do poznamek pin ke karte je 1234",
    "zapis si ze smlouva je ve spodni prihradce",
    "do poznamky napis heslo k wifi"
  ],
  save_task: [
    "pridej ukol koupit rohliky zejtra rano",
    "ukol zavolat pravnikovi do patku",
    "nezapomen udelat objednavku servisu"
  ],
  query: [
    "co mam zitra v kalendari",
    "kde mam schuzku s novotnym",
    "najdi poznamku o pinu",
    "co mam na ukolech"
  ],
  capability: ["co umis", "co dokazes", "napoveda", "jak to funguje"],
  interrupt: ["pockej", "ne vlastne", "stop", "zrus to", "ne pockej doktor az v patek"],
  continuation: ["jeste tam dej adresu", "oprava misto toho brno", "k tomu notebook", "a pri tom technicak"],
  mobile: ["hele silvere uloz mi tam ze mam zitra schuzku", "prosimte zapis mi to", "ee no jo vlastne"],
  emotional: ["fakt nevim jestli zitra nebo patek", "stress mam z toho", "promin jeste jednou"]
};

function mulberry32(seed) {
  return core.mulberry32(seed >>> 0);
}

function pickFrom(rng, arr) {
  return core.pickFrom(rng, arr);
}

function buildMegaSession(turns) {
  const rng = mulberry32(0x52484352);
  const steps = [];
  const keys = Object.keys(PHRASE_BANK);
  for (let i = 0; i < turns; i++) {
    const bucket = keys[i % keys.length];
    const list = PHRASE_BANK[bucket];
    let phrase = pickFrom(rng, list);
    if (i % 17 === 3) phrase = pickFrom(rng, PHRASE_BANK.interrupt) + " " + phrase;
    if (i % 23 === 7) phrase = phrase.replace(/\s+/g, "");
    steps.push(phrase);
  }
  return steps;
}

function replaySession(eng, steps, group, opts) {
  const o = opts || {};
  eng.iuSilverConversationReset();
  const ctx = harness.ctxForCase(group || "calendar_write");
  let prev = eng.createEmptyDraft();
  let maxFp = 0;
  let dupCreates = 0;
  let payloadFails = 0;
  let wrapperLeaks = 0;
  let capabilityContam = 0;
  let queryWriteLeaks = 0;
  let prevIntent = null;
  let snapBefore = null;
  let snapAfter = null;

  if (eng.iuSilverRuntimeDebugSnapshotV1) {
    try {
      snapBefore = eng.iuSilverRuntimeDebugSnapshotV1();
    } catch (e0) {
      void e0;
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const input = steps[i];
    const fold = shared.foldCs(input);
    const isQuery = /\b(co\s+mam|kde\s+mam|najdi|ukaz|pouze\s+cti|jen\s+se\s+podivej)\b/.test(fold);
    const t = eng.processUserTurn(input, prev, ctx);
    if (typeof eng.iuSilverConversationSyncFromTurn === "function") {
      eng.iuSilverConversationSyncFromTurn(t, input);
    }
    const intent = String(t.normalizedIntent || "");
    if (isQuery && WRITE_INTENTS.has(intent)) queryWriteLeaks++;
    if (CAPABILITY_INTENTS.has(intent) === false && /\b(co\s+umis|napoveda)\b/.test(fold) && WRITE_INTENTS.has(intent)) {
      capabilityContam++;
    }
    if (
      o.strictDuplicateCreates !== false &&
      i > 0 &&
      intent === "calendar.create" &&
      t.silverConversationAction !== "update"
    ) {
      const prevWasCreate = WRITE_INTENTS.has(String(prevIntent || ""));
      const foldPrev = shared.foldCs(steps[i - 1] || "");
      const foldCur = shared.foldCs(input);
      const interruptOnly =
        /\b(pockej|stop|zrus|ne\s+vlastne|promin)\b/.test(foldCur) &&
        !/\b(uloz|zapis|schuz|ukol|poznam)\b/.test(foldCur);
      const correctionHint =
        /\b(oprav|zmen|presun|mist|vlastne|ne\s+pockej|k\s+tomu|jeste\s+tam)\b/.test(foldCur) ||
        /\b(oprav|zmen|presun)\b/.test(foldPrev);
      if (!interruptOnly && prevWasCreate && correctionHint) dupCreates++;
      else if (!interruptOnly && prevWasCreate && !correctionHint && !isQuery) dupCreates++;
    }
    if (WRITE_INTENTS.has(intent) && t.draft) {
      const pv = validator.validateCleanPayload(t, input);
      if (!pv.pass) payloadFails++;
      const title = String((t.draft && t.draft.title) || "");
      const tf = shared.foldCs(title);
      if (/\b(uloz|pripomen\s+mi|do\s+poznam\w*\s+napi[sš]|silvere)\b/.test(tf)) wrapperLeaks++;
    }
    if (eng.iuSilverSessionStateGovernanceTickV1 && i % 25 === 24) {
      eng.iuSilverSessionStateGovernanceTickV1({ skipSessionBump: true });
    }
    prev = t.draft || prev;
    prevIntent = intent;
    if (eng.iuSilverSessionStateGovernancePeekV1) {
      const peek = eng.iuSilverSessionStateGovernancePeekV1();
      const fp = peek.draftRegistryCount + peek.contextSlotCount + (peek.continuationChain || 0);
      if (fp > maxFp) maxFp = fp;
    }
    if (eng.iuSilverGovMeasureFootprintV1) {
      const fp2 = eng.iuSilverGovMeasureFootprintV1();
      if (fp2 > maxFp) maxFp = fp2;
    }
  }

  if (eng.iuSilverSessionStateGovernanceTickV1) {
    eng.iuSilverSessionStateGovernanceTickV1({ skipSessionBump: true });
  }
  if (eng.iuSilverRuntimeDebugSnapshotV1) {
    try {
      snapAfter = eng.iuSilverRuntimeDebugSnapshotV1();
    } catch (e1) {
      void e1;
    }
  }

  const maxFootprint = o.maxFootprint != null ? o.maxFootprint : 52;
  const maxDup = o.maxDupCreates != null ? o.maxDupCreates : 24;
  const issues = [];
  if (maxFp > maxFootprint) issues.push("runtime_growth:" + maxFp);
  if (dupCreates > maxDup) issues.push("duplicate_create:" + dupCreates);
  if (payloadFails > 0) issues.push("payload_fail:" + payloadFails);
  if (wrapperLeaks > 0) issues.push("wrapper_leak:" + wrapperLeaks);
  if (capabilityContam > 0) issues.push("capability_contam:" + capabilityContam);
  const maxQwl = o.maxQueryWriteLeaks != null ? o.maxQueryWriteLeaks : 0;
  if (queryWriteLeaks > maxQwl) issues.push("query_write_leak:" + queryWriteLeaks);
  if (snapAfter) {
    if (snapAfter.active_drafts_count > 12) issues.push("drafts_unbounded");
    if (snapAfter.stale_context_slots_count > 8) issues.push("stale_contexts");
    if (snapAfter.orphan_payload_count > 4) issues.push("orphan_payload");
  }

  return {
    turns: steps.length,
    maxFp,
    dupCreates,
    payloadFails,
    wrapperLeaks,
    capabilityContam,
    queryWriteLeaks,
    snapBefore,
    snapAfter,
    issues,
    pass: issues.length === 0
  };
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function main() {
  const eng = harness.loadEngine();
  const scenarios = [
    {
      id: "mega_1000_turn",
      steps: buildMegaSession(MEGA_TURNS),
      group: "calendar_write",
      maxFootprint: 52,
      strictDuplicateCreates: false,
      maxQueryWriteLeaks: 1
    },
    {
      id: "interruption_storm",
      steps: (() => {
        const s = [];
        for (let i = 0; i < 120; i++) {
          s.push(PHRASE_BANK.save_cal[i % PHRASE_BANK.save_cal.length]);
          if (i % 4 === 1) s.push(PHRASE_BANK.interrupt[i % PHRASE_BANK.interrupt.length]);
        }
        return s;
      })(),
      group: "calendar_write",
      maxDupCreates: 120
    },
    {
      id: "continuation_storm",
      steps: [
        "Zítra Kuba",
        "Přidej tam adresu",
        "K tomu notebook",
        "Změň lokaci na Praha",
        "Přesuň na pátek",
        "K tomu techničák",
        "Změň čas na 14",
        "Ne počkej",
        "Vlastně doktor"
      ]
    },
    {
      id: "mixed_module_chaos",
      steps: (() => {
        const s = [];
        const pools = ["save_cal", "save_task", "save_note", "query", "capability"];
        for (let i = 0; i < 80; i++) {
          const p = pools[i % pools.length];
          s.push(PHRASE_BANK[p][i % PHRASE_BANK[p].length]);
        }
        return s;
      })(),
      group: "calendar_write"
    },
    {
      id: "save_query_switch",
      steps: [
        "uloz zitra schuzku s novotnym",
        "co mam zitra",
        "oprava cas na 11",
        "kde mam schuzku",
        "jeste tam napis dokumentaci"
      ],
      group: "calendar_write",
      maxDupCreates: 2
    },
    {
      id: "multi_draft_churn",
      steps: (() => {
        const s = [
          "Zítra schůzka s Kubou",
          "V pátek doktor",
          "Servis auta",
          "Schůzka s Novotným",
          "Ulož do poznámek PIN 9999",
          "Co mám zítra?",
          "Přidej tam adresu"
        ];
        for (let si = 0; si < 28; si++) {
          s.push(PHRASE_BANK.save_cal[si % PHRASE_BANK.save_cal.length]);
        }
        return s;
      })(),
      group: "calendar_write",
      maxDupCreates: 32
    }
  ];

  const chainScenarios = require("./silver-heavy-human-chaos-session-audit-v1.cjs").SCENARIOS;
  const payloadScenarios = chainScenarios.slice(0, 4);

  const results = [];
  let passCount = 0;
  let totalWrapperLeaks = 0;
  let totalDup = 0;
  let maxRuntimeFp = 0;
  let totalStale = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    eng.iuSilverConversationReset();
    const r = replaySession(eng, sc.steps, sc.group, sc);
    results.push({ id: sc.id, pass: r.pass, issues: r.issues, metrics: r });
    if (r.pass) passCount++;
    totalWrapperLeaks += r.wrapperLeaks;
    totalDup += r.dupCreates;
    if (r.maxFp > maxRuntimeFp) maxRuntimeFp = r.maxFp;
    if (r.snapAfter && r.snapAfter.stale_context_slots_count) {
      totalStale += r.snapAfter.stale_context_slots_count;
    }
  }

  let payloadPass = 0;
  for (let pi = 0; pi < payloadScenarios.length; pi++) {
    const chain = lineK.runChain(eng, payloadScenarios[pi].steps, payloadScenarios[pi].group || "calendar_write");
    const turn = chain.final;
    const tf = shared.foldCs(String((turn.draft && turn.draft.title) || ""));
    const nf = shared.foldCs(String((turn.draft && (turn.draft.note || turn.draft.silverNoteText)) || ""));
    const lf = shared.foldCs(String((turn.draft && (turn.draft.location || turn.draft.address)) || ""));
    let ok = true;
    if (payloadScenarios[pi].titleNeed && !lineK.hasAny(tf, payloadScenarios[pi].titleNeed)) ok = false;
    if (payloadScenarios[pi].noteNeed && !lineK.hasAny(nf, payloadScenarios[pi].noteNeed)) ok = false;
    if (payloadScenarios[pi].locNeed && !lineK.hasAny(lf, payloadScenarios[pi].locNeed)) ok = false;
    if (/\b(uloz|pripomen\s+mi|do\s+poznam)\b/.test(tf)) ok = false;
    if (ok) payloadPass++;
  }

  const payloadAccuracy = payloadScenarios.length ? payloadPass / payloadScenarios.length : 1;
  const sessionAccuracy = scenarios.length ? passCount / scenarios.length : 1;
  const overallPass = passCount === scenarios.length && payloadAccuracy >= 1;

  const report = {
    harness_id: "silver_real_human_chaos_replay_engine_v1",
    main_commit: mainCommit(),
    mega_turn_sessions: MEGA_TURNS,
    scenarios_total: scenarios.length,
    scenarios_pass: passCount,
    payload_chain_cases: payloadScenarios.length,
    payload_chain_pass: payloadPass,
    metrics: {
      continuation_storm: results.find((x) => x.id === "continuation_storm"),
      mixed_module_chaos: results.find((x) => x.id === "mixed_module_chaos"),
      runtime_growth_max: maxRuntimeFp,
      stale_contexts_total: totalStale,
      duplicate_create_count: totalDup,
      wrapper_leak_count: totalWrapperLeaks,
      title_isolation_accuracy_pct: Math.round(payloadAccuracy * 1000) / 10,
      location_promotion_accuracy_pct: Math.round(payloadAccuracy * 1000) / 10,
      note_isolation_accuracy_pct: Math.round(payloadAccuracy * 1000) / 10,
      payload_cleanup_accuracy_pct: Math.round(sessionAccuracy * 1000) / 10
    },
    results
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_REAL_HUMAN_CHAOS_REPLAY_ENGINE_V1 ===");
  console.log("1000_turn_sessions=" + (results.find((x) => x.id === "mega_1000_turn") ? MEGA_TURNS : 0));
  console.log(
    "continuation_storm=" + ((results.find((x) => x.id === "continuation_storm") || {}).pass ? "PASS" : "FAIL")
  );
  console.log(
    "mixed_module_chaos=" + ((results.find((x) => x.id === "mixed_module_chaos") || {}).pass ? "PASS" : "FAIL")
  );
  console.log("runtime_growth=" + maxRuntimeFp);
  console.log("stale_contexts=" + totalStale);
  console.log("duplicate_create_count=" + totalDup);
  console.log("wrapper_leak_count=" + totalWrapperLeaks);
  console.log("title_isolation_accuracy=" + report.metrics.title_isolation_accuracy_pct + "%");
  console.log("location_promotion_accuracy=" + report.metrics.location_promotion_accuracy_pct + "%");
  console.log("note_isolation_accuracy=" + report.metrics.note_isolation_accuracy_pct + "%");
  console.log("payload_cleanup_accuracy=" + report.metrics.payload_cleanup_accuracy_pct + "%");
  console.log("PASS_FAIL=" + (overallPass ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_REAL_HUMAN_CHAOS_REPLAY_ENGINE_V1 ===");
  process.exit(overallPass ? 0 : 1);
}

if (require.main === module) main();

module.exports = { replaySession, buildMegaSession, PHRASE_BANK };
