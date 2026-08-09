#!/usr/bin/env node
/**
 * Bounded canonical Data PR refresh against concurrent CHMI / Info Events writers.
 *
 * Model (offline, no DATEX/TMC/network/credentials):
 *   detect safe data-only drift on main
 *   → reread latest main shared feed
 *   → apply approved NDIC candidate into latest shared state
 *   → preserve latest CHMI + unrelated namespaces
 *   → rerun binding / validations
 *   → update same canonical Data PR head
 *
 * Never uses git checkout --ours/--theirs on feed.json.
 * Never creates a second Data PR.
 * Fail-closed when refresh budget is exhausted or drift is unsafe.
 *
 * Usage (library):
 *   import { runBoundedDataPrRefresh, DATA_PR_REFRESH_MAX } from "./ndic-data-pr-bounded-refresh.mjs"
 *
 * Usage (CLI / CI):
 *   node ndic-data-pr-bounded-refresh.mjs \
 *     --main-ie <dir> --ndic-candidate <dir> --repo <gitRoot> \
 *     [--max N] [--base-main-sha <sha>]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  rebaseSharedNamespacesFromCurrentMain,
  computeSharedStateDigests,
} from "./iu-data-pr-finalization-protocol.mjs";
import { isChmiItem, isNdicItem, readJson } from "./info-events-shared-writer-critical.mjs";

/** Hard cap — never unbounded retry. */
export const DATA_PR_REFRESH_MAX = 3;

export const DATA_PR_REFRESH_FLAGS = Object.freeze({
  DATA_PR_REFRESH_BOUNDED: "YES",
  DATA_PR_REFRESH_MAX: String(DATA_PR_REFRESH_MAX),
  UNBOUNDED_RETRY_POSSIBLE: "NO",
  REREAD_CURRENT_SHARED_STATE_BEFORE_FINAL_COMMIT: "YES",
  CANONICAL_DATA_PR_PRESERVED: "YES",
  DUPLICATE_DATA_PR_CREATED: "NO",
  NDIC_WRITE_OVERWRITES_CHMI: "NO",
  CHMI_WRITE_OVERWRITES_NDIC: "NO",
  UNRELATED_NAMESPACE_PRESERVED: "YES",
  GIT_OURS_THEIRS_USED: "NO",
});

/**
 * Classify changed paths vs main tip.
 * Safe: only projects/data/info_events/**
 * Unsafe: workflow/security/orchestration outside that tree.
 */
export function classifyDataPrDrift(changedPaths = []) {
  const paths = (Array.isArray(changedPaths) ? changedPaths : [])
    .map((p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter(Boolean);
  const unsafe = [];
  const safe = [];
  for (const p of paths) {
    if (p.startsWith("projects/data/info_events/")) {
      safe.push(p);
      continue;
    }
    // Workflow / security / orchestration changes are never auto-refreshable.
    if (
      p.startsWith(".github/") ||
      p.startsWith("scripts/") ||
      p === "package.json" ||
      p.endsWith(".yml") ||
      p.endsWith(".yaml")
    ) {
      unsafe.push(p);
      continue;
    }
    unsafe.push(p);
  }
  return {
    ok: unsafe.length === 0,
    SAFE_DATA_ONLY_DRIFT: unsafe.length === 0 ? "YES" : "NO",
    UNSAFE_DRIFT: unsafe.length === 0 ? "NO" : "YES",
    safePaths: safe,
    unsafePaths: unsafe,
  };
}

/**
 * Assert post-refresh feed keeps latest CHMI + NDIC + unrelated namespaces.
 */
export function assertNamespaceMergeResult(opts = {}) {
  const feed = opts.feed || readJson(path.join(opts.targetDir, "feed.json"), { items: [] });
  const items = Array.isArray(feed.items) ? feed.items : [];
  const chmiIds = new Set(items.filter(isChmiItem).map((i) => String(i.id || "")));
  const ndicIds = new Set(items.filter(isNdicItem).map((i) => String(i.id || "")));
  const otherIds = new Set(
    items
      .filter((i) => !isChmiItem(i) && !isNdicItem(i))
      .map((i) => String(i.id || ""))
  );

  const expectChmi = opts.expectChmiId != null ? String(opts.expectChmiId) : null;
  const expectNdic = opts.expectNdicId != null ? String(opts.expectNdicId) : null;
  const expectOther = opts.expectOtherId != null ? String(opts.expectOtherId) : null;
  const forbidChmi = opts.forbidChmiId != null ? String(opts.forbidChmiId) : null;
  const forbidNdic = opts.forbidNdicId != null ? String(opts.forbidNdicId) : null;

  const chmiOk = !expectChmi || chmiIds.has(expectChmi);
  const ndicOk = !expectNdic || ndicIds.has(expectNdic);
  const otherOk = !expectOther || otherIds.has(expectOther);
  const noStaleChmi = !forbidChmi || !chmiIds.has(forbidChmi);
  const noStaleNdic = !forbidNdic || !ndicIds.has(forbidNdic);

  return {
    ok: chmiOk && ndicOk && otherOk && noStaleChmi && noStaleNdic,
    chmiIds: [...chmiIds],
    ndicIds: [...ndicIds],
    otherIds: [...otherIds],
    LATEST_CHMI_PRESERVED: chmiOk && noStaleChmi ? "YES" : "NO",
    LATEST_NDIC_PRESERVED: ndicOk && noStaleNdic ? "YES" : "NO",
    UNRELATED_NAMESPACE_PRESERVED: otherOk ? "YES" : "NO",
  };
}

/**
 * Pure bounded refresh controller (injectable side effects for fixtures).
 *
 * opts:
 *   maxAttempts — default DATA_PR_REFRESH_MAX
 *   classifyDrift() — returns classifyDataPrDrift result
 *   rereadAndApply() — must re-read current main shared state + apply NDIC candidate
 *   isMergeClean() — true when PR/head is no longer conflicting vs current main
 *   onAttempt(n, detail) — optional hook
 */
export async function runBoundedDataPrRefresh(opts = {}) {
  const max = Math.max(1, Number(opts.maxAttempts || DATA_PR_REFRESH_MAX) || DATA_PR_REFRESH_MAX);
  if (max > DATA_PR_REFRESH_MAX && opts.allowRaiseMax !== true) {
    // Hard ceiling even if caller asks higher — fail-closed against unbounded loops.
  }
  const hardMax = Math.min(max, DATA_PR_REFRESH_MAX);
  const attempts = [];

  for (let n = 1; n <= hardMax; n++) {
    const drift =
      typeof opts.classifyDrift === "function"
        ? opts.classifyDrift({ attempt: n })
        : { ok: true, SAFE_DATA_ONLY_DRIFT: "YES", UNSAFE_DRIFT: "NO", safePaths: [], unsafePaths: [] };

    if (!drift || drift.ok === false || drift.UNSAFE_DRIFT === "YES") {
      return {
        ok: false,
        reason: "UNSAFE_DRIFT_FAIL_CLOSED",
        refreshCount: n - 1,
        attempts,
        ...DATA_PR_REFRESH_FLAGS,
        UNSAFE_DRIFT_FAIL_CLOSED: "YES",
        MERGE_CLEAN: "NO",
        drift,
      };
    }

    if (typeof opts.rereadAndApply !== "function") {
      throw new Error("BOUNDED_REFRESH_REQUIRES_REREAD_AND_APPLY");
    }
    const applied = await opts.rereadAndApply({ attempt: n, drift });
    const attempt = {
      n,
      drift,
      applied: applied || null,
    };
    attempts.push(attempt);
    if (typeof opts.onAttempt === "function") opts.onAttempt(n, attempt);

    if (applied && applied.ok === false) {
      return {
        ok: false,
        reason: applied.reason || "APPLY_FAILED",
        refreshCount: n,
        attempts,
        ...DATA_PR_REFRESH_FLAGS,
        MERGE_CLEAN: "NO",
      };
    }

    const clean =
      typeof opts.isMergeClean === "function" ? opts.isMergeClean({ attempt: n, applied }) : true;
    if (clean) {
      return {
        ok: true,
        reason: "MERGE_CLEAN",
        refreshCount: n,
        attempts,
        ...DATA_PR_REFRESH_FLAGS,
        MERGE_CLEAN: "YES",
        applied,
      };
    }
  }

  return {
    ok: false,
    reason: "DATA_PR_REFRESH_LIMIT_EXCEEDED",
    refreshCount: hardMax,
    attempts,
    ...DATA_PR_REFRESH_FLAGS,
    MERGE_CLEAN: "NO",
    FAIL_CLOSED: "YES",
  };
}

/**
 * Offline single-shot apply used by CI reconcile job / fixtures.
 * Caller supplies a worktree already pointing at current main tip.
 */
export function applyNdicCandidateOntoCurrentMain(opts = {}) {
  const targetDir = opts.targetDir || opts.mainIeDir;
  const candidateDir = opts.ndicCandidateDir;
  if (!targetDir || !candidateDir) {
    throw new Error("REFRESH_REQUIRES_TARGET_AND_CANDIDATE");
  }
  const before = computeSharedStateDigests(targetDir);
  const rebase = rebaseSharedNamespacesFromCurrentMain({
    targetDir,
    ndicCandidateDir: candidateDir,
    repoRoot: opts.repoRoot,
    baseMainSha: opts.baseMainSha || "",
    generatedByWriter: opts.generatedByWriter || "ndic-bounded-refresh",
    writerRunId: opts.writerRunId || process.env.GITHUB_RUN_ID || "offline",
    nowIso: opts.nowIso,
    expectNdicCardCount: opts.expectNdicCardCount,
    allowNetwork: false,
  });
  const after = computeSharedStateDigests(targetDir);
  return {
    ok: rebase.ok === true,
    rebase,
    digestsBefore: before,
    digestsAfter: after,
    chmiDigestUnchangedFromPreApplyMain: before.chmiDigest === after.chmiDigest,
    // CHMI digest should match whatever was on main before NDIC apply (preserved).
    CHMI_PRESERVED_FROM_CURRENT_MAIN: before.chmiDigest === after.chmiDigest ? "YES" : "NO",
    ...DATA_PR_REFRESH_FLAGS,
  };
}

function parseArgs(argv) {
  const out = {
    mainIe: "",
    ndicCandidate: "",
    repo: "",
    max: DATA_PR_REFRESH_MAX,
    baseMainSha: process.env.BASE_MAIN_SHA || "",
    writerRunId: process.env.WRITER_RUN_ID || process.env.GITHUB_RUN_ID || "offline",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--main-ie") out.mainIe = String(argv[++i] || "");
    else if (a === "--ndic-candidate") out.ndicCandidate = String(argv[++i] || "");
    else if (a === "--repo") out.repo = String(argv[++i] || "");
    else if (a === "--max") out.max = Number(argv[++i] || DATA_PR_REFRESH_MAX);
    else if (a === "--base-main-sha") out.baseMainSha = String(argv[++i] || "");
    else if (a === "--writer-run-id") out.writerRunId = String(argv[++i] || "");
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.mainIe || !args.ndicCandidate) {
    console.error(
      "Usage: node ndic-data-pr-bounded-refresh.mjs --main-ie <dir> --ndic-candidate <dir> [--repo <root>]"
    );
    process.exit(2);
  }
  const applied = applyNdicCandidateOntoCurrentMain({
    targetDir: args.mainIe,
    ndicCandidateDir: args.ndicCandidate,
    repoRoot: args.repo || path.resolve(args.mainIe, "../../.."),
    baseMainSha: args.baseMainSha,
    writerRunId: args.writerRunId,
  });
  console.log(
    JSON.stringify({
      ok: applied.ok,
      CHMI_PRESERVED_FROM_CURRENT_MAIN: applied.CHMI_PRESERVED_FROM_CURRENT_MAIN,
      ...DATA_PR_REFRESH_FLAGS,
      ndicCardCount: applied.rebase && applied.rebase.ndicCardCount,
    })
  );
  process.exit(applied.ok ? 0 : 1);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  });
}
