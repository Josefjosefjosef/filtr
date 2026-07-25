/**
 * Protect the last active main_admin from deactivation / demotion.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { handleSetUserRoles, handleUpdateUser } from "../src/admin-users";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import type { Env } from "../src/types";

type Row = Record<string, unknown>;

class FakeStatement {
  private params: unknown[] = [];
  constructor(
    private db: FakeD1,
    private sql: string
  ) {}
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
  auditLogs: Row[] = [];

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
    if (sql.includes("SELECT is_active FROM admin_users WHERE user_id = ?")) {
      const row = this.adminUsers.get(String(params[0]));
      return row ? { is_active: row.is_active } : null;
    }
    if (sql.includes("FROM admin_users WHERE user_id = ?")) {
      return this.adminUsers.get(String(params[0])) || null;
    }
    if (sql.includes("FROM admin_user_roles WHERE user_id = ?")) {
      const roles = this.adminUserRoles.get(String(params[0])) || [];
      return { results: roles.map((r) => ({ role_code: r })) };
    }
    if (sql.includes("COUNT(*) AS c FROM admin_user_roles r INNER JOIN admin_users u")) {
      let c = 0;
      for (const [uid, roles] of this.adminUserRoles.entries()) {
        const u = this.adminUsers.get(uid);
        if (u && u.is_active === 1 && roles.includes("main_admin")) c += 1;
      }
      return { c };
    }
    if (sql.startsWith("UPDATE admin_users SET")) return { success: true };
    if (sql.startsWith("UPDATE admin_sessions SET revoked_at")) return { success: true };
    if (sql.startsWith("DELETE FROM admin_user_roles WHERE user_id = ?")) {
      this.adminUserRoles.set(String(params[0]), []);
      return { success: true };
    }
    if (sql.startsWith("INSERT OR IGNORE INTO admin_user_roles")) {
      const [userId, role] = params;
      const cur = this.adminUserRoles.get(String(userId)) || [];
      if (!cur.includes(String(role))) cur.push(String(role));
      this.adminUserRoles.set(String(userId), cur);
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO audit_logs") || sql.includes("INSERT INTO audit_log")) {
      this.auditLogs.push({ sql, params: [...params] });
      return { success: true };
    }
    return mode === "all" ? { results: [] } : null;
  }
}

const ADMIN_SECRET = "test-admin-session-secret";

async function buildAdminRequest(
  db: FakeD1,
  opts: { actorId: string; targetId: string; url: string; method: string; body?: unknown }
): Promise<{ req: Request; env: Env }> {
  for (const id of [opts.actorId, opts.targetId]) {
    if (!db.adminUsers.has(id)) {
      db.adminUsers.set(id, {
        user_id: id,
        email: id + "@example.test",
        display_name: id,
        is_active: 1,
        force_password_change: 0,
        last_login_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
    }
  }
  db.adminUserRoles.set(opts.actorId, ["main_admin"]);
  if (!db.adminUserRoles.has(opts.targetId)) db.adminUserRoles.set(opts.targetId, ["main_admin"]);

  const sessionId = generateSessionId();
  const tokenHash = await hashOpaqueToken(sessionId);
  const exp = nowSeconds() + 3600;
  db.adminSessions.set(sessionId, {
    session_id: sessionId,
    user_id: opts.actorId,
    token_hash: tokenHash,
    expires_at: new Date(exp * 1000).toISOString(),
    revoked_at: null,
  });
  const token = await signSessionToken(ADMIN_SECRET, { sessionId, exp });
  const req = new Request(opts.url, {
    method: opts.method,
    headers: { Cookie: "iu_ads_admin_session=" + token, "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: ADMIN_SECRET } as Env;
  return { req, env };
}

describe("last main_admin protection", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
  });

  it("blocks deactivating the sole active main_admin", async () => {
    const { req, env } = await buildAdminRequest(db, {
      actorId: "usr_a",
      targetId: "usr_a",
      url: "https://x/v1/admin/users/usr_a",
      method: "PATCH",
      body: { is_active: false },
    });
    const res = await handleUpdateUser(req, env, "usr_a");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("last_main_admin");
  });

  it("blocks demoting the sole active main_admin", async () => {
    const { req, env } = await buildAdminRequest(db, {
      actorId: "usr_a",
      targetId: "usr_a",
      url: "https://x/v1/admin/users/usr_a/roles",
      method: "PUT",
      body: { roles: ["read_only"] },
    });
    const res = await handleSetUserRoles(req, env, "usr_a");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("last_main_admin");
  });

  it("allows demotion when another active main_admin exists", async () => {
    db.adminUsers.set("usr_b", {
      user_id: "usr_b",
      email: "b@example.test",
      display_name: "B",
      is_active: 1,
      force_password_change: 0,
      last_login_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    db.adminUserRoles.set("usr_b", ["main_admin"]);

    const { req, env } = await buildAdminRequest(db, {
      actorId: "usr_a",
      targetId: "usr_b",
      url: "https://x/v1/admin/users/usr_b/roles",
      method: "PUT",
      body: { roles: ["sales"] },
    });
    const res = await handleSetUserRoles(req, env, "usr_b");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roles: string[] };
    expect(body.roles).toEqual(["sales"]);
  });
});
