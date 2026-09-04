/**
 * Aggregate store — Cloudflare D1 is the only production source of truth.
 * HTTP Cache-Control on public GET is allowed; Cache API / KV must not store aggregates.
 * Never stores IP / UA / fingerprints — only aggregate counters.
 */

export type TrafficRow = {
  day: string;
  device_category: string;
  visits: number;
  page_views: number;
  public_section_views: number;
  private_tools_opens: number;
  pwa_installs: number;
};

export type StoreBlob = {
  traffic: Record<string, TrafficRow>;
  sections: Record<string, { day: string; section_id: string; views: number }>;
  ads: Record<
    string,
    {
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
    }
  >;
  performance: Record<string, { day: string; metric_name: string; sample_count: number; value_sum: number }>;
  errors: Record<string, { day: string; error_code: string; count: number }>;
  audit: Record<string, { day: string; accepted: number; rejected: number; suspicious: number }>;
};

export function emptyBlob(): StoreBlob {
  return { traffic: {}, sections: {}, ads: {}, performance: {}, errors: {}, audit: {} };
}

export type AnalyticsStore = {
  mode: "d1";
  ping: () => Promise<boolean>;
  bumpTraffic: (
    day: string,
    device: string,
    delta: Partial<
      Pick<TrafficRow, "visits" | "page_views" | "public_section_views" | "private_tools_opens" | "pwa_installs">
    >
  ) => Promise<void>;
  sumPwaInstalls: () => Promise<number>;
  bumpSection: (day: string, sectionId: string, n?: number) => Promise<void>;
  bumpAd: (
    day: string,
    keys: {
      campaign_id: string;
      placement_id: string;
      section_id: string;
      slot_type: string;
      device_category: string;
    },
    delta: { impressions?: number; clicks?: number; valid_clicks?: number; suspicious_clicks?: number }
  ) => Promise<{ impressions: number; clicks: number }>;
  bumpPerf: (day: string, metric: string, value: number) => Promise<void>;
  bumpError: (day: string, code: string) => Promise<void>;
  bumpAudit: (day: string, field: "accepted" | "rejected" | "suspicious") => Promise<void>;
  readRange: (from: string, to: string) => Promise<StoreBlob>;
  readDailySeries: (
    from: string,
    to: string
  ) => Promise<Array<{ day: string; visits: number; page_views: number }>>;
};

type StoreEnv = { DB?: D1Database };

export function createStore(env: StoreEnv): AnalyticsStore | null {
  if (!env.DB) return null;
  return createD1Store(env.DB);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createD1Store(db: D1Database): AnalyticsStore {
  return {
    mode: "d1",

    async ping() {
      try {
        const row = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        return !!(row && Number(row.ok) === 1);
      } catch {
        return false;
      }
    },

    async bumpTraffic(day, device, delta) {
      const visits = delta.visits || 0;
      const page_views = delta.page_views || 0;
      const public_section_views = delta.public_section_views || 0;
      const private_tools_opens = delta.private_tools_opens || 0;
      const pwa_installs = delta.pwa_installs || 0;
      await db
        .prepare(
          `INSERT INTO daily_traffic (day, device_category, visits, page_views, public_section_views, private_tools_opens, pwa_installs, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(day, device_category) DO UPDATE SET
             visits = visits + excluded.visits,
             page_views = page_views + excluded.page_views,
             public_section_views = public_section_views + excluded.public_section_views,
             private_tools_opens = private_tools_opens + excluded.private_tools_opens,
             pwa_installs = pwa_installs + excluded.pwa_installs,
             updated_at = excluded.updated_at`
        )
        .bind(day, device, visits, page_views, public_section_views, private_tools_opens, pwa_installs, nowIso())
        .run();
    },

    async sumPwaInstalls() {
      const row = await db
        .prepare(`SELECT COALESCE(SUM(pwa_installs), 0) AS total FROM daily_traffic`)
        .first<{ total: number }>();
      return Number(row?.total || 0);
    },

    async bumpSection(day, sectionId, n = 1) {
      await db
        .prepare(
          `INSERT INTO daily_sections (day, section_id, views, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(day, section_id) DO UPDATE SET
             views = views + excluded.views,
             updated_at = excluded.updated_at`
        )
        .bind(day, sectionId, n, nowIso())
        .run();
    },

    async bumpAd(day, keys, delta) {
      const impressions = delta.impressions || 0;
      const clicks = delta.clicks || 0;
      const valid_clicks = delta.valid_clicks || 0;
      const suspicious_clicks = delta.suspicious_clicks || 0;
      await db
        .prepare(
          `INSERT INTO daily_ads (
             day, campaign_id, placement_id, section_id, slot_type, device_category,
             impressions, clicks, valid_clicks, suspicious_clicks, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(day, campaign_id, placement_id, section_id, slot_type, device_category) DO UPDATE SET
             impressions = CASE WHEN impressions + excluded.impressions < 0 THEN 0 ELSE impressions + excluded.impressions END,
             clicks = CASE WHEN clicks + excluded.clicks < 0 THEN 0 ELSE clicks + excluded.clicks END,
             valid_clicks = CASE WHEN valid_clicks + excluded.valid_clicks < 0 THEN 0 ELSE valid_clicks + excluded.valid_clicks END,
             suspicious_clicks = CASE WHEN suspicious_clicks + excluded.suspicious_clicks < 0 THEN 0 ELSE suspicious_clicks + excluded.suspicious_clicks END,
             updated_at = excluded.updated_at`
        )
        .bind(
          day,
          keys.campaign_id,
          keys.placement_id,
          keys.section_id,
          keys.slot_type,
          keys.device_category,
          impressions,
          clicks,
          valid_clicks,
          suspicious_clicks,
          nowIso()
        )
        .run();

      const row = await db
        .prepare(
          `SELECT impressions, clicks FROM daily_ads
           WHERE day = ? AND campaign_id = ? AND placement_id = ? AND section_id = ?
             AND slot_type = ? AND device_category = ?`
        )
        .bind(
          day,
          keys.campaign_id,
          keys.placement_id,
          keys.section_id,
          keys.slot_type,
          keys.device_category
        )
        .first<{ impressions: number; clicks: number }>();
      return { impressions: Number(row?.impressions || 0), clicks: Number(row?.clicks || 0) };
    },

    async bumpPerf(day, metric, value) {
      await db
        .prepare(
          `INSERT INTO daily_performance (day, metric_name, sample_count, value_sum, updated_at)
           VALUES (?, ?, 1, ?, ?)
           ON CONFLICT(day, metric_name) DO UPDATE SET
             sample_count = sample_count + 1,
             value_sum = value_sum + excluded.value_sum,
             updated_at = excluded.updated_at`
        )
        .bind(day, metric, value, nowIso())
        .run();
    },

    async bumpError(day, code) {
      await db
        .prepare(
          `INSERT INTO daily_errors (day, error_code, count, updated_at)
           VALUES (?, ?, 1, ?)
           ON CONFLICT(day, error_code) DO UPDATE SET
             count = count + 1,
             updated_at = excluded.updated_at`
        )
        .bind(day, code, nowIso())
        .run();
    },

    async bumpAudit(day, field) {
      const accepted = field === "accepted" ? 1 : 0;
      const rejected = field === "rejected" ? 1 : 0;
      const suspicious = field === "suspicious" ? 1 : 0;
      await db
        .prepare(
          `INSERT INTO ingest_audit (day, accepted, rejected, suspicious, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(day) DO UPDATE SET
             accepted = accepted + excluded.accepted,
             rejected = rejected + excluded.rejected,
             suspicious = suspicious + excluded.suspicious,
             updated_at = excluded.updated_at`
        )
        .bind(day, accepted, rejected, suspicious, nowIso())
        .run();
    },

    async readDailySeries(from, to) {
      const traffic = await db
        .prepare(
          `SELECT day, visits, page_views
           FROM daily_traffic WHERE day >= ? AND day <= ?`
        )
        .bind(from, to)
        .all<{ day: string; visits: number; page_views: number }>();
      const byDay: Record<string, { day: string; visits: number; page_views: number }> = {};
      for (const row of traffic.results || []) {
        const cur = byDay[row.day] || { day: row.day, visits: 0, page_views: 0 };
        cur.visits += Number(row.visits || 0);
        cur.page_views += Number(row.page_views || 0);
        byDay[row.day] = cur;
      }
      return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
    },

    async readRange(from, to) {
      const out = emptyBlob();
      const traffic = await db
        .prepare(
          `SELECT day, device_category, visits, page_views, public_section_views, private_tools_opens, pwa_installs
           FROM daily_traffic WHERE day >= ? AND day <= ?`
        )
        .bind(from, to)
        .all<TrafficRow>();
      for (const row of traffic.results || []) {
        out.traffic[row.day + "|" + row.device_category] = row;
      }

      const sections = await db
        .prepare(`SELECT day, section_id, views FROM daily_sections WHERE day >= ? AND day <= ?`)
        .bind(from, to)
        .all<{ day: string; section_id: string; views: number }>();
      for (const row of sections.results || []) {
        out.sections[row.day + "|" + row.section_id] = row;
      }

      const ads = await db
        .prepare(
          `SELECT day, campaign_id, placement_id, section_id, slot_type, device_category,
                  impressions, clicks, valid_clicks, suspicious_clicks
           FROM daily_ads WHERE day >= ? AND day <= ?`
        )
        .bind(from, to)
        .all<{
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
        }>();
      for (const row of ads.results || []) {
        const id = [row.day, row.campaign_id, row.placement_id, row.section_id, row.slot_type, row.device_category].join(
          "|"
        );
        out.ads[id] = row;
      }

      const performance = await db
        .prepare(
          `SELECT day, metric_name, sample_count, value_sum FROM daily_performance WHERE day >= ? AND day <= ?`
        )
        .bind(from, to)
        .all<{ day: string; metric_name: string; sample_count: number; value_sum: number }>();
      for (const row of performance.results || []) {
        out.performance[row.day + "|" + row.metric_name] = row;
      }

      const errors = await db
        .prepare(`SELECT day, error_code, count FROM daily_errors WHERE day >= ? AND day <= ?`)
        .bind(from, to)
        .all<{ day: string; error_code: string; count: number }>();
      for (const row of errors.results || []) {
        out.errors[row.day + "|" + row.error_code] = row;
      }

      const audit = await db
        .prepare(`SELECT day, accepted, rejected, suspicious FROM ingest_audit WHERE day >= ? AND day <= ?`)
        .bind(from, to)
        .all<{ day: string; accepted: number; rejected: number; suspicious: number }>();
      for (const row of audit.results || []) {
        out.audit[row.day] = row;
      }

      return out;
    },
  };
}
