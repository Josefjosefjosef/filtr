import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAdsReport } from "../src/analytics-client";
import type { Env } from "../src/types";

type Row = Record<string, unknown>;

class FakeD1 {
  settings = new Map<string, string>();
  prepare(sql: string) {
    const first = async <T>(): Promise<T | null> => {
      const m = sql.match(/key = '([^']+)'/);
      if (!m) return null;
      const v = this.settings.get(m[1]);
      return v === undefined ? null : ({ value: v } as unknown as T);
    };
    return { first, bind: (..._args: unknown[]) => ({ first }) };
  }
}

function buildEnv(overrides: Partial<Env> = {}): { env: Env; db: FakeD1 } {
  const db = new FakeD1();
  db.settings.set("ANALYTICS_ADMIN_REPORT_URL", "https://infouzel-analytics.josef-zmrhal.workers.dev");
  const env: Env = { DB: db as unknown as D1Database, ANALYTICS_ADMIN_TOKEN: "sep-analytics-secret", ...overrides };
  return { env, db };
}

describe("fetchAdsReport — fail-closed configuration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("503 stats_not_configured when ANALYTICS_ADMIN_REPORT_URL is unset", async () => {
    const { env, db } = buildEnv();
    db.settings.delete("ANALYTICS_ADMIN_REPORT_URL");
    const res = await fetchAdsReport(env, {});
    expect(res).toEqual({ ok: false, status: 503, error: "stats_not_configured" });
  });

  it("503 stats_not_configured when ANALYTICS_ADMIN_TOKEN secret is missing", async () => {
    const { env } = buildEnv({ ANALYTICS_ADMIN_TOKEN: undefined });
    const res = await fetchAdsReport(env, {});
    expect(res).toEqual({ ok: false, status: 503, error: "stats_not_configured" });
  });

  it("503 stats_not_configured when ANALYTICS_ADMIN_REPORT_URL host is not allowlisted (BE-003)", async () => {
    const { env, db } = buildEnv();
    db.settings.set("ANALYTICS_ADMIN_REPORT_URL", "https://evil.example/steal");
    const res = await fetchAdsReport(env, {});
    expect(res).toEqual({ ok: false, status: 503, error: "stats_not_configured" });
  });

  it("503 stats_not_configured when there is no DB binding at all", async () => {
    const res = await fetchAdsReport({ ANALYTICS_ADMIN_TOKEN: "x" } as Env, {});
    expect(res).toEqual({ ok: false, status: 503, error: "stats_not_configured" });
  });
});

describe("fetchAdsReport — network/upstream failures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("503 stats_upstream_unreachable when fetch throws", async () => {
    const { env } = buildEnv();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const res = await fetchAdsReport(env, {});
    expect(res).toEqual({ ok: false, status: 503, error: "stats_upstream_unreachable" });
  });

  it("503 stats_upstream_error on non-2xx upstream response", async () => {
    const { env } = buildEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    const res = await fetchAdsReport(env, {});
    expect(res).toEqual({ ok: false, status: 503, error: "stats_upstream_error" });
  });

  it("503 stats_upstream_error on invalid JSON body", async () => {
    const { env } = buildEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    const res = await fetchAdsReport(env, {});
    expect(res).toEqual({ ok: false, status: 503, error: "stats_upstream_error" });
  });
});

describe("fetchAdsReport — success path", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the bearer token and forwards filter params in the query string", async () => {
    const { env } = buildEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rows: [], totals: {} }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchAdsReport(env, { campaign_id: "cmp_1", from: "2026-01-01", to: "2026-01-31", device_category: "pc" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [urlArg, initArg] = fetchMock.mock.calls[0];
    const url = new URL(String(urlArg));
    expect(url.origin + url.pathname).toBe("https://infouzel-analytics.josef-zmrhal.workers.dev/v1/ads/report");
    expect(url.searchParams.get("campaign_id")).toBe("cmp_1");
    expect(url.searchParams.get("from")).toBe("2026-01-01");
    expect(url.searchParams.get("to")).toBe("2026-01-31");
    expect(url.searchParams.get("device_category")).toBe("pc");
    expect((initArg as RequestInit).headers).toMatchObject({ Authorization: "Bearer sep-analytics-secret" });
  });

  it("builds rows/totals from an explicit allowlist, dropping unexpected upstream fields", async () => {
    const { env } = buildEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            rows: [
              {
                day: "2026-01-05",
                campaign_id: "cmp_1",
                placement_id: "plc_1",
                section_id: "home",
                slot_type: "banner",
                device_category: "pc",
                impressions: 100,
                clicks: 10,
                valid_clicks: 8,
                suspicious_clicks: 2,
                // Fields that must never survive sanitizeRow even if an upstream bug ever emitted them.
                price_cents: 99999,
                email: "leak@example.test",
                client_code: "secret-code",
              },
            ],
            totals: { impressions: 100, clicks: 10, valid_clicks: 8, suspicious_clicks: 2, price_cents: 5 },
          }),
          { status: 200 }
        )
      )
    );

    const res = await fetchAdsReport(env, {});
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.rows).toHaveLength(1);
    expect(Object.keys(res.rows[0]).sort()).toEqual(
      ["campaign_id", "clicks", "ctr", "day", "device_category", "impressions", "placement_id", "section_id", "slot_type", "suspicious_clicks", "valid_clicks"].sort()
    );
    expect(res.rows[0].ctr).toBe(0.08);
    expect(Object.keys(res.totals).sort()).toEqual(["clicks", "ctr", "impressions", "suspicious_clicks", "valid_clicks"].sort());
    expect(res.totals.ctr).toBe(0.08);
  });

  it("tolerates a malformed rows/totals shape from upstream (defaults to empty/zero)", async () => {
    const { env } = buildEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
    const res = await fetchAdsReport(env, {});
    expect(res).toEqual({
      ok: true,
      rows: [],
      totals: { impressions: 0, clicks: 0, valid_clicks: 0, suspicious_clicks: 0, ctr: 0 },
    });
  });
});
