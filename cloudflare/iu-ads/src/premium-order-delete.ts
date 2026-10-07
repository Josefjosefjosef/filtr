/**
 * Premium order delete / archive (accounting-safe).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { appendPremiumOrderEvent } from "./premium-order-history";
import type { Env } from "./types";

async function orderHasProtectedAccounting(db: D1Database, orderId: string): Promise<boolean> {
  const inv = await db
    .prepare("SELECT invoice_id FROM invoices WHERE order_id = ? LIMIT 1")
    .bind(orderId)
    .first();
  return !!inv;
}

async function countClientOrders(db: D1Database, clientId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM orders WHERE client_id = ?").bind(clientId).first<{ c: number }>();
  return Number(row?.c) || 0;
}

export async function handleAdminPremiumDeleteOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { confirm?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.confirm !== true) return json({ error: "confirmation_required" }, 400);

  const po = await env.DB.prepare(
    `SELECT po.*, o.client_id, o.customer_order_code, o.order_number
     FROM premium_selected_orders po JOIN orders o ON o.order_id = po.order_id WHERE po.order_id = ?`
  )
    .bind(orderId)
    .first<Record<string, unknown>>();
  if (!po) return json({ error: "not_found" }, 404);

  const protectedAccounting = await orderHasProtectedAccounting(env.DB, orderId);
  const nowIso = new Date().toISOString();
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 2000) : null;

  if (protectedAccounting) {
    await env.DB.prepare(
      "UPDATE orders SET status = 'cancelled', archived_at = ?, archive_reason = ?, updated_at = ? WHERE order_id = ?"
    )
      .bind(nowIso, reason || "admin_archive_accounting", nowIso, orderId)
      .run();
    await env.DB.prepare("UPDATE premium_selected_orders SET workflow_status = 'rejected', updated_at = ? WHERE order_id = ?")
      .bind(nowIso, orderId)
      .run();
    const campId = po.published_campaign_id;
    if (typeof campId === "string" && campId) {
      await env.DB.prepare("UPDATE campaigns SET status = 'cancelled', updated_at = ? WHERE campaign_id = ?")
        .bind(nowIso, campId)
        .run();
      await env.DB.prepare(
        "UPDATE premium_selected_placements SET active_campaign_id = NULL, updated_at = ? WHERE placement_id = ? AND active_campaign_id = ?"
      )
        .bind(nowIso, po.placement_id, campId)
        .run();
    }
    try {
      await appendPremiumOrderEvent(env.DB, {
        orderId,
        eventType: "order_deleted",
        actorUserId: guard.userId,
        payload: { mode: "archived", reason, actor_label: guard.userId },
      });
    } catch {
      /* optional */
    }
    return json({
      ok: true,
      mode: "archived",
      message_cs: "Objednávka stornována/archivována — účetní záznamy zůstávají z důvodu povinné evidence.",
    });
  }

  const clientId = String(po.client_id || "");
  const campId = typeof po.published_campaign_id === "string" ? po.published_campaign_id : null;

  if (campId) {
    await env.DB.prepare("UPDATE campaigns SET status = 'cancelled', updated_at = ? WHERE campaign_id = ?").bind(nowIso, campId).run();
    await env.DB.prepare(
      "UPDATE premium_selected_placements SET active_campaign_id = NULL, updated_at = ? WHERE placement_id = ? AND active_campaign_id = ?"
    )
      .bind(nowIso, po.placement_id, campId)
      .run();
  }

  const creativeId = typeof po.creative_id === "string" ? po.creative_id : null;
  if (creativeId) {
    const shared = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM premium_selected_orders WHERE creative_id = ? AND order_id != ?"
    )
      .bind(creativeId, orderId)
      .first<{ c: number }>();
    if (!Number(shared?.c)) {
      await env.DB.prepare("DELETE FROM creatives WHERE creative_id = ? AND client_id = ?").bind(creativeId, clientId).run();
    }
  }

  await env.DB.prepare("DELETE FROM premium_order_notes WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_order_events WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_order_renewals WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_order_public_revisions WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_publish_events WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_order_portal_codes WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_order_price_snapshots WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_selected_orders WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM orders WHERE order_id = ?").bind(orderId).run();

  if (clientId && (await countClientOrders(env.DB, clientId)) === 0) {
    await env.DB.prepare("DELETE FROM client_contacts WHERE client_id = ?").bind(clientId).run();
    await env.DB.prepare("DELETE FROM clients WHERE client_id = ?").bind(clientId).run();
  }

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "premium_order_hard_deleted",
      objectType: "premium_order",
      objectId: orderId,
      after: { mode: "hard_delete", reason },
      result: "success",
    })
  );

  return json({ ok: true, mode: "hard_delete" });
}
