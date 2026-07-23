/**
 * Admin finance summary endpoint (Etapa 3, kap. 25). RBAC: finance.read (sales/main_admin).
 * Read-only aggregate over `invoices` — never returns per-client margin/cost data to a client
 * surface (this module is admin-only; kap. 25 acceptance test: no-margin-to-client).
 */
import { json, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

type InvoiceAggRow = {
  currency: string;
  status: string;
  count: number;
  total_cents: number | null;
};

const OUTSTANDING_STATUSES = new Set(["issued", "sent", "overdue"]);

export async function handleFinanceSummary(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "finance.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const clientId = url.searchParams.get("client_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (clientId) {
    conditions.push("client_id = ?");
    params.push(clientId);
  }
  if (from) {
    conditions.push("issued_at >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("issued_at <= ?");
    params.push(to);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const res = await env.DB.prepare(
    "SELECT currency, status, COUNT(*) AS count, SUM(total_cents) AS total_cents FROM invoices " +
      where +
      " GROUP BY currency, status"
  )
    .bind(...params)
    .all<InvoiceAggRow>();

  const rows = res.results || [];
  const byCurrency: Record<
    string,
    { invoiced_cents: number; paid_cents: number; outstanding_cents: number; by_status: Record<string, { count: number; total_cents: number }> }
  > = {};

  for (const row of rows) {
    const currency = row.currency || "CZK";
    if (!byCurrency[currency]) {
      byCurrency[currency] = { invoiced_cents: 0, paid_cents: 0, outstanding_cents: 0, by_status: {} };
    }
    const totalCents = row.total_cents || 0;
    byCurrency[currency].by_status[row.status] = { count: row.count, total_cents: totalCents };
    if (row.status !== "cancelled") byCurrency[currency].invoiced_cents += totalCents;
    if (row.status === "paid") byCurrency[currency].paid_cents += totalCents;
    if (OUTSTANDING_STATUSES.has(row.status)) byCurrency[currency].outstanding_cents += totalCents;
  }

  return json({ summary: byCurrency, filters: { client_id: clientId, from, to } });
}
