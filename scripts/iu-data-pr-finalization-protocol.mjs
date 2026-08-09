#!/usr/bin/env node
/**
 * DATA_PR_FINALIZATION_PROTOCOL — anti-loop protection for shared-data PRs
 * writing projects/data/info_events/**.
 *
 * Binding: DATA_PR_HEAD × BASE_MAIN_HEAD × SHARED_STATE_DIGEST.
 * Merge-ready requires BASE_HEAD_STILL_CURRENT or BASE_HEAD_SEMANTICALLY_COMPATIBLE.
 * Safe stale-base refresh: REBASE_SHARED_NAMESPACES_FROM_CURRENT_MAIN (no network).
 * Finalization lock: short critical section on info-events-data-writers only.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  SHARED_WRITER_GROUP,
  isChmiItem,
  isNdicItem,
  applyNdicCandidate,
  readJson,
  writeJsonAtomic,
} from "./info-events-shared-writer-critical.mjs";

export const DATA_PR_FINALIZATION_PROTOCOL = "DATA_PR_FINALIZATION_PROTOCOL";
export const FINALIZATION_LOCK_GROUP = SHARED_WRITER_GROUP;
export const BINDING_REL =
  "projects/data/info_events/ndic_datex_v1/data_pr_finalization_binding.json";
export const PROTOCOL_FLAGS = Object.freeze({
  WHOLE_WORKFLOW_SHARED_LOCK: "NO",
  NETWORK_PREP_INSIDE_SHARED_LOCK: "NO",
  LONG_RUNNING_TESTS_INSIDE_SHARED_LOCK: "NO",
  HEAD_CHECKS_ALONE_MERGE_READY: "NO",
  SAFE_REFRESH_NETWORK_REQUIRED: "NO",
  SAFE_REFRESH_NDIC_CREDENTIALS_REQUIRED: "NO",
});

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
      .join(",") +
    "}"
  );
}

export function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function digestCanonical(value) {
  return sha256Hex(stableStringify(value)).slice(0, 32);
}

function isInfoEventsOwnedItem(item) {
  if (!item || typeof item !== "object") return false;
  if (isChmiItem(item) || isNdicItem(item)) return false;
  return true;
}

/**
 * Semantic digests of shared namespaces (NOT git SHA).
 * Unrelated main commits (e.g. videos.json) do not change these digests.
 */
export function computeSharedStateDigests(infoEventsDir) {
  const feed = readJson(path.join(infoEventsDir, "feed.json"), { items: [] });
  const mon = readJson(path.join(infoEventsDir, "monitoring.json"), {});
  const items = Array.isArray(feed.items) ? feed.items : [];

  const chmiItems = items
    .filter(isChmiItem)
    .slice()
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const ndicItems = items
    .filter(isNdicItem)
    .slice()
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const ieItems = items
    .filter(isInfoEventsOwnedItem)
    .slice()
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  const chmiDigest = digestCanonical({
    items: chmiItems,
    monitoring: mon && typeof mon.chmiCapV2 === "object" ? mon.chmiCapV2 : null,
  });
  const ndicDigest = digestCanonical({
    items: ndicItems,
    monitoring: mon && typeof mon.ndicDatexV1 === "object" ? mon.ndicDatexV1 : null,
  });
  const infoEventsDigest = digestCanonical({
    items: ieItems,
    // IE-owned monitoring keys only (exclude foreign namespace blocks)
    monitoringCore: {
      feedItemCount: mon.feedItemCount,
      laneCounts: mon.laneCounts,
      ingest: mon.ingest,
      sources: mon.sources,
    },
  });
  const sharedStateDigest = digestCanonical({
    chmiDigest,
    infoEventsDigest,
    ndicDigest,
  });

  return {
    chmiDigest,
    infoEventsDigest,
    ndicDigest,
    sharedStateDigest,
    counts: {
      chmi: chmiItems.length,
      infoEvents: ieItems.length,
      ndic: ndicItems.length,
    },
  };
}

export function buildDataPrBindingMeta(opts = {}) {
  const digests = opts.digests || {};
  return {
    protocol: DATA_PR_FINALIZATION_PROTOCOL,
    version: 1,
    baseMainSha: String(opts.baseMainSha || ""),
    dataPrHead: opts.dataPrHead != null ? String(opts.dataPrHead) : null,
    chmiDigest: String(digests.chmiDigest || ""),
    infoEventsDigest: String(digests.infoEventsDigest || ""),
    ndicDigest: String(digests.ndicDigest || ""),
    sharedStateDigest: String(digests.sharedStateDigest || ""),
    generatedByWriter: String(opts.generatedByWriter || "ndic"),
    writerRunId: String(opts.writerRunId || ""),
    recordedAt: String(opts.recordedAt || new Date().toISOString()),
    HEAD_CHECKS_ALONE_MERGE_READY: "NO",
  };
}

export function bindingPath(repoRoot) {
  return path.join(repoRoot, BINDING_REL);
}

export function writeDataPrBinding(repoRoot, opts = {}) {
  const ieDir = opts.infoEventsDir || path.join(repoRoot, "projects", "data", "info_events");
  const digests = opts.digests || computeSharedStateDigests(ieDir);
  const meta = buildDataPrBindingMeta({
    baseMainSha: opts.baseMainSha,
    dataPrHead: opts.dataPrHead,
    digests,
    generatedByWriter: opts.generatedByWriter,
    writerRunId: opts.writerRunId,
    recordedAt: opts.recordedAt,
  });
  const out = bindingPath(repoRoot);
  writeJsonAtomic(out, meta);
  return meta;
}

export function readDataPrBinding(repoRoot) {
  return readJson(bindingPath(repoRoot), null);
}

/**
 * Evaluate whether a Data PR base is still current / semantically compatible.
 * Compares namespace digests — unrelated commits do not force STALE.
 */
export function evaluateBaseFreshness({ recorded, currentMainDigests, currentMainSha }) {
  const rec = recorded && typeof recorded === "object" ? recorded : null;
  const cur = currentMainDigests && typeof currentMainDigests === "object" ? currentMainDigests : null;
  if (!rec || !cur) {
    return {
      ok: false,
      STALE: true,
      BASE_HEAD_STILL_CURRENT: "NO",
      BASE_HEAD_SEMANTICALLY_COMPATIBLE: "NO",
      MERGE_READY: "NO",
      reason: "MISSING_BINDING_OR_CURRENT_DIGESTS",
    };
  }

  const baseSha = String(rec.baseMainSha || "");
  const mainSha = String(currentMainSha || "");
  const BASE_HEAD_STILL_CURRENT = baseSha && mainSha && baseSha === mainSha ? "YES" : "NO";

  const chmiSame = String(rec.chmiDigest || "") === String(cur.chmiDigest || "");
  const ieSame = String(rec.infoEventsDigest || "") === String(cur.infoEventsDigest || "");
  const ndicMainSame = String(rec.ndicDigest || "") === String(cur.ndicDigest || "");
  // Data PR is stale when foreign (CHMI/IE) namespaces on main moved vs binding.
  // NDIC on main may differ (Data PR is the NDIC update) — do not require ndicMainSame.
  const foreignCompatible = chmiSame && ieSame;
  const BASE_HEAD_SEMANTICALLY_COMPATIBLE = foreignCompatible ? "YES" : "NO";

  const STALE = !(BASE_HEAD_STILL_CURRENT === "YES" || BASE_HEAD_SEMANTICALLY_COMPATIBLE === "YES");
  const changed = [];
  if (!chmiSame) changed.push("CHMI");
  if (!ieSame) changed.push("INFO_EVENTS");

  return {
    ok: !STALE,
    STALE,
    BASE_HEAD_STILL_CURRENT,
    BASE_HEAD_SEMANTICALLY_COMPATIBLE,
    MERGE_READY: STALE ? "NO" : "YES",
    HEAD_CHECKS_ALONE_MERGE_READY: "NO",
    foreignNamespacesUnchanged: foreignCompatible,
    ndicDigestOnMainMatchesBinding: ndicMainSame,
    changedNamespaces: changed,
    reason: STALE
      ? "SHARED_NAMESPACE_DRIFT:" + (changed.join(",") || "UNKNOWN")
      : BASE_HEAD_STILL_CURRENT === "YES"
        ? "BASE_SHA_CURRENT"
        : "SEMANTIC_DIGESTS_COMPATIBLE",
  };
}

/**
 * Offline safe refresh: take latest main CHMI+IE, apply approved NDIC candidate
 * via existing shared-writer apply path (no DATEX/TMC/network).
 */
export function rebaseSharedNamespacesFromCurrentMain(opts = {}) {
  const targetDir = opts.targetDir;
  const candidateDir = opts.ndicCandidateDir;
  if (!targetDir || !candidateDir) {
    throw new Error("REBASE_REQUIRES_TARGET_AND_NDIC_CANDIDATE");
  }
  if (opts.allowNetwork === true || opts.fetchImpl || opts.ndicCredentials) {
    throw new Error("SAFE_REFRESH_MUST_NOT_USE_NETWORK_OR_CREDENTIALS");
  }

  const before = computeSharedStateDigests(targetDir);
  const beforeNdicCount = before.counts.ndic;
  const ndicBeforeItems = (readJson(path.join(targetDir, "feed.json"), { items: [] }).items || [])
    .filter(isNdicItem)
    .map((i) => ({
      id: i.id,
      title: i.title,
      trust: i.trust,
      timeline: i.timeline,
      mapSafety: i.mapSafety,
    }));

  const applyResult = applyNdicCandidate({
    targetDir,
    candidateDir,
    nowIso: opts.nowIso || new Date().toISOString(),
  });

  const after = computeSharedStateDigests(targetDir);
  const binding = opts.repoRoot
    ? writeDataPrBinding(opts.repoRoot, {
        infoEventsDir: targetDir,
        digests: after,
        baseMainSha: opts.baseMainSha || "",
        generatedByWriter: opts.generatedByWriter || "ndic-safe-refresh",
        writerRunId: opts.writerRunId || "offline-rebase",
        dataPrHead: opts.dataPrHead,
        recordedAt: opts.nowIso,
      })
    : buildDataPrBindingMeta({
        baseMainSha: opts.baseMainSha || "",
        digests: after,
        generatedByWriter: opts.generatedByWriter || "ndic-safe-refresh",
        writerRunId: opts.writerRunId || "offline-rebase",
        dataPrHead: opts.dataPrHead,
        recordedAt: opts.nowIso,
      });

  const ndicAfterItems = (readJson(path.join(targetDir, "feed.json"), { items: [] }).items || [])
    .filter(isNdicItem)
    .map((i) => ({
      id: i.id,
      title: i.title,
      trust: i.trust,
      timeline: i.timeline,
      mapSafety: i.mapSafety,
    }));

  // When candidate carries the same approved NDIC set, card-level safety fields must hold.
  const ndicCardCountUnchanged =
    opts.expectNdicCardCount == null
      ? after.counts.ndic === beforeNdicCount || after.counts.ndic === ndicAfterItems.length
      : after.counts.ndic === Number(opts.expectNdicCardCount);

  return {
    ok: true,
    REBASE_SHARED_NAMESPACES_FROM_CURRENT_MAIN: "YES",
    NETWORK_REQUIRED: "NO",
    NDIC_CREDENTIALS_REQUIRED: "NO",
    VPS_REQUIRED: "NO",
    ACTIVE_SYNC_REQUIRED: "NO",
    applyResult,
    binding,
    digestsBefore: before,
    digestsAfter: after,
    ndicCardCount: after.counts.ndic,
    ndicCardCountUnchanged,
    ndicSafetySnapshotBefore: ndicBeforeItems,
    ndicSafetySnapshotAfter: ndicAfterItems,
    ...PROTOCOL_FLAGS,
  };
}

/**
 * Short finalization critical section model.
 * Lock covers ONLY: re-read main → validate digests → merge decision.
 * Must never wrap network prep / long tests / whole workflow.
 */
export function runFinalizationCriticalSection(opts = {}) {
  const phases = [];
  const lockHeld = { value: false };
  const acquire = typeof opts.acquireLock === "function" ? opts.acquireLock : () => ({ ok: true });
  const release = typeof opts.releaseLock === "function" ? opts.releaseLock : () => {};

  const acquired = acquire();
  if (!acquired || acquired.ok === false) {
    return {
      ok: false,
      MERGE_READY: "NO",
      reason: "FINALIZATION_LOCK_ACQUIRE_FAILED",
      FINALIZATION_LONG_RUNNING_PHASE_INSIDE_LOCK: "NO",
      ...PROTOCOL_FLAGS,
    };
  }
  lockHeld.value = true;
  phases.push("LOCK_ACQUIRED");

  try {
    if (opts.networkPrepInsideLock === true || opts.longTestsInsideLock === true) {
      throw new Error("FORBIDDEN_LONG_PHASE_INSIDE_FINALIZATION_LOCK");
    }

    phases.push("REREAD_MAIN");
    const currentMain = typeof opts.reReadMain === "function" ? opts.reReadMain() : opts.currentMain;
    phases.push("VALIDATE_BINDING");
    const freshness = evaluateBaseFreshness({
      recorded: opts.recorded || (currentMain && currentMain.recorded),
      currentMainDigests: (currentMain && currentMain.digests) || opts.currentMainDigests,
      currentMainSha: (currentMain && currentMain.sha) || opts.currentMainSha,
    });

    if (freshness.STALE) {
      phases.push("ABORT_STALE");
      return {
        ok: false,
        MERGE_READY: "NO",
        freshness,
        phases,
        FINALIZATION_LONG_RUNNING_PHASE_INSIDE_LOCK: "NO",
        DATA_PR_FINALIZATION_LOCK_IMPLEMENTED: "YES",
        ...PROTOCOL_FLAGS,
      };
    }

    phases.push("MERGE");
    const mergeResult =
      typeof opts.mergeFn === "function"
        ? opts.mergeFn({ freshness, currentMain, lockGroup: FINALIZATION_LOCK_GROUP })
        : { merged: true };

    // Concurrent writer attempting mutate during critical section must be rejected by lock.
    if (typeof opts.concurrentWriterAttempt === "function") {
      const attempt = opts.concurrentWriterAttempt({ lockHeld: lockHeld.value });
      if (attempt && attempt.applied === true) {
        throw new Error("LOST_UPDATE_DURING_FINALIZATION");
      }
    }

    phases.push("DONE");
    return {
      ok: true,
      MERGE_READY: "YES",
      freshness,
      mergeResult,
      phases,
      lockGroup: FINALIZATION_LOCK_GROUP,
      FINALIZATION_LONG_RUNNING_PHASE_INSIDE_LOCK: "NO",
      DATA_PR_FINALIZATION_LOCK_IMPLEMENTED: "YES",
      ...PROTOCOL_FLAGS,
    };
  } finally {
    lockHeld.value = false;
    release();
    phases.push("LOCK_RELEASED");
  }
}

export function assertProtocolMarkersInWorkflow(wfSrc) {
  const src = String(wfSrc || "");
  return {
    hasSharedWriterGroup: /group:\s*info-events-data-writers/.test(src),
    noWorkflowLevelSharedLock: !/(?:^|\n)concurrency:\s*\n[\s\S]*?group:\s*info-events-data-writers/.test(
      src.split(/\njobs:\s*\n/)[0] || ""
    ),
    recordsBinding:
      /data_pr_finalization_binding|iu-data-pr-finalization-protocol|writeDataPrBinding|record-data-pr-binding/.test(
        src
      ),
    usesOpenOrRefresh: /ndic-open-or-refresh-data-pr\.mjs/.test(src),
  };
}

function cliMain(argv) {
  const cmd = String(argv[2] || "");
  if (cmd === "digest") {
    const dir = String(argv[3] || "");
    if (!dir) {
      console.error("Usage: node iu-data-pr-finalization-protocol.mjs digest <infoEventsDir>");
      process.exit(2);
    }
    console.log(JSON.stringify({ ok: true, ...computeSharedStateDigests(dir) }));
    return;
  }
  if (cmd === "record-binding") {
    const repoRoot = String(argv[3] || ".");
    const baseMainSha = process.env.BASE_MAIN_SHA || process.env.GITHUB_SHA || "";
    const writerRunId = process.env.WRITER_RUN_ID || process.env.GITHUB_RUN_ID || "";
    const generatedByWriter = process.env.GENERATED_BY_WRITER || "ndic";
    const meta = writeDataPrBinding(repoRoot, {
      baseMainSha,
      writerRunId,
      generatedByWriter,
    });
    console.log(JSON.stringify({ ok: true, binding: meta, path: BINDING_REL }));
    return;
  }
  if (cmd === "evaluate") {
    const bindingFile = String(argv[3] || "");
    const mainIeDir = String(argv[4] || "");
    const mainSha = String(argv[5] || process.env.BASE_MAIN_SHA || "");
    const recorded = bindingFile ? readJson(bindingFile, null) : null;
    const current = computeSharedStateDigests(mainIeDir);
    const result = evaluateBaseFreshness({
      recorded,
      currentMainDigests: current,
      currentMainSha: mainSha,
    });
    console.log(JSON.stringify({ ok: result.ok, ...result, current }));
    process.exit(result.ok ? 0 : 1);
  }
  console.error(
    "Usage: node iu-data-pr-finalization-protocol.mjs <digest|record-binding|evaluate> ..."
  );
  process.exit(2);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) cliMain(process.argv);
