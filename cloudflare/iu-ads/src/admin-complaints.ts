/**
 * Admin complaints endpoints (Etapa 3, kap. 31). RBAC: complaints.read/complaints.write (sales/main_admin).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

export const COMPLAINT_STATUSES = ["new", "investigating", "resolved", "rejected", "closed"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

function isComplaintStatus(value: unknown): value is ComplaintStatus {
  return typeof value === "string" && (COMPLAINT_STATUSES as readonly string[]).includes(value);
}

type ComplaintRow = {
  complaint_id: string;
  client_id: string;
  campaign_id: string | null;
  status: string;
  reported_at: string;
  description: string;
  impact: string | null;
  remedy: string | null;
  compensation: string | null;
  assignee_user_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

const COMPLAINT_COLUMNS =
  "complaint_id, client_id, campaign_id, status, reported_at, description, impact, remedy, compensation, assignee_user_id, closed_at, created_at, updated_at";

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

export async function handleListComplaints(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "complaints.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("client_id");
  const campaignId = url.searchParams.get("campaign_id");
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (clientId) {
    conditions.push("client_id = ?");
    params.push(clientId);
  }
  if (campaignId) {
    conditions.push("campaign_id = ?");
    params.push(campaignId);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit, offset);

  const res = await env.DB.prepare(
    "SELECT " + COMPLAINT_COLUMNS + " FROM complaints " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<ComplaintRow>();
  return json({ complaints: res.results || [], limit, offset });
}

export async function handleCreateComplaint(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "complaints.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { client_id?: unknown; campaign_id?: unknown; description?: unknown; impact?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!clientId) return json({ error: "invalid_client_id" }, 400);
  if (!description) return json({ error: "invalid_description" }, 400);
  const clientRow = await env.DB.prepare("SELECT client_id FROM clients WHERE client_id = ?").bind(clientId).first();
  if (!clientRow) return json({ error: "client_not_found" }, 400);

  const nowIso = new Date().toISOString();
  const complaintId = newId("cmp");
  await env.DB.prepare(
    "INSERT INTO complaints (complaint_id, client_id, campaign_id, status, reported_at, description, impact, remedy, compensation, assignee_user_id, closed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?)"
  )
    .bind(
      complaintId,
      clientId,
      typeof body.campaign_id === "string" ? body.campaign_id : null,
      "new",
      nowIso,
      description,
      typeof body.impact === "string" ? body.impact : null,
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "complaint_created",
      objectType: "complaint",
      objectId: complaintId,
      after: { client_id: clientId, status: "new" },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + COMPLAINT_COLUMNS + " FROM complaints WHERE complaint_id = ?")
    .bind(complaintId)
    .first<ComplaintRow>();
  return json({ complaint: row }, 201);
}

export async function handleGetComplaint(request: Request, env: Env, complaintId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "complaints.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + COMPLAINT_COLUMNS + " FROM complaints WHERE complaint_id = ?")
    .bind(complaintId)
    .first<ComplaintRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ complaint: row });
}

export async function handleUpdateComplaint(request: Request, env: Env, complaintId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "complaints.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + COMPLAINT_COLUMNS + " FROM complaints WHERE complaint_id = ?")
    .bind(complaintId)
    .first<ComplaintRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: { status?: unknown; remedy?: unknown; compensation?: unknown; assignee_user_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.status !== undefined && !isComplaintStatus(body.status)) return json({ error: "invalid_status" }, 400);

  const status = isComplaintStatus(body.status) ? body.status : before.status;
  const remedy = typeof body.remedy === "string" ? body.remedy : before.remedy;
  const compensation = typeof body.compensation === "string" ? body.compensation : before.compensation;
  const assigneeUserId = typeof body.assignee_user_id === "string" ? body.assignee_user_id : before.assignee_user_id;
  const nowIso = new Date().toISOString();
  const closedAt = status === "closed" || status === "resolved" || status === "rejected" ? before.closed_at || nowIso : null;

  await env.DB.prepare(
    "UPDATE complaints SET status = ?, remedy = ?, compensation = ?, assignee_user_id = ?, closed_at = ?, updated_at = ? WHERE complaint_id = ?"
  )
    .bind(status, remedy, compensation, assigneeUserId, closedAt, nowIso, complaintId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "complaint_updated",
      objectType: "complaint",
      objectId: complaintId,
      before: { status: before.status },
      after: { status },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + COMPLAINT_COLUMNS + " FROM complaints WHERE complaint_id = ?")
    .bind(complaintId)
    .first<ComplaintRow>();
  return json({ complaint: after });
}
