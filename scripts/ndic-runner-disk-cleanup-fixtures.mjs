#!/usr/bin/env node
/**
 * Offline fixtures for ndic-runner-disk-cleanup.mjs (no network, no secrets).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupOrphanTmpPacks,
  cleanupRunnerTempNdic,
  wipeTaskWorktrees,
  DEFAULT_ORPHAN_AGE_SECONDS,
  FORBIDDEN_BASENAMES,
} from "./ndic-runner-disk-cleanup.mjs";

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-cleanup-fx-"));
const now = Date.parse("2026-08-10T02:00:00.000Z");

try {
  // A) orphan tmp_pack older than age -> deleted
  const packDir = path.join(root, "ndic-main-data", ".git", "objects", "pack");
  fs.mkdirSync(packDir, { recursive: true });
  const oldPack = path.join(packDir, "tmp_pack_orphanOld");
  fs.writeFileSync(oldPack, "OLD");
  const oldTime = (now - (DEFAULT_ORPHAN_AGE_SECONDS + 60) * 1000) / 1000;
  fs.utimesSync(oldPack, oldTime, oldTime);

  const youngPack = path.join(packDir, "tmp_pack_young");
  fs.writeFileSync(youngPack, "YOUNG");
  fs.utimesSync(youngPack, now / 1000 - 60, now / 1000 - 60);

  const realPack = path.join(packDir, "pack-deadbeef.pack");
  fs.writeFileSync(realPack, "REAL");

  const a = cleanupOrphanTmpPacks(path.join(root, "ndic-main-data"), {
    maxAgeSec: DEFAULT_ORPHAN_AGE_SECONDS,
    nowMs: now,
    dryRun: false,
  });
  ok("A_old_tmp_pack_deleted", !fs.existsSync(oldPack), "old");
  ok("A_young_tmp_pack_preserved", fs.existsSync(youngPack), "young");
  ok("A_real_pack_preserved", fs.existsSync(realPack), "real");
  ok("A_deleted_count", a.deleted.length === 1, String(a.deleted.length));

  // B) runner temp: age-gated ndic leftovers; current run id preserved
  const rtemp = path.join(root, "runner-temp");
  fs.mkdirSync(rtemp, { recursive: true });
  const keep = path.join(rtemp, "ndic-ie-candidate-999");
  fs.mkdirSync(keep);
  fs.writeFileSync(path.join(keep, "x"), "1");
  const stale = path.join(rtemp, "ndic-shadow-forensic");
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(stale, "y"), "2");
  fs.utimesSync(stale, now / 1000 - DEFAULT_ORPHAN_AGE_SECONDS - 10, now / 1000 - DEFAULT_ORPHAN_AGE_SECONDS - 10);
  // force wipe mode for name without run id
  process.env.IU_NDIC_CLEANUP_WIPE_RUNNER_TEMP_NDIC = "1";
  const b = cleanupRunnerTempNdic(rtemp, {
    runId: "999",
    maxAgeSec: DEFAULT_ORPHAN_AGE_SECONDS,
    nowMs: now,
    dryRun: false,
  });
  ok("B_current_run_temp_preserved", fs.existsSync(keep), "keep");
  ok("B_stale_ndic_temp_removed", !fs.existsSync(stale), "stale");
  ok("B_removed_at_least_one", b.deleted.length >= 1, String(b.deleted.length));
  delete process.env.IU_NDIC_CLEANUP_WIPE_RUNNER_TEMP_NDIC;

  // C) wipe allowlisted worktrees only
  const orch = path.join(root, "ndic-orch");
  const mainData = path.join(root, "ndic-main-data");
  const other = path.join(root, "important-other");
  fs.mkdirSync(orch, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(orch, "a"), "1");
  fs.writeFileSync(path.join(other, "b"), "2");
  // recreate main-data after A
  fs.mkdirSync(mainData, { recursive: true });
  fs.writeFileSync(path.join(mainData, "c"), "3");
  const c = wipeTaskWorktrees(root, { dryRun: false });
  ok("C_orch_wiped", !fs.existsSync(orch), "orch");
  ok("C_main_data_wiped", !fs.existsSync(mainData), "main");
  ok("C_unrelated_preserved", fs.existsSync(other), "other");
  ok("C_wipe_count", c.deleted.length === 2, String(c.deleted.length));

  // D) forbidden basenames never targeted as pack cleanup roots conceptually
  ok("D_forbidden_includes_runner", FORBIDDEN_BASENAMES.includes(".runner"));
  ok("D_forbidden_includes_credentials", FORBIDDEN_BASENAMES.includes(".credentials"));

  // E) workflow contract on disk
  const wf = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "update-ndic-datex-v1.yml"),
    "utf8"
  );
  ok("E_cleanup_script_invoked", /ndic-runner-disk-cleanup\.mjs/.test(wf));
  ok("E_ttl_at_least_7200", /IU_NDIC_PREFLIGHT_TTL_SECONDS:\s*"7200"/.test(wf));
  ok("E_schedule_cron_present", /cron:\s*"7,22,37,52 \* \* \* \*"/.test(wf));
  ok("E_low_disk_refuse_present", /REFUSING_LOW_DISK/.test(wf));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (fails.length) {
  console.error("ndic-runner-disk-cleanup-fixtures FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("ndic-runner-disk-cleanup-fixtures PASS count=" + passCount);
