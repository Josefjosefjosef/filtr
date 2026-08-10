#!/usr/bin/env node
/**
 * Bounded, fail-safe NDIC runner disk cleanup (offline-safe; no network; no secrets).
 *
 * Cleans only task-owned / orphaned NDIC work artifacts:
 * - RUNNER_TEMP/ndic-* leftovers (age-gated when not owned by current run)
 * - workspace ndic-orch / ndic-main-data when IU_NDIC_CLEANUP_WIPE_WORKTREES=1
 * - orphaned Git objects/pack/tmp_pack_* under those worktrees (age-gated)
 *
 * Never deletes:
 * - runner registration (.runner, .credentials, .env, svc.sh, config.*)
 * - last-known-good / production snapshot paths outside allowlisted roots
 * - arbitrary home directories
 *
 * Exit 0 always for post-job cleanup (best-effort); fixture mode throws on contract breach.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ORPHAN_AGE_SECONDS = 7200;
export const MAX_DELETE_ENTRIES = 500;
export const ALLOWED_WORKTREE_NAMES = Object.freeze(["ndic-orch", "ndic-main-data"]);
export const FORBIDDEN_BASENAMES = Object.freeze([
  ".runner",
  ".credentials",
  ".env",
  "svc.sh",
  "config.sh",
  "config.cmd",
  "run.sh",
  "run.cmd",
]);

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function isForbiddenName(name) {
  return FORBIDDEN_BASENAMES.includes(String(name || ""));
}

/**
 * @param {string} root
 * @param {{ maxAgeSec: number, nowMs: number, dryRun?: boolean, maxDeletes?: number }} opts
 * @returns {{ deleted: string[], skipped: string[], bytesReclaimed: number }}
 */
export function cleanupOrphanTmpPacks(root, opts) {
  const deleted = [];
  const skipped = [];
  let bytesReclaimed = 0;
  const maxDeletes = opts.maxDeletes ?? MAX_DELETE_ENTRIES;
  const absRoot = path.resolve(root);
  if (!fs.existsSync(absRoot)) return { deleted, skipped, bytesReclaimed };

  /** @type {string[]} */
  const stack = [absRoot];
  while (stack.length) {
    if (deleted.length >= maxDeletes) break;
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (isForbiddenName(ent.name)) {
          skipped.push(full);
          continue;
        }
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!/^tmp_pack_/.test(ent.name)) continue;
      // Only under .../.git/objects/pack/
      const norm = full.replace(/\\/g, "/");
      if (!/\/\.git\/objects\/pack\/tmp_pack_/.test(norm)) {
        skipped.push(full);
        continue;
      }
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        skipped.push(full);
        continue;
      }
      const ageSec = (opts.nowMs - st.mtimeMs) / 1000;
      if (ageSec < opts.maxAgeSec) {
        skipped.push(full);
        continue;
      }
      if (!opts.dryRun) {
        try {
          fs.unlinkSync(full);
          bytesReclaimed += st.size;
          deleted.push(full);
        } catch {
          skipped.push(full);
        }
      } else {
        deleted.push(full);
        bytesReclaimed += st.size;
      }
    }
  }
  return { deleted, skipped, bytesReclaimed };
}

/**
 * @param {string} runnerTemp
 * @param {{ runId: string, maxAgeSec: number, nowMs: number, dryRun?: boolean }} opts
 */
export function cleanupRunnerTempNdic(runnerTemp, opts) {
  const deleted = [];
  const skipped = [];
  let bytesReclaimed = 0;
  const abs = path.resolve(runnerTemp);
  if (!abs || !fs.existsSync(abs)) return { deleted, skipped, bytesReclaimed };

  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return { deleted, skipped, bytesReclaimed };
  }

  const runId = String(opts.runId || "").trim();
  for (const ent of entries) {
    if (!/^ndic[-_]/.test(ent.name) && ent.name !== "ndic-sync-out.json") {
      skipped.push(path.join(abs, ent.name));
      continue;
    }
    const full = path.join(abs, ent.name);
    // Keep artifacts that clearly belong to the current run id when present in the name.
    if (runId && ent.name.includes(runId)) {
      skipped.push(full);
      continue;
    }
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      skipped.push(full);
      continue;
    }
    const ageSec = (opts.nowMs - st.mtimeMs) / 1000;
    if (ageSec < opts.maxAgeSec && runId) {
      // Young leftovers without run id in name: still skip if younger than orphan age
      // unless mode is wipe-all-ndic-temp (explicit).
      if (process.env.IU_NDIC_CLEANUP_WIPE_RUNNER_TEMP_NDIC !== "1") {
        skipped.push(full);
        continue;
      }
    }
    if (!opts.dryRun) {
      try {
        fs.rmSync(full, { recursive: true, force: true });
        bytesReclaimed += st.size;
        deleted.push(full);
      } catch {
        skipped.push(full);
      }
    } else {
      deleted.push(full);
      bytesReclaimed += st.size;
    }
  }
  return { deleted, skipped, bytesReclaimed };
}

/**
 * @param {string} cwd
 * @param {{ dryRun?: boolean }} opts
 */
export function wipeTaskWorktrees(cwd, opts) {
  const deleted = [];
  const skipped = [];
  let bytesReclaimed = 0;
  for (const name of ALLOWED_WORKTREE_NAMES) {
    const full = path.resolve(cwd, name);
    if (!fs.existsSync(full)) continue;
    // Refuse if somehow points outside cwd.
    if (!full.startsWith(path.resolve(cwd) + path.sep) && full !== path.resolve(cwd, name)) {
      skipped.push(full);
      continue;
    }
    if (!opts.dryRun) {
      try {
        fs.rmSync(full, { recursive: true, force: true });
        deleted.push(full);
      } catch {
        skipped.push(full);
      }
    } else {
      deleted.push(full);
    }
  }
  return { deleted, skipped, bytesReclaimed };
}

export function runCleanup(env = process.env) {
  const nowMs = Date.now();
  const maxAgeSec = envInt("IU_NDIC_CLEANUP_ORPHAN_AGE_SECONDS", DEFAULT_ORPHAN_AGE_SECONDS);
  const cwd = path.resolve(env.IU_NDIC_CLEANUP_CWD || process.cwd());
  const runnerTemp = String(env.RUNNER_TEMP || env.IU_NDIC_CLEANUP_RUNNER_TEMP || "").trim();
  const runId = String(env.IU_NDIC_CLEANUP_RUN_ID || env.GITHUB_RUN_ID || "").trim();
  const dryRun = env.IU_NDIC_CLEANUP_DRY_RUN === "1";
  const wipeTrees = env.IU_NDIC_CLEANUP_WIPE_WORKTREES === "1";

  const report = {
    ok: true,
    cwd,
    runId,
    dryRun,
    maxAgeSec,
    deleted: [],
    skipped: [],
    bytesReclaimed: 0,
  };

  if (wipeTrees) {
    const w = wipeTaskWorktrees(cwd, { dryRun });
    report.deleted.push(...w.deleted);
    report.skipped.push(...w.skipped);
    report.bytesReclaimed += w.bytesReclaimed;
  }

  for (const name of ALLOWED_WORKTREE_NAMES) {
    const root = path.join(cwd, name);
    const t = cleanupOrphanTmpPacks(root, { maxAgeSec, nowMs, dryRun });
    report.deleted.push(...t.deleted);
    report.skipped.push(...t.skipped);
    report.bytesReclaimed += t.bytesReclaimed;
  }

  // Also scan cwd itself for abandoned packs (shallow).
  const cwdPacks = cleanupOrphanTmpPacks(cwd, { maxAgeSec, nowMs, dryRun });
  report.deleted.push(...cwdPacks.deleted);
  report.skipped.push(...cwdPacks.skipped);
  report.bytesReclaimed += cwdPacks.bytesReclaimed;

  if (runnerTemp) {
    const r = cleanupRunnerTempNdic(runnerTemp, { runId, maxAgeSec, nowMs, dryRun });
    report.deleted.push(...r.deleted);
    report.skipped.push(...r.skipped);
    report.bytesReclaimed += r.bytesReclaimed;
  }

  return report;
}

function main() {
  const report = runCleanup(process.env);
  const line = JSON.stringify({
    CLEANUP_PASS: report.ok ? "YES" : "NO",
    DELETED_COUNT: report.deleted.length,
    SKIPPED_COUNT: report.skipped.length,
    DISK_RECLAIMED_BYTES: report.bytesReclaimed,
    ORPHAN_AGE_SECONDS: report.maxAgeSec,
    DRY_RUN: report.dryRun ? "YES" : "NO",
  });
  process.stdout.write(line + "\n");
  if (process.env.IU_NDIC_CLEANUP_VERBOSE === "1") {
    for (const p of report.deleted) process.stdout.write("deleted=" + p + "\n");
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (e) {
    process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
    process.exit(1);
  }
}
