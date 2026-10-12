import type { DatabaseSync } from "node:sqlite";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../../src/session";

export const TEST_ADMIN_SESSION_SECRET = "test-session-secret-not-for-prod";

export async function seedAdminUserWithSession(
  sqlite: DatabaseSync,
  opts: { userId: string; roles: string[]; secret?: string }
): Promise<{ token: string; cookieHeader: string }> {
  const now = new Date().toISOString();
  const secret = opts.secret ?? TEST_ADMIN_SESSION_SECRET;
  sqlite
    .prepare(
      `INSERT INTO admin_users (
         user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at
       ) VALUES (?, ?, 'hash-not-used', ?, 1, 0, ?, ?)`
    )
    .run(opts.userId, opts.userId + "@example.test", "Integration Admin", now, now);
  for (const role of opts.roles) {
    sqlite
      .prepare(`INSERT INTO admin_user_roles (user_id, role_code, assigned_at) VALUES (?, ?, ?)`)
      .run(opts.userId, role, now);
  }
  const sessionId = generateSessionId();
  const tokenHash = await hashOpaqueToken(sessionId);
  const exp = nowSeconds() + 3600;
  const expiresAt = new Date(exp * 1000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO admin_sessions (
         session_id, user_id, token_hash, created_at, expires_at, revoked_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(sessionId, opts.userId, tokenHash, now, expiresAt, now);
  const token = await signSessionToken(secret, { sessionId, exp });
  return { token, cookieHeader: "iu_ads_admin_session=" + token };
}

export function adminJsonRequest(
  url: string,
  cookieHeader: string | null,
  init: { method: string; body?: unknown } = { method: "GET" }
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookieHeader) headers.Cookie = cookieHeader;
  return new Request(url, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
