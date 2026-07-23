/**
 * Admin client access-code management (Etapa 7, kap. 36).
 * Permissions: codes.read / codes.write (main_admin, ads_manager, read_only for read).
 * Hash-only storage: deterministic SHA-256(pepper|code) — NEVER persist plaintext.
 * Plaintext returned ONCE at issue / regen only. Every mutation → audit_logs (redacted).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PREFIX_LEN = 4;

export type CodeStatus = "active" | "revoked" | "expired";

export type ClientAccessCodeRow = {
  code_id: string;
  client_id: string;
  code_hash: string;
  code_prefix: string | null;
  status: string;
  created_at: string;
  expires_at: string | null;
  deactivated_at: string | null;
  last_used_at: string | null;
  created_by: string | null;
  replaced_by_code_id: string | null;
  data_scope_json: string | null;
};

function toHex(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
  return s;
}

/** Deterministic SHA-256(pepper|code) for unique lookup — matches 05-database-model.md. */
export async function hashClientAccessCode(plaintext: string, pepper: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pepper + "|" + plaintext));
  return toHex(digest);
}

/** High-entropy opaque code; format IU-XXXX-XXXX-XXXX-XXXX (prefix = first group). */
export function generateClientAccessCode(): { plaintext: string; prefix: string } {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    const bytes = new Uint8Array(CODE_PREFIX_LEN);
    crypto.getRandomValues(bytes);
    let part = "";
    for (let i = 0; i < CODE_PREFIX_LEN; i++) part += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    groups.push(part);
  }
  const plaintext = "IU-" + groups.join("-");
  return { plaintext, prefix: groups[0] };
}

export function normalizeClientAccessCode(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Attempt-key for lockout (prefix bucket — mirrors admin email lockout without storing plaintext). */
export async function clientCodeAttemptKey(normalizedCode: string): Promise<string> {
  const m = normalizedCode.match(/^(IU-[A-Z0-9]{4})/);
  const bucket = m ? m[1] : normalizedCode.slice(0, Math.min(8, normalizedCode.length)) || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("attempt|" + bucket));
  return toHex(digest);
}

export function resolveCodeStatus(row: { status: string; expires_at: string | null }, now: Date = new Date()): CodeStatus {
  if (row.status === "revoked") return "revoked";
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  if (row.status === "expired") return "expired";
  return "active";
}

function serializeCodePublic(row: ClientAccessCodeRow, campaignIds: string[], now?: Date) {
  return {
    code_id: row.code_id,
    client_id: row.client_id,
    code_prefix: row.code_prefix,
    status: resolveCodeStatus(row, now),
    created_at: row.created_at,
    expires_at: row.expires_at,
    deactivated_at: row.deactivated_at,
    last_used_at: row.last_used_at,
    created_by: row.created_by,
    replaced_by_code_id: row.replaced_by_code_id,
    campaign_ids: campaignIds,
  };
}

async function loadCampaignIds(db: D1Database, codeId: string): Promise<string[]> {
  const res = await db
    .prepare("SELECT campaign_id FROM client_code_campaigns WHERE code_id = ? ORDER BY campaign_id")
    .bind(codeId)
    .all<{ campaign_id: string }>();
  return (res.results || []).map((r) => r.campaign_id);
}

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first<{ value: string }>();
    return row ? row.value : null;
  } catch {
    return null;
  }
}

async function defaultExpiresAt(db: D1Database): Promise<string> {
  const raw = await getSetting(db, "CLIENT_CODE_DEFAULT_TTL_SECONDS");
  const n = Number(raw);
  const ttl = Number.isFinite(n) && n > 0 ? n : 2_592_000;
  return new Date(Date.now() + ttl * 1000).toISOString();
}

async function assertCampaignsBelongToClient(
  db: D1Database,
  clientId: string,
  campaignIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const campaignId of campaignIds) {
    const row = await db
      .prepare("SELECT campaign_id, client_id FROM campaigns WHERE campaign_id = ?")
      .bind(campaignId)
      .first<{ campaign_id: string; client_id: string }>();
    if (!row) return { ok: false, error: "campaign_not_found" };
    if (row.client_id !== clientId) return { ok: false, error: "campaign_client_mismatch" };
  }
  return { ok: true };
}

async function insertCampaignScope(db: D1Database, codeId: string, campaignIds: string[]): Promise<void> {
  for (const campaignId of campaignIds) {
    await db
      .prepare("INSERT INTO client_code_campaigns (code_id, campaign_id) VALUES (?,?)")
      .bind(codeId, campaignId)
      .run();
  }
}

function parseCampaignIds(body: Record<string, unknown>): string[] | null {
  if (!Array.isArray(body.campaign_ids)) return null;
  const ids = body.campaign_ids.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  return [...new Set(ids)];
}

export async function handleListCodes(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "codes.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const clientId = url.searchParams.get("client_id");
  const statusFilter = url.searchParams.get("status");
  let sql = "SELECT * FROM client_access_codes";
  const params: unknown[] = [];
  if (clientId) {
    sql += " WHERE client_id = ?";
    params.push(clientId);
  }
  sql += " ORDER BY created_at DESC LIMIT 200";
  const res = await env.DB.prepare(sql)
    .bind(...params)
    .all<ClientAccessCodeRow>();
  const now = new Date();
  const codes = [];
  for (const row of res.results || []) {
    const status = resolveCodeStatus(row, now);
    if (statusFilter && status !== statusFilter) continue;
    const campaignIds = await loadCampaignIds(env.DB, row.code_id);
    codes.push(serializeCodePublic(row, campaignIds, now));
  }
  return json({ codes });
}

export async function handleIssueCode(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "codes.write");
  if (!guard.ok) return guard.response;
  if (!env.DB || !env.ADS_CODE_PEPPER) return json({ error: "auth_not_configured" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
  if (!clientId) return json({ error: "client_id_required" }, 400);
  const campaignIds = parseCampaignIds(body);
  if (!campaignIds || campaignIds.length === 0) return json({ error: "campaign_ids_required" }, 400);

  const client = await env.DB.prepare("SELECT client_id FROM clients WHERE client_id = ?").bind(clientId).first();
  if (!client) return json({ error: "client_not_found" }, 404);
  const scopeOk = await assertCampaignsBelongToClient(env.DB, clientId, campaignIds);
  if (!scopeOk.ok) return json({ error: scopeOk.error }, 400);

  const { plaintext, prefix } = generateClientAccessCode();
  const codeHash = await hashClientAccessCode(plaintext, env.ADS_CODE_PEPPER);
  const codeId = newId("cac");
  const nowIso = new Date().toISOString();
  const expiresAt =
    typeof body.expires_at === "string" && body.expires_at.trim()
      ? body.expires_at.trim()
      : await defaultExpiresAt(env.DB);

  await env.DB.prepare(
    "INSERT INTO client_access_codes (code_id, client_id, code_hash, code_prefix, status, created_at, expires_at, deactivated_at, last_used_at, created_by, replaced_by_code_id, data_scope_json) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,NULL,NULL)"
  )
    .bind(codeId, clientId, codeHash, prefix, "active", nowIso, expiresAt, guard.userId)
    .run();
  await insertCampaignScope(env.DB, codeId, campaignIds);

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "client_code_issued",
      objectType: "client_access_code",
      objectId: codeId,
      after: { code_id: codeId, client_id: clientId, code_prefix: prefix, campaign_ids: campaignIds, expires_at: expiresAt },
      result: "success",
    })
  );

  return json(
    {
      code: serializeCodePublic(
        {
          code_id: codeId,
          client_id: clientId,
          code_hash: codeHash,
          code_prefix: prefix,
          status: "active",
          created_at: nowIso,
          expires_at: expiresAt,
          deactivated_at: null,
          last_used_at: null,
          created_by: guard.userId,
          replaced_by_code_id: null,
          data_scope_json: null,
        },
        campaignIds
      ),
      // Plaintext returned ONCE — never persisted, never in audit.
      access_code: plaintext,
    },
    201
  );
}

export async function handleGetCode(request: Request, env: Env, codeId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "codes.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT * FROM client_access_codes WHERE code_id = ?")
    .bind(codeId)
    .first<ClientAccessCodeRow>();
  if (!row) return json({ error: "not_found" }, 404);
  const campaignIds = await loadCampaignIds(env.DB, codeId);
  return json({ code: serializeCodePublic(row, campaignIds) });
}

export async function handleRegenCode(request: Request, env: Env, codeId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "codes.write");
  if (!guard.ok) return guard.response;
  if (!env.DB || !env.ADS_CODE_PEPPER) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT * FROM client_access_codes WHERE code_id = ?")
    .bind(codeId)
    .first<ClientAccessCodeRow>();
  if (!before) return json({ error: "not_found" }, 404);

  const campaignIds = await loadCampaignIds(env.DB, codeId);
  if (campaignIds.length === 0) return json({ error: "no_campaign_scope" }, 400);

  let body: Record<string, unknown> = {};
  try {
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      body = await request.json();
    }
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const { plaintext, prefix } = generateClientAccessCode();
  const codeHash = await hashClientAccessCode(plaintext, env.ADS_CODE_PEPPER);
  const newCodeId = newId("cac");
  const nowIso = new Date().toISOString();
  const expiresAt =
    typeof body.expires_at === "string" && body.expires_at.trim()
      ? body.expires_at.trim()
      : before.expires_at || (await defaultExpiresAt(env.DB));

  await env.DB.prepare(
    "UPDATE client_access_codes SET status = 'revoked', deactivated_at = ?, replaced_by_code_id = ? WHERE code_id = ?"
  )
    .bind(nowIso, newCodeId, codeId)
    .run();
  await env.DB.prepare("UPDATE client_sessions SET revoked_at = ? WHERE code_id = ? AND revoked_at IS NULL")
    .bind(nowIso, codeId)
    .run();

  await env.DB.prepare(
    "INSERT INTO client_access_codes (code_id, client_id, code_hash, code_prefix, status, created_at, expires_at, deactivated_at, last_used_at, created_by, replaced_by_code_id, data_scope_json) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,NULL,NULL)"
  )
    .bind(newCodeId, before.client_id, codeHash, prefix, "active", nowIso, expiresAt, guard.userId)
    .run();
  await insertCampaignScope(env.DB, newCodeId, campaignIds);

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "client_code_regenerated",
      objectType: "client_access_code",
      objectId: newCodeId,
      before: { code_id: codeId, code_prefix: before.code_prefix },
      after: { code_id: newCodeId, code_prefix: prefix, replaces: codeId, campaign_ids: campaignIds },
      result: "success",
    })
  );

  return json({
    code: serializeCodePublic(
      {
        code_id: newCodeId,
        client_id: before.client_id,
        code_hash: codeHash,
        code_prefix: prefix,
        status: "active",
        created_at: nowIso,
        expires_at: expiresAt,
        deactivated_at: null,
        last_used_at: null,
        created_by: guard.userId,
        replaced_by_code_id: null,
        data_scope_json: null,
      },
      campaignIds
    ),
    access_code: plaintext,
    replaced_code_id: codeId,
  });
}

export async function handleRevokeCode(request: Request, env: Env, codeId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "codes.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT * FROM client_access_codes WHERE code_id = ?")
    .bind(codeId)
    .first<ClientAccessCodeRow>();
  if (!before) return json({ error: "not_found" }, 404);
  if (before.status === "revoked") return json({ error: "already_revoked" }, 409);

  const nowIso = new Date().toISOString();
  await env.DB.prepare("UPDATE client_access_codes SET status = 'revoked', deactivated_at = ? WHERE code_id = ?")
    .bind(nowIso, codeId)
    .run();
  await env.DB.prepare("UPDATE client_sessions SET revoked_at = ? WHERE code_id = ? AND revoked_at IS NULL")
    .bind(nowIso, codeId)
    .run();

  const campaignIds = await loadCampaignIds(env.DB, codeId);
  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "client_code_revoked",
      objectType: "client_access_code",
      objectId: codeId,
      before: { code_id: codeId, code_prefix: before.code_prefix, status: before.status },
      after: { status: "revoked", deactivated_at: nowIso },
      result: "success",
    })
  );

  const after = { ...before, status: "revoked", deactivated_at: nowIso };
  return json({ code: serializeCodePublic(after, campaignIds) });
}
