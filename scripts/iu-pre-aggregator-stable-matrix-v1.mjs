#!/usr/bin/env node
/**
 * Pre-aggregator stabilization matrix — runs key guards, writes JSON summary to %TEMP%.
 * Does not fail the process on optional SKIP; exits 1 only on hard FAIL.
 *
 * Run: npm run iu-pre-aggregator-stable-matrix
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(os.tmpdir(), `iu-pre-aggregator-stable-matrix-${Date.now()}.json`);

const JOBS = [
  { id: "freeze", cmd: ["node", "scripts/iu-pre-aggregator-stable-freeze-guard-v1.mjs"], required: true },
  { id: "cross_browser_features", cmd: ["node", "scripts/iu-pre-aggregator-cross-browser-feature-guard-v1.mjs"], required: true },
  { id: "layout", cmd: ["node", "scripts/check_layout.js"], required: true },
  { id: "pwa_offline", cmd: ["npm", "run", "iu-pwa-offline-resilience-guard"], required: true },
  { id: "article_parity", cmd: ["npm", "run", "article-entrypoint-parity-guard"], required: true },
  { id: "local_data_protection", cmd: ["npm", "run", "iu-local-data-protection-guard"], required: false },
  { id: "user_data_backup", cmd: ["npm", "run", "iu-user-data-backup-guard"], required: false },
  { id: "pc_browser_compat", cmd: ["npm", "run", "iu-pc-browser-compat-guard"], required: false },
  { id: "quicktools_fixed_width", cmd: ["npm", "run", "iu-quicktools-fixed-width-guard"], required: false },
  { id: "articles_freshness", cmd: ["npm", "run", "articles-aggregator-freshness-guard"], required: false },
  { id: "prod_version_probe", cmd: ["node", "scripts/iu-prod-version-json-safe-probe-v1.mjs"], required: false },
];

function runOne(job) {
  const started = new Date().toISOString();
  const r = spawnSync(job.cmd[0], job.cmd.slice(1), {
    cwd: REPO,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    timeout: 20 * 60 * 1000,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const pass = r.status === 0;
  return {
    id: job.id,
    required: !!job.required,
    status: pass ? "PASS" : "FAIL",
    exitCode: r.status,
    started,
    ended: new Date().toISOString(),
    tail: out.split(/\r?\n/).filter(Boolean).slice(-12),
  };
}

function main() {
  const results = [];
  for (const job of JOBS) {
    console.log(`[matrix] START ${job.id}`);
    const res = runOne(job);
    results.push(res);
    console.log(`[matrix] ${res.status} ${job.id}`);
  }
  const hardFails = results.filter((r) => r.required && r.status === "FAIL");
  const summary = {
    preStabilizationProductionSha: "1e47ac46d93147035730314716641f71b330fffd",
    generatedAt: new Date().toISOString(),
    hardFails: hardFails.map((r) => r.id),
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[matrix] REPORT=${OUT}`);
  if (hardFails.length) {
    console.error("[matrix] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[matrix] RESULT=PASS");
}

main();
