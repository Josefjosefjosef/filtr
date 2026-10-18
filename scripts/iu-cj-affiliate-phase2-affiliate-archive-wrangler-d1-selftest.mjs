#!/usr/bin/env node
/** Real local Wrangler D1 — affiliate archive batch + publication gate (iu-ads). */
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adsDir = path.join(repoRoot, "cloudflare", "iu-ads");
const config = "wrangler.local-archive-test.toml";
const CMD = "node scripts/iu-cj-affiliate-phase2-affiliate-archive-wrangler-d1-selftest.mjs";

const steps = [];
function record(id, pass, detail) {
  steps.push({ id, pass, detail });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickPort() {
  return 39000 + Math.floor(Math.random() * 2000);
}

async function waitHealth(base, attempts) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(base + "/health");
      if (res.ok) {
        const j = await res.json();
        if (j.worker === "archive-d1-local-test") return true;
      }
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  return false;
}

let child = null;
let status = "FAIL";
let fatal = null;

function d1QueryJson(sql) {
  const out = execSync(
    "npx wrangler d1 execute DB --local --config " + config + " --command " + JSON.stringify(sql) + " --json",
    { cwd: adsDir, encoding: "utf8" }
  );
  return JSON.parse(out);
}

function archiveVersionsTableExists() {
  try {
    const parsed = d1QueryJson(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='affiliate_ad_archive_versions'"
    );
    return (parsed?.[0]?.results?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function restoreArchiveSchemaIfNeeded() {
  if (!archiveVersionsTableExists()) {
    execSync(
      "npx wrangler d1 execute DB --local --config " +
        config +
        " --file=" +
        JSON.stringify(path.join(adsDir, "migrations", "0025_affiliate_ad_archive.sql")),
      { cwd: adsDir, stdio: "pipe" }
    );
  }
  try {
    execSync(
      "npx wrangler d1 execute DB --local --config " +
        config +
        " --file=" +
        JSON.stringify(path.join(adsDir, "migrations", "0026_affiliate_ad_archive_idempotency.sql")),
      { cwd: adsDir, stdio: "pipe" }
    );
  } catch {
    /* 0026 file may fail atomically if partially applied */
  }
  for (const sql of [
    "ALTER TABLE affiliate_ad_archive_records ADD COLUMN idempotency_key TEXT",
    "ALTER TABLE affiliate_ad_archive_versions ADD COLUMN publish_event_type TEXT NOT NULL DEFAULT 'initial'",
    "ALTER TABLE affiliate_ad_archive_versions ADD COLUMN change_fields_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE affiliate_ad_archive_records ADD COLUMN version_seq INTEGER NOT NULL DEFAULT 1",
  ]) {
    try {
      d1QueryJson(sql);
    } catch {
      /* column exists */
    }
  }
}

try {
  execSync("npx wrangler --version", { cwd: adsDir, stdio: "pipe" });
  execSync("npx wrangler d1 migrations apply DB --local --config " + config, { cwd: adsDir, stdio: "pipe" });
  restoreArchiveSchemaIfNeeded();
  try {
    d1QueryJson("DELETE FROM affiliate_ad_archive_versions");
    d1QueryJson("DELETE FROM affiliate_ad_archive_records");
  } catch {
    /* empty db */
  }

  const runTag = String(Date.now());
  const port = pickPort();
  const base = "http://127.0.0.1:" + port;
  child = spawn(
    "npx",
    ["wrangler", "dev", "--local", "--port", String(port), "--config", config],
    { cwd: adsDir, stdio: "pipe", shell: true, env: { ...process.env } }
  );

  const ready = await waitHealth(base, 40);
  record("wrangler_dev_ready", ready, { port });
  if (!ready) throw new Error("wrangler_dev_not_ready");

  const ins = await fetch(base + "/test/insert-ok?idempotency_key=wrangler-batch-" + runTag, { method: "POST" });
  const insBody = await ins.json();
  record("batch_insert_ok", ins.ok && insBody.ok === true, { insBody });

  const counts1 = await (await fetch(base + "/test/counts")).json();
  record("record_and_version_pair", counts1.records === 1 && counts1.versions === 1, counts1);

  const replay = await fetch(base + "/test/insert-ok?idempotency_key=wrangler-batch-" + runTag, { method: "POST" });
  const replayBody = await replay.json();
  const counts2 = await (await fetch(base + "/test/counts")).json();
  record(
    "idempotent_replay",
    replayBody.ok === true && replayBody.idempotentReplay === true && counts2.records === 1 && counts2.versions === 1,
    { replayBody, counts2 }
  );

  const [a, b] = await Promise.all([
    fetch(base + "/test/insert-ok?idempotency_key=wrangler-concurrent-" + runTag, { method: "POST" }),
    fetch(base + "/test/insert-ok?idempotency_key=wrangler-concurrent-" + runTag, { method: "POST" }),
  ]);
  const bodyA = await a.json();
  const bodyB = await b.json();
  const counts3 = await (await fetch(base + "/test/counts")).json();
  record(
    "concurrent_idempotency",
    bodyA.ok &&
      bodyB.ok &&
      bodyA.record?.record_id === bodyB.record?.record_id &&
      counts3.records === 2 &&
      counts3.versions === 2,
    { bodyA, bodyB, counts3 }
  );

  const blocked = await fetch(base + "/test/insert-prod-blocked", { method: "POST" });
  const blockedBody = await blocked.json();
  record(
    "prod_publish_blocked_without_trust",
    blockedBody.ok === false && blockedBody.reason === "blocked_awaiting_trusted_adapter",
    { blockedBody }
  );

  const recordsBeforeRollback = await (await fetch(base + "/test/counts")).json();
  execSync(
    "npx wrangler d1 execute DB --local --config " +
      config +
      " --command " +
      JSON.stringify("DROP TABLE affiliate_ad_archive_versions"),
    { cwd: adsDir, stdio: "pipe" }
  );
  const failIns = await fetch(base + "/test/insert-ok?idempotency_key=wrangler-rollback-" + runTag, { method: "POST" });
  const failText = await failIns.text();
  let failBody = { ok: false, reason: "batch_insert_failed" };
  try {
    failBody = JSON.parse(failText);
  } catch {
    failBody = { ok: false, reason: "batch_insert_failed", raw: failText.slice(0, 120) };
  }
  function d1Scalar(sql) {
    const parsed = d1QueryJson(sql);
    const row = parsed?.[0]?.results?.[0];
    return Number(row?.c ?? row?.C ?? 0);
  }
  const recordsAfterFail = d1Scalar("SELECT COUNT(*) AS c FROM affiliate_ad_archive_records");
  restoreArchiveSchemaIfNeeded();
  record(
    "batch_rollback_no_orphan_record",
    failBody.ok === false &&
      recordsAfterFail === recordsBeforeRollback.records &&
      failBody.reason === "batch_insert_failed",
    { failBody, recordsBeforeRollback, recordsAfterFail }
  );

  status = steps.every((s) => s.pass) ? "OK" : "FAIL";
} catch (e) {
  fatal = String(e.message || e);
  record("fatal", false, { fatal });
}

if (child && child.pid) {
  try {
    if (process.platform === "win32") {
      execSync("taskkill /PID " + child.pid + " /T /F", { stdio: "pipe" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    /* ignore */
  }
}

console.log(
  JSON.stringify({
    IU_CJ_AFFILIATE_ARCHIVE_WRANGLER_D1_SELFTEST: status,
    command: CMD,
    pass: steps.filter((s) => s.pass).length,
    fail: steps.filter((s) => !s.pass).length,
    steps,
    fatal,
  })
);
process.exit(status === "OK" ? 0 : 1);
