/**
 * Admin documents endpoints (Etapa 3, kap. 22). RBAC: documents.read/documents.write.
 * Uploads go through r2-security.ts validation into DOCUMENTS bucket; access is always a
 * short-lived signed Worker path via visibility.ts/signed-access.ts — never a permanent
 * public R2 URL, even for `visibility: "public"` documents (see 08-r2-plan.md).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { buildObjectKey, contentHashHex, extForMime, validateUploadObject } from "./r2-security";
import { buildSignedDocumentAccess, isDocumentVisibility, type DocumentVisibility } from "./visibility";
import type { Env } from "./types";

type DocumentRow = {
  document_id: string;
  client_id: string | null;
  campaign_id: string | null;
  doc_type: string;
  title: string;
  version: number;
  content_hash: string;
  r2_key: string;
  visibility: string;
  client_can_download: number;
  retention_until: string | null;
  uploaded_by: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const DOCUMENT_COLUMNS =
  "document_id, client_id, campaign_id, doc_type, title, version, content_hash, r2_key, visibility, client_can_download, retention_until, uploaded_by, status, created_at, updated_at";

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.floor(n));
}

function clampOffset(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Never returns `r2_key` — object location is only resolved via the signed access endpoint. */
function serializeDocument(row: DocumentRow) {
  return {
    document_id: row.document_id,
    client_id: row.client_id,
    campaign_id: row.campaign_id,
    doc_type: row.doc_type,
    title: row.title,
    version: row.version,
    content_hash: row.content_hash,
    visibility: row.visibility,
    client_can_download: row.client_can_download === 1,
    retention_until: row.retention_until,
    uploaded_by: row.uploaded_by,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function handleListDocuments(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "documents.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const clientId = url.searchParams.get("client_id");
  const campaignId = url.searchParams.get("campaign_id");
  const docType = url.searchParams.get("doc_type");
  const visibility = url.searchParams.get("visibility");
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (clientId) {
    conditions.push("client_id = ?");
    params.push(clientId);
  }
  if (campaignId) {
    conditions.push("campaign_id = ?");
    params.push(campaignId);
  }
  if (docType) {
    conditions.push("doc_type = ?");
    params.push(docType);
  }
  if (visibility) {
    conditions.push("visibility = ?");
    params.push(visibility);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit, offset);

  const res = await env.DB.prepare(
    "SELECT " + DOCUMENT_COLUMNS + " FROM documents " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<DocumentRow>();
  return json({ documents: (res.results || []).map(serializeDocument), limit, offset });
}

export async function handleUploadDocument(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "documents.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  if (!env.DOCUMENTS) return json({ error: "storage_unbound" }, 503);

  let body: {
    client_id?: unknown;
    campaign_id?: unknown;
    doc_type?: unknown;
    title?: unknown;
    visibility?: unknown;
    filename?: unknown;
    declared_mime?: unknown;
    content_base64?: unknown;
    retention_until?: unknown;
    client_can_download?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const docType = typeof body.doc_type === "string" ? body.doc_type.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!docType) return json({ error: "invalid_doc_type" }, 400);
  if (!title) return json({ error: "invalid_title" }, 400);

  const visibility: DocumentVisibility = isDocumentVisibility(body.visibility) ? body.visibility : "internal_only";
  const filename = typeof body.filename === "string" ? body.filename : "";
  const declaredMime = typeof body.declared_mime === "string" ? body.declared_mime : "";
  const contentBase64 = typeof body.content_base64 === "string" ? body.content_base64 : "";
  if (!contentBase64) return json({ error: "invalid_content" }, 400);

  const bytes = base64ToBytes(contentBase64);
  if (!bytes) return json({ error: "invalid_content" }, 400);

  const validation = validateUploadObject({
    purpose: "document",
    declaredMime,
    filename,
    byteLength: bytes.length,
    content: bytes,
  });
  if (!validation.ok) return json({ error: validation.reason }, 400);

  const clientId = typeof body.client_id === "string" && body.client_id ? body.client_id : null;
  const campaignId = typeof body.campaign_id === "string" && body.campaign_id ? body.campaign_id : null;
  if (clientId) {
    const clientRow = await env.DB.prepare("SELECT client_id FROM clients WHERE client_id = ?").bind(clientId).first();
    if (!clientRow) return json({ error: "client_not_found" }, 400);
  }

  const documentId = newId("doc");
  const contentHash = await contentHashHex(bytes);
  const ext = extForMime(validation.mime, filename);
  const r2Key = buildObjectKey({ kind: "document", id: documentId, version: 1, ext });

  await env.DOCUMENTS.put(r2Key, bytes, { httpMetadata: { contentType: validation.mime } });

  const nowIso = new Date().toISOString();
  const clientCanDownload = body.client_can_download === true ? 1 : 0;
  const retentionUntil = typeof body.retention_until === "string" ? body.retention_until : null;

  await env.DB.prepare(
    "INSERT INTO documents (document_id, client_id, campaign_id, doc_type, title, version, content_hash, r2_key, visibility, client_can_download, retention_until, uploaded_by, status, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,'active',?,?)"
  )
    .bind(
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
      guard.userId,
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "document_uploaded",
      objectType: "document",
      objectId: documentId,
      after: { doc_type: docType, title, visibility, mime: validation.mime, byte_size: bytes.length },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + DOCUMENT_COLUMNS + " FROM documents WHERE document_id = ?")
    .bind(documentId)
    .first<DocumentRow>();
  return json({ document: row ? serializeDocument(row) : null }, 201);
}

export async function handleGetDocument(request: Request, env: Env, documentId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "documents.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + DOCUMENT_COLUMNS + " FROM documents WHERE document_id = ?")
    .bind(documentId)
    .first<DocumentRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ document: serializeDocument(row) });
}

export async function handleUpdateDocument(request: Request, env: Env, documentId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "documents.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + DOCUMENT_COLUMNS + " FROM documents WHERE document_id = ?")
    .bind(documentId)
    .first<DocumentRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: {
    title?: unknown;
    visibility?: unknown;
    status?: unknown;
    retention_until?: unknown;
    client_can_download?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.visibility !== undefined && !isDocumentVisibility(body.visibility)) {
    return json({ error: "invalid_visibility" }, 400);
  }

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : before.title;
  const visibility = isDocumentVisibility(body.visibility) ? body.visibility : before.visibility;
  const status = typeof body.status === "string" && body.status.trim() ? body.status.trim() : before.status;
  const retentionUntil = typeof body.retention_until === "string" ? body.retention_until : before.retention_until;
  const clientCanDownload =
    typeof body.client_can_download === "boolean" ? (body.client_can_download ? 1 : 0) : before.client_can_download;
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE documents SET title = ?, visibility = ?, status = ?, retention_until = ?, client_can_download = ?, updated_at = ? WHERE document_id = ?"
  )
    .bind(title, visibility, status, retentionUntil, clientCanDownload, nowIso, documentId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "document_updated",
      objectType: "document",
      objectId: documentId,
      before: { visibility: before.visibility, status: before.status },
      after: { visibility, status },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + DOCUMENT_COLUMNS + " FROM documents WHERE document_id = ?")
    .bind(documentId)
    .first<DocumentRow>();
  return json({ document: after ? serializeDocument(after) : null });
}

async function getSignedUrlTtl(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT value FROM system_settings WHERE key = 'R2_SIGNED_URL_TTL_SECONDS'")
      .first<{ value: string }>();
    const n = Number(row?.value);
    return Number.isFinite(n) && n > 0 ? n : 300;
  } catch {
    return 300;
  }
}

/**
 * Issues a short-lived signed access path for a document — never a permanent public R2 URL,
 * regardless of the document's `visibility`. Also records an `object_access_audit` row (kap. 22/08-r2-plan.md).
 */
export async function handleGetDocumentAccess(request: Request, env: Env, documentId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "documents.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  if (!env.ADS_R2_SIGNING_SECRET) return json({ error: "signing_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + DOCUMENT_COLUMNS + " FROM documents WHERE document_id = ?")
    .bind(documentId)
    .first<DocumentRow>();
  if (!row) return json({ error: "not_found" }, 404);
  if (row.status !== "active") return json({ error: "document_not_active" }, 409);

  const ttl = await getSignedUrlTtl(env.DB);
  const access = await buildSignedDocumentAccess(env.ADS_R2_SIGNING_SECRET, row.r2_key, ttl);

  try {
    await env.DB.prepare(
      "INSERT INTO object_access_audit (access_id, created_at, bucket, object_key, result, actor_type, actor_id, reason_code) VALUES (?,?,?,?,?,?,?,?)"
    )
      .bind(newId("oaa"), new Date().toISOString(), "DOCUMENTS", row.r2_key, "granted", "admin", guard.userId, null)
      .run();
  } catch {
    // Access audit persistence must never block issuing the signed URL itself.
  }

  return json({ document_id: documentId, path: access.path, expires_at: access.expiresAt });
}
