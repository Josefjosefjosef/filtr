/** Unattended CJ import cycle (offline-first): lock, audit log, auth/zero-feed guards, optional email ingest. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

export function defaultUnattendedStateDir(env = process.env) {
  return env.IU_CJ_UNATTENDED_STATE_DIR || path.join(os.tmpdir(), "iu-cj-unattended-import");
}

export function defaultUnattendedLockPath(stateDir) {
  return path.join(stateDir, "unattended-import.lock");
}

export function defaultUnattendedAuditPath(stateDir) {
  return path.join(stateDir, "unattended-import-audit.jsonl");
}

export function acquireUnattendedImportLock(lockPath, ownerId, maxAgeMs = 3600_000) {
  const now = Date.now();
  if (fs.existsSync(lockPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (existing.ownerId !== ownerId && now - existing.acquiredAt < maxAgeMs) {
        return { ok: false, reason: "sync_lock_held", holder: existing.ownerId };
      }
    } catch {
      return { ok: false, reason: "sync_lock_corrupt" };
    }
  }
  const payload = { ownerId, acquiredAt: now };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(payload), "utf8");
  return { ok: true };
}

export function releaseUnattendedImportLock(lockPath, ownerId) {
  if (!fs.existsSync(lockPath)) return { ok: true };
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (existing.ownerId !== ownerId) return { ok: false, reason: "not_lock_owner" };
    fs.unlinkSync(lockPath);
    return { ok: true };
  } catch {
    return { ok: false, reason: "lock_release_failed" };
  }
}

export function classifyProductFeedHttpStatus(status) {
  const code = Number(status);
  if (code === 401) return { ok: false, reason: "cj_api_unauthorized", stopRun: true, httpStatus: code };
  if (code === 403) return { ok: false, reason: "cj_api_forbidden", stopRun: true, httpStatus: code };
  if (code >= 500) return { ok: false, reason: "cj_api_server_error", stopRun: false, retry: true, httpStatus: code };
  if (code >= 400) return { ok: false, reason: "cj_api_client_error", stopRun: true, httpStatus: code };
  return { ok: true, httpStatus: code };
}

export function classifyNetworkFailure(err) {
  const code = String(err?.code || err?.cause?.code || "");
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND") {
    return { ok: false, reason: "network_failure", retry: true, code };
  }
  return { ok: false, reason: "unexpected_error", retry: false, message: String(err?.message || err) };
}

export function evaluateZeroProductResult(total) {
  const n = Number(total);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: "invalid_product_total" };
  if (n === 0) return { ok: true, reason: "zero_products_observed", emptyFeed: true };
  return { ok: true, emptyFeed: false, reason: "products_present" };
}

export function appendUnattendedAuditLog(logPath, entry) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  fs.appendFileSync(logPath, line, "utf8");
}

export function resolveUnattendedImportRuntime(env = process.env) {
  const offlineForced =
    env.IU_CJ_UNATTENDED_IMPORT_OFFLINE !== "0" ||
    env.IU_CJ_EMAIL_INGEST_OFFLINE === "1" ||
    env.IU_CJ_GITHUB_INGEST_DRY_RUN === "1";
  const liveUnattendedRequested = env.IU_CJ_LIVE_UNATTENDED_IMPORT === "1";
  const liveIngestAllowed =
    !offlineForced &&
    env.IU_CJ_LIVE_INGEST_APPROVED === "1" &&
    env.IU_FORPSI_IMAP_CONNECT_APPROVED === "1" &&
    Boolean(String(env.IU_FORPSI_IMAP_USER || "").trim()) &&
    env.IU_CJ_D1_BACKEND === "worker";
  return {
    offlineForced,
    liveUnattendedRequested,
    liveIngestAllowed,
    productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
    credentialMeta: {
      source: String(env.IU_CJ_CREDENTIAL_SOURCE || "process_env"),
      hasPat: Boolean(String(env.IU_CJ_PAT || env.CJ_PERSONAL_ACCESS_TOKEN || "").trim()),
    },
    publishable: false,
  };
}

async function maybeRunEmailIngest(env, options) {
  if (env.IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST === "1" || env.IU_CJ_UNATTENDED_EMAIL_INGEST !== "1") {
    return null;
  }
  try {
    const { runGithubActionsIngestCycle } = await import("./iu-cj-affiliate-phase2-github-actions-ingest-lib.mjs");
    return await runGithubActionsIngestCycle({
      env,
      d1PersistPath: options.d1PersistPath,
      mockFixture: options.mockFixture,
      ...(options.ingestOptions || {}),
    });
  } catch (err) {
    return { ok: false, phase: "email_ingest", reason: "ingest_module_unavailable", detail: String(err?.message || err) };
  }
}

export async function runUnattendedImportCycle(options = {}) {
  const env = options.env || process.env;
  const stateDir = options.stateDir || defaultUnattendedStateDir(env);
  const lockPath = options.lockPath || defaultUnattendedLockPath(stateDir);
  const auditPath = options.auditPath || defaultUnattendedAuditPath(stateDir);
  const ownerId = options.ownerId || "unattended-" + process.pid + "-" + Date.now();
  const runtime = resolveUnattendedImportRuntime(env);

  const lock = acquireUnattendedImportLock(lockPath, ownerId, options.lockMaxAgeMs);
  if (!lock.ok) {
    return { ok: false, phase: "lock", publishable: false, ...lock };
  }

  try {
    appendUnattendedAuditLog(auditPath, {
      event: "run_start",
      ownerId,
      offline: runtime.offlineForced,
      credSource: runtime.credentialMeta.source,
      hasPat: runtime.credentialMeta.hasPat,
      productionSigningEnabled: runtime.productionSigningEnabled,
    });

    if (runtime.liveUnattendedRequested && !runtime.liveIngestAllowed) {
      appendUnattendedAuditLog(auditPath, { event: "live_gate_blocked", liveUnattendedRequested: true });
      return {
        ok: false,
        phase: "live_gate",
        reason: "live_unattended_not_allowed",
        publishable: false,
        auditPath,
      };
    }

    if (options.mockProductFeedResponse != null) {
      const status = options.mockProductFeedResponse.status ?? 200;
      const total = options.mockProductFeedResponse.total ?? 0;
      const httpClass = classifyProductFeedHttpStatus(status);
      if (!httpClass.ok) {
        appendUnattendedAuditLog(auditPath, {
          event: "product_feed_http_fail",
          status,
          reason: httpClass.reason,
        });
        return { ok: false, phase: "product_feed", publishable: false, auditPath, ...httpClass };
      }
      const zeroEval = evaluateZeroProductResult(total);
      if (!zeroEval.ok) {
        appendUnattendedAuditLog(auditPath, { event: "product_feed_invalid_total", total });
        return { ok: false, phase: "product_feed", publishable: false, auditPath, ...zeroEval };
      }
      appendUnattendedAuditLog(auditPath, {
        event: "product_feed_probe",
        total,
        emptyFeed: zeroEval.emptyFeed === true,
      });
    }

    let ingestResult = null;
    const mayRunEmail =
      env.IU_CJ_UNATTENDED_EMAIL_INGEST === "1" &&
      (runtime.offlineForced || options.forceOfflineIngest === true || runtime.liveIngestAllowed);
    if (mayRunEmail) {
      ingestResult = await maybeRunEmailIngest(env, options);
      appendUnattendedAuditLog(auditPath, {
        event: "email_ingest",
        ok: ingestResult?.ok === true,
        phase: ingestResult?.phase || null,
        publishable: ingestResult?.publishable === true,
      });
      if (ingestResult && !ingestResult.ok) {
        return { ok: false, publishable: false, auditPath, ...ingestResult };
      }
    }

    appendUnattendedAuditLog(auditPath, { event: "run_complete", publishable: false });
    return {
      ok: true,
      phase: "complete",
      publishable: false,
      ingestResult,
      auditPath,
      productionSigningEnabled: runtime.productionSigningEnabled,
    };
  } finally {
    releaseUnattendedImportLock(lockPath, ownerId);
  }
}
