import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateClientAccessCode,
  handleGetCode,
  handleIssueCode,
  handleListCodes,
  handleRegenCode,
  handleRevokeCode,
  hashClientAccessCode,
  normalizeClientAccessCode,
  resolveCodeStatus,
} from "../src/admin-codes";
import { requireAdminSession } from "../src/admin-auth";
import {
  handleClientLogin,
  handleClientLogout,
  handleClientMe,
  requireClientSession,
} from "../src/client-auth";
import { handleClientReport } from "../src/client-report";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import { redactForAudit } from "../src/audit";
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
  clients = new Map<string, Row>();
  campaigns = new Map<string, Row>();
  codes = new Map<string, Row>();
  codeCampaigns = new Map<string, string[]>();
  clientSessions = new Map<string, Row>();
  loginAttempts: Row[] = [];
  documents = new Map<string, Row>();
  placements = new Map<string, Row[]>();
  creatives = new Map<string, Row[]>();
  auditLogs: Row[] = [];
  settings = new Map<string, string>([
    ["CLIENT_SESSION_TTL_SECONDS", "28800"],
    ["CLIENT_SESSION_COOKIE_NAME", "iu_ads_client_session"],
    ["CLIENT_LOGIN_MAX_ATTEMPTS", "5"],
    ["CLIENT_LOGIN_LOCKOUT_SECONDS", "900"],
    ["CLIENT_CODE_DEFAULT_TTL_SECONDS", "2592000"],
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
      return this.adminUsers.get(String(params[0])) || null;
    }
    if (sql.includes("FROM admin_user_roles WHERE user_id = ?")) {
      const roles = this.adminUserRoles.get(String(params[0])) || [];
      return { results: roles.map((r) => ({ role_code: r })) };
    }
    if (sql.includes("FROM system_settings WHERE key = ?")) {
      const v = this.settings.get(String(params[0]));
      return v === undefined ? null : { value: v };
    }
    if (sql.includes("FROM clients WHERE client_id = ?")) {
      return this.clients.get(String(params[0])) || null;
    }
    if (sql.includes("FROM campaigns WHERE campaign_id = ?")) {
      return this.campaigns.get(String(params[0])) || null;
    }
    if (sql.startsWith("INSERT INTO client_access_codes")) {
      const [
        codeId,
        clientId,
        codeHash,
        codePrefix,
        status,
        createdAt,
        expiresAt,
        createdBy,
      ] = params;
      this.codes.set(String(codeId), {
        code_id: codeId,
        client_id: clientId,
        code_hash: codeHash,
        code_prefix: codePrefix,
        status,
        created_at: createdAt,
        expires_at: expiresAt,
        deactivated_at: null,
        last_used_at: null,
        created_by: createdBy,
        replaced_by_code_id: null,
        data_scope_json: null,
      });
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO client_code_campaigns")) {
      const [codeId, campaignId] = params;
      const list = this.codeCampaigns.get(String(codeId)) || [];
      list.push(String(campaignId));
      this.codeCampaigns.set(String(codeId), list);
      return { success: true };
    }
    if (sql.includes("FROM client_code_campaigns WHERE code_id = ?")) {
      const list = this.codeCampaigns.get(String(params[0])) || [];
      return { results: list.map((campaign_id) => ({ campaign_id })) };
    }
    if (sql.includes("SELECT * FROM client_access_codes WHERE code_id = ?")) {
      return this.codes.get(String(params[0])) || null;
    }
    if (sql.includes("FROM client_access_codes WHERE code_hash = ?")) {
      for (const row of this.codes.values()) {
        if (row.code_hash === params[0]) return row;
      }
      return null;
    }
    if (sql.startsWith("SELECT * FROM client_access_codes")) {
      let rows = [...this.codes.values()];
      if (sql.includes("WHERE client_id = ?")) {
        rows = rows.filter((r) => r.client_id === params[0]);
      }
      return { results: rows };
    }
    if (sql.startsWith("UPDATE client_access_codes SET status = 'revoked', deactivated_at = ?, replaced_by_code_id = ?")) {
      const [deactivatedAt, replacedBy, codeId] = params;
      const row = this.codes.get(String(codeId));
      if (row) {
        row.status = "revoked";
        row.deactivated_at = deactivatedAt;
        row.replaced_by_code_id = replacedBy;
      }
      return { success: true };
    }
    if (sql.startsWith("UPDATE client_access_codes SET status = 'revoked', deactivated_at = ? WHERE code_id = ?")) {
      const [deactivatedAt, codeId] = params;
      const row = this.codes.get(String(codeId));
      if (row) {
        row.status = "revoked";
        row.deactivated_at = deactivatedAt;
      }
      return { success: true };
    }
    if (sql.startsWith("UPDATE client_access_codes SET last_used_at")) {
      const [lastUsed, codeId] = params;
      const row = this.codes.get(String(codeId));
      if (row) row.last_used_at = lastUsed;
      return { success: true };
    }
    if (sql.startsWith("UPDATE client_sessions SET revoked_at")) {
      const [revokedAt, id] = params;
      if (sql.includes("WHERE code_id = ?")) {
        for (const row of this.clientSessions.values()) {
          if (row.code_id === id && !row.revoked_at) row.revoked_at = revokedAt;
        }
      } else {
        const row = this.clientSessions.get(String(id));
        if (row && !row.revoked_at) row.revoked_at = revokedAt;
      }
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO client_sessions")) {
      const [sessionId, codeId, tokenHash, createdAt, expiresAt] = params;
      this.clientSessions.set(String(sessionId), {
        session_id: sessionId,
        code_id: codeId,
        token_hash: tokenHash,
        created_at: createdAt,
        expires_at: expiresAt,
        revoked_at: null,
      });
      return { success: true };
    }
    if (sql.includes("FROM client_sessions WHERE session_id = ? AND token_hash = ?")) {
      const [sessionId, tokenHash] = params;
      const row = this.clientSessions.get(String(sessionId));
      const hit = row && row.token_hash === tokenHash ? row : null;
      return mode === "all" ? { results: hit ? [hit] : [] } : hit;
    }
    if (sql.includes("FROM client_login_attempts WHERE code_key = ?")) {
      const key = String(params[0]);
      const rows = this.loginAttempts.filter((a) => a.code_key === key);
      rows.sort((a, b) => String(b.attempted_at).localeCompare(String(a.attempted_at)));
      return { results: rows.slice(0, 50) };
    }
    if (sql.startsWith("INSERT INTO client_login_attempts")) {
      const [attemptId, codeKey, attemptedAt, success, reason] = params;
      this.loginAttempts.push({
        attempt_id: attemptId,
        code_key: codeKey,
        attempted_at: attemptedAt,
        success,
        reason_code: reason,
      });
      return { success: true };
    }
    if (sql.includes("FROM documents WHERE status = 'active'")) {
      return { results: [...this.documents.values()].filter((d) => d.status === "active") };
    }
    if (sql.includes("FROM campaign_placements WHERE campaign_id = ?")) {
      return { results: this.placements.get(String(params[0])) || [] };
    }
    if (sql.includes("FROM creatives WHERE campaign_id = ?")) {
      return { results: this.creatives.get(String(params[0])) || [] };
    }
    if (sql.startsWith("INSERT INTO audit_logs")) {
      this.auditLogs.push({
        audit_id: params[0],
        created_at: params[1],
        actor_user_id: params[2],
        operation: params[3],
        object_type: params[4],
        object_id: params[5],
        before_json: params[6],
        after_json: params[7],
        result: params[8],
      });
      return { success: true };
    }
    if (mode === "all") return { results: [] };
    if (mode === "run") return { success: true };
    return null;
  }
}

const ADMIN_SECRET = "test-admin-session-secret";
const CLIENT_SECRET = "test-client-session-secret";
const CODE_PEPPER = "test-code-pepper";

async function buildAdminRequest(
  db: FakeD1,
  opts: { userId: string; roles: string[]; url: string; method: string; body?: unknown }
): Promise<Request> {
  db.adminUsers.set(opts.userId, {
    user_id: opts.userId,
    email: opts.userId + "@example.test",
    display_name: "Admin",
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
  const token = await signSessionToken(ADMIN_SECRET, { sessionId, exp });
  return new Request(opts.url, {
    method: opts.method,
    headers: { Cookie: "iu_ads_admin_session=" + token, "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function seedClientCampaign(db: FakeD1, clientId: string, campaignId: string, extras: Row = {}) {
  db.clients.set(clientId, { client_id: clientId, company_name: "Acme" });
  db.campaigns.set(campaignId, {
    campaign_id: campaignId,
    evidence_code: "EV-" + campaignId,
    client_id: clientId,
    title: "Campaign " + campaignId,
    status: "active",
    label_type: "Reklama",
    start_at: null,
    end_at: null,
    actual_start_at: null,
    actual_end_at: null,
    target_url: "https://example.test",
    note_client: "visible note",
    note_public: null,
    note_internal: "SECRET INTERNAL",
    price_cents: 99900,
    client_report_enabled: 1,
    client_export_enabled: 1,
    devices_json: '["pc"]',
    sections_json: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...extras,
  });
}

describe("client access code hashing (kap. 36)", () => {
  it("hashes deterministically with pepper and never equals plaintext", async () => {
    const code = "IU-ABCD-EFGH-IJKL-MNOP";
    const h1 = await hashClientAccessCode(code, CODE_PEPPER);
    const h2 = await hashClientAccessCode(code, CODE_PEPPER);
    expect(h1).toEqual(h2);
    expect(h1).not.toEqual(code);
    expect(h1).not.toEqual(await hashClientAccessCode(code, "other-pepper"));
  });

  it("generates high-entropy codes with a stable prefix group", () => {
    const a = generateClientAccessCode();
    const b = generateClientAccessCode();
    expect(a.plaintext).not.toEqual(b.plaintext);
    expect(a.plaintext.startsWith("IU-")).toBe(true);
    expect(a.prefix.length).toBe(4);
    expect(normalizeClientAccessCode(" iu-xx ")).toBe("IU-XX");
  });

  it("resolveCodeStatus marks past expires_at as expired", () => {
    expect(resolveCodeStatus({ status: "active", expires_at: "2000-01-01T00:00:00Z" })).toBe("expired");
    expect(resolveCodeStatus({ status: "revoked", expires_at: null })).toBe("revoked");
    expect(resolveCodeStatus({ status: "active", expires_at: "2099-01-01T00:00:00Z" })).toBe("active");
  });

  it("audit redaction strips access_code / code_hash / code_prefix fields", () => {
    const redacted = redactForAudit({ access_code: "IU-SECRET", code_hash: "abc", code_prefix: "ABCD", client_id: "cli_1" }) as Row;
    expect(redacted.access_code).toBe("[REDACTED]");
    expect(redacted.code_hash).toBe("[REDACTED]");
    // AUDIT_REDACT_KEYS includes bare "code" → any *code* key is redacted (safer than leaking prefix).
    expect(redacted.code_prefix).toBe("[REDACTED]");
    expect(redacted.client_id).toBe("cli_1");
  });
});

describe("admin codes issue/list/regen/revoke", () => {
  let db: FakeD1;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    env = {
      DB: db as unknown as D1Database,
      ADS_SESSION_SECRET: ADMIN_SECRET,
      ADS_CODE_PEPPER: CODE_PEPPER,
    } as Env;
    seedClientCampaign(db, "cli_1", "cmp_1");
  });

  it("issues a code once-show plaintext, stores hash only, and lists without plaintext", async () => {
    const req = await buildAdminRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://ads.test/v1/admin/codes",
      method: "POST",
      body: { client_id: "cli_1", campaign_ids: ["cmp_1"] },
    });
    const res = await handleIssueCode(req, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Row;
    const code = body.code as Row;
    const plaintext = String(body.access_code);
    expect(plaintext.startsWith("IU-")).toBe(true);
    expect(JSON.stringify(body)).toContain(plaintext);
    expect(code.code_hash).toBeUndefined();
    const stored = [...db.codes.values()][0];
    expect(stored.code_hash).toBe(await hashClientAccessCode(plaintext, CODE_PEPPER));
    expect(JSON.stringify(stored)).not.toContain(plaintext);

    const listReq = await buildAdminRequest(db, {
      userId: "u1",
      roles: ["ads_manager"],
      url: "https://ads.test/v1/admin/codes?client_id=cli_1",
      method: "GET",
    });
    const listRes = await handleListCodes(listReq, env, new URL(listReq.url));
    const listBody = (await listRes.json()) as { codes: Row[] };
    expect(listBody.codes.length).toBe(1);
    expect(JSON.stringify(listBody)).not.toContain(plaintext);
    expect(listBody.codes[0].access_code).toBeUndefined();

    expect(db.auditLogs.some((a) => a.operation === "client_code_issued")).toBe(true);
    expect(JSON.stringify(db.auditLogs)).not.toContain(plaintext);
  });

  it("rejects sales (no codes.write) and scopes campaigns to the client", async () => {
    const denied = await buildAdminRequest(db, {
      userId: "sales1",
      roles: ["sales"],
      url: "https://ads.test/v1/admin/codes",
      method: "POST",
      body: { client_id: "cli_1", campaign_ids: ["cmp_1"] },
    });
    expect((await handleIssueCode(denied, env)).status).toBe(403);

    seedClientCampaign(db, "cli_2", "cmp_other");
    const badScope = await buildAdminRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://ads.test/v1/admin/codes",
      method: "POST",
      body: { client_id: "cli_1", campaign_ids: ["cmp_other"] },
    });
    expect((await handleIssueCode(badScope, env)).status).toBe(400);
  });

  it("regen returns new plaintext once, revokes old, and revoke blocks reuse", async () => {
    const issueReq = await buildAdminRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://ads.test/v1/admin/codes",
      method: "POST",
      body: { client_id: "cli_1", campaign_ids: ["cmp_1"] },
    });
    const issued = (await (await handleIssueCode(issueReq, env)).json()) as Row;
    const oldId = String((issued.code as Row).code_id);
    const oldPlain = String(issued.access_code);

    const regenReq = await buildAdminRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://ads.test/v1/admin/codes/" + oldId + "/regen",
      method: "POST",
      body: {},
    });
    const regenRes = await handleRegenCode(regenReq, env, oldId);
    expect(regenRes.status).toBe(200);
    const regenBody = (await regenRes.json()) as Row;
    expect(String(regenBody.access_code)).not.toEqual(oldPlain);
    expect(db.codes.get(oldId)?.status).toBe("revoked");

    const getOld = await buildAdminRequest(db, {
      userId: "u1",
      roles: ["read_only"],
      url: "https://ads.test/v1/admin/codes/" + oldId,
      method: "GET",
    });
    const oldView = (await (await handleGetCode(getOld, env, oldId)).json()) as { code: Row };
    expect(oldView.code.status).toBe("revoked");

    const newId = String((regenBody.code as Row).code_id);
    const revokeReq = await buildAdminRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://ads.test/v1/admin/codes/" + newId + "/revoke",
      method: "POST",
    });
    expect((await handleRevokeCode(revokeReq, env, newId)).status).toBe(200);
    expect(db.codes.get(newId)?.status).toBe("revoked");
  });
});

describe("client auth + report (kap. 37–38)", () => {
  let db: FakeD1;
  let env: Env;
  let plaintext: string;
  let codeId: string;

  beforeEach(async () => {
    db = new FakeD1();
    env = {
      DB: db as unknown as D1Database,
      ADS_SESSION_SECRET: ADMIN_SECRET,
      ADS_CLIENT_SESSION_SECRET: CLIENT_SECRET,
      ADS_CODE_PEPPER: CODE_PEPPER,
    } as Env;
    seedClientCampaign(db, "cli_1", "cmp_1");
    seedClientCampaign(db, "cli_2", "cmp_2");
    db.documents.set("doc_vis", {
      document_id: "doc_vis",
      client_id: "cli_1",
      campaign_id: "cmp_1",
      doc_type: "contract",
      title: "Client contract",
      version: 1,
      visibility: "client_visible",
      client_can_download: 1,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      r2_key: "secret/key",
    });
    db.documents.set("doc_int", {
      document_id: "doc_int",
      client_id: "cli_1",
      campaign_id: "cmp_1",
      doc_type: "internal",
      title: "Internal only",
      version: 1,
      visibility: "internal_only",
      client_can_download: 0,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      r2_key: "secret/key2",
    });
    db.placements.set("cmp_1", [
      {
        campaign_placement_id: "cp_1",
        campaign_id: "cmp_1",
        placement_id: "pl_1",
        placement_type_id: "pt_1",
        section_id: null,
        device_category: "pc",
        status: "active",
        priority: 10,
        start_at: null,
        end_at: null,
      },
    ]);
    db.creatives.set("cmp_1", [
      {
        creative_id: "cr_1",
        campaign_id: "cmp_1",
        format: "image",
        width: 300,
        height: 250,
        device_category: "pc",
        review_status: "approved",
        created_at: "2026-01-01T00:00:00Z",
        r2_key: "must-not-leak",
      },
    ]);

    const issueReq = await buildAdminRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://ads.test/v1/admin/codes",
      method: "POST",
      body: { client_id: "cli_1", campaign_ids: ["cmp_1"] },
    });
    const issued = (await (await handleIssueCode(issueReq, env)).json()) as Row;
    plaintext = String(issued.access_code);
    codeId = String((issued.code as Row).code_id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs in with uniform errors, sets HttpOnly cookie, and rejects wrong codes", async () => {
    const bad = new Request("https://ads.test/v1/client/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: "IU-WRONG-WRONG-WRONG-WRONG" }),
    });
    const badRes = await handleClientLogin(bad, env);
    expect(badRes.status).toBe(401);
    expect(((await badRes.json()) as Row).error).toBe("invalid_credentials");

    const ok = new Request("https://ads.test/v1/client/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: plaintext }),
    });
    const okRes = await handleClientLogin(ok, env);
    expect(okRes.status).toBe(200);
    const setCookie = okRes.headers.get("Set-Cookie") || "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("iu_ads_client_session=");
  });

  it("brute-force lockout after consecutive failures on the same code prefix", async () => {
    // Wrong suffixes that share the real code's IU-XXXX prefix → same lockout bucket.
    const prefix = plaintext.split("-").slice(0, 2).join("-");
    for (let i = 0; i < 5; i++) {
      const bad = new Request("https://ads.test/v1/client/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_code: prefix + "-AAAA-BBBB-CCCC" }),
      });
      expect((await handleClientLogin(bad, env)).status).toBe(401);
    }
    const locked = new Request("https://ads.test/v1/client/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: plaintext }),
    });
    const lockedRes = await handleClientLogin(locked, env);
    expect(lockedRes.status).toBe(429);
    expect(((await lockedRes.json()) as Row).error).toBe("locked_out");
  });

  it("rejects expired and revoked codes", async () => {
    const row = db.codes.get(codeId)!;
    row.expires_at = "2000-01-01T00:00:00Z";
    const expiredLogin = new Request("https://ads.test/v1/client/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: plaintext }),
    });
    expect((await handleClientLogin(expiredLogin, env)).status).toBe(401);

    row.expires_at = "2099-01-01T00:00:00Z";
    row.status = "revoked";
    const revokedLogin = new Request("https://ads.test/v1/client/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: plaintext }),
    });
    expect((await handleClientLogin(revokedLogin, env)).status).toBe(401);
  });

  it("cross-token rejection: client session fails admin; admin session fails client", async () => {
    const login = new Request("https://ads.test/v1/client/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: plaintext }),
    });
    const loginRes = await handleClientLogin(login, env);
    const clientCookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];

    const adminCheck = await requireAdminSession(
      new Request("https://ads.test/v1/admin/auth/me", { headers: { Cookie: clientCookie } }),
      env
    );
    expect(adminCheck.ok).toBe(false);

    const adminReq = await buildAdminRequest(db, {
      userId: "u1",
      roles: ["main_admin"],
      url: "https://ads.test/v1/admin/auth/me",
      method: "GET",
    });
    const adminCookie = adminReq.headers.get("Cookie") || "";
    // Present admin cookie under the client cookie name.
    const adminToken = adminCookie.split("=")[1];
    const spoof = new Request("https://ads.test/v1/client/auth/me", {
      headers: { Cookie: "iu_ads_client_session=" + adminToken },
    });
    const clientCheck = await requireClientSession(spoof, env);
    expect(clientCheck.ok).toBe(false);

    // Admin code body must not authenticate as client access code.
    const adminAsCode = new Request("https://ads.test/v1/client/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: adminToken }),
    });
    expect((await handleClientLogin(adminAsCode, env)).status).toBe(401);
  });

  it("report is scoped to code campaigns, hides internal docs/prices, isolates clients", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ rows: [], totals: { impressions: 0, clicks: 0, valid_clicks: 0, suspicious_clicks: 0 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    // Analytics not configured → soft empty stats.
    db.settings.set("ANALYTICS_ADMIN_REPORT_URL", "");

    const login = new Request("https://ads.test/v1/client/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: plaintext }),
    });
    const loginRes = await handleClientLogin(login, env);
    const cookie = (loginRes.headers.get("Set-Cookie") || "").split(";")[0];

    const reportReq = new Request("https://ads.test/v1/client/report", { headers: { Cookie: cookie } });
    const reportRes = await handleClientReport(reportReq, env, new URL(reportReq.url));
    expect(reportRes.status).toBe(200);
    const body = (await reportRes.json()) as { report: Row };
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("SECRET INTERNAL");
    expect(serialized).not.toContain("price_cents");
    expect(serialized).not.toContain("99900");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("secret/key");
    expect(serialized).not.toContain(plaintext);
    expect(serialized).toContain("Client contract");
    expect(serialized).not.toContain("Internal only");
    expect(serialized).not.toContain("cmp_2");
    expect((body.report.campaigns as Row[]).length).toBe(1);

    const forbidden = await handleClientReport(
      new Request("https://ads.test/v1/client/report?campaign_id=cmp_2", { headers: { Cookie: cookie } }),
      env,
      new URL("https://ads.test/v1/client/report?campaign_id=cmp_2")
    );
    expect(forbidden.status).toBe(403);

    const me = await handleClientMe(new Request("https://ads.test/v1/client/auth/me", { headers: { Cookie: cookie } }), env);
    expect(me.status).toBe(200);

    const logout = await handleClientLogout(
      new Request("https://ads.test/v1/client/auth/logout", { method: "POST", headers: { Cookie: cookie } }),
      env
    );
    expect(logout.status).toBe(200);
    const after = await handleClientMe(new Request("https://ads.test/v1/client/auth/me", { headers: { Cookie: cookie } }), env);
    expect(after.status).toBe(401);
  });
});
