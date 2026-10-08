/**
 * Premium „Schválit a zveřejnit“ — idempotent publish + invoice + email + placement lock.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { ensurePremiumOrderPortalAccess, linkCampaignToPremiumPortalCode } from "./premium-order-portal";
import { normalizeCustomerOrderCode } from "./premium-order-access-code";
import {
  addCalendarDaysFromIso,
  addCalendarMonthsFromIso,
  buildPriceSnapshot,
  parsePremiumPlacementId,
  PREMIUM_INVOICE_DUE_CALENDAR_DAYS,
  PREMIUM_PRODUCT_TYPE,
  resolveAuthoritativePriceCents,
  type PremiumPosition,
} from "./premium-selected-services";
import { enqueuePremiumEmail } from "./premium-email";
import { validateTargetUrl } from "./url-safety";
import type { Env } from "./types";

type PremiumOrderRow = {
  order_id: string;
  placement_id: string;
  category_slug: string;
  position: number;
  workflow_status: string;
  target_url: string | null;
  creative_id: string | null;
  creative_mode: string | null;
  published_campaign_id: string | null;
  client_contact_email: string | null;
};

function generateEvidenceCode(): string {
  return "AD-" + String(new Date().getFullYear()) + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

async function placementIsAvailable(
  db: D1Database,
  placementId: string,
  nowIso: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await db
    .prepare(
      `SELECT p.active_campaign_id, c.status, c.end_at
       FROM premium_selected_placements p
       LEFT JOIN campaigns c ON c.campaign_id = p.active_campaign_id
       WHERE p.placement_id = ?`
    )
    .bind(placementId)
    .first<{ active_campaign_id: string | null; status: string | null; end_at: string | null }>();
  if (!row) return { ok: false, reason: "placement_not_found" };
  if (!row.active_campaign_id) return { ok: true };
  if (row.status === "ended" || row.status === "cancelled" || row.status === "archived") return { ok: true };
  if (row.end_at && row.end_at <= nowIso) return { ok: true };
  if (row.status === "active" || row.status === "paused" || row.status === "scheduled") {
    return { ok: false, reason: "placement_occupied" };
  }
  return { ok: true };
}

export async function executePremiumApproveAndPublish(
  env: Env,
  input: {
    orderId: string;
    actorUserId: string;
    idempotencyKey: string;
  }
): Promise<
  | { ok: true; campaign_id: string; invoice_id: string; already: boolean }
  | { ok: false; status: number; error: string; missing?: string[] }
> {
  if (!env.DB) return { ok: false, status: 503, error: "auth_not_configured" };
  const db = env.DB;
  const nowIso = new Date().toISOString();

  const prior = await db
    .prepare("SELECT result_json FROM premium_publish_events WHERE idempotency_key = ?")
    .bind(input.idempotencyKey)
    .first<{ result_json: string }>();
  if (prior) {
    try {
      const parsed = JSON.parse(prior.result_json) as { campaign_id: string; invoice_id: string };
      try {
        const orderRow = await db
          .prepare("SELECT client_id FROM orders WHERE order_id = ?")
          .bind(input.orderId)
          .first<{ client_id: string }>();
        if (orderRow) {
          const { ensurePremiumOrderDocumentsAfterPublish } = await import("./premium-order-documents");
          await ensurePremiumOrderDocumentsAfterPublish(env, {
            orderId: input.orderId,
            campaignId: parsed.campaign_id,
            invoiceId: parsed.invoice_id,
            clientId: orderRow.client_id,
            actorUserId: input.actorUserId,
            publishIdempotencyKey: input.idempotencyKey,
          });
        }
      } catch {
        /* non-blocking */
      }
      return { ok: true, campaign_id: parsed.campaign_id, invoice_id: parsed.invoice_id, already: true };
    } catch {
      return { ok: false, status: 409, error: "idempotency_corrupt" };
    }
  }

  const po = await db
    .prepare(
      "SELECT order_id, placement_id, category_slug, position, workflow_status, target_url, creative_id, creative_mode, published_campaign_id, client_contact_email FROM premium_selected_orders WHERE order_id = ?"
    )
    .bind(input.orderId)
    .first<PremiumOrderRow>();
  if (!po) return { ok: false, status: 404, error: "premium_order_not_found" };
  if (po.published_campaign_id) {
    return { ok: false, status: 409, error: "already_published" };
  }
  if (!["submitted", "under_review"].includes(po.workflow_status)) {
    return { ok: false, status: 409, error: "invalid_workflow_status" };
  }
  if (!po.creative_id || !po.target_url) {
    const missing: string[] = [];
    if (!po.target_url) missing.push("target_url");
    if (!po.creative_id) missing.push("creative");
    return { ok: false, status: 400, error: "missing_creative_or_url", missing };
  }

  const urlCheck = validateTargetUrl(po.target_url);
  if (!urlCheck.ok) return { ok: false, status: 400, error: urlCheck.reason };

  const creative = await db
    .prepare("SELECT creative_id, client_id, review_status, content_hash, format, campaign_id FROM creatives WHERE creative_id = ?")
    .bind(po.creative_id)
    .first<{ creative_id: string; client_id: string; review_status: string; content_hash: string; format: string; campaign_id: string | null }>();
  if (!creative) return { ok: false, status: 404, error: "creative_not_found" };

  const order = await db
    .prepare("SELECT order_id, client_id, order_number, customer_order_code FROM orders WHERE order_id = ?")
    .bind(input.orderId)
    .first<{ order_id: string; client_id: string; order_number: string; customer_order_code: string | null }>();
  if (!order) return { ok: false, status: 404, error: "order_not_found" };

  let renewalOfferId: string | null = null;
  let renewalPredecessorCampaignId: string | null = null;
  let renewalOfferedPriceCents: number | null = null;
  const orderPayloadRow = await db
    .prepare("SELECT payload_json FROM orders WHERE order_id = ?")
    .bind(input.orderId)
    .first<{ payload_json: string | null }>();
  if (orderPayloadRow?.payload_json) {
    try {
      const payload = JSON.parse(orderPayloadRow.payload_json) as {
        product?: string;
        renewal_offer_id?: string;
        agreed_price_cents?: number;
      };
      if (payload.product === "premium_selected_services_renewal_v1" && payload.renewal_offer_id) {
        renewalOfferId = payload.renewal_offer_id;
        const offer = await db
          .prepare(
            "SELECT offer_id, campaign_id, offered_price_cents, status, accepted_order_id FROM premium_renewal_offers WHERE offer_id = ?"
          )
          .bind(renewalOfferId)
          .first<{
            offer_id: string;
            campaign_id: string;
            offered_price_cents: number;
            status: string;
            accepted_order_id: string | null;
          }>();
        if (!offer || offer.status !== "accepted" || offer.accepted_order_id !== input.orderId) {
          return { ok: false, status: 409, error: "renewal_offer_not_accepted" };
        }
        renewalPredecessorCampaignId = offer.campaign_id;
        renewalOfferedPriceCents = Math.round(offer.offered_price_cents);
      }
    } catch {
      return { ok: false, status: 400, error: "invalid_order_payload" };
    }
  }

  const placementRow = await db
    .prepare("SELECT current_price_cents, currency FROM premium_selected_placements WHERE placement_id = ?")
    .bind(po.placement_id)
    .first<{ current_price_cents: number; currency: string }>();
  if (!placementRow) return { ok: false, status: 404, error: "placement_not_found" };

  const parsedPlacement = parsePremiumPlacementId(po.placement_id);
  const position = (parsedPlacement?.position ?? po.position) as PremiumPosition;
  let priceCents = resolveAuthoritativePriceCents(
    po.placement_id,
    position,
    placementRow.current_price_cents,
    null
  );
  if (renewalOfferedPriceCents != null && renewalOfferedPriceCents > 0) {
    priceCents = renewalOfferedPriceCents;
  }

  const slotFree = await placementIsAvailable(db, po.placement_id, nowIso);
  let scheduledRenewalSuccessor = false;
  if (!slotFree.ok) {
    if (renewalPredecessorCampaignId) {
      const occ = await db
        .prepare("SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?")
        .bind(po.placement_id)
        .first<{ active_campaign_id: string | null }>();
      if (occ?.active_campaign_id === renewalPredecessorCampaignId) {
        scheduledRenewalSuccessor = true;
      } else {
        return { ok: false, status: 409, error: slotFree.reason };
      }
    } else {
      return { ok: false, status: 409, error: slotFree.reason };
    }
  }

  let startAt = nowIso;
  if (renewalPredecessorCampaignId) {
    const prevEnd = await db
      .prepare("SELECT end_at FROM campaigns WHERE campaign_id = ?")
      .bind(renewalPredecessorCampaignId)
      .first<{ end_at: string | null }>();
    if (prevEnd?.end_at) startAt = prevEnd.end_at;
  }
  const endAt = addCalendarMonthsFromIso(startAt, 6);
  const campaignStatus = scheduledRenewalSuccessor && startAt > nowIso ? "scheduled" : "active";
  const campaignId = newId("cmp");
  const evidenceCode = generateEvidenceCode();
  const title = "Premium " + po.category_slug + " P" + String(po.position);

  await db
    .prepare(
      `INSERT INTO campaigns (
        campaign_id, evidence_code, client_id, order_id, title, status, label_type,
        start_at, end_at, actual_start_at, target_url, price_ex_vat_cents, price_cents, vat_cents,
        pricing_model, devices_json, sections_json, client_report_enabled, client_export_enabled,
        note_client, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      campaignId,
      evidenceCode,
      order.client_id,
      order.order_id,
      title,
      campaignStatus,
      "Reklama",
      startAt,
      endAt,
      campaignStatus === "active" ? startAt : null,
      urlCheck.normalized,
      priceCents,
      priceCents,
      0,
      PREMIUM_PRODUCT_TYPE,
      JSON.stringify(["pc", "mobile", "tablet"]),
      JSON.stringify([po.category_slug]),
      0,
      0,
      "Prémiová pozice ve Vybraných službách a odkazech.",
      nowIso,
      nowIso
    )
    .run();

  await db
    .prepare(
      "INSERT INTO campaign_status_events (event_id, campaign_id, from_status, to_status, actor_user_id, reason, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(newId("cse"), campaignId, null, campaignStatus, input.actorUserId, "premium_publish", nowIso)
    .run();

  await db
    .prepare(
      "INSERT INTO rights_confirmations (confirmation_id, campaign_id, confirmed_by_name, confirmed_at, statement_text, terms_version, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(
      newId("rcf"),
      campaignId,
      "InfoUzel Ads — premium selected services",
      nowIso,
      "Klient potvrdil práva k reklamní kreativitě pro prémiovou pozici ve Vybraných službách.",
      "premium-selected-v1",
      nowIso
    )
    .run();

  await db
    .prepare(
      "UPDATE creatives SET campaign_id = ?, review_status = 'approved', approved_at = ?, approved_by = ?, updated_at = ? WHERE creative_id = ?"
    )
    .bind(campaignId, nowIso, input.actorUserId, nowIso, po.creative_id)
    .run();

  await db
    .prepare(
      "INSERT INTO campaign_placements (campaign_placement_id, campaign_id, placement_id, placement_type_id, section_id, device_category, priority, start_at, end_at, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(
      newId("cpl"),
      campaignId,
      po.placement_id,
      "pt_premium_selected_services",
      po.category_slug,
      "pc",
      po.position,
      startAt,
      endAt,
      campaignStatus,
      nowIso,
      nowIso
    )
    .run();

  if (!scheduledRenewalSuccessor) {
    const occupied = await db
      .prepare(
        "UPDATE premium_selected_placements SET active_campaign_id = ?, updated_at = ? WHERE placement_id = ? AND (active_campaign_id IS NULL OR active_campaign_id = ?)"
      )
      .bind(campaignId, nowIso, po.placement_id, campaignId)
      .run();
    if (!occupied.meta.changes) {
      return { ok: false, status: 409, error: "placement_race" };
    }
  }

  const snapshot = buildPriceSnapshot({
    placementId: po.placement_id,
    catalogPriceCents: priceCents,
    agreedPriceCents: priceCents,
    currency: placementRow.currency || "CZK",
    orderedAt: nowIso,
  });
  await db
    .prepare(
      "INSERT INTO premium_order_price_snapshots (order_id, placement_id, catalog_price_cents, agreed_price_cents, currency, duration_months, ordered_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(
      order.order_id,
      po.placement_id,
      snapshot.catalog_price_cents,
      snapshot.agreed_price_cents,
      snapshot.currency,
      snapshot.duration_months,
      snapshot.ordered_at
    )
    .run();

  const invoiceId = newId("inv");
  const invoiceNumber = "INV-" + String(new Date().getFullYear()) + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const dueAt = addCalendarDaysFromIso(nowIso, PREMIUM_INVOICE_DUE_CALENDAR_DAYS);
  await db
    .prepare(
      "INSERT INTO invoices (invoice_id, client_id, order_id, campaign_id, invoice_number, status, issued_at, due_at, tax_base_cents, vat_cents, total_cents, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(
      invoiceId,
      order.client_id,
      order.order_id,
      campaignId,
      invoiceNumber,
      "issued",
      nowIso,
      dueAt,
      priceCents,
      0,
      priceCents,
      placementRow.currency || "CZK",
      nowIso,
      nowIso
    )
    .run();

  await db
    .prepare("UPDATE campaigns SET invoice_id = ? WHERE campaign_id = ?")
    .bind(invoiceId, campaignId)
    .run();

  const actorRow = await db
    .prepare("SELECT display_name FROM admin_users WHERE user_id = ?")
    .bind(input.actorUserId)
    .first<{ display_name: string }>();
  const publishedByDisplayName =
    typeof actorRow?.display_name === "string" && actorRow.display_name.trim() ? actorRow.display_name.trim() : null;

  await db
    .prepare(
      "UPDATE premium_selected_orders SET workflow_status = 'published', published_campaign_id = ?, published_at = ?, publish_idempotency_key = ?, published_by_display_name = ?, updated_at = ? WHERE order_id = ?"
    )
    .bind(campaignId, nowIso, input.idempotencyKey, publishedByDisplayName, nowIso, input.orderId)
    .run();

  try {
    const { appendPremiumOrderEvent } = await import("./premium-order-history");
    await appendPremiumOrderEvent(db, {
      orderId: input.orderId,
      eventType: "order_approved_published",
      actorUserId: input.actorUserId,
      payload: { campaign_id: campaignId, actor_label: input.actorUserId },
      createdAt: nowIso,
    });
  } catch {
    /* events table optional until migration */
  }

  await db
    .prepare("UPDATE orders SET status = 'completed', updated_at = ? WHERE order_id = ?")
    .bind(nowIso, order.order_id)
    .run();

  const resultJson = JSON.stringify({ campaign_id: campaignId, invoice_id: invoiceId });
  await db
    .prepare("INSERT INTO premium_publish_events (event_id, order_id, idempotency_key, result_json, created_at) VALUES (?,?,?,?,?)")
    .bind(newId("ppe"), input.orderId, input.idempotencyKey, resultJson, nowIso)
    .run();

  let accessCodePlain: string | null = null;
  if (env.ADS_CODE_PEPPER) {
    const rawCode =
      typeof order.customer_order_code === "string" && order.customer_order_code.trim()
        ? order.customer_order_code
        : order.order_number;
    try {
      await ensurePremiumOrderPortalAccess(db, env.ADS_CODE_PEPPER, {
        orderId: input.orderId,
        clientId: order.client_id,
        customerOrderCode: rawCode,
        createdBy: input.actorUserId,
      });
      await linkCampaignToPremiumPortalCode(db, input.orderId, campaignId);
      accessCodePlain = normalizeCustomerOrderCode(rawCode);
    } catch {
      accessCodePlain = null;
    }
  }

  if (po.client_contact_email) {
    const priceLabel = (priceCents / 100).toLocaleString("cs-CZ") + " Kč bez DPH / 6 měsíců";
    const bodyText = [
      "Vaše prémiová reklama byla schválena a zveřejněna.",
      "",
      "Kategorie: " + po.category_slug,
      "Pozice: P" + String(po.position),
      "Začátek: " + startAt,
      "Konec: " + endAt,
      "Cena: " + priceLabel,
      "Faktura: " + invoiceNumber,
      "Splatnost: " + dueAt,
      "",
      "Klientský portál: https://ads.infouzel.cz/client",
      accessCodePlain ? "Přístupový kód (uchovejte): " + accessCodePlain : "Přístupový kód vám vydá obchodní kontakt, pokud jej ještě nemáte.",
      "",
      "Změna loga/banneru nebo URL vyžaduje nové schválení.",
    ].join("\n");
    await enqueuePremiumEmail(db, env, {
      to: po.client_contact_email,
      subject: "InfoUzel — prémiová reklama zveřejněna",
      bodyText,
      idempotencyKey: "premium_publish_email:" + input.idempotencyKey,
    });
  }

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: input.actorUserId,
      operation: "premium_approve_and_publish",
      objectType: "premium_order",
      objectId: input.orderId,
      before: { workflow_status: po.workflow_status },
      after: { campaign_id: campaignId, invoice_id: invoiceId, placement_id: po.placement_id },
      result: "success",
    })
  );

  try {
    const { ensurePremiumOrderDocumentsAfterPublish } = await import("./premium-order-documents");
    await ensurePremiumOrderDocumentsAfterPublish(env, {
      orderId: input.orderId,
      campaignId,
      invoiceId,
      clientId: order.client_id,
      actorUserId: input.actorUserId,
      publishIdempotencyKey: input.idempotencyKey,
    });
  } catch {
    /* PDF generation must not roll back publish */
  }

  return { ok: true, campaign_id: campaignId, invoice_id: invoiceId, already: false };
}

export async function handleAdminPremiumApprovePublish(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!hasActivate(guard.roles)) return json({ error: "forbidden_activate" }, 403);

  let body: { idempotency_key?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const idempotencyKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : "publish:" + orderId;

  const result = await executePremiumApproveAndPublish(env, {
    orderId,
    actorUserId: guard.userId,
    idempotencyKey,
  });
  if (!result.ok) {
    if ("missing" in result && result.missing) {
      return json({ error: result.error, missing: result.missing }, result.status);
    }
    return json({ error: result.error }, result.status);
  }
  return json({ ok: true, campaign_id: result.campaign_id, invoice_id: result.invoice_id, idempotent: result.already });
}

function hasActivate(roles: readonly string[]): boolean {
  return roles.includes("main_admin") || roles.includes("ads_manager");
}
