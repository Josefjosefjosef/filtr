/**
 * Admin lifecycle: payment, renewal, notes, edits, delete (premium selected-services orders).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { appendPremiumOrderEvent } from "./premium-order-history";
import {
  addCalendarMonthsFromIso,
  parsePremiumPlacementId,
  resolveAuthoritativePriceCents,
  type PremiumPosition,
} from "./premium-selected-services";
import type { Env } from "./types";

export async function handleAdminPremiumOrderSummary(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  const nowIso = new Date().toISOString();
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString();

  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM premium_selected_orders WHERE workflow_status IN ('submitted','under_review')"
  ).first<{ c: number }>();
  const active = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM premium_selected_orders po
     JOIN campaigns c ON c.campaign_id = po.published_campaign_id
     WHERE po.workflow_status = 'published' AND c.status = 'active' AND c.end_at > ?`
  )
    .bind(nowIso)
    .first<{ c: number }>();
  const paused = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM premium_selected_orders po
     JOIN campaigns c ON c.campaign_id = po.published_campaign_id
     WHERE c.status = 'paused'`
  ).first<{ c: number }>();
  const unpaid = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM premium_selected_orders WHERE COALESCE(payment_status,'unpaid') != 'paid'"
  ).first<{ c: number }>();
  const ending30 = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM premium_selected_orders po
     JOIN campaigns c ON c.campaign_id = po.published_campaign_id
     WHERE po.workflow_status = 'published' AND c.end_at > ? AND c.end_at <= ?`
  )
    .bind(nowIso, in30)
    .first<{ c: number }>();

  return json({
    pending_review: Number(pending?.c) || 0,
    active_published: Number(active?.c) || 0,
    paused: Number(paused?.c) || 0,
    unpaid: Number(unpaid?.c) || 0,
    ending_within_30_days: Number(ending30?.c) || 0,
  });
}

export async function handleAdminPremiumSetPayment(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { payment_status?: unknown; payment_received_at?: unknown; idempotency_key?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const status = body.payment_status === "paid" ? "paid" : body.payment_status === "unpaid" ? "unpaid" : null;
  if (!status) return json({ error: "invalid_payment_status" }, 400);

  const before = await env.DB.prepare("SELECT payment_status FROM premium_selected_orders WHERE order_id = ?")
    .bind(orderId)
    .first<{ payment_status: string | null }>();
  if (!before) return json({ error: "not_found" }, 404);

  const nowIso = new Date().toISOString();
  const receivedAt =
    typeof body.payment_received_at === "string" && body.payment_received_at.trim()
      ? body.payment_received_at.trim()
      : status === "paid"
        ? nowIso
        : null;

  await env.DB.prepare(
    `UPDATE premium_selected_orders SET payment_status = ?, paid_at = ?, paid_by = ?, payment_received_at = ?, updated_at = ? WHERE order_id = ?`
  )
    .bind(status, status === "paid" ? nowIso : null, status === "paid" ? guard.userId : null, receivedAt, nowIso, orderId)
    .run();

  await appendPremiumOrderEvent(env.DB, {
    orderId,
    eventType: "payment_status_changed",
    actorUserId: guard.userId,
    payload: { from: before.payment_status || "unpaid", to: status, payment_received_at: receivedAt, actor_label: guard.userId },
  });

  return json({ ok: true, payment_status: status });
}

export async function handleAdminPremiumExtend(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { idempotency_key?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const idem =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : "extend:" + orderId;

  const existing = await env.DB.prepare("SELECT renewal_id FROM premium_order_renewals WHERE idempotency_key = ?")
    .bind(idem)
    .first<{ renewal_id: string }>();
  if (existing) return json({ ok: true, idempotent: true, renewal_id: existing.renewal_id });

  const po = await env.DB.prepare(
    "SELECT order_id, placement_id, position, published_campaign_id, workflow_status FROM premium_selected_orders WHERE order_id = ?"
  )
    .bind(orderId)
    .first<{
      order_id: string;
      placement_id: string;
      position: number;
      published_campaign_id: string | null;
      workflow_status: string;
    }>();
  if (!po?.published_campaign_id || po.workflow_status !== "published") {
    return json({ error: "not_published" }, 400);
  }

  const camp = await env.DB.prepare("SELECT campaign_id, end_at, status FROM campaigns WHERE campaign_id = ?")
    .bind(po.published_campaign_id)
    .first<{ campaign_id: string; end_at: string | null; status: string }>();
  if (!camp?.end_at) return json({ error: "missing_end_at" }, 400);

  const parsed = parsePremiumPlacementId(po.placement_id);
  if (!parsed) return json({ error: "invalid_placement" }, 400);
  const priceCents = resolveAuthoritativePriceCents(
    po.placement_id,
    parsed.position as PremiumPosition,
    null,
    null
  );

  const oldEnd = camp.end_at;
  const newEnd = addCalendarMonthsFromIso(oldEnd, 6);
  const nowIso = new Date().toISOString();
  const renewalId = newId("ren");

  await env.DB.prepare(
    `INSERT INTO premium_order_renewals (
      renewal_id, order_id, campaign_id, contracted_position, old_end_at, new_end_at,
      duration_months, price_cents, currency, price_snapshot_json, created_at, created_by, idempotency_key
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      renewalId,
      orderId,
      camp.campaign_id,
      po.position,
      oldEnd,
      newEnd,
      6,
      priceCents,
      "CZK",
      JSON.stringify({ price_cents: priceCents, placement_id: po.placement_id }),
      nowIso,
      guard.userId,
      idem
    )
    .run();

  await env.DB.prepare("UPDATE campaigns SET end_at = ?, updated_at = ? WHERE campaign_id = ?")
    .bind(newEnd, nowIso, camp.campaign_id)
    .run();
  await env.DB.prepare("UPDATE campaign_placements SET end_at = ?, updated_at = ? WHERE campaign_id = ?")
    .bind(newEnd, nowIso, camp.campaign_id)
    .run();

  await appendPremiumOrderEvent(env.DB, {
    orderId,
    eventType: "renewal_applied",
    actorUserId: guard.userId,
    payload: { old_end_at: oldEnd, new_end_at: newEnd, price_cents: priceCents, actor_label: guard.userId },
  });

  return json({ ok: true, renewal_id: renewalId, old_end_at: oldEnd, new_end_at: newEnd, price_cents: priceCents });
}

export async function handleAdminPremiumAddNote(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { body_text?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const text = typeof body.body_text === "string" ? body.body_text.trim() : "";
  if (!text || text.length > 4000) return json({ error: "invalid_note" }, 400);

  const exists = await env.DB.prepare("SELECT order_id FROM premium_selected_orders WHERE order_id = ?").bind(orderId).first();
  if (!exists) return json({ error: "not_found" }, 404);

  const nowIso = new Date().toISOString();
  const noteId = newId("pon");
  await env.DB.prepare(
    "INSERT INTO premium_order_notes (note_id, order_id, body_text, author_user_id, author_label, created_at) VALUES (?,?,?,?,?,?)"
  )
    .bind(noteId, orderId, text, guard.userId, guard.userId, nowIso)
    .run();

  await appendPremiumOrderEvent(env.DB, {
    orderId,
    eventType: "note_added",
    actorUserId: guard.userId,
    payload: { note_id: noteId, actor_label: guard.userId },
  });

  return json({ ok: true, note_id: noteId });
}

export async function handleAdminPremiumPatchOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: {
    contact_person?: unknown;
    client_contact_email?: unknown;
    contact_phone?: unknown;
    billing_info?: unknown;
    confirm?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.confirm !== true) return json({ error: "confirmation_required" }, 400);

  const orderRow = await env.DB.prepare(
    "SELECT o.contact_person, o.payload_json, o.client_id, po.client_contact_email FROM premium_selected_orders po JOIN orders o ON o.order_id = po.order_id WHERE po.order_id = ?"
  )
    .bind(orderId)
    .first<{
      contact_person: string | null;
      client_contact_email: string | null;
      payload_json: string | null;
      client_id: string;
    }>();
  if (!orderRow) return json({ error: "not_found" }, 404);

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(orderRow.payload_json || "{}") as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const prevPhone = typeof payload.contact_phone === "string" ? payload.contact_phone : null;

  const nowIso = new Date().toISOString();
  if (typeof body.contact_person === "string") {
    const next = body.contact_person.trim();
    if (next.length >= 2 && next.length <= 200) {
      await env.DB.prepare("UPDATE orders SET contact_person = ?, updated_at = ? WHERE order_id = ?")
        .bind(next, nowIso, orderId)
        .run();
      await appendPremiumOrderEvent(env.DB, {
        orderId,
        eventType: "contact_updated",
        actorUserId: guard.userId,
        payload: {
          field: "Kontaktní osoba",
          from: orderRow.contact_person,
          to: next,
          actor_label: guard.userId,
        },
      });
    }
  }
  if (typeof body.client_contact_email === "string") {
    const em = body.client_contact_email.trim();
    if (em.includes("@")) {
      await env.DB.prepare("UPDATE premium_selected_orders SET client_contact_email = ?, updated_at = ? WHERE order_id = ?")
        .bind(em, nowIso, orderId)
        .run();
      await appendPremiumOrderEvent(env.DB, {
        orderId,
        eventType: "contact_updated",
        actorUserId: guard.userId,
        payload: {
          field: "E-mail",
          from: orderRow.client_contact_email,
          to: em,
          actor_label: guard.userId,
        },
      });
    }
  }
  if (typeof body.contact_phone === "string") {
    const ph = body.contact_phone.trim();
    if (ph.length >= 6 && ph.length <= 40) {
      payload.contact_phone = ph;
      await env.DB.prepare("UPDATE orders SET payload_json = ?, updated_at = ? WHERE order_id = ?")
        .bind(JSON.stringify(payload), nowIso, orderId)
        .run();
      await appendPremiumOrderEvent(env.DB, {
        orderId,
        eventType: "contact_updated",
        actorUserId: guard.userId,
        payload: { field: "Telefon", from: prevPhone, to: ph, actor_label: guard.userId },
      });
    }
  }
  if (typeof body.billing_info === "string") {
    const bill = body.billing_info.trim();
    if (bill.length >= 5 && bill.length <= 4000) {
      const clientRow = await env.DB.prepare("SELECT billing_info FROM clients WHERE client_id = ?")
        .bind(orderRow.client_id)
        .first<{ billing_info: string | null }>();
      await env.DB.prepare("UPDATE clients SET billing_info = ?, updated_at = ? WHERE client_id = ?")
        .bind(bill, nowIso, orderRow.client_id)
        .run();
      await appendPremiumOrderEvent(env.DB, {
        orderId,
        eventType: "admin_edit",
        actorUserId: guard.userId,
        payload: {
          field: "Fakturační údaje",
          from: clientRow?.billing_info || null,
          to: bill,
          actor_label: guard.userId,
        },
      });
    }
  }

  return json({ ok: true });
}
