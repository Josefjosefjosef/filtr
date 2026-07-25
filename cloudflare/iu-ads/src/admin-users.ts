/**
 * Admin users + roles endpoints (Etapa 2, kap. 4). Restricted to main_admin via RBAC
 * (see rbac.ts) — enforced server-side before any handler here runs.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, normalizeEmail, requireAdminSession, loadUserRoles } from "./admin-auth";
import { DEFAULT_PASSWORD_HASH_ITERATIONS, hashPassword, validatePasswordStrength } from "./password";
import { ROLE_CATALOG, ROLE_CODES, hasPermission, isRoleCode, type RoleCode } from "./rbac";
import type { Env } from "./types";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function requireUsersPermission(
  request: Request,
  env: Env,
  permission: "users.read" | "users.write"
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return { ok: false, response: json({ error: session.error }, session.status) };
  if (!hasPermission(session.context.roles, permission)) {
    return { ok: false, response: json({ error: "forbidden" }, 403) };
  }
  return { ok: true, userId: session.context.userId };
}

type AdminUserDbRow = {
  user_id: string;
  email: string;
  display_name: string;
  is_active: number;
  force_password_change: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

async function toPublicUser(db: D1Database, row: AdminUserDbRow) {
  const roles = await loadUserRoles(db, row.user_id);
  return {
    user_id: row.user_id,
    email: row.email,
    display_name: row.display_name,
    is_active: row.is_active === 1,
    force_password_change: row.force_password_change === 1,
    roles,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Count active users who currently hold main_admin (used to protect the last one). */
async function countActiveMainAdmins(db: D1Database): Promise<number> {
  const res = await db
    .prepare(
      "SELECT COUNT(*) AS c FROM admin_user_roles r INNER JOIN admin_users u ON u.user_id = r.user_id WHERE r.role_code = 'main_admin' AND u.is_active = 1"
    )
    .first<{ c: number }>();
  return Number(res?.c || 0);
}

async function userHasMainAdmin(db: D1Database, userId: string): Promise<boolean> {
  const roles = await loadUserRoles(db, userId);
  return roles.includes("main_admin");
}

export async function handleListUsers(request: Request, env: Env): Promise<Response> {
  const guard = await requireUsersPermission(request, env, "users.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const res = await env.DB.prepare(
    "SELECT user_id, email, display_name, is_active, force_password_change, last_login_at, created_at, updated_at FROM admin_users ORDER BY created_at ASC LIMIT 200"
  ).all<AdminUserDbRow>();
  const rows = res.results || [];
  const users = await Promise.all(rows.map((r) => toPublicUser(env.DB!, r)));
  return json({ users });
}

export async function handleCreateUser(request: Request, env: Env): Promise<Response> {
  const guard = await requireUsersPermission(request, env, "users.write");
  if (!guard.ok) return guard.response;
  if (!env.DB || !env.ADS_PASSWORD_PEPPER) return json({ error: "auth_not_configured" }, 503);

  let body: { email?: unknown; display_name?: unknown; password?: unknown; roles?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const email = normalizeEmail(body.email);
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const roles = Array.isArray(body.roles) ? body.roles.filter(isRoleCode) : [];

  if (!isValidEmail(email)) return json({ error: "invalid_email" }, 400);
  if (!displayName) return json({ error: "invalid_display_name" }, 400);
  if (!roles.length) return json({ error: "invalid_roles" }, 400);

  const strength = validatePasswordStrength(password);
  if (!strength.ok) return json({ error: strength.reason }, 400);

  const existing = await env.DB.prepare("SELECT user_id FROM admin_users WHERE email = ?").bind(email).first();
  if (existing) return json({ error: "email_taken" }, 409);

  const nowIso = new Date().toISOString();
  const userId = newId("usr");
  const passwordHash = await hashPassword(password, env.ADS_PASSWORD_PEPPER, DEFAULT_PASSWORD_HASH_ITERATIONS);

  await env.DB.prepare(
    "INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at) VALUES (?,?,?,?,1,1,?,?)"
  )
    .bind(userId, email, passwordHash, displayName, nowIso, nowIso)
    .run();

  for (const role of roles as RoleCode[]) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by) VALUES (?,?,?,?)"
    )
      .bind(userId, role, nowIso, guard.userId)
      .run();
  }

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "user_created",
      objectType: "admin_user",
      objectId: userId,
      after: { email, display_name: displayName, roles },
      result: "success",
    })
  );

  const row = await env.DB.prepare(
    "SELECT user_id, email, display_name, is_active, force_password_change, last_login_at, created_at, updated_at FROM admin_users WHERE user_id = ?"
  )
    .bind(userId)
    .first<AdminUserDbRow>();
  return json({ user: row ? await toPublicUser(env.DB, row) : null }, 201);
}

export async function handleGetUser(request: Request, env: Env, userId: string): Promise<Response> {
  const guard = await requireUsersPermission(request, env, "users.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare(
    "SELECT user_id, email, display_name, is_active, force_password_change, last_login_at, created_at, updated_at FROM admin_users WHERE user_id = ?"
  )
    .bind(userId)
    .first<AdminUserDbRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ user: await toPublicUser(env.DB, row) });
}

export async function handleUpdateUser(request: Request, env: Env, userId: string): Promise<Response> {
  const guard = await requireUsersPermission(request, env, "users.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { display_name?: unknown; is_active?: unknown; force_password_change?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const before = await env.DB.prepare(
    "SELECT user_id, email, display_name, is_active, force_password_change, last_login_at, created_at, updated_at FROM admin_users WHERE user_id = ?"
  )
    .bind(userId)
    .first<AdminUserDbRow>();
  if (!before) return json({ error: "not_found" }, 404);

  const displayName = typeof body.display_name === "string" && body.display_name.trim() ? body.display_name.trim() : before.display_name;
  const isActive = typeof body.is_active === "boolean" ? (body.is_active ? 1 : 0) : before.is_active;
  const forcePasswordChange =
    typeof body.force_password_change === "boolean" ? (body.force_password_change ? 1 : 0) : before.force_password_change;

  // Never deactivate the last active main_admin.
  if (isActive === 0 && before.is_active === 1 && (await userHasMainAdmin(env.DB, userId))) {
    const mainCount = await countActiveMainAdmins(env.DB);
    if (mainCount <= 1) return json({ error: "last_main_admin" }, 409);
  }

  const nowIso = new Date().toISOString();
  const deactivatedAt = isActive === 0 && before.is_active === 1 ? nowIso : isActive === 1 ? null : undefined;

  if (deactivatedAt !== undefined) {
    await env.DB.prepare(
      "UPDATE admin_users SET display_name = ?, is_active = ?, force_password_change = ?, updated_at = ?, deactivated_at = ? WHERE user_id = ?"
    )
      .bind(displayName, isActive, forcePasswordChange, nowIso, deactivatedAt, userId)
      .run();
  } else {
    await env.DB.prepare(
      "UPDATE admin_users SET display_name = ?, is_active = ?, force_password_change = ?, updated_at = ? WHERE user_id = ?"
    )
      .bind(displayName, isActive, forcePasswordChange, nowIso, userId)
      .run();
  }

  if (isActive === 0) {
    await env.DB.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(nowIso, userId)
      .run();
  }

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "user_updated",
      objectType: "admin_user",
      objectId: userId,
      before: { display_name: before.display_name, is_active: before.is_active === 1, force_password_change: before.force_password_change === 1 },
      after: { display_name: displayName, is_active: isActive === 1, force_password_change: forcePasswordChange === 1 },
      result: "success",
    })
  );

  const after = await env.DB.prepare(
    "SELECT user_id, email, display_name, is_active, force_password_change, last_login_at, created_at, updated_at FROM admin_users WHERE user_id = ?"
  )
    .bind(userId)
    .first<AdminUserDbRow>();
  return json({ user: after ? await toPublicUser(env.DB, after) : null });
}

export async function handleSetUserRoles(request: Request, env: Env, userId: string): Promise<Response> {
  const guard = await requireUsersPermission(request, env, "users.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { roles?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const roles = Array.isArray(body.roles) ? body.roles : [];
  if (!roles.length || !roles.every(isRoleCode)) return json({ error: "invalid_roles" }, 400);

  const userRow = await env.DB.prepare("SELECT user_id FROM admin_users WHERE user_id = ?").bind(userId).first();
  if (!userRow) return json({ error: "not_found" }, 404);

  const before = await loadUserRoles(env.DB, userId);
  const nextRoles = roles as RoleCode[];
  const removingMain = before.includes("main_admin") && !nextRoles.includes("main_admin");
  if (removingMain) {
    const active = await env.DB.prepare("SELECT is_active FROM admin_users WHERE user_id = ?")
      .bind(userId)
      .first<{ is_active: number }>();
    if (active && active.is_active === 1) {
      const mainCount = await countActiveMainAdmins(env.DB);
      if (mainCount <= 1) return json({ error: "last_main_admin" }, 409);
    }
  }

  const nowIso = new Date().toISOString();

  await env.DB.prepare("DELETE FROM admin_user_roles WHERE user_id = ?").bind(userId).run();
  for (const role of nextRoles) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by) VALUES (?,?,?,?)"
    )
      .bind(userId, role, nowIso, guard.userId)
      .run();
  }

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "user_roles_updated",
      objectType: "admin_user",
      objectId: userId,
      before: { roles: before },
      after: { roles: nextRoles },
      result: "success",
    })
  );

  return json({ user_id: userId, roles: nextRoles });
}

export async function handleListRoles(request: Request, env: Env): Promise<Response> {
  const guard = await requireUsersPermission(request, env, "users.read");
  if (!guard.ok) return guard.response;
  return json({ roles: ROLE_CATALOG, role_codes: ROLE_CODES });
}
