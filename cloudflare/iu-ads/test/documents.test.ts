import { beforeEach, describe, expect, it } from "vitest";
import { handleGetDocumentAccess, handleUploadDocument } from "../src/admin-documents";
import { contentHashHex, extForMime, validateUploadObject } from "../src/r2-security";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import type { Env } from "../src/types";

describe("r2-security document upload validation (kap. 22)", () => {
  it("accepts a valid PDF document", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const r = validateUploadObject({
      purpose: "document",
      declaredMime: "application/pdf",
      filename: "contract.pdf",
      byteLength: pdf.length,
      content: pdf,
    });
    expect(r).toEqual({ ok: true, mime: "application/pdf" });
  });

  it("rejects HTML/JS disguised as a document", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const r = validateUploadObject({
      purpose: "document",
      declaredMime: "text/html",
      filename: "evil.html",
      byteLength: html.length,
      content: html,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects oversized documents (> MAX_DOCUMENT_BYTES)", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const r = validateUploadObject({
      purpose: "document",
      declaredMime: "application/pdf",
      filename: "big.pdf",
      byteLength: 26 * 1024 * 1024,
      content: pdf,
    });
    expect(r).toEqual({ ok: false, reason: "size_limit" });
  });

  it("contentHashHex is deterministic and hex-encoded", async () => {
    const bytes = new TextEncoder().encode("hello document");
    const a = await contentHashHex(bytes);
    const b = await contentHashHex(bytes);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("extForMime maps known mimes and falls back to filename extension", () => {
    expect(extForMime("application/pdf")).toBe("pdf");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("application/octet-stream", "notes.txt")).toBe("txt");
    expect(extForMime("application/octet-stream")).toBe("bin");
  });
});

/** Minimal in-memory D1 + R2 fakes covering only the statements admin-documents.ts issues. */
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
      const [userId] = params;
      return this.adminUsers.get(String(userId)) || null;
    }
    if (sql.includes("FROM admin_user_roles WHERE user_id = ?")) {
      const [userId] = params;
      const roles = this.adminUserRoles.get(String(userId)) || [];
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
      const [documentId] = params;
      return this.documents.get(String(documentId)) || null;
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

function toBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

describe("admin-documents upload + signed access never leaks a permanent public URL", () => {
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
      ADS_R2_SIGNING_SECRET: SIGNING_SECRET,
    } as Env;
  });

  it("uploads a public-visibility document, but access is still a short-lived signed path", async () => {
    const content = toBase64("%PDF-1.4 fake contract body");
    const request = await buildSessionRequest(db, {
      userId: "usr_sales",
      roles: ["sales"],
      url: "https://worker.test/v1/admin/documents",
      method: "POST",
      body: {
        doc_type: "contract",
        title: "Veřejná smlouva",
        visibility: "public",
        filename: "contract.pdf",
        declared_mime: "application/pdf",
        content_base64: content,
      },
    });
    const uploadRes = await handleUploadDocument(request, env);
    expect(uploadRes.status).toBe(201);
    const uploadBody = (await uploadRes.json()) as any;
    expect(uploadBody.document.visibility).toBe("public");
    expect(uploadBody.document.r2_key).toBeUndefined();
    const documentId = uploadBody.document.document_id as string;

    const accessRequest = await buildSessionRequest(db, {
      userId: "usr_sales",
      roles: ["sales"],
      url: "https://worker.test/v1/admin/documents/" + documentId + "/access",
      method: "GET",
    });
    const accessRes = await handleGetDocumentAccess(accessRequest, env, documentId);
    expect(accessRes.status).toBe(200);
    const accessBody = (await accessRes.json()) as any;
    expect(accessBody.path.startsWith("/v1/objects/get?bucket=DOCUMENTS&")).toBe(true);
    expect(accessBody.path).not.toContain("r2.cloudflarestorage.com");
    expect(db.objectAccessAudit.length).toBe(1);
    expect(db.objectAccessAudit[0].result).toBe("granted");
  });

  it("rejects a disguised-as-pdf upload that fails magic-byte validation", async () => {
    const content = toBase64("<script>alert(1)</script>");
    const request = await buildSessionRequest(db, {
      userId: "usr_sales2",
      roles: ["sales"],
      url: "https://worker.test/v1/admin/documents",
      method: "POST",
      body: {
        doc_type: "contract",
        title: "Fake",
        visibility: "internal_only",
        filename: "notes.txt",
        declared_mime: "application/pdf",
        content_base64: content,
      },
    });
    const res = await handleUploadDocument(request, env);
    expect(res.status).toBe(400);
  });

  it("read_only role can read document access but cannot upload (documents.write required)", async () => {
    const request = await buildSessionRequest(db, {
      userId: "usr_ro",
      roles: ["read_only"],
      url: "https://worker.test/v1/admin/documents",
      method: "POST",
      body: { doc_type: "x", title: "x", filename: "x.pdf", declared_mime: "application/pdf", content_base64: toBase64("x") },
    });
    const res = await handleUploadDocument(request, env);
    expect(res.status).toBe(403);
  });
});
