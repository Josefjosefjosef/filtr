#!/usr/bin/env node
/**
 * Stage NDIC shared-write outputs after apply.
 *
 * REQUIRED pathspecs must exist (fail-closed). OPTIONAL pathspecs are staged
 * individually only when present — never all-or-nothing with `git add a b missing || true`
 * (ACTIVE incident 31257122613 → false NO_CHANGES).
 *
 * Exit codes:
 *   0 — STAGED or NO_CHANGES (see stdout JSON / lines)
 *   2 — REQUIRED_OUTPUT_MISSING
 *   1 — other failure
 *
 * Usage:
 *   node ndic-stage-shared-write-outputs.mjs [--repo <gitRoot>] [--check-only]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NDIC_SHARED_WRITE_REQUIRED_RELS = Object.freeze([
  "projects/data/info_events/feed.json",
  "projects/data/info_events/monitoring.json",
  "projects/data/info_events/ndic_datex_v1/sync_state.json",
  "projects/data/info_events/ndic_datex_v1/diagnostics.json",
  "projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json",
]);

export const NDIC_SHARED_WRITE_OPTIONAL_RELS = Object.freeze([
  "projects/data/info_events/lanes/doprava.json",
  "projects/data/info_events/ndic_datex_v1/tmc_meta.json",
  "projects/data/info_events/ndic_datex_v1/data_pr_finalization_binding.json",
]);

export function assertRequiredOutputsExist(repoRoot, requiredRels = NDIC_SHARED_WRITE_REQUIRED_RELS) {
  const missing = [];
  for (const rel of requiredRels) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      missing.push(rel);
    }
  }
  return { ok: missing.length === 0, missing };
}

function git(repoRoot, args) {
  return spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

/**
 * Stage required + existing optional paths independently.
 * @returns {{ ok: boolean, result: string, missing?: string[], staged?: string[] }}
 */
export function stageNdicSharedWriteOutputs(repoRoot, opts = {}) {
  const required = opts.requiredRels || NDIC_SHARED_WRITE_REQUIRED_RELS;
  const optional = opts.optionalRels || NDIC_SHARED_WRITE_OPTIONAL_RELS;
  const checkOnly = opts.checkOnly === true;

  const req = assertRequiredOutputsExist(repoRoot, required);
  if (!req.ok) {
    return {
      ok: false,
      result: "REQUIRED_OUTPUT_MISSING",
      missing: req.missing,
      staged: [],
    };
  }

  if (checkOnly) {
    return { ok: true, result: "REQUIRED_PRESENT", missing: [], staged: [] };
  }

  const staged = [];
  for (const rel of required) {
    const add = git(repoRoot, ["add", "--", rel]);
    if (add.status !== 0) {
      return {
        ok: false,
        result: "GIT_ADD_FAILED",
        missing: [],
        staged,
        detail: String(add.stderr || add.stdout || "").trim(),
        path: rel,
      };
    }
    staged.push(rel);
  }
  for (const rel of optional) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const add = git(repoRoot, ["add", "--", rel]);
    if (add.status !== 0) {
      return {
        ok: false,
        result: "GIT_ADD_FAILED",
        missing: [],
        staged,
        detail: String(add.stderr || add.stdout || "").trim(),
        path: rel,
      };
    }
    staged.push(rel);
  }

  const diff = git(repoRoot, ["diff", "--cached", "--quiet"]);
  if (diff.status === 0) {
    return { ok: true, result: "NO_CHANGES", missing: [], staged };
  }
  if (diff.status === 1) {
    return { ok: true, result: "STAGED", missing: [], staged };
  }
  return {
    ok: false,
    result: "GIT_DIFF_FAILED",
    missing: [],
    staged,
    detail: String(diff.stderr || diff.stdout || "").trim(),
  };
}

function parseArgs(argv) {
  let repo = process.cwd();
  let checkOnly = false;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--repo" && argv[i + 1]) {
      repo = path.resolve(argv[++i]);
    } else if (a === "--check-only") {
      checkOnly = true;
    }
  }
  return { repo, checkOnly };
}

function main() {
  const { repo, checkOnly } = parseArgs(process.argv);
  const out = stageNdicSharedWriteOutputs(repo, { checkOnly });
  console.log(JSON.stringify(out));
  if (out.result === "REQUIRED_OUTPUT_MISSING") {
    console.error("REQUIRED_OUTPUT_MISSING:" + (out.missing || []).join(","));
    process.exit(2);
  }
  if (!out.ok) {
    console.error(out.result + (out.detail ? ":" + out.detail : ""));
    process.exit(1);
  }
  if (out.result === "NO_CHANGES") {
    console.log("NO_CHANGES");
  } else if (out.result === "STAGED") {
    console.log("STAGED");
  }
  process.exit(0);
}

const isDirect =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isDirect) {
  main();
}
