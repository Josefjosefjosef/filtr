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
  let expr = ifGha;
  expr = expr.replace(/steps\.scope\.outputs\.([a-z0-9_]+)/gi, (_, key) => {
    const val = scope[key.toLowerCase()] ?? "";
    return JSON.stringify(val);
  });
  expr = expr.replace(/!=\s*'true'/g, "!== 'true'");
  expr = expr.replace(/==\s*'true'/g, "=== 'true'");
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(new Function(`return (${expr});`)());
  } catch (err) {
    console.error("IF_EVAL_FAIL", ifGha, err.message);
    return false;
  }
}

function runCmd(name, run, env, timeoutMinutes) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(run, {
      cwd: REPO,
      shell: true,
      env: { ...process.env, ...env },
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
      resolve({
        name,
        ok: !killed && code === 0,
        code: killed ? "timeout" : code,
        sec: Math.round((Date.now() - started) / 1000),
      });
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
  console.log(
    JSON.stringify({
      IU_SMOKE_GUARDS_PARALLEL: "START",
      parallel,
      total: manifest.guards.length,
      selected: selected.length,
    })
  );
  const tasks = selected.map(
    (g) => () => runCmd(g.name, g.run, g.env || {}, g.timeoutMinutes || null)
  );
  const results = await poolRun(tasks, parallel);
  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify({
      IU_SMOKE_GUARDS_PARALLEL: failed.length ? "FAIL" : "OK",
      failed: failed.map((f) => ({ name: f.name, code: f.code, sec: f.sec })),
      passCount: results.length - failed.length,
    })
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
