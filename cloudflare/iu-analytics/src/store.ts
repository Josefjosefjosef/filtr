/**
 * Aggregate store: prefer D1 when bound; otherwise Cloudflare Cache API.
 * Never stores IP / UA / fingerprints — only aggregate counters.
 */

export type TrafficRow = {
  day: string;
  device_category: string;
  visits: number;
  page_views: number;
  public_section_views: number;
  private_tools_opens: number;
};

type StoreBlob = {
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

function emptyBlob(): StoreBlob {
  return { traffic: {}, sections: {}, ads: {}, performance: {}, errors: {}, audit: {} };
}

async function cacheGet(cache: Cache, key: string): Promise<StoreBlob> {
  const res = await cache.match(new Request("https://iu-analytics.internal/" + key));
  if (!res) return emptyBlob();
  try {
    return (await res.json()) as StoreBlob;
  } catch {
    return emptyBlob();
  }
}

async function cachePut(cache: Cache, key: string, blob: StoreBlob): Promise<void> {
  await cache.put(
    new Request("https://iu-analytics.internal/" + key),
    new Response(JSON.stringify(blob), {
      headers: { "content-type": "application/json", "cache-control": "max-age=31536000" },
    })
  );
}

export type AnalyticsStore = {
  mode: "d1" | "cache";
  bumpTraffic: (
    day: string,
    device: string,
    delta: Partial<Pick<TrafficRow, "visits" | "page_views" | "public_section_views" | "private_tools_opens">>
  ) => Promise<void>;
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
};

export function createStore(env: { DB?: D1Database }): AnalyticsStore {
  if (env.DB) {
    // D1 path kept for when account token has D1:Edit — bind DB in wrangler.toml.
    return createD1Store(env.DB);
  }
  return createCacheStore();
}

function createCacheStore(): AnalyticsStore {
  const cache = caches.default;
  const keyForDay = (day: string) => "v1:" + day;

  async function mutate(day: string, fn: (b: StoreBlob) => void): Promise<StoreBlob> {
    const k = keyForDay(day);
    const blob = await cacheGet(cache, k);
    fn(blob);
    await cachePut(cache, k, blob);
    return blob;
  }

  return {
    mode: "cache",
    async bumpTraffic(day, device, delta) {
      await mutate(day, (b) => {
        const id = day + "|" + device;
        const cur = b.traffic[id] || {
          day,
          device_category: device,
          visits: 0,
          page_views: 0,
          public_section_views: 0,
          private_tools_opens: 0,
        };
        cur.visits += delta.visits || 0;
        cur.page_views += delta.page_views || 0;
        cur.public_section_views += delta.public_section_views || 0;
        cur.private_tools_opens += delta.private_tools_opens || 0;
        b.traffic[id] = cur;
      });
    },
    async bumpSection(day, sectionId, n = 1) {
      await mutate(day, (b) => {
        const id = day + "|" + sectionId;
        const cur = b.sections[id] || { day, section_id: sectionId, views: 0 };
        cur.views += n;
        b.sections[id] = cur;
      });
    },
    async bumpAd(day, keys, delta) {
      let out = { impressions: 0, clicks: 0 };
      await mutate(day, (b) => {
        const id = [day, keys.campaign_id, keys.placement_id, keys.section_id, keys.slot_type, keys.device_category].join("|");
        const cur = b.ads[id] || {
          day,
          ...keys,
          impressions: 0,
          clicks: 0,
          valid_clicks: 0,
          suspicious_clicks: 0,
        };
        cur.impressions += delta.impressions || 0;
        cur.clicks += delta.clicks || 0;
        cur.valid_clicks += delta.valid_clicks || 0;
        cur.suspicious_clicks += delta.suspicious_clicks || 0;
        b.ads[id] = cur;
        out = { impressions: cur.impressions, clicks: cur.clicks };
      });
      return out;
    },
    async bumpPerf(day, metric, value) {
      await mutate(day, (b) => {
        const id = day + "|" + metric;
        const cur = b.performance[id] || { day, metric_name: metric, sample_count: 0, value_sum: 0 };
        cur.sample_count += 1;
        cur.value_sum += value;
        b.performance[id] = cur;
      });
    },
    async bumpError(day, code) {
      await mutate(day, (b) => {
        const id = day + "|" + code;
        const cur = b.errors[id] || { day, error_code: code, count: 0 };
        cur.count += 1;
        b.errors[id] = cur;
      });
    },
    async bumpAudit(day, field) {
      await mutate(day, (b) => {
        const cur = b.audit[day] || { day, accepted: 0, rejected: 0, suspicious: 0 };
        cur[field] += 1;
        b.audit[day] = cur;
      });
    },
    async readRange(from, to) {
      const out = emptyBlob();
      const start = new Date(from + "T00:00:00Z");
      const end = new Date(to + "T00:00:00Z");
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.toISOString().slice(0, 10);
        const blob = await cacheGet(cache, keyForDay(day));
        Object.assign(out.traffic, blob.traffic);
        Object.assign(out.sections, blob.sections);
        Object.assign(out.ads, blob.ads);
        Object.assign(out.performance, blob.performance);
        Object.assign(out.errors, blob.errors);
        Object.assign(out.audit, blob.audit);
      }
      return out;
    },
  };
}

function createD1Store(db: D1Database): AnalyticsStore {
  // Minimal D1 adapter — full SQL path remains in aggregate.ts for migrations;
  // when DB is bound, index uses applyEvent SQL. This stub marks mode only.
  return {
    mode: "d1",
    async bumpTraffic() {
      /* handled by aggregate.ts when DB present */
    },
    async bumpSection() {},
    async bumpAd() {
      return { impressions: 0, clicks: 0 };
    },
    async bumpPerf() {},
    async bumpError() {},
    async bumpAudit() {},
    async readRange() {
      return emptyBlob();
    },
  };
}
