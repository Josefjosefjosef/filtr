/**
 * Admin stats endpoints (Etapa 6, kap. 20). RBAC: `stats.read` (main_admin/ads_manager/read_only —
 * `sales` is denied, per 07-roles-permissions.md). Read-only join against the Analytics Worker's
 * aggregate `/v1/ads/report` (`analytics-client.ts`) — this Worker holds no impression/click rows
 * itself (no `daily_ads` table here, see `ANALYTICS_ONLY_TABLES` in `isolation.ts`).
 *
 * Every response is re-filtered locally against `STATS_TEST_CAMPAIGN_PREFIX` (defense-in-depth on
 * top of Analytics' own default test-campaign exclusion) and built field-by-field from an
 * allowlist — never price/email/contact/document/code/PII, matching the isolation invariants that
 * already gate Public Ad Delivery.
 */
import { json, requireAdminPermission } from "./admin-auth";
import { fetchAdsReport, type AdsReportRow } from "./analytics-client";
import type { Env } from "./types";

type CampaignMetaRow = {
  campaign_id: string;
  evidence_code: string;
  title: string;
  status: string;
};

const DEFAULT_TEST_PREFIX = "test";

async function loadTestPrefix(db: D1Database | undefined): Promise<string> {
  if (!db) return DEFAULT_TEST_PREFIX;
  try {
    const row = await db
      .prepare("SELECT value FROM system_settings WHERE key = 'STATS_TEST_CAMPAIGN_PREFIX'")
      .first<{ value: string }>();
    const v = row?.value?.trim();
    return v || DEFAULT_TEST_PREFIX;
  } catch {
    return DEFAULT_TEST_PREFIX;
  }
}

function isTestCampaignId(campaignId: string, prefix: string): boolean {
  const id = String(campaignId || "").trim().toLowerCase();
  const p = String(prefix || "").trim().toLowerCase();
  if (!id || !p) return false;
  return id === p || id.startsWith(p + "_") || id.startsWith(p + "-") || id.startsWith(p + ".");
}

function excludeTestRows(rows: AdsReportRow[], prefix: string): AdsReportRow[] {
  return rows.filter((r) => !isTestCampaignId(r.campaign_id, prefix));
}

function sumRows(rows: AdsReportRow[]) {
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const valid_clicks = rows.reduce((s, r) => s + r.valid_clicks, 0);
  const suspicious_clicks = rows.reduce((s, r) => s + r.suspicious_clicks, 0);
  return {
    impressions,
    clicks,
    valid_clicks,
    suspicious_clicks,
    ctr: impressions > 0 ? Math.round((valid_clicks / impressions) * 10000) / 10000 : 0,
  };
}

const EMPTY_TOTALS = { impressions: 0, clicks: 0, valid_clicks: 0, suspicious_clicks: 0, ctr: 0 };

export async function handleGetCampaignStats(request: Request, env: Env, url: URL, campaignId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "stats.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const testPrefix = await loadTestPrefix(env.DB);
  // Test campaigns are hidden from the stats surface entirely, even by explicit id — fail-closed
  // rather than a policy toggle a caller could bypass with `include_test`.
  if (isTestCampaignId(campaignId, testPrefix)) return json({ error: "not_found" }, 404);

  const campaign = await env.DB.prepare(
    "SELECT campaign_id, evidence_code, title, status FROM campaigns WHERE campaign_id = ?"
  )
    .bind(campaignId)
    .first<CampaignMetaRow>();
  if (!campaign) return json({ error: "not_found" }, 404);

  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const result = await fetchAdsReport(env, { campaign_id: campaignId, from, to });
  if (!result.ok) return json({ error: result.error }, result.status);

  const rows = excludeTestRows(result.rows, testPrefix);
  return json({
    campaign: {
      campaign_id: campaign.campaign_id,
      evidence_code: campaign.evidence_code,
      title: campaign.title,
      status: campaign.status,
    },
    filters: { from: from || null, to: to || null },
    totals: sumRows(rows),
    rows,
  });
}

export async function handleGetStatsSummary(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "stats.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const testPrefix = await loadTestPrefix(env.DB);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const placement_id = url.searchParams.get("placement_id") || undefined;
  const section_id = url.searchParams.get("section_id") || undefined;
  const slot_type = url.searchParams.get("slot_type") || undefined;
  const device_category = url.searchParams.get("device_category") || undefined;
  const campaignIdParam = url.searchParams.get("campaign_id") || undefined;

  const filters = {
    from: from || null,
    to: to || null,
    placement_id: placement_id || null,
    section_id: section_id || null,
    slot_type: slot_type || null,
    device_category: device_category || null,
    campaign_id: campaignIdParam || null,
  };

  if (campaignIdParam && isTestCampaignId(campaignIdParam, testPrefix)) {
    return json({ filters, totals: EMPTY_TOTALS, rows: [] });
  }

  const result = await fetchAdsReport(env, {
    from,
    to,
    placement_id,
    section_id,
    slot_type,
    device_category,
    campaign_id: campaignIdParam,
  });
  if (!result.ok) return json({ error: result.error }, result.status);

  const rows = excludeTestRows(result.rows, testPrefix);
  return json({ filters, totals: sumRows(rows), rows });
}
