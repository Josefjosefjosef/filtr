/**
 * Emits run_bundle=true|false for IU Ads regression freeze workflow.
 * Ensures the required check runs on every PR (fast skip when out of scope).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const outFile = process.env.GITHUB_OUTPUT;

function emit(name, value) {
  const line = name + "=" + value + "\n";
  if (outFile) fs.appendFileSync(outFile, line);
  process.stdout.write(line);
}

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function ensureCommitReachable(sha) {
  if (!sha) return;
  try {
    run("git rev-parse --verify " + sha + "^{commit}");
    return;
  } catch {
    /* fetch below */
  }
  try {
    run("git fetch origin " + sha + " --depth=1");
  } catch {
    try {
      run("git fetch origin main --depth=128 2>/dev/null || git fetch origin main");
    } catch {
      /* best effort */
    }
  }
}

function listChangedFiles() {
  const event = process.env.GITHUB_EVENT_NAME || "";
  try {
    run("git fetch origin main --depth=64 2>/dev/null || git fetch origin main");
  } catch {
    /* best effort */
  }
  if (event === "pull_request") {
    const base = process.env.SMOKE_BASE_SHA || process.env.GITHUB_BASE_SHA || "";
    const head = process.env.SMOKE_HEAD_SHA || process.env.GITHUB_SHA || "";
    if (base && head) {
      ensureCommitReachable(base);
      return run("git diff --name-only " + base + "..." + head)
        .split(/\r?\n/)
        .filter(Boolean);
    }
  }
  if (event === "push") {
    const before = process.env.GITHUB_EVENT_BEFORE || "";
    const after = process.env.GITHUB_SHA || "";
    if (before && before !== "0000000000000000000000000000000000000000") {
      return execSync("git diff --name-only " + before + " " + after, { encoding: "utf8" })
        .split(/\r?\n/)
        .filter(Boolean);
    }
    if (after) {
      return execSync("git diff-tree --no-commit-id --name-only -r " + after, { encoding: "utf8" })
        .split(/\r?\n/)
        .filter(Boolean);
    }
  }
  return [];
}

function touchesAdsFreezeScope(file) {
  if (file.startsWith("cloudflare/iu-ads/")) return true;
  if (file === ".github/workflows/iu-ads-regression-freeze.yml") return true;
  if (file.startsWith("scripts/iu-premium-")) return true;
  if (file.startsWith("scripts/iu-ads-")) return true;
  if (file.startsWith("assets/iu-premium-")) return true;
  return false;
}

const files = listChangedFiles();
const runBundle = files.some(touchesAdsFreezeScope);
emit("run_bundle", runBundle ? "true" : "false");
process.stdout.write("IU_ADS_REGRESSION_FREEZE_SCOPE_FILES=" + String(files.length) + "\n");
