/** Token-gated staging-only probes (synthetic data). No live ingest. */
import { verifyBearerToken, jsonResponse } from "./ingest-rpc-service.mjs";

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

  return jsonResponse({ ok: false, reason: "not_found", publishable: false }, 404);
}

export function buildHealthPayload(env) {
  const d1Bound = Boolean(env.DB);
  const r2Bound = Boolean(env.BANNER_ASSETS);
  const tokenConfigured = Boolean(String(env.IU_CJ_D1_WORKER_INGEST_TOKEN || "").trim());
  return {
    ok: d1Bound,
    service: "cj-email-ingest-d1-worker",
    rpcVersion: 1,
    environment: env.ENVIRONMENT || null,
    stagingOnly: env.IU_CJ_STAGING_ONLY === "1",
    d1Binding: d1Bound ? "present" : "missing",
    r2Binding: r2Bound ? "present" : "missing",
    ingestTokenConfigured: tokenConfigured,
    memoryMock: false,
    publishable: false,
  };
}
