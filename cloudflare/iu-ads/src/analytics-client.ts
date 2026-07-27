/**
 * Server-side client for the Analytics Worker's `/v1/ads/report` (Etapa 6, kap. 20).
 * Called only from within this Worker (admin-stats.ts) — never from the browser, and never with
 * a client-supplied URL/token. Uses `ANALYTICS_ADMIN_TOKEN`, a secret deliberately separate from
 * Analytics' own `ADMIN_TOKEN` config (secrets.contract.md, 03-security-threat-model.md). The
 * token is never logged, echoed in errors, or included in any response. Missing configuration
 * (base URL setting or token secret) fails closed with `503 stats_not_configured` — this Worker
 * never falls back to reading/duplicating analytics aggregates locally (no `daily_ads` table
 * here; see `ANALYTICS_ONLY_TABLES` in `isolation.ts`).
 */
import type { Env } from "./types";

const REPORT_FETCH_TIMEOUT_MS = 8000;

/** BE-003: SSRF guard — only known Analytics Worker hosts may be called with the admin token. */
const ALLOWED_ANALYTICS_REPORT_HOSTS = new Set([
  "infouzel-analytics.josef-zmrhal.workers.dev",
]);

function isAllowedAnalyticsReportUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  return ALLOWED_ANALYTICS_REPORT_HOSTS.has(url.hostname.toLowerCase());
}

const ALLOWED_ROW_STRING_KEYS = ["day", "campaign_id", "placement_id", "section_id", "slot_type", "device_category"] as const;
const ALLOWED_ROW_NUMBER_KEYS = ["impressions", "clicks", "valid_clicks", "suspicious_clicks"] as const;

export type AdsReportParams = {
  from?: string;
  to?: string;
  campaign_id?: string;
  placement_id?: string;
  section_id?: string;
  slot_type?: string;
  device_category?: string;
};

export type AdsReportRow = {
  day: string;
  campaign_id: string;
  placement_id: string;
  section_id: string;
  slot_type: string;
  device_category: string;
  impressions: number;
  clicks: number;
  valid_clicks: number;
  suspicious_clicks: number;
  ctr: number;
};

export type AdsReportTotals = {
  impressions: number;
  clicks: number;
  valid_clicks: number;
  suspicious_clicks: number;
  ctr: number;
};

export type AdsReportResult =
  | { ok: true; rows: AdsReportRow[]; totals: AdsReportTotals }
  | { ok: false; status: number; error: string };

async function loadReportBaseUrl(db: D1Database | undefined): Promise<string | null> {
  if (!db) return null;
  try {
    const row = await db
      .prepare("SELECT value FROM system_settings WHERE key = 'ANALYTICS_ADMIN_REPORT_URL'")
      .first<{ value: string }>();
    const url = row?.value?.trim();
    return url ? url.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

function toCtr(validClicks: number, impressions: number): number {
  return impressions > 0 ? Math.round((validClicks / impressions) * 10000) / 10000 : 0;
}

function sanitizeRow(raw: Record<string, unknown>): AdsReportRow {
  const out = {} as Record<string, unknown>;
  for (const key of ALLOWED_ROW_STRING_KEYS) {
    const v = raw[key];
    out[key] = v === undefined || v === null ? "" : String(v);
  }
  for (const key of ALLOWED_ROW_NUMBER_KEYS) {
    const n = Number(raw[key]);
    out[key] = Number.isFinite(n) ? n : 0;
  }
  const row = out as unknown as AdsReportRow;
  row.ctr = toCtr(row.valid_clicks, row.impressions);
  return row;
}

function sanitizeTotals(raw: unknown): AdsReportTotals {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const impressions = Number(src.impressions) || 0;
  const clicks = Number(src.clicks) || 0;
  const valid_clicks = Number(src.valid_clicks) || 0;
  const suspicious_clicks = Number(src.suspicious_clicks) || 0;
  return { impressions, clicks, valid_clicks, suspicious_clicks, ctr: toCtr(valid_clicks, impressions) };
}

/**
 * Fetches the aggregate ads report from the Analytics Worker. Every returned row/total is
 * re-built field-by-field from an explicit allowlist (never a raw pass-through of the upstream
 * JSON), so unexpected upstream fields (including any accidental PII) can never leak through.
 */
export async function fetchAdsReport(env: Env, params: AdsReportParams): Promise<AdsReportResult> {
  const baseUrl = await loadReportBaseUrl(env.DB);
  if (!baseUrl || !env.ANALYTICS_ADMIN_TOKEN) {
    return { ok: false, status: 503, error: "stats_not_configured" };
  }

  let target: URL;
  try {
    target = new URL(baseUrl + "/v1/ads/report");
  } catch {
    return { ok: false, status: 503, error: "stats_not_configured" };
  }
  if (!isAllowedAnalyticsReportUrl(target)) {
    return { ok: false, status: 503, error: "stats_not_configured" };
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") target.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${env.ANALYTICS_ADMIN_TOKEN}` },
      signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 503, error: "stats_upstream_unreachable" };
  }

  if (!response.ok) {
    return { ok: false, status: 503, error: "stats_upstream_error" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 503, error: "stats_upstream_error" };
  }

  const rawRows = Array.isArray((body as { rows?: unknown })?.rows) ? (body as { rows: unknown[] }).rows : [];
  const rows = rawRows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => sanitizeRow(r));
  const totals = sanitizeTotals((body as { totals?: unknown })?.totals);

  return { ok: true, rows, totals };
}
