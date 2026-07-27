/**
 * Client read-only report (Etapa 7, kap. 38.1–38.14 as far as data exists).
 * Scope: only campaigns in client_code_campaigns for the session's code.
 * Documents: only visibility in (client_visible, public).
 * Stats: reuse analytics-client allowlist when configured; never invent aggregates locally.
 * Never return price internals, email/phone, internal notes, code hashes, r2_key.
 */
import { fetchAdsReport, type AdsReportRow } from "./analytics-client";
import { csvEscape } from "./admin-exports";
import { json } from "./admin-auth";
import { requireClientSession, type ClientSessionContext } from "./client-auth";
import { filterDocumentForVisibility } from "./visibility";
import type { Env } from "./types";

type CampaignClientRow = {
  campaign_id: string;
  evidence_code: string;
  client_id: string;
  title: string;
  status: string;
  label_type: string;
  start_at: string | null;
  end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  target_url: string | null;
  note_client: string | null;
  note_public: string | null;
  client_report_enabled: number;
  client_export_enabled: number;
  devices_json: string | null;
  sections_json: string | null;
  created_at: string;
  updated_at: string;
};

type PlacementRow = {
  campaign_placement_id: string;
  campaign_id: string;
  placement_id: string;
  placement_type_id: string;
  section_id: string | null;
  device_category: string;
  status: string;
  priority: number;
  start_at: string | null;
  end_at: string | null;
};

type CreativeRow = {
  creative_id: string;
  campaign_id: string;
  format: string;
  width: number | null;
  height: number | null;
  device_category: string;
  review_status: string;
  created_at: string;
};

type DocumentRow = {
  document_id: string;
  client_id: string | null;
  campaign_id: string | null;
  doc_type: string;
  title: string;
  version: number;
  visibility: string;
  client_can_download: number;
  status: string;
  created_at: string;
};

const CLIENT_CAMPAIGN_COLUMNS =
  "campaign_id, evidence_code, client_id, title, status, label_type, start_at, end_at, actual_start_at, actual_end_at, target_url, note_client, note_public, client_report_enabled, client_export_enabled, devices_json, sections_json, created_at, updated_at";

function parseJsonArray(raw: string | null): unknown[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeClientCampaign(row: CampaignClientRow) {
  return {
    campaign_id: row.campaign_id,
    evidence_code: row.evidence_code,
    title: row.title,
    status: row.status,
    label_type: row.label_type,
    start_at: row.start_at,
    end_at: row.end_at,
    actual_start_at: row.actual_start_at,
    actual_end_at: row.actual_end_at,
    target_url: row.target_url,
    note_client: row.note_client,
    note_public: row.note_public,
    devices: parseJsonArray(row.devices_json),
    sections: parseJsonArray(row.sections_json),
    client_export_enabled: row.client_export_enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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

function assertInScope(ctx: ClientSessionContext, campaignId: string): boolean {
  return ctx.campaignIds.includes(campaignId);
}

async function loadScopedCampaigns(db: D1Database, ctx: ClientSessionContext): Promise<CampaignClientRow[]> {
  if (ctx.campaignIds.length === 0) return [];
  const out: CampaignClientRow[] = [];
  for (const campaignId of ctx.campaignIds) {
    const row = await db
      .prepare("SELECT " + CLIENT_CAMPAIGN_COLUMNS + " FROM campaigns WHERE campaign_id = ?")
      .bind(campaignId)
      .first<CampaignClientRow>();
    if (!row) continue;
    if (row.client_id !== ctx.clientId) continue;
    if (row.client_report_enabled !== 1) continue;
    out.push(row);
  }
  return out;
}

async function loadPlacements(db: D1Database, campaignIds: string[]): Promise<PlacementRow[]> {
  const out: PlacementRow[] = [];
  for (const campaignId of campaignIds) {
    const res = await db
      .prepare(
        "SELECT campaign_placement_id, campaign_id, placement_id, placement_type_id, section_id, device_category, status, priority, start_at, end_at FROM campaign_placements WHERE campaign_id = ?"
      )
      .bind(campaignId)
      .all<PlacementRow>();
    for (const row of res.results || []) out.push(row);
  }
  return out;
}

async function loadCreatives(db: D1Database, campaignIds: string[]): Promise<CreativeRow[]> {
  const out: CreativeRow[] = [];
  for (const campaignId of campaignIds) {
    const res = await db
      .prepare(
        "SELECT creative_id, campaign_id, format, width, height, device_category, review_status, created_at FROM creatives WHERE campaign_id = ?"
      )
      .bind(campaignId)
      .all<CreativeRow>();
    for (const row of res.results || []) out.push(row);
  }
  return out;
}

async function loadClientDocuments(db: D1Database, ctx: ClientSessionContext, campaignIds: string[]): Promise<unknown[]> {
  const res = await db
    .prepare(
      "SELECT document_id, client_id, campaign_id, doc_type, title, version, visibility, client_can_download, status, created_at FROM documents WHERE status = 'active'"
    )
    .all<DocumentRow>();
  const out: unknown[] = [];
  for (const row of res.results || []) {
    const visible = filterDocumentForVisibility(row, "client_visible");
    if (!visible) continue;
    const onClient = row.client_id === ctx.clientId;
    const onCampaign = row.campaign_id != null && campaignIds.includes(row.campaign_id);
    if (!onClient && !onCampaign) continue;
    out.push({
      document_id: visible.document_id,
      campaign_id: row.campaign_id,
      doc_type: visible.doc_type,
      title: visible.title,
      version: visible.version,
      visibility: visible.visibility,
      client_can_download: row.client_can_download === 1,
      created_at: visible.created_at,
    });
  }
  return out;
}

async function loadStatsForScope(
  env: Env,
  campaignIds: string[],
  from: string | undefined,
  to: string | undefined
): Promise<{ ok: true; rows: AdsReportRow[]; totals: ReturnType<typeof sumRows>; configured: boolean } | { ok: false; status: number; error: string }> {
  if (campaignIds.length === 0) {
    return { ok: true, rows: [], totals: sumRows([]), configured: true };
  }
  // Fetch per campaign so we never widen the Analytics query beyond the code's scope.
  const allRows: AdsReportRow[] = [];
  let anyConfigured = false;
  for (const campaignId of campaignIds) {
    const result = await fetchAdsReport(env, { campaign_id: campaignId, from, to });
    if (!result.ok) {
      if (result.error === "stats_not_configured") {
        // Soft: report still returns campaign/docs; stats section notes unconfigured.
        return { ok: true, rows: [], totals: sumRows([]), configured: false };
      }
      return { ok: false, status: result.status, error: result.error };
    }
    anyConfigured = true;
    for (const row of result.rows) {
      if (row.campaign_id === campaignId) allRows.push(row);
    }
  }
  return { ok: true, rows: allRows, totals: sumRows(allRows), configured: anyConfigured };
}

function assertNoClientLeaks(payload: unknown): string[] {
  const forbidden = [
    "price",
    "price_cents",
    "price_ex_vat_cents",
    "vat_cents",
    "budget_limit_cents",
    "email",
    "phone",
    "note_internal",
    "notes_internal",
    "code_hash",
    "access_code",
    "password",
    "r2_key",
    "ico",
    "dic",
  ];
  const leaks: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, path + "[" + i + "]"));
      return;
    }
    if (typeof v !== "object") return;
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (forbidden.some((f) => lower === f || lower.includes(f))) leaks.push(path + "." + k);
      walk(child, path + "." + k);
    }
  };
  walk(payload, "$");
  return leaks;
}

export async function handleClientReport(request: Request, env: Env, url: URL): Promise<Response> {
  const session = await requireClientSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const ctx = session.context;
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const campaignFilter = url.searchParams.get("campaign_id");

  let campaigns = await loadScopedCampaigns(env.DB, ctx);
  if (campaignFilter) {
    if (!assertInScope(ctx, campaignFilter)) return json({ error: "forbidden_campaign" }, 403);
    campaigns = campaigns.filter((c) => c.campaign_id === campaignFilter);
  }
  const campaignIds = campaigns.map((c) => c.campaign_id);

  const [placements, creatives, documents, stats] = await Promise.all([
    loadPlacements(env.DB, campaignIds),
    loadCreatives(env.DB, campaignIds),
    loadClientDocuments(env.DB, ctx, campaignIds),
    loadStatsForScope(env, campaignIds, from, to),
  ]);
  if (!stats.ok) return json({ error: stats.error }, stats.status);

  const report = {
    generated_at: new Date().toISOString(),
    client: { client_id: ctx.clientId },
    code: { code_id: ctx.codeId },
    filters: { from: from || null, to: to || null, campaign_id: campaignFilter || null },
    campaigns: campaigns.map(serializeClientCampaign),
    placements: placements.map((p) => ({
      campaign_placement_id: p.campaign_placement_id,
      placement_id: p.placement_id,
      campaign_id: p.campaign_id,
      placement_type_id: p.placement_type_id,
      section_id: p.section_id,
      device_category: p.device_category,
      status: p.status,
      priority: p.priority,
      start_at: p.start_at,
      end_at: p.end_at,
    })),
    creatives: creatives.map((c) => ({
      creative_id: c.creative_id,
      campaign_id: c.campaign_id,
      format: c.format,
      width: c.width,
      height: c.height,
      device_category: c.device_category,
      review_status: c.review_status,
      created_at: c.created_at,
    })),
    documents,
    stats: {
      configured: stats.configured,
      totals: stats.totals,
      rows: stats.rows,
    },
    // 38.13 snapshot persistence deferred (no client_report_snapshots writes in Etapa 7 Worker API).
    snapshot: { persisted: false },
    exports: { formats: ["json", "csv"], pdf: false },
  };

  const leaks = assertNoClientLeaks(report);
  if (leaks.length) return json({ error: "isolation_violation", leaks }, 500);
  return json({ report });
}

export async function handleClientReportExport(request: Request, env: Env, url: URL): Promise<Response> {
  const session = await requireClientSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const format = (url.searchParams.get("format") || "json").toLowerCase();
  if (format === "pdf") return json({ error: "pdf_export_deferred", formats: ["json", "csv"] }, 501);

  // Reuse the JSON report builder then optionally flatten to CSV.
  const reportRes = await handleClientReport(request, env, url);
  if (reportRes.status !== 200) return reportRes;
  const body = (await reportRes.json()) as { report: { campaigns: Array<Record<string, unknown>>; stats: { rows: AdsReportRow[]; totals: Record<string, number> } } };
  const report = body.report;

  // Export gated per campaign flag when a single campaign is requested.
  const campaignFilter = url.searchParams.get("campaign_id");
  if (campaignFilter) {
    const camp = report.campaigns.find((c) => c.campaign_id === campaignFilter);
    if (camp && camp.client_export_enabled === false) {
      return json({ error: "export_disabled_for_campaign" }, 403);
    }
  }

  if (format === "csv") {
    const lines = ["day,campaign_id,placement_id,impressions,clicks,valid_clicks,suspicious_clicks,ctr"];
    for (const row of report.stats.rows) {
      lines.push(
        [
          csvEscape(row.day),
          csvEscape(row.campaign_id),
          csvEscape(row.placement_id),
          csvEscape(row.impressions),
          csvEscape(row.clicks),
          csvEscape(row.valid_clicks),
          csvEscape(row.suspicious_clicks),
          csvEscape(row.ctr),
        ].join(",")
      );
    }
    return new Response(lines.join("\n") + "\n", {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="iu-ads-client-report.csv"',
      },
    });
  }

  return json({ report, export: { format: "json" } });
}
