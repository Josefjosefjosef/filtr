/** Unattended CJ import cycle (offline-first): lock, audit, product feed guards, FORPSI mock ingest. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import { readCjCredentialSourceMeta } from "./iu-cj-affiliate-credentials-interface.mjs";
import { resolveLiveIngestGate } from "./iu-cj-affiliate-phase2-github-actions-ingest-live-gate.mjs";
import { runGithubActionsIngestCycle } from "./iu-cj-affiliate-phase2-github-actions-ingest-lib.mjs";
import { resolveOfflineIngestFixture } from "./iu-cj-affiliate-phase2-offline-ingest-fixtures.mjs";

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
  const liveGate = resolveLiveIngestGate(env);
  const credMeta = readCjCredentialSourceMeta();
  const liveUnattendedRequested = env.IU_CJ_LIVE_UNATTENDED_IMPORT === "1";
  return {
    offlineForced: liveGate.offlineForced,
    liveUnattendedRequested,
    liveIngestAllowed: liveGate.allowed,
    productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
    credentialMeta: credMeta,
    publishable: false,
    liveGateSummary: liveGate.gates,
  };
}

async function runForpsiEmailIngest(env, options) {
  const d1Path =
    options.d1PersistPath ||
    env.IU_CJ_D1_MOCK_PATH ||
    path.join(env.GITHUB_WORKSPACE || os.tmpdir(), "iu-cj-unattended-d1-checkpoint.json");
  const mockFixture = options.mockFixture ?? (env.IU_CJ_EMAIL_INGEST_OFFLINE === "1" ? resolveOfflineIngestFixture(env) : undefined);
  return runGithubActionsIngestCycle({
    env,
    d1PersistPath: d1Path,
    mockFixture,
    ...(options.ingestOptions || {}),
  });
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
    const skipEmail = env.IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST === "1";
    const wantEmail = env.IU_CJ_UNATTENDED_EMAIL_INGEST === "1" || options.runForpsiEmailIngest === true;
    const mayRunEmail = wantEmail && !skipEmail && (runtime.offlineForced || runtime.liveIngestAllowed);
    if (mayRunEmail) {
      ingestResult = await runForpsiEmailIngest(env, options);
      appendUnattendedAuditLog(auditPath, {
        event: "email_ingest",
        ok: ingestResult?.ok === true,
        phase: ingestResult?.phase || null,
        publishable: ingestResult?.publishable === true,
      });
      if (ingestResult?.publishable === true) {
        return { ok: false, phase: "email_ingest", reason: "unexpected_publishable_true", publishable: true, auditPath };
      }
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
