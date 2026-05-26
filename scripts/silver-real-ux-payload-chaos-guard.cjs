#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const v2 = require("./silver-orchestration-stabilization-v2-shared.cjs");
const shared = require("./silver-orchestration-payload-governance-v3-shared.cjs");

const TARGET = parseInt(process.env.SILVER_REAL_UX_PAYLOAD_CHAOS_CASES || "10000", 10);
const REPORT = path.join(__dirname, "silver-real-ux-payload-chaos-guard-report.json");
const MIN_SAFE_PCT = parseFloat(process.env.SILVER_REAL_UX_PAYLOAD_CHAOS_MIN_PCT || "99.0", 10);

function isQueryLike(fold) {
  return /\b(co\s+mam|kde\s+mam|najdi|ukaz|jen\s+cti|pouze\s+cti)\b/.test(fold);
}

function isHelpCue(fold) {
  return (
    (/\b(jak\s+(?:funguje|uloz\w*|zad\w*|vytvor\w*)|co\s+umis|co\s+se\s+da\s+ulozit|napoveda|\bpomoc\b|dej\s+mi\s+priklad|jen\s+mi\s+porad)\b/.test(
      fold
    ) &&
      !/^\s*(?:uloz|pridej|pripomen|zapis)\s+mi\b/.test(fold)) ||
    /\b(co\s+kdyz\s+nechci\s+nic\s+ulozit|jen\s+mi\s+vysvetl)\b/.test(fold)
  );
}

function main() {
  const cases = shared.buildRealUxPayloadChaosCasesV3(TARGET);
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_write");
  let safe = 0;
  let queryWriteLeaks = 0;
  let wrapperLeaks = 0;
  let embeddedTailLoss = 0;
  let spokenCzech = 0;
  let mobileChaos = 0;
  let payloadChaos = 0;
  let orchestrationChaos = 0;
  let multiStorage = 0;
  const fails = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const input = c.input;
    const fold = shared.foldCs(input);
    if (/[áčďéěíňóřšťúůýž]/i.test(input)) spokenCzech++;
    if (/\b(ee|no|hele|vlastne|prosim)\b/.test(fold)) mobileChaos++;
    if (c.chaos_kind === "payload") payloadChaos++;
    if (c.chaos_kind === "orchestration") orchestrationChaos++;
    if (c.chaos_kind === "multi_storage") multiStorage++;
    if (c.chaos_kind === "embedded_reminder") embeddedTailLoss += 0;

    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const t = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(t.normalizedIntent || "");
    let okCase = true;
    const issues = [];

    if (isQueryLike(fold) && shared.WRITE_INTENTS.has(intent)) {
      queryWriteLeaks++;
      issues.push("query_write_leak");
      okCase = false;
    }
    if (
      isHelpCue(fold) &&
      (shared.WRITE_INTENTS.has(intent) || (t.draft && t.draft.targetContainer && t.draft.targetContainer !== "none"))
    ) {
      issues.push("help_write_leak");
      okCase = false;
    }
    if (shared.WRITE_INTENTS.has(intent)) {
      const leak = v2.titleHasWrapperLeak(String((t.draft && t.draft.title) || ""));
      if (leak) {
        wrapperLeaks++;
        issues.push("wrapper_leak");
        okCase = false;
      }
    }
    if (
      c.chaos_kind === "embedded_reminder" &&
      intent === "calendar.create" &&
      /\bpripom/.test(fold) &&
      !String((t.draft && t.draft.note) || "").trim() &&
      !t.silverCompanionTaskDraft
    ) {
      embeddedTailLoss++;
      issues.push("embedded_tail_drop");
      okCase = false;
    }
    if (
      c.chaos_kind === "embedded_reminder" &&
      intent === "calendar.create" &&
      t.silverCompanionTaskDraft &&
      !/\b(ukol|úkol)\b/.test(fold)
    ) {
      embeddedTailLoss++;
      issues.push("companion_preempt");
      okCase = false;
    }

    if (okCase) safe++;
    else if (fails.length < 30) fails.push({ id: c.id, input: input, intent: intent, issues: issues });
  }

  const total = cases.length;
  const pct = total ? Math.round((safe / total) * 10000) / 100 : 0;
  const ok = pct >= MIN_SAFE_PCT && queryWriteLeaks === 0 && embeddedTailLoss === 0;

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        harness_id: "silver_real_ux_payload_chaos_guard_v3",
        cases_total: total,
        safe_count: safe,
        safety_pct: pct,
        query_write_leak_count: queryWriteLeaks,
        wrapper_leak_count: wrapperLeaks,
        embedded_tail_loss_count: embeddedTailLoss,
        spoken_czech_cases: spokenCzech,
        mobile_chaos_cases: mobileChaos,
        payload_chaos_cases: payloadChaos,
        orchestration_chaos_cases: orchestrationChaos,
        multi_storage_cases: multiStorage,
        fails: fails
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("=== SILVER_REAL_UX_PAYLOAD_CHAOS_GUARD ===");
  console.log("cases_total=" + total);
  console.log("safe_count=" + safe);
  console.log("safety_pct=" + pct);
  console.log("query_write_leak_count=" + queryWriteLeaks);
  console.log("embedded_tail_loss_count=" + embeddedTailLoss);
  console.log("spoken_czech_cases=" + spokenCzech);
  console.log("mobile_chaos_cases=" + mobileChaos);
  console.log("payload_chaos_cases=" + payloadChaos);
  console.log("orchestration_chaos_cases=" + orchestrationChaos);
  console.log("multi_storage_cases=" + multiStorage);
  console.log("min_safe_pct=" + MIN_SAFE_PCT);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_REAL_UX_PAYLOAD_CHAOS_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
