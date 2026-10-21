/**

 * GitHub Actions ingest orchestrator (offline-first).

 * IMAP fetch → D1 lifecycle → MIME/classifier/AI/v15 → confirm completion in D1 only.

 */

import path from "node:path";

import os from "node:os";

import {

  AFFILIATE_MAILBOX_ADDRESS,

  FORPSI_IMAP_SYNC_DEFAULTS,

} from "./iu-cj-affiliate-phase2-forpsi-imap-config.mjs";

import { createForpsiImapTransport } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";

import { runMailboxFetchBatch } from "./iu-cj-affiliate-phase2-forpsi-imap-sync-lib.mjs";

import { createCjEmailD1Store, resolveD1Backend } from "./iu-cj-affiliate-phase2-cj-email-d1-store.mjs";

import { processMessageLifecycle } from "./iu-cj-affiliate-phase2-message-lifecycle.mjs";

import { processMessageThroughFullPipeline } from "./iu-cj-affiliate-phase2-github-actions-ingest-pipeline.mjs";

import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

import { resolveLiveIngestGate } from "./iu-cj-affiliate-phase2-github-actions-ingest-live-gate.mjs";
import { storeOp } from "./iu-cj-affiliate-phase2-message-lifecycle-store-op.mjs";

import { INGEST_SOURCE } from "./iu-cj-affiliate-phase2-cf-email-worker-prototype.mjs";



export { processMessageThroughFullPipeline };



export const INGEST_RUN_MODE = Object.freeze({

  periodic: "periodic",

  historical: "historical",

  manual: "manual",

});



export function resolveIngestRuntimeConfig(env = process.env) {

  const offlineForced = env.IU_CJ_EMAIL_INGEST_OFFLINE === "1" || env.IU_CJ_GITHUB_INGEST_DRY_RUN === "1";

  const liveGate = resolveLiveIngestGate(env);
  const liveApproved = liveGate.allowed;

  const d1PersistPath =

    env.IU_CJ_D1_MOCK_PATH ||

    env.IU_CJ_D1_CHECKPOINT_PATH ||

    path.join(env.GITHUB_WORKSPACE || os.tmpdir(), "iu-cj-email-d1-checkpoint.json");

  return {

    offlineForced,

    liveImapAllowed: liveApproved,

    imapHost: env.IU_FORPSI_IMAP_HOST || "imap.forpsi.com",

    d1PersistPath,

    runMode: env.IU_CJ_EMAIL_INGEST_MODE || INGEST_RUN_MODE.periodic,

    batchSize: Number(env.IU_CJ_EMAIL_INGEST_BATCH_SIZE || FORPSI_IMAP_SYNC_DEFAULTS.batchSize),

    maxAiCallsPerRun: Number(env.IU_CJ_AI_MAX_CALLS_PER_RUN || 10),

    productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,

    d1Backend: resolveD1Backend({}, env),

  };

}



export async function createIngestTransport(options = {}) {

  if (options.liveImapAllowed && !options.mockFixture) {

    return createForpsiImapTransport({ mode: "live" });

  }

  if (options.mockFixture) {

    return createForpsiImapTransport({ mode: "mock", mockFixture: options.mockFixture });

  }

  return createForpsiImapTransport({ mode: "mock", mockFixture: { messages: [] } });

}



export async function runGithubActionsIngestCycle(options = {}) {

  const config = { ...resolveIngestRuntimeConfig(options.env || process.env), ...options };

  const runId = options.runId || "gha-" + process.pid + "-" + Date.now();

  const d1Path = options.d1PersistPath || config.d1PersistPath;

  const store = createCjEmailD1Store({

    persistPath: d1Path,

    backend: options.d1Backend || config.d1Backend,

    env: options.env || process.env,

  });



  if (options.simulateConcurrentRun) {

    await storeOp(store, "acquireRunLease", "other-run");

  }

  const lease = await storeOp(store, "acquireRunLease", runId);

  if (!lease.ok) {

    return { ok: false, phase: "concurrency", ...lease, publishable: false };

  }



  if (options.simulateImapFailure) {

    await storeOp(store, "releaseRunLease", runId);

    return { ok: false, phase: "imap", reason: "imap_simulated_failure", publishable: false };

  }



  const transport =

    options.transport ||

    (await createIngestTransport({

      mockFixture: options.mockFixture,

      liveImapAllowed: config.liveImapAllowed,

    }));



  const mode = options.mode || config.runMode;

  const batchSize =

    mode === INGEST_RUN_MODE.historical

      ? options.historicalBatchSize || 50

      : Math.min(config.batchSize, FORPSI_IMAP_SYNC_DEFAULTS.maxBatchSize);



  const checkpoint = await storeOp(store, "getSyncCheckpoint");

  let previousUv = checkpoint.uidvalidity;

  const completedUids = new Set((checkpoint.completedUids || []).map(Number));

  const fetchResult = await runMailboxFetchBatch({

    transport,

    batchSize,

    isUidCompleted: (uid) => completedUids.has(Number(uid)),

    onUidValidity: () => {},

  });



  if (!fetchResult.ok) {

    await storeOp(store, "releaseRunLease", runId);

    return { ok: false, phase: fetchResult.phase, reason: fetchResult.reason, publishable: false };

  }

  if (fetchResult.uidvalidity != null) {

    const uvChange = await storeOp(store, "applyUidValidityChange", fetchResult.uidvalidity, previousUv, {
      runId,
      expectedPreviousUidvalidity: checkpoint.uidvalidity,
    });

    if (uvChange?.ok === false) {
      await storeOp(store, "releaseRunLease", runId);
      return { ok: false, phase: "uidvalidity", reason: uvChange.reason, publishable: false };
    }

    if (uvChange?.reset) completedUids.clear();

    previousUv = fetchResult.uidvalidity;

  }



  const pipelineResults = [];

  let lifecycleFailures = 0;



  for (const br of fetchResult.batchResults || []) {

    if (!br.ok || !br.message) {

      lifecycleFailures += 1;

      pipelineResults.push({ uid: br.uid, ok: false, reason: br.reason || "missing_message" });

      continue;

    }

    const lifecycleOpts = Object.create(null);
    lifecycleOpts.runId = runId;
    lifecycleOpts.pipelineContext = Object.assign(Object.create(null), options.pipelineOptions || {});
    if (Object.hasOwn(options, "failAfterStage")) lifecycleOpts.failAfterStage = options.failAfterStage;
    if (Object.hasOwn(options, "simulateInterruptAt")) lifecycleOpts.simulateInterruptAt = options.simulateInterruptAt;
    if (Object.hasOwn(options, "simulateD1FailureOnRaw")) lifecycleOpts.simulateD1FailureOnRaw = options.simulateD1FailureOnRaw;
    if (Object.hasOwn(options, "simulateD1FailureOnFinal")) lifecycleOpts.simulateD1FailureOnFinal = options.simulateD1FailureOnFinal;
    else if (Object.hasOwn(options, "simulateD1Failure")) lifecycleOpts.simulateD1FailureOnFinal = options.simulateD1Failure;
    if (Object.hasOwn(options, "simulateAiPayload")) lifecycleOpts.simulateAiPayload = options.simulateAiPayload;
    const lifecycle = await processMessageLifecycle(br.message, store, lifecycleOpts);

    if (!lifecycle.ok && !lifecycle.duplicate) lifecycleFailures += 1;

    pipelineResults.push({ uid: br.uid, ok: lifecycle.ok, fromImapFetch: br.fromImapFetch === true, lifecycle });

  }



  await storeOp(store, "recordIngestJob", {

    runId,

    mode,

    ok: lifecycleFailures === 0,

    batchSize: fetchResult.batchSize || 0,

    lifecycleFailures,

    at: new Date().toISOString(),

  }, { runId });

  await storeOp(store, "releaseRunLease", runId);



  const anyCompleted = pipelineResults.some((r) => r.lifecycle?.stage === "completed");

  const ok = fetchResult.ok && lifecycleFailures === 0;



  return {

    ok,

    runId,

    mode,

    liveImap: config.liveImapAllowed ? "approved_not_used_in_offline_tests" : "BLOCKED",

    productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,

    fetchResult,

    pipelineResults,

    d1PersistPath: d1Path,

    publishable: false,

    autoPublication: false,

  };

}


