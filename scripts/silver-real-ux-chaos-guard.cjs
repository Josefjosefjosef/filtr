#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-orchestration-stabilization-v2-shared.cjs");

const TARGET = parseInt(process.env.SILVER_REAL_UX_CHAOS_CASES || "5000", 10);
const REPORT = path.join(__dirname, "silver-real-ux-chaos-guard-report.json");
const MIN_SAFE_PCT = parseFloat(process.env.SILVER_REAL_UX_CHAOS_MIN_PCT || "99.5", 10);

const WRITE_INTENTS = shared.WRITE_INTENTS;

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
  const cases = shared.buildRealUxChaosCases(TARGET);
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_write");
  let safe = 0;
  let wrapperLeaks = 0;
  let queryWriteLeaks = 0;
  let helpWriteLeaks = 0;
  const fails = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const input = c.input;
    const fold = shared.foldCs(input);
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const t = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(t.normalizedIntent || "");
    let okCase = true;
    const issues = [];

    if (isQueryLike(fold) && WRITE_INTENTS.has(intent)) {
      queryWriteLeaks++;
      issues.push("query_write_leak");
      okCase = false;
    }
    if (
      isHelpCue(fold) &&
      (WRITE_INTENTS.has(intent) || (t.draft && t.draft.targetContainer && t.draft.targetContainer !== "none"))
    ) {
      helpWriteLeaks++;
      issues.push("help_write_leak");
      okCase = false;
    }
    if (WRITE_INTENTS.has(intent)) {
      const title = String((t.draft && t.draft.title) || "");
      const leak = shared.titleHasWrapperLeak(title);
      if (leak) {
        wrapperLeaks++;
        issues.push("wrapper_leak:" + leak);
        okCase = false;
      }
    }
    if (okCase) safe++;
    else if (fails.length < 40) fails.push({ id: c.id, input: input, intent: intent, issues: issues });
  }

  const total = cases.length;
  const pct = total ? Math.round((safe / total) * 10000) / 100 : 0;
  const maxWrapper = Math.max(1, Math.floor(total * 0.001));
  const ok = pct >= MIN_SAFE_PCT && queryWriteLeaks === 0 && helpWriteLeaks === 0 && wrapperLeaks <= maxWrapper;

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        harness_id: "silver_real_ux_chaos_guard_v2",
        cases_total: total,
        safe_count: safe,
        safety_pct: pct,
        wrapper_leak_count: wrapperLeaks,
        query_write_leak_count: queryWriteLeaks,
        help_write_leak_count: helpWriteLeaks,
        fails: fails
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("=== SILVER_REAL_UX_CHAOS_GUARD ===");
  console.log("cases_total=" + total);
  console.log("safe_count=" + safe);
  console.log("safety_pct=" + pct);
  console.log("wrapper_leak_count=" + wrapperLeaks);
  console.log("query_write_leak_count=" + queryWriteLeaks);
  console.log("help_write_leak_count=" + helpWriteLeaks);
  console.log("min_safe_pct=" + MIN_SAFE_PCT);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_REAL_UX_CHAOS_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
