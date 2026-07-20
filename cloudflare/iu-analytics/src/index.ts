import { applyEvent, rejectEvent } from "./aggregate";
import { privacyGuard, todayUtc } from "./privacy";
import { Env } from "./types";

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extra,
    },
  });
}

function corsHeaders(env: Env, req: Request): HeadersInit {
  const origin = req.headers.get("Origin") || "";
  const allow = env.CORS_ALLOW_ORIGIN || "*";
  const ok =
    allow === "*" ||
    origin === "https://infouzel.cz" ||
    origin === "https://www.infouzel.cz" ||
    /^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin) ||
    /^http:\/\/127\.0\.0\.1:\d+$/i.test(origin) ||
    /^http:\/\/localhost:\d+$/i.test(origin);
  return {
    "access-control-allow-origin": ok ? origin || allow : "https://infouzel.cz",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function withCors(env: Env, req: Request, res: Response): Response {
  const h = new Headers(res.headers);
  const c = corsHeaders(env, req);
  for (const [k, v] of Object.entries(c)) h.set(k, String(v));
  return new Response(res.body, { status: res.status, headers: h });
}

function requireAdmin(env: Env, req: Request): boolean {
  const token = env.ADMIN_TOKEN || "";
  if (!token) return false;
  const auth = req.headers.get("Authorization") || "";
  return auth === "Bearer " + token;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function ensureSchema(db: D1Database): Promise<void> {
  // Idempotent bootstrap for fresh D1 (migrations applied in CI; this is a safety net).
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_traffic (
      day TEXT NOT NULL, device_category TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0, page_views INTEGER NOT NULL DEFAULT 0,
      public_section_views INTEGER NOT NULL DEFAULT 0, private_tools_opens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL, PRIMARY KEY (day, device_category))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_sections (
      day TEXT NOT NULL, section_id TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL, PRIMARY KEY (day, section_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_performance (
      day TEXT NOT NULL, metric_name TEXT NOT NULL, sample_count INTEGER NOT NULL DEFAULT 0,
      value_sum REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (day, metric_name))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_errors (
      day TEXT NOT NULL, error_code TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL, PRIMARY KEY (day, error_code))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_ads (
      day TEXT NOT NULL, campaign_id TEXT NOT NULL, placement_id TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '', slot_type TEXT NOT NULL DEFAULT 'unknown',
      device_category TEXT NOT NULL, impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0, valid_clicks INTEGER NOT NULL DEFAULT 0,
      suspicious_clicks INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY (day, campaign_id, placement_id, section_id, slot_type, device_category))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS campaign_meta (
      campaign_id TEXT PRIMARY KEY, campaign_name TEXT, advertiser_name TEXT,
      placement_label TEXT, start_date TEXT, end_date TEXT, status TEXT,
      pricing_model TEXT, notes TEXT, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ingest_audit (
      day TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0,
      suspicious INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (day))`),
  ]);
}

async function publicStats(env: Env, from: string, to: string) {
  const traffic = await env.DB.prepare(
    `SELECT day,
            SUM(visits) AS visits,
            SUM(page_views) AS page_views,
            SUM(public_section_views) AS public_section_views,
            SUM(private_tools_opens) AS private_tools_opens
     FROM daily_traffic WHERE day >= ? AND day <= ?
     GROUP BY day ORDER BY day ASC`
  )
    .bind(from, to)
    .all();

  const devices = await env.DB.prepare(
    `SELECT device_category, SUM(visits) AS visits, SUM(page_views) AS page_views
     FROM daily_traffic WHERE day >= ? AND day <= ?
     GROUP BY device_category`
  )
    .bind(from, to)
    .all();

  const sections = await env.DB.prepare(
    `SELECT section_id, SUM(views) AS views
     FROM daily_sections WHERE day >= ? AND day <= ?
     GROUP BY section_id ORDER BY views DESC LIMIT 12`
  )
    .bind(from, to)
    .all();

  const today = todayUtc();
  const yesterday = daysAgo(1);
  const monthStart = today.slice(0, 8) + "01";

  const sumDay = async (day: string) => {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(visits),0) AS visits, COALESCE(SUM(page_views),0) AS page_views
       FROM daily_traffic WHERE day = ?`
    )
      .bind(day)
      .first<{ visits: number; page_views: number }>();
    return row || { visits: 0, page_views: 0 };
  };

  const month = await env.DB.prepare(
    `SELECT COALESCE(SUM(visits),0) AS visits, COALESCE(SUM(page_views),0) AS page_views,
            COALESCE(SUM(private_tools_opens),0) AS private_tools_opens
     FROM daily_traffic WHERE day >= ? AND day <= ?`
  )
    .bind(monthStart, today)
    .first();

  return {
    generatedAt: new Date().toISOString(),
    privacy: {
      tracksIndividuals: false,
      createsAdProfiles: false,
      sellsData: false,
      sharesWithThirdParties: false,
      usesExternalAnalyticsScripts: false,
      storesPrivateModuleContent: false,
      storesIpInAnalyticsDb: false,
      storesFullUserAgent: false,
      storesFingerprints: false,
    },
    today: await sumDay(today),
    yesterday: await sumDay(yesterday),
    month: month || { visits: 0, page_views: 0, private_tools_opens: 0 },
    series: traffic.results || [],
    devices: devices.results || [],
    topPublicSections: sections.results || [],
    privateToolsSummary: {
      label: "Soukromé nástroje – anonymní souhrn",
      opens: Number((month && (month as { private_tools_opens?: number }).private_tools_opens) || 0),
    },
    auditStatus: {
      legal: "Čeká na dokončení.",
      security: "Čeká na dokončení.",
      anonymization: "Čeká na dokončení.",
    },
  };
}

async function handleIngest(env: Env, req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const events = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events)
      ? (body as { events: unknown[] }).events
      : [body];

  if (events.length > 20) return json({ ok: false, error: "batch_too_large" }, 400);

  const ua = req.headers.get("user-agent");
  // Never persist IP. CF may see it transitively; we do not write it to D1.
  let accepted = 0;
  let rejected = 0;
  let suspicious = 0;

  for (const ev of events) {
    const guarded = privacyGuard(ev, ua);
    if (!guarded.ok) {
      rejected += 1;
      await rejectEvent(env.DB, todayUtc());
      continue;
    }
    const applied = await applyEvent(env.DB, guarded.event);
    if (applied.suspicious) suspicious += 1;
    else accepted += 1;
  }

  return json({ ok: true, accepted, rejected, suspicious });
}

async function adminOverview(env: Env, from: string, to: string) {
  const pub = await publicStats(env, from, to);
  const ads = await env.DB.prepare(
    `SELECT day, campaign_id, placement_id, section_id, slot_type, device_category,
            impressions, clicks, valid_clicks, suspicious_clicks,
            CASE WHEN impressions > 0 THEN ROUND(1.0 * valid_clicks / impressions, 4) ELSE 0 END AS ctr
     FROM daily_ads WHERE day >= ? AND day <= ?
     ORDER BY day DESC, impressions DESC LIMIT 500`
  )
    .bind(from, to)
    .all();
  const audit = await env.DB.prepare(
    `SELECT * FROM ingest_audit WHERE day >= ? AND day <= ? ORDER BY day DESC`
  )
    .bind(from, to)
    .all();
  const errors = await env.DB.prepare(
    `SELECT error_code, SUM(count) AS count FROM daily_errors
     WHERE day >= ? AND day <= ? GROUP BY error_code ORDER BY count DESC LIMIT 50`
  )
    .bind(from, to)
    .all();
  const perf = await env.DB.prepare(
    `SELECT metric_name, SUM(sample_count) AS samples, SUM(value_sum) AS value_sum,
            CASE WHEN SUM(sample_count) > 0 THEN SUM(value_sum)/SUM(sample_count) ELSE 0 END AS avg_value
     FROM daily_performance WHERE day >= ? AND day <= ?
     GROUP BY metric_name`
  )
    .bind(from, to)
    .all();

  return {
    ...pub,
    ads: ads.results || [],
    ingestAudit: audit.results || [],
    errors: errors.results || [],
    performance: perf.results || [],
  };
}

async function adReport(env: Env, url: URL) {
  const from = url.searchParams.get("from") || daysAgo(30);
  const to = url.searchParams.get("to") || todayUtc();
  const campaign_id = url.searchParams.get("campaign_id");
  const placement_id = url.searchParams.get("placement_id");
  const section_id = url.searchParams.get("section_id");
  const slot_type = url.searchParams.get("slot_type");
  const device_category = url.searchParams.get("device_category");

  let sql = `SELECT day, campaign_id, placement_id, section_id, slot_type, device_category,
                    impressions, clicks, valid_clicks, suspicious_clicks,
                    CASE WHEN impressions > 0 THEN ROUND(1.0 * valid_clicks / impressions, 4) ELSE 0 END AS ctr
             FROM daily_ads WHERE day >= ? AND day <= ?`;
  const binds: string[] = [from, to];
  if (campaign_id) {
    sql += ` AND campaign_id = ?`;
    binds.push(campaign_id);
  }
  if (placement_id) {
    sql += ` AND placement_id = ?`;
    binds.push(placement_id);
  }
  if (section_id) {
    sql += ` AND section_id = ?`;
    binds.push(section_id);
  }
  if (slot_type) {
    sql += ` AND slot_type = ?`;
    binds.push(slot_type);
  }
  if (device_category) {
    sql += ` AND device_category = ?`;
    binds.push(device_category);
  }
  sql += ` ORDER BY day ASC LIMIT 2000`;

  const rows = await env.DB.prepare(sql)
    .bind(...binds)
    .all();

  const totals = await env.DB.prepare(
    `SELECT COALESCE(SUM(impressions),0) AS impressions,
            COALESCE(SUM(clicks),0) AS clicks,
            COALESCE(SUM(valid_clicks),0) AS valid_clicks,
            COALESCE(SUM(suspicious_clicks),0) AS suspicious_clicks
     FROM daily_ads WHERE day >= ? AND day <= ?
     ${campaign_id ? "AND campaign_id = ?" : ""}
     ${placement_id ? "AND placement_id = ?" : ""}`
  )
    .bind(...binds.slice(0, 2 + (campaign_id ? 1 : 0) + (placement_id ? 1 : 0)))
    .first<{
      impressions: number;
      clicks: number;
      valid_clicks: number;
      suspicious_clicks: number;
    }>();

  const imp = Number(totals?.impressions || 0);
  const valid = Number(totals?.valid_clicks || 0);

  return {
    generatedAt: new Date().toISOString(),
    filters: { from, to, campaign_id, placement_id, section_id, slot_type, device_category },
    totals: {
      impressions: imp,
      clicks: Number(totals?.clicks || 0),
      valid_clicks: valid,
      suspicious_clicks: Number(totals?.suspicious_clicks || 0),
      ctr: imp > 0 ? Math.round((valid / imp) * 10000) / 10000 : 0,
    },
    rows: rows.results || [],
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") {
      return withCors(env, req, new Response(null, { status: 204 }));
    }

    try {
      if (env.DB) await ensureSchema(env.DB);
    } catch (e) {
      return withCors(
        env,
        req,
        json({ ok: false, error: "db_init_failed", detail: String(e) }, 500)
      );
    }

    if (path === "/health" || path === "/") {
      return withCors(
        env,
        req,
        json({
          ok: true,
          service: "infouzel-analytics",
          mode: "aggregate-only",
          storesIp: false,
          storesFingerprint: false,
          storesFullUserAgent: false,
        })
      );
    }

    if (path === "/v1/ingest" && req.method === "POST") {
      const res = await handleIngest(env, req);
      return withCors(env, req, res);
    }

    if (path === "/v1/public/stats" && req.method === "GET") {
      const from = url.searchParams.get("from") || daysAgo(30);
      const to = url.searchParams.get("to") || todayUtc();
      const data = await publicStats(env, from, to);
      const cacheSec = String(env.PUBLIC_CACHE_SECONDS || "300");
      return withCors(
        env,
        req,
        json(data, 200, {
          "cache-control": `public, max-age=${cacheSec}, s-maxage=${cacheSec}`,
        })
      );
    }

    if (path === "/v1/admin/overview" && req.method === "GET") {
      if (!requireAdmin(env, req)) {
        return withCors(env, req, json({ ok: false, error: "unauthorized" }, 401));
      }
      const from = url.searchParams.get("from") || daysAgo(30);
      const to = url.searchParams.get("to") || todayUtc();
      const data = await adminOverview(env, from, to);
      return withCors(
        env,
        req,
        json(data, 200, { "cache-control": "no-store" })
      );
    }

    if (path === "/v1/ads/report" && req.method === "GET") {
      if (!requireAdmin(env, req)) {
        return withCors(env, req, json({ ok: false, error: "unauthorized" }, 401));
      }
      const data = await adReport(env, url);
      return withCors(
        env,
        req,
        json(data, 200, { "cache-control": "no-store" })
      );
    }

    return withCors(env, req, json({ ok: false, error: "not_found" }, 404));
  },
};
