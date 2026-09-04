import { describe, expect, it, vi } from "vitest";
import { createD1Store } from "../src/store";

type Row = Record<string, unknown>;

function mockD1() {
  const tables: Record<string, Row[]> = {
    daily_traffic: [],
    daily_sections: [],
    daily_ads: [],
    daily_performance: [],
    daily_errors: [],
    ingest_audit: [],
  };

  function prepare(sql: string) {
    const binds: unknown[] = [];
    const api = {
      bind(...args: unknown[]) {
        binds.push(...args);
        return api;
      },
      async first<T>() {
        if (/SELECT 1/.test(sql)) return { ok: 1 } as T;
        if (/SUM\(pwa_installs\)/.test(sql)) {
          const total = tables.daily_traffic.reduce((s, r) => s + Number(r.pwa_installs || 0), 0);
          return { total } as T;
        }
        if (/FROM daily_ads/.test(sql)) {
          const row = tables.daily_ads.find(
            (r) =>
              r.day === binds[0] &&
              r.campaign_id === binds[1] &&
              r.placement_id === binds[2] &&
              r.section_id === binds[3] &&
              r.slot_type === binds[4] &&
              r.device_category === binds[5]
          );
          return (row || null) as T;
        }
        return null as T;
      },
      async run() {
        if (/INSERT INTO daily_traffic/.test(sql)) {
          const [day, device, visits, page_views, public_section_views, private_tools_opens, pwa_installs] = binds;
          const key = String(day) + "|" + String(device);
          const existing = tables.daily_traffic.find((r) => r.day === day && r.device_category === device);
          if (existing) {
            existing.visits = Number(existing.visits) + Number(visits);
            existing.page_views = Number(existing.page_views) + Number(page_views);
            existing.public_section_views = Number(existing.public_section_views) + Number(public_section_views);
            existing.private_tools_opens = Number(existing.private_tools_opens) + Number(private_tools_opens);
            existing.pwa_installs = Number(existing.pwa_installs || 0) + Number(pwa_installs || 0);
          } else {
            tables.daily_traffic.push({
              day,
              device_category: device,
              visits,
              page_views,
              public_section_views,
              private_tools_opens,
              pwa_installs: pwa_installs || 0,
              _key: key,
            });
          }
          return { success: true };
        }
        if (/INSERT INTO daily_sections/.test(sql)) {
          const [day, section_id, views] = binds;
          const existing = tables.daily_sections.find((r) => r.day === day && r.section_id === section_id);
          if (existing) existing.views = Number(existing.views) + Number(views);
          else tables.daily_sections.push({ day, section_id, views });
          return { success: true };
        }
        if (/INSERT INTO daily_ads/.test(sql)) {
          const [
            day,
            campaign_id,
            placement_id,
            section_id,
            slot_type,
            device_category,
            impressions,
            clicks,
            valid_clicks,
            suspicious_clicks,
          ] = binds;
          const existing = tables.daily_ads.find(
            (r) =>
              r.day === day &&
              r.campaign_id === campaign_id &&
              r.placement_id === placement_id &&
              r.section_id === section_id &&
              r.slot_type === slot_type &&
              r.device_category === device_category
          );
          if (existing) {
            existing.impressions = Number(existing.impressions) + Number(impressions);
            existing.clicks = Number(existing.clicks) + Number(clicks);
            existing.valid_clicks = Number(existing.valid_clicks) + Number(valid_clicks);
            existing.suspicious_clicks = Number(existing.suspicious_clicks) + Number(suspicious_clicks);
          } else {
            tables.daily_ads.push({
              day,
              campaign_id,
              placement_id,
              section_id,
              slot_type,
              device_category,
              impressions,
              clicks,
              valid_clicks,
              suspicious_clicks,
            });
          }
          return { success: true };
        }
        if (/INSERT INTO ingest_audit/.test(sql)) {
          const [day, accepted, rejected, suspicious] = binds;
          const existing = tables.ingest_audit.find((r) => r.day === day);
          if (existing) {
            existing.accepted = Number(existing.accepted) + Number(accepted);
            existing.rejected = Number(existing.rejected) + Number(rejected);
            existing.suspicious = Number(existing.suspicious) + Number(suspicious);
          } else {
            tables.ingest_audit.push({ day, accepted, rejected, suspicious });
          }
          return { success: true };
        }
        return { success: true };
      },
      async all<T>() {
        if (/FROM daily_traffic/.test(sql)) {
          return { results: tables.daily_traffic.filter((r) => r.day >= binds[0] && r.day <= binds[1]) as T[] };
        }
        if (/FROM daily_sections/.test(sql)) {
          return { results: tables.daily_sections.filter((r) => r.day >= binds[0] && r.day <= binds[1]) as T[] };
        }
        if (/FROM daily_ads/.test(sql)) {
          return { results: tables.daily_ads.filter((r) => r.day >= binds[0] && r.day <= binds[1]) as T[] };
        }
        if (/FROM daily_performance/.test(sql)) return { results: [] as T[] };
        if (/FROM daily_errors/.test(sql)) return { results: [] as T[] };
        if (/FROM ingest_audit/.test(sql)) {
          return { results: tables.ingest_audit.filter((r) => r.day >= binds[0] && r.day <= binds[1]) as T[] };
        }
        return { results: [] as T[] };
      },
    };
    return api;
  }

  return {
    prepare: vi.fn((sql: string) => prepare(sql)),
    _tables: tables,
  } as unknown as D1Database & { _tables: typeof tables };
}

describe("createD1Store", () => {
  it("pings and upserts traffic/sections/ads into D1 aggregates", async () => {
    const db = mockD1();
    const store = createD1Store(db);
    expect(store.mode).toBe("d1");
    expect(await store.ping()).toBe(true);

    await store.bumpTraffic("2026-07-21", "pc", { visits: 1, page_views: 1 });
    await store.bumpTraffic("2026-07-21", "pc", { visits: 1, page_views: 1 });
    await store.bumpSection("2026-07-21", "media", 1);
    const after = await store.bumpAd(
      "2026-07-21",
      {
        campaign_id: "c1",
        placement_id: "p1",
        section_id: "media",
        slot_type: "banner",
        device_category: "pc",
      },
      { impressions: 1, clicks: 1, valid_clicks: 1 }
    );
    expect(after.impressions).toBe(1);
    await store.bumpAudit("2026-07-21", "accepted");

    const blob = await store.readRange("2026-07-21", "2026-07-21");
    expect(blob.traffic["2026-07-21|pc"].visits).toBe(2);
    expect(blob.sections["2026-07-21|media"].views).toBe(1);
    expect(Object.values(blob.ads)[0].valid_clicks).toBe(1);
    expect(blob.audit["2026-07-21"].accepted).toBe(1);
  });

  it("readDailySeries sums visits and page_views per day across devices", async () => {
    const db = mockD1();
    const store = createD1Store(db);
    await store.bumpTraffic("2026-07-21", "pc", { visits: 2, page_views: 3 });
    await store.bumpTraffic("2026-07-21", "mobile", { visits: 5, page_views: 7 });
    await store.bumpTraffic("2026-07-22", "pc", { visits: 1, page_views: 1 });
    const series = await store.readDailySeries("2000-01-01", "2026-07-22");
    expect(series).toEqual([
      { day: "2026-07-21", visits: 7, page_views: 10 },
      { day: "2026-07-22", visits: 1, page_views: 1 },
    ]);
  });

  it("bumps pwa_installs without affecting visits", async () => {
    const db = mockD1();
    const store = createD1Store(db);
    await store.bumpTraffic("2026-09-04", "mobile", { pwa_installs: 1 });
    await store.bumpTraffic("2026-09-04", "mobile", { pwa_installs: 1 });
    await store.bumpTraffic("2026-09-04", "pc", { visits: 3, page_views: 3 });
    const blob = await store.readRange("2026-09-04", "2026-09-04");
    expect(blob.traffic["2026-09-04|mobile"].pwa_installs).toBe(2);
    expect(blob.traffic["2026-09-04|mobile"].visits).toBe(0);
    expect(await store.sumPwaInstalls()).toBe(2);
  });
});
