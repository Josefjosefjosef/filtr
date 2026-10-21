#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(REPO, "scripts", "ci", "smoke-guard-manifest-v1.json"), "utf8")
);
const names = manifest.guards.map((g) => g.name);
const fail = [];
if (names.some((n) => n.includes("Full UI smoke suite"))) fail.push("full_ui_in_manifest");
if (manifest.guards.length < 300) fail.push("manifest_too_small");
const seen = new Set();
for (const n of names) {
  if (seen.has(n)) fail.push("duplicate_name:" + n);
  seen.add(n);
}

function evalIf(ifGha, scope) {
  if (!ifGha || ifGha === "true") return true;
  let expr = ifGha.replace(/steps\.scope\.outputs\.([a-z0-9_]+)/gi, (_, key) => {
    const val = scope[key.toLowerCase()] ?? "";
    return val === "true" ? "true" : "false";
  });
  expr = expr.replace(/([^=!])\s*!=\s*'true'/g, "$1 !== 'true'");
  expr = expr.replace(/([^=!])\s*==\s*'true'/g, "$1 === 'true'");
  try {
    return Boolean(new Function(`return (${expr});`)());
  } catch {
    return false;
  }
}
const scopeFalse = Object.fromEntries(
  [
    "data_only",
    "desktop_article_read_mark_only",
    "legal_docs_form_state_only",
    "info_panel_cnb_rates_only",
  ].map((k) => [k, "false"])
);
const defaultSelected = manifest.guards.filter((g) => evalIf(g.ifGha, scopeFalse)).length;
if (defaultSelected < 389) fail.push("default_scope_selected:" + defaultSelected);
if (manifest.guards.some((g) => g.ifGha === ">")) fail.push("manifest_ifGha_corrupt");
const serialBucket = manifest.guards.filter((g) => g.serialBucket === true).length;
if (serialBucket > 32) fail.push("serial_bucket_too_large:" + serialBucket);
const require = createRequire(import.meta.url);
const { guardWiredInSmokeCi } = require("../guards/iu-smoke-ci-wiring-v1.cjs");
if (!guardWiredInSmokeCi(REPO, "iu-reload-visual-stability-contract-guard")) {
  fail.push("manifest_wiring_sample_missing");
}
if (fail.length) {
  console.error(JSON.stringify({ IU_SMOKE_GUARD_MANIFEST_SELFTEST: "FAIL", fail }));
  process.exit(1);
}
console.log(JSON.stringify({ IU_SMOKE_GUARD_MANIFEST_SELFTEST: "OK", count: manifest.guards.length }));
