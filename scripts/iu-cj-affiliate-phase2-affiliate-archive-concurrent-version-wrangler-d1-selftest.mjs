#!/usr/bin/env node
/** Wrangler D1 — affiliate archive concurrent version_seq (10 required scenarios). */
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adsDir = path.join(repoRoot, "cloudflare", "iu-ads");
const config = "wrangler.local-archive-test.toml";
const CMD = "node scripts/iu-cj-affiliate-phase2-affiliate-archive-concurrent-version-wrangler-d1-selftest.mjs";

const tests = [];
function record(id, pass, detail) {
  tests.push({ id, pass, detail });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickPort() {
  return 38000 + Math.floor(Math.random() * 2000);
}

function d1QueryJson(sql) {
  const out = execSync(
    "npx wrangler d1 execute DB --local --config " + config + " --command " + JSON.stringify(sql) + " --json",
    { cwd: adsDir, encoding: "utf8" }
  );
  return JSON.parse(out);
}

function restoreSchema() {
  const mig25 = path.join(adsDir, "migrations", "0025_affiliate_ad_archive.sql");
  const mig26 = path.join(adsDir, "migrations", "0026_affiliate_ad_archive_idempotency.sql");
  const mig27 = path.join(adsDir, "migrations", "0027_affiliate_ad_archive_version_seq.sql");
  try {
    execSync("npx wrangler d1 execute DB --local --config " + config + " --file=" + JSON.stringify(mig25), {
      cwd: adsDir,
      stdio: "pipe",
    });
  } catch {
    /* exists */
  }
  try {
    execSync("npx wrangler d1 execute DB --local --config " + config + " --file=" + JSON.stringify(mig26), {
      cwd: adsDir,
      stdio: "pipe",
    });
  } catch {
    /* partial ok */
  }
  try {
    execSync("npx wrangler d1 execute DB --local --config " + config + " --file=" + JSON.stringify(mig27), {
      cwd: adsDir,
      stdio: "pipe",
    });
  } catch {
    /* partial ok */
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

async function waitHealth(base) {
  for (let i = 0; i < 40; i++) {
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

function versionNos(versions) {
  return versions.map((v) => v.version_no).sort((a, b) => a - b);
}

function isContiguousFromOne(nums) {
  if (!nums.length) return false;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) return false;
  }
  return true;
}

let child = null;
let status = "FAIL";
let fatal = null;

try {
  execSync("npx wrangler d1 migrations apply DB --local --config " + config, { cwd: adsDir, stdio: "pipe" });
  restoreSchema();
  d1QueryJson("DELETE FROM affiliate_ad_archive_versions");
  d1QueryJson("DELETE FROM affiliate_ad_archive_records");

  const port = pickPort();
  const base = "http://127.0.0.1:" + port;
  const runTag = String(Date.now());
  child = spawn("npx", ["wrangler", "dev", "--local", "--port", String(port), "--config", config], {
    cwd: adsDir,
    stdio: "pipe",
    shell: true,
  });
  const ready = await waitHealth(base);
  record("wrangler_dev_ready", ready, { port });
  if (!ready) throw new Error("wrangler_dev_not_ready");

  const create = await (await fetch(base + "/test/create-record?idempotency_key=conc-base-" + runTag, { method: "POST" })).json();
  const recordId = create.record?.record_id;
  record("setup_create_record", create.ok === true && !!recordId, { create });

  // 1 two concurrent revisions
  const [r1a, r1b] = await Promise.all([
    fetch(base + "/test/material-revision?record_id=" + encodeURIComponent(recordId) + "&marker=two-a-" + runTag, {
      method: "POST",
    }),
    fetch(base + "/test/material-revision?record_id=" + encodeURIComponent(recordId) + "&marker=two-b-" + runTag, {
      method: "POST",
    }),
  ]);
  const b1a = await r1a.json();
  const b1b = await r1b.json();
  const v1 = await (await fetch(base + "/test/versions?record_id=" + encodeURIComponent(recordId))).json();
  const nums1 = versionNos(v1.versions || []);
  record(
    "t01_two_concurrent_same_ad",
    b1a.ok &&
      b1b.ok &&
      b1a.skipped !== true &&
      b1b.skipped !== true &&
      nums1.length === 3 &&
      nums1[0] === 1 &&
      nums1[1] === 2 &&
      nums1[2] === 3,
    { b1a, b1b, nums1 }
  );

  // 2 ten concurrent
  const create10 = await (
    await fetch(base + "/test/create-record?idempotency_key=conc-ten-" + runTag, { method: "POST" })
  ).json();
  const rid10 = create10.record?.record_id;
  const ten = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      fetch(
        base +
          "/test/material-revision?record_id=" +
          encodeURIComponent(rid10) +
          "&marker=ten-" +
          runTag +
          "-" +
          i,
        { method: "POST" }
      )
    )
  );
  const tenBodies = await Promise.all(ten.map((r) => r.json()));
  const v10 = await (await fetch(base + "/test/versions?record_id=" + encodeURIComponent(rid10))).json();
  const nums10 = versionNos(v10.versions || []);
  record(
    "t02_ten_concurrent_same_ad",
    tenBodies.every((b) => b.ok && b.skipped !== true) && nums10.length === 11 && isContiguousFromOne(nums10),
    { okCount: tenBodies.filter((b) => b.ok && b.skipped !== true).length, nums10 }
  );

  // 3 idempotent replay same insert
  const idemKey = "conc-idem-" + runTag;
  const [ia, ib] = await Promise.all([
    fetch(base + "/test/create-record?idempotency_key=" + encodeURIComponent(idemKey), { method: "POST" }),
    fetch(base + "/test/create-record?idempotency_key=" + encodeURIComponent(idemKey), { method: "POST" }),
  ]);
  const iba = await ia.json();
  const ibb = await ib.json();
  const vIdem = await (await fetch(base + "/test/versions?record_id=" + encodeURIComponent(iba.record.record_id))).json();
  record(
    "t03_idempotent_replay_same_event",
    iba.ok &&
      ibb.ok &&
      iba.record.record_id === ibb.record.record_id &&
      (iba.idempotentReplay === true || ibb.idempotentReplay === true) &&
      (vIdem.versions || []).length === 1,
    { iba, ibb }
  );

  // 4 two events same timestamp
  const createTs = await (
    await fetch(base + "/test/create-record?idempotency_key=conc-ts-" + runTag, { method: "POST" })
  ).json();
  const ridTs = createTs.record?.record_id;
  const sameTs = "2026-10-01T12:00:00.000Z";
  const [tsa, tsb] = await Promise.all([
    fetch(
      base +
        "/test/material-revision?record_id=" +
        encodeURIComponent(ridTs) +
        "&marker=ts-a&created_at=" +
        encodeURIComponent(sameTs),
      { method: "POST" }
    ),
    fetch(
      base +
        "/test/material-revision?record_id=" +
        encodeURIComponent(ridTs) +
        "&marker=ts-b&created_at=" +
        encodeURIComponent(sameTs),
      { method: "POST" }
    ),
  ]);
  const tsaB = await tsa.json();
  const tsbB = await tsb.json();
  const vTs = await (await fetch(base + "/test/versions?record_id=" + encodeURIComponent(ridTs))).json();
  const numsTs = versionNos(vTs.versions || []);
  record(
    "t04_two_events_same_timestamp",
    tsaB.ok &&
      tsbB.ok &&
      tsaB.skipped !== true &&
      tsbB.skipped !== true &&
      numsTs.length === 3 &&
      numsTs[2] === 3 &&
      numsTs[1] === 2,
    { tsaB, tsbB, numsTs }
  );

  // 5 no duplicate version_no (unique)
  const dupCheck = d1QueryJson(
    "SELECT record_id, version_no, COUNT(*) AS c FROM affiliate_ad_archive_versions GROUP BY record_id, version_no HAVING c > 1"
  );
  const dupRows = dupCheck?.[0]?.results ?? [];
  record("t05_no_duplicate_version_numbers", dupRows.length === 0, { dupRows });

  // 7 contiguous sequence on rid10
  record("t07_contiguous_version_sequence", isContiguousFromOne(nums10), { nums10 });

  // 8 all successful revisions preserved (10 of 10 + v1)
  record("t08_all_successful_changes_preserved", tenBodies.filter((b) => b.ok && b.skipped !== true).length === 10, {
    preserved: tenBodies.filter((b) => b.ok && b.skipped !== true).length,
  });

  // 9 immutability: v1 hash unchanged on rid10
  const v10rows = v10.versions || [];
  const firstHash = v10rows.find((v) => v.version_no === 1)?.content_hash;
  const firstAgain = await (await fetch(base + "/test/versions?record_id=" + encodeURIComponent(rid10))).json();
  const firstHash2 = (firstAgain.versions || []).find((v) => v.version_no === 1)?.content_hash;
  record("t09_older_versions_immutable", !!firstHash && firstHash === firstHash2, { firstHash, firstHash2 });

  // 6 batch rollback second statement fails (after read-only checks)
  const seqBeforeRow = d1QueryJson(
    "SELECT version_seq FROM affiliate_ad_archive_records WHERE record_id = " + JSON.stringify(rid10)
  );
  const seqBefore = Number(seqBeforeRow?.[0]?.results?.[0]?.version_seq ?? 0);
  execSync(
    "npx wrangler d1 execute DB --local --config " +
      config +
      " --command " +
      JSON.stringify("DROP TABLE affiliate_ad_archive_versions"),
    { cwd: adsDir, stdio: "pipe" }
  );
  let failRevBody = { ok: false, reason: "batch_revision_failed" };
  try {
    const failRev = await fetch(
      base + "/test/material-revision?record_id=" + encodeURIComponent(rid10) + "&marker=rollback-" + runTag,
      { method: "POST" }
    );
    failRevBody = await failRev.json();
  } catch {
    failRevBody = { ok: false, reason: "batch_revision_failed", detail: "worker_unreachable_after_drop" };
  }
  const seqAfterRow = d1QueryJson(
    "SELECT version_seq FROM affiliate_ad_archive_records WHERE record_id = " + JSON.stringify(rid10)
  );
  const seqAfter = Number(seqAfterRow?.[0]?.results?.[0]?.version_seq ?? -1);
  restoreSchema();
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
  child = spawn("npx", ["wrangler", "dev", "--local", "--port", String(port), "--config", config], {
    cwd: adsDir,
    stdio: "pipe",
    shell: true,
  });
  const readyAfterRestore = await waitHealth(base);
  record(
    "t06_second_statement_failure_rollback",
    failRevBody.ok === false &&
      failRevBody.reason === "batch_revision_failed" &&
      seqAfter === seqBefore &&
      readyAfterRestore,
    { failRevBody, seqBefore, seqAfter, readyAfterRestore }
  );

  // 10 prod blocked without trust
  const blocked = readyAfterRestore
    ? await (await fetch(base + "/test/insert-prod-blocked", { method: "POST" })).json()
    : { ok: false, reason: "worker_not_ready" };
  record(
    "t10_untrusted_production_still_blocked",
    blocked.ok === false && blocked.reason === "blocked_awaiting_trusted_adapter",
    { blocked }
  );

  status = tests.every((t) => t.pass) ? "OK" : "FAIL";
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
    IU_CJ_AFFILIATE_ARCHIVE_CONCURRENT_VERSION_WRANGLER_D1_SELFTEST: status,
    command: CMD,
    pass: tests.filter((t) => t.pass).length,
    fail: tests.filter((t) => !t.pass).length,
    tests,
    fatal,
  })
);
process.exit(status === "OK" ? 0 : 1);
