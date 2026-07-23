import { beforeEach, describe, expect, it } from "vitest";
import { handleCreateReservation } from "../src/admin-reservations";
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
  placementTypes = new Map<string, Row>();
  reservations = new Map<string, Row>();

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  execute(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): any {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    if (sql.includes("FROM admin_sessions WHERE session_id = ? AND token_hash = ?")) {
      const [sessionId, tokenHash] = params;
      const row = this.adminSessions.get(String(sessionId));
      const hit = row && row.token_hash === tokenHash ? row : null;
      return mode === "all" ? { results: hit ? [hit] : [] } : hit;
    }
    if (sql.startsWith("UPDATE admin_sessions SET last_seen_at")) return { success: true };
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

    if (sql.includes("FROM campaigns WHERE campaign_id = ?")) {
      const [campaignId] = params;
      return this.campaigns.get(String(campaignId)) || null;
    }
    if (sql.includes("FROM placement_types WHERE placement_type_id = ?")) {
      const [placementTypeId] = params;
      return this.placementTypes.get(String(placementTypeId)) || null;
    }
    if (sql.startsWith("SELECT") && sql.includes("FROM placement_reservations WHERE placement_id = ?")) {
      const [placementId] = params;
      return { results: [...this.reservations.values()].filter((r) => r.placement_id === placementId) };
    }
    if (sql.startsWith("INSERT INTO placement_reservations")) {
      const [reservationId, placementTypeId, placementId, campaignId, deviceCategory, sectionId, regionCode, startAt, endAt, status, createdAt] =
        params;
      this.reservations.set(String(reservationId), {
        reservation_id: reservationId,
        placement_type_id: placementTypeId,
        placement_id: placementId,
        campaign_id: campaignId,
        device_category: deviceCategory,
        section_id: sectionId,
        region_code: regionCode,
        start_at: startAt,
        end_at: endAt,
        status,
        created_at: createdAt,
      });
      return { success: true };
    }
    if (sql.includes("FROM placement_reservations WHERE reservation_id = ?")) {
      const [reservationId] = params;
      return this.reservations.get(String(reservationId)) || null;
    }
    if (sql.startsWith("INSERT INTO audit_logs")) return { success: true };
    if (mode === "all") return { results: [] };
    if (mode === "run") return { success: true };
    return null;
  }
}

const SECRET = "test-session-secret-not-for-prod";

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

describe("admin-reservations collision enforcement (kap. 11)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET } as Env;
    db.campaigns.set("cmp_1", { campaign_id: "cmp_1" });
    db.campaigns.set("cmp_2", { campaign_id: "cmp_2" });
    db.placementTypes.set("pt_header", { placement_type_id: "pt_header", collision_mode: "exclusive" });
    db.placementTypes.set("pt_tile", { placement_type_id: "pt_tile", collision_mode: "shared" });
  });

  const baseBody = {
    placement_type_id: "pt_header",
    placement_id: "plc_header_1",
    campaign_id: "cmp_1",
    device_category: "pc",
    start_at: "2026-08-01T00:00:00Z",
    end_at: "2026-08-08T00:00:00Z",
  };

  it("creates a reservation when the window is free", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/reservations",
      method: "POST",
      body: baseBody,
    });
    const res = await handleCreateReservation(request, env);
    expect(res.status).toBe(201);
    expect(db.reservations.size).toBe(1);
  });

  it("returns 409 on an overlapping exclusive reservation", async () => {
    const first = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/reservations",
      method: "POST",
      body: baseBody,
    });
    await handleCreateReservation(first, env);

    const second = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/reservations",
      method: "POST",
      body: { ...baseBody, campaign_id: "cmp_2", start_at: "2026-08-05T00:00:00Z", end_at: "2026-08-12T00:00:00Z" },
    });
    const res = await handleCreateReservation(second, env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe("reservation_collision");
    expect(db.reservations.size).toBe(1);
  });

  it("allows overlapping windows on a shared-mode placement type", async () => {
    const sharedBody = { ...baseBody, placement_type_id: "pt_tile", placement_id: "plc_tile_1" };
    const first = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/reservations",
      method: "POST",
      body: sharedBody,
    });
    await handleCreateReservation(first, env);

    const second = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/reservations",
      method: "POST",
      body: { ...sharedBody, campaign_id: "cmp_2" },
    });
    const res = await handleCreateReservation(second, env);
    expect(res.status).toBe(201);
    expect(db.reservations.size).toBe(2);
  });

  it("denies read_only from creating reservations", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_ro",
      roles: ["read_only"],
      url: "https://worker.test/v1/admin/reservations",
      method: "POST",
      body: baseBody,
    });
    const res = await handleCreateReservation(request, env);
    expect(res.status).toBe(403);
  });

  it("rejects an inverted time window (end before start)", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/reservations",
      method: "POST",
      body: { ...baseBody, start_at: "2026-08-08T00:00:00Z", end_at: "2026-08-01T00:00:00Z" },
    });
    const res = await handleCreateReservation(request, env);
    expect(res.status).toBe(400);
  });
});
