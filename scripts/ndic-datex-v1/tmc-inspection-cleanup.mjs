/**
 * Fenced cleanup for TMC format-inspection task-owned dirs only.
 * Attests workdir, ZIP, and staging absence after wipe.
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
  INDEX: "TMC_CLEANUP_INDEX_REJECTED",
  ATTESTATION: "TMC_CLEANUP_ATTESTATION_FAILED",
});

export const ALLOWED_TASK_DIR_NAMES = Object.freeze([
  "ndic-inspect-work",
  "ndic-inspect-work-offline",
  "ndic-inspect-report",
]);

export const CLEANUP_ATTESTATION = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
});

const FORBIDDEN_BASENAMES = Object.freeze([
  "index.json",
  "last-good.json",
  "active-index.json",
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
  if (FORBIDDEN_BASENAMES.includes(base)) {
    throw Object.assign(new Error(CLEANUP_REJECT.INDEX), { code: CLEANUP_REJECT.INDEX });
  }
  if (!ALLOWED_TASK_DIR_NAMES.includes(base)) {
    throw Object.assign(new Error(CLEANUP_REJECT.FENCE), { code: CLEANUP_REJECT.FENCE });
  }
  const parent = path.dirname(resolved).replace(/\\/g, "/");
  if (parent !== rt) {
    throw Object.assign(new Error(CLEANUP_REJECT.FOREIGN), { code: CLEANUP_REJECT.FOREIGN });
  }
  return resolved;
}

function absentStat(target) {
  try {
    fs.lstatSync(target);
    return false;
  } catch (e) {
    if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return true;
    return false;
  }
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
  const name = path.basename(resolved);
  if (!fs.existsSync(resolved)) {
    return {
      ok: true,
      wiped: false,
      pathCategory: "task_temp",
      taskDirName: name,
      absentAfter: true,
      attestedAbsent: true,
    };
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  const absentAfter = absentStat(resolved);
  return {
    ok: true,
    wiped: true,
    pathCategory: "task_temp",
    taskDirName: name,
    absentAfter,
    attestedAbsent: absentAfter === true,
  };
}

/**
 * Build task-owned layout under runnerTemp and attest cleanup of work/zip/staging/report.
 * ZIP and staging must live under the same task work root.
 *
 * @param {{
 *   runnerTemp: string,
 *   workDirName?: string,
 *   reportDirName?: string,
 *   reportHandedOffBeforeCleanup?: boolean,
 *   skipWipe?: boolean,
 *   leaveZip?: boolean,
 *   leaveStaging?: boolean,
 *   leaveWork?: boolean,
 * }} opts
 */
export function attestInspectionCleanup(opts = {}) {
  const runnerTemp = String(opts.runnerTemp || "").trim();
  if (!runnerTemp) {
    throw Object.assign(new Error(CLEANUP_REJECT.FENCE), { code: CLEANUP_REJECT.FENCE });
  }
  const workName = opts.workDirName || "ndic-inspect-work";
  const reportName = opts.reportDirName || "ndic-inspect-report";
  const work = path.join(runnerTemp, workName);
  const report = path.join(runnerTemp, reportName);
  const zipPath = path.join(work, "task.zip");
  const stagingPath = path.join(work, "staging");

  assertInspectionCleanupTarget(work, { runnerTemp });
  assertInspectionCleanupTarget(report, { runnerTemp });

  let foreignPathTouched = false;
  try {
    assertInspectionCleanupTarget(path.join(runnerTemp, ".."), { runnerTemp });
    foreignPathTouched = true;
  } catch {
    foreignPathTouched = false;
  }

  const reportHandedOffBeforeCleanup = opts.reportHandedOffBeforeCleanup === true;
  const cleanupScriptExecuted = true;

  if (!opts.skipWipe) {
    if (opts.leaveWork !== true) {
      try {
        wipeInspectionTaskDir(work, { runnerTemp });
      } catch (_) {
        /* attested below */
      }
    }
    if (opts.leaveZip === true && fs.existsSync(work)) {
      /* intentional leftover for fixtures */
    }
    try {
      wipeInspectionTaskDir(report, { runnerTemp });
    } catch (_) {
      /* attested below */
    }
  }

  // Explicit ZIP/staging absence (even when removed via workdir wipe).
  const taskWorkdirRemoved = absentStat(work);
  const taskZipRemoved = absentStat(zipPath);
  const stagingRemoved = absentStat(stagingPath);
  const reportRemoved = absentStat(report);

  let cleanupAttestation = CLEANUP_ATTESTATION.PASSED;
  if (
    foreignPathTouched ||
    !cleanupScriptExecuted ||
    !reportHandedOffBeforeCleanup ||
    !taskWorkdirRemoved ||
    !taskZipRemoved ||
    !stagingRemoved ||
    !reportRemoved
  ) {
    cleanupAttestation = CLEANUP_ATTESTATION.FAILED;
  }
  if (opts.leaveZip === true || opts.leaveStaging === true || opts.leaveWork === true) {
    cleanupAttestation = CLEANUP_ATTESTATION.FAILED;
  }

  return {
    cleanupScriptExecuted,
    taskWorkdirRemoved,
    taskZipRemoved,
    stagingRemoved,
    reportHandedOffBeforeCleanup,
    foreignPathTouched,
    cleanupAttestation,
  };
}

/**
 * Prepare a fenced task layout for offline cleanup fixtures (synthetic only).
 */
export function prepareInspectionCleanupLayout(runnerTemp, opts = {}) {
  const workName = opts.workDirName || "ndic-inspect-work";
  const reportName = opts.reportDirName || "ndic-inspect-report";
  const work = path.join(runnerTemp, workName);
  const report = path.join(runnerTemp, reportName);
  const staging = path.join(work, "staging");
  assertInspectionCleanupTarget(work, { runnerTemp });
  assertInspectionCleanupTarget(report, { runnerTemp });
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(report, { recursive: true });
  fs.writeFileSync(path.join(work, "task.zip"), Buffer.alloc(8));
  fs.writeFileSync(path.join(staging, "entry.bin"), Buffer.alloc(4));
  fs.writeFileSync(path.join(report, "inspection-report.json"), Buffer.from("{}"));
  return {
    workDirName: workName,
    reportDirName: reportName,
    hasZip: true,
    hasStaging: true,
    hasReport: true,
  };
}
