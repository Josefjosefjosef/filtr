#!/usr/bin/env node

/** Negative tests: public preview must not expose staging data. */

import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";



const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [];



function record(id, pass, detail) {

  steps.push({ id, pass, detail });

}



const uiJs = fs.readFileSync(path.join(repoRoot, "assets", "iu-affiliate-phase2-offers-v1.js"), "utf8");

record("no_session_storage_bypass", !uiJs.includes("sessionStorage"), {});

record("localhost_gate", uiJs.includes("isLocalDevHost"), {});

record("public_stub_gate", uiJs.includes("public_stub_no_staging_data"), {});



const publicJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "assets", "cj-phase2-preview-autohotarek.json"), "utf8"));

record("public_json_no_staging", publicJson.previewGate === "public_stub_no_staging_data", {

  productCards: (publicJson.productCards || []).length,

});



const fixturePath = path.join(repoRoot, "scripts", "fixtures", "cj-phase2-preview-autohotarek.json");

if (fs.existsSync(fixturePath)) {

  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  record("fixture_has_preview_data", fixture.ok === true && fixture.previewOnly === true, {

    productCount: fixture.productCards?.length ?? 0,

  });

} else {

  record("fixture_has_preview_data", false, { missing: fixturePath });

}



record(
  "preview_flag_requires_localhost",
  uiJs.includes("isLocalDevHost") && uiJs.indexOf("isLocalDevHost") < uiJs.indexOf("iuCjPreview"),
  {}
);



const ok = steps.every((s) => s.pass);

console.log(

  JSON.stringify({

    IU_CJ_PREVIEW_SECURITY_SELFTEST: ok ? "OK" : "FAIL",

    pass: steps.filter((s) => s.pass).length,

    fail: steps.filter((s) => !s.pass).length,

    steps,

  })

);

process.exit(ok ? 0 : 1);


