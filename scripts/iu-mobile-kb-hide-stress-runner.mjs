#!/usr/bin/env node
/**
 * Sequential separate-process stress for keyboard-hide guard.
 * Aggregates only: pass/fail/timeout/orphan counts.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(REPO, "scripts", "iu-mobile-bottom-nav-keyboard-hide-guard-v1.mjs");
const FAIL_LOG = path.join(os.tmpdir(), "iu-kb-hide-stress-fails.log");

const TABLET_N = parseInt(process.env.IU_KB_STRESS_TABLET || "100", 10);
const MOBILE_N = parseInt(process.env.IU_KB_STRESS_MOBILE || "50", 10);
const DESKTOP_N = parseInt(process.env.IU_KB_STRESS_DESKTOP || "25", 10);
const FULL_N = parseInt(process.env.IU_KB_STRESS_FULL || "20", 10);
const PER_RUN_MS = parseInt(process.env.IU_KB_STRESS_TIMEOUT_MS || "180000", 10);

function runOnce(only) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [GUARD], {
      cwd: REPO,
      env: {
        ...process.env,
        IU_KB_HIDE_ONLY: only,
        IU_GUARD_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch (_) {}
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch (_) {}
      }, 2000);
    }, PER_RUN_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: code === null ? -1 : code,
        signal: signal || null,
        timedOut,
        orphan: timedOut && code === null,
        stdout,
        stderr,
      });
    });
  });
}

async function runBatch(label, only, n) {
  let pass = 0;
  let fail = 0;
  let timeout = 0;
  let orphan = 0;
  for (let i = 0; i < n; i++) {
    const r = await runOnce(only);
    if (r.timedOut) timeout += 1;
    if (r.orphan) orphan += 1;
    if (!r.timedOut && r.code === 0) pass += 1;
    else {
      fail += 1;
      try {
        fs.appendFileSync(
          FAIL_LOG,
          `\n=== ${label} #${i + 1} code=${r.code} timedOut=${r.timedOut} ===\n` +
            r.stdout +
            "\n" +
            r.stderr +
            "\n"
        );
      } catch (_) {}
    }
    if ((i + 1) % 10 === 0 || i + 1 === n) {
      process.stderr.write(`${label} ${i + 1}/${n} pass=${pass} fail=${fail}\n`);
    }
  }
  return { label, only, runs: n, pass, fail, timeout, orphan };
}

async function main() {
  try {
    fs.writeFileSync(FAIL_LOG, "");
  } catch (_) {}
  const batches = [];
  batches.push(await runBatch("TABLET", "TABLET", TABLET_N));
  batches.push(await runBatch("MOBILE", "MOBILE", MOBILE_N));
  batches.push(await runBatch("DESKTOP", "DESKTOP", DESKTOP_N));
  batches.push(await runBatch("FULL", "ALL", FULL_N));

  const summary = {
    node: process.version,
    failLog: FAIL_LOG,
    batches,
    TABLET_STRESS_PASS: batches[0].pass,
    TABLET_STRESS_FAIL: batches[0].fail,
    MOBILE_STRESS_PASS: batches[1].pass,
    MOBILE_STRESS_FAIL: batches[1].fail,
    DESKTOP_STRESS_PASS: batches[2].pass,
    DESKTOP_STRESS_FAIL: batches[2].fail,
    FULL_GUARD_PASS: batches[3].pass,
    FULL_GUARD_FAIL: batches[3].fail,
    TIMEOUT_COUNT: batches.reduce((a, b) => a + b.timeout, 0),
    ORPHAN_PROCESS_COUNT: batches.reduce((a, b) => a + b.orphan, 0),
  };
  const ok =
    summary.TABLET_STRESS_FAIL === 0 &&
    summary.MOBILE_STRESS_FAIL === 0 &&
    summary.DESKTOP_STRESS_FAIL === 0 &&
    summary.FULL_GUARD_FAIL === 0 &&
    summary.TIMEOUT_COUNT === 0 &&
    summary.ORPHAN_PROCESS_COUNT === 0;
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) {
    console.error("IU_MOBILE_KB_HIDE_STRESS_FAIL");
    process.exit(1);
  }
  console.log("IU_MOBILE_KB_HIDE_STRESS_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
