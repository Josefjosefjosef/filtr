/**
 * Admin audit trail read endpoints (Etapa 2, kap. 23).
 * Visible to main_admin and read_only (see rbac.ts). Never returns raw secrets —
 * entries are already redacted at write time by audit.ts.
 */
import { requireAdminSession, json } from "./admin-auth";
import { hasPermission } from "./rbac";
import type { Env } from "./types";

type AuditLogRow = {
  audit_id: string;
  created_at: string;
  actor_user_id: string | null;
  operation: string;
  object_type: string;
  object_id: string;
  before_json: string | null;
  after_json: string | null;
  result: string;
};

async function requireAuditPermission(
  request: Request,
  env: Env
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return { ok: false, response: json({ error: session.error }, session.status) };
  if (!hasPermission(session.context.roles, "audit.read")) {
    return { ok: false, response: json({ error: "forbidden" }, 403) };
  }
  return { ok: true };
}

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.floor(n));
}

function clampOffset(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function handleListAuditLogs(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAuditPermission(request, env);
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const objectType = url.searchParams.get("object_type");
  const objectId = url.searchParams.get("object_id");
  const actorUserId = url.searchParams.get("actor_user_id");
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (objectType) {
    conditions.push("object_type = ?");
    params.push(objectType);
  }
  if (objectId) {
    conditions.push("object_id = ?");
    params.push(objectId);
  }
  if (actorUserId) {
    conditions.push("actor_user_id = ?");
    params.push(actorUserId);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const sql =
    "SELECT audit_id, created_at, actor_user_id, operation, object_type, object_id, before_json, after_json, result FROM audit_logs " +
    where +
    " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const res = await env.DB.prepare(sql)
    .bind(...params)
    .all<AuditLogRow>();
  return json({ entries: res.results || [], limit, offset });
}

export async function handleGetAuditLog(request: Request, env: Env, auditId: string): Promise<Response> {
  const guard = await requireAuditPermission(request, env);
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare(
    "SELECT audit_id, created_at, actor_user_id, operation, object_type, object_id, before_json, after_json, result FROM audit_logs WHERE audit_id = ?"
  )
    .bind(auditId)
    .first<AuditLogRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ entry: row });
}
