/**
 * Admin orders endpoints (Etapa 3, kap. 27). RBAC: orders.read/orders.write (sales/main_admin).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

export const ORDER_STATUSES = ["draft", "confirmed", "in_production", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

type OrderRow = {
  order_id: string;
  client_id: string;
  inquiry_id: string | null;
  order_number: string;
  status: string;
  ordered_by: string | null;
  payer: string | null;
  contact_person: string | null;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
};

const ORDER_COLUMNS =
  "order_id, client_id, inquiry_id, order_number, status, ordered_by, payer, contact_person, payload_json, created_at, updated_at";

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

function serializeOrder(row: OrderRow) {
  return {
    order_id: row.order_id,
    client_id: row.client_id,
    inquiry_id: row.inquiry_id,
    order_number: row.order_number,
    status: row.status,
    ordered_by: row.ordered_by,
    payer: row.payer,
    contact_person: row.contact_person,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleListOrders(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
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
    "SELECT " + ORDER_COLUMNS + " FROM orders " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<OrderRow>();
  return json({ orders: (res.results || []).map(serializeOrder), limit, offset });
}

export async function handleCreateOrder(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: {
    client_id?: unknown;
    order_number?: unknown;
    status?: unknown;
    ordered_by?: unknown;
    payer?: unknown;
    contact_person?: unknown;
    payload?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!clientId) return json({ error: "invalid_client_id" }, 400);
  const clientRow = await env.DB.prepare("SELECT client_id FROM clients WHERE client_id = ?").bind(clientId).first();
  if (!clientRow) return json({ error: "client_not_found" }, 400);

  const orderNumber =
    typeof body.order_number === "string" && body.order_number.trim()
      ? body.order_number.trim()
      : "ORD-" + String(new Date().getFullYear()) + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const status = isOrderStatus(body.status) ? body.status : "draft";
  const nowIso = new Date().toISOString();
  const orderId = newId("ord");

  const existing = await env.DB.prepare("SELECT order_id FROM orders WHERE order_number = ?").bind(orderNumber).first();
  if (existing) return json({ error: "order_number_taken" }, 409);

  await env.DB.prepare(
    "INSERT INTO orders (order_id, client_id, inquiry_id, order_number, status, ordered_by, payer, contact_person, payload_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      orderId,
      clientId,
      null,
      orderNumber,
      status,
      typeof body.ordered_by === "string" ? body.ordered_by : null,
      typeof body.payer === "string" ? body.payer : null,
      typeof body.contact_person === "string" ? body.contact_person : null,
      body.payload !== undefined ? JSON.stringify(body.payload) : null,
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "order_created",
      objectType: "order",
      objectId: orderId,
      after: { client_id: clientId, order_number: orderNumber, status },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + ORDER_COLUMNS + " FROM orders WHERE order_id = ?")
    .bind(orderId)
    .first<OrderRow>();
  return json({ order: row ? serializeOrder(row) : null }, 201);
}

export async function handleGetOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + ORDER_COLUMNS + " FROM orders WHERE order_id = ?")
    .bind(orderId)
    .first<OrderRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ order: serializeOrder(row) });
}

export async function handleUpdateOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + ORDER_COLUMNS + " FROM orders WHERE order_id = ?")
    .bind(orderId)
    .first<OrderRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: { status?: unknown; ordered_by?: unknown; payer?: unknown; contact_person?: unknown; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.status !== undefined && !isOrderStatus(body.status)) return json({ error: "invalid_status" }, 400);

  const status = isOrderStatus(body.status) ? body.status : before.status;
  const orderedBy = typeof body.ordered_by === "string" ? body.ordered_by : before.ordered_by;
  const payer = typeof body.payer === "string" ? body.payer : before.payer;
  const contactPerson = typeof body.contact_person === "string" ? body.contact_person : before.contact_person;
  const payloadJson = body.payload !== undefined ? JSON.stringify(body.payload) : before.payload_json;
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE orders SET status = ?, ordered_by = ?, payer = ?, contact_person = ?, payload_json = ?, updated_at = ? WHERE order_id = ?"
  )
    .bind(status, orderedBy, payer, contactPerson, payloadJson, nowIso, orderId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "order_updated",
      objectType: "order",
      objectId: orderId,
      before: { status: before.status },
      after: { status },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + ORDER_COLUMNS + " FROM orders WHERE order_id = ?")
    .bind(orderId)
    .first<OrderRow>();
  return json({ order: after ? serializeOrder(after) : null });
}
