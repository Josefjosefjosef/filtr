#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
const APP = path.join(REPO, "assets", "app.js");
const INDEX = path.join(REPO, "projects", "index.html");
const REPORT = path.join(__dirname, "silver-nameday-wish-overlay-guard-v1-report.json");
const SYNC = "IU_SILVER_SALUTATION_SYNC_V1=2026-05-30a";

function readApp() {
  return fs.readFileSync(APP, "utf8");
}

function readIndex() {
  return fs.readFileSync(INDEX, "utf8");
}

function createStore() {
  return Object.create(null);
}

function loadSignatureRuntime(app, store) {
  if (!app.includes("/* IU_USER_ADDRESS_V2_START */")) throw new Error("IU_USER_ADDRESS_V2 markers missing");
  if (!app.includes(SYNC)) throw new Error("salutation sync tag mismatch");
  const foldM = app.match(/function iuFoldCsShared\(value\)\s*\{[\s\S]*?\n\}/);
  const blockM = app.match(/\/\* IU_USER_ADDRESS_V2_START \*\/([\s\S]*?)\/\* IU_USER_ADDRESS_V2_END \*\//);
  if (!foldM || !blockM) throw new Error("user address block missing");
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
  vm.createContext(ctx);
  vm.runInContext(foldM[0] + "\n" + blockM[1] + "\niuUserAddressInit();\n", ctx);
  return {
    store,
    tryConsume(line) {
      return ctx.window.iuTryConsumeUserAddressIntentFromSilverInput(line);
    },
    getSignature() {
      return ctx.window.iuGetUserSignatureForWish();
    },
    reset() {
      Object.keys(store).forEach(function (k) {
        delete store[k];
      });
    }
  };
}

function assertStripeAbsent(html) {
  const patterns = [
    /#svatekOverlay\s+\.iuSvatekOverlayCard::before\s*\{[^}]*height\s*:\s*4px/i,
    /#iuNamedayWishCard::before\s*\{[^}]*height\s*:\s*4px/i,
    /#iuNamedayWishCard::before\s*\{[^}]*linear-gradient\s*\(\s*90deg\s*,\s*#5B6CFF/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    if (patterns[i].test(html)) {
      return { pass: false, reason: "purple_stripe_rule_present", pattern: String(patterns[i]) };
    }
  }
  return { pass: true };
}

function assertNoVocativeFallbackInWish(app) {
  const initM = app.match(/function iuNamedayWishInit\(\)\s*\{[\s\S]*?\n  \}/);
  if (!initM) return { pass: false, reason: "iuNamedayWishInit_missing" };
  const fn = initM[0];
  if (/iuGetUserAddress\s*\(\)/.test(fn)) {
    return { pass: false, reason: "readSilverSignatureForWish_falls_back_to_iuGetUserAddress" };
  }
  if (/iuSilverWelcomeUser/.test(fn)) {
    return { pass: false, reason: "readSilverSignatureForWish_falls_back_to_welcome_vocative" };
  }
  if (!/iuGetUserSignatureForWish/.test(fn)) {
    return { pass: false, reason: "iuGetUserSignatureForWish_not_used" };
  }
  if (!/buildFinalText/.test(fn) || !/readSilverSignatureForWish/.test(fn)) {
    return { pass: false, reason: "preview_copy_signature_path_missing" };
  }
  return { pass: true };
}

function assertSignatureCase(rt, input, expectSignature, label) {
  rt.reset();
  if (!rt.tryConsume(input)) {
    return { pass: false, label: label, reason: "consume_false", input: input };
  }
  const sig = String(rt.getSignature() || "").trim();
  if (sig !== expectSignature) {
    return { pass: false, label: label, reason: "signature_mismatch", input: input, got: sig, want: expectSignature };
  }
  return { pass: true, label: label, input: input, signature: sig };
}

function main() {
  const app = readApp();
  const html = readIndex();
  const rt = loadSignatureRuntime(app, createStore());
  const failures = [];

  const stripe = assertStripeAbsent(html);
  if (!stripe.pass) failures.push({ section: "css_stripe", ...stripe });

  const fallback = assertNoVocativeFallbackInWish(app);
  if (!fallback.pass) failures.push({ section: "wish_fallback", ...fallback });

  const signatureCases = [
    { input: "říkej mi Pepo", expect: "Pepa", label: "explicit_pepo" },
    { input: "jmenuji se Pepa", expect: "Pepa", label: "name_pepa" },
    { input: "jmenuji se Josef", expect: "Josef", label: "name_josef" },
    { input: "jmenuji se Karel", expect: "Karel", label: "name_karel" },
    { input: "říkej mi pane továrníku", expect: "Pan továrník", label: "explicit_pane_tovarniku" }
  ];

  const signatureResults = [];
  for (let i = 0; i < signatureCases.length; i++) {
    const c = signatureCases[i];
    const r = assertSignatureCase(rt, c.input, c.expect, c.label);
    signatureResults.push(r);
    if (!r.pass) failures.push({ section: "signature", ...r });
  }

  rt.reset();
  rt.tryConsume("říkej mi Pepo");
  const previewSig = String(rt.getSignature() || "").trim();
  const copySig = String(rt.getSignature() || "").trim();
  if (previewSig !== copySig || previewSig !== "Pepa") {
    failures.push({
      section: "preview_copy_parity",
      pass: false,
      reason: "preview_copy_mismatch",
      previewSig: previewSig,
      copySig: copySig
    });
  }

  const report = {
    guard: "silver-nameday-wish-overlay-guard-v1",
    pass: failures.length === 0,
    failures: failures,
    stripeCheck: stripe,
    fallbackCheck: fallback,
    signatureResults: signatureResults,
    previewCopyParity: previewSig === copySig && previewSig === "Pepa"
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n", "utf8");

  process.stdout.write("=== SILVER_NAMEDAY_WISH_OVERLAY_GUARD_V1 ===\n");
  process.stdout.write("stripe_absent: " + (stripe.pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("no_vocative_fallback: " + (fallback.pass ? "PASS" : "FAIL") + "\n");
  for (let i = 0; i < signatureResults.length; i++) {
    const r = signatureResults[i];
    process.stdout.write("signature_" + r.label + ": " + (r.pass ? "PASS" : "FAIL") + "\n");
  }
  process.stdout.write("preview_copy_parity: " + (report.previewCopyParity ? "PASS" : "FAIL") + "\n");
  process.stdout.write("FINAL_STATUS: " + (report.pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_SILVER_NAMEDAY_WISH_OVERLAY_GUARD_V1 ===\n");

  if (!report.pass) process.exit(1);
}

main();
