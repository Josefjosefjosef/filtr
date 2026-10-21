/**

 * GitHub Actions → Cloudflare Worker → D1 (authenticated RPC).

 * No in-process mock fallback when worker backend is selected.

 */

import { createHash, timingSafeEqual } from "node:crypto";

import { D1_WORKER_RPC_OPS } from "./iu-cj-affiliate-phase2-cj-email-d1-rpc-ops.mjs";



export { D1_WORKER_RPC_OPS };



export function resolveD1WorkerConfig(env = process.env) {

  const httpIntegrationTest = env.IU_CJ_D1_WORKER_HTTP_INTEGRATION_TEST === "1";

  const enabled =

    env.IU_CJ_D1_WORKER_ENABLED === "1" &&

    env.IU_CJ_EMAIL_INGEST_OFFLINE !== "1" &&

    env.IU_CJ_GITHUB_INGEST_DRY_RUN !== "1";

  return {

    backend: env.IU_CJ_D1_BACKEND === "worker" ? "worker" : "mock",

    httpIntegrationTest,

    enabled,

    baseUrl: String(env.IU_CJ_D1_WORKER_URL || "").replace(/\/$/, ""),

    ingestToken: env.IU_CJ_D1_WORKER_INGEST_TOKEN || null,

  };

}



function redactToken(value) {

  if (!value) return null;

  const s = String(value);

  if (s.length < 8) return "[redacted]";

  return s.slice(0, 4) + "…" + s.slice(-4);

}



export function buildWorkerAuthHeaders(config) {

  if (!config.ingestToken) return null;

  return {

    Authorization: "Bearer " + config.ingestToken,

    "Content-Type": "application/json",

    "X-IU-CJ-Ingest-Client": "github-actions-ingest-v7",

  };

}



export function validateIngestTokenFormat(token) {

  const t = String(token || "").trim();

  if (!t) return { ok: false, reason: "missing_token" };

  if (t.length < 32) return { ok: false, reason: "token_too_short" };

  if (/[\s\u0000-\u001F]/.test(t)) return { ok: false, reason: "token_invalid_chars" };

  return { ok: true };

}



export async function invokeD1WorkerRpc(config, op, args = {}) {

  if (!D1_WORKER_RPC_OPS.includes(op)) {

    return { ok: false, reason: "unknown_rpc_op", op };

  }

  const mayHttp = config.httpIntegrationTest || config.enabled;

  if (!mayHttp) {

    return { ok: false, reason: "production_d1_worker_blocked_pending_approval", blocked: true };

  }

  const headers = buildWorkerAuthHeaders(config);

  const tokenCheck = validateIngestTokenFormat(config.ingestToken);

  if (!headers || !tokenCheck.ok) {

    return { ok: false, reason: "d1_worker_auth_misconfigured", detail: tokenCheck.reason, blocked: true };

  }

  if (!config.baseUrl) {

    return { ok: false, reason: "d1_worker_url_missing", blocked: true };

  }

  const url = config.baseUrl + "/v1/ingest/rpc";

  const body = JSON.stringify({ op, args, clientRunId: args.runId || null });

  try {

    const res = await fetch(url, { method: "POST", headers, body });

    const text = await res.text();

    let json;

    try {

      json = JSON.parse(text);

    } catch {

      return { ok: false, reason: "d1_worker_invalid_json", status: res.status };

    }

    if (!res.ok || !json.ok) {

      return { ok: false, ...json, status: res.status, reason: json.reason || "d1_worker_http_error" };

    }

    return json;

  } catch (e) {

    return { ok: false, reason: "d1_worker_network_error", safe: String(e?.message || "network").slice(0, 80) };

  }

}



export function describeD1WorkerSecurity() {

  return {

    publicUnauthenticatedEndpoints: "FORBIDDEN",

    auth: "Bearer IU_CJ_D1_WORKER_INGEST_TOKEN (Worker secret, rotatable)",

    silentMockFallbackOnWorkerBackend: "FORBIDDEN",

    tokenNeverInLogs: true,

    tokenRedactionExample: redactToken("example-token-value-32chars-min"),

    productionWrites: "BLOCKED until IU_CJ_D1_WORKER_ENABLED=1 and approval",

  };

}



export function verifyWorkerRequestSignature(headers, body, expectedToken) {

  void body;

  const auth = headers?.authorization || headers?.Authorization || "";

  const m = /^Bearer\s+(.+)$/i.exec(String(auth));

  if (!m) return { ok: false, reason: "missing_bearer" };

  const a = Buffer.from(m[1].trim());

  const b = Buffer.from(String(expectedToken || "").trim());

  if (a.length !== b.length) return { ok: false, reason: "token_mismatch" };

  try {

    return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "token_mismatch" };

  } catch {

    return { ok: false, reason: "token_compare_failed" };

  }

}



export function hashIngestAuditId(payload) {

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);

}


