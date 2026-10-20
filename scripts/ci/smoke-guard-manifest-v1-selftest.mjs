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
const seen = new Set();
for (const n of names) {
  if (seen.has(n)) fail.push("duplicate_name:" + n);
  seen.add(n);
}

function evalIf(ifGha, scope) {
  if (!ifGha || ifGha === "true") return true;
  const parts = ifGha.split("&&").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^steps\.scope\.outputs\.([a-z0-9_]+)\s*(!==|!=|==)\s*'true'$/i);
    if (!m) return false;
    const key = m[1].toLowerCase();
    const isTrue = (scope[key] ?? "") === "true";
    const op = m[2];
    if (op === "==") {
      if (!isTrue) return false;
    } else if (isTrue) {
      return false;
    }
  }
  return true;
}
const defaultSelected = manifest.guards.filter((g) => evalIf(g.ifGha, {})).length;
if (defaultSelected < 300) fail.push("default_scope_selected:" + defaultSelected);
if (fail.length) {
  console.error(JSON.stringify({ IU_SMOKE_GUARD_MANIFEST_SELFTEST: "FAIL", fail }));
  process.exit(1);
}
console.log(JSON.stringify({ IU_SMOKE_GUARD_MANIFEST_SELFTEST: "OK", count: manifest.guards.length }));
