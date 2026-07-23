/**
 * Admin export-job endpoints (Etapa 3, kap. 24). RBAC: exports.read/exports.write (sales/main_admin).
 * Only the job row is created here — the actual heavy PDF/CSV/JSON generation (kap. 38.x export
 * formats) is deferred to a later etapa; jobs are created with status "queued" as a stub.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

export const EXPORT_SCOPE_TYPES = ["client", "campaign", "invoices", "audit"] as const;
export type ExportScopeType = (typeof EXPORT_SCOPE_TYPES)[number];

function isExportScopeType(value: unknown): value is ExportScopeType {
  return typeof value === "string" && (EXPORT_SCOPE_TYPES as readonly string[]).includes(value);
}

type ExportJobRow = {
  export_id: string;
  requested_by: string;
  scope_type: string;
  scope_id: string | null;
  period_from: string | null;
  period_to: string | null;
  status: string;
  r2_key: string | null;
  created_at: string;
  completed_at: string | null;
};

const EXPORT_COLUMNS =
  "export_id, requested_by, scope_type, scope_id, period_from, period_to, status, r2_key, created_at, completed_at";

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

export async function handleListExportJobs(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "exports.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const status = url.searchParams.get("status");
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const where = status ? "WHERE status = ?" : "";
  const params: unknown[] = status ? [status, limit, offset] : [limit, offset];

  const res = await env.DB.prepare(
    "SELECT " + EXPORT_COLUMNS + " FROM export_jobs " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<ExportJobRow>();
  return json({ exports: res.results || [], limit, offset });
}

export async function handleCreateExportJob(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "exports.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { scope_type?: unknown; scope_id?: unknown; period_from?: unknown; period_to?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!isExportScopeType(body.scope_type)) return json({ error: "invalid_scope_type" }, 400);

  const nowIso = new Date().toISOString();
  const exportId = newId("exp");
  await env.DB.prepare(
    "INSERT INTO export_jobs (export_id, requested_by, scope_type, scope_id, period_from, period_to, status, r2_key, created_at, completed_at) VALUES (?,?,?,?,?,?,'queued',NULL,?,NULL)"
  )
    .bind(
      exportId,
      guard.userId,
      body.scope_type,
      typeof body.scope_id === "string" ? body.scope_id : null,
      typeof body.period_from === "string" ? body.period_from : null,
      typeof body.period_to === "string" ? body.period_to : null,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "export_requested",
      objectType: "export_job",
      objectId: exportId,
      after: { scope_type: body.scope_type, scope_id: body.scope_id ?? null },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + EXPORT_COLUMNS + " FROM export_jobs WHERE export_id = ?")
    .bind(exportId)
    .first<ExportJobRow>();
  return json({ export: row }, 201);
}

export async function handleGetExportJob(request: Request, env: Env, exportId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "exports.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + EXPORT_COLUMNS + " FROM export_jobs WHERE export_id = ?")
    .bind(exportId)
    .first<ExportJobRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ export: row });
}
