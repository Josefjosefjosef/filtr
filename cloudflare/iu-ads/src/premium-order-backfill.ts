/**
 * Admin backfill: customer_order_code + portal login rows for legacy premium orders.
 */
import { json, requireAdminPermission } from "./admin-auth";
import { backfillPremiumOrderPortalCode } from "./premium-order-portal";
import type { Env } from "./types";

export async function handleAdminPremiumBackfillCodes(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB || !env.ADS_CODE_PEPPER) return json({ error: "auth_not_configured" }, 503);

  let body: { limit?: unknown; dry_run?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));
  const dryRun = body.dry_run === true;

  const res = await env.DB.prepare(
    `SELECT o.order_id
     FROM orders o
     JOIN premium_selected_orders po ON po.order_id = o.order_id
     LEFT JOIN premium_order_portal_codes pc ON pc.order_id = o.order_id
     WHERE pc.order_id IS NULL OR o.customer_order_code IS NULL OR TRIM(o.customer_order_code) = ''
     ORDER BY o.created_at ASC
     LIMIT ?`
  )
    .bind(limit)
    .all<{ order_id: string }>();

  const orderIds = (res.results || []).map((r) => r.order_id);
  if (dryRun) {
    return json({ ok: true, dry_run: true, would_process: orderIds.length, order_ids: orderIds });
  }

  let created = 0;
  let processed = 0;
  const errors: { order_id: string; reason: string }[] = [];
  for (const orderId of orderIds) {
    const result = await backfillPremiumOrderPortalCode(env.DB, env.ADS_CODE_PEPPER, orderId, guard.userId);
    processed++;
    if (!result.ok) {
      errors.push({ order_id: orderId, reason: result.reason });
      continue;
    }
    if (result.created) created++;
  }

  return json({
    ok: true,
    processed,
    codes_generated: created,
    errors,
    existing_orders_backfilled: errors.length === 0 && processed > 0,
  });
}
