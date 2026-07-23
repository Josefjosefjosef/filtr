/**
 * Admin invoices endpoints (Etapa 3, kap. 29). RBAC: invoices.read (sales/main_admin),
 * invoices.write (sales/main_admin — Etapa 3 extension). Amounts stored as *_cents integers.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

export const INVOICE_STATUSES = ["draft", "issued", "sent", "paid", "overdue", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === "string" && (INVOICE_STATUSES as readonly string[]).includes(value);
}

type InvoiceRow = {
  invoice_id: string;
  client_id: string;
  order_id: string | null;
  campaign_id: string | null;
  invoice_number: string;
  variable_symbol: string | null;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  tax_base_cents: number | null;
  vat_cents: number | null;
  total_cents: number | null;
  currency: string;
  created_at: string;
  updated_at: string;
};

const INVOICE_COLUMNS =
  "invoice_id, client_id, order_id, campaign_id, invoice_number, variable_symbol, status, issued_at, due_at, paid_at, tax_base_cents, vat_cents, total_cents, currency, created_at, updated_at";

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

function toCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function serializeInvoice(row: InvoiceRow) {
  return {
    invoice_id: row.invoice_id,
    client_id: row.client_id,
    order_id: row.order_id,
    campaign_id: row.campaign_id,
    invoice_number: row.invoice_number,
    variable_symbol: row.variable_symbol,
    status: row.status,
    issued_at: row.issued_at,
    due_at: row.due_at,
    paid_at: row.paid_at,
    tax_base_cents: row.tax_base_cents,
    vat_cents: row.vat_cents,
    total_cents: row.total_cents,
    currency: row.currency,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleListInvoices(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.read");
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
    "SELECT " + INVOICE_COLUMNS + " FROM invoices " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<InvoiceRow>();
  return json({ invoices: (res.results || []).map(serializeInvoice), limit, offset });
}

export async function handleCreateInvoice(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: {
    client_id?: unknown;
    order_id?: unknown;
    campaign_id?: unknown;
    invoice_number?: unknown;
    variable_symbol?: unknown;
    status?: unknown;
    due_at?: unknown;
    tax_base_cents?: unknown;
    vat_cents?: unknown;
    total_cents?: unknown;
    currency?: unknown;
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

  const invoiceNumber =
    typeof body.invoice_number === "string" && body.invoice_number.trim()
      ? body.invoice_number.trim()
      : "INV-" + String(new Date().getFullYear()) + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const existing = await env.DB.prepare("SELECT invoice_id FROM invoices WHERE invoice_number = ?").bind(invoiceNumber).first();
  if (existing) return json({ error: "invoice_number_taken" }, 409);

  const status = isInvoiceStatus(body.status) ? body.status : "draft";
  const nowIso = new Date().toISOString();
  const invoiceId = newId("inv");

  await env.DB.prepare(
    "INSERT INTO invoices (invoice_id, client_id, order_id, campaign_id, invoice_number, variable_symbol, status, issued_at, due_at, paid_at, tax_base_cents, vat_cents, total_cents, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      invoiceId,
      clientId,
      typeof body.order_id === "string" ? body.order_id : null,
      typeof body.campaign_id === "string" ? body.campaign_id : null,
      invoiceNumber,
      typeof body.variable_symbol === "string" ? body.variable_symbol : null,
      status,
      status === "issued" || status === "sent" || status === "paid" ? nowIso : null,
      typeof body.due_at === "string" ? body.due_at : null,
      null,
      toCents(body.tax_base_cents),
      toCents(body.vat_cents),
      toCents(body.total_cents),
      typeof body.currency === "string" && body.currency.trim() ? body.currency.trim() : "CZK",
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "invoice_created",
      objectType: "invoice",
      objectId: invoiceId,
      after: { client_id: clientId, invoice_number: invoiceNumber, status },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + INVOICE_COLUMNS + " FROM invoices WHERE invoice_id = ?")
    .bind(invoiceId)
    .first<InvoiceRow>();
  return json({ invoice: row ? serializeInvoice(row) : null }, 201);
}

export async function handleGetInvoice(request: Request, env: Env, invoiceId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + INVOICE_COLUMNS + " FROM invoices WHERE invoice_id = ?")
    .bind(invoiceId)
    .first<InvoiceRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ invoice: serializeInvoice(row) });
}

export async function handleUpdateInvoice(request: Request, env: Env, invoiceId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + INVOICE_COLUMNS + " FROM invoices WHERE invoice_id = ?")
    .bind(invoiceId)
    .first<InvoiceRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: { status?: unknown; due_at?: unknown; paid_at?: unknown; tax_base_cents?: unknown; vat_cents?: unknown; total_cents?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.status !== undefined && !isInvoiceStatus(body.status)) return json({ error: "invalid_status" }, 400);

  const status = isInvoiceStatus(body.status) ? body.status : before.status;
  const nowIso = new Date().toISOString();
  const issuedAt = before.issued_at || (status === "issued" || status === "sent" || status === "paid" ? nowIso : null);
  const paidAt = status === "paid" ? (typeof body.paid_at === "string" ? body.paid_at : nowIso) : before.paid_at;
  const dueAt = typeof body.due_at === "string" ? body.due_at : before.due_at;
  const taxBaseCents = body.tax_base_cents !== undefined ? toCents(body.tax_base_cents) : before.tax_base_cents;
  const vatCents = body.vat_cents !== undefined ? toCents(body.vat_cents) : before.vat_cents;
  const totalCents = body.total_cents !== undefined ? toCents(body.total_cents) : before.total_cents;

  await env.DB.prepare(
    "UPDATE invoices SET status = ?, issued_at = ?, due_at = ?, paid_at = ?, tax_base_cents = ?, vat_cents = ?, total_cents = ?, updated_at = ? WHERE invoice_id = ?"
  )
    .bind(status, issuedAt, dueAt, paidAt, taxBaseCents, vatCents, totalCents, nowIso, invoiceId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "invoice_updated",
      objectType: "invoice",
      objectId: invoiceId,
      before: { status: before.status },
      after: { status },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + INVOICE_COLUMNS + " FROM invoices WHERE invoice_id = ?")
    .bind(invoiceId)
    .first<InvoiceRow>();
  return json({ invoice: after ? serializeInvoice(after) : null });
}
