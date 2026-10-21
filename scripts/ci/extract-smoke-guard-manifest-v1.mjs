#!/usr/bin/env node
/**
 * Extract parallelizable smoke guard steps from .github/workflows/smoke.yml
 * Output: scripts/ci/smoke-guard-manifest-v1.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wfPath = path.join(REPO, ".github", "workflows", "smoke.yml");
const lines = fs.readFileSync(wfPath, "utf8").split("\n");

const SKIP_NAME =
  /^(Set required status|Upload |Premium invoice PDF|IU Ads deploy|Post Checkout|Post Cache|Post Run actions)/;
const START_AFTER = "Full UI smoke suite";
const END_BEFORE = "Set required status context (smoke)";

let inSmokeJob = false;
let inSteps = false;
let afterFullUi = false;
const entries = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (line.startsWith("  smoke:")) inSmokeJob = true;
  if (inSmokeJob && line.startsWith("  ") && !line.startsWith("    ") && !line.startsWith("  smoke")) {
    inSmokeJob = false;
  }
  if (!inSmokeJob) {
    i += 1;
    continue;
  }
  if (line.trim() === "steps:") inSteps = true;
  if (!inSteps) {
    i += 1;
    continue;
  }
  if (line.startsWith("      - name:")) {
    const name = line.replace(/^\s+- name:\s*/, "").trim();
    let j = i + 1;
    let ifLine = "";
    let runLine = "";
    let timeout = null;
    const env = {};
    while (j < lines.length && !lines[j].startsWith("      - name:") && !lines[j].startsWith("      # Required status")) {
      const l = lines[j];
      if (l.match(/^\s+if:/)) ifLine = l.replace(/^\s+if:\s*/, "").trim();
      if (l.match(/^\s+timeout-minutes:/)) timeout = Number(l.replace(/^\s+timeout-minutes:\s*/, "").trim());
      if (/^\s+run:\s+npm run/.test(l) || /^\s+run:\s+node scripts/.test(l)) {
        runLine = l.replace(/^\s+run:\s*/, "").trim();
      }
      if (l.match(/^\s+[A-Z0-9_]+:/)) {
        const m = l.match(/^\s+([A-Z0-9_]+):\s*(.*)$/);
        if (m && !["if", "run", "name", "timeout-minutes"].includes(m[1])) {
          env[m[1]] = m[2].replace(/^"|"$/g, "");
        }
      }
      j += 1;
    }
    if (name.includes(START_AFTER)) {
      afterFullUi = true;
      i = j;
      continue;
    }
    if (name.includes(END_BEFORE)) break;
    if (afterFullUi && runLine && !SKIP_NAME.test(name) && !name.includes("Full UI smoke suite")) {
      entries.push({ name, ifGha: ifLine || "true", run: runLine, timeoutMinutes: timeout, env });
    }
    i = j;
    continue;
  }
  i += 1;
}

const outPath = path.join(REPO, "scripts", "ci", "smoke-guard-manifest-v1.json");
fs.writeFileSync(outPath, JSON.stringify({ version: 1, count: entries.length, guards: entries }, null, 2));
console.log(JSON.stringify({ IU_EXTRACT_SMOKE_GUARD_MANIFEST: "OK", count: entries.length, outPath }));
