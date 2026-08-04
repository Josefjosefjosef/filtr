#!/usr/bin/env node
/**
 * Shadow probe runner with OOM/process-failure fallback report (no secrets/raw).
 * Writes sanitized JSON to argv[2] or IU_NDIC_SHADOW_REPORT_PATH.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";
import { assertNoTestDiskProviderEnv } from "./ndic-datex-v1/disk-preflight.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath =
  process.argv[2] ||
  process.env.IU_NDIC_SHADOW_REPORT_PATH ||
  path.join(process.env.RUNNER_TEMP || process.env.TEMP || "/tmp", "ndic-shadow-report", "shadow-report.json");

fs.mkdirSync(path.dirname(reportPath), { recursive: true, mode: 0o700 });

try {
  assertNoTestDiskProviderEnv(process.env);
  assertNdicCzechEgressRunnerOrThrow(process.env);
} catch (e) {
  const code = (e && e.code) || "REFUSING_GITHUB_HOSTED";
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ok: false,
        mode: "shadow",
        reason: code,
        errorCode: code,
        githubHostedNdicAccessBlocked: code !== "REFUSING_TEST_DISK_PROVIDER_ENV",
        datexRequestAttempted: false,
        tmcRequestAttempted: false,
        datex: null,
        tmc: null,
        phases: {
          datexFetch: "NOT_RUN",
          datexXxeProtection: "NOT_RUN",
          datexChunkBoundary: "NOT_RUN",
          tmcFetch: "NOT_RUN",
          tmcDiskPreflight: "NOT_RUN",
        },
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  process.exit(1);
}

function writeFallback(exitCode, signal) {
  const body = {
    ok: false,
    mode: "shadow",
    reason: "probe_process_failed",
    processExitCode: exitCode == null ? null : exitCode,
    processSignal: signal || null,
    failureCategory: signal === "SIGKILL" || exitCode === 134 || exitCode === 137 ? "RESOURCE_LIMIT" : "PROCESS_FAILURE",
    cleanupAttempted: true,
    datexRequestAttempted: false,
    tmcRequestAttempted: false,
    datex: null,
    tmc: null,
    phases: {
      datexFetch: "NOT_RUN",
      datexXxeProtection: "NOT_RUN",
      datexChunkBoundary: "NOT_RUN",
      tmcFetch: "NOT_RUN",
      tmcDiskPreflight: "NOT_RUN",
    },
  };
  fs.writeFileSync(reportPath, JSON.stringify(body, null, 2), { mode: 0o600 });
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, "scripts", "ndic-datex-v1-shadow-probe.mjs")],
  {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => {
  stdout += d.toString("utf8");
  // Bound stderr/stdout retention for fallback only — never log secrets
  if (stdout.length > 2_000_000) stdout = stdout.slice(-500_000);
});
child.stderr.on("data", (d) => {
  stderr += d.toString("utf8");
  if (stderr.length > 200_000) stderr = stderr.slice(-80_000);
});

child.on("close", (code, signal) => {
  const trimmed = stdout.trim();
  let wrote = false;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      fs.writeFileSync(reportPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
      wrote = true;
    } catch (_) {
      wrote = false;
    }
  }
  if (!wrote) writeFallback(code, signal);
  // Never print stderr (may contain paths); exit non-zero on failure
  if (code !== 0 || signal) process.exit(code || 1);
  // Propagate ok=false
  try {
    const r = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    if (!r.ok) process.exit(2);
  } catch (_) {
    process.exit(1);
  }
  process.exit(0);
});
