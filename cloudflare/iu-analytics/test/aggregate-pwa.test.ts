import { describe, expect, it, vi } from "vitest";
import { applyEvent } from "../src/aggregate";
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
        return null as T;
      },
      async run() {
        if (/INSERT INTO daily_traffic/.test(sql)) {
          const [day, device, visits, page_views, public_section_views, private_tools_opens, pwa_installs] = binds;
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
            });
          }
          return { success: true };
        }
        if (/INSERT INTO ingest_audit/.test(sql)) {
          return { success: true };
        }
        return { success: true };
      },
      async all<T>() {
        if (/FROM daily_traffic/.test(sql)) {
          return { results: tables.daily_traffic.filter((r) => r.day >= binds[0] && r.day <= binds[1]) as T[] };
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

describe("applyEvent pwa_install", () => {
  it("increments only pwa_installs (+1), never visits/page_views", async () => {
    const db = mockD1();
    const store = createD1Store(db);
    await applyEvent(store, { type: "pwa_install", day: "2026-09-04", device_category: "mobile" });
    const blob = await store.readRange("2026-09-04", "2026-09-04");
    const row = blob.traffic["2026-09-04|mobile"];
    expect(row.pwa_installs).toBe(1);
    expect(row.visits).toBe(0);
    expect(row.page_views).toBe(0);
    expect(row.public_section_views).toBe(0);
    expect(row.private_tools_opens).toBe(0);
  });
});
