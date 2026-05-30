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

function extractUserAddressRuntime(app) {
  if (!app.includes("/* IU_USER_ADDRESS_V2_START */") || !app.includes("/* IU_USER_ADDRESS_V2_END */")) {
    throw new Error("IU_USER_ADDRESS_V2 markers missing");
  }
  if (!app.includes(SYNC)) {
    throw new Error("salutation sync tag mismatch");
  }
  const foldM = app.match(/function iuFoldCsShared\(value\)\s*\{[\s\S]*?\n\}/);
  if (!foldM) throw new Error("iuFoldCsShared missing");
  const blockM = app.match(/\/\* IU_USER_ADDRESS_V2_START \*\/([\s\S]*?)\/\* IU_USER_ADDRESS_V2_END \*\//);
  if (!blockM) throw new Error("IU_USER_ADDRESS_V2 block missing");
  const store = Object.create(null);
  const ctx = {
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
    document: { getElementById: () => null }
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(
    foldM[0] +
      "\n" +
      blockM[1] +
      "\niuUserAddressInit();\n" +
      "this.__store = " +
      JSON.stringify(null) +
      ";\n",
    ctx
  );
  ctx.__store = store;
  return {
    store,
    tryConsume(line) {
      return ctx.window.iuTryConsumeUserAddressIntentFromSilverInput(line);
    },
    getCallForm() {
      return ctx.window.iuGetUserAddressVocativeForWelcome();
    },
    getStored() {
      return ctx.window.iuGetUserAddress();
    },
    reset() {
      Object.keys(store).forEach(function (k) {
        delete store[k];
      });
    }
  };
}

function assertCase(rt, input, expectCall, expectExplicit, label) {
  rt.reset();
  const ok = rt.tryConsume(input);
  if (!ok) {
    return { pass: false, label: label, reason: "consume_false", input: input };
  }
  const call = rt.getCallForm();
  const ex = rt.store["iu_user_address_explicit.v1"];
  if (call !== expectCall) {
    return { pass: false, label: label, reason: "call_mismatch", input: input, got: call, want: expectCall };
  }
  const wantEx = expectExplicit ? "1" : "0";
  if (ex !== wantEx) {
    return { pass: false, label: label, reason: "explicit_flag", got: ex, want: wantEx };
  }
  return { pass: true, label: label };
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

function propertyExplicitPreservesShape(rt) {
  const tokens = ["Punťo", "Pepíku", "Pepo", "pane továrníku", "XYzz"];
  const frames = ["rikej mi {t}", "oslovuj me {t}", "muzes mi rikat {t}"];
  let fail = null;
  for (let f = 0; f < frames.length && !fail; f++) {
    for (let t = 0; t < tokens.length && !fail; t++) {
      const raw = frames[f].replace("{t}", tokens[t]);
      const folded = raw;
      const r = assertCase(rt, folded, tokens[t], true, "prop_explicit_" + f + "_" + t);
      if (!r.pass) fail = r;
    }
  }
  return fail;
}

function simulateSalutationDisable(rt) {
  rt.store["iuSilver.salutationPreference.v1"] = JSON.stringify({ mode: "none", at: 1 });
  delete rt.store["iu_user_address"];
  delete rt.store["iu_user_address_explicit.v1"];
}

function metamorphicDisableReenable(rt) {
  rt.reset();
  rt.tryConsume("rikej mi Pepo");
  if (rt.getCallForm() !== "Pepo") {
    return { pass: false, reason: "set_pepo" };
  }
  simulateSalutationDisable(rt);
  if (rt.getCallForm() !== "" || rt.getStored() !== "") {
    return { pass: false, reason: "after_disable" };
  }
  rt.tryConsume("rikej mi Pepíku");
  if (rt.getCallForm() !== "Pepíku") {
    return { pass: false, reason: "reenable_pepiku" };
  }
  return { pass: true };
}

function runRoutingSafety() {
  const shared = require("./silver-20k-regression-guard-shared.cjs");
  const audit = require("./audit_silver_20000_routing_stable.cjs");
  const app = readApp();
  const foldM = app.match(/function iuFoldCsShared\(value\)\s*\{[\s\S]*?\n\}/);
  const blockM = app.match(/\/\* IU_USER_ADDRESS_V2_START \*\/([\s\S]*?)\/\* IU_USER_ADDRESS_V2_END \*\//);
  const store = Object.create(null);
  const ctx = {
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
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(foldM[0] + "\n" + blockM[1] + "\niuUserAddressInit();\n", ctx);
  const SILVER = app.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//)[1].trim();
  vm.runInContext(
    SILVER.replace(/document\.readyState/g, '"complete"').replace(/document\.addEventListener\([^)]+\)/g, "void 0"),
    ctx
  );
  const eng = ctx.window.iuSilverCalendarEngine;
  const safety = {
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0
  };
  const probes = [
    { input: "kolik mam ukolu", group: "tasks" },
    { input: "najdi poznamku o wifi", group: "notes" },
    { input: "co mam dnes v kalendari", group: "calendar" }
  ];
  for (let i = 0; i < probes.length; i++) {
    const c = probes[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), audit.ctxForCase(c.group));
    const ev = audit.evaluateOne({ input: c.input, group: c.group, expectIntent: "read" }, turn);
    if (!ev.pass && ev.cat === "query_created_write") safety.query_created_write_count++;
    if (!ev.pass && ev.cat === "write_when_negated") safety.write_when_negated_count++;
  }
  return safety;
}

function main() {
  const app = readApp();
  const rt = extractUserAddressRuntime(app);
  const manual = [
    ["rikej mi Pepo", "Pepo", true],
    ["oslovuj me Punťo", "Punťo", true],
    ["rikej mi Pepíku", "Pepíku", true],
    ["rikej mi pane továrníku", "pane továrníku", true],
    ["jsem Pepa", "Pepo", false],
    ["jmenuji se Josef", "Josefe", false],
    ["jmenuju se Petr", "Petře", false],
    ["ja jsem Tomáš", "Tomáši", false],
    ["jmenuji se Martin", "Martine", false],
    ["neříkej mi Pepa ale Pepo", "Pepo", true]
  ];
  const chaosInputs = chaosMutate("rikej mi Pepo").concat(
    ["uz me neoslovuj", "nechci zadne osloveni", "neříkej mi jménem", "prestan me oslovovat"]
  );

  let manualFail = null;
  for (let i = 0; i < manual.length; i++) {
    const row = manual[i];
    const r = assertCase(rt, row[0], row[1], row[2], "manual_" + i);
    if (!r.pass) {
      manualFail = r;
      break;
    }
  }

  let chaosFail = null;
  for (let c = 0; c < chaosInputs.length; c++) {
    const inp = chaosInputs[c];
    if (/neoslovuj|nechci|neříkej|prestan/i.test(inp)) {
      rt.reset();
      rt.tryConsume("rikej mi Pepo");
      simulateSalutationDisable(rt);
      if (rt.getCallForm() !== "" || rt.getStored() !== "") {
        chaosFail = { pass: false, input: inp, reason: "disable_not_empty" };
        break;
      }
      continue;
    }
    const r = assertCase(rt, inp, "Pepo", true, "chaos_" + c);
    if (!r.pass) {
      chaosFail = r;
      break;
    }
  }

  const propFail = propertyExplicitPreservesShape(rt);
  const meta = metamorphicDisableReenable(rt);
  const safety = runRoutingSafety();

  const report = {
    version: 1,
    sync: SYNC,
    manual_pass: !manualFail,
    chaos_pass: !chaosFail,
    property_pass: !propFail,
    metamorphic_pass: meta.pass,
    safety: safety,
    first_fail: manualFail || chaosFail || propFail || (meta.pass ? null : meta)
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");

  const ok =
    report.manual_pass &&
    report.chaos_pass &&
    report.property_pass &&
    report.metamorphic_pass &&
    safety.query_created_write_count === 0 &&
    safety.write_when_negated_count === 0;

  console.log("=== SILVER_USER_ADDRESS_V2_GUARD_V1 ===");
  console.log("manual=" + (report.manual_pass ? "PASS" : "FAIL"));
  console.log("chaos=" + (report.chaos_pass ? "PASS" : "FAIL"));
  console.log("property=" + (report.property_pass ? "PASS" : "FAIL"));
  console.log("metamorphic=" + (report.metamorphic_pass ? "PASS" : "FAIL"));
  console.log("query_created_write_count=" + safety.query_created_write_count);
  console.log("write_when_negated_count=" + safety.write_when_negated_count);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_USER_ADDRESS_V2_GUARD_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
