/**
 * One-time main_admin bootstrap via D1 Workers API `batch()` (atomic).
 * Not reachable without ADS_BOOTSTRAP_TOKEN. Public ads / SAFE_MODE unrelated.
 */
import { hashPassword } from "./password";
import { hashOpaqueToken } from "./session";
import type { Env } from "./types";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE });
}

export function newId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "");
}

export function normalizeEmail(email: unknown): string {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Constant-time-ish compare for bootstrap bearer tokens (same length required). */
export function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function randomTokenHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < buf.length; i++) s += buf[i].toString(16).padStart(2, "0");
  return s;
}

export const BOOTSTRAP_LOCK_KEY = "BOOTSTRAP_LOCK";
export const BOOTSTRAP_COMPLETED_KEY = "BOOTSTRAP_COMPLETED";
/** Stale lock older than this may be cleared when COMPLETED is unset (minutes). */
export const BOOTSTRAP_LOCK_STALE_MS = 30 * 60 * 1000;

export type BootstrapConsistency = {
  users: number;
  mainAdminRoles: number;
  unusedResets: number;
  orphanRoles: number;
  usersWithoutRoles: number;
  bootstrapCompleted: boolean;
  lockPresent: boolean;
  lockUpdatedAt: string | null;
  consistent: boolean;
  reason: string;
};

export async function readBootstrapConsistency(db: D1Database): Promise<BootstrapConsistency> {
  const usersRow = await db.prepare("SELECT COUNT(*) AS cnt FROM admin_users").first<{ cnt: number }>();
  const mainRow = await db
    .prepare("SELECT COUNT(*) AS cnt FROM admin_user_roles WHERE role_code = 'main_admin'")
    .first<{ cnt: number }>();
  const unusedResetsRow = await db
    .prepare("SELECT COUNT(*) AS cnt FROM admin_password_resets WHERE used_at IS NULL")
    .first<{ cnt: number }>();
  const orphanRolesRow = await db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM admin_user_roles r LEFT JOIN admin_users u ON u.user_id = r.user_id WHERE u.user_id IS NULL"
    )
    .first<{ cnt: number }>();
  const usersWithoutRolesRow = await db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM admin_users u LEFT JOIN admin_user_roles r ON r.user_id = u.user_id WHERE r.user_id IS NULL"
    )
    .first<{ cnt: number }>();
  const completedRow = await db
    .prepare("SELECT value FROM system_settings WHERE key = ?")
    .bind(BOOTSTRAP_COMPLETED_KEY)
    .first<{ value: string }>();
  const lockRow = await db
    .prepare("SELECT value, updated_at FROM system_settings WHERE key = ?")
    .bind(BOOTSTRAP_LOCK_KEY)
    .first<{ value: string; updated_at: string }>();

  const users = Number(usersRow?.cnt || 0);
  const mainAdminRoles = Number(mainRow?.cnt || 0);
  const unusedResets = Number(unusedResetsRow?.cnt || 0);
  const orphanRoles = Number(orphanRolesRow?.cnt || 0);
  const usersWithoutRoles = Number(usersWithoutRolesRow?.cnt || 0);
  const bootstrapCompleted = completedRow?.value === "1";
  const lockPresent = !!lockRow;
  const lockUpdatedAt = lockRow?.updated_at || null;

  let consistent = true;
  let reason = "ok";
  if (orphanRoles > 0) {
    consistent = false;
    reason = "orphan_roles";
  } else if (usersWithoutRoles > 0) {
    consistent = false;
    reason = "users_without_roles";
  } else if (mainAdminRoles > 0 && users === 0) {
    consistent = false;
    reason = "main_admin_without_users";
  } else if (unusedResets > 0 && users === 0) {
    consistent = false;
    reason = "unused_resets_without_users";
  } else if (bootstrapCompleted && mainAdminRoles === 0) {
    consistent = false;
    reason = "completed_without_main_admin";
  } else if (mainAdminRoles > 1) {
    consistent = false;
    reason = "multiple_main_admin";
  }

  return {
    users,
    mainAdminRoles,
    unusedResets,
    orphanRoles,
    usersWithoutRoles,
    bootstrapCompleted,
    lockPresent,
    lockUpdatedAt,
    consistent,
    reason,
  };
}

export type BootstrapSeedResult =
  | {
      ok: true;
      userId: string;
      email: string;
      activationToken: string;
      expiresAt: string;
      activationPath: string;
    }
  | { ok: false; error: string; status: number };

/**
 * Atomically seed first main_admin using D1 batch(). Caller must authorize via ADS_BOOTSTRAP_TOKEN.
 */
export async function seedMainAdminAtomic(
  db: D1Database,
  pepper: string,
  input: { email: string; displayName: string; ttlSeconds: number; basePath?: string }
): Promise<BootstrapSeedResult> {
  const email = normalizeEmail(input.email);
  if (!email || !isValidEmail(email)) return { ok: false, error: "invalid_email", status: 400 };
  const ttl = Number(input.ttlSeconds);
  if (!Number.isFinite(ttl) || ttl < 300 || ttl > 86400) {
    return { ok: false, error: "invalid_ttl", status: 400 };
  }

  const before = await readBootstrapConsistency(db);
  if (before.bootstrapCompleted) return { ok: false, error: "bootstrap_completed", status: 409 };
  if (before.mainAdminRoles > 0) return { ok: false, error: "main_admin_exists", status: 409 };
  if (before.users > 0) return { ok: false, error: "users_already_exist", status: 409 };
  if (!before.consistent) return { ok: false, error: "inconsistent_state:" + before.reason, status: 409 };

  const now = Date.now();
  if (before.lockPresent) {
    const lockMs = before.lockUpdatedAt ? Date.parse(before.lockUpdatedAt) : NaN;
    const stale = Number.isFinite(lockMs) && now - lockMs > BOOTSTRAP_LOCK_STALE_MS;
    if (!stale) return { ok: false, error: "bootstrap_lock_held", status: 409 };
    await db.prepare("DELETE FROM system_settings WHERE key = ?").bind(BOOTSTRAP_LOCK_KEY).run();
  }

  const runId = randomTokenHex(16);
  const nowIso = new Date(now).toISOString();
  // Exclusive lock: plain INSERT fails if key already exists (concurrent bootstrap).
  try {
    await db
      .prepare("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)")
      .bind(BOOTSTRAP_LOCK_KEY, runId, nowIso)
      .run();
  } catch {
    return { ok: false, error: "bootstrap_lock_race", status: 409 };
  }

  const lockCheck = await db
    .prepare("SELECT value FROM system_settings WHERE key = ?")
    .bind(BOOTSTRAP_LOCK_KEY)
    .first<{ value: string }>();
  if (!lockCheck || lockCheck.value !== runId) {
    return { ok: false, error: "bootstrap_lock_race", status: 409 };
  }

  // Re-read after lock (TOCTOU).
  const mid = await readBootstrapConsistency(db);
  if (!mid.consistent || mid.bootstrapCompleted || mid.mainAdminRoles > 0 || mid.users > 0) {
    await db.prepare("DELETE FROM system_settings WHERE key = ? AND value = ?").bind(BOOTSTRAP_LOCK_KEY, runId).run();
    return { ok: false, error: "precheck_failed_after_lock", status: 409 };
  }

  const userId = newId("usr");
  const resetId = newId("rst");
  const auditId = newId("aud");
  const expiresIso = new Date(now + ttl * 1000).toISOString();
  const throwawayPassword = randomTokenHex(32) + "A1!" + randomTokenHex(16);
  const passwordHash = await hashPassword(throwawayPassword, pepper, 100_000);
  const activationToken = randomTokenHex(32);
  const tokenHash = await hashOpaqueToken(activationToken);
  const displayName = String(input.displayName || "Hlavní administrátor").slice(0, 120);
  const afterJson = JSON.stringify({
    email,
    role: "main_admin",
    activation: "one_time_token",
    ttl_seconds: ttl,
  });

  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at) VALUES (?,?,?,?,1,1,?,?)"
        )
        .bind(userId, email, passwordHash, displayName, nowIso, nowIso),
      db
        .prepare("INSERT INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by) VALUES (?,?,?,?)")
        .bind(userId, "main_admin", nowIso, "bootstrap"),
      db
        .prepare(
          "INSERT INTO admin_password_resets (reset_id, user_id, token_hash, created_at, expires_at, used_at) VALUES (?,?,?,?,?,NULL)"
        )
        .bind(resetId, userId, tokenHash, nowIso, expiresIso),
      db
        .prepare(
          "INSERT INTO audit_logs (audit_id, created_at, actor_user_id, operation, object_type, object_id, before_json, after_json, result) VALUES (?,?,?,?,?,?,NULL,?,?)"
        )
        .bind(auditId, nowIso, userId, "main_admin_bootstrap_created", "admin_user", userId, afterJson, "success"),
      db
        .prepare(
          "INSERT INTO system_settings (key, value, updated_at) VALUES (?, '1', ?) ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at"
        )
        .bind(BOOTSTRAP_COMPLETED_KEY, nowIso),
      db.prepare("DELETE FROM system_settings WHERE key = ?").bind(BOOTSTRAP_LOCK_KEY),
    ]);
    // Idempotent lock clear if batch unlock was skipped by an older runtime.
    await db.prepare("DELETE FROM system_settings WHERE key = ?").bind(BOOTSTRAP_LOCK_KEY).run();
  } catch {
    // Best-effort unlock; batch should have rolled back writes.
    try {
      await db.prepare("DELETE FROM system_settings WHERE key = ? AND value = ?").bind(BOOTSTRAP_LOCK_KEY, runId).run();
    } catch {
      /* ignore */
    }
    return { ok: false, error: "batch_failed", status: 500 };
  }

  const after = await readBootstrapConsistency(db);
  if (
    !after.consistent ||
    !after.bootstrapCompleted ||
    after.mainAdminRoles !== 1 ||
    after.users !== 1 ||
    after.unusedResets < 1 ||
    after.usersWithoutRoles !== 0 ||
    after.orphanRoles !== 0
  ) {
    return { ok: false, error: "readback_inconsistent:" + after.reason, status: 500 };
  }

  const roleOk = await db
    .prepare("SELECT 1 AS ok FROM admin_user_roles WHERE user_id = ? AND role_code = 'main_admin'")
    .bind(userId)
    .first<{ ok: number }>();
  const resetOk = await db
    .prepare("SELECT 1 AS ok FROM admin_password_resets WHERE reset_id = ? AND user_id = ? AND used_at IS NULL")
    .bind(resetId, userId)
    .first<{ ok: number }>();
  if (!roleOk || !resetOk) {
    return { ok: false, error: "readback_missing_links", status: 500 };
  }

  const basePath = (input.basePath || "/admin").replace(/\/$/, "") || "/admin";
  return {
    ok: true,
    userId,
    email,
    activationToken,
    expiresAt: expiresIso,
    activationPath: basePath + "?activate=" + encodeURIComponent(activationToken) + "&email=" + encodeURIComponent(email),
  };
}

export async function handleBootstrapMainAdmin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ error: "db_unavailable" }, 503);
  if (!env.ADS_PASSWORD_PEPPER) return json({ error: "auth_not_configured" }, 503);
  const expected = env.ADS_BOOTSTRAP_TOKEN || "";
  if (!expected) return json({ error: "bootstrap_token_not_configured" }, 503);

  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const presented = m ? m[1].trim() : "";
  if (!presented || !safeEqualString(presented, expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { email?: unknown; displayName?: unknown; ttlSeconds?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const origin = new URL(request.url).origin;
  const result = await seedMainAdminAtomic(env.DB, env.ADS_PASSWORD_PEPPER, {
    email: typeof body.email === "string" ? body.email : "",
    displayName: typeof body.displayName === "string" ? body.displayName : "Hlavní administrátor",
    ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : Number(body.ttlSeconds || 3600),
    basePath: "/admin",
  });

  if (!result.ok) return json({ error: result.error }, result.status);

  // Activation URL only in response body — callers must not log it.
  return json({
    ok: true,
    email: result.email,
    userIdPrefix: result.userId.slice(0, 8),
    expiresAt: result.expiresAt,
    activationUrl: origin + result.activationPath,
  });
}

/** Reject SQL that uses unsupported remote D1 txn statements (guard for generators). */
export function assertBootstrapSqlHasNoExplicitTxn(sql: string): { ok: true } | { ok: false; reason: string } {
  const upper = String(sql || "").toUpperCase();
  if (/\bBEGIN\b/.test(upper) || /\bCOMMIT\b/.test(upper) || /\bROLLBACK\b/.test(upper) || /\bSAVEPOINT\b/.test(upper)) {
    return { ok: false, reason: "unsupported_explicit_sql_transaction" };
  }
  return { ok: true };
}
