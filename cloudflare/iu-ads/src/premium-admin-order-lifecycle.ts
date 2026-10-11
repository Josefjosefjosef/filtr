/**
 * Admin lifecycle: payment, renewal, notes, edits, delete (premium selected-services orders).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { appendPremiumOrderEvent } from "./premium-order-history";
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

  const row = await env.DB.prepare(
    `SELECT po.workflow_status, po.payment_status,
            (SELECT invoice_id FROM invoices WHERE order_id = po.order_id ORDER BY created_at DESC LIMIT 1) AS invoice_id
     FROM premium_selected_orders po WHERE po.order_id = ?`
  )
    .bind(orderId)
    .first<{ workflow_status: string; payment_status: string | null; invoice_id: string | null }>();
  if (!row) return json({ error: "not_found" }, 404);
  if (row.workflow_status !== "published") {
    return json({ error: "not_published", message_cs: "Úhradu lze potvrdit jen u schválené a zveřejněné objednávky." }, 409);
  }
  if (!row.invoice_id) {
    return json({ error: "no_invoice", message_cs: "Objednávka nemá vystavenou fakturu." }, 409);
  }
  const beforeStatus = row.payment_status || "unpaid";
  if (status === "paid" && beforeStatus === "paid") {
    return json({ ok: true, payment_status: "paid", idempotent: true });
  }

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

  const actorRow = await env.DB.prepare("SELECT display_name, email FROM admin_users WHERE user_id = ?")
    .bind(guard.userId)
    .first<{ display_name: string | null; email: string | null }>();
  const actorLabel =
    (actorRow?.display_name && actorRow.display_name.trim()) ||
    (actorRow?.email && actorRow.email.trim()) ||
    "Administrátor";

  await appendPremiumOrderEvent(env.DB, {
    orderId,
    eventType: "payment_status_changed",
    actorUserId: guard.userId,
    payload: {
      from: beforeStatus,
      to: status,
      payment_received_at: receivedAt,
      actor_label: actorLabel,
    },
  });

  return json({ ok: true, payment_status: status });
}

export async function handleAdminPremiumExtend(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  return json(
    {
      error: "deprecated_extend",
      message_cs:
        "Prodloužení pouze přes novou objednávku a fakturu. Použijte akci „Prodloužit reklamu“ (extend-new-order).",
      use_path: "/v1/admin/premium/orders/" + orderId + "/extend-new-order",
    },
    410
  );
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
    .bind(noteId, orderId, text, guard.userId, null, nowIso)
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

export async function handleAdminPremiumOrderAmend(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const { executePremiumOrderAmend } = await import("./premium-admin-order-amend");
  const result = await executePremiumOrderAmend(env, {
    orderId,
    actorUserId: guard.userId,
    company_name: typeof body.company_name === "string" ? body.company_name : undefined,
    ico: typeof body.ico === "string" ? body.ico : undefined,
    dic: body.dic === null || typeof body.dic === "string" ? (body.dic as string | null) : undefined,
    billing_street: typeof body.billing_street === "string" ? body.billing_street : undefined,
    billing_city: typeof body.billing_city === "string" ? body.billing_city : undefined,
    billing_zip: typeof body.billing_zip === "string" ? body.billing_zip : undefined,
    billing_country: typeof body.billing_country === "string" ? body.billing_country : undefined,
    contact_person: typeof body.contact_person === "string" ? body.contact_person : undefined,
    client_contact_email: typeof body.client_contact_email === "string" ? body.client_contact_email : undefined,
    contact_phone: typeof body.contact_phone === "string" ? body.contact_phone : undefined,
    category_slug: typeof body.category_slug === "string" ? body.category_slug : undefined,
    position: body.position != null ? Number(body.position) : undefined,
    target_url: typeof body.target_url === "string" ? body.target_url : undefined,
    creative_mode: typeof body.creative_mode === "string" ? body.creative_mode : undefined,
    creative_id: body.creative_id === null || typeof body.creative_id === "string" ? (body.creative_id as string | null) : undefined,
    note_client: body.note_client === null || typeof body.note_client === "string" ? (body.note_client as string | null) : undefined,
    ad_title: typeof body.ad_title === "string" ? body.ad_title : undefined,
    service_start_at: typeof body.service_start_at === "string" ? body.service_start_at : undefined,
    service_end_at: typeof body.service_end_at === "string" ? body.service_end_at : undefined,
    price_kc: typeof body.price_kc === "string" ? body.price_kc : undefined,
    ordering_person_name:
      typeof body.ordering_person_name === "string" ? body.ordering_person_name : undefined,
    idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : undefined,
  });
  if (!result.ok) return json({ error: result.error, message_cs: result.message_cs }, result.status);
  return json(result);
}

export async function handleAdminPremiumExtendNewOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  let body: {
    period_start_at?: unknown;
    period_end_at?: unknown;
    price_kc?: unknown;
    idempotency_key?: unknown;
    target_url?: unknown;
    client_contact_email?: unknown;
    contact_phone?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const periodStart = typeof body.period_start_at === "string" ? body.period_start_at.trim() : "";
  const periodEnd = typeof body.period_end_at === "string" ? body.period_end_at.trim() : "";
  const priceKc = typeof body.price_kc === "string" ? body.price_kc : "";
  const idempotencyKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : "extend-new:" + orderId + ":" + periodEnd;
  const { executePremiumExtendNewOrder } = await import("./premium-admin-extend-new-order");
  const { loadPremiumOrderChainMembers, premiumOrderChainTip } = await import("./premium-order-chain");
  const chainMembers = env.DB ? await loadPremiumOrderChainMembers(env.DB, orderId) : [];
  const chainTip = premiumOrderChainTip(chainMembers);
  const sourceOrderId = chainTip?.order_id ?? orderId;
  const result = await executePremiumExtendNewOrder(env, {
    sourceOrderId,
    actorUserId: guard.userId,
    periodStartAt: periodStart,
    periodEndAt: periodEnd,
    priceKc,
    idempotencyKey,
    targetUrl: typeof body.target_url === "string" ? body.target_url : undefined,
    clientContactEmail: typeof body.client_contact_email === "string" ? body.client_contact_email : undefined,
    contactPhone: typeof body.contact_phone === "string" ? body.contact_phone : undefined,
  });
  if (!result.ok) return json({ error: result.error, message_cs: result.message_cs }, result.status);
  return json(result);
}
