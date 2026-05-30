#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
const APP = path.join(REPO, "assets", "app.js");
const REPORT = path.join(__dirname, "silver-user-address-v2-guard-v1-report.json");
const SYNC = "IU_SILVER_SALUTATION_SYNC_V1=2026-05-30a";

function readApp() {
  return fs.readFileSync(APP, "utf8");
}

function createStore() {
  return Object.create(null);
}

function buildVmCtx(store) {
  return {
    window: {
      localStorage: {
        getItem(k) {
          return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
        },
        setItem(k, v) {
          store[k] = String(v);
        },
        removeItem(k) {
          delete store[k];
        }
      },
      __iuUserAddressInit: 0
    },
    document: { getElementById: () => null, readyState: "complete", addEventListener: () => {} }
  };
}

function loadUserAddressRuntime(app, store) {
  if (!app.includes("/* IU_USER_ADDRESS_V2_START */")) throw new Error("IU_USER_ADDRESS_V2 markers missing");
  if (!app.includes(SYNC)) throw new Error("salutation sync tag mismatch");
  const foldM = app.match(/function iuFoldCsShared\(value\)\s*\{[\s\S]*?\n\}/);
  const blockM = app.match(/\/\* IU_USER_ADDRESS_V2_START \*\/([\s\S]*?)\/\* IU_USER_ADDRESS_V2_END \*\//);
  if (!foldM || !blockM) throw new Error("user address block missing");
  const ctx = buildVmCtx(store);
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(foldM[0] + "\n" + blockM[1] + "\niuUserAddressInit();\n", ctx);
  return {
    store,
    tryConsume(line) {
      return ctx.window.iuTryConsumeUserAddressIntentFromSilverInput(line);
    },
    getRender() {
      return ctx.window.iuGetUserAddressVocativeForWelcome();
    },
    getStored() {
      return ctx.window.iuGetUserAddress();
    },
    snapshot() {
      return {
        storage: {
          iu_user_address: store["iu_user_address"] || null,
          iu_user_address_explicit: store["iu_user_address_explicit.v1"] || null,
          salutation_pref: store["iuSilver.salutationPreference.v1"] || null
        },
        render: ctx.window.iuGetUserAddressVocativeForWelcome()
      };
    },
    reset() {
      Object.keys(store).forEach(function (k) {
        delete store[k];
      });
    }
  };
}

function loadSalutationEngine(app, store) {
  const rt = loadUserAddressRuntime(app, store);
  const SILVER = app.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//);
  if (!SILVER) throw new Error("P0 engine missing");
  const foldM = app.match(/function iuFoldCsShared\(value\)\s*\{[\s\S]*?\n\}/);
  const blockM = app.match(/\/\* IU_USER_ADDRESS_V2_START \*\/([\s\S]*?)\/\* IU_USER_ADDRESS_V2_END \*\//);
  const ctx = buildVmCtx(store);
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(foldM[0] + "\n" + blockM[1] + "\niuUserAddressInit();\n", ctx);
  vm.runInContext(
    SILVER[1].trim().replace(/document\.readyState/g, '"complete"').replace(/document\.addEventListener\([^)]+\)/g, "void 0"),
    ctx
  );
  return {
    rt: rt,
    processTurn(raw) {
      const eng = ctx.window.iuSilverCalendarEngine;
      return eng.processUserTurn(raw, eng.createEmptyDraft(), { getEventsSnapshot: () => [] });
    }
  };
}

function assertConsume(rt, input, expectCall, expectExplicit, label) {
  rt.reset();
  if (!rt.tryConsume(input)) {
    return { pass: false, label: label, reason: "consume_false", input: input };
  }
  const snap = rt.snapshot();
  if (snap.render !== expectCall || snap.storage.iu_user_address !== expectCall) {
    return {
      pass: false,
      label: label,
      reason: "stored_render_mismatch",
      input: input,
      snap: snap,
      want: expectCall
    };
  }
  const wantEx = expectExplicit ? "1" : "0";
  if (snap.storage.iu_user_address_explicit !== wantEx) {
    return { pass: false, label: label, reason: "explicit_flag", snap: snap, want: wantEx };
  }
  if (expectExplicit && snap.render !== snap.storage.iu_user_address) {
    return { pass: false, label: label, reason: "regression_transform", snap: snap };
  }
  return { pass: true, label: label, snap: snap };
}

function assertDisableViaEngine(eng, phrase, label) {
  const store = eng.rt.store;
  eng.rt.reset();
  eng.rt.tryConsume("rikej mi Pepo");
  const before = eng.rt.snapshot();
  const turn = eng.processTurn(phrase);
  const after = eng.rt.snapshot();
  const pref = after.storage.salutation_pref ? JSON.parse(after.storage.salutation_pref) : null;
  const ok =
    turn &&
    turn.normalizedIntent === "silver.salutation_preference" &&
    pref &&
    pref.mode === "none" &&
    !after.storage.iu_user_address &&
    after.render === "" &&
    before.render === "Pepo";
  if (!ok) {
    return { pass: false, label: label, reason: "disable_engine", before: before, after: after, turn: turn };
  }
  return { pass: true, label: label, before: before, after: after };
}

function propertyRenderEqualsStored(rt) {
  const tokens = ["Pepo", "Punťo", "Pepíku", "šéfe", "kámo", "veliteli", "pane továrníku"];
  const frames = ["rikej mi {t}", "oslovuj me {t}", "muzes mi rikat {t}", "odted rikej mi {t}"];
  for (let f = 0; f < frames.length; f++) {
    for (let t = 0; t < tokens.length; t++) {
      const inp = frames[f].replace("{t}", tokens[t]);
      const r = assertConsume(rt, inp, tokens[t], true, "prop_" + f + "_" + t);
      if (!r.pass) return r;
    }
  }
  return null;
}

function propertyExplicitBeatsVocative(rt) {
  rt.reset();
  if (!rt.tryConsume("jmenuji se Josef")) return { pass: false, reason: "set_josef" };
  if (rt.getRender() !== "Josefe") return { pass: false, reason: "josef_voc" };
  if (!rt.tryConsume("rikej mi Pepo")) return { pass: false, reason: "override_consume" };
  const snap = rt.snapshot();
  if (snap.render !== "Pepo" || snap.storage.iu_user_address_explicit !== "1") {
    return { pass: false, reason: "explicit_not_win", snap: snap };
  }
  return null;
}

function runScenarioChain(rt, steps, label) {
  const trace = [];
  rt.reset();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.disable) {
      rt.store["iuSilver.salutationPreference.v1"] = JSON.stringify({ mode: "none", at: 1 });
      delete rt.store["iu_user_address"];
      delete rt.store["iu_user_address_explicit.v1"];
    } else {
      if (!rt.tryConsume(step.input)) {
        return { pass: false, label: label, step: i, reason: "consume_false", input: step.input, trace: trace };
      }
      rt.store["iuSilver.salutationPreference.v1"] = JSON.stringify({ mode: "name", at: 1 });
    }
    const snap = rt.snapshot();
    trace.push({ step: i, input: step.input || step.disable, expect: step.expect, snap: snap });
    if (snap.render !== step.expect || (step.expect && snap.storage.iu_user_address !== step.expect)) {
      return { pass: false, label: label, step: i, trace: trace, want: step.expect };
    }
  }
  return { pass: true, label: label, trace: trace };
}

function chaosMutate(template) {
  const prefixes = ["hele ", "prosim te ", "odted ", ""];
  const suffixes = ["", " jo", "?", " prosim"];
  const out = [];
  for (let i = 0; i < prefixes.length; i++) {
    for (let j = 0; j < suffixes.length; j++) {
      out.push(prefixes[i] + template + suffixes[j]);
    }
  }
  return out;
}

function main() {
  const app = readApp();
  const store = createStore();
  const rt = loadUserAddressRuntime(app, store);
  const eng = loadSalutationEngine(app, createStore());

  const explicitCases = [
    ["Říkej mi Pepo", "Pepo"],
    ["Říkej mi Punťo", "Punťo"],
    ["Říkej mi Pepíku", "Pepíku"],
    ["Říkej mi pane továrníku", "pane továrníku"],
    ["Říkej mi šéfe", "šéfe"],
    ["Říkej mi veliteli", "veliteli"],
    ["Říkej mi kámo", "kámo"]
  ];

  const vocativeCases = [
    ["Jmenuji se Josef", "Josefe"],
    ["Jmenuji se Petr", "Petře"],
    ["Jmenuji se Pavel", "Pavle"],
    ["Jmenuji se Martin", "Martine"],
    ["Jmenuji se Tomáš", "Tomáši"],
    ["Jmenuji se Pepa", "Pepo"]
  ];

  const regressionCases = explicitCases.slice(0, 4);

  const disablePhrases = [
    "Neoslovuj mě",
    "Přestaň mě oslovovat",
    "Nechci oslovení",
    "Neříkej mi jménem",
    "Oslovení vypni",
    "Nechci být oslovován"
  ];

  const chaosRequired = [
    ["hele říkej mi Pepo", "Pepo"],
    ["prosim te rikej mi Pepo", "Pepo"],
    ["odted mi rikej Pepo jo", "Pepo"],
    ["muzes mi rikat Pepo", "Pepo"],
    ["muzes mi rikat Punťo", "Punťo"],
    ["ja jsem Pepa", "Pepo"],
    ["jmenuju se Pepa", "Pepo"],
    ["neříkej mi Pepa ale Pepo", "Pepo"]
  ];

  const results = {
    version: 2,
    sync: SYNC,
    explicit: [],
    vocative: [],
    regression: [],
    disable: [],
    enable_chain: null,
    change_chain: null,
    chaos: [],
    property: {},
    first_fail: null
  };

  function setFail(r) {
    if (!results.first_fail) results.first_fail = r;
  }

  explicitCases.forEach(function (row, idx) {
    const r = assertConsume(rt, row[0], row[1], true, "explicit_" + idx);
    results.explicit.push({ input: row[0], expect: row[1], pass: r.pass, snap: r.snap || null });
    if (!r.pass) setFail(r);
  });

  vocativeCases.forEach(function (row, idx) {
    const r = assertConsume(rt, row[0], row[1], false, "vocative_" + idx);
    results.vocative.push({ input: row[0], expect: row[1], pass: r.pass, snap: r.snap || null });
    if (!r.pass) setFail(r);
  });

  regressionCases.forEach(function (row, idx) {
    const r = assertConsume(rt, row[0], row[1], true, "regression_" + idx);
    const engStore = createStore();
    const eng2 = loadSalutationEngine(app, engStore);
    const turn = eng2.processTurn("rikej mi " + row[1]);
    const lead = turn && turn.assistantLead ? String(turn.assistantLead) : "";
    const intentOk = turn && turn.normalizedIntent === "silver.user_address_set";
    const leadOk = lead.indexOf(row[1]) >= 0;
    const snap = eng2.rt.snapshot();
    const noTransform = snap.storage.iu_user_address === row[1] && snap.render === row[1];
    const entry = {
      input: row[0],
      expect: row[1],
      pass: r.pass && intentOk && leadOk && noTransform,
      stored: snap.storage.iu_user_address,
      render: snap.render,
      assistant_lead_snip: lead.slice(0, 96),
      lead_contains_call_form: leadOk,
      intent: turn ? turn.normalizedIntent : null
    };
    results.regression.push(entry);
    if (!entry.pass) setFail({ label: "regression_" + idx, entry: entry });
  });

  disablePhrases.forEach(function (phrase, idx) {
    const engStore = createStore();
    const eng3 = loadSalutationEngine(app, engStore);
    const r = assertDisableViaEngine(eng3, phrase, "disable_" + idx);
    results.disable.push({ phrase: phrase, pass: r.pass, before: r.before, after: r.after });
    if (!r.pass) setFail(r);
  });

  results.enable_chain = runScenarioChain(rt, [
    { input: "rikej mi Pepo", expect: "Pepo" },
    { disable: true, expect: "" },
    { input: "rikej mi Punťo", expect: "Punťo" }
  ], "enable_chain");
  if (!results.enable_chain.pass) setFail(results.enable_chain);

  results.change_chain = runScenarioChain(rt, [
    { input: "rikej mi Pepo", expect: "Pepo" },
    { input: "rikej mi pane továrníku", expect: "pane továrníku" },
    { input: "rikej mi Punťo", expect: "Punťo" },
    { input: "rikej mi Pepíku", expect: "Pepíku" }
  ], "change_chain");
  if (!results.change_chain.pass) setFail(results.change_chain);

  chaosRequired.forEach(function (row, idx) {
    const nameOnly = /\bjsem\b|\bjmenuju\s+se\b/i.test(row[0]);
    const r = assertConsume(rt, row[0], row[1], !nameOnly, "chaos_req_" + idx);
    results.chaos.push({ input: row[0], expect: row[1], pass: r.pass, snap: r.snap || null });
    if (!r.pass) setFail(r);
  });

  chaosMutate("rikej mi Pepo").forEach(function (inp, idx) {
    const r = assertConsume(rt, inp, "Pepo", true, "chaos_mut_" + idx);
    if (!r.pass) setFail(r);
  });

  const propRender = propertyRenderEqualsStored(rt);
  results.property.render_equals_stored = propRender ? "FAIL" : "PASS";
  if (propRender) setFail(propRender);

  const propExplicit = propertyExplicitBeatsVocative(rt);
  results.property.explicit_beats_vocative = propExplicit ? "FAIL" : "PASS";
  if (propExplicit) setFail(propExplicit);

  const ok = !results.first_fail;
  results.PASS_FAIL = ok ? "PASS" : "FAIL";

  fs.writeFileSync(REPORT, JSON.stringify(results, null, 2) + "\n");

  console.log("=== SILVER_USER_ADDRESS_V2_GUARD_V1 ===");
  console.log("explicit=" + (results.explicit.every((x) => x.pass) ? "PASS" : "FAIL"));
  console.log("vocative=" + (results.vocative.every((x) => x.pass) ? "PASS" : "FAIL"));
  console.log("regression=" + (results.regression.every((x) => x.pass) ? "PASS" : "FAIL"));
  console.log("disable=" + (results.disable.every((x) => x.pass) ? "PASS" : "FAIL"));
  console.log("enable_chain=" + (results.enable_chain.pass ? "PASS" : "FAIL"));
  console.log("change_chain=" + (results.change_chain.pass ? "PASS" : "FAIL"));
  console.log("chaos=" + (results.chaos.every((x) => x.pass) ? "PASS" : "FAIL"));
  console.log("property=" + (ok && results.property.render_equals_stored === "PASS" ? "PASS" : "FAIL"));
  console.log("PASS_FAIL=" + results.PASS_FAIL);
  console.log("=== END_SILVER_USER_ADDRESS_V2_GUARD_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
