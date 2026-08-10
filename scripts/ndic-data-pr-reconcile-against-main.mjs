#!/usr/bin/env node
/**
 * CI reconcile: reset automation worktree to current main tip, apply NDIC candidate
 * via namespace merge (no ours/theirs), stage/commit, report whether push is needed.
 *
 * Intended to run under info-events-data-writers for a short critical section only.
 * No DATEX/TMC/network/NDIC credentials.
 *
 * Env / args:
 *   --repo <gitRoot>           worktree rooted at latest main tip (will be mutated)
 *   --ndic-candidate <dir>     approved candidate from this run
 *   --branch <name>            automation branch name (for logging)
 *   --max <n>                  bounded refresh attempts (default/cap 12)
 *   --commit-message <msg>
 *
 * Outputs JSON to stdout; exit 0 on success (STAGED/NO_CHANGES/ALREADY_CLEAN),
 * exit 2 on fail-closed (limit exceeded / unsafe).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DATA_PR_REFRESH_MAX,
  DATA_PR_REFRESH_FLAGS,
  classifyDataPrDrift,
  runBoundedDataPrRefresh,
  applyNdicCandidateOntoCurrentMain,
} from "./ndic-data-pr-bounded-refresh.mjs";
import { stageNdicSharedWriteOutputs } from "./ndic-stage-shared-write-outputs.mjs";

function git(repo, args) {
  return spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function parseArgs(argv) {
  const out = {
    repo: "",
    ndicCandidate: "",
    branch: process.env.AUTOMATION_BRANCH || "automation/update-ndic-datex-v1",
    max: DATA_PR_REFRESH_MAX,
    commitMessage: process.env.PR_TITLE || "chore(data): refresh NDIC DATEX v1 snapshot",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") out.repo = String(argv[++i] || "");
    else if (a === "--ndic-candidate") out.ndicCandidate = String(argv[++i] || "");
    else if (a === "--branch") out.branch = String(argv[++i] || "");
    else if (a === "--max") out.max = Number(argv[++i] || DATA_PR_REFRESH_MAX);
    else if (a === "--commit-message") out.commitMessage = String(argv[++i] || "");
  }
  return out;
}

function changedPathsVsMain(repo) {
  const r = git(repo, ["diff", "--name-only", "origin/main...HEAD"]);
  if (r.status !== 0) {
    const r2 = git(repo, ["diff", "--name-only", "main...HEAD"]);
    const text = String((r2.stdout || "") + (r2.stderr || ""));
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function headMatchesTreeAfterApply(repo) {
  const st = git(repo, ["status", "--porcelain"]);
  return rStatusClean(st);
}

function rStatusClean(st) {
  return st.status === 0 && String(st.stdout || "").trim() === "";
}

/**
 * Deterministic merge-clean check after bounded apply.
 *
 * Shallow `fetch --depth=1` + `rev-list HEAD..origin/main` / `merge-base --is-ancestor`
 * can false-negative (treat clean tip as unclean → burn DATA_PR_REFRESH_MAX).
 * Prefer tip-equality vs the base we just applied onto + local parent/HEAD topology.
 *
 * tip === baseSha:
 *   - HEAD === tip → NO_CHANGES / already at tip → clean
 *   - HEAD^ === tip → just committed NDIC on that tip → clean
 * tip !== baseSha:
 *   - main advanced → unclean (caller re-applies; no force-push)
 */
export function evaluateStableTipMergeClean(opts = {}) {
  const tipSha = String(opts.tipSha || "").trim();
  const baseSha = String(opts.baseSha || "").trim();
  const headSha = String(opts.headSha || "").trim();
  const parentSha = String(opts.parentSha || "").trim();
  const workingTreeClean = opts.workingTreeClean === true;
  if (!tipSha || !baseSha || !headSha) {
    return { clean: false, reason: "MISSING_SHA" };
  }
  if (!workingTreeClean) {
    return { clean: false, reason: "DIRTY_WORKTREE" };
  }
  if (tipSha !== baseSha) {
    return { clean: false, reason: "TIP_MOVED", tipSha, baseSha };
  }
  if (headSha === tipSha) {
    return { clean: true, reason: "HEAD_EQUALS_STABLE_TIP" };
  }
  if (parentSha && parentSha === tipSha) {
    return { clean: true, reason: "PARENT_EQUALS_STABLE_TIP" };
  }
  return { clean: false, reason: "HEAD_NOT_BASED_ON_TIP", tipSha, headSha, parentSha };
}

/** True when tip drift includes info_events paths (must re-apply NDIC). */
export function tipMoveTouchesInfoEvents(changedPaths) {
  const paths = Array.isArray(changedPaths) ? changedPaths : [];
  return paths.some((p) =>
    String(p || "")
      .replace(/\\/g, "/")
      .startsWith("projects/data/info_events/")
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.repo || !args.ndicCandidate) {
    console.error(
      "Usage: node ndic-data-pr-reconcile-against-main.mjs --repo <gitRoot> --ndic-candidate <dir>"
    );
    process.exit(2);
  }
  if (!fs.existsSync(args.repo) || !fs.existsSync(args.ndicCandidate)) {
    console.error("REPO_OR_CANDIDATE_MISSING");
    process.exit(2);
  }

  const ieDir = path.join(args.repo, "projects", "data", "info_events");
  let lastPushNeeded = false;
  let lastBaseSha = "";

  const result = await runBoundedDataPrRefresh({
    maxAttempts: Math.min(Number(args.max) || DATA_PR_REFRESH_MAX, DATA_PR_REFRESH_MAX),
    classifyDrift: () => {
      // This reconcile path only mutates projects/data/info_events/** by construction.
      // Unsafe workflow/security drift is enforced later in post-write auto-merge scope.
      return {
        ok: true,
        SAFE_DATA_ONLY_DRIFT: "YES",
        UNSAFE_DRIFT: "NO",
        safePaths: ["projects/data/info_events/"],
        unsafePaths: [],
      };
    },
    rereadAndApply: async ({ attempt }) => {
      const fetch = git(args.repo, ["fetch", "origin", "main", "--depth=1"]);
      if (fetch.status !== 0) {
        return { ok: false, reason: "FETCH_MAIN_FAILED", detail: fetch.stderr };
      }
      const reset = git(args.repo, ["checkout", "-B", args.branch, "origin/main"]);
      if (reset.status !== 0) {
        return { ok: false, reason: "RESET_TO_MAIN_FAILED", detail: reset.stderr };
      }
      lastBaseSha = String(git(args.repo, ["rev-parse", "origin/main"]).stdout || "").trim();

      const applied = applyNdicCandidateOntoCurrentMain({
        targetDir: ieDir,
        ndicCandidateDir: args.ndicCandidate,
        repoRoot: args.repo,
        baseMainSha: lastBaseSha,
        writerRunId: process.env.GITHUB_RUN_ID || "reconcile-" + attempt,
        generatedByWriter: "ndic-bounded-refresh",
      });
      if (!applied.ok) return { ok: false, reason: "APPLY_FAILED", applied };

      const staged = stageNdicSharedWriteOutputs(args.repo);
      if (!staged.ok) {
        return { ok: false, reason: staged.result || "STAGE_FAILED", staged };
      }
      if (staged.result === "NO_CHANGES") {
        lastPushNeeded = false;
        return { ok: true, result: "NO_CHANGES", baseMainSha: lastBaseSha, applied };
      }
      // Fail-closed if staging somehow included non-info_events paths.
      const stagedPaths = Array.isArray(staged.staged) ? staged.staged : changedPathsVsMain(args.repo);
      const drift = classifyDataPrDrift(stagedPaths.length ? stagedPaths : ["projects/data/info_events/feed.json"]);
      if (drift.UNSAFE_DRIFT === "YES") {
        return { ok: false, reason: "UNSAFE_DRIFT_FAIL_CLOSED", drift };
      }
      const commit = git(args.repo, ["commit", "-m", args.commitMessage]);
      if (commit.status !== 0) {
        return { ok: false, reason: "COMMIT_FAILED", detail: commit.stderr };
      }
      lastPushNeeded = true;
      return { ok: true, result: "COMMITTED", baseMainSha: lastBaseSha, applied };
    },
    isMergeClean: () => {
      // Tip-equality clean check — do not use shallow rev-list / merge-base
      // (false unclean → DATA_PR_REFRESH_LIMIT_EXCEEDED with stable tip; run 31369423212).
      const fetch = git(args.repo, ["fetch", "origin", "main", "--depth=1"]);
      if (fetch.status !== 0) return false;
      const tipSha = String(git(args.repo, ["rev-parse", "origin/main"]).stdout || "").trim();
      const headSha = String(git(args.repo, ["rev-parse", "HEAD"]).stdout || "").trim();
      let parentSha = "";
      if (headSha && tipSha && headSha !== tipSha) {
        parentSha = String(git(args.repo, ["rev-parse", "HEAD^"]).stdout || "").trim();
      }
      const verdict = evaluateStableTipMergeClean({
        tipSha,
        baseSha: lastBaseSha,
        headSha,
        parentSha,
        workingTreeClean: headMatchesTreeAfterApply(args.repo),
      });
      if (verdict.clean) return true;
      if (verdict.reason === "TIP_MOVED") {
        // Always re-apply when tip moved (preserve foreign commits; no force-push).
        // IE-touch is logged for forensics only.
        const names = git(args.repo, [
          "diff",
          "--name-only",
          lastBaseSha + ".." + tipSha,
        ]);
        const paths = String(names.stdout || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        console.error(
          JSON.stringify({
            CHMI_MAIN_TIP_RACE_VS_BOUNDED_RECONCILE: tipMoveTouchesInfoEvents(paths)
              ? "IE_TOUCHED"
              : "NON_IE_OR_UNKNOWN",
            tipSha,
            baseSha: lastBaseSha,
            changedPathCount: paths.length,
          })
        );
      }
      return false;
    },
  });

  const out = {
    ok: result.ok === true,
    reason: result.reason,
    refreshCount: result.refreshCount,
    pushNeeded: lastPushNeeded,
    baseMainSha: lastBaseSha,
    branch: args.branch,
    ...DATA_PR_REFRESH_FLAGS,
    MERGE_CLEAN: result.MERGE_CLEAN,
    FAIL_CLOSED: result.ok ? "NO" : "YES",
    ATOMIC_TIP_EQUALITY_CLEAN_CHECK: "YES",
  };
  console.log(JSON.stringify(out));
  if (!result.ok) process.exit(2);
  process.exit(0);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  });
}
