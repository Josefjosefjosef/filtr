/** D1 store facade over HTTP RPC — never falls back to local JSON mock. */
import { hashMessageContent } from "./iu-cj-affiliate-phase2-cj-email-d1-mock.mjs";
import { invokeD1WorkerRpc, resolveD1WorkerConfig } from "./iu-cj-affiliate-phase2-cj-email-d1-worker-client.mjs";

async function rpc(config, op, args) {
  const res = await invokeD1WorkerRpc(config, op, args);
  if (!res.ok) {
    const err = new Error(res.reason || "d1_rpc_failed");
    err.d1Rpc = res;
    throw err;
  }
  return res.result;
}

export function createCjEmailD1WorkerRemoteStore(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const config = resolveD1WorkerConfig(env);
  if (!config.baseUrl) {
    throw new Error("worker_remote_store_missing_url");
  }
  if (!config.httpIntegrationTest && !config.enabled) {
    throw new Error("worker_remote_store_blocked");
  }

  const label = config.httpIntegrationTest ? "worker-http-test" : "worker-http";

  async function call(op, args) {
    return rpc({ ...config, ...options.workerConfig }, op, args);
  }

  return {
    backend: label,
    async acquireRunLease(runId, ttlMs) {
      return call("acquireRunLease", [runId, ttlMs]);
    },
    async releaseRunLease(runId) {
      return call("releaseRunLease", [runId]);
    },
    async recordIngestJob(job, patch = {}) {
      return call("recordIngestJob", [job, patch]);
    },
    async getSyncCheckpoint() {
      return call("getSyncCheckpoint", []);
    },
    async applyUidValidityChange(current, previous, patch = {}) {
      return call("applyUidValidityChange", [current, previous, patch]);
    },
    async isUidCompleted(uid, uidvalidity = null) {
      return uidvalidity != null ? call("isUidCompleted", [uid, uidvalidity]) : call("isUidCompleted", [uid]);
    },
    async getLifecycle(key) {
      return call("getLifecycle", [key]);
    },
    async beginMessage(record, patch = {}) {
      return call("beginMessage", [record, patch]);
    },
    async transitionStage(key, nextStage, patch = {}) {
      return call("transitionStage", [key, nextStage, patch]);
    },
    async markFailed(key, reason, patch = {}) {
      return call("markFailed", [key, reason, patch]);
    },
    async finalizeCompleted(key, finalPatch = {}) {
      return call("finalizeCompleted", [key, finalPatch]);
    },
    async persistRawSnapshot(key, snapshot, patch = {}) {
      return call("persistRawSnapshot", [key, snapshot, patch]);
    },
    async persistResults(key, results, patch = {}) {
      return call("persistResults", [key, results, patch]);
    },
    writeWithSimulatedFailure(shouldFail) {
      if (shouldFail) return { ok: false, reason: "d1_write_simulated_failure" };
      return { ok: true };
    },
    hashMessageContent,
    msgKey(mailbox, uidvalidity, uid) {
      return String(mailbox) + ":" + String(uidvalidity) + ":" + String(uid);
    },
  };
}
