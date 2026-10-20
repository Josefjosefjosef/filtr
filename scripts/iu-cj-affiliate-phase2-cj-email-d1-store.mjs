/**
 * CJ email ingest D1 store — offline mock (production Cloudflare D1 BLOCKED until approved).
 * Authoritative checkpoint for GitHub Actions (not runner local temp alone).
 */
import { createMockD1Store, hashMessageContent } from "./iu-cj-affiliate-phase2-cj-email-d1-mock.mjs";
import {
  evaluateFinalizePreconditions,
  buildMessageKey,
  sanitizeFinalizePatch,
} from "./iu-cj-affiliate-phase2-cj-email-d1-finalize-guard.mjs";
import {
  evaluateStageTransition,
  sanitizeStageTransitionPatch,
} from "./iu-cj-affiliate-phase2-cj-email-d1-stage-transition-guard.mjs";
import {
  sanitizeIngestMutationPatch,
  mapLeaseReasonToMutation,
} from "./iu-cj-affiliate-phase2-cj-email-d1-ingest-mutation-guard.mjs";
import {
  sanitizeBeginMessagePatch,
  sanitizeUidValidityPatch,
  sanitizeRecordIngestJobPatch,
} from "./iu-cj-affiliate-phase2-cj-email-d1-mailbox-mutation-guard.mjs";
import { resolveD1WorkerConfig } from "./iu-cj-affiliate-phase2-cj-email-d1-worker-client.mjs";
import { createCjEmailD1WorkerRemoteStore } from "./iu-cj-affiliate-phase2-cj-email-d1-worker-remote-store.mjs";

export function resolveD1Backend(options = {}, env = process.env) {
  if (options.backend) return options.backend;
  const workerCfg = resolveD1WorkerConfig({ ...env, ...(options.env || {}) });
  return workerCfg.backend === "worker" ? "worker" : "mock";
}

export const MESSAGE_STAGE = Object.freeze({
  none: "none",
  fetched: "fetched",
  raw_persisted: "raw_persisted",
  classified: "classified",
  ai_done: "ai_done",
  v15_done: "v15_done",
  completed: "completed",
  failed: "failed",
});

function createBlockedD1Store(reason = "production_d1_blocked_pending_approval") {
  const fail = () => ({ ok: false, reason, blocked: true });
  return {
    backend: "worker-blocked",
    acquireRunLease: fail,
    releaseRunLease: fail,
    getSyncCheckpoint: () => ({ completedUids: [], uidvalidity: null }),
    applyUidValidityChange: fail,
    isUidCompleted: () => false,
    getLifecycle: () => null,
    beginMessage: fail,
    transitionStage: fail,
    markFailed: fail,
    finalizeCompleted: fail,
    persistRawSnapshot: fail,
    persistResults: fail,
    recordIngestJob: fail,
    writeWithSimulatedFailure: fail,
    hashMessageContent,
    msgKey: (mailbox, uidvalidity, uid) => String(mailbox) + ":" + String(uidvalidity) + ":" + String(uid),
  };
}

export function createCjEmailD1Store(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const workerCfg = resolveD1WorkerConfig(env);
  const backend = resolveD1Backend(options, env);

  if (backend === "worker") {
    if (workerCfg.httpIntegrationTest || workerCfg.enabled) {
      try {
        return createCjEmailD1WorkerRemoteStore({ env, workerConfig: workerCfg });
      } catch (e) {
        return createBlockedD1Store(String(e?.message || "worker_remote_store_init_failed"));
      }
    }
    return createBlockedD1Store("d1_worker_backend_requires_enabled_or_http_integration_test");
  }
  if (backend === "cloudflare") {
    return createBlockedD1Store("production_d1_blocked_use_worker_backend");
  }

  const persistPath = options.persistPath || env.IU_CJ_D1_MOCK_PATH || env.IU_CJ_D1_CHECKPOINT_PATH || null;
  const mock = createMockD1Store(persistPath);
  if (!mock.data.sync_checkpoint) {
    mock.data.sync_checkpoint = {
      mailbox: null,
      folder: "INBOX",
      uidvalidity: null,
      completedUids: [],
    };
  }
  if (!mock.data.message_lifecycle) {
    mock.data.message_lifecycle = {};
  }
  if (!mock.data.sync_checkpoint.completedKeys) {
    mock.data.sync_checkpoint.completedKeys = [];
  }

  function mockLeaseHolder(runId) {
    const now = Date.now();
    const ttlMs = 900_000;
    const active = Object.values(mock.data.run_leases).find((l) => now - l.acquiredAt < ttlMs);
    if (!active) return { ok: false, reason: "finalize_lease_missing" };
    if (active.runId !== runId) return { ok: false, reason: "finalize_lease_holder_mismatch", holder: active.runId };
    return { ok: true };
  }

  function lifecycleRowForGuard(key) {
    const row = mock.data.message_lifecycle[key];
    if (!row) return null;
    const mm = mock.data.mailbox_messages[key];
    const raw = row.rawSnapshot ?? mm?.rawSnapshot ?? null;
    const results = row.resultsSummary ?? mm?.resultsSummary ?? null;
    return {
      ...row,
      msg_key: key,
      raw_snapshot_json: raw ? JSON.stringify(raw) : null,
      results_summary_json: results ? JSON.stringify(results) : null,
    };
  }

  function markCompletedKey(key, row) {
    const keys = mock.data.sync_checkpoint.completedKeys;
    if (!keys.includes(key)) keys.push(key);
    const uid = Number(row.uid);
    const completed = mock.data.sync_checkpoint.completedUids.map(Number);
    if (!completed.includes(uid)) mock.data.sync_checkpoint.completedUids.push(uid);
  }

  function msgKey(mailbox, uidvalidity, uid) {
    return String(mailbox) + ":" + String(uidvalidity) + ":" + String(uid);
  }

  function persist() {
    mock.persist();
  }

  return {
    backend: "mock",
    persistPath,
    acquireRunLease: (runId, ttlMs) => mock.acquireRunLease(runId, ttlMs),
    releaseRunLease: (runId) => mock.releaseRunLease(runId),
    recordIngestJob(job, patch = {}) {
      const sanitized = sanitizeRecordIngestJobPatch(job, patch);
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const lease = mapLeaseReasonToMutation(mockLeaseHolder(safe.runId), "record_ingest_job");
      if (!lease.ok) return lease;
      return mock.recordIngestJob({ ...job, runId: safe.runId });
    },

    getSyncCheckpoint() {
      return { ...mock.data.sync_checkpoint };
    },

    applyUidValidityChange(current, previous, patch = {}) {
      const sanitized = sanitizeUidValidityPatch(patch);
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const lease = mapLeaseReasonToMutation(mockLeaseHolder(safe.runId), "uidvalidity");
      if (!lease.ok) return lease;
      const storedUv = mock.data.sync_checkpoint.uidvalidity != null ? Number(mock.data.sync_checkpoint.uidvalidity) : null;
      const prev = previous != null ? Number(previous) : null;
      const cur = current != null ? Number(current) : null;
      if (safe.expectedPreviousUidvalidity != null) {
        const exp = Number(safe.expectedPreviousUidvalidity);
        if (storedUv != null && storedUv !== exp) {
          return { ok: false, reason: "uidvalidity_checkpoint_mismatch", stored: storedUv };
        }
      }
      if (cur != null && storedUv === cur) {
        return { ok: true, changed: false, reset: false, idempotent: true };
      }
      if (prev != null && cur != null && prev !== cur) {
        if (storedUv != null && storedUv !== prev) {
          return { ok: false, reason: "uidvalidity_stale_previous", stored: storedUv, previous: prev };
        }
        mock.data.sync_checkpoint = {
          ...mock.data.sync_checkpoint,
          uidvalidity: cur,
          completedUids: [],
          completedKeys: [],
          uidvalidityResetAt: new Date().toISOString(),
          previousUidvalidity: prev,
        };
        persist();
        return { ok: true, changed: true, reset: true };
      }
      if (cur != null) {
        mock.data.sync_checkpoint.uidvalidity = cur;
        persist();
      }
      return { ok: true, changed: false, reset: false };
    },

    isUidCompleted(uid, uidvalidity = null) {
      const mailbox = mock.data.sync_checkpoint.mailbox || "affiliate@infouzel.cz";
      if (uidvalidity != null) {
        const key = buildMessageKey(mailbox, uidvalidity, uid);
        return mock.data.sync_checkpoint.completedKeys.includes(key);
      }
      const cpUv = mock.data.sync_checkpoint.uidvalidity;
      if (cpUv != null) {
        const key = buildMessageKey(mailbox, cpUv, uid);
        return mock.data.sync_checkpoint.completedKeys.includes(key);
      }
      return mock.data.sync_checkpoint.completedUids.map(Number).includes(Number(uid));
    },

    getLifecycle(key) {
      return mock.data.message_lifecycle[key] || null;
    },

    beginMessage(record, patch = {}) {
      const sanitized = sanitizeBeginMessagePatch(patch);
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const lease = mapLeaseReasonToMutation(mockLeaseHolder(safe.runId), "begin_message");
      if (!lease.ok) return lease;
      const mailbox = record.mailbox || mock.data.sync_checkpoint.mailbox || "affiliate@infouzel.cz";
      const key = msgKey(mailbox, record.uidvalidity, record.uid);
      const existing = mock.data.message_lifecycle[key];
      if (existing?.stage === MESSAGE_STAGE.completed) {
        return { ok: true, duplicate: true, key, stage: MESSAGE_STAGE.completed };
      }
      if (existing && existing.stage !== MESSAGE_STAGE.failed) {
        mock.data.message_lifecycle[key] = {
          ...existing,
          contentHash: record.contentHash || existing.contentHash || null,
          updatedAt: new Date().toISOString(),
        };
        persist();
        return { ok: true, duplicate: false, idempotent: true, retry: false, key, stage: existing.stage };
      }
      const retry = existing?.stage === MESSAGE_STAGE.failed;
      mock.data.message_lifecycle[key] = {
        ...existing,
        key,
        mailbox,
        uidvalidity: record.uidvalidity,
        uid: record.uid,
        stage: MESSAGE_STAGE.fetched,
        contentHash: record.contentHash || null,
        startedAt: existing?.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishable: false,
        failReason: retry ? null : existing?.failReason || null,
      };
      persist();
      return { ok: true, duplicate: false, retry, key, stage: MESSAGE_STAGE.fetched };
    },

    transitionStage(key, nextStage, patch = {}) {
      const sanitized = sanitizeStageTransitionPatch(patch);
      if (!sanitized.ok) return sanitized;
      const safePatch = sanitized.patch;
      const row = mock.data.message_lifecycle[key];
      if (!row) return { ok: false, reason: "lifecycle_missing" };
      const evalOut = evaluateStageTransition(row.stage, nextStage);
      if (!evalOut.ok) return evalOut;
      const lease = mockLeaseHolder(safePatch.runId);
      if (!lease.ok) {
        if (lease.reason === "finalize_lease_missing") {
          return { ok: false, reason: "transition_lease_missing" };
        }
        if (lease.reason === "finalize_lease_holder_mismatch") {
          return { ok: false, reason: "transition_lease_holder_mismatch", holder: lease.holder };
        }
        return lease;
      }
      if (evalOut.idempotent) {
        return { ok: true, stage: nextStage, idempotent: true };
      }
      const { runId, ...restPatch } = safePatch;
      mock.data.message_lifecycle[key] = {
        ...row,
        ...restPatch,
        stage: nextStage,
        updatedAt: new Date().toISOString(),
      };
      persist();
      return { ok: true, stage: nextStage };
    },

    markFailed(key, reason, patch = {}) {
      const sanitized = sanitizeIngestMutationPatch(patch, { reasonPrefix: "mark_failed" });
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const row = mock.data.message_lifecycle[key];
      if (!row) return { ok: false, reason: "lifecycle_missing" };
      if (row.stage === MESSAGE_STAGE.completed) {
        return { ok: false, reason: "mark_failed_completed_blocked" };
      }
      if (row.stage === MESSAGE_STAGE.failed) {
        if (row.failReason === reason) {
          return { ok: true, stage: MESSAGE_STAGE.failed, idempotent: true };
        }
        return { ok: false, reason: "mark_failed_already_failed" };
      }
      const lease = mapLeaseReasonToMutation(mockLeaseHolder(safe.runId), "mark_failed");
      if (!lease.ok) return lease;
      if (safe.expectedUidvalidity != null && Number(safe.expectedUidvalidity) !== Number(row.uidvalidity)) {
        return { ok: false, reason: "mark_failed_uidvalidity_mismatch" };
      }
      mock.data.message_lifecycle[key] = {
        ...row,
        stage: MESSAGE_STAGE.failed,
        failReason: reason,
        publishable: false,
        updatedAt: new Date().toISOString(),
      };
      persist();
      return { ok: true, stage: MESSAGE_STAGE.failed };
    },

    finalizeCompleted(key, finalPatch = {}) {
      const sanitized = sanitizeFinalizePatch(finalPatch);
      if (!sanitized.ok) return sanitized;
      const patch = sanitized.patch;
      const guardRow = lifecycleRowForGuard(key);
      const pre = evaluateFinalizePreconditions(guardRow, patch);
      if (!pre.ok) return pre;
      const lease = mockLeaseHolder(patch.runId);
      if (!lease.ok) return lease;
      if (pre.repairOnly) {
        const mailbox = guardRow.mailbox;
        const uv = guardRow.uidvalidity;
        const uid = guardRow.uid;
        const ck = buildMessageKey(mailbox, uv, uid);
        if (mock.data.sync_checkpoint.completedKeys.includes(ck)) {
          return { ok: true, stage: MESSAGE_STAGE.completed, idempotent: true };
        }
        markCompletedKey(key, guardRow);
        persist();
        return { ok: true, stage: MESSAGE_STAGE.completed, repaired: true };
      }
      const row = mock.data.message_lifecycle[key];
      mock.data.message_lifecycle[key] = {
        ...row,
        stage: MESSAGE_STAGE.completed,
        publishable: false,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      markCompletedKey(key, row);
      mock.data.mailbox_messages[key] = {
        ...(mock.data.mailbox_messages[key] || {}),
        processingState: "completed",
        publishable: false,
      };
      persist();
      return { ok: true, stage: MESSAGE_STAGE.completed, uidvalidity: row.uidvalidity };
    },

    persistRawSnapshot(key, snapshot, patch = {}) {
      const sanitized = sanitizeIngestMutationPatch(patch, { reasonPrefix: "persist_raw" });
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const row = mock.data.message_lifecycle[key];
      if (!row) return { ok: false, reason: "lifecycle_missing" };
      if (row.stage === MESSAGE_STAGE.completed || row.stage === MESSAGE_STAGE.failed) {
        return { ok: false, reason: "persist_raw_stage_blocked" };
      }
      if (row.stage !== MESSAGE_STAGE.fetched) {
        return { ok: false, reason: "persist_raw_stage_blocked" };
      }
      if (safe.expectedUidvalidity != null && Number(safe.expectedUidvalidity) !== Number(row.uidvalidity)) {
        return { ok: false, reason: "persist_raw_uidvalidity_mismatch" };
      }
      const lease = mapLeaseReasonToMutation(mockLeaseHolder(safe.runId), "persist_raw");
      if (!lease.ok) return lease;
      mock.data.message_lifecycle[key] = {
        ...row,
        rawSnapshot: snapshot,
        updatedAt: new Date().toISOString(),
      };
      mock.data.mailbox_messages[key] = {
        ...(mock.data.mailbox_messages[key] || {}),
        rawSnapshot: snapshot,
        updatedAt: new Date().toISOString(),
      };
      persist();
      return { ok: true };
    },

    persistResults(key, results, patch = {}) {
      if (results?.publishable === true) {
        return { ok: false, reason: "persist_results_publishable_forbidden" };
      }
      const sanitized = sanitizeIngestMutationPatch(patch, { reasonPrefix: "persist_results" });
      if (!sanitized.ok) return sanitized;
      const safe = sanitized.patch;
      const row = mock.data.message_lifecycle[key];
      if (!row) return { ok: false, reason: "lifecycle_missing" };
      if (row.stage === MESSAGE_STAGE.completed || row.stage === MESSAGE_STAGE.failed) {
        return { ok: false, reason: "persist_results_stage_blocked" };
      }
      if (row.stage !== MESSAGE_STAGE.v15_done) {
        return { ok: false, reason: "persist_results_stage_blocked" };
      }
      if (safe.expectedUidvalidity != null && Number(safe.expectedUidvalidity) !== Number(row.uidvalidity)) {
        return { ok: false, reason: "persist_results_uidvalidity_mismatch" };
      }
      const lease = mapLeaseReasonToMutation(mockLeaseHolder(safe.runId), "persist_results");
      if (!lease.ok) return lease;
      const summary = {
        offersCount: results.offersCount ?? 0,
        aiState: results.aiState ?? null,
        v15Blockers: results.v15Blockers ?? 0,
        stagingState: results.stagingState ?? null,
      };
      mock.data.message_lifecycle[key] = {
        ...row,
        resultsSummary: summary,
        publishable: false,
        updatedAt: new Date().toISOString(),
      };
      mock.data.mailbox_messages[key] = {
        ...(mock.data.mailbox_messages[key] || {}),
        resultsSummary: summary,
        publishable: false,
        updatedAt: new Date().toISOString(),
      };
      persist();
      return { ok: true };
    },

    writeWithSimulatedFailure(shouldFail) {
      if (shouldFail) return { ok: false, reason: "d1_write_simulated_failure" };
      return { ok: true };
    },

    hashMessageContent,
    msgKey,
  };
}
