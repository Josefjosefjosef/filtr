/**
 * Client portal auth (Etapa 7, kap. 37): access code → read-only session.
 * Gate: ADS_CLIENT_API_ENABLED + ADS_CLIENT_SESSION_SECRET (+ ADS_CODE_PEPPER for verify).
 * Brute-force lockout mirrors admin_login_attempts via client_login_attempts.
 * Uniform errors (no enumeration). Cookie: HttpOnly Secure SameSite=Strict, HMAC with
 * ADS_CLIENT_SESSION_SECRET (never ADS_SESSION_SECRET — cross-token rejection).
 */
import { evaluateLockout, insertAuditLog, json, newId, type LoginAttemptRecord } from "./admin-auth";
import {
  clientCodeAttemptKey,
  hashClientAccessCode,
  normalizeClientAccessCode,
  resolveCodeStatus,
  type ClientAccessCodeRow,
} from "./admin-codes";
import { buildAuditEntry } from "./audit";
import {
  DEFAULT_SESSION_TTL_SECONDS,
  buildExpiredSessionCookie,
  buildSessionCookie,
  generateSessionId,
  hashOpaqueToken,
  nowSeconds,
  parseCookies,
  signSessionToken,
  verifySessionToken,
} from "./session";
import type { Env } from "./types";

export const DEFAULT_CLIENT_SESSION_COOKIE_NAME = "iu_ads_client_session";

export type ClientSettings = {
  sessionTtlSeconds: number;
  sessionCookieName: string;
  loginMaxAttempts: number;
  loginLockoutSeconds: number;
};

export const CLIENT_SETTINGS_DEFAULTS: ClientSettings = {
  sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
  sessionCookieName: DEFAULT_CLIENT_SESSION_COOKIE_NAME,
  loginMaxAttempts: 5,
  loginLockoutSeconds: 900,
};

function numberOr(v: string | null | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first<{ value: string }>();
    return row ? row.value : null;
  } catch {
    return null;
  }
}

export async function loadClientSettings(db: D1Database | undefined): Promise<ClientSettings> {
  if (!db) return { ...CLIENT_SETTINGS_DEFAULTS };
  const [ttl, cookieName, maxAttempts, lockoutSeconds] = await Promise.all([
    getSetting(db, "CLIENT_SESSION_TTL_SECONDS"),
    getSetting(db, "CLIENT_SESSION_COOKIE_NAME"),
    getSetting(db, "CLIENT_LOGIN_MAX_ATTEMPTS"),
    getSetting(db, "CLIENT_LOGIN_LOCKOUT_SECONDS"),
  ]);
  return {
    sessionTtlSeconds: numberOr(ttl, CLIENT_SETTINGS_DEFAULTS.sessionTtlSeconds),
    sessionCookieName: cookieName || CLIENT_SETTINGS_DEFAULTS.sessionCookieName,
    loginMaxAttempts: numberOr(maxAttempts, CLIENT_SETTINGS_DEFAULTS.loginMaxAttempts),
    loginLockoutSeconds: numberOr(lockoutSeconds, CLIENT_SETTINGS_DEFAULTS.loginLockoutSeconds),
  };
}

export type ClientSessionContext = {
  sessionId: string;
  codeId: string;
  clientId: string;
  campaignIds: string[];
};

export type ClientSessionResult =
  | { ok: true; context: ClientSessionContext }
  | { ok: false; status: number; error: string };

export function clientAuthConfigured(env: Env): boolean {
  return !!(env.DB && env.ADS_CLIENT_SESSION_SECRET && env.ADS_CODE_PEPPER);
}

async function loadScopedCampaignIds(db: D1Database, codeId: string): Promise<string[]> {
  const res = await db
    .prepare("SELECT campaign_id FROM client_code_campaigns WHERE code_id = ?")
    .bind(codeId)
    .all<{ campaign_id: string }>();
  return (res.results || []).map((r) => r.campaign_id);
}

export async function requireClientSession(request: Request, env: Env): Promise<ClientSessionResult> {
  if (!clientAuthConfigured(env) || !env.DB || !env.ADS_CLIENT_SESSION_SECRET) {
    return { ok: false, status: 503, error: "auth_not_configured" };
  }
  const settings = await loadClientSettings(env.DB);
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[settings.sessionCookieName];
  if (!token) return { ok: false, status: 401, error: "no_session" };

  // Reject admin session cookies presented as client tokens (wrong secret → bad_sig).
  const verified = await verifySessionToken(env.ADS_CLIENT_SESSION_SECRET, token);
  if (!verified.ok) return { ok: false, status: 401, error: "invalid_session" };

  const tokenHash = await hashOpaqueToken(verified.sessionId);
  const sessionRow = await env.DB.prepare(
    "SELECT session_id, code_id, expires_at, revoked_at FROM client_sessions WHERE session_id = ? AND token_hash = ?"
  )
    .bind(verified.sessionId, tokenHash)
    .first<{ session_id: string; code_id: string; expires_at: string; revoked_at: string | null }>();
  if (!sessionRow) return { ok: false, status: 401, error: "invalid_session" };
  if (sessionRow.revoked_at) return { ok: false, status: 401, error: "session_revoked" };
  if (new Date(sessionRow.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, error: "session_expired" };
  }

  const codeRow = await env.DB.prepare("SELECT * FROM client_access_codes WHERE code_id = ?")
    .bind(sessionRow.code_id)
    .first<ClientAccessCodeRow>();
  if (!codeRow || resolveCodeStatus(codeRow) !== "active") {
    return { ok: false, status: 401, error: "invalid_session" };
  }

  const campaignIds = await loadScopedCampaignIds(env.DB, codeRow.code_id);
  return {
    ok: true,
    context: {
      sessionId: sessionRow.session_id,
      codeId: codeRow.code_id,
      clientId: codeRow.client_id,
      campaignIds,
    },
  };
}

export async function handleClientLogin(request: Request, env: Env): Promise<Response> {
  if (!clientAuthConfigured(env) || !env.DB || !env.ADS_CLIENT_SESSION_SECRET || !env.ADS_CODE_PEPPER) {
    return json({ error: "auth_not_configured" }, 503);
  }

  let body: { access_code?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const raw = body.access_code !== undefined ? body.access_code : body.code;
  const normalized = normalizeClientAccessCode(raw);
  if (!normalized) return json({ error: "invalid_credentials" }, 401);

  const db = env.DB;
  const settings = await loadClientSettings(db);
  const nowIso = new Date().toISOString();
  const codeKey = await clientCodeAttemptKey(normalized);

  const attemptsRes = await db
    .prepare("SELECT success, attempted_at FROM client_login_attempts WHERE code_key = ? ORDER BY attempted_at DESC LIMIT 50")
    .bind(codeKey)
    .all<{ success: number; attempted_at: string }>();
  const attempts: LoginAttemptRecord[] = (attemptsRes.results || []).map((r) => ({
    success: r.success === 1,
    attempted_at: r.attempted_at,
  }));
  const lockout = evaluateLockout(attempts, {
    maxAttempts: settings.loginMaxAttempts,
    lockoutSeconds: settings.loginLockoutSeconds,
  });
  if (lockout.locked) {
    return json({ error: "locked_out", retryAfterSeconds: lockout.retryAfterSeconds }, 429);
  }

  const recordAttempt = async (success: boolean, reason: string | null) => {
    await db
      .prepare(
        "INSERT INTO client_login_attempts (attempt_id, code_key, attempted_at, success, reason_code) VALUES (?,?,?,?,?)"
      )
      .bind(newId("clatt"), codeKey, nowIso, success ? 1 : 0, reason)
      .run();
  };

  const codeHash = await hashClientAccessCode(normalized, env.ADS_CODE_PEPPER);
  const codeRow = await db
    .prepare("SELECT * FROM client_access_codes WHERE code_hash = ?")
    .bind(codeHash)
    .first<ClientAccessCodeRow>();

  if (!codeRow || resolveCodeStatus(codeRow) !== "active") {
    await recordAttempt(false, !codeRow ? "no_such_code" : resolveCodeStatus(codeRow));
    await insertAuditLog(
      db,
      buildAuditEntry({
        auditId: newId("aud"),
        actorUserId: null,
        operation: "client_login_failed",
        objectType: "client_access_code",
        objectId: codeRow?.code_id || "unknown",
        result: "failure",
      })
    );
    return json({ error: "invalid_credentials" }, 401);
  }

  await recordAttempt(true, null);

  const sessionId = generateSessionId();
  const tokenHash = await hashOpaqueToken(sessionId);
  const expSeconds = nowSeconds() + settings.sessionTtlSeconds;
  const expiresAtIso = new Date(expSeconds * 1000).toISOString();
  await db
    .prepare("INSERT INTO client_sessions (session_id, code_id, token_hash, created_at, expires_at, revoked_at) VALUES (?,?,?,?,?,NULL)")
    .bind(sessionId, codeRow.code_id, tokenHash, nowIso, expiresAtIso)
    .run();
  await db.prepare("UPDATE client_access_codes SET last_used_at = ? WHERE code_id = ?").bind(nowIso, codeRow.code_id).run();

  const token = await signSessionToken(env.ADS_CLIENT_SESSION_SECRET, { sessionId, exp: expSeconds });
  const campaignIds = await loadScopedCampaignIds(db, codeRow.code_id);

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: null,
      operation: "client_login_success",
      objectType: "client_access_code",
      objectId: codeRow.code_id,
      after: { client_id: codeRow.client_id, code_prefix: codeRow.code_prefix },
      result: "success",
    })
  );

  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  headers.append("Set-Cookie", buildSessionCookie(settings.sessionCookieName, token, settings.sessionTtlSeconds));
  return new Response(
    JSON.stringify({
      client: { client_id: codeRow.client_id },
      code: { code_id: codeRow.code_id, code_prefix: codeRow.code_prefix, expires_at: codeRow.expires_at },
      campaign_ids: campaignIds,
    }),
    { status: 200, headers }
  );
}

export async function handleClientLogout(request: Request, env: Env): Promise<Response> {
  const settings = await loadClientSettings(env.DB);
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[settings.sessionCookieName];
  let codeId: string | null = null;

  if (token && env.ADS_CLIENT_SESSION_SECRET && env.DB) {
    const verified = await verifySessionToken(env.ADS_CLIENT_SESSION_SECRET, token);
    if (verified.ok) {
      const tokenHash = await hashOpaqueToken(verified.sessionId);
      const row = await env.DB.prepare("SELECT code_id FROM client_sessions WHERE session_id = ? AND token_hash = ?")
        .bind(verified.sessionId, tokenHash)
        .first<{ code_id: string }>();
      if (row) codeId = row.code_id;
      await env.DB.prepare("UPDATE client_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL")
        .bind(new Date().toISOString(), verified.sessionId)
        .run();
    }
  }

  if (env.DB) {
    await insertAuditLog(
      env.DB,
      buildAuditEntry({
        auditId: newId("aud"),
        actorUserId: null,
        operation: "client_logout",
        objectType: "client_session",
        objectId: codeId || "unknown",
        result: "success",
      })
    );
  }

  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  headers.append("Set-Cookie", buildExpiredSessionCookie(settings.sessionCookieName));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function handleClientMe(request: Request, env: Env): Promise<Response> {
  const result = await requireClientSession(request, env);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({
    client: { client_id: result.context.clientId },
    code: { code_id: result.context.codeId },
    campaign_ids: result.context.campaignIds,
  });
}
