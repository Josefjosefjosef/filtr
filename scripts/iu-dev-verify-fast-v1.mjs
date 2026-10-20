#!/usr/bin/env node
/**
 * FAST CHECK — local pre-PR feedback. Does NOT replace required CI (FULL CHECK).
 * No deploy, no prod credentials, no live CJ/FORPSI network ingest.
 */
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", cwd: REPO, stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function runStep(label, cmd) {
  const started = Date.now();
  try {
    execSync(cmd, { cwd: REPO, stdio: "inherit", shell: true });
    return { label, ok: true, ms: Date.now() - started };
  } catch {
    failures.push(label);
    return { label, ok: false, ms: Date.now() - started };
  }
}

function hasNodeModules() {
  return fs.existsSync(path.join(REPO, "node_modules", "playwright"));
}

function readScopeOutputs(outputPath) {
  const map = {};
  if (!fs.existsSync(outputPath)) return map;
  for (const line of fs.readFileSync(outputPath, "utf8").split("\n")) {
    const m = /^([a-z0-9_]+)=(.*)$/i.exec(line.trim());
    if (m) map[m[1]] = m[2];
  }
  return map;
}

function listChangedFiles() {
  try {
    run("git fetch origin main --depth=64 2>/dev/null || git fetch origin main");
  } catch {
    /* best effort */
  }
  const base = run("git merge-base HEAD origin/main");
  const head = run("git rev-parse HEAD");
  const files = run(`git diff --name-only ${base}...${head}`).split("\n").filter(Boolean);
  return { base, head, files };
}

function main() {
  const { base, head, files } = listChangedFiles();
  console.log(JSON.stringify({ IU_DEV_VERIFY_FAST: "START", head, base, changedFiles: files.length }));

  const tmpOut = path.join(os.tmpdir(), `iu-dev-scope-${process.pid}.txt`);
  const env = {
    ...process.env,
    GITHUB_OUTPUT: tmpOut,
    SMOKE_BASE_SHA: base,
    SMOKE_HEAD_SHA: head,
    GITHUB_EVENT_NAME: "pull_request",
  };

  const scope = spawnSync("node", ["scripts/smoke-data-only-scope.mjs"], {
    cwd: REPO,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (scope.status !== 0) {
    failures.push("smoke-data-only-scope");
  }
  const scopeOut = readScopeOutputs(tmpOut);
  try {
    fs.unlinkSync(tmpOut);
  } catch {
    /* ignore */
  }

  const steps = [];

  const pyTouch =
    files.some((f) => f.endsWith(".py")) ||
    files.some((f) => f.startsWith("projects/data/"));
  if (pyTouch) {
    steps.push(runStep("python-repo-guard", "python scripts/repo_guard.py"));
  }

  if (!hasNodeModules()) {
    console.log("IU_DEV_VERIFY_SKIP_NODE=node_modules missing (run npm ci once, then re-run dev:verify)");
  } else {
    steps.push(runStep("iu-gha-immutable-pin-guard", "npm run iu-gha-immutable-pin-guard"));
    steps.push(runStep("iu-permissions-policy-guard", "npm run iu-permissions-policy-guard"));
    steps.push(runStep("iu-secondary-csp-guard", "npm run iu-secondary-csp-guard"));
    steps.push(runStep("iu-security-txt-guard", "npm run iu-security-txt-guard"));

    if (scopeOut.info_panel_cnb_rates_only === "true" || files.some((f) => f.includes("info_panel"))) {
      steps.push(runStep("iu-info-panel-cnb-rates-guard", "npm run iu-info-panel-cnb-rates-guard"));
    }

    const cjTouch = files.some((f) => f.includes("iu-cj-affiliate") || f.includes("cj-affiliate"));
    const fullStack = path.join(REPO, "scripts", "iu-cj-affiliate-phase2-offline-full-stack-v1-selftest.mjs");
    if (cjTouch && fs.existsSync(fullStack)) {
      steps.push(
        runStep("iu-cj-offline-full-stack", "node scripts/iu-cj-affiliate-phase2-offline-full-stack-v1-selftest.mjs")
      );
    } else if (cjTouch) {
      steps.push(runStep("iu-cj-unattended-selftest", "node scripts/iu-cj-affiliate-phase2-unattended-import-cycle-v1-selftest.mjs"));
    }
  }

  const pass = failures.length === 0 && scope.status === 0;
  console.log(
    JSON.stringify({
      IU_DEV_VERIFY_FAST: pass ? "PASS" : "FAIL",
      failures,
      scope: scopeOut,
      steps: steps.map((s) => ({ label: s.label, ok: s.ok, ms: s.ms })),
      FULL_CHECK_REQUIRED: "GitHub required checks (repo-guard, layout-guard, iu-ads-regression-freeze, smoke)",
      PRODUCTION_CHECK: "After merge: Pages deploy + prod guards (not run here)",
    })
  );
  process.exit(pass ? 0 : 1);
}

main();
