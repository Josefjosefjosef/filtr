#!/usr/bin/env node
/**
 * Run smoke.yml Playwright guard commands with a bounded parallel pool (same commands as sequential CI).
 * Env: IU_SMOKE_GUARD_PARALLEL (default 4), SCOPE_* mirrors steps.scope.outputs.*
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(REPO, "scripts", "ci", "smoke-guard-manifest-v1.json");
const parallel = Math.max(1, Math.min(8, Number(process.env.IU_SMOKE_GUARD_PARALLEL || "4") || 4));

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
    return (val === "true" ? "true" : "false");
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

function runCmd(name, run, env, timeoutMinutes, taskIndex) {
  return new Promise((resolve) => {
    const started = Date.now();
    // High base avoids collisions with vault pickGuardPort(88xx–95xx) ranges that
    // ignore IU_GUARD_PORT and previously raced the old 8600+index assignments (EADDRINUSE).
    const guardPort =
      env.IU_GUARD_PORT ||
      String(30000 + (Number.isFinite(taskIndex) ? taskIndex : 0));
    const child = spawn(run, {
      cwd: REPO,
      shell: true,
      env: { ...process.env, ...env, IU_GUARD_PORT: guardPort },
      stdio: "inherit",
    });
    let killed = false;
    const maxMs = timeoutMinutes ? timeoutMinutes * 60 * 1000 : 20 * 60 * 1000;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, maxMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = {
        name,
        ok: !killed && code === 0,
        code: killed ? "timeout" : code,
        sec: Math.round((Date.now() - started) / 1000),
      };
      console.log(JSON.stringify({ IU_SMOKE_GUARD_DONE: result.name, ok: result.ok, code: result.code, sec: result.sec }));
      resolve(result);
    });
  });
}

async function poolRun(tasks, limit) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const cur = idx;
      idx += 1;
      results[cur] = await tasks[cur]();
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

async function main() {
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
