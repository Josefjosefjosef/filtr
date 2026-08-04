/**
 * Fenced cleanup for TMC format-inspection task-owned dirs only.
 * Never wipes RUNNER_TEMP root, workspace, home, or foreign jobs.
 */
import fs from "node:fs";
import path from "node:path";

export const CLEANUP_REJECT = Object.freeze({
  EMPTY: "TMC_CLEANUP_EMPTY_PATH",
  ROOT: "TMC_CLEANUP_ROOT_REJECTED",
  HOME: "TMC_CLEANUP_HOME_REJECTED",
  WORKSPACE: "TMC_CLEANUP_WORKSPACE_REJECTED",
  RUNNER_TEMP_ROOT: "TMC_CLEANUP_RUNNER_TEMP_ROOT_REJECTED",
  FOREIGN: "TMC_CLEANUP_FOREIGN_JOB_REJECTED",
  FENCE: "TMC_CLEANUP_FENCE_REJECTED",
});

export const ALLOWED_TASK_DIR_NAMES = Object.freeze([
  "ndic-inspect-work",
  "ndic-inspect-work-offline",
  "ndic-inspect-report",
]);

/**
 * @param {string} targetPath
 * @param {{ runnerTemp?: string, workspace?: string, home?: string }} [ctx]
 */
export function assertInspectionCleanupTarget(targetPath, ctx = {}) {
  const raw = String(targetPath || "").trim();
  if (!raw) {
    throw Object.assign(new Error(CLEANUP_REJECT.EMPTY), { code: CLEANUP_REJECT.EMPTY });
  }
  const resolved = path.resolve(raw);
  const norm = resolved.replace(/\\/g, "/");
  if (norm === "/" || /^[A-Za-z]:\/?$/.test(norm)) {
    throw Object.assign(new Error(CLEANUP_REJECT.ROOT), { code: CLEANUP_REJECT.ROOT });
  }
  const home = String(ctx.home || process.env.HOME || process.env.USERPROFILE || "").replace(/\\/g, "/");
  const ws = String(ctx.workspace || process.env.GITHUB_WORKSPACE || "").replace(/\\/g, "/");
  const runnerTemp = String(ctx.runnerTemp || process.env.RUNNER_TEMP || "").replace(/\\/g, "/");
  if (!runnerTemp) {
    throw Object.assign(new Error(CLEANUP_REJECT.FENCE), { code: CLEANUP_REJECT.FENCE });
  }
  const rt = path.resolve(runnerTemp).replace(/\\/g, "/");
  if (norm === rt) {
    throw Object.assign(new Error(CLEANUP_REJECT.RUNNER_TEMP_ROOT), {
      code: CLEANUP_REJECT.RUNNER_TEMP_ROOT,
    });
  }
  if (!(norm === rt || norm.startsWith(rt + "/"))) {
    throw Object.assign(new Error(CLEANUP_REJECT.FOREIGN), { code: CLEANUP_REJECT.FOREIGN });
  }
  // Home/workspace rejects only when target is outside the runner-temp fence (already enforced)
  // or when explicitly pointing at home/workspace roots themselves.
  if (home) {
    const hn = path.resolve(home).replace(/\\/g, "/");
    if (norm === hn) {
      throw Object.assign(new Error(CLEANUP_REJECT.HOME), { code: CLEANUP_REJECT.HOME });
    }
  }
  if (ws) {
    const wn = path.resolve(ws).replace(/\\/g, "/");
    if (norm === wn || (norm.startsWith(wn + "/") && !norm.startsWith(rt + "/"))) {
      throw Object.assign(new Error(CLEANUP_REJECT.WORKSPACE), { code: CLEANUP_REJECT.WORKSPACE });
    }
  }
  const base = path.basename(resolved);
  if (!ALLOWED_TASK_DIR_NAMES.includes(base)) {
    throw Object.assign(new Error(CLEANUP_REJECT.FENCE), { code: CLEANUP_REJECT.FENCE });
  }
  // Must be direct child of runner temp (no nested foreign escape).
  const parent = path.dirname(resolved).replace(/\\/g, "/");
  if (parent !== rt) {
    throw Object.assign(new Error(CLEANUP_REJECT.FOREIGN), { code: CLEANUP_REJECT.FOREIGN });
  }
  return resolved;
}

/**
 * @param {string} targetPath
 * @param {{ runnerTemp?: string, workspace?: string, home?: string, timeoutMs?: number }} [ctx]
 */
export function wipeInspectionTaskDir(targetPath, ctx = {}) {
  const started = Date.now();
  const timeoutMs = ctx.timeoutMs != null ? ctx.timeoutMs : 30_000;
  const resolved = assertInspectionCleanupTarget(targetPath, ctx);
  if (Date.now() - started > timeoutMs) {
    throw Object.assign(new Error("TMC_CLEANUP_TIMEOUT"), { code: "TMC_CLEANUP_TIMEOUT" });
  }
  if (!fs.existsSync(resolved)) return { ok: true, wiped: false, pathCategory: "task_temp" };
  fs.rmSync(resolved, { recursive: true, force: true });
  return { ok: true, wiped: true, pathCategory: "task_temp" };
}
