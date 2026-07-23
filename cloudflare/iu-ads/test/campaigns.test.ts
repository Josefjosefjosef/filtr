import { beforeEach, describe, expect, it } from "vitest";
import { handleCreateCampaign, handleTransitionCampaign } from "../src/admin-campaigns";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import type { Env } from "../src/types";

/** Minimal in-memory D1 fake covering only the SQL patterns admin-campaigns.ts issues. */
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
  clients = new Map<string, Row>();
  campaigns = new Map<string, Row>();
  campaignStatusEvents: Row[] = [];
  rightsConfirmations = new Map<string, Row[]>();
  auditLogs: Row[] = [];

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

    if (sql.includes("FROM clients WHERE client_id = ?")) {
      const [clientId] = params;
      return this.clients.get(String(clientId)) || null;
    }
    if (sql.includes("FROM campaigns WHERE evidence_code = ?")) {
      const [code] = params;
      const hit = [...this.campaigns.values()].find((c) => c.evidence_code === code);
      return hit || null;
    }
    if (sql.startsWith("INSERT INTO campaigns")) {
      const [
        campaignId,
        evidenceCode,
        clientId,
        orderId,
        contractId,
        invoiceId,
        title,
        status,
        labelType,
        startAt,
        endAt,
        targetUrl,
        priceCents,
        priceExVatCents,
        vatCents,
        pricingModel,
        impressionLimit,
        clickLimit,
        budgetLimitCents,
        devicesJson,
        sectionsJson,
        regionsJson,
        noteInternal,
        noteClient,
        notePublic,
        clientReportEnabled,
        clientExportEnabled,
        orderedBy,
        payer,
        agencyName,
        createdAt,
        updatedAt,
      ] = params;
      this.campaigns.set(String(campaignId), {
        campaign_id: campaignId,
        evidence_code: evidenceCode,
        client_id: clientId,
        order_id: orderId,
        contract_id: contractId,
        invoice_id: invoiceId,
        title,
        status,
        label_type: labelType,
        start_at: startAt,
        end_at: endAt,
        actual_start_at: null,
        actual_end_at: null,
        target_url: targetUrl,
        price_cents: priceCents,
        price_ex_vat_cents: priceExVatCents,
        vat_cents: vatCents,
        pricing_model: pricingModel,
        impression_limit: impressionLimit,
        click_limit: clickLimit,
        budget_limit_cents: budgetLimitCents,
        devices_json: devicesJson,
        sections_json: sectionsJson,
        regions_json: regionsJson,
        note_internal: noteInternal,
        note_client: noteClient,
        note_public: notePublic,
        client_report_enabled: clientReportEnabled,
        client_export_enabled: clientExportEnabled,
        ordered_by: orderedBy,
        payer,
        agency_name: agencyName,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (sql.includes("FROM campaigns WHERE campaign_id = ?") && sql.startsWith("SELECT")) {
      const [campaignId] = params;
      return this.campaigns.get(String(campaignId)) || null;
    }
    if (sql.startsWith("UPDATE campaigns SET status = ?")) {
      const [status, actualStartAt, actualEndAt, updatedAt, campaignId] = params;
      const row = this.campaigns.get(String(campaignId));
      if (row) {
        row.status = status;
        row.actual_start_at = actualStartAt;
        row.actual_end_at = actualEndAt;
        row.updated_at = updatedAt;
      }
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO campaign_status_events")) {
      const [eventId, campaignId, fromStatus, toStatus, actorUserId, reason, createdAt] = params;
      this.campaignStatusEvents.push({ event_id: eventId, campaign_id: campaignId, from_status: fromStatus, to_status: toStatus, actor_user_id: actorUserId, reason, created_at: createdAt });
      return { success: true };
    }
    if (sql.includes("FROM rights_confirmations WHERE campaign_id = ?")) {
      const [campaignId] = params;
      const rows = this.rightsConfirmations.get(String(campaignId)) || [];
      return rows[0] || null;
    }
    if (sql.startsWith("INSERT INTO audit_logs")) {
      this.auditLogs.push({ params });
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

async function createDraftCampaign(db: FakeD1, env: Env, userId: string, roles: string[]): Promise<string> {
  db.clients.set("cli_1", { client_id: "cli_1" });
  const request = await buildSessionRequest(db, {
    userId,
    roles,
    url: "https://worker.test/v1/admin/campaigns",
    method: "POST",
    body: { client_id: "cli_1", title: "Letní kampaň" },
  });
  const res = await handleCreateCampaign(request, env);
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  return body.campaign.campaign_id as string;
}

async function transition(db: FakeD1, env: Env, userId: string, roles: string[], campaignId: string, to: string) {
  const request = await buildSessionRequest(db, {
    userId,
    roles,
    url: "https://worker.test/v1/admin/campaigns/" + campaignId + "/transition",
    method: "POST",
    body: { to },
  });
  return handleTransitionCampaign(request, env, campaignId);
}

describe("admin-campaigns create + state machine (kap. 7,13)", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = { DB: db as unknown as D1Database, ADS_SESSION_SECRET: SECRET } as Env;
  });

  it("creates a draft campaign with an auto-generated evidence code", async () => {
    const campaignId = await createDraftCampaign(db, env, "usr_ads", ["ads_manager"]);
    const row = db.campaigns.get(campaignId) as any;
    expect(row.status).toBe("draft");
    expect(row.evidence_code).toMatch(/^AD-\d{4}-[A-Z0-9]{8}$/);
  });

  it("walks ads_manager through the full pipeline into active once rights are confirmed", async () => {
    const campaignId = await createDraftCampaign(db, env, "usr_ads", ["ads_manager"]);
    for (const to of ["awaiting_assets", "awaiting_legal", "awaiting_tech", "awaiting_approval", "approved", "scheduled"]) {
      const res = await transition(db, env, "usr_ads", ["ads_manager"], campaignId, to);
      expect(res.status).toBe(200);
    }
    // Entering `active` without a rights confirmation is blocked.
    const blocked = await transition(db, env, "usr_ads", ["ads_manager"], campaignId, "active");
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as any).error).toBe("rights_confirmation_required");

    db.rightsConfirmations.set(campaignId, [{ confirmation_id: "rgt_1" }]);
    const activated = await transition(db, env, "usr_ads", ["ads_manager"], campaignId, "active");
    expect(activated.status).toBe(200);
    const body = (await activated.json()) as any;
    expect(body.campaign.status).toBe("active");
    expect(db.campaignStatusEvents.at(-1)?.to_status).toBe("active");
  });

  it("rejects an invalid transition (skipping states) with 409", async () => {
    const campaignId = await createDraftCampaign(db, env, "usr_ads", ["ads_manager"]);
    const res = await transition(db, env, "usr_ads", ["ads_manager"], campaignId, "active");
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe("invalid_transition");
  });

  it("denies sales from activating a campaign (no campaigns.write at all — kap. 4/7)", async () => {
    const campaignId = await createDraftCampaign(db, env, "usr_ads", ["ads_manager"]);
    for (const to of ["awaiting_assets", "awaiting_legal", "awaiting_tech", "awaiting_approval"]) {
      await transition(db, env, "usr_ads", ["ads_manager"], campaignId, to);
    }
    const res = await transition(db, env, "usr_sales", ["sales"], campaignId, "approved");
    expect(res.status).toBe(403);
    expect(db.campaigns.get(campaignId)?.status).toBe("awaiting_approval");
  });

  it("denies read_only from transitioning campaigns", async () => {
    const campaignId = await createDraftCampaign(db, env, "usr_ads", ["ads_manager"]);
    const res = await transition(db, env, "usr_ro", ["read_only"], campaignId, "awaiting_assets");
    expect(res.status).toBe(403);
  });

  it("rejects requests without a session cookie (401)", async () => {
    const campaignId = await createDraftCampaign(db, env, "usr_ads", ["ads_manager"]);
    const request = new Request("https://worker.test/v1/admin/campaigns/" + campaignId + "/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "awaiting_assets" }),
    });
    const res = await handleTransitionCampaign(request, env, campaignId);
    expect(res.status).toBe(401);
  });

  it("rejects an unsafe target_url at creation time (kap. 43)", async () => {
    db.clients.set("cli_1", { client_id: "cli_1" });
    const request = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/campaigns",
      method: "POST",
      body: { client_id: "cli_1", title: "X", target_url: "javascript:alert(1)" },
    });
    const res = await handleCreateCampaign(request, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("unsafe_scheme");
  });
});
