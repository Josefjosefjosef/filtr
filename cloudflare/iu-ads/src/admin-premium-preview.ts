/**
 * Admin premium order detail + creative preview (same geometry as public card).
 */
import { json, requireAdminPermission } from "./admin-auth";
import { premiumCreativeModeLabelCs, premiumCreativeSlotClassSuffix } from "./premium-creative-mode";
import {
  formatAdminPragueDateTime,
  isPremiumOrderPublishable,
  parsePremiumOrderPayload,
  premiumOrderMissingPublishFields,
  premiumWorkflowStatusLabelCs,
} from "./premium-order-workflow";
import { formatPremiumTotalPriceLabelCs, premiumCategoryTitleCs, PREMIUM_DURATION_MONTHS } from "./premium-selected-services";
import { signObjectAccess } from "./signed-access";
import type { Env } from "./types";

function previewCardHtml(input: {
  mode: string;
  previewUrl: string | null;
  targetUrl: string | null;
}): string {
  const modeNorm = input.mode || "logo";
  const modeClass = "iuPremiumSlot--" + premiumCreativeSlotClassSuffix(modeNorm);
  const img = input.previewUrl
    ? '<img class="iuPremiumSlotImg" src="' +
      input.previewUrl.replace(/"/g, "&quot;") +
      '" alt="Náhled kreativity" loading="lazy"/>'
    : '<span class="iuPremiumSlotCta">Bez náhledu</span>';
  return (
    '<a class="iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--preview ' +
    modeClass +
    '" data-creative-mode="' +
    modeNorm.replace(/"/g, "&quot;") +
    '" href="' +
    (input.targetUrl || "#").replace(/"/g, "&quot;") +
    '" rel="noopener" target="_blank" style="pointer-events:none">' +
    img +
    "</a>"
  );
}

export async function handleAdminPremiumOrderDetail(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare(
    `SELECT po.*, o.client_id, o.order_number, o.payload_json, o.contact_person, o.created_at AS order_created_at,
            c.company_name, c.ico, c.dic, c.address, c.billing_info,
            ps.agreed_price_cents, ps.catalog_price_cents, ps.currency AS snap_currency,
            ct.full_name AS contact_full_name, ct.email AS contact_email, ct.phone AS contact_phone
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     JOIN clients c ON c.client_id = o.client_id
     LEFT JOIN premium_order_price_snapshots ps ON ps.order_id = po.order_id
     LEFT JOIN client_contacts ct ON ct.client_id = c.client_id AND ct.is_primary = 1
     WHERE po.order_id = ?`
  )
    .bind(orderId)
    .first<Record<string, unknown>>();

  if (!row) return json({ error: "not_found" }, 404);

  let creative: Record<string, unknown> | null = null;
  let previewUrl: string | null = null;
  const creativeId = row.creative_id;
  if (typeof creativeId === "string" && creativeId && env.ADS_R2_SIGNING_SECRET) {
    const cr = await env.DB.prepare(
      "SELECT creative_id, format, review_status, r2_key, content_hash, width, height FROM creatives WHERE creative_id = ?"
    )
      .bind(creativeId)
      .first<{ creative_id: string; format: string; review_status: string; r2_key: string; content_hash: string; width: number; height: number }>();
    if (cr) {
      const exp = Math.floor(Date.now() / 1000) + 900;
      const sig = await signObjectAccess(env.ADS_R2_SIGNING_SECRET, {
        objectKey: cr.r2_key,
        bucket: "CREATIVES",
        exp,
      });
      const origin = new URL(request.url).origin;
      previewUrl =
        origin +
        "/v1/objects/get?bucket=CREATIVES&key=" +
        encodeURIComponent(cr.r2_key) +
        "&exp=" +
        String(exp) +
        "&sig=" +
        encodeURIComponent(sig);
      creative = {
        creative_id: cr.creative_id,
        format: cr.format,
        review_status: cr.review_status,
        content_hash: cr.content_hash,
        width: cr.width,
        height: cr.height,
        preview_url: previewUrl,
      };
    }
  }

  const placementConflict = await env.DB.prepare(
    "SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?"
  )
    .bind(row.placement_id)
    .first<{ active_campaign_id: string | null }>();

  const mode = String(row.creative_mode || "logo");
  const previewHtml = previewCardHtml({
    mode,
    previewUrl,
    targetUrl: typeof row.target_url === "string" ? row.target_url : null,
  });

  const agreed = row.agreed_price_cents ?? row.catalog_price_cents;
  const priceLabel = agreed != null ? formatPremiumTotalPriceLabelCs(Number(agreed)) : null;

  const payloadSnap = parsePremiumOrderPayload(
    typeof row.payload_json === "string" ? row.payload_json : null
  );
  const agreedCents =
    row.agreed_price_cents != null
      ? Number(row.agreed_price_cents)
      : payloadSnap.agreed_price_cents ?? row.catalog_price_cents;
  const priceLabelDetail =
    agreedCents != null && Number.isFinite(Number(agreedCents))
      ? formatPremiumTotalPriceLabelCs(Number(agreedCents))
      : priceLabel;

  const noteClient =
    typeof row.note_client === "string" && row.note_client.trim() ? row.note_client.trim() : payloadSnap.note;

  const creativeIdStr =
    typeof row.creative_id === "string" && row.creative_id.trim() ? row.creative_id.trim() : null;
  const targetUrlStr = typeof row.target_url === "string" ? row.target_url : null;
  const workflowStatusStr = String(row.workflow_status || "");
  const missingPublishFields = premiumOrderMissingPublishFields({
    creative_id: creativeIdStr,
    target_url: targetUrlStr,
  });
  const publishable = isPremiumOrderPublishable({
    workflow_status: workflowStatusStr,
    creative_id: creativeIdStr,
    target_url: targetUrlStr,
  });

  return json({
    order: {
      order_id: row.order_id,
      order_number: row.order_number,
      client_id: row.client_id,
      company_name: row.company_name,
      ico: row.ico ?? payloadSnap.ico,
      dic: row.dic ?? payloadSnap.dic,
      address: row.address,
      billing_info: row.billing_info,
      contact_name: row.contact_full_name ?? row.contact_person,
      contact_email: row.client_contact_email ?? row.contact_email,
      contact_phone: row.contact_phone,
      placement_id: row.placement_id,
      category_slug: row.category_slug,
      category_title_cs: premiumCategoryTitleCs(String(row.category_slug || "")),
      position: row.position,
      position_label: "P" + String(row.position),
      workflow_status: row.workflow_status,
      workflow_status_label_cs: premiumWorkflowStatusLabelCs(workflowStatusStr, {
        creative_id: creativeIdStr,
        target_url: targetUrlStr,
      }),
      publishable,
      missing_publish_fields: missingPublishFields,
      target_url: row.target_url,
      creative_mode: row.creative_mode,
      creative_mode_label_cs: premiumCreativeModeLabelCs(String(row.creative_mode || "logo")),
      price_label_cs: priceLabelDetail,
      duration_months: PREMIUM_DURATION_MONTHS,
      ordering_person_name: payloadSnap.ordering_person_name,
      authorization_confirmed: payloadSnap.authorization_confirmed,
      terms_version: payloadSnap.terms_version,
      terms_effective_at: payloadSnap.terms_effective_at,
      submitted_at: row.created_at,
      submitted_at_label_cs: formatAdminPragueDateTime(String(row.created_at || "")),
      published_at: row.published_at ?? null,
      published_at_label_cs: formatAdminPragueDateTime(
        row.published_at != null ? String(row.published_at) : null
      ),
      note_client: noteClient,
      published_campaign_id: row.published_campaign_id ?? null,
      creative_id: row.creative_id ?? null,
    },
    creative,
    preview_html: previewHtml,
    preview_css_href: "/assets/iu-premium-selected-services-v1.css?v=premium-selected-v1-20261006-five-modes",
    preview_render_js_href: "https://infouzel.cz/assets/iu-premium-creative-render-v1.js?v=premium-creative-v1-20261006",
    placement_conflict: placementConflict?.active_campaign_id
      ? { active_campaign_id: placementConflict.active_campaign_id }
      : null,
  });
}
