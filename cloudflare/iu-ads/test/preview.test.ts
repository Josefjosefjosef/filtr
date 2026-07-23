import { beforeEach, describe, expect, it } from "vitest";
import { handlePreviewCampaign } from "../src/admin-preview";
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
  campaignPlacements: Row[] = [];
  creatives: Row[] = [];
  writeCount = 0;

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  execute(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): any {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    // admin_sessions.last_seen_at is bumped by every authenticated request (admin-auth.ts's
    // shared session guard) — that housekeeping write is not a preview side effect, so it is
    // excluded from the write counter below, which instead tracks campaign/creative/audit tables.
    if (sql.startsWith("UPDATE admin_sessions SET last_seen_at")) return { success: true };

    if (sql.startsWith("INSERT") || sql.startsWith("UPDATE") || sql.startsWith("DELETE")) {
      this.writeCount++;
      return { success: true };
    }

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
    if (sql.includes("FROM system_settings WHERE key = ?")) return null;

    if (sql.includes("SELECT campaign_id, title, status, label_type, target_url FROM campaigns WHERE campaign_id = ?")) {
      const [campaignId] = params;
      return this.campaigns.get(String(campaignId)) || null;
    }
    if (sql.includes("FROM campaign_placements WHERE campaign_id = ?")) {
      const [campaignId, deviceCategory] = params;
      const rows = this.campaignPlacements.filter(
        (p) => p.campaign_id === campaignId && (deviceCategory === undefined || p.device_category === deviceCategory)
      );
      return { results: rows };
    }
    if (sql.includes("FROM creatives WHERE campaign_id = ? AND review_status = 'approved'")) {
      const [campaignId, deviceCategory] = params;
      const hit = this.creatives.find(
        (c) => c.campaign_id === campaignId && (c.device_category === deviceCategory || c.device_category === "universal")
      );
      return hit || null;
    }
    if (mode === "all") return { results: [] };
    if (mode === "run") return { success: true };
    return null;
  }
}

const SECRET = "test-session-secret-not-for-prod";
const SIGNING_SECRET = "test-signing-secret-not-for-prod";

async function buildSessionRequest(
  db: FakeD1,
  opts: { userId: string; roles: string[]; url: string; method: string; body?: unknown }
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
  return new Request(opts.url, {
    method: opts.method,
    headers: { Cookie: "iu_ads_admin_session=" + token, "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

describe("admin-preview never publishes and has zero side effects (kap. 21)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET, ADS_R2_SIGNING_SECRET: SIGNING_SECRET } as Env;
    db.campaigns.set("cmp_1", {
      campaign_id: "cmp_1",
      title: "Letní kampaň",
      status: "scheduled",
      label_type: "Reklama",
      target_url: "https://example.cz/nabidka",
    });
    db.campaignPlacements.push({ campaign_placement_id: "cpl_1", campaign_id: "cmp_1", placement_id: "plc_header_1", section_id: "global_header", device_category: "pc" });
    db.creatives.push({ creative_id: "crv_1", campaign_id: "cmp_1", format: "image", mime_type: "image/png", width: 728, height: 90, r2_key: "creative/crv_1/v1.png", device_category: "pc" });
  });

  it("returns a preview with published:false and a signed (never permanent) creative path", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/preview",
      method: "POST",
      body: { campaign_id: "cmp_1" },
    });
    const res = await handlePreviewCampaign(request, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.published).toBe(false);
    expect(body.preview.campaign_id).toBe("cmp_1");
    expect(body.preview.placements).toHaveLength(1);
    expect(body.preview.placements[0].creative.preview_path.startsWith("/v1/objects/get?bucket=CREATIVES&")).toBe(true);
    expect(body.preview.placements[0].creative.preview_path).not.toContain("r2.cloudflarestorage.com");
  });

  it("performs zero DB writes (no audit_logs, no object_access_audit — pure read)", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/preview",
      method: "POST",
      body: { campaign_id: "cmp_1" },
    });
    const writesBefore = db.writeCount;
    const res = await handlePreviewCampaign(request, env);
    expect(res.status).toBe(200);
    expect(db.writeCount).toBe(writesBefore);
  });

  it("returns null creative when none is approved yet, but still no side effects", async () => {
    db.creatives = [];
    const request = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/preview",
      method: "POST",
      body: { campaign_id: "cmp_1" },
    });
    const writesBefore = db.writeCount;
    const res = await handlePreviewCampaign(request, env);
    const body = (await res.json()) as any;
    expect(body.preview.placements[0].creative).toBeNull();
    expect(db.writeCount).toBe(writesBefore);
  });

  it("404s for an unknown campaign without any write", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/preview",
      method: "POST",
      body: { campaign_id: "cmp_missing" },
    });
    const res = await handlePreviewCampaign(request, env);
    expect(res.status).toBe(404);
    expect(db.writeCount).toBe(0);
  });

  it("read_only can also preview (read-only surface, campaigns.read is enough)", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_ro",
      roles: ["read_only"],
      url: "https://worker.test/v1/admin/preview",
      method: "POST",
      body: { campaign_id: "cmp_1" },
    });
    const res = await handlePreviewCampaign(request, env);
    expect(res.status).toBe(200);
  });
});
