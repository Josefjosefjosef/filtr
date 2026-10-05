/**
 * Client portal — premium selected-services dashboard (no impressions/clicks/CTR).
 */
import { json } from "./admin-auth";
import { requireClientSession } from "./client-auth";
import { signObjectAccess } from "./signed-access";
import {
  formatPremiumTotalPriceLabelCs,
  PREMIUM_DURATION_MONTHS,
  PREMIUM_PRODUCT_TYPE,
} from "./premium-selected-services";
import type { Env } from "./types";

async function signedCreativePreviewUrl(origin: string, env: Env, r2Key: string): Promise<string | null> {
  if (!env.ADS_R2_SIGNING_SECRET || !r2Key) return null;
  const exp = Math.floor(Date.now() / 1000) + 900;
  const sig = await signObjectAccess(env.ADS_R2_SIGNING_SECRET, { objectKey: r2Key, bucket: "CREATIVES", exp });
  return (
    origin +
    "/v1/objects/get?bucket=CREATIVES&key=" +
    encodeURIComponent(r2Key) +
    "&exp=" +
    String(exp) +
    "&sig=" +
    encodeURIComponent(sig)
  );
}

export async function handleClientPremiumSummary(request: Request, env: Env, url: URL): Promise<Response> {
  const session = await requireClientSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const clientId = session.context.clientId;
  const origin = url.origin;

  const orders = await env.DB.prepare(
    `SELECT po.*, o.order_number, o.status AS order_status, o.payload_json
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     WHERE o.client_id = ?
     ORDER BY po.created_at DESC`
  )
    .bind(clientId)
    .all<Record<string, unknown>>();

  const campaigns = await env.DB.prepare(
    "SELECT campaign_id, order_id, title, status, start_at, end_at, target_url, price_ex_vat_cents, invoice_id FROM campaigns WHERE client_id = ? AND pricing_model = ?"
  )
    .bind(clientId, PREMIUM_PRODUCT_TYPE)
    .all<Record<string, unknown>>();

  const invoices = await env.DB.prepare(
    `SELECT invoice_id, order_id, campaign_id, invoice_number, status, issued_at, due_at, total_cents, currency
     FROM invoices WHERE client_id = ? AND campaign_id IN (
       SELECT campaign_id FROM campaigns WHERE client_id = ? AND pricing_model = ?
     )`
  )
    .bind(clientId, clientId, PREMIUM_PRODUCT_TYPE)
    .all<Record<string, unknown>>();

  const offers = await env.DB.prepare(
    `SELECT offer_id, campaign_id, placement_id, offered_price_cents, currency, window_start_at, window_end_at, status, accepted_order_id
     FROM premium_renewal_offers WHERE client_id = ? ORDER BY created_at DESC`
  )
    .bind(clientId)
    .all<Record<string, unknown>>();

  const snapshots = await env.DB.prepare(
    "SELECT order_id, agreed_price_cents, catalog_price_cents, currency, duration_months, ordered_at FROM premium_order_price_snapshots WHERE order_id IN (SELECT order_id FROM orders WHERE client_id = ?)"
  )
    .bind(clientId)
    .all<Record<string, unknown>>();

  const creativeIds = new Set<string>();
  for (const row of orders.results || []) {
    const cid = row.creative_id;
    if (typeof cid === "string" && cid) creativeIds.add(cid);
  }

  const creativeRows: Record<string, Record<string, unknown>> = {};
  for (const cid of creativeIds) {
    const cr = await env.DB.prepare(
      "SELECT creative_id, format, review_status, r2_key, campaign_id, approved_at FROM creatives WHERE creative_id = ? AND client_id = ?"
    )
      .bind(cid, clientId)
      .first<Record<string, unknown>>();
    if (cr) {
      const previewUrl =
        typeof cr.r2_key === "string" ? await signedCreativePreviewUrl(origin, env, cr.r2_key) : null;
      creativeRows[cid] = {
        creative_id: cr.creative_id,
        format: cr.format,
        review_status: cr.review_status,
        preview_url: previewUrl,
        approved_at: cr.approved_at,
      };
    }
  }

  const nowMs = Date.now();
  const periods = (orders.results || []).map((po) => {
    const orderId = String(po.order_id);
    const camp = (campaigns.results || []).find((c) => c.order_id === orderId || c.campaign_id === po.published_campaign_id);
    const snap = (snapshots.results || []).find((s) => s.order_id === orderId);
    const inv = camp
      ? (invoices.results || []).find((i) => i.campaign_id === camp.campaign_id || i.order_id === orderId)
      : null;
    const creativeId = typeof po.creative_id === "string" ? po.creative_id : "";
    const creative = creativeId ? creativeRows[creativeId] : null;
    const endAt = camp && typeof camp.end_at === "string" ? camp.end_at : null;
    let remainingDays: number | null = null;
    if (endAt) {
      const endMs = Date.parse(endAt);
      if (!Number.isNaN(endMs)) remainingDays = Math.max(0, Math.ceil((endMs - nowMs) / 86400000));
    }
    return {
      order_id: orderId,
      order_number: po.order_number,
      placement_id: po.placement_id,
      category_slug: po.category_slug,
      position: po.position,
      position_label: "P" + String(po.position),
      workflow_status: po.workflow_status,
      creative_mode: po.creative_mode,
      approved_target_url: po.target_url,
      pending_target_url: null,
      creative,
      campaign: camp
        ? {
            campaign_id: camp.campaign_id,
            status: camp.status,
            start_at: camp.start_at,
            end_at: camp.end_at,
            target_url: camp.target_url,
          }
        : null,
      price_snapshot: snap
        ? {
            agreed_price_cents: snap.agreed_price_cents,
            catalog_price_cents: snap.catalog_price_cents,
            currency: snap.currency,
            duration_months: snap.duration_months,
            price_label_cs: formatPremiumTotalPriceLabelCs(Number(snap.agreed_price_cents)),
          }
        : null,
      invoice: inv
        ? {
            invoice_id: inv.invoice_id,
            invoice_number: inv.invoice_number,
            status: inv.status,
            due_at: inv.due_at,
            issued_at: inv.issued_at,
            total_cents: inv.total_cents,
            currency: inv.currency,
          }
        : null,
      remaining_days: remainingDays,
      duration_months: PREMIUM_DURATION_MONTHS,
    };
  });

  const renewalOffers = (offers.results || []).map((o) => ({
    offer_id: o.offer_id,
    campaign_id: o.campaign_id,
    placement_id: o.placement_id,
    offered_price_cents: o.offered_price_cents,
    price_label_cs: formatPremiumTotalPriceLabelCs(Number(o.offered_price_cents)),
    currency: o.currency,
    window_start_at: o.window_start_at,
    window_end_at: o.window_end_at,
    status: o.status,
    accepted_order_id: o.accepted_order_id,
  }));

  return json({
    product: PREMIUM_PRODUCT_TYPE,
    client_id: clientId,
    measurement: { impressions: false, clicks: false, ctr: false },
    disclosure:
      "InfoUzel.cz nesleduje zobrazení ani prokliky prémiových reklamních pozic. Prodloužení není automatické — cena dalšího období odpovídá aktuálnímu ceníku v době přijetí nabídky.",
    periods,
    renewal_offers: renewalOffers,
  });
}
