import { beforeEach, describe, expect, it } from "vitest";
import { handleConvertInquiryToOrder } from "../src/admin-inquiries";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import type { Env } from "../src/types";

/**
 * Minimal in-memory D1 fake covering only the SQL patterns exercised by the admin
 * session guard (admin-auth.ts) and admin-inquiries.ts convert flow. Unmatched
 * statements safely no-op (mirrors D1's real shape enough for unit testing business logic
 * without spinning up Miniflare).
 */
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
  inquiries = new Map<string, Row>();
  orders = new Map<string, Row>();

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
    if (sql.startsWith("UPDATE admin_sessions SET last_seen_at")) {
      return { success: true };
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
    if (sql.includes("FROM system_settings WHERE key = ?")) {
      return null;
    }
    if (sql.includes("FROM inquiries WHERE inquiry_id = ?")) {
      const [inquiryId] = params;
      return this.inquiries.get(String(inquiryId)) || null;
    }
    if (sql.startsWith("UPDATE inquiries SET status = 'converted'")) {
      const [nowIso, inquiryId] = params;
      const row = this.inquiries.get(String(inquiryId));
      if (row) {
        row.status = "converted";
        row.updated_at = nowIso;
      }
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO orders")) {
      const [orderId, clientId, inquiryId, orderNumber, status, orderedBy, payer, contactPerson, payloadJson, createdAt, updatedAt] =
        params;
      this.orders.set(String(orderId), {
        order_id: orderId,
        client_id: clientId,
        inquiry_id: inquiryId,
        order_number: orderNumber,
        status,
        ordered_by: orderedBy,
        payer,
        contact_person: contactPerson,
        payload_json: payloadJson,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO audit_logs")) {
      return { success: true };
    }
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
  db.adminUsers.set(opts.userId, {
    user_id: opts.userId,
    email: opts.userId + "@example.test",
    display_name: "Test User",
    is_active: 1,
  });
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

describe("inquiry -> order conversion (kap. 26/27 business-crud)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET } as Env;
    db.inquiries.set("inq_ready", {
      inquiry_id: "inq_ready",
      client_id: "cli_1",
      status: "new",
      title: "Poptávka banner",
      payload_json: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    db.inquiries.set("inq_no_client", {
      inquiry_id: "inq_no_client",
      client_id: null,
      status: "new",
      title: "Poptávka bez klienta",
      payload_json: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
  });

  it("sales converts a ready inquiry into a draft order and marks the inquiry converted", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_sales",
      roles: ["sales"],
      url: "https://worker.test/v1/admin/inquiries/inq_ready/convert",
      method: "POST",
      body: { payer: "Firma s.r.o." },
    });
    const res = await handleConvertInquiryToOrder(request, env, "inq_ready");
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.status).toBe("draft");
    expect(body.order_number).toMatch(/^ORD-\d{4}-[A-Z0-9]{8}$/);
    expect(db.inquiries.get("inq_ready")?.status).toBe("converted");
    expect(db.orders.size).toBe(1);
    const [order] = [...db.orders.values()];
    expect(order.client_id).toBe("cli_1");
    expect(order.status).toBe("draft");
  });

  it("rejects converting an already-converted inquiry", async () => {
    db.inquiries.set("inq_done", {
      inquiry_id: "inq_done",
      client_id: "cli_1",
      status: "converted",
      title: "Hotovo",
      payload_json: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    const request = await buildSessionRequest(db, {
      userId: "usr_sales2",
      roles: ["sales"],
      url: "https://worker.test/v1/admin/inquiries/inq_done/convert",
      method: "POST",
    });
    const res = await handleConvertInquiryToOrder(request, env, "inq_done");
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("inquiry_already_converted");
  });

  it("rejects converting an inquiry with no client_id", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_sales3",
      roles: ["sales"],
      url: "https://worker.test/v1/admin/inquiries/inq_no_client/convert",
      method: "POST",
    });
    const res = await handleConvertInquiryToOrder(request, env, "inq_no_client");
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("inquiry_missing_client");
  });

  it("denies ads_manager (no inquiries.write/orders.write) with 403 — server-side RBAC, not UI hiding", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/inquiries/inq_ready/convert",
      method: "POST",
    });
    const res = await handleConvertInquiryToOrder(request, env, "inq_ready");
    expect(res.status).toBe(403);
    expect(db.inquiries.get("inq_ready")?.status).toBe("new");
  });

  it("denies requests without a session cookie", async () => {
    const request = new Request("https://worker.test/v1/admin/inquiries/inq_ready/convert", { method: "POST" });
    const res = await handleConvertInquiryToOrder(request, env, "inq_ready");
    expect(res.status).toBe(401);
  });
});
