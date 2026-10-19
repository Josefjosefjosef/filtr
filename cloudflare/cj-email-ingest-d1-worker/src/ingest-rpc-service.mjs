/** Shared ingest RPC execution (Cloudflare Worker + local HTTP test server). */
import { timingSafeEqual } from "node:crypto";
import { D1_WORKER_RPC_OPS } from "./ingest-rpc-ops.mjs";

export const CJ_EMAIL_D1_RPC_VERSION = 1;
export const MAX_RPC_BODY_BYTES = 65536;

export function verifyBearerToken(request, expectedToken) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return { ok: false, reason: "missing_bearer", status: 401 };
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(String(expectedToken || "").trim());
  if (!expectedToken || a.length !== b.length) return { ok: false, reason: "token_mismatch", status: 403 };
  try {
    return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "token_mismatch", status: 403 };
  } catch {
    return { ok: false, reason: "token_compare_failed", status: 403 };
  }
}

export async function executeIngestRpc(api, op, args, rpcOps = D1_WORKER_RPC_OPS) {
  const allowed = rpcOps || D1_WORKER_RPC_OPS;
  if (!allowed.includes(op)) {
    return { ok: false, reason: "unknown_rpc_op", rpcVersion: CJ_EMAIL_D1_RPC_VERSION };
  }
  if (!api || typeof api[op] !== "function") {
    return { ok: false, reason: "op_not_implemented", op, rpcVersion: CJ_EMAIL_D1_RPC_VERSION };
  }
  try {
    const normalized = Array.isArray(args) ? args : [args];
    const result = api[op](...normalized);
    const resolved = result && typeof result.then === "function" ? await result : result;
    return { ok: true, result: resolved, rpcVersion: CJ_EMAIL_D1_RPC_VERSION };
  } catch (e) {
    return { ok: false, reason: "rpc_execution_error", safe: String(e?.message || "error").slice(0, 120), rpcVersion: CJ_EMAIL_D1_RPC_VERSION };
  }
}

export async function handleIngestRpcHttpRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/ingest/rpc") {
    return jsonResponse({ ok: false, reason: "not_found" }, 404);
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, reason: "method_not_allowed" }, 405);
  }
  const token = env.IU_CJ_D1_WORKER_INGEST_TOKEN;
  const auth = verifyBearerToken(request, token);
  if (!auth.ok) {
    return jsonResponse({ ok: false, reason: auth.reason, rpcVersion: CJ_EMAIL_D1_RPC_VERSION }, auth.status);
  }
  const raw = await request.text();
  if (raw.length > MAX_RPC_BODY_BYTES) {
    return jsonResponse({ ok: false, reason: "body_too_large", rpcVersion: CJ_EMAIL_D1_RPC_VERSION }, 413);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, reason: "invalid_json", rpcVersion: CJ_EMAIL_D1_RPC_VERSION }, 400);
  }
  const op = body?.op;
  const args = body?.args ?? {};
  if (typeof op !== "string") {
    return jsonResponse({ ok: false, reason: "missing_op", rpcVersion: CJ_EMAIL_D1_RPC_VERSION }, 400);
  }
  const api = env._ingestApi || env.ingestApi;
  if (!api) {
    return jsonResponse({ ok: false, reason: "ingest_api_unavailable", rpcVersion: CJ_EMAIL_D1_RPC_VERSION }, 503);
  }
  const rpcOps = env.rpcOps || D1_WORKER_RPC_OPS;
  const out = await executeIngestRpc(api, op, args, rpcOps);
  const status = out.ok ? 200 : 400;
  return jsonResponse(out, status);
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
