/**
 * Admin creatives endpoints (Etapa 4, kap. 12). RBAC: creatives.read/creatives.write.
 * Uploads go through r2-security.ts validation into the CREATIVES bucket; access is always
 * a short-lived signed Worker path (signed-access.ts) — never a permanent public R2 URL,
 * even for `approved` creatives (public delivery only ever serves a signed/CDN-fronted path,
 * wired in Etapa 5). Approve/reject gate whether a creative may be attached to a live campaign.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { buildObjectKey, contentHashHex, extForMime, validateUploadObject } from "./r2-security";
import { signObjectAccess } from "./signed-access";
import type { Env } from "./types";

const DEVICE_CATEGORIES = ["pc", "mobile", "tablet", "universal"] as const;
function isDeviceCategory(value: unknown): value is (typeof DEVICE_CATEGORIES)[number] {
  return typeof value === "string" && (DEVICE_CATEGORIES as readonly string[]).includes(value);
}

const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];
function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && (REVIEW_STATUSES as readonly string[]).includes(value);
}

type CreativeRow = {
  creative_id: string;
  client_id: string;
  campaign_id: string | null;
  version: number;
  device_category: string | null;
  format: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  content_hash: string;
  r2_key: string;
  review_status: string;
  uploaded_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

const CREATIVE_COLUMNS =
  "creative_id, client_id, campaign_id, version, device_category, format, mime_type, width, height, byte_size, content_hash, r2_key, review_status, uploaded_by, approved_at, approved_by, created_at, updated_at";

const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
const MAX_SIGNED_URL_TTL_SECONDS = 3600;

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.floor(n));
}

/** Never returns `r2_key` — object location is only resolved via the signed access endpoint. */
function serializeCreative(row: CreativeRow) {
  return {
    creative_id: row.creative_id,
    client_id: row.client_id,
    campaign_id: row.campaign_id,
    version: row.version,
    device_category: row.device_category,
    format: row.format,
    mime_type: row.mime_type,
    width: row.width,
    height: row.height,
    byte_size: row.byte_size,
    content_hash: row.content_hash,
    review_status: row.review_status,
    uploaded_by: row.uploaded_by,
    approved_at: row.approved_at,
    approved_by: row.approved_by,
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

export async function handleListCreatives(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "creatives.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const clientId = url.searchParams.get("client_id");
  const campaignId = url.searchParams.get("campaign_id");
  const reviewStatus = url.searchParams.get("review_status");
  const limit = clampLimit(url.searchParams.get("limit"));

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
  if (reviewStatus) {
    conditions.push("review_status = ?");
    params.push(reviewStatus);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit);

  const res = await env.DB.prepare(
    "SELECT " + CREATIVE_COLUMNS + " FROM creatives " + where + " ORDER BY created_at DESC LIMIT ?"
  )
    .bind(...params)
    .all<CreativeRow>();
  return json({ creatives: (res.results || []).map(serializeCreative) });
}

export async function handleUploadCreative(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "creatives.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  if (!env.CREATIVES) return json({ error: "storage_unbound" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
  if (!clientId) return json({ error: "invalid_client_id" }, 400);
  const clientRow = await env.DB.prepare("SELECT client_id FROM clients WHERE client_id = ?").bind(clientId).first();
  if (!clientRow) return json({ error: "client_not_found" }, 400);

  const campaignId = typeof body.campaign_id === "string" && body.campaign_id ? body.campaign_id : null;
  if (campaignId) {
    const campaignRow = await env.DB.prepare("SELECT campaign_id FROM campaigns WHERE campaign_id = ?").bind(campaignId).first();
    if (!campaignRow) return json({ error: "campaign_not_found" }, 400);
  }

  const deviceCategory = body.device_category !== undefined ? body.device_category : "universal";
  if (!isDeviceCategory(deviceCategory)) return json({ error: "invalid_device_category" }, 400);

  const format = typeof body.format === "string" ? body.format.trim() : "";
  const filename = typeof body.filename === "string" ? body.filename : "";
  const declaredMime = typeof body.declared_mime === "string" ? body.declared_mime : "";
  const contentBase64 = typeof body.content_base64 === "string" ? body.content_base64 : "";
  if (!format) return json({ error: "invalid_format" }, 400);
  if (!contentBase64) return json({ error: "invalid_content" }, 400);

  const bytes = base64ToBytes(contentBase64);
  if (!bytes) return json({ error: "invalid_content" }, 400);

  const validation = validateUploadObject({
    purpose: "creative",
    declaredMime,
    filename,
    byteLength: bytes.length,
    content: bytes,
  });
  if (!validation.ok) return json({ error: validation.reason }, 400);

  const creativeId = newId("crv");
  const contentHash = await contentHashHex(bytes);
  const ext = extForMime(validation.mime, filename);
  const r2Key = buildObjectKey({ kind: "creative", id: creativeId, version: 1, ext });

  await env.CREATIVES.put(r2Key, bytes, { httpMetadata: { contentType: validation.mime } });

  const nowIso = new Date().toISOString();
  const width = typeof body.width === "number" ? body.width : null;
  const height = typeof body.height === "number" ? body.height : null;

  await env.DB.prepare(
    "INSERT INTO creatives (creative_id, client_id, campaign_id, version, device_category, format, mime_type, width, height, byte_size, content_hash, r2_key, review_status, uploaded_by, approved_at, approved_by, created_at, updated_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,'pending',?,NULL,NULL,?,?)"
  )
    .bind(
      creativeId,
      clientId,
      campaignId,
      deviceCategory,
      format,
      validation.mime,
      width,
      height,
      bytes.length,
      contentHash,
      r2Key,
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
      operation: "creative_uploaded",
      objectType: "creative",
      objectId: creativeId,
      after: { client_id: clientId, campaign_id: campaignId, mime: validation.mime, byte_size: bytes.length },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + CREATIVE_COLUMNS + " FROM creatives WHERE creative_id = ?")
    .bind(creativeId)
    .first<CreativeRow>();
  return json({ creative: row ? serializeCreative(row) : null }, 201);
}

export async function handleGetCreative(request: Request, env: Env, creativeId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "creatives.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + CREATIVE_COLUMNS + " FROM creatives WHERE creative_id = ?")
    .bind(creativeId)
    .first<CreativeRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ creative: serializeCreative(row) });
}

async function getSignedUrlTtl(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT value FROM system_settings WHERE key = 'CREATIVE_SIGNED_URL_TTL_SECONDS'")
      .first<{ value: string }>();
    const n = Number(row?.value);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SIGNED_URL_TTL_SECONDS;
  } catch {
    return DEFAULT_SIGNED_URL_TTL_SECONDS;
  }
}

/**
 * Issues a short-lived signed access path for a creative — never a permanent public R2 URL,
 * regardless of `review_status`. Records an `object_access_audit` row (mirrors admin-documents.ts).
 */
export async function handleGetCreativeAccess(request: Request, env: Env, creativeId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "creatives.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  if (!env.ADS_R2_SIGNING_SECRET) return json({ error: "signing_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + CREATIVE_COLUMNS + " FROM creatives WHERE creative_id = ?")
    .bind(creativeId)
    .first<CreativeRow>();
  if (!row) return json({ error: "not_found" }, 404);

  const ttlRaw = await getSignedUrlTtl(env.DB);
  const ttl = Math.min(Math.max(1, Math.floor(ttlRaw) || DEFAULT_SIGNED_URL_TTL_SECONDS), MAX_SIGNED_URL_TTL_SECONDS);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = await signObjectAccess(env.ADS_R2_SIGNING_SECRET, { objectKey: row.r2_key, bucket: "CREATIVES", exp });
  const path =
    "/v1/objects/get?bucket=CREATIVES&key=" + encodeURIComponent(row.r2_key) + "&exp=" + String(exp) + "&sig=" + encodeURIComponent(sig);

  try {
    await env.DB.prepare(
      "INSERT INTO object_access_audit (access_id, created_at, bucket, object_key, result, actor_type, actor_id, reason_code) VALUES (?,?,?,?,?,?,?,?)"
    )
      .bind(newId("oaa"), new Date().toISOString(), "CREATIVES", row.r2_key, "granted", "admin", guard.userId, null)
      .run();
  } catch {
    // Access audit persistence must never block issuing the signed URL itself.
  }

  return json({ creative_id: creativeId, path, expires_at: new Date(exp * 1000).toISOString() });
}

async function reviewCreative(
  request: Request,
  env: Env,
  creativeId: string,
  toStatus: Extract<ReviewStatus, "approved" | "rejected">,
  operation: "creative_approved" | "creative_rejected"
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "creatives.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + CREATIVE_COLUMNS + " FROM creatives WHERE creative_id = ?")
    .bind(creativeId)
    .first<CreativeRow>();
  if (!before) return json({ error: "not_found" }, 404);
  if (before.review_status !== "pending") return json({ error: "already_reviewed", review_status: before.review_status }, 409);

  let reason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: unknown };
    reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
  } catch {
    // reason is optional — an empty/absent body is fine.
  }

  const nowIso = new Date().toISOString();
  const approvedAt = toStatus === "approved" ? nowIso : null;
  const approvedBy = toStatus === "approved" ? guard.userId : null;

  await env.DB.prepare(
    "UPDATE creatives SET review_status = ?, approved_at = ?, approved_by = ?, updated_at = ? WHERE creative_id = ?"
  )
    .bind(toStatus, approvedAt, approvedBy, nowIso, creativeId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation,
      objectType: "creative",
      objectId: creativeId,
      before: { review_status: before.review_status },
      after: { review_status: toStatus, reason },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + CREATIVE_COLUMNS + " FROM creatives WHERE creative_id = ?")
    .bind(creativeId)
    .first<CreativeRow>();
  return json({ creative: after ? serializeCreative(after) : null });
}

export async function handleApproveCreative(request: Request, env: Env, creativeId: string): Promise<Response> {
  return reviewCreative(request, env, creativeId, "approved", "creative_approved");
}

export async function handleRejectCreative(request: Request, env: Env, creativeId: string): Promise<Response> {
  return reviewCreative(request, env, creativeId, "rejected", "creative_rejected");
}

export { isReviewStatus };
