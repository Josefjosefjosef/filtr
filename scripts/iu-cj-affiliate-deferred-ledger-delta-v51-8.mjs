#!/usr/bin/env node
/**
 * Identity-level set-diff: historical deferred ledger vs current deferredNew keys.
 * Requires a persisted current keyset (see iu-cj-affiliate-deferred-new-keys-persist-v51-8.mjs).
 *
 * Env:
 *   IU_CJ_INV_LEDGER                  historical ledger JSON (keys[])
 *   IU_CJ_INV_CURRENT_DEFERRED_KEYS   current keys path (ledger JSON | jsonl.gz | meta | dir)
 *   IU_CJ_DEFERRED_DELTA_OUT          output JSON path (default: stdout-only + optional file)
 *
 * Does not invent SOURCE_CURRENT. Does not unlock growth.
 */

import fs from "node:fs";
import path from "node:path";
import {
  loadDeferredNewKeySet,
  streamDeferredNewKeysFromLedger,
  deferredKeysPathsFromEnv,
} from "./iu-cj-affiliate-deferred-new-keys-persist-v51-8.mjs";

export async function loadHistoricalLedgerKeys(file) {
  const keys = new Set();
  const { rows, meta } = await streamDeferredNewKeysFromLedger(file, (k) => keys.add(k));
  return { keys, uniqueCount: keys.size, rows, meta };
}

/**
 * @returns {{ reconcilable: boolean, declaredDelta: number|null, leftHistorical: string[], enteredCurrent: string[], unexplainedResidual: number|null, ... }}
 */
export async function reconcileDeferredLedgerDelta(opts = {}) {
  const histPath = opts.historicalLedger || null;
  const curPath = opts.currentKeys || null;
  if (!histPath || !fs.existsSync(histPath)) {
    return {
      schema: "DEFERRED_LEDGER_DELTA",
      at: new Date().toISOString(),
      reconcilable: false,
      missingReason: "HISTORICAL_LEDGER_PATH_MISSING",
      status: "BLOCKED_MISSING_HISTORICAL",
    };
  }
  if (!curPath || !fs.existsSync(curPath)) {
    return {
      schema: "DEFERRED_LEDGER_DELTA",
      at: new Date().toISOString(),
      reconcilable: false,
      missingReason: "CURRENT_RUN_DEFERRED_KEY_LIST_NOT_AVAILABLE",
      status: "WAITING_NEXT_DISARMED_SYNC_FOR_CURRENT_KEYS",
      note: "Writer is in-tree; production capture needs next DISARMED catalog sync that persists deferred keys sidecar.",
    };
  }

  const hist = await loadHistoricalLedgerKeys(histPath);
  const cur = await loadDeferredNewKeySet(curPath);

  const leftHistorical = [];
  for (const k of hist.keys) {
    if (!cur.keys.has(k)) leftHistorical.push(k);
  }
  const enteredCurrent = [];
  for (const k of cur.keys) {
    if (!hist.keys.has(k)) enteredCurrent.push(k);
  }

  const declaredDelta = hist.uniqueCount - cur.uniqueCount;
  const identityNet = leftHistorical.length - enteredCurrent.length;
  const sampleLimit = opts.sampleLimit != null ? Number(opts.sampleLimit) : 200;

  return {
    schema: "DEFERRED_LEDGER_DELTA",
    at: new Date().toISOString(),
    status: "RECONCILED_PER_IDENTITY",
    reconcilable: true,
    missingReason: null,
    historicalLedger: {
      path: histPath,
      updatedAt: hist.meta?.updatedAt ?? null,
      runId: hist.meta?.runId ?? null,
      declaredDeferredNewCount: hist.meta?.deferredNewCount ?? null,
      uniqueKeys: hist.uniqueCount,
    },
    currentDeferredKeys: {
      path: cur.source,
      updatedAt: cur.meta?.updatedAt ?? null,
      runId: cur.meta?.runId ?? null,
      uniqueKeys: cur.uniqueCount,
      deferredNewKeysPersistedSidecar: true,
    },
    declaredDelta,
    identityLevel: {
      leftHistoricalCount: leftHistorical.length,
      enteredCurrentCount: enteredCurrent.length,
      identityNet,
      declaredDeltaMatchesIdentityNet: declaredDelta === identityNet,
      unexplainedResidual: 0,
    },
    leftHistoricalSample: leftHistorical.slice(0, sampleLimit),
    enteredCurrentSample: enteredCurrent.slice(0, sampleLimit),
    interpretation: [
      "declaredDelta = historicalUnique − currentUnique (net).",
      "leftHistorical = in historical ledger, absent from current deferred keyset.",
      "enteredCurrent = in current deferred keyset, absent from historical ledger.",
      "identityNet = leftHistorical − enteredCurrent; must equal declaredDelta when both keysets are complete.",
    ],
  };
}

export async function main(env = process.env) {
  const paths = deferredKeysPathsFromEnv(env);
  const result = await reconcileDeferredLedgerDelta({
    historicalLedger: paths.historicalLedger,
    currentKeys: paths.currentKeys,
  });
  const out = env.IU_CJ_DEFERRED_DELTA_OUT || null;
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n", "utf8");
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]).replace(/\\/g, "/").endsWith("iu-cj-affiliate-deferred-ledger-delta-v51-8.mjs");
if (isDirect) {
  main().catch((err) => {
    console.error(String(err && err.stack ? err.stack : err));
    process.exitCode = 1;
  });
}
