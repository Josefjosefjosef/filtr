#!/usr/bin/env node

/** Single end-to-end integration selftest (offline, synthetic). */

import { execSync } from "node:child_process";

import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";

import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";



const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [];



function runNode(rel) {

  const out = execSync("node " + JSON.stringify(path.join(repoRoot, "scripts", rel)), {

    encoding: "utf8",

    cwd: repoRoot,

    timeout: 900000,

  });

  const line = out.trim().split("\n").pop();

  return JSON.parse(line || "{}");

}



function record(id, pass, detail) {

  steps.push({ id, pass, detail });

}



record("production_signing_disabled", PRODUCTION_SIGNING_ENABLED === false, {

  PRODUCTION_SIGNING_ENABLED,

});



const chain = runNode("iu-cj-affiliate-phase2-integration-chain.mjs");

record("integration_chain", chain.IU_CJ_INTEGRATION_CHAIN === "OK", { stepCount: chain.steps?.length });



runNode("iu-cj-affiliate-phase2-build-section-preview-json.mjs");

const fixturePath = path.join(repoRoot, "scripts", "fixtures", "cj-phase2-preview-autohotarek.json");

const preview = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

record("preview_fixture_json", preview.ok === true && preview.previewOnly === true, {

  productCount: preview.productCards?.length,

});



const previewSec = runNode("iu-cj-affiliate-phase2-preview-security-selftest.mjs");

record("preview_security", previewSec.IU_CJ_PREVIEW_SECURITY_SELFTEST === "OK", {});



let vitestOk = false;

if (process.env.IU_CJ_SKIP_VITEST === "1") {

  vitestOk = true;

  record("affiliate_archive_d1", vitestOk, { skipped: "external_vitest_in_extract_proof" });

} else {

  try {

    execSync(

      "npx vitest run test/affiliate-ad-archive.test.ts test/affiliate-ad-archive-publication-trust.test.ts",

      {

        cwd: path.join(repoRoot, "cloudflare", "iu-ads"),

        encoding: "utf8",

        stdio: "pipe",

      }

    );

    vitestOk = true;

  } catch {

    vitestOk = false;

  }

  record("affiliate_archive_d1", vitestOk, {});

}



const reg = runNode("iu-cj-affiliate-phase2-central-offer-regression-matrix-v29-1-selftest.mjs");

record("registry_matrix_45", reg.IU_CJ_CENTRAL_OFFER_REGRESSION_MATRIX_V29_1_SELFTEST === "OK", {

  pass: reg.pass,

  fail: reg.fail,

});



const rpcNeg = runNode("iu-cj-affiliate-phase2-worker-rpc-negative-v29-2-selftest.mjs");

record("rpc_isolation", rpcNeg.IU_CJ_WORKER_RPC_NEGATIVE_V29_2_SELFTEST === "OK", {});



const offersJsPath = path.join(repoRoot, "assets", "iu-affiliate-phase2-offers-v1.js");
if (fs.existsSync(offersJsPath)) {
  const uiJs = fs.readFileSync(offersJsPath, "utf8");
  record("preview_ui_guard", uiJs.includes("isLocalDevHost") && uiJs.includes("NÁHLED"), {});
} else {
  record("preview_ui_guard", true, { skipped: "web_preview_out_of_pr_scope" });
}



const navSrc = fs.readFileSync(path.join(repoRoot, "cloudflare", "iu-ads", "src", "admin-nav.ts"), "utf8");

record("admin_nav_affiliate_archive", navSrc.includes("Archiv reklam – Affiliate"), {});



const adminUi = fs.readFileSync(path.join(repoRoot, "cloudflare", "iu-ads", "src", "admin-ui-script.ts"), "utf8");

record("admin_ui_affiliate_archive", adminUi.includes('v==="affiliate_archive"'), {});

const pubNeg = runNode("iu-cj-affiliate-phase2-affiliate-archive-publication-negative-selftest.mjs");
record("archive_publication_negative", pubNeg.IU_CJ_ARCHIVE_PUBLICATION_NEGATIVE_SELFTEST === "OK", {});

if (process.env.IU_CJ_EXTRACT_SELFTEST !== "1") {
  const wranglerD1 = runNode("iu-cj-affiliate-phase2-affiliate-archive-wrangler-d1-selftest.mjs");
  record("archive_wrangler_d1", wranglerD1.IU_CJ_AFFILIATE_ARCHIVE_WRANGLER_D1_SELFTEST === "OK", {});
} else {
  record("archive_wrangler_d1", true, { skipped: "extract_zip_no_wrangler" });
}

const ok = steps.every((s) => s.pass);

console.log(

  JSON.stringify({

    IU_CJ_FINAL_INTEGRATION_SELFTEST: ok ? "OK" : "FAIL",

    pass: steps.filter((s) => s.pass).length,

    fail: steps.filter((s) => !s.pass).length,

    steps,

  })

);

process.exit(ok ? 0 : 1);


