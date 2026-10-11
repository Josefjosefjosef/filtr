/**
 * Admin: extend active published ad via a new child order + auto invoice + campaign end update.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, newId } from "./admin-auth";
import { appendPremiumOrderEvent } from "./premium-order-history";
import { parseCzechMoneyToCents } from "./premium-czech-money";
import { generateCustomerOrderCode } from "./premium-order-access-code";
import { ensurePremiumOrderDocumentsAfterPublish } from "./premium-order-documents";
import {
  addCalendarDaysFromIso,
  buildPriceSnapshot,
  PREMIUM_INVOICE_DUE_CALENDAR_DAYS,
  PREMIUM_PRODUCT_TYPE,
} from "./premium-selected-services";
import { parsePremiumOrderPayload } from "./premium-order-workflow";
import type { Env } from "./types";

export type ExtendNewOrderInput = {
  sourceOrderId: string;
  actorUserId: string;
  periodStartAt: string;
  periodEndAt: string;
  priceKc: string;
  idempotencyKey: string;
};

export type ExtendNewOrderResult =
  | {
      ok: true;
      idempotent?: boolean;
      new_order_id: string;
      new_order_number: string;
      invoice_id: string;
      invoice_number: string;
      campaign_end_at: string;
    }
  | { ok: false; status: number; error: string; message_cs?: string };

export async function premiumOrderEligibleForExtendNewOrder(
  db: D1Database,
  orderId: string,
  nowIso: string
): Promise<{ ok: true } | { ok: false; error: string; message_cs: string }> {
  const po = await db
    .prepare(
      `SELECT po.workflow_status, po.ad_turned_off_at, po.accounting_cancelled_at, po.published_campaign_id, po.placement_id
       FROM premium_selected_orders po WHERE po.order_id = ?`
    )
    .bind(orderId)
    .first<{
      workflow_status: string;
      ad_turned_off_at: string | null;
      accounting_cancelled_at: string | null;
      published_campaign_id: string | null;
      placement_id: string;
    }>();
  if (!po) return { ok: false, error: "not_found", message_cs: "Objednávka nenalezena." };
  if (po.workflow_status !== "published") {
    return { ok: false, error: "not_active", message_cs: "Prodloužení je možné pouze u zveřejněné aktivní reklamy." };
  }
  if (po.ad_turned_off_at) {
    return { ok: false, error: "ad_turned_off", message_cs: "Reklama byla definitivně vypnuta." };
  }
  if (po.accounting_cancelled_at) {
    return { ok: false, error: "accounting_cancelled", message_cs: "Objednávka byla účetně stornována." };
  }
  if (!po.published_campaign_id) {
    return { ok: false, error: "no_campaign", message_cs: "Chybí aktivní kampaň." };
  }
  const camp = await db
    .prepare("SELECT status, end_at FROM campaigns WHERE campaign_id = ?")
    .bind(po.published_campaign_id)
    .first<{ status: string; end_at: string | null }>();
  if (!camp || camp.status !== "active" || !camp.end_at) {
    return { ok: false, error: "campaign_not_active", message_cs: "Kampaň není aktivní." };
  }
  if (Date.parse(camp.end_at) <= Date.parse(nowIso)) {
    return { ok: false, error: "campaign_expired", message_cs: "Reklamní období již skončilo." };
  }
  const pl = await db
    .prepare("SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?")
    .bind(po.placement_id)
    .first<{ active_campaign_id: string | null }>();
  if (pl?.active_campaign_id !== po.published_campaign_id) {
    return { ok: false, error: "placement_mismatch", message_cs: "Pozice neodpovídá aktivní kampani." };
  }
  const pending = await db
    .prepare(
      "SELECT order_id FROM premium_selected_orders WHERE placement_id = ? AND workflow_status IN ('submitted','under_review') AND order_id != ? LIMIT 1"
    )
    .bind(po.placement_id, orderId)
    .first();
  if (pending) {
    return {
      ok: false,
      error: "placement_reserved",
      message_cs: "Na pozici čeká jiná objednávka ke schválení — prodloužení zablokováno.",
    };
  }
  return { ok: true };
}

export async function executePremiumExtendNewOrder(env: Env, input: ExtendNewOrderInput): Promise<ExtendNewOrderResult> {
  if (!env.DB) return { ok: false, status: 503, error: "auth_not_configured" };
  const db = env.DB;
  const nowIso = new Date().toISOString();
  const idem = input.idempotencyKey.trim();
  if (!idem) return { ok: false, status: 400, error: "idempotency_required" };

  const prior = await db
    .prepare("SELECT follow_up_order_id, new_end_at FROM premium_order_renewals WHERE idempotency_key = ?")
    .bind(idem)
    .first<{ follow_up_order_id: string | null; new_end_at: string }>();
  if (prior?.follow_up_order_id) {
    const inv = await db
      .prepare("SELECT invoice_id, invoice_number FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(prior.follow_up_order_id)
      .first<{ invoice_id: string; invoice_number: string }>();
    const ord = await db
      .prepare("SELECT customer_order_code, order_number FROM orders WHERE order_id = ?")
      .bind(prior.follow_up_order_id)
      .first<{ customer_order_code: string | null; order_number: string }>();
    return {
      ok: true,
      idempotent: true,
      new_order_id: prior.follow_up_order_id,
      new_order_number: ord?.customer_order_code || ord?.order_number || prior.follow_up_order_id,
      invoice_id: inv?.invoice_id || "",
      invoice_number: inv?.invoice_number || "",
      campaign_end_at: prior.new_end_at,
    };
  }

  const eligible = await premiumOrderEligibleForExtendNewOrder(db, input.sourceOrderId, nowIso);
  if (!eligible.ok) return { ok: false, status: 409, error: eligible.error, message_cs: eligible.message_cs };

  const priceParsed = parseCzechMoneyToCents(input.priceKc);
  if (!priceParsed.ok) {
    return { ok: false, status: 400, error: "invalid_price", message_cs: "Zadejte platnou cenu nového období." };
  }
  const startMs = Date.parse(input.periodStartAt);
  const endMs = Date.parse(input.periodEndAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { ok: false, status: 400, error: "invalid_period", message_cs: "Neplatné období prodloužení." };
  }

  const src = await db
    .prepare(
      `SELECT po.*, o.client_id, o.payload_json, o.contact_person, camp.end_at AS camp_end_at, camp.campaign_id
       FROM premium_selected_orders po
       JOIN orders o ON o.order_id = po.order_id
       JOIN campaigns camp ON camp.campaign_id = po.published_campaign_id
       WHERE po.order_id = ?`
    )
    .bind(input.sourceOrderId)
    .first<Record<string, unknown>>();
  if (!src) return { ok: false, status: 404, error: "not_found" };

  const campEnd = String(src.camp_end_at || "");
  if (Math.abs(Date.parse(input.periodStartAt) - Date.parse(campEnd)) > 60000) {
    return {
      ok: false,
      status: 400,
      error: "period_gap",
      message_cs: "Začátek nového období musí navazovat na konec aktuální kampaně (" + campEnd + ").",
    };
  }

  const payload = parsePremiumOrderPayload(typeof src.payload_json === "string" ? src.payload_json : null);
  let payloadRaw: Record<string, unknown> = {};
  try {
    payloadRaw = JSON.parse(String(src.payload_json || "{}")) as Record<string, unknown>;
  } catch {
    payloadRaw = {};
  }
  payloadRaw.agreed_price_cents = priceParsed.cents;

  const newOrderId = newId("ord");
  const customerCode = generateCustomerOrderCode();
  const orderNumber = customerCode.plaintext;
  const campaignId = String(src.campaign_id);
  const clientId = String(src.client_id);
  const priceCents = priceParsed.cents;
  const placementId = String(src.placement_id);

  const invoiceId = newId("inv");
  const invoiceNumber = "INV-" + String(new Date().getFullYear()) + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const dueAt = addCalendarDaysFromIso(nowIso, PREMIUM_INVOICE_DUE_CALENDAR_DAYS);
  const renewalId = newId("ren");

  await db
    .prepare(
      "INSERT INTO orders (order_id, client_id, order_number, status, contact_person, customer_order_code, payload_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .bind(
      newOrderId,
      clientId,
      orderNumber,
      "completed",
      src.contact_person,
      orderNumber,
      JSON.stringify({ ...payloadRaw, product: PREMIUM_PRODUCT_TYPE, parent_order_id: input.sourceOrderId }),
      nowIso,
      nowIso
    )
    .run();

  await db
    .prepare(
      `INSERT INTO premium_selected_orders (
        order_id, placement_id, category_slug, position, workflow_status, target_url, creative_mode, creative_id,
        client_contact_email, note_client, published_campaign_id, published_at, publish_idempotency_key,
        parent_order_id, billed_service_start_at, billed_service_end_at, payment_status, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      newOrderId,
      placementId,
      src.category_slug,
      src.position,
      "published",
      src.target_url,
      src.creative_mode,
      src.creative_id,
      src.client_contact_email,
      src.note_client,
      campaignId,
      nowIso,
      idem,
      input.sourceOrderId,
      input.periodStartAt,
      input.periodEndAt,
      "unpaid",
      nowIso,
      nowIso
    )
    .run();

  const snap = buildPriceSnapshot({
    placementId,
    catalogPriceCents: priceCents,
    agreedPriceCents: priceCents,
    currency: "CZK",
    orderedAt: nowIso,
  });
  await db
    .prepare(
      "INSERT INTO premium_order_price_snapshots (order_id, placement_id, catalog_price_cents, agreed_price_cents, currency, duration_months, ordered_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(newOrderId, placementId, snap.catalog_price_cents, snap.agreed_price_cents, snap.currency, snap.duration_months, snap.ordered_at)
    .run();

  await db
    .prepare(
      "INSERT INTO invoices (invoice_id, client_id, order_id, campaign_id, invoice_number, status, issued_at, due_at, tax_base_cents, vat_cents, total_cents, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(invoiceId, clientId, newOrderId, campaignId, invoiceNumber, "issued", nowIso, dueAt, priceCents, 0, priceCents, "CZK", nowIso, nowIso)
    .run();

  await db.prepare("UPDATE campaigns SET end_at = ?, updated_at = ? WHERE campaign_id = ?").bind(input.periodEndAt, nowIso, campaignId).run();
  await db
    .prepare("UPDATE campaign_placements SET end_at = ?, updated_at = ? WHERE campaign_id = ?")
    .bind(input.periodEndAt, nowIso, campaignId)
    .run();

  await db
    .prepare(
      `INSERT INTO premium_order_renewals (
        renewal_id, order_id, campaign_id, contracted_position, old_end_at, new_end_at, duration_months, price_cents, currency,
        price_snapshot_json, created_at, created_by, idempotency_key, follow_up_order_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      renewalId,
      input.sourceOrderId,
      campaignId,
      src.position,
      campEnd,
      input.periodEndAt,
      snap.duration_months,
      priceCents,
      "CZK",
      JSON.stringify({ price_cents: priceCents, child_order_id: newOrderId }),
      nowIso,
      input.actorUserId,
      idem,
      newOrderId
    )
    .run();

  await appendPremiumOrderEvent(db, {
    orderId: input.sourceOrderId,
    eventType: "renewal_applied",
    actorUserId: input.actorUserId,
    payload: {
      child_order_id: newOrderId,
      invoice_number: invoiceNumber,
      old_end_at: campEnd,
      new_end_at: input.periodEndAt,
      price_cents: priceCents,
      actor_label: input.actorUserId,
    },
  });
  await appendPremiumOrderEvent(db, {
    orderId: newOrderId,
    eventType: "order_approved_published",
    actorUserId: input.actorUserId,
    payload: { extension_of: input.sourceOrderId, campaign_id: campaignId, actor_label: input.actorUserId },
  });

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: input.actorUserId,
      operation: "premium_extend_new_order",
      objectType: "premium_order",
      objectId: newOrderId,
      after: { source_order_id: input.sourceOrderId, invoice_id: invoiceId, campaign_end_at: input.periodEndAt },
      result: "success",
    })
  );

  try {
    await ensurePremiumOrderDocumentsAfterPublish(env, {
      orderId: newOrderId,
      campaignId,
      invoiceId,
      clientId,
      actorUserId: input.actorUserId,
      publishIdempotencyKey: idem,
    });
  } catch {
    /* PDF async recovery */
  }

  return {
    ok: true,
    new_order_id: newOrderId,
    new_order_number: orderNumber,
    invoice_id: invoiceId,
    invoice_number: invoiceNumber,
    campaign_end_at: input.periodEndAt,
  };
}
