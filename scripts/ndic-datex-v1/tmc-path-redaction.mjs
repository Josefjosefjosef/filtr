/**
 * Path category redaction for NDIC reports (no absolute paths, no usernames).
 */
import path from "node:path";
import os from "node:os";

export const PATH_CATEGORY = Object.freeze({
  RUNNER_TEMP: "runner_temp",
  TASK_TEMP: "task_temp",
  WORKSPACE: "workspace",
  ARTIFACT_SANITIZED: "artifact_sanitized",
  OS_TMPDIR: "os_tmpdir",
  UNKNOWN_SANITIZED: "unknown_sanitized",
});

const ABS_POSIX = /(?:^|[\s"'=])(\/(?:home|tmp|opt|var|usr|Users)\/[^\s"']+)/i;
const ABS_WIN = /(?:^|[\s"'=])([A-Za-z]:\\(?:Users|Temp|Windows)[^"'\s]*)/i;
const USER_HINT = /(?:[/\\])Users[/\\][^/\\]+/i;

/**
 * @param {string} absPath
 * @returns {string} PATH_CATEGORY value
 */
export function categorizePath(absPath) {
  const p = String(absPath || "").replace(/\\/g, "/").toLowerCase();
  if (!p) return PATH_CATEGORY.UNKNOWN_SANITIZED;
  const runnerTemp = String(process.env.RUNNER_TEMP || "").replace(/\\/g, "/").toLowerCase();
  const shadow = String(process.env.IU_NDIC_SHADOW_WORK_DIR || "").replace(/\\/g, "/").toLowerCase();
  const ws = String(process.env.GITHUB_WORKSPACE || "").replace(/\\/g, "/").toLowerCase();
  const tmp = String(os.tmpdir() || "").replace(/\\/g, "/").toLowerCase();
  if (runnerTemp && (p === runnerTemp || p.startsWith(runnerTemp + "/"))) return PATH_CATEGORY.RUNNER_TEMP;
  if (shadow && (p === shadow || p.startsWith(shadow + "/"))) return PATH_CATEGORY.TASK_TEMP;
  if (ws && (p === ws || p.startsWith(ws + "/"))) return PATH_CATEGORY.WORKSPACE;
  if (tmp && (p === tmp || p.startsWith(tmp + "/"))) return PATH_CATEGORY.OS_TMPDIR;
  if (p === "/tmp" || p.startsWith("/tmp/")) return PATH_CATEGORY.OS_TMPDIR;
  if (/ndic-shadow-report|artifact/i.test(p)) return PATH_CATEGORY.ARTIFACT_SANITIZED;
  return PATH_CATEGORY.UNKNOWN_SANITIZED;
}

/**
 * True if string contains absolute path or username path segments that must not appear in reports.
 * @param {string} text
 */
export function containsForbiddenPathLeak(text) {
  const s = String(text || "");
  // Match both raw and JSON-escaped Windows separators.
  if (/[A-Za-z]:\\+Users\\+/i.test(s)) return true;
  if (/[A-Za-z]:\\+Temp\\+/i.test(s)) return true;
  if (/\/home\/[A-Za-z0-9._-]+/i.test(s)) return true;
  if (/\/tmp\/[^\s"']+/i.test(s)) return true;
  if (/\/opt\/[^\s"']+/i.test(s)) return true;
  if (/\/var\/[^\s"']+/i.test(s)) return true;
  if (ABS_POSIX.test(s) || ABS_WIN.test(s) || USER_HINT.test(s)) return true;
  return false;
}

/**
 * Strip absolute path leaks from a string (replace with category token).
 * @param {string} text
 */
export function redactAbsolutePaths(text) {
  let s = String(text || "");
  s = s.replace(/[A-Za-z]:\\(?:Users|Temp|Windows)[^"'\s]*/gi, PATH_CATEGORY.UNKNOWN_SANITIZED);
  s = s.replace(/\/(?:home|tmp|opt|var|usr)\/[^\s"']+/gi, PATH_CATEGORY.UNKNOWN_SANITIZED);
  return s;
}

/**
 * Assert a JSON-serializable report object has no absolute path leaks.
 * @param {unknown} report
 */
export function assertReportPathSafe(report) {
  const blob = JSON.stringify(report);
  if (containsForbiddenPathLeak(blob)) {
    throw Object.assign(new Error("TMC_INSPECTION_PATH_INVALID"), {
      code: "TMC_INSPECTION_PATH_INVALID",
    });
  }
  return true;
}

export { path };
