/**
 * Admin amendment of premium order — updates order data and regenerates order confirmation PDF (versioned).
 * Does not modify issued invoices.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, newId } from "./admin-auth";
import { appendPremiumOrderEvent } from "./premium-order-history";
import { parseCzechMoneyToCents } from "./premium-czech-money";
import { validateTargetUrl } from "./url-safety";
import { validateCzechIco } from "./czech-ico";
import {
  parsePremiumPlacementId,
  premiumPlacementId,
  PREMIUM_DURATION_MONTHS,
  type PremiumPosition,
} from "./premium-selected-services";
import { parsePremiumOrderPayload } from "./premium-order-workflow";
import { regeneratePremiumOrderConfirmationPdf } from "./premium-order-documents";
import type { Env } from "./types";

export type PremiumOrderAmendInput = {
  orderId: string;
  actorUserId: string;
  company_name?: string;
  ico?: string;
  dic?: string | null;
  billing_street?: string;
  billing_city?: string;
  billing_zip?: string;
  billing_country?: string;
  contact_person?: string;
  client_contact_email?: string;
  contact_phone?: string;
  category_slug?: string;
  position?: number;
  target_url?: string;
  creative_mode?: string;
  creative_id?: string | null;
  note_client?: string | null;
  ad_title?: string | null;
  service_start_at?: string | null;
  service_end_at?: string | null;
  price_kc?: string;
  idempotencyKey?: string;
};

export type PremiumOrderAmendResult =
  | { ok: true; order_id: string; confirmation_regenerated: boolean }
  | { ok: false; status: number; error: string; message_cs?: string };

export async function executePremiumOrderAmend(env: Env, input: PremiumOrderAmendInput): Promise<PremiumOrderAmendResult> {
  if (!env.DB) return { ok: false, status: 503, error: "auth_not_configured" };
  const db = env.DB;
  const nowIso = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT po.*, o.client_id, o.payload_json, o.contact_person, camp.campaign_id
       FROM premium_selected_orders po
       JOIN orders o ON o.order_id = po.order_id
       LEFT JOIN campaigns camp ON camp.campaign_id = po.published_campaign_id
       WHERE po.order_id = ?`
    )
    .bind(input.orderId)
    .first<Record<string, unknown>>();
  if (!row) return { ok: false, status: 404, error: "not_found" };

  const workflow = String(row.workflow_status || "");
  if (workflow === "rejected") {
    return { ok: false, status: 409, error: "rejected", message_cs: "Zamítnutou objednávku upravte jiným postupem." };
  }

  let payload = parsePremiumOrderPayload(typeof row.payload_json === "string" ? row.payload_json : null);
  let payloadRaw: Record<string, unknown> = {};
  try {
    payloadRaw = JSON.parse(String(row.payload_json || "{}")) as Record<string, unknown>;
  } catch {
    payloadRaw = {};
  }

  const clientId = String(row.client_id || "");
  const changes: string[] = [];

  if (typeof input.company_name === "string" && input.company_name.trim().length >= 2) {
    const name = input.company_name.trim().slice(0, 300);
    await db.prepare("UPDATE clients SET company_name = ?, updated_at = ? WHERE client_id = ?").bind(name, nowIso, clientId).run();
    changes.push("company_name");
  }
  if (typeof input.ico === "string") {
    const icoCheck = validateCzechIco(input.ico.trim());
    if (!icoCheck.ok) return { ok: false, status: 400, error: "invalid_ico", message_cs: "Neplatné IČO." };
    await db.prepare("UPDATE clients SET ico = ?, updated_at = ? WHERE client_id = ?").bind(icoCheck.ico, nowIso, clientId).run();
    payloadRaw.ico = icoCheck.ico;
    changes.push("ico");
  }
  if (input.dic !== undefined) {
    const dic = input.dic ? String(input.dic).trim().slice(0, 20) : null;
    await db.prepare("UPDATE clients SET dic = ?, updated_at = ? WHERE client_id = ?").bind(dic, nowIso, clientId).run();
    payloadRaw.dic = dic;
    changes.push("dic");
  }

  const billing = (payloadRaw.billing as Record<string, unknown>) || {};
  if (typeof input.billing_street === "string") billing.street = input.billing_street.trim().slice(0, 200);
  if (typeof input.billing_city === "string") billing.city = input.billing_city.trim().slice(0, 100);
  if (typeof input.billing_zip === "string") billing.zip = input.billing_zip.trim().slice(0, 20);
  if (typeof input.billing_country === "string") billing.country = input.billing_country.trim().slice(0, 2) || "CZ";
  if (Object.keys(billing).length) {
    payloadRaw.billing = billing;
    changes.push("billing");
  }

  if (typeof input.contact_person === "string" && input.contact_person.trim().length >= 2) {
    await db
      .prepare("UPDATE orders SET contact_person = ?, updated_at = ? WHERE order_id = ?")
      .bind(input.contact_person.trim().slice(0, 200), nowIso, input.orderId)
      .run();
    changes.push("contact_person");
  }
  if (typeof input.client_contact_email === "string" && input.client_contact_email.includes("@")) {
    await db
      .prepare("UPDATE premium_selected_orders SET client_contact_email = ?, updated_at = ? WHERE order_id = ?")
      .bind(input.client_contact_email.trim().slice(0, 200), nowIso, input.orderId)
      .run();
    changes.push("email");
  }
  if (typeof input.contact_phone === "string" && input.contact_phone.trim().length >= 6) {
    payloadRaw.contact_phone = input.contact_phone.trim().slice(0, 40);
    changes.push("phone");
  }
  if (typeof input.ad_title === "string") {
    payloadRaw.ad_title = input.ad_title.trim().slice(0, 200);
    changes.push("ad_title");
  }
  if (input.note_client !== undefined) {
    const note = input.note_client ? String(input.note_client).trim().slice(0, 2000) : null;
    await db.prepare("UPDATE premium_selected_orders SET note_client = ?, updated_at = ? WHERE order_id = ?").bind(note, nowIso, input.orderId).run();
    changes.push("note");
  }

  let placementId = String(row.placement_id || "");
  let categorySlug = String(row.category_slug || "");
  let position = Number(row.position) || 0;

  if (typeof input.category_slug === "string" && input.position != null) {
    const pos = Math.round(Number(input.position));
    if (pos >= 1 && pos <= 8) {
      const nextPlacement = premiumPlacementId(input.category_slug.trim(), pos as PremiumPosition);
      const parsed = parsePremiumPlacementId(nextPlacement);
      if (!parsed) return { ok: false, status: 400, error: "invalid_placement" };
      if (nextPlacement !== placementId && workflow === "published") {
        const occ = await db
          .prepare(
            "SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ? AND active_campaign_id IS NOT NULL AND active_campaign_id != ?"
          )
          .bind(nextPlacement, row.published_campaign_id || "")
          .first();
        if (occ) {
          return {
            ok: false,
            status: 409,
            error: "placement_conflict",
            message_cs: "Cílová pozice je obsazena jinou kampaní.",
          };
        }
      }
      placementId = nextPlacement;
      categorySlug = parsed.categorySlug;
      position = pos;
      payloadRaw.category_slug = categorySlug;
      payloadRaw.placement_id = placementId;
      payloadRaw.position = position;
      changes.push("placement");
    }
  }

  if (typeof input.target_url === "string") {
    const urlCheck = validateTargetUrl(input.target_url);
    if (!urlCheck.ok) return { ok: false, status: 400, error: "invalid_url", message_cs: "Neplatná cílová URL." };
    await db
      .prepare("UPDATE premium_selected_orders SET target_url = ?, updated_at = ? WHERE order_id = ?")
      .bind(urlCheck.normalized, nowIso, input.orderId)
      .run();
    changes.push("target_url");
  }
  if (typeof input.creative_mode === "string" && input.creative_mode.trim()) {
    await db
      .prepare("UPDATE premium_selected_orders SET creative_mode = ?, updated_at = ? WHERE order_id = ?")
      .bind(input.creative_mode.trim(), nowIso, input.orderId)
      .run();
    changes.push("creative_mode");
  }
  if (input.creative_id !== undefined) {
    const cid = input.creative_id ? String(input.creative_id).trim() : null;
    await db
      .prepare("UPDATE premium_selected_orders SET creative_id = ?, updated_at = ? WHERE order_id = ?")
      .bind(cid, nowIso, input.orderId)
      .run();
    changes.push("creative_id");
  }

  if (input.service_start_at !== undefined || input.service_end_at !== undefined) {
    const start = input.service_start_at ? String(input.service_start_at).trim() : null;
    const end = input.service_end_at ? String(input.service_end_at).trim() : null;
    await db
      .prepare(
        "UPDATE premium_selected_orders SET billed_service_start_at = ?, billed_service_end_at = ?, updated_at = ? WHERE order_id = ?"
      )
      .bind(start, end, nowIso, input.orderId)
      .run();
    changes.push("service_period");
  }

  if (input.price_kc != null && String(input.price_kc).trim()) {
    const parsed = parseCzechMoneyToCents(String(input.price_kc));
    if (!parsed.ok) {
      return { ok: false, status: 400, error: "invalid_price", message_cs: "Zadejte platnou cenu v Kč." };
    }
    payloadRaw.agreed_price_cents = parsed.cents;
    const snapExists = await db
      .prepare("SELECT order_id FROM premium_order_price_snapshots WHERE order_id = ?")
      .bind(input.orderId)
      .first();
    if (snapExists) {
      await db
        .prepare("UPDATE premium_order_price_snapshots SET agreed_price_cents = ?, placement_id = ? WHERE order_id = ?")
        .bind(parsed.cents, placementId, input.orderId)
        .run();
    } else {
      await db
        .prepare(
          "INSERT INTO premium_order_price_snapshots (order_id, placement_id, catalog_price_cents, agreed_price_cents, currency, duration_months, ordered_at) VALUES (?,?,?,?,?,?,?)"
        )
        .bind(input.orderId, placementId, parsed.cents, parsed.cents, "CZK", PREMIUM_DURATION_MONTHS, nowIso)
        .run();
    }
    changes.push("price");
  }

  if (changes.includes("placement") || changes.some((c) => ["category_slug", "position"].includes(c))) {
    await db
      .prepare(
        "UPDATE premium_selected_orders SET placement_id = ?, category_slug = ?, position = ?, updated_at = ? WHERE order_id = ?"
      )
      .bind(placementId, categorySlug, position, nowIso, input.orderId)
      .run();
  }

  await db
    .prepare("UPDATE orders SET payload_json = ?, updated_at = ? WHERE order_id = ?")
    .bind(JSON.stringify(payloadRaw), nowIso, input.orderId)
    .run();

  let confirmationRegenerated = false;
  if (workflow === "published" && row.published_campaign_id) {
    const inv = await db
      .prepare("SELECT invoice_id FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(input.orderId)
      .first<{ invoice_id: string }>();
    if (inv?.invoice_id) {
      const regen = await regeneratePremiumOrderConfirmationPdf(env, {
        orderId: input.orderId,
        campaignId: String(row.published_campaign_id),
        invoiceId: inv.invoice_id,
        clientId,
        actorUserId: input.actorUserId,
        replacementReason: "admin_order_amend",
      });
      confirmationRegenerated = regen.ok;
    }
  }

  await appendPremiumOrderEvent(db, {
    orderId: input.orderId,
    eventType: "admin_edit",
    actorUserId: input.actorUserId,
    payload: { fields: changes, confirmation_regenerated: confirmationRegenerated, actor_label: input.actorUserId },
  });

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: input.actorUserId,
      operation: "premium_order_amended",
      objectType: "premium_order",
      objectId: input.orderId,
      after: { changed_fields: changes, confirmation_regenerated: confirmationRegenerated },
      result: "success",
    })
  );

  return { ok: true, order_id: input.orderId, confirmation_regenerated: confirmationRegenerated };
}
