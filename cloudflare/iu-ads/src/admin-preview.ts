/**
 * Admin preview endpoint (Etapa 4, kap. 21). RBAC: campaigns.read (read-only — any role that
 * can view a campaign may preview it). Intentionally has **no** side effects: no `audit_logs`
 * row, no `object_access_audit` row, no DB write of any kind — so previewing never counts as
 * publishing (acceptance test: preview-not-publish). Only DB reads + a computed signed creative
 * path are performed.
 */
import { json, requireAdminPermission } from "./admin-auth";
import { signObjectAccess } from "./signed-access";
import { validateTargetUrl } from "./url-safety";
import type { Env } from "./types";

const DEVICE_CATEGORIES = ["pc", "mobile", "tablet"] as const;
function isDeviceCategory(value: unknown): value is (typeof DEVICE_CATEGORIES)[number] {
  return typeof value === "string" && (DEVICE_CATEGORIES as readonly string[]).includes(value);
}

type CampaignPreviewRow = { campaign_id: string; title: string; status: string; label_type: string; target_url: string | null };
type PlacementPreviewRow = {
  campaign_placement_id: string;
  placement_id: string;
  section_id: string | null;
  device_category: string;
};
type CreativePreviewRow = {
  creative_id: string;
  format: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  r2_key: string;
};

const PREVIEW_SIGNED_URL_TTL_SECONDS = 300;

export async function handlePreviewCampaign(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { campaign_id?: unknown; device_category?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
  if (!campaignId) return json({ error: "invalid_campaign_id" }, 400);
  const deviceFilter = isDeviceCategory(body.device_category) ? body.device_category : null;

  const campaign = await env.DB.prepare(
    "SELECT campaign_id, title, status, label_type, target_url FROM campaigns WHERE campaign_id = ?"
  )
    .bind(campaignId)
    .first<CampaignPreviewRow>();
  if (!campaign) return json({ error: "not_found" }, 404);

  const placementParams: unknown[] = deviceFilter ? [campaignId, deviceFilter] : [campaignId];
  const placementsRes = await env.DB.prepare(
    "SELECT campaign_placement_id, placement_id, section_id, device_category FROM campaign_placements WHERE campaign_id = ?" +
      (deviceFilter ? " AND device_category = ?" : "")
  )
    .bind(...placementParams)
    .all<PlacementPreviewRow>();

  const targetUrlValidation = campaign.target_url ? validateTargetUrl(campaign.target_url) : null;
  const safeTargetUrl = targetUrlValidation && targetUrlValidation.ok ? targetUrlValidation.normalized : null;

  const placements: unknown[] = [];
  for (const placement of placementsRes.results || []) {
    const creative = await env.DB.prepare(
      "SELECT creative_id, format, mime_type, width, height, r2_key FROM creatives WHERE campaign_id = ? AND review_status = 'approved' AND (device_category = ? OR device_category = 'universal') ORDER BY updated_at DESC LIMIT 1"
    )
      .bind(campaignId, placement.device_category)
      .first<CreativePreviewRow>();

    let creativePreview: unknown = null;
    if (creative && env.ADS_R2_SIGNING_SECRET) {
      const exp = Math.floor(Date.now() / 1000) + PREVIEW_SIGNED_URL_TTL_SECONDS;
      const sig = await signObjectAccess(env.ADS_R2_SIGNING_SECRET, { objectKey: creative.r2_key, bucket: "CREATIVES", exp });
      creativePreview = {
        creative_id: creative.creative_id,
        format: creative.format,
        mime_type: creative.mime_type,
        width: creative.width,
        height: creative.height,
        preview_path:
          "/v1/objects/get?bucket=CREATIVES&key=" +
          encodeURIComponent(creative.r2_key) +
          "&exp=" +
          String(exp) +
          "&sig=" +
          encodeURIComponent(sig),
      };
    }

    placements.push({
      campaign_placement_id: placement.campaign_placement_id,
      placement_id: placement.placement_id,
      section_id: placement.section_id,
      device_category: placement.device_category,
      creative: creativePreview,
    });
  }

  return json({
    preview: {
      campaign_id: campaign.campaign_id,
      title: campaign.title,
      status: campaign.status,
      label_type: campaign.label_type,
      target_url: safeTargetUrl,
      placements,
    },
    published: false,
  });
}
