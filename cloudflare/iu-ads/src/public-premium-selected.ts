/**
 * Public read API for premium slots in „Vybrané služby a odkazy“.
 */
import { json } from "./admin-auth";
import {
  assignPremiumDisplayRanks,
  isPremiumCampaignLiveNow,
  premiumOrderPositionExplanationCs,
  premiumPositionRankLabelCs,
  premiumSalesPanelHintCs,
  resolvePremiumPublicSaleState,
} from "./premium-display";
import {
  PREMIUM_DURATION_MONTHS,
  PREMIUM_POSITION_COUNT,
  defaultPriceCentsForPosition,
  isKnownAffiliateCategorySlug,
  isPremiumPosition,
  isPremiumSlotPubliclyListed,
  type PremiumCapacity,
  type PremiumPosition,
} from "./premium-selected-services";
import { signObjectAccess } from "./signed-access";
import type { Env } from "./types";

type CategoryRow = { category_slug: string; premium_capacity: number };
type PlacementRow = {
  placement_id: string;
  category_slug: string;
  position: number;
  current_price_cents: number;
  currency: string;
};

function normalizeCapacity(raw: number): PremiumCapacity {
  if (raw === 8) return 8;
  return raw === 4 ? 4 : 2;
}

async function signedCreativeUrl(origin: string, env: Env, r2Key: string): Promise<string | null> {
  if (!env.ADS_R2_SIGNING_SECRET || !r2Key) return null;
  const exp = Math.floor(Date.now() / 1000) + 600;
  const sig = await signObjectAccess(env.ADS_R2_SIGNING_SECRET, { objectKey: r2Key, bucket: "CREATIVES", exp });
  return origin + "/v1/objects/get?bucket=CREATIVES&key=" + encodeURIComponent(r2Key) + "&exp=" + exp + "&sig=" + encodeURIComponent(sig);
}

export async function handlePublicPremiumSelectedCatalog(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ error: "not_configured" }, 503);

  const category = (url.searchParams.get("category") || "").trim();
  if (!category || !isKnownAffiliateCategorySlug(category)) return json({ error: "invalid_category" }, 400);

  const cat = await env.DB.prepare("SELECT category_slug, premium_capacity FROM premium_selected_categories WHERE category_slug = ?")
    .bind(category)
    .first<CategoryRow>();
  const capacity = normalizeCapacity(cat?.premium_capacity ?? 2);

  const nowIso = new Date().toISOString();
  const placements = await env.DB.prepare(
    `SELECT p.placement_id, p.category_slug, p.position, p.current_price_cents, p.currency, p.active_campaign_id,
            c.status AS campaign_status, c.target_url, c.start_at, c.end_at
     FROM premium_selected_placements p
     LEFT JOIN campaigns c ON c.campaign_id = p.active_campaign_id
     WHERE p.category_slug = ?
     ORDER BY p.position ASC`
  )
    .bind(category)
    .all<
      PlacementRow & {
        active_campaign_id: string | null;
        campaign_status: string | null;
        target_url: string | null;
        start_at: string | null;
        end_at: string | null;
      }
    >();

  const pendingRows = await env.DB.prepare(
    `SELECT placement_id, COUNT(*) AS pending_count
     FROM premium_selected_orders
     WHERE category_slug = ? AND workflow_status IN ('submitted', 'under_review')
     GROUP BY placement_id`
  )
    .bind(category)
    .all<{ placement_id: string; pending_count: number }>();
  const pendingByPlacement = new Map<string, number>();
  for (const row of pendingRows.results || []) {
    pendingByPlacement.set(row.placement_id, Number(row.pending_count) || 0);
  }

  const slots = (placements.results || [])
    .filter((p) => isPremiumPosition(p.position))
    .map((p) => {
      const position = p.position as PremiumPosition;
      const listed = isPremiumSlotPubliclyListed(capacity, position);
      const priceCents = p.current_price_cents > 0 ? p.current_price_cents : defaultPriceCentsForPosition(position);
      const campaignLive = isPremiumCampaignLiveNow({
        campaign_status: p.campaign_status,
        target_url: p.target_url,
        start_at: p.start_at,
        end_at: p.end_at,
        nowIso,
      });
      const saleState = resolvePremiumPublicSaleState({
        active_campaign_id: p.active_campaign_id,
        campaign_live: campaignLive,
        pending_order_count: pendingByPlacement.get(p.placement_id) || 0,
      });
      return {
        placement_id: p.placement_id,
        position,
        publicly_listed: listed,
        sale_state: saleState,
        buyable: saleState === "available",
        position_label_cs: premiumPositionRankLabelCs(position),
        position_explanation_cs: premiumOrderPositionExplanationCs(position),
        current_price_cents: priceCents,
        currency: p.currency || "CZK",
        duration_months: PREMIUM_DURATION_MONTHS,
        price_label_cs: formatPriceLabelCs(priceCents),
        order_url:
          "https://ads.infouzel.cz/premium/order?category=" +
          encodeURIComponent(category) +
          "&placement=" +
          encodeURIComponent(p.placement_id),
      };
    });

  return json({
    product: "premium_selected_services_v1",
    category,
    premium_capacity: capacity,
    sales_panel_hint_cs: premiumSalesPanelHintCs(),
    sales_catalog_positions: PREMIUM_POSITION_COUNT,
    slots,
    measurement: { impressions: false, clicks: false, ctr: false },
  });
}

function formatPriceLabelCs(cents: number): string {
  return (Math.round(cents / 100)).toLocaleString("cs-CZ") + " Kč bez DPH / 6 měsíců";
}

export async function handlePublicPremiumSelectedRender(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ error: "not_configured" }, 503);

  const category = (url.searchParams.get("category") || "").trim();
  if (!category || !isKnownAffiliateCategorySlug(category)) return json({ error: "invalid_category" }, 400);

  const nowIso = new Date().toISOString();
  const origin = url.origin;

  const rows = await env.DB.prepare(
    `SELECT p.placement_id, p.position, c.status AS campaign_status, c.target_url, cr.format AS creative_format,
            cr.r2_key, c.title AS accessible_name, c.start_at, c.end_at
     FROM premium_selected_placements p
     LEFT JOIN campaigns c ON c.campaign_id = p.active_campaign_id
     LEFT JOIN creatives cr ON cr.creative_id = (
       SELECT creative_id FROM creatives
       WHERE campaign_id = p.active_campaign_id AND review_status = 'approved'
       ORDER BY version DESC LIMIT 1
     )
     WHERE p.category_slug = ?`
  )
    .bind(category)
    .all<{
      placement_id: string;
      position: number;
      campaign_status: string | null;
      target_url: string | null;
      creative_format: string | null;
      r2_key: string | null;
      accessible_name: string | null;
      start_at: string | null;
      end_at: string | null;
    }>();

  const rawActive: {
    placement_id: string;
    position: PremiumPosition;
    target_url: string;
    creative_format: string | null;
    accessible_name: string;
    creative_cdn_url: string | null;
  }[] = [];
  for (const row of rows.results || []) {
    if (!isPremiumPosition(row.position)) continue;
    const position = row.position;
    const active = isPremiumCampaignLiveNow({
      campaign_status: row.campaign_status,
      target_url: row.target_url,
      start_at: row.start_at,
      end_at: row.end_at,
      nowIso,
    });
    if (!active || !row.target_url) continue;
    const cdnUrl = row.r2_key ? await signedCreativeUrl(origin, env, row.r2_key) : null;
    rawActive.push({
      placement_id: row.placement_id,
      position,
      target_url: row.target_url,
      creative_format: row.creative_format,
      accessible_name: row.accessible_name || "Reklamní pozice",
      creative_cdn_url: cdnUrl,
    });
  }
  const items = assignPremiumDisplayRanks(rawActive);

  return json({
    product: "premium_selected_services_v1",
    category,
    as_of: nowIso,
    active: items,
    measurement: { impressions: false, clicks: false, ctr: false },
  });
}
