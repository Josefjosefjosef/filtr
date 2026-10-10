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
  const q = (url.searchParams.get("q") || "").trim();
  const payment = url.searchParams.get("payment");
  const filter = url.searchParams.get("filter");
  const categorySlug = url.searchParams.get("category");
  const positionParam = url.searchParams.get("position");
  const endingDays = url.searchParams.get("ending_days");
  const limit = Math.min(200, Number(url.searchParams.get("limit") || "100") || 100);
  const nowIso = new Date().toISOString();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    conditions.push("po.workflow_status = ?");
    params.push(status);
  }
  if (filter === "pending_review") {
    conditions.push("po.workflow_status IN ('submitted','under_review')");
  } else if (filter === "published_active") {
    conditions.push("po.workflow_status = 'published'");
    conditions.push("EXISTS (SELECT 1 FROM campaigns c WHERE c.campaign_id = po.published_campaign_id AND c.status = 'active' AND c.end_at > ?)");
    params.push(nowIso);
  } else if (filter === "paused") {
    conditions.push("EXISTS (SELECT 1 FROM campaigns c WHERE c.campaign_id = po.published_campaign_id AND c.status = 'paused')");
  } else if (filter === "ended") {
    conditions.push(
      "EXISTS (SELECT 1 FROM campaigns c WHERE c.campaign_id = po.published_campaign_id AND (c.status = 'ended' OR c.end_at <= ?))"
    );
    params.push(nowIso);
  } else if (filter === "rejected") {
    conditions.push("po.workflow_status = 'rejected'");
  }
  if (payment === "paid" || payment === "unpaid") {
    conditions.push("COALESCE(po.payment_status,'unpaid') = ?");
    params.push(payment);
  }
  if (categorySlug) {
    conditions.push("po.category_slug = ?");
    params.push(categorySlug);
  }
  if (positionParam) {
    const pos = Number(positionParam);
    if (pos >= 1 && pos <= 8) {
      conditions.push("po.position = ?");
      params.push(pos);
    }
  }
  if (endingDays === "30" || endingDays === "14" || endingDays === "7") {
    const days = Number(endingDays);
    const until = new Date(Date.now() + days * 86400000).toISOString();
    conditions.push("po.workflow_status = 'published'");
    conditions.push(
      "EXISTS (SELECT 1 FROM campaigns c WHERE c.campaign_id = po.published_campaign_id AND c.end_at > ? AND c.end_at <= ?)"
    );
    params.push(nowIso, until);
  }
  if (q) {
    conditions.push(
      "(o.order_number LIKE ? OR o.customer_order_code LIKE ? OR c.company_name LIKE ? OR c.ico LIKE ? OR o.contact_person LIKE ? OR po.client_contact_email LIKE ?)"
    );
    const like = "%" + q + "%";
    params.push(like, like, like, like, like, like);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit);

  const res = await env.DB.prepare(
    `SELECT po.*, o.client_id, o.order_number, o.customer_order_code, o.contact_person, o.payload_json, c.company_name, c.ico, c.dic,
            ps.agreed_price_cents AS snap_agreed, ps.catalog_price_cents AS snap_catalog,
            ppl.active_campaign_id AS placement_active_campaign_id,
            camp.status AS published_campaign_status, camp.end_at AS published_campaign_end_at
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     JOIN clients c ON c.client_id = o.client_id
     LEFT JOIN premium_order_price_snapshots ps ON ps.order_id = po.order_id
     LEFT JOIN premium_selected_placements ppl ON ppl.placement_id = po.placement_id
     LEFT JOIN campaigns camp ON camp.campaign_id = po.published_campaign_id
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

export async function handleAdminPremiumPublicationConsistency(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  const nowIso = new Date().toISOString();
  const { scanPremiumPublicationConsistency } = await import("./premium-publication-consistency");
  const scan = await scanPremiumPublicationConsistency(env.DB, nowIso);
  return json({
    ok: scan.ok,
    as_of: nowIso,
    issues: scan.issues,
    measurement: { impressions: false, clicks: false, ctr: false },
  });
}

export async function handleAdminPremiumPublicationRepair(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  const { repairPremiumPublicationConsistency } = await import("./premium-publication-consistency");
  const result = await repairPremiumPublicationConsistency(env, { actorUserId: guard.userId });
  return json({
    ok: true,
    repaired: result.repaired,
    incidents: result.incidents,
    measurement: { impressions: false, clicks: false, ctr: false },
  });
}

export async function handleAdminPremiumReject(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  let body: { reason?: unknown; idempotency_key?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 2000) : null;
  const idempotencyKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim() ? body.idempotency_key.trim() : undefined;
  const { executePremiumOrderReject } = await import("./premium-publication-consistency");
  const result = await executePremiumOrderReject(env, {
    orderId,
    actorUserId: guard.userId,
    reason,
    idempotencyKey,
  });
  if (!result.ok) {
    const message_cs =
      result.error === "cannot_reject_published"
        ? "Schválenou objednávku nelze zamítnout. Nejdříve vypněte reklamu, poté stornujte objednávku a fakturu."
        : undefined;
    return json({ error: result.error, message_cs }, result.status);
  }
  let storno: { storno_id: string; storno_number: string } | null = null;
  let invoiceSettlementRequired = false;
  try {
    const inv = await env.DB?.prepare(
      "SELECT invoice_id FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
    )
      .bind(orderId)
      .first<{ invoice_id: string }>();
    invoiceSettlementRequired = !!inv?.invoice_id;
    const { ensurePremiumRejectionStornoRecord } = await import("./premium-order-accounting-cancel");
    storno = await ensurePremiumRejectionStornoRecord(env, {
      orderId,
      actorUserId: guard.userId,
      reason,
      idempotencyKey,
    });
  } catch {
    /* rejection stands even if storno PDF enqueue fails */
  }
  return json({
    ok: true,
    idempotent: result.idempotent,
    unpublished_campaign_ids: result.unpublished_campaign_ids,
    storno,
    accounting_invoice_settlement_required: invoiceSettlementRequired,
  });
}

export async function handleAdminPremiumRejectedInvoiceSettlement(
  request: Request,
  env: Env,
  orderId: string
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.write");
  if (!guard.ok) return guard.response;
  let body: { reason?: unknown; correction_cents?: unknown; idempotency_key?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 2000) : "";
  if (!reason) return json({ error: "reason_required", message_cs: "Důvod opravy je povinný." }, 400);
  if (body.correction_cents == null || !Number.isFinite(Number(body.correction_cents))) {
    return json({ error: "correction_required", message_cs: "Zadejte opravovanou částku (correction_cents)." }, 400);
  }
  const idempotencyKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim() ? body.idempotency_key.trim() : undefined;
  const { executePremiumRejectedOrderInvoiceSettlement } = await import("./premium-order-accounting-cancel");
  const result = await executePremiumRejectedOrderInvoiceSettlement(env, {
    orderId,
    actorUserId: guard.userId,
    reason,
    correctionCents: Math.round(Number(body.correction_cents)),
    idempotencyKey,
  });
  if (!result.ok) {
    return json({ error: result.error, message_cs: result.message_cs }, result.status);
  }
  return json(result);
}

export async function handleAdminPremiumTurnOffAd(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  let body: { reason?: unknown; idempotency_key?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 2000) : "";
  if (!reason) return json({ error: "reason_required", message_cs: "Důvod vypnutí reklamy je povinný." }, 400);
  const idempotencyKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim() ? body.idempotency_key.trim() : undefined;
  const { executePremiumAdTurnOff } = await import("./premium-ad-turnoff");
  const result = await executePremiumAdTurnOff(env, {
    orderId,
    actorUserId: guard.userId,
    reason,
    idempotencyKey,
  });
  if (!result.ok) {
    return json(
      { error: result.error, message_cs: result.message_cs },
      result.status
    );
  }
  return json({ ok: true, idempotent: result.idempotent, unpublished_campaign_ids: result.unpublished_campaign_ids });
}

export async function handleAdminPremiumAccountingCancel(
  request: Request,
  env: Env,
  orderId: string
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.write");
  if (!guard.ok) return guard.response;
  let body: { reason?: unknown; correction_cents?: unknown; idempotency_key?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 2000) : "";
  if (!reason) return json({ error: "reason_required", message_cs: "Důvod storna je povinný." }, 400);
  const correctionCents =
    body.correction_cents != null && Number.isFinite(Number(body.correction_cents))
      ? Math.round(Number(body.correction_cents))
      : undefined;
  const idempotencyKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim() ? body.idempotency_key.trim() : undefined;
  const { executePremiumOrderAccountingCancel } = await import("./premium-order-accounting-cancel");
  const result = await executePremiumOrderAccountingCancel(env, {
    orderId,
    actorUserId: guard.userId,
    reason,
    correctionCents,
    idempotencyKey,
  });
  if (!result.ok) {
    return json({ error: result.error, message_cs: result.message_cs }, result.status);
  }
  return json(result);
}

export async function handleAdminPremiumSuspend(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { reason?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 2000) : null;

  const po = await env.DB.prepare(
    "SELECT published_campaign_id, ad_turned_off_at FROM premium_selected_orders WHERE order_id = ?"
  )
    .bind(orderId)
    .first<{ published_campaign_id: string | null; ad_turned_off_at: string | null }>();
  if (!po?.published_campaign_id) return json({ error: "not_published" }, 400);
  if (po.ad_turned_off_at) {
    return json(
      { error: "ad_turned_off", message_cs: "Reklama byla definitivně vypnuta — obnovení není možné." },
      409
    );
  }

  const nowIso = new Date().toISOString();
  await env.DB.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE campaign_id = ?")
    .bind(nowIso, po.published_campaign_id)
    .run();
  await env.DB.prepare(
    `UPDATE premium_selected_orders SET admin_paused_at = ?, admin_paused_by = ?, admin_pause_reason = ?, updated_at = ? WHERE order_id = ?`
  )
    .bind(nowIso, guard.userId, reason, nowIso, orderId)
    .run();

  const { appendPremiumOrderEvent } = await import("./premium-order-history");
  await appendPremiumOrderEvent(env.DB, {
    orderId,
    eventType: "campaign_paused",
    actorUserId: guard.userId,
    payload: { reason, actor_label: guard.userId },
  });

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

  const po = await env.DB.prepare(
    "SELECT published_campaign_id, ad_turned_off_at FROM premium_selected_orders WHERE order_id = ?"
  )
    .bind(orderId)
    .first<{ published_campaign_id: string | null; ad_turned_off_at: string | null }>();
  if (!po?.published_campaign_id) return json({ error: "not_published" }, 400);
  if (po.ad_turned_off_at) {
    return json(
      { error: "ad_turned_off", message_cs: "Reklama byla definitivně vypnuta — obnovení není možné." },
      409
    );
  }

  const camp = await env.DB.prepare("SELECT end_at FROM campaigns WHERE campaign_id = ?")
    .bind(po.published_campaign_id)
    .first<{ end_at: string | null }>();
  const nowIso = new Date().toISOString();
  if (camp?.end_at && camp.end_at <= nowIso) return json({ error: "campaign_expired" }, 409);

  await env.DB.prepare("UPDATE campaigns SET status = 'active', updated_at = ? WHERE campaign_id = ?")
    .bind(nowIso, po.published_campaign_id)
    .run();
  await env.DB.prepare(
    `UPDATE premium_selected_orders SET admin_resumed_at = ?, admin_resumed_by = ?, updated_at = ? WHERE order_id = ?`
  )
    .bind(nowIso, guard.userId, nowIso, orderId)
    .run();
  const { appendPremiumOrderEvent } = await import("./premium-order-history");
  await appendPremiumOrderEvent(env.DB, {
    orderId,
    eventType: "campaign_resumed",
    actorUserId: guard.userId,
    payload: { actor_label: guard.userId },
  });
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
