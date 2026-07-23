/**
 * Admin dashboard aggregates (Etapa 8, kap. 6). Role-scoped widgets only — omit any widget the
 * caller lacks a matching `*.read` permission for. No PII dumps; counts and coarse summaries only.
 */
import { json, requireAdminSession } from "./admin-auth";
import { hasPermission } from "./rbac";
import type { Env } from "./types";

const UNPAID_INVOICE_STATUSES = ["issued", "sent", "overdue"] as const;
const OPEN_INQUIRY_STATUSES = ["new", "in_review", "quoted"] as const;
const OPEN_ORDER_STATUSES = ["draft", "confirmed", "in_production"] as const;

async function loadSetting(db: D1Database, key: string, fallback: string): Promise<string> {
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first<{ value: string }>();
    const v = row?.value?.trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

export async function handleGetAdminDashboard(request: Request, env: Env): Promise<Response> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const roles = session.context.roles;
  const widgets: Record<string, unknown> = {};

  if (hasPermission(roles, "campaigns.read")) {
    const rows = await env.DB.prepare(
      "SELECT status, COUNT(*) AS cnt FROM campaigns GROUP BY status"
    ).all<{ status: string; cnt: number }>();
    const byStatus: Record<string, number> = {};
    for (const r of rows.results || []) {
      byStatus[r.status] = Number(r.cnt) || 0;
    }
    widgets.campaigns_by_status = byStatus;
  }

  if (hasPermission(roles, "inquiries.read")) {
    const placeholders = OPEN_INQUIRY_STATUSES.map(() => "?").join(",");
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM inquiries WHERE status IN (" + placeholders + ")"
    )
      .bind(...OPEN_INQUIRY_STATUSES)
      .first<{ cnt: number }>();
    widgets.open_inquiries = Number(row?.cnt) || 0;
  }

  if (hasPermission(roles, "orders.read")) {
    const placeholders = OPEN_ORDER_STATUSES.map(() => "?").join(",");
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM orders WHERE status IN (" + placeholders + ")"
    )
      .bind(...OPEN_ORDER_STATUSES)
      .first<{ cnt: number }>();
    widgets.open_orders = Number(row?.cnt) || 0;
  }

  if (hasPermission(roles, "placements.read")) {
    const days = Number(await loadSetting(env.DB, "DASHBOARD_RESERVATIONS_UPCOMING_DAYS", "14")) || 14;
    const nowIso = new Date().toISOString();
    const untilIso = daysFromNowIso(days);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM placement_reservations WHERE status IN ('reserved','confirmed') AND start_at >= ? AND start_at <= ?"
    )
      .bind(nowIso, untilIso)
      .first<{ cnt: number }>();
    widgets.reservations_upcoming = { count: Number(row?.cnt) || 0, days };
  }

  if (hasPermission(roles, "invoices.read")) {
    const placeholders = UNPAID_INVOICE_STATUSES.map(() => "?").join(",");
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_cents), 0) AS total_cents FROM invoices WHERE status IN (" +
        placeholders +
        ")"
    )
      .bind(...UNPAID_INVOICE_STATUSES)
      .first<{ cnt: number; total_cents: number }>();
    widgets.unpaid_invoices = {
      count: Number(row?.cnt) || 0,
      total_cents: Number(row?.total_cents) || 0,
      statuses: [...UNPAID_INVOICE_STATUSES],
    };
  }

  if (hasPermission(roles, "alerts.read")) {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM alerts WHERE status IN ('new','read')"
    ).first<{ cnt: number }>();
    widgets.open_alerts = Number(row?.cnt) || 0;
  }

  if (hasPermission(roles, "audit.read")) {
    const hours = Number(await loadSetting(env.DB, "ALERT_RECENT_AUDIT_HOURS", "24")) || 24;
    const since = hoursAgoIso(hours);
    const row = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM audit_logs WHERE created_at >= ?")
      .bind(since)
      .first<{ cnt: number }>();
    widgets.recent_audit = { count: Number(row?.cnt) || 0, hours };
  }

  return json({
    widgets,
    roles,
    generated_at: new Date().toISOString(),
  });
}
