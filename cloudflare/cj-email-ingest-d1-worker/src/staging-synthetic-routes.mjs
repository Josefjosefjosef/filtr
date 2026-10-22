/** Token-gated staging-only probes (synthetic data). No live ingest. */
import { verifyBearerToken, jsonResponse } from "./ingest-rpc-service.mjs";
import {
  buildStagingCjApiReadiness,
  resolveStagingCjArchiveGate,
} from "./staging-cj-api-archive-gate.mjs";
import { executeStagingCjLinkSearchProbe } from "./staging-cj-api-probe-execute.mjs";

export function stagingSyntheticEnabled(env) {
  return env?.IU_CJ_STAGING_ONLY === "1" && env?.ENVIRONMENT === "staging";
}

export async function handleStagingSyntheticRequest(request, env) {
  if (!stagingSyntheticEnabled(env)) {
    return jsonResponse({ ok: false, reason: "staging_routes_disabled", publishable: false }, 404);
  }
  const url = new URL(request.url);
  const auth = verifyBearerToken(request, env.IU_CJ_D1_WORKER_INGEST_TOKEN);
  if (!auth.ok) {
    return jsonResponse({ ok: false, reason: auth.reason, publishable: false }, auth.status);
  }

  if (url.pathname === "/v1/staging/d1-write-probe" && request.method === "POST") {
    if (!env.DB) {
      return jsonResponse({ ok: false, reason: "d1_binding_missing", publishable: false }, 503);
    }
    const mailbox = "synthetic-staging-mailbox";
    const uid = Math.floor(Date.now() % 2000000000);
    try {
      await env.DB.prepare(
        "INSERT INTO completed_uids (mailbox, folder, uidvalidity, uid, completed_at) VALUES (?, 'INBOX', 1, ?, ?)"
      )
        .bind(mailbox, uid, new Date().toISOString())
        .run();
      const row = await env.DB.prepare(
        "SELECT uid FROM completed_uids WHERE mailbox = ? AND uid = ? LIMIT 1"
      )
        .bind(mailbox, uid)
        .first();
      await env.DB.prepare("DELETE FROM completed_uids WHERE mailbox = ? AND uid = ?")
        .bind(mailbox, uid)
        .run();
      return jsonResponse({
        ok: row?.uid === uid,
        phase: "d1_write_probe",
        publishable: false,
      });
    } catch (e) {
      return jsonResponse({
        ok: false,
        reason: "d1_write_probe_failed",
        safe: String(e?.message || "error").slice(0, 80),
        publishable: false,
      }, 500);
    }
  }

  if (url.pathname === "/v1/staging/d1-ping" && request.method === "GET") {
    if (!env.DB) {
      return jsonResponse({ ok: false, reason: "d1_binding_missing", publishable: false }, 503);
    }
    try {
      const row = await env.DB.prepare("SELECT 1 AS v").first();
      return jsonResponse({
        ok: row?.v === 1,
        phase: "d1_ping",
        publishable: false,
      });
    } catch (e) {
      return jsonResponse({
        ok: false,
        reason: "d1_ping_failed",
        safe: String(e?.message || "error").slice(0, 80),
        publishable: false,
      }, 500);
    }
  }

  if (url.pathname === "/v1/staging/r2-probe" && request.method === "POST") {
    if (!env.BANNER_ASSETS) {
      return jsonResponse({ ok: false, reason: "r2_binding_missing", publishable: false }, 503);
    }
    const key = `synthetic/probe-${Date.now()}.txt`;
    const payload = "iu-cj-staging-synthetic-v1";
    try {
      await env.BANNER_ASSETS.put(key, payload, {
        httpMetadata: { contentType: "text/plain" },
        customMetadata: { synthetic: "true", publishable: "false" },
      });
      const head = await env.BANNER_ASSETS.head(key);
      const obj = await env.BANNER_ASSETS.get(key);
      const text = obj ? await obj.text() : "";
      await env.BANNER_ASSETS.delete(key);
      const ok = text === payload && Number(head?.size) === payload.length;
      return jsonResponse({
        ok,
        phase: "r2_probe",
        deleted: true,
        publishable: false,
      }, ok ? 200 : 500);
    } catch (e) {
      return jsonResponse({
        ok: false,
        reason: "r2_probe_failed",
        safe: String(e?.message || "error").slice(0, 80),
        publishable: false,
      }, 500);
    }
  }

  if (url.pathname === "/v1/staging/ingest-blocked" && request.method === "POST") {
    return jsonResponse({
      ok: true,
      phase: "ingest_gate",
      liveIngestAllowed: false,
      publishable: false,
      reason: "staging_default_deny",
    });
  }

  if (url.pathname === "/v1/staging/cj-api/readiness" && request.method === "GET") {
    return jsonResponse(buildStagingCjApiReadiness(env));
  }

  if (url.pathname === "/v1/staging/cj-api/probe" && request.method === "POST") {
    const probe = await executeStagingCjLinkSearchProbe(env);
    if (probe.blocked) {
      return jsonResponse(
        {
          ok: false,
          blocked: true,
          phase: "cj_api_probe",
          reason: probe.reason,
          publishable: false,
          httpRequestCount: probe.httpRequestCount ?? 0,
        },
        probe.status || 403
      );
    }
    const status = probe.ok ? 200 : 422;
    return jsonResponse(probe, status);
  }

  return jsonResponse({ ok: false, reason: "not_found", publishable: false }, 404);
}

export function buildHealthPayload(env) {
  const d1Bound = Boolean(env.DB);
  const r2Bound = Boolean(env.BANNER_ASSETS);
  const tokenConfigured = Boolean(String(env.IU_CJ_D1_WORKER_INGEST_TOKEN || "").trim());
  const archiveGate = resolveStagingCjArchiveGate(env);
  return {
    ok: d1Bound,
    service: "cj-email-ingest-d1-worker",
    rpcVersion: 1,
    environment: env.ENVIRONMENT || null,
    stagingOnly: env.IU_CJ_STAGING_ONLY === "1",
    cjArchiveOnly: archiveGate.archiveOnly,
    cjPatConfigured: archiveGate.hasPatSecret,
    cjLiveApiRequestsAllowed: archiveGate.mayExecuteHttp,
    d1Binding: d1Bound ? "present" : "missing",
    r2Binding: r2Bound ? "present" : "missing",
    ingestTokenConfigured: tokenConfigured,
    memoryMock: false,
    publishable: false,
  };
}
