import { applyEvent, rejectEvent } from "./aggregate";
import { isTestAdCampaignId } from "./ads-policy";
import { buildCorsHeaders } from "./cors";
import { privacyGuard, todayUtc } from "./privacy";
import { AnalyticsStore, createStore } from "./store";
import { Env } from "./types";

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

function withCors(env: Env, req: Request, res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(buildCorsHeaders(env, req))) h.set(k, String(v));
  return new Response(res.body, { status: res.status, headers: h });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAdmin(env: Env, req: Request): boolean {
  const token = env.ADMIN_TOKEN || "";
  if (!token) return false;
  const auth = req.headers.get("Authorization") || "";
  return timingSafeEqual(auth, "Bearer " + token);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function isIsoDay(v: string | null): v is string {
  return !!(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
}

async function publicStats(store: AnalyticsStore, from: string, to: string, seriesFrom: string) {
  const blob = await store.readRange(from, to);
  const byDay: Record<string, { day: string; visits: number; page_views: number; public_section_views: number; private_tools_opens: number }> = {};
  for (const row of Object.values(blob.traffic)) {
    const cur = byDay[row.day] || {
      day: row.day,
      visits: 0,
      page_views: 0,
      public_section_views: 0,
      private_tools_opens: 0,
    };
    cur.visits += row.visits;
    cur.page_views += row.page_views;
    cur.public_section_views += row.public_section_views;
    cur.private_tools_opens += row.private_tools_opens;
    byDay[row.day] = cur;
  }
  const series = await store.readDailySeries(seriesFrom, to);
  const devicesMap: Record<string, { device_category: string; visits: number; page_views: number; activity: number }> = {};
  for (const row of Object.values(blob.traffic)) {
    const cur = devicesMap[row.device_category] || {
      device_category: row.device_category,
      visits: 0,
      page_views: 0,
      activity: 0,
    };
    cur.visits += row.visits;
    cur.page_views += row.page_views;
    cur.activity +=
      row.visits + row.page_views + row.public_section_views + row.private_tools_opens;
    devicesMap[row.device_category] = cur;
  }
  const sectionMap: Record<string, { section_id: string; views: number }> = {};
  for (const row of Object.values(blob.sections)) {
    const cur = sectionMap[row.section_id] || { section_id: row.section_id, views: 0 };
    cur.views += row.views;
    sectionMap[row.section_id] = cur;
  }
  const topPublicSections = Object.values(sectionMap)
    .sort((a, b) => b.views - a.views)
    .slice(0, 12);

  const today = todayUtc();
  const yesterday = daysAgo(1);
  const monthStart = today.slice(0, 8) + "01";
  const sumFor = (day: string) => {
    const row = byDay[day];
    return { visits: row?.visits || 0, page_views: row?.page_views || 0 };
  };
  let monthVisits = 0;
  let monthViews = 0;
  let monthPrivate = 0;
  for (const row of Object.values(byDay)) {
    if (row.day >= monthStart && row.day <= today) {
      monthVisits += row.visits;
      monthViews += row.page_views;
      monthPrivate += row.private_tools_opens;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    storageMode: store.mode,
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
    today: sumFor(today),
    yesterday: sumFor(yesterday),
    month: { visits: monthVisits, page_views: monthViews, private_tools_opens: monthPrivate },
    series,
    historyStart: series.length ? series[0].day : null,
    devices: Object.values(devicesMap)
      .filter((d) => d.activity > 0)
      .map(({ device_category, visits, page_views }) => ({ device_category, visits, page_views })),
    topPublicSections,
    privateToolsSummary: {
      label: "Soukromé nástroje – anonymní souhrn",
      opens: monthPrivate,
    },
    auditStatus: {
      legal: "Veřejné agregáty bez osobních údajů; monetizace podléhá samostatnému právnímu review.",
      security: "Admin API chráněno Bearer tokenem; veřejný endpoint vrací jen agregáty.",
      anonymization: "Neukládáme IP ani fingerprint; UA jen kategorie zařízení.",
    },
  };
}

async function handleIngest(env: Env, req: Request, store: AnalyticsStore): Promise<Response> {
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
  let accepted = 0;
  let rejected = 0;
  let suspicious = 0;
  for (const ev of events) {
    const guarded = privacyGuard(ev, ua);
    if (!guarded.ok) {
      rejected += 1;
      await rejectEvent(store, todayUtc());
      continue;
    }
    const applied = await applyEvent(store, guarded.event);
    if (applied.suspicious) suspicious += 1;
    else accepted += 1;
  }
  return json({ ok: true, accepted, rejected, suspicious, storageMode: store.mode });
}

async function adReport(store: AnalyticsStore, url: URL) {
  const from = url.searchParams.get("from") || daysAgo(30);
  const to = url.searchParams.get("to") || todayUtc();
  const campaign_id = url.searchParams.get("campaign_id");
  const placement_id = url.searchParams.get("placement_id");
  const section_id = url.searchParams.get("section_id");
  const slot_type = url.searchParams.get("slot_type");
  const device_category = url.searchParams.get("device_category");
  const includeTest = url.searchParams.get("include_test") === "1";
  const blob = await store.readRange(from, to);
  let rows = Object.values(blob.ads);
  // Business default: drop test_* campaigns unless include_test=1 or an explicit campaign_id is requested
  // (explicit campaign_id allows admins to inspect a known verification campaign).
  if (!includeTest && !campaign_id) {
    rows = rows.filter((r) => !isTestAdCampaignId(r.campaign_id));
  }
  if (campaign_id) rows = rows.filter((r) => r.campaign_id === campaign_id);
  if (placement_id) rows = rows.filter((r) => r.placement_id === placement_id);
  if (section_id) rows = rows.filter((r) => r.section_id === section_id);
  if (slot_type) rows = rows.filter((r) => r.slot_type === slot_type);
  if (device_category) rows = rows.filter((r) => r.device_category === device_category);
  rows = rows
    .map((r) => ({
      ...r,
      ctr: r.impressions > 0 ? Math.round((r.valid_clicks / r.impressions) * 10000) / 10000 : 0,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const valid = rows.reduce((s, r) => s + r.valid_clicks, 0);
  const sus = rows.reduce((s, r) => s + r.suspicious_clicks, 0);
  return {
    generatedAt: new Date().toISOString(),
    filters: { from, to, campaign_id, placement_id, section_id, slot_type, device_category, include_test: includeTest },
    testDataPolicy: {
      excludesTestCampaignPrefixByDefault: true,
      testCampaignPrefix: "test_",
      includeTestParam: includeTest,
    },
    totals: {
      impressions,
      clicks,
      valid_clicks: valid,
      suspicious_clicks: sus,
      ctr: impressions > 0 ? Math.round((valid / impressions) * 10000) / 10000 : 0,
    },
    rows: rows.slice(0, 2000),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") {
      return withCors(env, req, new Response(null, { status: 204 }));
    }

    const store = createStore(env);

    if (path === "/health" || path === "/") {
      if (!store) {
        return withCors(
          env,
          req,
          json(
            {
              ok: false,
              service: "infouzel-analytics",
              mode: "aggregate-only",
              storageMode: "unavailable",
              error: "d1_binding_missing",
              storesIp: false,
              storesFingerprint: false,
              storesFullUserAgent: false,
            },
            503
          )
        );
      }
      const alive = await store.ping();
      return withCors(
        env,
        req,
        json(
          {
            ok: alive,
            service: "infouzel-analytics",
            mode: "aggregate-only",
            storageMode: alive ? "d1" : "unavailable",
            error: alive ? undefined : "d1_unreachable",
            storesIp: false,
            storesFingerprint: false,
            storesFullUserAgent: false,
          },
          alive ? 200 : 503
        )
      );
    }

    if (!store) {
      return withCors(
        env,
        req,
        json({ ok: false, error: "d1_binding_missing", storageMode: "unavailable" }, 503)
      );
    }

    if (path === "/v1/ingest" && req.method === "POST") {
      try {
        return withCors(env, req, await handleIngest(env, req, store));
      } catch {
        return withCors(env, req, json({ ok: false, error: "d1_write_failed", storageMode: "d1" }, 503));
      }
    }

    if (path === "/v1/public/stats" && req.method === "GET") {
      try {
        const from = url.searchParams.get("from") || daysAgo(30);
        const to = url.searchParams.get("to") || todayUtc();
        const seriesFromRaw = url.searchParams.get("series_from");
        const seriesFrom = isIsoDay(seriesFromRaw) ? seriesFromRaw : "2000-01-01";
        const data = await publicStats(store, from, to, seriesFrom);
        const cacheSec = String(env.PUBLIC_CACHE_SECONDS || "60");
        return withCors(
          env,
          req,
          json(data, 200, {
            // HTTP response cache only — not a durable store
            "cache-control": `public, max-age=${cacheSec}, s-maxage=${cacheSec}`,
          })
        );
      } catch {
        return withCors(env, req, json({ ok: false, error: "d1_read_failed", storageMode: "d1" }, 503));
      }
    }

    if (path === "/v1/admin/overview" && req.method === "GET") {
      if (!requireAdmin(env, req)) return withCors(env, req, json({ ok: false, error: "unauthorized" }, 401));
      try {
        const from = url.searchParams.get("from") || daysAgo(30);
        const to = url.searchParams.get("to") || todayUtc();
        const seriesFromRaw = url.searchParams.get("series_from");
        const seriesFrom = isIsoDay(seriesFromRaw) ? seriesFromRaw : from;
        const pub = await publicStats(store, from, to, seriesFrom);
        const blob = await store.readRange(from, to);
        const ads = Object.values(blob.ads)
          .map((r) => ({
            ...r,
            ctr: r.impressions > 0 ? Math.round((r.valid_clicks / r.impressions) * 10000) / 10000 : 0,
          }))
          .sort((a, b) => b.day.localeCompare(a.day))
          .slice(0, 500);
        return withCors(
          env,
          req,
          json(
            {
              ...pub,
              ads,
              ingestAudit: Object.values(blob.audit).sort((a, b) => b.day.localeCompare(a.day)),
              errors: Object.values(blob.errors),
              performance: Object.values(blob.performance).map((p) => ({
                metric_name: p.metric_name,
                samples: p.sample_count,
                value_sum: p.value_sum,
                avg_value: p.sample_count > 0 ? p.value_sum / p.sample_count : 0,
              })),
            },
            200,
            { "cache-control": "no-store" }
          )
        );
      } catch {
        return withCors(env, req, json({ ok: false, error: "d1_read_failed", storageMode: "d1" }, 503));
      }
    }

    if (path === "/v1/ads/report" && req.method === "GET") {
      if (!requireAdmin(env, req)) return withCors(env, req, json({ ok: false, error: "unauthorized" }, 401));
      try {
        return withCors(env, req, json(await adReport(store, url), 200, { "cache-control": "no-store" }));
      } catch {
        return withCors(env, req, json({ ok: false, error: "d1_read_failed", storageMode: "d1" }, 503));
      }
    }

    return withCors(env, req, json({ ok: false, error: "not_found" }, 404));
  },
};
