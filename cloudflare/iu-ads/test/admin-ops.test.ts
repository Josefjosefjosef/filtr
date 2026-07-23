import { beforeEach, describe, expect, it } from "vitest";
import { handleGetAdminDashboard } from "../src/admin-dashboard";
import { handleAdminSearch } from "../src/admin-search";
import { handleGetAdminCalendar } from "../src/admin-calendar";
import {
  handleAckAlert,
  handleGenerateAlerts,
  handleGetAlert,
  handleListAlerts,
  handleResolveAlert,
} from "../src/admin-alerts";
import { filterNavForRoles, handleGetAdminNav } from "../src/admin-nav";
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
  settings = new Map<string, string>([
    ["ALERT_CAMPAIGN_ENDING_DAYS", "7"],
    ["ALERT_RECENT_AUDIT_HOURS", "24"],
    ["DASHBOARD_RESERVATIONS_UPCOMING_DAYS", "14"],
  ]);
  campaigns: Row[] = [];
  clients: Row[] = [];
  invoices: Row[] = [];
  documents: Row[] = [];
  inquiries: Row[] = [];
  orders: Row[] = [];
  reservations: Row[] = [];
  placementTypes = new Map<string, Row>();
  alerts = new Map<string, Row>();
  auditLogs: Row[] = [];
  rightsConfirmations: Row[] = [];

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
    if (sql.includes("FROM system_settings WHERE key = ?") || sql.includes("system_settings WHERE key = '")) {
      let key = "";
      if (sql.includes("WHERE key = ?")) key = String(params[0] || "");
      else {
        const m = sql.match(/key = '([^']+)'/);
        key = m ? m[1] : "";
      }
      const v = this.settings.get(key);
      return v === undefined ? null : { value: v };
    }

    if (sql.includes("FROM campaigns GROUP BY status")) {
      const counts = new Map<string, number>();
      for (const c of this.campaigns) {
        const st = String(c.status);
        counts.set(st, (counts.get(st) || 0) + 1);
      }
      const results = [...counts.entries()].map(([status, cnt]) => ({ status, cnt }));
      return mode === "all" ? { results } : results[0] || null;
    }
    if (sql.includes("FROM inquiries WHERE status IN")) {
      const set = new Set(params.map(String));
      const cnt = this.inquiries.filter((r) => set.has(String(r.status))).length;
      return { cnt };
    }
    if (sql.includes("FROM orders WHERE status IN")) {
      const set = new Set(params.map(String));
      const cnt = this.orders.filter((r) => set.has(String(r.status))).length;
      return { cnt };
    }
    if (sql.includes("FROM placement_reservations WHERE status IN")) {
      const [from, to] = params;
      const cnt = this.reservations.filter((r) => {
        if (!["reserved", "confirmed"].includes(String(r.status))) return false;
        const s = String(r.start_at);
        return s >= String(from) && s <= String(to);
      }).length;
      return { cnt };
    }
    if (sql.includes("FROM invoices WHERE status IN") && sql.includes("SUM(total_cents)")) {
      const set = new Set(params.map(String));
      const rows = this.invoices.filter((r) => set.has(String(r.status)));
      return {
        cnt: rows.length,
        total_cents: rows.reduce((s, r) => s + Number(r.total_cents || 0), 0),
      };
    }
    if (sql.includes("FROM alerts WHERE status IN ('new','read')") && sql.includes("COUNT")) {
      const cnt = [...this.alerts.values()].filter((a) => ["new", "read"].includes(String(a.status))).length;
      return { cnt };
    }
    if (sql.includes("FROM audit_logs WHERE created_at >=") && sql.includes("COUNT")) {
      const since = String(params[0]);
      const cnt = this.auditLogs.filter((a) => String(a.created_at) >= since).length;
      return { cnt };
    }

    if (sql.includes("FROM clients WHERE company_name LIKE")) {
      const like = String(params[0]).replace(/%/g, "").toLowerCase();
      const results = this.clients
        .filter((c) => String(c.company_name).toLowerCase().includes(like) || String(c.ico || "").toLowerCase().includes(like))
        .map((c) => ({ client_id: c.client_id, company_name: c.company_name, ico: c.ico || null }));
      return { results };
    }
    if (sql.includes("FROM campaigns WHERE title LIKE")) {
      const like = String(params[0]).replace(/%/g, "").toLowerCase();
      const results = this.campaigns
        .filter(
          (c) =>
            String(c.title).toLowerCase().includes(like) ||
            String(c.evidence_code).toLowerCase().includes(like) ||
            String(c.campaign_id).toLowerCase().includes(like)
        )
        .map((c) => ({
          campaign_id: c.campaign_id,
          title: c.title,
          evidence_code: c.evidence_code,
          status: c.status,
        }));
      return { results };
    }
    if (sql.includes("FROM invoices WHERE invoice_number LIKE")) {
      const like = String(params[0]).replace(/%/g, "").toLowerCase();
      const results = this.invoices
        .filter(
          (i) =>
            String(i.invoice_number).toLowerCase().includes(like) ||
            String(i.variable_symbol || "").toLowerCase().includes(like) ||
            String(i.invoice_id).toLowerCase().includes(like)
        )
        .map((i) => ({
          invoice_id: i.invoice_id,
          invoice_number: i.invoice_number,
          status: i.status,
          client_id: i.client_id,
        }));
      return { results };
    }
    if (sql.includes("FROM documents WHERE title LIKE")) {
      const like = String(params[0]).replace(/%/g, "").toLowerCase();
      const results = this.documents
        .filter((d) => String(d.title).toLowerCase().includes(like) || String(d.document_id).toLowerCase().includes(like))
        .map((d) => ({
          document_id: d.document_id,
          title: d.title,
          doc_type: d.doc_type,
          visibility: d.visibility,
          status: d.status,
        }));
      return { results };
    }

    if (sql.includes("FROM campaigns WHERE start_at IS NOT NULL")) {
      const [to, from] = params;
      const results = this.campaigns.filter((c) => {
        if (!c.start_at || !c.end_at) return false;
        return String(c.start_at) < String(to) && String(c.end_at) > String(from);
      });
      return { results };
    }
    if (sql.includes("FROM placement_reservations r") && sql.includes("LEFT JOIN placement_types")) {
      const [to, from] = params;
      const results = this.reservations
        .filter((r) => String(r.start_at) < String(to) && String(r.end_at) > String(from))
        .map((r) => {
          const pt = this.placementTypes.get(String(r.placement_type_id));
          return { ...r, collision_mode: pt?.collision_mode || "exclusive" };
        });
      return { results };
    }

    if (sql.includes("FROM alerts ") && sql.includes("ORDER BY created_at")) {
      let rows = [...this.alerts.values()];
      if (sql.includes("status = ?")) {
        rows = rows.filter((a) => a.status === params[0]);
      }
      return { results: rows };
    }
    if (sql.includes("FROM alerts WHERE alert_id = ?")) {
      return this.alerts.get(String(params[0])) || null;
    }
    if (sql.startsWith("UPDATE alerts SET status = 'read'")) {
      const id = String(params[0]);
      const row = this.alerts.get(id);
      if (row) row.status = "read";
      return { success: true };
    }
    if (sql.startsWith("UPDATE alerts SET status = 'resolved'")) {
      const [resolvedAt, id] = params;
      const row = this.alerts.get(String(id));
      if (row) {
        row.status = "resolved";
        row.resolved_at = resolvedAt;
      }
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO alerts")) {
      const [alertId, alertType, status, objectType, objectId, assignee, message, createdAt] = params;
      this.alerts.set(String(alertId), {
        alert_id: alertId,
        alert_type: alertType,
        status,
        object_type: objectType,
        object_id: objectId,
        assignee_user_id: assignee,
        message,
        created_at: createdAt,
        resolved_at: null,
      });
      return { success: true };
    }
    if (sql.includes("INSERT INTO audit_logs") || sql.startsWith("INSERT INTO audit_logs")) {
      this.auditLogs.push({ created_at: new Date().toISOString() });
      return { success: true };
    }
    if (sql.includes("alert_type = 'campaign_ending_soon'")) {
      const objectId = String(params[0]);
      const hit = [...this.alerts.values()].find(
        (a) => a.alert_type === "campaign_ending_soon" && a.object_id === objectId && ["new", "read"].includes(String(a.status))
      );
      return hit || null;
    }
    if (sql.includes("alert_type = 'rights_missing'")) {
      const objectId = String(params[0]);
      const hit = [...this.alerts.values()].find(
        (a) => a.alert_type === "rights_missing" && a.object_id === objectId && ["new", "read"].includes(String(a.status))
      );
      return hit || null;
    }
    if (sql.includes("FROM campaigns WHERE status IN ('active','scheduled') AND end_at")) {
      const [nowIso, untilIso] = params;
      const results = this.campaigns.filter((c) => {
        if (!["active", "scheduled"].includes(String(c.status))) return false;
        if (!c.end_at) return false;
        return String(c.end_at) >= String(nowIso) && String(c.end_at) <= String(untilIso);
      });
      return { results };
    }
    if (sql.includes("NOT EXISTS (SELECT 1 FROM rights_confirmations")) {
      const results = this.campaigns.filter((c) => {
        if (!["active", "scheduled", "approved"].includes(String(c.status))) return false;
        return !this.rightsConfirmations.some((r) => r.campaign_id === c.campaign_id);
      });
      return { results };
    }

    if (mode === "all") return { results: [] };
    if (mode === "run") return { success: true };
    return null;
  }
}

const SECRET = "test-session-secret-not-for-prod";

async function buildSessionRequest(
  db: FakeD1,
  opts: { userId: string; roles: string[]; url: string; method?: string }
): Promise<Request> {
  db.adminUsers.set(opts.userId, {
    user_id: opts.userId,
    email: opts.userId + "@example.test",
    display_name: "Test",
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
    method: opts.method || "GET",
    headers: { Cookie: "iu_ads_admin_session=" + token },
  });
}

describe("admin-ops — dashboard RBAC scoping (kap. 6)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET } as Env;
    db.campaigns.push({ campaign_id: "cmp_1", status: "active", title: "A", evidence_code: "EV-1" });
    db.campaigns.push({ campaign_id: "cmp_2", status: "draft", title: "B", evidence_code: "EV-2" });
    db.inquiries.push({ inquiry_id: "inq_1", status: "new" });
    db.orders.push({ order_id: "ord_1", status: "draft" });
    db.invoices.push({ invoice_id: "inv_1", status: "issued", total_cents: 1000 });
    db.alerts.set("alt_1", { alert_id: "alt_1", status: "new", alert_type: "x", message: "m", created_at: "2026-01-01T00:00:00Z" });
    db.auditLogs.push({ created_at: new Date().toISOString() });
  });

  it("401 without session", async () => {
    const res = await handleGetAdminDashboard(new Request("https://x/v1/admin/dashboard"), env);
    expect(res.status).toBe(401);
  });

  it("ads_manager gets campaign/alerts widgets but not invoices/inquiries", async () => {
    const req = await buildSessionRequest(db, {
      userId: "u_ads",
      roles: ["ads_manager"],
      url: "https://x/v1/admin/dashboard",
    });
    const res = await handleGetAdminDashboard(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { widgets: Record<string, unknown> };
    expect(body.widgets.campaigns_by_status).toBeTruthy();
    expect(body.widgets.open_alerts).toBe(1);
    expect(body.widgets.unpaid_invoices).toBeUndefined();
    expect(body.widgets.open_inquiries).toBeUndefined();
    expect(body.widgets.recent_audit).toBeUndefined();
  });

  it("sales gets inquiries/invoices but not campaigns_by_status when lacking campaigns.write only — still has campaigns.read", async () => {
    const req = await buildSessionRequest(db, {
      userId: "u_sales",
      roles: ["sales"],
      url: "https://x/v1/admin/dashboard",
    });
    const res = await handleGetAdminDashboard(req, env);
    const body = (await res.json()) as { widgets: Record<string, unknown> };
    expect(body.widgets.open_inquiries).toBe(1);
    expect(body.widgets.unpaid_invoices).toBeTruthy();
    expect(body.widgets.campaigns_by_status).toBeTruthy();
    expect(body.widgets.recent_audit).toBeUndefined();
  });
});

describe("admin-ops — search no-secrets (kap. 16)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET } as Env;
    db.clients.push({ client_id: "cli_1", company_name: "Acme Ads s.r.o.", ico: "123" });
    db.campaigns.push({
      campaign_id: "cmp_secret",
      title: "Secret campaign",
      evidence_code: "EV-SEC",
      status: "active",
      code_hash: "SHOULD_NEVER_APPEAR",
    });
    db.documents.push({
      document_id: "doc_1",
      title: "Secret contract",
      doc_type: "contract",
      visibility: "internal_only",
      status: "active",
      r2_key: "private/key.bin",
      content_hash: "abc",
    });
  });

  it("rejects short query", async () => {
    const req = await buildSessionRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://x/v1/admin/search?q=a",
    });
    const res = await handleAdminSearch(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("returns role-scoped hits without secret fields", async () => {
    const req = await buildSessionRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://x/v1/admin/search?q=Secret",
    });
    const res = await handleAdminSearch(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ entity: string }> };
    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toContain("code_hash");
    expect(raw).not.toContain("r2_key");
    expect(raw).not.toContain("password_hash");
    expect(raw).not.toContain("access_code");
    expect(body.results.some((r) => r.entity === "campaign")).toBe(true);
    expect(body.results.some((r) => r.entity === "document")).toBe(true);
  });

  it("ads_manager search omits clients/invoices/documents", async () => {
    const req = await buildSessionRequest(db, {
      userId: "u_ads",
      roles: ["ads_manager"],
      url: "https://x/v1/admin/search?q=Secret",
    });
    const res = await handleAdminSearch(req, env, new URL(req.url));
    const body = (await res.json()) as { results: Array<{ entity: string }> };
    expect(body.results.every((r) => r.entity === "campaign")).toBe(true);
  });
});

describe("admin-ops — calendar range + collisions (kap. 18)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET } as Env;
    db.placementTypes.set("pt_ex", { placement_type_id: "pt_ex", collision_mode: "exclusive" });
    db.campaigns.push({
      campaign_id: "cmp_1",
      title: "Summer",
      status: "active",
      evidence_code: "EV-1",
      start_at: "2026-07-01T00:00:00Z",
      end_at: "2026-07-31T00:00:00Z",
    });
    db.reservations.push({
      reservation_id: "res_1",
      placement_type_id: "pt_ex",
      placement_id: "pl_1",
      campaign_id: "cmp_1",
      device_category: "pc",
      section_id: null,
      region_code: null,
      start_at: "2026-07-10T00:00:00Z",
      end_at: "2026-07-20T00:00:00Z",
      status: "reserved",
    });
    db.reservations.push({
      reservation_id: "res_2",
      placement_type_id: "pt_ex",
      placement_id: "pl_1",
      campaign_id: "cmp_2",
      device_category: "pc",
      section_id: null,
      region_code: null,
      start_at: "2026-07-15T00:00:00Z",
      end_at: "2026-07-25T00:00:00Z",
      status: "confirmed",
    });
  });

  it("400 without from/to", async () => {
    const req = await buildSessionRequest(db, {
      userId: "u1",
      roles: ["ads_manager"],
      url: "https://x/v1/admin/calendar",
    });
    const res = await handleGetAdminCalendar(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("returns overlapping reservations with collision flags", async () => {
    const req = await buildSessionRequest(db, {
      userId: "u1",
      roles: ["ads_manager"],
      url: "https://x/v1/admin/calendar?from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z",
    });
    const res = await handleGetAdminCalendar(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      campaigns: unknown[];
      reservations: Array<{ reservation_id: string; has_collision: boolean }>;
    };
    expect(body.campaigns.length).toBe(1);
    expect(body.reservations.length).toBe(2);
    expect(body.reservations.every((r) => r.has_collision)).toBe(true);
  });

  it("sales without placements.read still sees campaigns", async () => {
    const req = await buildSessionRequest(db, {
      userId: "u_sales",
      roles: ["sales"],
      url: "https://x/v1/admin/calendar?from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z",
    });
    const res = await handleGetAdminCalendar(req, env, new URL(req.url));
    const body = (await res.json()) as { campaigns: unknown[]; reservations: unknown[] };
    expect(body.campaigns.length).toBe(1);
    expect(body.reservations.length).toBe(0);
  });
});

describe("admin-ops — alert lifecycle (kap. 19)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET } as Env;
    db.alerts.set("alt_1", {
      alert_id: "alt_1",
      alert_type: "campaign_ending_soon",
      status: "new",
      object_type: "campaign",
      object_id: "cmp_1",
      assignee_user_id: null,
      message: "ending",
      created_at: "2026-07-01T00:00:00Z",
      resolved_at: null,
    });
  });

  it("ack then resolve lifecycle", async () => {
    const ackReq = await buildSessionRequest(db, {
      userId: "u1",
      roles: ["ads_manager"],
      url: "https://x/v1/admin/alerts/alt_1/ack",
      method: "POST",
    });
    const ackRes = await handleAckAlert(ackReq, env, "alt_1");
    expect(ackRes.status).toBe(200);
    expect(((await ackRes.json()) as { alert: { status: string } }).alert.status).toBe("read");

    const resolveReq = await buildSessionRequest(db, {
      userId: "u1",
      roles: ["ads_manager"],
      url: "https://x/v1/admin/alerts/alt_1/resolve",
      method: "POST",
    });
    const resolveRes = await handleResolveAlert(resolveReq, env, "alt_1");
    expect(resolveRes.status).toBe(200);
    expect(((await resolveRes.json()) as { alert: { status: string } }).alert.status).toBe("resolved");

    const again = await handleResolveAlert(resolveReq, env, "alt_1");
    expect(again.status).toBe(409);
  });

  it("list/get require alerts.read; read_only cannot ack", async () => {
    const listReq = await buildSessionRequest(db, {
      userId: "u_ro",
      roles: ["read_only"],
      url: "https://x/v1/admin/alerts",
    });
    expect((await handleListAlerts(listReq, env, new URL(listReq.url))).status).toBe(200);
    expect((await handleGetAlert(listReq, env, "alt_1")).status).toBe(200);

    const ackReq = await buildSessionRequest(db, {
      userId: "u_ro",
      roles: ["read_only"],
      url: "https://x/v1/admin/alerts/alt_1/ack",
      method: "POST",
    });
    expect((await handleAckAlert(ackReq, env, "alt_1")).status).toBe(403);
  });

  it("generate creates rights_missing alerts", async () => {
    db.campaigns.push({
      campaign_id: "cmp_nr",
      title: "No rights",
      status: "approved",
      end_at: new Date(Date.now() + 3 * 86400000).toISOString(),
    });
    const req = await buildSessionRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://x/v1/admin/alerts/generate",
      method: "POST",
    });
    const res = await handleGenerateAlerts(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number; cron: string };
    expect(body.created).toBeGreaterThanOrEqual(1);
    expect(body.cron).toBe("deferred_to_etapa_9");
  });
});

describe("admin-ops — nav filtering (kap. 5)", () => {
  it("filterNavForRoles omits users for ads_manager and includes alerts", () => {
    const nav = filterNavForRoles(["ads_manager"]);
    const ids = nav.map((n) => n.id);
    expect(ids).toContain("dashboard");
    expect(ids).toContain("campaigns");
    expect(ids).toContain("alerts");
    expect(ids).not.toContain("users");
    expect(ids).not.toContain("clients");
  });

  it("GET /nav returns filtered items for sales", async () => {
    const db = new FakeD1();
    const env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET } as Env;
    const req = await buildSessionRequest(db, {
      userId: "u_sales",
      roles: ["sales"],
      url: "https://x/v1/admin/nav",
    });
    const res = await handleGetAdminNav(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nav: Array<{ id: string }> };
    const ids = body.nav.map((n) => n.id);
    expect(ids).toContain("clients");
    expect(ids).toContain("invoices");
    expect(ids).not.toContain("users");
    expect(ids).not.toContain("codes");
  });
});
