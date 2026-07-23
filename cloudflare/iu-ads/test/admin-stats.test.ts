import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGetCampaignStats, handleGetStatsSummary } from "../src/admin-stats";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import type { Env } from "../src/types";

type Row = Record<string, unknown>;

class FakeStatement {
  private params: unknown[] = [];
  constructor(private db: FakeD1, private sql: string) {}
  bind(...args: unknown[]): FakeStatement {
    this.params = args;
    return this;
  }
  async first<T>(): Promise<T | null> {
    return this.db.execute(this.sql, this.params, "first");
  }
  async all<T>(): Promise<{ results: T[] }> {
    return this.db.execute(this.sql, this.params, "all");
  }
  async run(): Promise<{ success: true }> {
    return this.db.execute(this.sql, this.params, "run");
  }
}

class FakeD1 {
  adminUsers = new Map<string, Row>();
  adminUserRoles = new Map<string, string[]>();
  adminSessions = new Map<string, Row>();
  campaigns = new Map<string, Row>();
  settings = new Map<string, string>([
    ["ANALYTICS_ADMIN_REPORT_URL", "https://infouzel-analytics.example.workers.dev"],
    ["STATS_TEST_CAMPAIGN_PREFIX", "test"],
  ]);

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  execute(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): any {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    if (sql.startsWith("UPDATE admin_sessions SET last_seen_at")) return { success: true };

    if (sql.includes("FROM admin_sessions WHERE session_id = ? AND token_hash = ?")) {
      const [sessionId, tokenHash] = params;
      const row = this.adminSessions.get(String(sessionId));
      const hit = row && row.token_hash === tokenHash ? row : null;
      return mode === "all" ? { results: hit ? [hit] : [] } : hit;
    }
    if (sql.includes("FROM admin_users WHERE user_id = ?")) {
      const [userId] = params;
      return this.adminUsers.get(String(userId)) || null;
    }
    if (sql.includes("FROM admin_user_roles WHERE user_id = ?")) {
      const [userId] = params;
      const roles = this.adminUserRoles.get(String(userId)) || [];
      return { results: roles.map((r) => ({ role_code: r })) };
    }
    if (sql.includes("system_settings WHERE key = '")) {
      const m = sql.match(/key = '([^']+)'/);
      const key = m ? m[1] : "";
      const v = this.settings.get(key);
      return v === undefined ? null : { value: v };
    }
    if (sql.includes("FROM campaigns WHERE campaign_id = ?")) {
      const [campaignId] = params;
      return this.campaigns.get(String(campaignId)) || null;
    }
    if (mode === "all") return { results: [] };
    if (mode === "run") return { success: true };
    return null;
  }
}

const SECRET = "test-session-secret-not-for-prod";

async function buildSessionRequest(
  db: FakeD1,
  opts: { userId: string; roles: string[]; url: string }
): Promise<Request> {
  db.adminUsers.set(opts.userId, { user_id: opts.userId, email: opts.userId + "@example.test", display_name: "Test", is_active: 1 });
  db.adminUserRoles.set(opts.userId, opts.roles);
  const sessionId = generateSessionId();
  const tokenHash = await hashOpaqueToken(sessionId);
  const exp = nowSeconds() + 3600;
  db.adminSessions.set(sessionId, {
    session_id: sessionId,
    user_id: opts.userId,
    token_hash: tokenHash,
    expires_at: new Date(exp * 1000).toISOString(),
    revoked_at: null,
  });
  const token = await signSessionToken(SECRET, { sessionId, exp });
  return new Request(opts.url, { method: "GET", headers: { Cookie: "iu_ads_admin_session=" + token } });
}

function mockAnalyticsReport(rows: Row[], totals: Row = {}) {
  // A fresh Response per call — Response bodies can only be read once, and this stub may be
  // invoked more than once within a single test (e.g. looping over roles).
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(JSON.stringify({ rows, totals }), { status: 200 }))
  );
}

describe("admin-stats — auth/RBAC gates (kap. 20)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET, ANALYTICS_ADMIN_TOKEN: "sep-secret" } as Env;
    db.campaigns.set("cmp_1", { campaign_id: "cmp_1", evidence_code: "EV-1", title: "Letní kampaň", status: "active" });
    mockAnalyticsReport([]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("401 without a session on summary", async () => {
    const res = await handleGetStatsSummary(new Request("https://worker.test/v1/admin/stats/summary"), env, new URL("https://worker.test/v1/admin/stats/summary"));
    expect(res.status).toBe(401);
  });

  it("403 for a role without stats.read (sales)", async () => {
    const request = await buildSessionRequest(db, { userId: "usr_sales", roles: ["sales"], url: "https://worker.test/v1/admin/stats/summary" });
    const res = await handleGetStatsSummary(request, env, new URL(request.url));
    expect(res.status).toBe(403);
  });

  it("200 for ads_manager and read_only", async () => {
    for (const role of ["ads_manager", "read_only"]) {
      const request = await buildSessionRequest(db, { userId: "usr_" + role, roles: [role], url: "https://worker.test/v1/admin/stats/summary" });
      const res = await handleGetStatsSummary(request, env, new URL(request.url));
      expect(res.status).toBe(200);
    }
  });
});

describe("admin-stats — test campaign exclusion (kap. 20 test-exclude)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET, ANALYTICS_ADMIN_TOKEN: "sep-secret" } as Env;
    db.campaigns.set("cmp_1", { campaign_id: "cmp_1", evidence_code: "EV-1", title: "Letní kampaň", status: "active" });
    db.campaigns.set("test_verify_1", { campaign_id: "test_verify_1", evidence_code: "EV-TEST", title: "Verifikační kampaň", status: "active" });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("campaign-stats 404s for a test_* campaign id, even though it exists in D1", async () => {
    mockAnalyticsReport([]);
    const request = await buildSessionRequest(db, { userId: "usr_am", roles: ["ads_manager"], url: "https://worker.test/v1/admin/stats/campaigns/test_verify_1" });
    const res = await handleGetCampaignStats(request, env, new URL(request.url), "test_verify_1");
    expect(res.status).toBe(404);
  });

  it("campaign-stats 404s for an unknown (non-test) campaign id", async () => {
    mockAnalyticsReport([]);
    const request = await buildSessionRequest(db, { userId: "usr_am", roles: ["ads_manager"], url: "https://worker.test/v1/admin/stats/campaigns/cmp_missing" });
    const res = await handleGetCampaignStats(request, env, new URL(request.url), "cmp_missing");
    expect(res.status).toBe(404);
  });

  it("summary excludes test_* rows even if Analytics forgot to filter them (defense-in-depth)", async () => {
    mockAnalyticsReport([
      { day: "2026-01-05", campaign_id: "cmp_1", placement_id: "plc_1", section_id: "home", slot_type: "banner", device_category: "pc", impressions: 100, clicks: 10, valid_clicks: 8, suspicious_clicks: 1 },
      { day: "2026-01-05", campaign_id: "test_verify_1", placement_id: "plc_1", section_id: "home", slot_type: "banner", device_category: "pc", impressions: 5000, clicks: 4000, valid_clicks: 4000, suspicious_clicks: 0 },
    ]);
    const request = await buildSessionRequest(db, { userId: "usr_am", roles: ["ads_manager"], url: "https://worker.test/v1/admin/stats/summary" });
    const res = await handleGetStatsSummary(request, env, new URL(request.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].campaign_id).toBe("cmp_1");
    expect(body.totals.impressions).toBe(100);
  });

  it("summary short-circuits (no upstream call) when an explicit test campaign_id is requested", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = await buildSessionRequest(db, { userId: "usr_am", roles: ["ads_manager"], url: "https://worker.test/v1/admin/stats/summary?campaign_id=test_verify_1" });
    const res = await handleGetStatsSummary(request, env, new URL(request.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("admin-stats — no PII / price leakage and 503 fail-closed", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET, ANALYTICS_ADMIN_TOKEN: "sep-secret" } as Env;
    db.campaigns.set("cmp_1", { campaign_id: "cmp_1", evidence_code: "EV-1", title: "Letní kampaň", status: "active" });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("campaign stats response never includes price/email/code fields", async () => {
    mockAnalyticsReport([
      { day: "2026-01-05", campaign_id: "cmp_1", placement_id: "plc_1", section_id: "home", slot_type: "banner", device_category: "pc", impressions: 100, clicks: 10, valid_clicks: 8, suspicious_clicks: 1, price_cents: 999, email: "x@x.test" },
    ]);
    const request = await buildSessionRequest(db, { userId: "usr_am", roles: ["ads_manager"], url: "https://worker.test/v1/admin/stats/campaigns/cmp_1" });
    const res = await handleGetCampaignStats(request, env, new URL(request.url), "cmp_1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toContain("price");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("client_code");
    expect(Object.keys(body.campaign).sort()).toEqual(["campaign_id", "evidence_code", "status", "title"].sort());
    expect(Object.keys(body.rows[0]).sort()).toEqual(
      ["campaign_id", "clicks", "ctr", "day", "device_category", "impressions", "placement_id", "section_id", "slot_type", "suspicious_clicks", "valid_clicks"].sort()
    );
  });

  it("503 stats_not_configured when ANALYTICS_ADMIN_REPORT_URL setting is empty", async () => {
    db.settings.set("ANALYTICS_ADMIN_REPORT_URL", "");
    const request = await buildSessionRequest(db, { userId: "usr_am", roles: ["ads_manager"], url: "https://worker.test/v1/admin/stats/summary" });
    const res = await handleGetStatsSummary(request, env, new URL(request.url));
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error).toBe("stats_not_configured");
  });

  it("503 stats_not_configured when ANALYTICS_ADMIN_TOKEN secret is missing", async () => {
    const envNoToken = { ...env, ANALYTICS_ADMIN_TOKEN: undefined } as Env;
    const request = await buildSessionRequest(db, { userId: "usr_am", roles: ["ads_manager"], url: "https://worker.test/v1/admin/stats/campaigns/cmp_1" });
    const res = await handleGetCampaignStats(request, envNoToken, new URL(request.url), "cmp_1");
    expect(res.status).toBe(503);
  });
});
