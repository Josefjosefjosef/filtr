import { beforeEach, describe, expect, it } from "vitest";
import { handleFinanceSummary } from "../src/admin-finance";
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
  invoices: Row[] = [];

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
      return this.adminUsers.get(String(params[0])) || null;
    }
    if (sql.includes("FROM admin_user_roles WHERE user_id = ?")) {
      const roles = this.adminUserRoles.get(String(params[0])) || [];
      return { results: roles.map((r) => ({ role_code: r })) };
    }
    if (sql.includes("FROM invoices") && sql.includes("GROUP BY currency, status")) {
      const by = new Map<string, { currency: string; status: string; count: number; total_cents: number }>();
      for (const inv of this.invoices) {
        const key = String(inv.currency || "CZK") + "|" + String(inv.status);
        const cur = by.get(key) || {
          currency: String(inv.currency || "CZK"),
          status: String(inv.status),
          count: 0,
          total_cents: 0,
        };
        cur.count += 1;
        cur.total_cents += Number(inv.total_cents || 0);
        by.set(key, cur);
      }
      return { results: [...by.values()] };
    }
    return mode === "all" ? { results: [] } : null;
  }
}

const ADMIN_SECRET = "test-admin-session-secret";

async function req(db: FakeD1, url: string): Promise<{ request: Request; env: Env }> {
  const userId = "usr_fin";
  db.adminUsers.set(userId, {
    user_id: userId,
    email: "fin@example.test",
    display_name: "Fin",
    is_active: 1,
  });
  db.adminUserRoles.set(userId, ["main_admin"]);
  const sessionId = generateSessionId();
  const tokenHash = await hashOpaqueToken(sessionId);
  const exp = nowSeconds() + 3600;
  db.adminSessions.set(sessionId, {
    session_id: sessionId,
    user_id: userId,
    token_hash: tokenHash,
    expires_at: new Date(exp * 1000).toISOString(),
    revoked_at: null,
  });
  const token = await signSessionToken(ADMIN_SECRET, { sessionId, exp });
  return {
    request: new Request(url, { method: "GET", headers: { Cookie: "iu_ads_admin_session=" + token } }),
    env: { DB: db as unknown as D1Database, ADS_SESSION_SECRET: ADMIN_SECRET } as Env,
  };
}

describe("finance summary shape", () => {
  let db: FakeD1;
  beforeEach(() => {
    db = new FakeD1();
  });

  it("returns zeroed CZK summary when no invoices", async () => {
    const { request, env } = await req(db, "https://x/v1/admin/finance/summary");
    const res = await handleFinanceSummary(request, env, new URL(request.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { CZK: { invoiced_cents: number; paid_cents: number; outstanding_cents: number; overdue_cents: number } };
    };
    expect(body.summary.CZK.invoiced_cents).toBe(0);
    expect(body.summary.CZK.paid_cents).toBe(0);
    expect(body.summary.CZK.outstanding_cents).toBe(0);
    expect(body.summary.CZK.overdue_cents).toBe(0);
  });

  it("aggregates invoiced/paid/outstanding/overdue", async () => {
    db.invoices = [
      { currency: "CZK", status: "paid", total_cents: 1000 },
      { currency: "CZK", status: "overdue", total_cents: 500 },
      { currency: "CZK", status: "sent", total_cents: 200 },
    ];
    const { request, env } = await req(db, "https://x/v1/admin/finance/summary");
    const res = await handleFinanceSummary(request, env, new URL(request.url));
    const body = (await res.json()) as {
      summary: { CZK: { invoiced_cents: number; paid_cents: number; outstanding_cents: number; overdue_cents: number } };
    };
    expect(body.summary.CZK.invoiced_cents).toBe(1700);
    expect(body.summary.CZK.paid_cents).toBe(1000);
    expect(body.summary.CZK.outstanding_cents).toBe(700);
    expect(body.summary.CZK.overdue_cents).toBe(500);
  });
});
