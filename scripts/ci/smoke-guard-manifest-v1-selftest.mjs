#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(REPO, "scripts", "ci", "smoke-guard-manifest-v1.json"), "utf8")
);
const names = manifest.guards.map((g) => g.name);
const fail = [];
if (names.some((n) => n.includes("Full UI smoke suite"))) fail.push("full_ui_in_manifest");
if (manifest.guards.length < 300) fail.push("manifest_too_small");
if (fail.length) {
  console.error(JSON.stringify({ IU_SMOKE_GUARD_MANIFEST_SELFTEST: "FAIL", fail }));
  process.exit(1);
}
console.log(JSON.stringify({ IU_SMOKE_GUARD_MANIFEST_SELFTEST: "OK", count: manifest.guards.length }));
