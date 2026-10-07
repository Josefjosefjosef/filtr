/**
 * Admin premium selected-services review + suspend/reactivate + price update.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { handleAdminPremiumApprovePublish } from "./premium-publish";
import {
  formatPremiumTotalPriceLabelCs,
  parsePremiumPlacementId,
  resolveAuthoritativePriceCents,
} from "./premium-selected-services";
import { countPendingPremiumOrders, serializePremiumOrderAdminListRow } from "./premium-order-workflow";
import type { Env } from "./types";

export { handleAdminPremiumApprovePublish };

export async function handleAdminPremiumPendingCount(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  const pending_count = await countPendingPremiumOrders(env.DB);
  return json({ pending_count });
}

export async function handleAdminPremiumListOrders(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const status = url.searchParams.get("status");
  const limit = Math.min(200, Number(url.searchParams.get("limit") || "100") || 100);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    conditions.push("po.workflow_status = ?");
    params.push(status);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit);

  const res = await env.DB.prepare(
    `SELECT po.*, o.client_id, o.order_number, o.payload_json, c.company_name, c.ico, c.dic,
            ps.agreed_price_cents AS snap_agreed, ps.catalog_price_cents AS snap_catalog
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     JOIN clients c ON c.client_id = o.client_id
     LEFT JOIN premium_order_price_snapshots ps ON ps.order_id = po.order_id
     ${where}
     ORDER BY CASE WHEN po.workflow_status IN ('submitted', 'under_review') THEN 0 ELSE 1 END,
              po.created_at DESC
     LIMIT ?`
  )
    .bind(...params)
    .all();

  const premium_orders = (res.results || []).map((row) =>
    serializePremiumOrderAdminListRow(row as Record<string, unknown>)
  );
  const pending_count = await countPendingPremiumOrders(env.DB);
  return json({ premium_orders, pending_count });
}

export async function handleAdminPremiumReject(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  const nowIso = new Date().toISOString();
  await env.DB.prepare("UPDATE premium_selected_orders SET workflow_status = 'rejected', updated_at = ? WHERE order_id = ?")
    .bind(nowIso, orderId)
    .run();
  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "premium_order_rejected",
      objectType: "premium_order",
      objectId: orderId,
      before: null,
      after: { workflow_status: "rejected" },
      result: "success",
    })
  );
  return json({ ok: true });
}

export async function handleAdminPremiumSuspend(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const po = await env.DB.prepare("SELECT published_campaign_id FROM premium_selected_orders WHERE order_id = ?")
    .bind(orderId)
    .first<{ published_campaign_id: string | null }>();
  if (!po?.published_campaign_id) return json({ error: "not_published" }, 400);

  const nowIso = new Date().toISOString();
  await env.DB.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE campaign_id = ?")
    .bind(nowIso, po.published_campaign_id)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "premium_manual_suspend_nonpayment",
      objectType: "campaign",
      objectId: po.published_campaign_id,
      before: { status: "active" },
      after: { status: "paused" },
      result: "success",
    })
  );
  return json({ ok: true });
}

export async function handleAdminPremiumReactivate(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const po = await env.DB.prepare("SELECT published_campaign_id FROM premium_selected_orders WHERE order_id = ?")
    .bind(orderId)
    .first<{ published_campaign_id: string | null }>();
  if (!po?.published_campaign_id) return json({ error: "not_published" }, 400);

  const camp = await env.DB.prepare("SELECT end_at FROM campaigns WHERE campaign_id = ?")
    .bind(po.published_campaign_id)
    .first<{ end_at: string | null }>();
  const nowIso = new Date().toISOString();
  if (camp?.end_at && camp.end_at <= nowIso) return json({ error: "campaign_expired" }, 409);

  await env.DB.prepare("UPDATE campaigns SET status = 'active', updated_at = ? WHERE campaign_id = ?")
    .bind(nowIso, po.published_campaign_id)
    .run();
  return json({ ok: true });
}

export async function handleAdminPremiumUpdatePlacementPrice(request: Request, env: Env, placementId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { price_cents?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const parsed = parsePremiumPlacementId(placementId);
  if (!parsed) return json({ error: "invalid_placement" }, 400);
  const submitted = body.price_cents;
  const priceCents = resolveAuthoritativePriceCents(
    placementId,
    parsed.position,
    typeof submitted === "number" ? submitted : null,
    null
  );
  const nowIso = new Date().toISOString();
  await env.DB.prepare("UPDATE premium_selected_placements SET current_price_cents = ?, updated_at = ? WHERE placement_id = ?")
    .bind(priceCents, nowIso, placementId)
    .run();
  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "premium_catalog_price_changed",
      objectType: "premium_placement",
      objectId: placementId,
      before: null,
      after: { current_price_cents: priceCents },
      result: "success",
    })
  );
  return json({ placement_id: placementId, current_price_cents: priceCents });
}

export async function handleClientPremiumRenewalAccept(request: Request, env: Env, offerId: string): Promise<Response> {
  const { requireClientSession } = await import("./client-auth");
  const { hashClientAccessCode, generateClientAccessCode } = await import("./admin-codes");
  const session = await requireClientSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB || !env.ADS_CODE_PEPPER) return json({ error: "auth_not_configured" }, 503);

  const offer = await env.DB.prepare(
    "SELECT offer_id, client_id, campaign_id, placement_id, offered_price_cents, currency, status, window_end_at FROM premium_renewal_offers WHERE offer_id = ?"
  )
    .bind(offerId)
    .first<{
      offer_id: string;
      client_id: string;
      campaign_id: string;
      placement_id: string;
      offered_price_cents: number;
      currency: string;
      status: string;
      window_end_at: string;
    }>();
  if (!offer) return json({ error: "not_found" }, 404);
  if (offer.client_id !== session.context.clientId) return json({ error: "forbidden" }, 403);
  if (offer.status !== "offered") return json({ error: "offer_not_active" }, 409);
  if (offer.window_end_at < new Date().toISOString()) return json({ error: "offer_expired" }, 409);

  const dup = await env.DB.prepare("SELECT accepted_order_id FROM premium_renewal_offers WHERE offer_id = ?")
    .bind(offerId)
    .first<{ accepted_order_id: string | null }>();
  if (dup?.accepted_order_id) return json({ ok: true, order_id: dup.accepted_order_id, idempotent: true });

  const prev = await env.DB.prepare(
    "SELECT category_slug, position, target_url, creative_mode, creative_id, client_contact_email FROM premium_selected_orders WHERE published_campaign_id = ?"
  )
    .bind(offer.campaign_id)
    .first<{
      category_slug: string;
      position: number;
      target_url: string;
      creative_mode: string;
      creative_id: string;
      client_contact_email: string;
    }>();
  if (!prev) return json({ error: "prior_order_missing" }, 500);

  const nowIso = new Date().toISOString();
  const orderId = newId("ord");
  const orderNumber = "RN-" + String(new Date().getFullYear()) + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  await env.DB.prepare(
    "INSERT INTO orders (order_id, client_id, order_number, status, payload_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(
      orderId,
      offer.client_id,
      orderNumber,
      "confirmed",
      JSON.stringify({
        product: "premium_selected_services_renewal_v1",
        placement_id: offer.placement_id,
        renewal_offer_id: offerId,
        agreed_price_cents: offer.offered_price_cents,
      }),
      nowIso,
      nowIso
    )
    .run();

  const token = generateClientAccessCode().plaintext;
  const tokenHash = await hashClientAccessCode(token, env.ADS_CODE_PEPPER);
  await env.DB.prepare(
    `INSERT INTO premium_selected_orders (
      order_id, placement_id, category_slug, position, workflow_status, target_url, creative_id, creative_mode,
      order_token_hash, client_contact_email, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      orderId,
      offer.placement_id,
      prev.category_slug,
      prev.position,
      "under_review",
      prev.target_url,
      prev.creative_id,
      prev.creative_mode,
      tokenHash,
      prev.client_contact_email,
      nowIso,
      nowIso
    )
    .run();

  await env.DB.prepare("UPDATE premium_renewal_offers SET status = 'accepted', accepted_order_id = ?, updated_at = ? WHERE offer_id = ?")
    .bind(orderId, nowIso, offerId)
    .run();

  const { executePremiumApproveAndPublish } = await import("./premium-publish");
  const publish = await executePremiumApproveAndPublish(env, {
    orderId,
    actorUserId: "renewal:client_accept",
    idempotencyKey: "renewal_publish:" + offerId,
  });
  if (!publish.ok) {
    return json({ ok: false, error: publish.error, order_id: orderId }, publish.status);
  }

  return json({
    ok: true,
    order_id: orderId,
    campaign_id: publish.campaign_id,
    invoice_id: publish.invoice_id,
    idempotent: publish.already,
    offered_price_cents: offer.offered_price_cents,
    price_label_cs: formatPremiumTotalPriceLabelCs(offer.offered_price_cents),
  });
}
