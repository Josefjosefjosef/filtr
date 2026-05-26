#!/usr/bin/env node
/**
 * Shared harness for Silver 20k slice regression guards — fast deterministic slice runner.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");

function readSilverEngineFromApp() {
  const appPath = path.join(REPO, "assets", "app.js");
  const app = fs.readFileSync(appPath, "utf8");
  const m = app.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//);
  if (!m) throw new Error("IU_SILVER_P0_ENGINE markers missing");
  return m[1].trim();
}

function loadEngine() {
  const SILVER = readSilverEngineFromApp();
  const ctx = {
    window: {},
    document: {
      readyState: "complete",
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
  };
  ctx.window.document = ctx.document;
  ctx.window.localStorage = ctx.localStorage;
  vm.createContext(ctx);
  vm.runInContext(
    SILVER.replace(/document\.readyState/g, '"complete"').replace(/document\.addEventListener\([^)]+\)/g, "void 0"),
    ctx
  );
  return ctx.window.iuSilverCalendarEngine;
}

/**
 * Run one or more 20k harness groups; return pass/fail stats + first failure detail.
 * @param {string|string[]} groups
 * @param {number} targetPass
 */
function run20kSliceGuard(groups, targetPass) {
  const audit = require("./audit_silver_20000_routing_stable.cjs");
  const eng = loadEngine();
  const groupSet = new Set(Array.isArray(groups) ? groups : [groups]);
  const cases = audit.buildCases();
  const slice = cases.filter((c) => groupSet.has(c.group));
  let pass = 0;
  let firstFail = null;
  const safety = {
    query_created_write_count: 0,
    write_when_negated_count: 0
  };

  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), audit.ctxForCase(c.group));
    const ev = audit.evaluateOne(c, turn);
    if (ev.pass) {
      pass++;
      continue;
    }
    if (ev.cat === "query_created_write") safety.query_created_write_count++;
    if (ev.cat === "write_when_negated") safety.write_when_negated_count++;
    if (!firstFail) {
      firstFail = {
        input: c.input,
        expected: c.expectedIntent,
        actual: ev.auditIntent,
        route: turn.normalizedIntent || "",
        normalizedIntent: turn.normalizedIntent || "",
        retrievalScope: turn.iuSilverRetrievalScopeV1 || turn.retrievalScope || "",
        queryScope: turn.iuSilverQueryScopeV1 || turn.queryScope || "",
        mode: turn.actionMode || turn.iuSilverActionModeV1 || "",
        reason: ev.cat,
        group: c.group
      };
    }
  }

  const total = slice.length;
  const target = targetPass != null ? targetPass : total;
  const ok = pass >= target && pass === total;

  return {
    groups: Array.from(groupSet),
    total,
    pass,
    fail: total - pass,
    target,
    ok,
    firstFail,
    safety,
    PASS_FAIL: ok ? "PASS" : "FAIL"
  };
}

module.exports = {
  loadEngine,
  run20kSliceGuard
};
