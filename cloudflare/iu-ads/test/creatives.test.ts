import { beforeEach, describe, expect, it } from "vitest";
import { handleApproveCreative, handleGetCreativeAccess, handleRejectCreative, handleUploadCreative } from "../src/admin-creatives";
import { validateUploadObject } from "../src/r2-security";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import type { Env } from "../src/types";

describe("r2-security creative upload validation (kap. 12)", () => {
  it("accepts a valid PNG creative", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = validateUploadObject({
      purpose: "creative",
      declaredMime: "image/png",
      filename: "banner.png",
      byteLength: png.length,
      content: png,
    });
    expect(r).toEqual({ ok: true, mime: "image/png" });
  });

  it("rejects an SVG creative (forbidden — inline script surface)", () => {
    const svg = new TextEncoder().encode("<svg onload='alert(1)'></svg>");
    const r = validateUploadObject({
      purpose: "creative",
      declaredMime: "image/svg+xml",
      filename: "banner.svg",
      byteLength: svg.length,
      content: svg,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an oversized creative (> MAX_CREATIVE_BYTES)", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const r = validateUploadObject({
      purpose: "creative",
      declaredMime: "image/png",
      filename: "big.png",
      byteLength: 6 * 1024 * 1024,
      content: png,
    });
    expect(r).toEqual({ ok: false, reason: "size_limit" });
  });

  it("rejects HTML disguised with a .png filename (magic-byte mismatch)", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const r = validateUploadObject({
      purpose: "creative",
      declaredMime: "image/png",
      filename: "fake.png",
      byteLength: html.length,
      content: html,
    });
    expect(r.ok).toBe(false);
  });
});

/** Minimal in-memory D1 + R2 fakes covering only the statements admin-creatives.ts issues. */
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
  creatives = new Map<string, Row>();
  objectAccessAudit: Row[] = [];

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
    if (sql.includes("FROM system_settings WHERE key = 'CREATIVE_SIGNED_URL_TTL_SECONDS'")) return { value: "300" };
    if (sql.includes("FROM system_settings WHERE key = ?")) return null;
    if (sql.includes("FROM clients WHERE client_id = ?")) {
      const [clientId] = params;
      return this.clients.get(String(clientId)) || null;
    }
    if (sql.includes("FROM campaigns WHERE campaign_id = ?")) {
      const [campaignId] = params;
      return this.campaigns.get(String(campaignId)) || null;
    }
    if (sql.startsWith("INSERT INTO creatives")) {
      const [
        creativeId,
        clientId,
        campaignId,
        deviceCategory,
        format,
        mimeType,
        width,
        height,
        byteSize,
        contentHash,
        r2Key,
        uploadedBy,
        createdAt,
        updatedAt,
      ] = params;
      this.creatives.set(String(creativeId), {
        creative_id: creativeId,
        client_id: clientId,
        campaign_id: campaignId,
        version: 1,
        device_category: deviceCategory,
        format,
        mime_type: mimeType,
        width,
        height,
        byte_size: byteSize,
        content_hash: contentHash,
        r2_key: r2Key,
        review_status: "pending",
        uploaded_by: uploadedBy,
        approved_at: null,
        approved_by: null,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (sql.includes("FROM creatives WHERE creative_id = ?") && sql.startsWith("SELECT")) {
      const [creativeId] = params;
      return this.creatives.get(String(creativeId)) || null;
    }
    if (sql.startsWith("UPDATE creatives SET review_status = ?")) {
      const [reviewStatus, approvedAt, approvedBy, updatedAt, creativeId] = params;
      const row = this.creatives.get(String(creativeId));
      if (row) {
        row.review_status = reviewStatus;
        row.approved_at = approvedAt;
        row.approved_by = approvedBy;
        row.updated_at = updatedAt;
      }
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO object_access_audit")) {
      const [accessId, createdAt, bucket, objectKey, result, actorType, actorId] = params;
      this.objectAccessAudit.push({ accessId, createdAt, bucket, objectKey, result, actorType, actorId });
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO audit_logs")) return { success: true };
    if (mode === "all") return { results: [] };
    if (mode === "run") return { success: true };
    return null;
  }
}

class FakeR2Bucket {
  objects = new Map<string, { body: Uint8Array; httpMetadata?: { contentType?: string } }>();
  async put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
    this.objects.set(key, { body: value, httpMetadata: opts?.httpMetadata });
    return { key } as unknown;
  }
  async get(key: string) {
    return this.objects.get(key) || null;
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

function toBase64(bytes: number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

describe("admin-creatives upload + approve/reject + signed access", () => {
  let db: FakeD1;
  let creatives: FakeR2Bucket;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    creatives = new FakeR2Bucket();
    db.clients.set("cli_1", { client_id: "cli_1" });
    env = {
      DB: db as unknown as D1Database,
      CREATIVES: creatives as unknown as R2Bucket,
      ADS_SESSION_SECRET: SECRET,
      ADS_R2_SIGNING_SECRET: SIGNING_SECRET,
    } as Env;
  });

  async function upload(userId: string, roles: string[]) {
    const request = await buildSessionRequest(db, {
      userId,
      roles,
      url: "https://worker.test/v1/admin/creatives",
      method: "POST",
      body: {
        client_id: "cli_1",
        format: "image",
        device_category: "pc",
        filename: "banner.png",
        declared_mime: "image/png",
        content_base64: toBase64(PNG_BYTES),
      },
    });
    return handleUploadCreative(request, env);
  }

  it("uploads a pending creative and never leaks r2_key in the response", async () => {
    const res = await upload("usr_ads", ["ads_manager"]);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.creative.review_status).toBe("pending");
    expect(body.creative.r2_key).toBeUndefined();
  });

  it("read_only cannot upload creatives (creatives.write required)", async () => {
    const res = await upload("usr_ro", ["read_only"]);
    expect(res.status).toBe(403);
  });

  it("approves a pending creative and stamps approved_by/approved_at", async () => {
    const uploadRes = await upload("usr_ads", ["ads_manager"]);
    const creativeId = ((await uploadRes.json()) as any).creative.creative_id as string;

    const request = await buildSessionRequest(db, {
      userId: "usr_ads2",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/creatives/" + creativeId + "/approve",
      method: "POST",
    });
    const res = await handleApproveCreative(request, env, creativeId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.creative.review_status).toBe("approved");
    expect(body.creative.approved_by).toBe("usr_ads2");
  });

  it("rejects re-reviewing an already-approved creative", async () => {
    const uploadRes = await upload("usr_ads", ["ads_manager"]);
    const creativeId = ((await uploadRes.json()) as any).creative.creative_id as string;
    const approveReq = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/creatives/" + creativeId + "/approve",
      method: "POST",
    });
    await handleApproveCreative(approveReq, env, creativeId);

    const rejectReq = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/creatives/" + creativeId + "/reject",
      method: "POST",
    });
    const res = await handleRejectCreative(rejectReq, env, creativeId);
    expect(res.status).toBe(409);
  });

  it("issues a short-lived signed access path, never a permanent public R2 URL", async () => {
    const uploadRes = await upload("usr_ads", ["ads_manager"]);
    const creativeId = ((await uploadRes.json()) as any).creative.creative_id as string;

    const request = await buildSessionRequest(db, {
      userId: "usr_ads",
      roles: ["ads_manager"],
      url: "https://worker.test/v1/admin/creatives/" + creativeId + "/access",
      method: "GET",
    });
    const res = await handleGetCreativeAccess(request, env, creativeId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.path.startsWith("/v1/objects/get?bucket=CREATIVES&")).toBe(true);
    expect(body.path).not.toContain("r2.cloudflarestorage.com");
    expect(db.objectAccessAudit.length).toBe(1);
  });
});
