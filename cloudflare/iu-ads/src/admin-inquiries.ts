/**
 * Admin inquiries endpoints + inquiry→order conversion (Etapa 3, kap. 26).
 * RBAC: inquiries.read/inquiries.write (sales/main_admin); convert additionally
 * requires orders.write since it creates an `orders` row.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { hasPermission } from "./rbac";
import type { Env } from "./types";

export const INQUIRY_STATUSES = ["new", "in_review", "quoted", "converted", "rejected", "cancelled"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

function isInquiryStatus(value: unknown): value is InquiryStatus {
  return typeof value === "string" && (INQUIRY_STATUSES as readonly string[]).includes(value);
}

type InquiryRow = {
  inquiry_id: string;
  client_id: string | null;
  status: string;
  title: string;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
};

const INQUIRY_COLUMNS = "inquiry_id, client_id, status, title, payload_json, created_at, updated_at";

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

function serializeInquiry(row: InquiryRow) {
  return {
    inquiry_id: row.inquiry_id,
    client_id: row.client_id,
    status: row.status,
    title: row.title,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleListInquiries(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "inquiries.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("client_id");
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
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit, offset);

  const res = await env.DB.prepare(
    "SELECT " + INQUIRY_COLUMNS + " FROM inquiries " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<InquiryRow>();
  return json({ inquiries: (res.results || []).map(serializeInquiry), limit, offset });
}

export async function handleCreateInquiry(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "inquiries.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { client_id?: unknown; title?: unknown; status?: unknown; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return json({ error: "invalid_title" }, 400);
  const status = isInquiryStatus(body.status) ? body.status : "new";
  const clientId = typeof body.client_id === "string" && body.client_id ? body.client_id : null;

  if (clientId) {
    const clientRow = await env.DB.prepare("SELECT client_id FROM clients WHERE client_id = ?").bind(clientId).first();
    if (!clientRow) return json({ error: "client_not_found" }, 400);
  }

  const nowIso = new Date().toISOString();
  const inquiryId = newId("inq");
  const payloadJson = body.payload !== undefined ? JSON.stringify(body.payload) : null;
  await env.DB.prepare(
    "INSERT INTO inquiries (inquiry_id, client_id, status, title, payload_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(inquiryId, clientId, status, title, payloadJson, nowIso, nowIso)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "inquiry_created",
      objectType: "inquiry",
      objectId: inquiryId,
      after: { title, status, client_id: clientId },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + INQUIRY_COLUMNS + " FROM inquiries WHERE inquiry_id = ?")
    .bind(inquiryId)
    .first<InquiryRow>();
  return json({ inquiry: row ? serializeInquiry(row) : null }, 201);
}

export async function handleGetInquiry(request: Request, env: Env, inquiryId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "inquiries.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + INQUIRY_COLUMNS + " FROM inquiries WHERE inquiry_id = ?")
    .bind(inquiryId)
    .first<InquiryRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ inquiry: serializeInquiry(row) });
}

export async function handleUpdateInquiry(request: Request, env: Env, inquiryId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "inquiries.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + INQUIRY_COLUMNS + " FROM inquiries WHERE inquiry_id = ?")
    .bind(inquiryId)
    .first<InquiryRow>();
  if (!before) return json({ error: "not_found" }, 404);
  if (before.status === "converted") return json({ error: "inquiry_already_converted" }, 409);

  let body: { title?: unknown; status?: unknown; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.status !== undefined && !isInquiryStatus(body.status)) return json({ error: "invalid_status" }, 400);

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : before.title;
  const status = isInquiryStatus(body.status) ? body.status : before.status;
  const payloadJson = body.payload !== undefined ? JSON.stringify(body.payload) : before.payload_json;
  const nowIso = new Date().toISOString();

  await env.DB.prepare("UPDATE inquiries SET title = ?, status = ?, payload_json = ?, updated_at = ? WHERE inquiry_id = ?")
    .bind(title, status, payloadJson, nowIso, inquiryId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "inquiry_updated",
      objectType: "inquiry",
      objectId: inquiryId,
      before: { status: before.status, title: before.title },
      after: { status, title },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + INQUIRY_COLUMNS + " FROM inquiries WHERE inquiry_id = ?")
    .bind(inquiryId)
    .first<InquiryRow>();
  return json({ inquiry: after ? serializeInquiry(after) : null });
}

function generateOrderNumber(): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return "ORD-" + String(year) + "-" + suffix;
}

/** Converts an inquiry into a draft order (kap. 26/27) — requires inquiries.write AND orders.write. */
export async function handleConvertInquiryToOrder(request: Request, env: Env, inquiryId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "inquiries.write");
  if (!guard.ok) return guard.response;
  if (!hasPermission(guard.roles, "orders.write")) return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const inquiry = await env.DB.prepare("SELECT " + INQUIRY_COLUMNS + " FROM inquiries WHERE inquiry_id = ?")
    .bind(inquiryId)
    .first<InquiryRow>();
  if (!inquiry) return json({ error: "not_found" }, 404);
  if (inquiry.status === "converted") return json({ error: "inquiry_already_converted" }, 409);
  if (!inquiry.client_id) return json({ error: "inquiry_missing_client" }, 400);

  let body: { ordered_by?: unknown; payer?: unknown; contact_person?: unknown } = {};
  const rawText = await request.text();
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      return json({ error: "invalid_body" }, 400);
    }
  }

  const nowIso = new Date().toISOString();
  const orderId = newId("ord");
  const orderNumber = generateOrderNumber();
  await env.DB.prepare(
    "INSERT INTO orders (order_id, client_id, inquiry_id, order_number, status, ordered_by, payer, contact_person, payload_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      orderId,
      inquiry.client_id,
      inquiryId,
      orderNumber,
      "draft",
      typeof body.ordered_by === "string" ? body.ordered_by : null,
      typeof body.payer === "string" ? body.payer : null,
      typeof body.contact_person === "string" ? body.contact_person : null,
      inquiry.payload_json,
      nowIso,
      nowIso
    )
    .run();

  await env.DB.prepare("UPDATE inquiries SET status = 'converted', updated_at = ? WHERE inquiry_id = ?")
    .bind(nowIso, inquiryId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "inquiry_converted_to_order",
      objectType: "inquiry",
      objectId: inquiryId,
      before: { status: inquiry.status },
      after: { status: "converted", order_id: orderId, order_number: orderNumber },
      result: "success",
    })
  );

  return json({ order_id: orderId, order_number: orderNumber, inquiry_id: inquiryId, status: "draft" }, 201);
}
