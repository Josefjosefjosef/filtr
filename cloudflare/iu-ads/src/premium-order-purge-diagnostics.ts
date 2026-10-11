/**
 * Read-only purge consistency audit (main admin). No PII beyond order identifiers already visible in admin UI.
 */
import { json, requireAdminPermission } from "./admin-auth";
import { adminRolesIncludeMainAdmin } from "./premium-admin-main-guard";
import type { Env } from "./types";

async function count(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...params)
    .first<{ c: number }>();
  return Number(row?.c) || 0;
}

export async function handleAdminPremiumOrderPurgeDiagnostics(
  request: Request,
  env: Env,
  orderId: string
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  if (!adminRolesIncludeMainAdmin(guard.roles)) {
    return json({ error: "main_admin_required", message_cs: "Diagnostiku smí zobrazit pouze hlavní administrátor." }, 403);
  }
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const head = await env.DB.prepare(
    `SELECT o.order_id, o.customer_order_code, o.status AS order_status,
            po.workflow_status, po.published_campaign_id, po.creative_id, po.placement_id
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     WHERE po.order_id = ?`
  )
    .bind(orderId)
    .first<{
      order_id: string;
      customer_order_code: string | null;
      order_status: string;
      workflow_status: string;
      published_campaign_id: string | null;
      creative_id: string | null;
      placement_id: string;
    }>();

  if (!head) return json({ error: "not_found", message_cs: "Objednávka nenalezena." }, 404);

  const campId = head.published_campaign_id;

  const counts = {
    documents_by_order_id: await count(env.DB, "SELECT COUNT(*) AS c FROM documents WHERE order_id = ?", orderId),
    documents_by_campaign_id: campId
      ? await count(env.DB, "SELECT COUNT(*) AS c FROM documents WHERE campaign_id = ?", campId)
      : 0,
    invoices: await count(env.DB, "SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?", orderId),
    credit_notes: await count(env.DB, "SELECT COUNT(*) AS c FROM premium_credit_notes WHERE order_id = ?", orderId),
    storno_records: await count(env.DB, "SELECT COUNT(*) AS c FROM premium_order_storno_records WHERE order_id = ?", orderId),
    document_jobs: await count(env.DB, "SELECT COUNT(*) AS c FROM premium_order_document_jobs WHERE order_id = ?", orderId),
    publish_events: await count(env.DB, "SELECT COUNT(*) AS c FROM premium_publish_events WHERE order_id = ?", orderId),
    price_snapshots: await count(env.DB, "SELECT COUNT(*) AS c FROM premium_order_price_snapshots WHERE order_id = ?", orderId),
    premium_events: await count(env.DB, "SELECT COUNT(*) AS c FROM premium_order_events WHERE order_id = ?", orderId),
    contracts: await count(env.DB, "SELECT COUNT(*) AS c FROM contracts WHERE order_id = ?", orderId),
    child_orders: await count(
      env.DB,
      "SELECT COUNT(*) AS c FROM premium_selected_orders WHERE parent_order_id = ?",
      orderId
    ),
    campaign_status_events: campId
      ? await count(env.DB, "SELECT COUNT(*) AS c FROM campaign_status_events WHERE campaign_id = ?", campId)
      : 0,
    campaign_placements: campId
      ? await count(env.DB, "SELECT COUNT(*) AS c FROM campaign_placements WHERE campaign_id = ?", campId)
      : 0,
    campaign_creatives: campId
      ? await count(env.DB, "SELECT COUNT(*) AS c FROM creatives WHERE campaign_id = ?", campId)
      : 0,
    campaign_reservations: campId
      ? await count(env.DB, "SELECT COUNT(*) AS c FROM placement_reservations WHERE campaign_id = ?", campId)
      : 0,
    campaign_row: campId
      ? await count(env.DB, "SELECT COUNT(*) AS c FROM campaigns WHERE campaign_id = ?", campId)
      : 0,
  };

  return json({
    ok: true,
    order_id: head.order_id,
    customer_order_code: head.customer_order_code,
    published_campaign_id: campId,
    counts,
    partial_purge_suspected:
      counts.documents_by_order_id === 0 &&
      counts.invoices === 0 &&
      counts.document_jobs === 0 &&
      (counts.campaign_row > 0 || counts.campaign_creatives > 0 || counts.campaign_status_events > 0),
  });
}
