#!/usr/bin/env node
/**
 * Run smoke.yml Playwright guard commands with a bounded parallel pool (same commands as sequential CI).
 * Env: IU_SMOKE_GUARD_PARALLEL (default 4), SCOPE_* mirrors steps.scope.outputs.*
 *
 * Hang fix (phase 3Z V11): shell:true children (npm → node → chrome) must be killed as a
 * process tree on timeout/SIGTERM; otherwise `close` never fires and the pool worker stalls.
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(REPO, "scripts", "ci", "smoke-guard-manifest-v1.json");
const parallel = Math.max(1, Math.min(8, Number(process.env.IU_SMOKE_GUARD_PARALLEL || "4") || 4));
/** Default per-guard cap when manifest timeoutMinutes is null (was 20 → too long for stall recovery). */
const DEFAULT_GUARD_TIMEOUT_MIN = Math.max(
  3,
  Math.min(20, Number(process.env.IU_SMOKE_GUARD_DEFAULT_TIMEOUT_MIN || "12") || 12)
);

const activeChildren = new Set();

function killProcessTree(pid) {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    // Kill the whole process group when available; fall back to pid.
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
  try {
    spawnSync("pkill", ["-9", "-P", String(pid)], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

function scopeEnv() {
  const map = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("SCOPE_")) map[k.slice(6).toLowerCase()] = v;
  }
  return map;
}

function evalIf(ifGha, scope) {
  if (!ifGha || ifGha === "true") return true;
  let expr = ifGha.replace(/steps\.scope\.outputs\.([a-z0-9_]+)/gi, (_, key) => {
    const val = scope[key.toLowerCase()] ?? "";
    return val === "true" ? "true" : "false";
  });
  expr = expr.replace(/([^=!])\s*!=\s*'true'/g, "$1 !== 'true'");
  expr = expr.replace(/([^=!])\s*==\s*'true'/g, "$1 === 'true'");
  try {
    return Boolean(new Function(`return (${expr});`)());
  } catch (err) {
    console.error("IF_EVAL_FAIL", ifGha, err.message);
    return false;
  }
}

export function runCmd(name, run, env, timeoutMinutes, taskIndex) {
  return new Promise((resolve) => {
    const started = Date.now();
    // High base avoids collisions with vault pickGuardPort(88xx–95xx) ranges that
    // ignore IU_GUARD_PORT and previously raced the old 8600+index assignments (EADDRINUSE).
    const guardPort =
      env.IU_GUARD_PORT || String(30000 + (Number.isFinite(taskIndex) ? taskIndex : 0));
    const child = spawn(run, {
      cwd: REPO,
      shell: true,
      env: { ...process.env, ...env, IU_GUARD_PORT: guardPort },
      stdio: "inherit",
      // New process group on POSIX so we can kill the whole tree via -pid.
      detached: process.platform !== "win32",
    });
    activeChildren.add(child);
    let settled = false;
    let killed = false;
    const maxMs = (timeoutMinutes || DEFAULT_GUARD_TIMEOUT_MIN) * 60 * 1000;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      activeChildren.delete(child);
      console.log(
        JSON.stringify({
          IU_SMOKE_GUARD_DONE: result.name,
          ok: result.ok,
          code: result.code,
          sec: result.sec,
        })
      );
      resolve(result);
    };

    const timer = setTimeout(() => {
      killed = true;
      console.error(
        JSON.stringify({
          IU_SMOKE_GUARD_TIMEOUT: name,
          timeoutMinutes: timeoutMinutes || DEFAULT_GUARD_TIMEOUT_MIN,
          pid: child.pid || null,
        })
      );
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      // Escalation: process-tree SIGKILL so shell→npm→chrome cannot orphan the pool.
      setTimeout(() => {
        if (child.pid) killProcessTree(child.pid);
      }, 1500);
    }, maxMs);

    // Absolute settle: never leave the pool worker awaiting a zombie forever.
    const forceTimer = setTimeout(() => {
      if (child.pid) killProcessTree(child.pid);
      finish({
        name,
        ok: false,
        code: "timeout_force",
        sec: Math.round((Date.now() - started) / 1000),
      });
    }, maxMs + 20_000);

    child.on("close", (code) => {
      finish({
        name,
        ok: !killed && code === 0,
        code: killed ? "timeout" : code,
        sec: Math.round((Date.now() - started) / 1000),
      });
    });
    child.on("error", (err) => {
      finish({
        name,
        ok: false,
        code: "spawn_error:" + String(err && err.message ? err.message : err),
        sec: Math.round((Date.now() - started) / 1000),
      });
    });
  });
}

async function poolRun(tasks, limit) {
  const results = [];
  let idx = 0;
  let completed = 0;
  const total = tasks.length;
  const t0 = Date.now();
  async function worker() {
    while (idx < tasks.length) {
      const cur = idx;
      idx += 1;
      results[cur] = await tasks[cur]();
      completed += 1;
      if (completed === total || completed % 25 === 0) {
        const elapsedSec = Math.round((Date.now() - t0) / 1000);
        const rate = completed / Math.max(1, elapsedSec);
        const remain = total - completed;
        const etaSec = rate > 0 ? Math.round(remain / rate) : null;
        console.log(
          JSON.stringify({
            IU_SMOKE_GUARDS_PROGRESS: true,
            completed,
            total,
            elapsedSec,
            etaSec,
          })
        );
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

function installSignalCleanup() {
  const shutdown = (sig) => {
    console.error(JSON.stringify({ IU_SMOKE_GUARDS_SIGNAL: sig, active: activeChildren.size }));
    for (const child of [...activeChildren]) {
      if (child.pid) killProcessTree(child.pid);
    }
    process.exit(1);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function main() {
  installSignalCleanup();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const scope = scopeEnv();
  const selected = manifest.guards.filter((g) => evalIf(g.ifGha, scope));
  const dataOnly = scope.data_only === "true";
  const minSelected = dataOnly ? 1 : 300;
  if (selected.length < minSelected) {
    console.error(
      JSON.stringify({
        IU_SMOKE_GUARDS_PARALLEL: "FAIL",
        reason: "selected_below_minimum",
        dataOnly,
        minSelected,
        selected: selected.length,
        total: manifest.guards.length,
      })
    );
    process.exit(1);
  }
  const selectedIndexed = selected.map((g) => {
    const manifestIndex = manifest.guards.indexOf(g);
    return { guard: g, manifestIndex: manifestIndex >= 0 ? manifestIndex : 0 };
  });
  const parallelItems = selectedIndexed.filter((item) => !item.guard.serialBucket);
  const serialItems = selectedIndexed.filter((item) => item.guard.serialBucket);

  console.log(
    JSON.stringify({
      IU_SMOKE_GUARDS_PARALLEL: "START",
      parallel,
      defaultGuardTimeoutMin: DEFAULT_GUARD_TIMEOUT_MIN,
      total: manifest.guards.length,
      selected: selected.length,
      parallelPool: parallelItems.length,
      serialBucket: serialItems.length,
    })
  );
  const parallelTasks = parallelItems.map(
    (item) => () =>
      runCmd(
        item.guard.name,
        item.guard.run,
        item.guard.env || {},
        item.guard.timeoutMinutes || null,
        item.manifestIndex
      )
  );
  const results = await poolRun(parallelTasks, parallel);

  if (serialItems.length) {
    console.log(JSON.stringify({ IU_SMOKE_GUARDS_SERIAL: "START", count: serialItems.length }));
    for (const item of serialItems) {
      results.push(
        await runCmd(
          item.guard.name,
          item.guard.run,
          item.guard.env || {},
          item.guard.timeoutMinutes || null,
          item.manifestIndex
        )
      );
    }
    const serialFailed = results.slice(-serialItems.length).filter((r) => !r.ok);
    console.log(
      JSON.stringify({
        IU_SMOKE_GUARDS_SERIAL: serialFailed.length ? "FAIL" : "OK",
        failed: serialFailed.map((f) => ({ name: f.name, code: f.code, sec: f.sec })),
        passCount: serialItems.length - serialFailed.length,
        completedCount: serialItems.length,
      })
    );
  }
  const failed = results.filter((r) => !r.ok);
  const doneCount = results.filter(Boolean).length;
  if (doneCount !== selected.length) {
    console.error(
      JSON.stringify({
        IU_SMOKE_GUARDS_PARALLEL: "FAIL",
        reason: "results_count_mismatch",
        selected: selected.length,
        doneCount,
      })
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      IU_SMOKE_GUARDS_PARALLEL: failed.length ? "FAIL" : "OK",
      failed: failed.map((f) => ({ name: f.name, code: f.code, sec: f.sec })),
      passCount: results.length - failed.length,
      completedCount: doneCount,
      selected: selected.length,
    })
  );
  process.exit(failed.length ? 1 : 0);
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
