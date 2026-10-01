/**
 * Admin premium order detail + creative preview (same geometry as public card).
 */
import { json, requireAdminPermission } from "./admin-auth";
import { signObjectAccess } from "./signed-access";
import type { Env } from "./types";

function previewCardHtml(input: {
  mode: string;
  previewUrl: string | null;
  targetUrl: string | null;
}): string {
  const modeClass = input.mode === "full_bleed_banner" ? "iuPremiumSlot--banner" : "iuPremiumSlot--logo";
  const img = input.previewUrl
    ? '<img class="iuPremiumSlotImg" src="' +
      input.previewUrl.replace(/"/g, "&quot;") +
      '" alt="Náhled kreativity" loading="lazy"/>'
    : '<span class="iuPremiumSlotCta">Bez náhledu</span>';
  return (
    '<a class="iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--preview ' +
    modeClass +
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
    `SELECT po.*, o.client_id, o.order_number, o.payload_json, c.company_name,
            ps.agreed_price_cents, ps.catalog_price_cents, ps.currency AS snap_currency
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     JOIN clients c ON c.client_id = o.client_id
     LEFT JOIN premium_order_price_snapshots ps ON ps.order_id = po.order_id
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
  const priceLabel =
    agreed != null
      ? (Number(agreed) / 100).toLocaleString("cs-CZ") + " Kč bez DPH / 6 měsíců"
      : null;

  return json({
    order: {
      order_id: row.order_id,
      order_number: row.order_number,
      client_id: row.client_id,
      company_name: row.company_name,
      placement_id: row.placement_id,
      category_slug: row.category_slug,
      position: row.position,
      workflow_status: row.workflow_status,
      target_url: row.target_url,
      creative_mode: row.creative_mode,
      price_label_cs: priceLabel,
      duration_months: 6,
    },
    creative,
    preview_html: previewHtml,
    preview_css_href: "/assets/iu-premium-selected-services-v1.css?v=premium-selected-v1-20261001",
    placement_conflict: placementConflict?.active_campaign_id
      ? { active_campaign_id: placementConflict.active_campaign_id }
      : null,
  });
}
