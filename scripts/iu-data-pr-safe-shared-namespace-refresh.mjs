#!/usr/bin/env node
/**
 * SAFE refresh without network: REBASE_SHARED_NAMESPACES_FROM_CURRENT_MAIN.
 *
 * Takes latest main CHMI + Info Events + approved NDIC candidate, recomputes
 * derived feed via existing info-events-shared-writer-critical apply path.
 * No DATEX/TMC download, no VPS, no NDIC credentials.
 *
 * Usage:
 *   node iu-data-pr-safe-shared-namespace-refresh.mjs \
 *     --main-ie <dir> --ndic-candidate <dir> --repo <gitRoot> \
 *     [--base-main-sha <sha>] [--writer-run-id <id>]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebaseSharedNamespacesFromCurrentMain } from "./iu-data-pr-finalization-protocol.mjs";
import { runOpenOrRefreshDataPr } from "./ndic-open-or-refresh-data-pr.mjs";

export { rebaseSharedNamespacesFromCurrentMain };

/**
 * Refresh same Data PR after offline rebase (optional; fetchImpl injectable).
 * Never creates a second PR when one already exists.
 */
export async function safeRefreshDataPr(opts = {}) {
  const rebase = rebaseSharedNamespacesFromCurrentMain({
    targetDir: opts.targetDir || opts.mainIeDir,
    ndicCandidateDir: opts.ndicCandidateDir,
    repoRoot: opts.repoRoot,
    baseMainSha: opts.baseMainSha,
    generatedByWriter: opts.generatedByWriter || "ndic-safe-refresh",
    writerRunId: opts.writerRunId || "safe-refresh",
    nowIso: opts.nowIso,
    expectNdicCardCount: opts.expectNdicCardCount,
    allowNetwork: false,
  });

  let pr = null;
  if (opts.openOrRefresh === true) {
    pr = await runOpenOrRefreshDataPr({
      env: opts.env || process.env,
      fetchImpl: opts.fetchImpl,
    });
  }

  return {
    ...rebase,
    SAFE_SHARED_NAMESPACE_REFRESH: "YES",
    DATA_PR_DUPLICATE_PR_POSSIBLE: pr ? pr.DATA_PR_DUPLICATE_PR_POSSIBLE || "NO" : "NO",
    pr,
  };
}

function parseArgs(argv) {
  const out = {
    mainIe: "",
    ndicCandidate: "",
    repo: "",
    baseMainSha: process.env.BASE_MAIN_SHA || "",
    writerRunId: process.env.WRITER_RUN_ID || process.env.GITHUB_RUN_ID || "offline",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--main-ie") out.mainIe = String(argv[++i] || "");
    else if (a === "--ndic-candidate") out.ndicCandidate = String(argv[++i] || "");
    else if (a === "--repo") out.repo = String(argv[++i] || "");
    else if (a === "--base-main-sha") out.baseMainSha = String(argv[++i] || "");
    else if (a === "--writer-run-id") out.writerRunId = String(argv[++i] || "");
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.mainIe || !args.ndicCandidate) {
    console.error(
      "Usage: node iu-data-pr-safe-shared-namespace-refresh.mjs --main-ie <dir> --ndic-candidate <dir> [--repo <root>]"
    );
    process.exit(2);
  }
  const result = rebaseSharedNamespacesFromCurrentMain({
    targetDir: args.mainIe,
    ndicCandidateDir: args.ndicCandidate,
    repoRoot: args.repo || path.resolve(args.mainIe, "../../.."),
    baseMainSha: args.baseMainSha,
    writerRunId: args.writerRunId,
    generatedByWriter: "ndic-safe-refresh",
  });
  console.log(
    JSON.stringify({
      ok: result.ok,
      REBASE_SHARED_NAMESPACES_FROM_CURRENT_MAIN: result.REBASE_SHARED_NAMESPACES_FROM_CURRENT_MAIN,
      NETWORK_REQUIRED: result.NETWORK_REQUIRED,
      NDIC_CREDENTIALS_REQUIRED: result.NDIC_CREDENTIALS_REQUIRED,
      binding: result.binding,
      ndicCardCount: result.ndicCardCount,
    })
  );
  process.exit(result.ok ? 0 : 1);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  });
}
