#!/usr/bin/env node
/**
 * CHMI merge-window guardian: enable-only restore for two target workflows.
 * Does not disable workflows, merge PRs, or touch repo data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const GUARDIAN_WORKFLOW_BASENAME = "chmi-cap-v2-merge-window-guardian.yml";
export const TARGET_WORKFLOW_FILES = Object.freeze([
  "update-chmi-cap-v2.yml",
  "chmi-cap-watchdog-cron-fallback.yml",
]);

export const MIN_WAIT_MINUTES = 1;
export const MAX_WAIT_MINUTES = 15;
export const DEFAULT_MAX_ATTEMPTS = 4;
export const DEFAULT_RETRY_DELAY_MS = 2500;

export function clampWaitMinutes(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const m = Math.trunc(n);
  if (m < MIN_WAIT_MINUTES || m > MAX_WAIT_MINUTES) return null;
  return m;
}

export function assertRestorableWorkflowFile(workflowFile) {
  const base = String(workflowFile || "").trim();
  if (!base) throw new Error("empty_workflow_file");
  if (base === GUARDIAN_WORKFLOW_BASENAME) {
    throw new Error("guardian_self_target_forbidden");
  }
  if (!TARGET_WORKFLOW_FILES.includes(base)) {
    throw new Error("workflow_not_in_allowlist");
  }
  return base;
}

export function parseWorkflowStateFromApi(json) {
  const state = String(json?.state || "").toLowerCase();
  if (state === "active") return "active";
  if (state === "disabled_manually" || state === "disabled") return "disabled";
  return "unknown";
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} opts
 * @param {string[]} opts.targets
 * @param {(file:string)=>Promise<{ok:boolean,status:number,state:string,body?:string}>} opts.fetchState
 * @param {(file:string)=>Promise<{ok:boolean,status:number,body?:string}>} opts.enableWorkflow
 * @param {number} opts.maxAttempts
 * @param {number} opts.retryDelayMs
 */
export async function restoreTargetWorkflows(opts) {
  const targets = opts.targets.map(assertRestorableWorkflowFile);
  const maxAttempts = Math.max(1, Number(opts.maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs = Math.max(0, Number(opts.retryDelayMs) || DEFAULT_RETRY_DELAY_MS);
  const attemptsLog = [];
  const finalStates = {};

  for (const file of targets) {
    let enabled = false;
    let lastError = "enable_not_attempted";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const en = await opts.enableWorkflow(file);
      attemptsLog.push({ file, attempt, phase: "enable", ok: en.ok, status: en.status });
      if (!en.ok) {
        lastError = `enable_http_${en.status}`;
        if (attempt < maxAttempts && retryDelayMs > 0) await sleepMs(retryDelayMs);
        continue;
      }
      const st = await opts.fetchState(file);
      attemptsLog.push({ file, attempt, phase: "verify", ok: st.ok, status: st.status, state: st.state });
      if (st.ok && st.state === "active") {
        enabled = true;
        finalStates[file] = "active";
        break;
      }
      lastError = st.ok ? `verify_state_${st.state}` : `verify_http_${st.status}`;
      if (attempt < maxAttempts && retryDelayMs > 0) await sleepMs(retryDelayMs);
    }
    if (!enabled) {
      finalStates[file] = finalStates[file] || "failed";
      return {
        status: "BLOCKED",
        reason: "INCOMPLETE_RESTORE",
        file,
        lastError,
        finalStates,
        attemptsLog,
      };
    }
  }

  return {
    status: "SAFE",
    reason: "ALL_TARGETS_ACTIVE",
    finalStates,
    attemptsLog,
  };
}

export function validateGuardianWorkflowStatic(workflowYaml) {
  const src = String(workflowYaml || "");
  const fails = [];
  if (!/name:\s*CHMI CAP v2 merge window guardian/i.test(src)) fails.push("name");
  if (!/workflow_dispatch:/.test(src)) fails.push("workflow_dispatch");
  if (/^\s*schedule:/m.test(src)) fails.push("schedule_forbidden");
  if (/gh workflow disable/i.test(src)) fails.push("disable_forbidden");
  if (/gh pr merge|update-branch|pulls\/\$\{/i.test(src)) fails.push("merge_forbidden");
  if (!/permissions:\s*\n\s*actions:\s*write/m.test(src)) fails.push("actions_write");
  if (!/cancel-in-progress:\s*false/.test(src)) fails.push("concurrency_no_cancel");
  if (!/if:\s*always\(\)/.test(src)) fails.push("restore_always");
  for (const t of TARGET_WORKFLOW_FILES) {
    if (!src.includes(t)) fails.push(`missing_target_ref_${t}`);
  }
  if (src.includes(GUARDIAN_WORKFLOW_BASENAME) && /disable/.test(src)) fails.push("guardian_disable_mention");
  return fails;
}

function githubRepoFromEnv() {
  const repo = process.env.GITHUB_REPOSITORY || "";
  if (!repo.includes("/")) return null;
  return repo;
}

async function ghFetch(pathSuffix, { method = "GET", token }) {
  const repo = githubRepoFromEnv();
  if (!repo) throw new Error("GITHUB_REPOSITORY_missing");
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${pathSuffix}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "iu-chmi-cap-v2-merge-window-guardian-v1",
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function runRestoreLive() {
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (!token) {
    console.error(JSON.stringify({ IU_CHMI_CAP_V2_MERGE_WINDOW_GUARDIAN: "BLOCKED", reason: "missing_github_token" }));
    process.exit(1);
  }
  const result = await restoreTargetWorkflows({
    targets: [...TARGET_WORKFLOW_FILES],
    maxAttempts: Number(process.env.IU_CHMI_GUARDIAN_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS),
    retryDelayMs: Number(process.env.IU_CHMI_GUARDIAN_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS),
    enableWorkflow: async (file) => {
      const r = await ghFetch(file, { method: "PUT", token });
      return { ok: r.ok || r.status === 204, status: r.status, body: r.text?.slice(0, 200) };
    },
    fetchState: async (file) => {
      const r = await ghFetch(file, { method: "GET", token });
      const state = r.ok ? parseWorkflowStateFromApi(r.json) : "unknown";
      return { ok: r.ok, status: r.status, state, body: r.text?.slice(0, 200) };
    },
  });
  console.log(JSON.stringify({ IU_CHMI_CAP_V2_MERGE_WINDOW_GUARDIAN: result.status, ...result }));
  process.exit(result.status === "SAFE" ? 0 : 1);
}

function runValidateWait(argv) {
  const idx = argv.indexOf("--validate-wait");
  const raw = idx >= 0 ? argv[idx + 1] : "";
  const m = clampWaitMinutes(raw);
  if (m == null) {
    console.error(JSON.stringify({ IU_CHMI_CAP_V2_MERGE_WINDOW_GUARDIAN_WAIT: "BLOCKED", raw }));
    process.exit(1);
  }
  console.log(JSON.stringify({ IU_CHMI_CAP_V2_MERGE_WINDOW_GUARDIAN_WAIT: "OK", wait_minutes: m }));
  process.exit(0);
}

function runStaticGuard() {
  const wfPath = path.join(REPO_ROOT, ".github", "workflows", GUARDIAN_WORKFLOW_BASENAME);
  const src = fs.readFileSync(wfPath, "utf8");
  const fails = validateGuardianWorkflowStatic(src);
  if (fails.length) {
    console.error(JSON.stringify({ IU_CHMI_CAP_V2_MERGE_WINDOW_GUARDIAN_STATIC: "FAIL", fails }));
    process.exit(1);
  }
  console.log(JSON.stringify({ IU_CHMI_CAP_V2_MERGE_WINDOW_GUARDIAN_STATIC: "OK" }));
  process.exit(0);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--static-guard")) {
    runStaticGuard();
  }
  if (argv.includes("--validate-wait")) {
    runValidateWait(argv);
  }
  if (argv.includes("--restore")) {
    await runRestoreLive();
  }
  console.error("usage: --static-guard | --validate-wait <minutes> | --restore");
  process.exit(2);
}

if (process.argv[1] && process.argv[1].includes("iu-chmi-cap-v2-merge-window-guardian-v1.mjs")) {
  main();
}
