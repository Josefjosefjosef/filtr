/**
 * End-to-end signed private object access via Worker /v1/objects/get.
 * Happy path download + MIME; reject tamper / wrong key / expiry; no public R2 URL; cleanup.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { handleGetDocumentAccess, handleUploadDocument } from "../src/admin-documents";
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
  documents = new Map<string, Row>();
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
      return this.adminUsers.get(String(params[0])) || null;
    }
    if (sql.includes("FROM admin_user_roles WHERE user_id = ?")) {
      const roles = this.adminUserRoles.get(String(params[0])) || [];
      return { results: roles.map((r) => ({ role_code: r })) };
    }
    if (sql.includes("FROM system_settings WHERE key = 'R2_SIGNED_URL_TTL_SECONDS'")) return { value: "300" };
    if (sql.includes("FROM system_settings WHERE key = ?")) return null;
    if (sql.includes("FROM clients WHERE client_id = ?")) return null;
    if (sql.startsWith("INSERT INTO documents")) {
      const [
        documentId,
        clientId,
        campaignId,
        docType,
        title,
        contentHash,
        r2Key,
        visibility,
        clientCanDownload,
        retentionUntil,
        uploadedBy,
        createdAt,
        updatedAt,
      ] = params;
      this.documents.set(String(documentId), {
        document_id: documentId,
        client_id: clientId,
        campaign_id: campaignId,
        doc_type: docType,
        title,
        version: 1,
        content_hash: contentHash,
        r2_key: r2Key,
        visibility,
        client_can_download: clientCanDownload,
        retention_until: retentionUntil,
        uploaded_by: uploadedBy,
        status: "active",
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (sql.includes("FROM documents WHERE document_id = ?")) {
      return this.documents.get(String(params[0])) || null;
    }
    if (sql.startsWith("INSERT INTO object_access_audit")) {
      this.objectAccessAudit.push({
        access_id: params[0],
        result: params[4],
        bucket: params[2],
        object_key: params[3],
      });
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
  }
  async get(key: string) {
    return this.objects.get(key) || null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

const SECRET = "test-session-secret-not-for-prod";
const SIGNING_SECRET = "test-signing-secret-not-for-prod";

async function sessionCookie(db: FakeD1, userId: string, roles: string[]): Promise<string> {
  db.adminUsers.set(userId, {
    user_id: userId,
    email: userId + "@test.cz",
    display_name: "T",
    is_active: 1,
    force_password_change: 0,
  });
  db.adminUserRoles.set(userId, roles);
  const sessionId = generateSessionId();
  const exp = nowSeconds() + 3600;
  const tokenHash = await hashOpaqueToken(sessionId);
  db.adminSessions.set(sessionId, {
    session_id: sessionId,
    user_id: userId,
    token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(exp * 1000).toISOString(),
    revoked_at: null,
  });
  const token = await signSessionToken(SECRET, { sessionId, exp });
  return "iu_ads_admin_session=" + token;
}

describe("signed-access happy path via /v1/objects/get", () => {
  let db: FakeD1;
  let documents: FakeR2Bucket;
  let env: Env;

  beforeEach(() => {
    db = new FakeD1();
    documents = new FakeR2Bucket();
    env = {
      DB: db as unknown as D1Database,
      DOCUMENTS: documents as unknown as R2Bucket,
      ADS_SESSION_SECRET: SECRET,
      ADS_PASSWORD_PEPPER: "pepper",
      ADS_R2_SIGNING_SECRET: SIGNING_SECRET,
      ADS_ADMIN_API_ENABLED: "true",
      ADS_SAFE_MODE: "true",
      ADS_PUBLIC_DELIVERY_ENABLED: "false",
    } as Env;
  });

  it("uploads private test object, downloads via valid signature with correct MIME, rejects tamper/expiry/wrong key, cleans up", async () => {
    const cookie = await sessionCookie(db, "usr_sales", ["sales"]);
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x20, 0x74, 0x65, 0x73, 0x74]);
    let bin = "";
    for (let i = 0; i < pdfBytes.length; i++) bin += String.fromCharCode(pdfBytes[i]);

    const uploadRes = await handleUploadDocument(
      new Request("https://worker.test/v1/admin/documents", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_type: "test_private",
          title: "IU_TEST_SIGNED_ACCESS_ONLY",
          visibility: "internal_only",
          filename: "iu-test-signed.pdf",
          declared_mime: "application/pdf",
          content_base64: btoa(bin),
        }),
      }),
      env
    );
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as { document: { document_id: string; r2_key?: string } };
    expect(uploaded.document.r2_key).toBeUndefined();
    const documentId = uploaded.document.document_id;
    expect(documents.objects.size).toBe(1);
    const r2Key = [...documents.objects.keys()][0];
    expect(r2Key).not.toMatch(/r2\.dev|r2\.cloudflarestorage\.com/);

    const accessRes = await handleGetDocumentAccess(
      new Request("https://worker.test/v1/admin/documents/" + documentId + "/access", {
        method: "GET",
        headers: { Cookie: cookie },
      }),
      env,
      documentId
    );
    expect(accessRes.status).toBe(200);
    const accessBody = (await accessRes.json()) as { path: string };
    expect(accessBody.path.startsWith("/v1/objects/get?")).toBe(true);
    expect(accessBody.path).toContain("bucket=DOCUMENTS");
    expect(accessBody.path).not.toContain("r2.dev");
    expect(db.objectAccessAudit.some((a) => a.result === "granted")).toBe(true);

    const okRes = await worker.fetch(new Request("https://worker.test" + accessBody.path), env);
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("Content-Type")).toBe("application/pdf");
    expect(okRes.headers.get("Cache-Control")).toBe("no-store");
    const got = new Uint8Array(await okRes.arrayBuffer());
    expect(Array.from(got)).toEqual(Array.from(pdfBytes));

    const tamperedUrl = new URL("https://worker.test" + accessBody.path);
    tamperedUrl.searchParams.set("sig", (tamperedUrl.searchParams.get("sig") || "") + "x");
    expect((await worker.fetch(new Request(tamperedUrl.toString()), env)).status).toBe(403);

    const wrongKeyUrl = new URL("https://worker.test" + accessBody.path);
    wrongKeyUrl.searchParams.set("key", "document/other/v1.pdf");
    expect((await worker.fetch(new Request(wrongKeyUrl.toString()), env)).status).toBe(403);

    const expiredUrl = new URL("https://worker.test" + accessBody.path);
    expiredUrl.searchParams.set("exp", String(Math.floor(Date.now() / 1000) - 30));
    expect((await worker.fetch(new Request(expiredUrl.toString()), env)).status).toBe(403);

    await documents.delete(r2Key);
    db.documents.delete(documentId);
    expect(documents.objects.size).toBe(0);
    expect(db.documents.has(documentId)).toBe(false);
  });

  it("rejects object get when signing secret missing", async () => {
    const res = await worker.fetch(
      new Request("https://worker.test/v1/objects/get?bucket=DOCUMENTS&key=x&exp=9999999999&sig=abc"),
      { ...env, ADS_R2_SIGNING_SECRET: undefined } as Env
    );
    expect(res.status).toBe(503);
  });
});
