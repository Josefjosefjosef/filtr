/**
 * Admin authentication core (Etapa 2): login/logout/me, password reset, password change,
 * plus shared session/settings helpers reused by admin-users.ts and admin-audit.ts.
 */
import { buildAuditEntry } from "./audit";
import {
  DEFAULT_PASSWORD_HASH_ITERATIONS,
  DEFAULT_PASSWORD_MIN_LENGTH,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "./password";
import { hasPermission, isRoleCode, type Permission, type RoleCode } from "./rbac";
import {
  DEFAULT_SESSION_COOKIE_NAME,
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
import type { AuditEntry } from "./audit";
import type { Env } from "./types";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE });
}

export function newId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "");
}

export function normalizeEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

export type AdminSettings = {
  sessionTtlSeconds: number;
  sessionCookieName: string;
  loginMaxAttempts: number;
  loginLockoutSeconds: number;
  loginAttemptWindowSeconds: number;
  passwordResetTtlSeconds: number;
  passwordMinLength: number;
  passwordHashIterations: number;
};

export const ADMIN_SETTINGS_DEFAULTS: AdminSettings = {
  sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
  sessionCookieName: DEFAULT_SESSION_COOKIE_NAME,
  loginMaxAttempts: 5,
  loginLockoutSeconds: 900,
  loginAttemptWindowSeconds: 900,
  passwordResetTtlSeconds: 3600,
  passwordMinLength: DEFAULT_PASSWORD_MIN_LENGTH,
  passwordHashIterations: DEFAULT_PASSWORD_HASH_ITERATIONS,
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

export async function loadAdminSettings(db: D1Database | undefined): Promise<AdminSettings> {
  if (!db) return { ...ADMIN_SETTINGS_DEFAULTS };
  const [ttl, cookieName, maxAttempts, lockoutSeconds, windowSeconds, resetTtl, minLen, iterations] = await Promise.all([
    getSetting(db, "ADMIN_SESSION_TTL_SECONDS"),
    getSetting(db, "ADMIN_SESSION_COOKIE_NAME"),
    getSetting(db, "ADMIN_LOGIN_MAX_ATTEMPTS"),
    getSetting(db, "ADMIN_LOGIN_LOCKOUT_SECONDS"),
    getSetting(db, "ADMIN_LOGIN_ATTEMPT_WINDOW_SECONDS"),
    getSetting(db, "ADMIN_PASSWORD_RESET_TTL_SECONDS"),
    getSetting(db, "ADMIN_PASSWORD_MIN_LENGTH"),
    getSetting(db, "ADMIN_PASSWORD_HASH_ITERATIONS"),
  ]);
  return {
    sessionTtlSeconds: numberOr(ttl, ADMIN_SETTINGS_DEFAULTS.sessionTtlSeconds),
    sessionCookieName: cookieName || ADMIN_SETTINGS_DEFAULTS.sessionCookieName,
    loginMaxAttempts: numberOr(maxAttempts, ADMIN_SETTINGS_DEFAULTS.loginMaxAttempts),
    loginLockoutSeconds: numberOr(lockoutSeconds, ADMIN_SETTINGS_DEFAULTS.loginLockoutSeconds),
    loginAttemptWindowSeconds: numberOr(windowSeconds, ADMIN_SETTINGS_DEFAULTS.loginAttemptWindowSeconds),
    passwordResetTtlSeconds: numberOr(resetTtl, ADMIN_SETTINGS_DEFAULTS.passwordResetTtlSeconds),
    passwordMinLength: numberOr(minLen, ADMIN_SETTINGS_DEFAULTS.passwordMinLength),
    passwordHashIterations: numberOr(iterations, ADMIN_SETTINGS_DEFAULTS.passwordHashIterations),
  };
}

/** Pure brute-force lockout policy (kap. 3) — testable without D1. */
export type LoginAttemptRecord = { success: boolean; attempted_at: string };
export type LockoutEvaluation = { locked: boolean; retryAfterSeconds: number };

export function evaluateLockout(
  attempts: readonly LoginAttemptRecord[],
  opts: { maxAttempts: number; lockoutSeconds: number; now?: Date }
): LockoutEvaluation {
  const now = opts.now ?? new Date();
  const sorted = [...attempts].sort(
    (a, b) => new Date(b.attempted_at).getTime() - new Date(a.attempted_at).getTime()
  );
  const consecutiveFailures: LoginAttemptRecord[] = [];
  for (const attempt of sorted) {
    if (attempt.success) break;
    consecutiveFailures.push(attempt);
  }
  if (consecutiveFailures.length < opts.maxAttempts) return { locked: false, retryAfterSeconds: 0 };
  const newestFailureMs = new Date(consecutiveFailures[0].attempted_at).getTime();
  const elapsedSeconds = (now.getTime() - newestFailureMs) / 1000;
  if (elapsedSeconds >= opts.lockoutSeconds) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.ceil(opts.lockoutSeconds - elapsedSeconds) };
}

export async function loadUserRoles(db: D1Database, userId: string): Promise<RoleCode[]> {
  const res = await db
    .prepare("SELECT role_code FROM admin_user_roles WHERE user_id = ?")
    .bind(userId)
    .all<{ role_code: string }>();
  return (res.results || []).map((r) => r.role_code).filter(isRoleCode);
}

export async function insertAuditLog(db: D1Database | undefined, entry: AuditEntry): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        "INSERT INTO audit_logs (audit_id, created_at, actor_user_id, operation, object_type, object_id, before_json, after_json, result) VALUES (?,?,?,?,?,?,?,?,?)"
      )
      .bind(
        entry.audit_id,
        entry.created_at,
        entry.actor_user_id,
        entry.operation,
        entry.object_type,
        entry.object_id,
        entry.before_json,
        entry.after_json,
        entry.result
      )
      .run();
  } catch {
    // Audit persistence must never crash the primary admin operation.
  }
}

export type AdminSessionContext = {
  userId: string;
  email: string;
  displayName: string;
  roles: RoleCode[];
};

export type SessionResult = { ok: true; context: AdminSessionContext } | { ok: false; status: number; error: string };

export async function requireAdminSession(request: Request, env: Env): Promise<SessionResult> {
  if (!env.ADS_SESSION_SECRET) return { ok: false, status: 503, error: "auth_not_configured" };
  if (!env.DB) return { ok: false, status: 503, error: "auth_not_configured" };
  const settings = await loadAdminSettings(env.DB);
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[settings.sessionCookieName];
  if (!token) return { ok: false, status: 401, error: "no_session" };
  const verified = await verifySessionToken(env.ADS_SESSION_SECRET, token);
  if (!verified.ok) return { ok: false, status: 401, error: "invalid_session" };
  const tokenHash = await hashOpaqueToken(verified.sessionId);
  const sessionRow = await env.DB.prepare(
    "SELECT session_id, user_id, expires_at, revoked_at FROM admin_sessions WHERE session_id = ? AND token_hash = ?"
  )
    .bind(verified.sessionId, tokenHash)
    .first<{ session_id: string; user_id: string; expires_at: string; revoked_at: string | null }>();
  if (!sessionRow) return { ok: false, status: 401, error: "invalid_session" };
  if (sessionRow.revoked_at) return { ok: false, status: 401, error: "session_revoked" };
  if (new Date(sessionRow.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, error: "session_expired" };
  }
  const userRow = await env.DB.prepare(
    "SELECT user_id, email, display_name, is_active FROM admin_users WHERE user_id = ?"
  )
    .bind(sessionRow.user_id)
    .first<{ user_id: string; email: string; display_name: string; is_active: number }>();
  if (!userRow || !userRow.is_active) return { ok: false, status: 401, error: "user_inactive" };
  const roles = await loadUserRoles(env.DB, userRow.user_id);
  await env.DB.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE session_id = ?")
    .bind(new Date().toISOString(), sessionRow.session_id)
    .run();
  return {
    ok: true,
    context: { userId: userRow.user_id, email: userRow.email, displayName: userRow.display_name, roles },
  };
}

export type PermissionGuardResult =
  | { ok: true; userId: string; roles: RoleCode[] }
  | { ok: false; response: Response };

/**
 * Shared session+RBAC guard reused by business/documents modules (Etapa 3) so every
 * mutation is authenticated and permission-checked the same way as admin-users.ts/admin-audit.ts.
 */
export async function requireAdminPermission(
  request: Request,
  env: Env,
  permission: Permission
): Promise<PermissionGuardResult> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return { ok: false, response: json({ error: session.error }, session.status) };
  if (!hasPermission(session.context.roles, permission)) {
    return { ok: false, response: json({ error: "forbidden" }, 403) };
  }
  return { ok: true, userId: session.context.userId, roles: session.context.roles };
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!env.DB || !env.ADS_SESSION_SECRET || !env.ADS_PASSWORD_PEPPER) {
    return json({ error: "auth_not_configured" }, 503);
  }
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return json({ error: "invalid_credentials" }, 401);

  const db = env.DB;
  const settings = await loadAdminSettings(db);
  const nowIso = new Date().toISOString();

  const attemptsRes = await db
    .prepare(
      "SELECT success, attempted_at FROM admin_login_attempts WHERE email_normalized = ? ORDER BY attempted_at DESC LIMIT 50"
    )
    .bind(email)
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
        "INSERT INTO admin_login_attempts (attempt_id, email_normalized, attempted_at, success, reason_code) VALUES (?,?,?,?,?)"
      )
      .bind(newId("att"), email, nowIso, success ? 1 : 0, reason)
      .run();
  };

  const userRow = await db
    .prepare("SELECT user_id, email, password_hash, display_name, is_active FROM admin_users WHERE email = ?")
    .bind(email)
    .first<{ user_id: string; email: string; password_hash: string; display_name: string; is_active: number }>();

  if (!userRow || !userRow.is_active) {
    await recordAttempt(false, !userRow ? "no_such_user" : "inactive");
    await insertAuditLog(
      db,
      buildAuditEntry({
        auditId: newId("aud"),
        actorUserId: null,
        operation: "login_failed",
        objectType: "admin_user",
        objectId: email,
        result: "failure",
      })
    );
    return json({ error: "invalid_credentials" }, 401);
  }

  const passwordOk = await verifyPassword(password, env.ADS_PASSWORD_PEPPER, userRow.password_hash);
  if (!passwordOk) {
    await recordAttempt(false, "bad_password");
    await insertAuditLog(
      db,
      buildAuditEntry({
        auditId: newId("aud"),
        actorUserId: userRow.user_id,
        operation: "login_failed",
        objectType: "admin_user",
        objectId: userRow.user_id,
        result: "failure",
      })
    );
    return json({ error: "invalid_credentials" }, 401);
  }

  await recordAttempt(true, null);

  const roles = await loadUserRoles(db, userRow.user_id);
  const sessionId = generateSessionId();
  const tokenHash = await hashOpaqueToken(sessionId);
  const expSeconds = nowSeconds() + settings.sessionTtlSeconds;
  const expiresAtIso = new Date(expSeconds * 1000).toISOString();
  await db
    .prepare("INSERT INTO admin_sessions (session_id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)")
    .bind(sessionId, userRow.user_id, tokenHash, nowIso, expiresAtIso)
    .run();
  await db.prepare("UPDATE admin_users SET last_login_at = ? WHERE user_id = ?").bind(nowIso, userRow.user_id).run();

  const token = await signSessionToken(env.ADS_SESSION_SECRET, { sessionId, exp: expSeconds });
  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: userRow.user_id,
      operation: "login_success",
      objectType: "admin_user",
      objectId: userRow.user_id,
      result: "success",
    })
  );

  const headers = new Headers(NO_STORE);
  headers.append("Set-Cookie", buildSessionCookie(settings.sessionCookieName, token, settings.sessionTtlSeconds));
  return new Response(
    JSON.stringify({
      user: { user_id: userRow.user_id, email: userRow.email, display_name: userRow.display_name, roles },
    }),
    { status: 200, headers }
  );
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const settings = await loadAdminSettings(env.DB);
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[settings.sessionCookieName];
  let actorUserId: string | null = null;

  if (token && env.ADS_SESSION_SECRET && env.DB) {
    const verified = await verifySessionToken(env.ADS_SESSION_SECRET, token);
    if (verified.ok) {
      const tokenHash = await hashOpaqueToken(verified.sessionId);
      const row = await env.DB.prepare("SELECT user_id FROM admin_sessions WHERE session_id = ? AND token_hash = ?")
        .bind(verified.sessionId, tokenHash)
        .first<{ user_id: string }>();
      if (row) actorUserId = row.user_id;
      await env.DB.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL")
        .bind(new Date().toISOString(), verified.sessionId)
        .run();
    }
  }

  if (env.DB) {
    await insertAuditLog(
      env.DB,
      buildAuditEntry({
        auditId: newId("aud"),
        actorUserId,
        operation: "logout",
        objectType: "admin_session",
        objectId: actorUserId || "unknown",
        result: "success",
      })
    );
  }

  const headers = new Headers(NO_STORE);
  headers.append("Set-Cookie", buildExpiredSessionCookie(settings.sessionCookieName));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const result = await requireAdminSession(request, env);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({
    user: {
      user_id: result.context.userId,
      email: result.context.email,
      display_name: result.context.displayName,
      roles: result.context.roles,
    },
  });
}

export async function handlePasswordResetRequest(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (email) {
    const userRow = await env.DB.prepare("SELECT user_id, is_active FROM admin_users WHERE email = ?")
      .bind(email)
      .first<{ user_id: string; is_active: number }>();
    if (userRow && userRow.is_active) {
      const settings = await loadAdminSettings(env.DB);
      const resetToken = generateSessionId();
      const tokenHash = await hashOpaqueToken(resetToken);
      const nowIso = new Date().toISOString();
      const expiresAtIso = new Date(Date.now() + settings.passwordResetTtlSeconds * 1000).toISOString();
      await env.DB.prepare(
        "INSERT INTO admin_password_resets (reset_id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)"
      )
        .bind(newId("rst"), userRow.user_id, tokenHash, nowIso, expiresAtIso)
        .run();
      await insertAuditLog(
        env.DB,
        buildAuditEntry({
          auditId: newId("aud"),
          actorUserId: userRow.user_id,
          operation: "password_reset_requested",
          objectType: "admin_user",
          objectId: userRow.user_id,
          result: "success",
        })
      );
      // NOTE: delivery channel (email/SMS) for the raw reset token is out of Etapa 2 scope;
      // the token is intentionally never returned in this response (would leak).
    }
  }
  // Always uniform — prevents user enumeration regardless of whether the email exists.
  return json({ ok: true });
}

export async function handlePasswordResetConfirm(request: Request, env: Env): Promise<Response> {
  if (!env.DB || !env.ADS_PASSWORD_PEPPER) return json({ error: "auth_not_configured" }, 503);
  let body: { token?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const token = typeof body.token === "string" ? body.token : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!token || !newPassword) return json({ error: "invalid_request" }, 400);

  const settings = await loadAdminSettings(env.DB);
  const strength = validatePasswordStrength(newPassword, settings.passwordMinLength);
  if (!strength.ok) return json({ error: strength.reason }, 400);

  const tokenHash = await hashOpaqueToken(token);
  const resetRow = await env.DB.prepare(
    "SELECT reset_id, user_id, expires_at, used_at FROM admin_password_resets WHERE token_hash = ?"
  )
    .bind(tokenHash)
    .first<{ reset_id: string; user_id: string; expires_at: string; used_at: string | null }>();
  if (!resetRow || resetRow.used_at || new Date(resetRow.expires_at).getTime() <= Date.now()) {
    return json({ error: "invalid_or_expired_token" }, 400);
  }

  const nowIso = new Date().toISOString();
  const passwordHash = await hashPassword(newPassword, env.ADS_PASSWORD_PEPPER, settings.passwordHashIterations);
  await env.DB.prepare("UPDATE admin_users SET password_hash = ?, force_password_change = 0, updated_at = ? WHERE user_id = ?")
    .bind(passwordHash, nowIso, resetRow.user_id)
    .run();
  await env.DB.prepare("UPDATE admin_password_resets SET used_at = ? WHERE reset_id = ?")
    .bind(nowIso, resetRow.reset_id)
    .run();
  await env.DB.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(nowIso, resetRow.user_id)
    .run();
  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: resetRow.user_id,
      operation: "password_reset_confirmed",
      objectType: "admin_user",
      objectId: resetRow.user_id,
      result: "success",
    })
  );
  return json({ ok: true });
}

export async function handleLogoutAllSessions(request: Request, env: Env): Promise<Response> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  const nowIso = new Date().toISOString();
  await env.DB.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(nowIso, session.context.userId)
    .run();
  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: session.context.userId,
      operation: "sessions_revoked_all",
      objectType: "admin_user",
      objectId: session.context.userId,
      result: "success",
    })
  );
  const settings = await loadAdminSettings(env.DB);
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildExpiredSessionCookie(settings.sessionCookieName));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function handlePasswordChange(request: Request, env: Env): Promise<Response> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB || !env.ADS_PASSWORD_PEPPER) return json({ error: "auth_not_configured" }, 503);

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || !newPassword) return json({ error: "invalid_request" }, 400);

  const settings = await loadAdminSettings(env.DB);
  const strength = validatePasswordStrength(newPassword, settings.passwordMinLength);
  if (!strength.ok) return json({ error: strength.reason }, 400);

  const userRow = await env.DB.prepare("SELECT password_hash FROM admin_users WHERE user_id = ?")
    .bind(session.context.userId)
    .first<{ password_hash: string }>();
  if (!userRow) return json({ error: "invalid_request" }, 400);
  const currentOk = await verifyPassword(currentPassword, env.ADS_PASSWORD_PEPPER, userRow.password_hash);
  if (!currentOk) return json({ error: "invalid_current_password" }, 401);

  const nowIso = new Date().toISOString();
  const passwordHash = await hashPassword(newPassword, env.ADS_PASSWORD_PEPPER, settings.passwordHashIterations);
  await env.DB.prepare("UPDATE admin_users SET password_hash = ?, force_password_change = 0, updated_at = ? WHERE user_id = ?")
    .bind(passwordHash, nowIso, session.context.userId)
    .run();
  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: session.context.userId,
      operation: "password_changed",
      objectType: "admin_user",
      objectId: session.context.userId,
      result: "success",
    })
  );
  return json({ ok: true });
}
