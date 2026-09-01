#!/usr/bin/env node
/**
 * SC-GHA-02: require immutable full commit SHA for external actions
 * in security/deployment-critical workflows only (Tier A + required Tier B).
 * Does not ban mutable refs in low-impact Tier C workflows.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF_DIR = path.join(REPO, ".github/workflows");

/** Tier A deploy + Tier B required CI */
const CRITICAL_WORKFLOWS = new Set([
  "pages.yml",
  "deploy-iu-analytics.yml",
  "deploy-iu-ads.yml",
  "deploy-iu-site-redirects.yml",
  "deploy-articles-watchdog.yml",
  "deploy-chmi-cap-watchdog.yml",
  "smoke.yml",
  "layout-guard.yml",
  "repo-guard.yml",
]);

const SHA_RE = /^[0-9a-f]{40}$/i;
const USES_RE = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm;

const failures = [];
let checked = 0;

for (const name of [...CRITICAL_WORKFLOWS].sort()) {
  const filePath = path.join(WF_DIR, name);
  if (!fs.existsSync(filePath)) {
    failures.push({ file: name, ref: "(missing)", reason: "workflow_file_missing" });
    continue;
  }
  const src = fs.readFileSync(filePath, "utf8");
  let m;
  USES_RE.lastIndex = 0;
  while ((m = USES_RE.exec(src))) {
    const full = m[1].trim();
    if (full.startsWith("./") || full.startsWith(".\\")) continue;
    const at = full.lastIndexOf("@");
    if (at < 0) {
      failures.push({ file: name, ref: full, reason: "missing_ref" });
      continue;
    }
    const action = full.slice(0, at);
    const ref = full.slice(at + 1);
    checked += 1;
    if (!SHA_RE.test(ref)) {
      failures.push({
        file: name,
        ref: full,
        reason: "mutable_ref_in_critical_workflow",
        action,
      });
    }
  }
}

console.log("IU_GHA_IMMUTABLE_PIN_SCOPE_COUNT=" + CRITICAL_WORKFLOWS.size);
console.log("IU_GHA_IMMUTABLE_PIN_CHECKED=" + checked);

if (failures.length) {
  console.error("IU_GHA_IMMUTABLE_PIN_GUARD=FAIL count=" + failures.length);
  for (const f of failures) {
    console.error(
      "FAIL\t" + f.file + "\t" + f.ref + "\t" + f.reason
    );
  }
  process.exit(1);
}

console.log("IU_GHA_IMMUTABLE_PIN_GUARD=PASS checked=" + checked);
process.exit(0);
