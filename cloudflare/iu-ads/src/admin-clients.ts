/**
 * Admin clients + contacts endpoints (Etapa 3, kap. 15). RBAC: clients.read/clients.write
 * (sales/main_admin) — enforced server-side via requireAdminPermission (see admin-auth.ts).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

type ClientRow = {
  client_id: string;
  company_name: string;
  ico: string | null;
  dic: string | null;
  address: string | null;
  billing_info: string | null;
  notes_internal: string | null;
  created_at: string;
  updated_at: string;
  first_cooperation_at: string | null;
  last_cooperation_at: string | null;
};

type ClientContactRow = {
  contact_id: string;
  client_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_label: string | null;
  is_primary: number;
  created_at: string;
};

const CLIENT_COLUMNS =
  "client_id, company_name, ico, dic, address, billing_info, notes_internal, created_at, updated_at, first_cooperation_at, last_cooperation_at";
const CONTACT_COLUMNS = "contact_id, client_id, full_name, email, phone, role_label, is_primary, created_at";

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

async function loadContacts(db: D1Database, clientId: string): Promise<ClientContactRow[]> {
  const res = await db
    .prepare("SELECT " + CONTACT_COLUMNS + " FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, created_at ASC")
    .bind(clientId)
    .all<ClientContactRow>();
  return res.results || [];
}

function serializeClient(row: ClientRow, contacts?: ClientContactRow[]) {
  return {
    client_id: row.client_id,
    company_name: row.company_name,
    ico: row.ico,
    dic: row.dic,
    address: row.address,
    billing_info: row.billing_info,
    notes_internal: row.notes_internal,
    created_at: row.created_at,
    updated_at: row.updated_at,
    first_cooperation_at: row.first_cooperation_at,
    last_cooperation_at: row.last_cooperation_at,
    contacts: contacts
      ? contacts.map((c) => ({
          contact_id: c.contact_id,
          full_name: c.full_name,
          email: c.email,
          phone: c.phone,
          role_label: c.role_label,
          is_primary: c.is_primary === 1,
          created_at: c.created_at,
        }))
      : undefined,
  };
}

export async function handleListClients(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "clients.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const search = (url.searchParams.get("q") || "").trim();
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const sql = search
    ? "SELECT " + CLIENT_COLUMNS + " FROM clients WHERE company_name LIKE ? ORDER BY company_name ASC LIMIT ? OFFSET ?"
    : "SELECT " + CLIENT_COLUMNS + " FROM clients ORDER BY company_name ASC LIMIT ? OFFSET ?";
  const stmt = search ? env.DB.prepare(sql).bind("%" + search + "%", limit, offset) : env.DB.prepare(sql).bind(limit, offset);
  const res = await stmt.all<ClientRow>();
  const rows = res.results || [];
  return json({ clients: rows.map((r) => serializeClient(r)), limit, offset });
}

export async function handleCreateClient(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "clients.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: {
    company_name?: unknown;
    ico?: unknown;
    dic?: unknown;
    address?: unknown;
    billing_info?: unknown;
    notes_internal?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const companyName = typeof body.company_name === "string" ? body.company_name.trim() : "";
  if (!companyName) return json({ error: "invalid_company_name" }, 400);

  const nowIso = new Date().toISOString();
  const clientId = newId("cli");
  await env.DB.prepare(
    "INSERT INTO clients (client_id, company_name, ico, dic, address, billing_info, notes_internal, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      clientId,
      companyName,
      typeof body.ico === "string" ? body.ico.trim() || null : null,
      typeof body.dic === "string" ? body.dic.trim() || null : null,
      typeof body.address === "string" ? body.address.trim() || null : null,
      typeof body.billing_info === "string" ? body.billing_info.trim() || null : null,
      typeof body.notes_internal === "string" ? body.notes_internal.trim() || null : null,
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "client_created",
      objectType: "client",
      objectId: clientId,
      after: { company_name: companyName },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + CLIENT_COLUMNS + " FROM clients WHERE client_id = ?")
    .bind(clientId)
    .first<ClientRow>();
  return json({ client: row ? serializeClient(row, []) : null }, 201);
}

export async function handleGetClient(request: Request, env: Env, clientId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "clients.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + CLIENT_COLUMNS + " FROM clients WHERE client_id = ?")
    .bind(clientId)
    .first<ClientRow>();
  if (!row) return json({ error: "not_found" }, 404);
  const contacts = await loadContacts(env.DB, clientId);
  return json({ client: serializeClient(row, contacts) });
}

export async function handleUpdateClient(request: Request, env: Env, clientId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "clients.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + CLIENT_COLUMNS + " FROM clients WHERE client_id = ?")
    .bind(clientId)
    .first<ClientRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: {
    company_name?: unknown;
    ico?: unknown;
    dic?: unknown;
    address?: unknown;
    billing_info?: unknown;
    notes_internal?: unknown;
    first_cooperation_at?: unknown;
    last_cooperation_at?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const companyName = typeof body.company_name === "string" && body.company_name.trim() ? body.company_name.trim() : before.company_name;
  const ico = typeof body.ico === "string" ? body.ico.trim() || null : before.ico;
  const dic = typeof body.dic === "string" ? body.dic.trim() || null : before.dic;
  const address = typeof body.address === "string" ? body.address.trim() || null : before.address;
  const billingInfo = typeof body.billing_info === "string" ? body.billing_info.trim() || null : before.billing_info;
  const notesInternal = typeof body.notes_internal === "string" ? body.notes_internal.trim() || null : before.notes_internal;
  const firstCoop = typeof body.first_cooperation_at === "string" ? body.first_cooperation_at : before.first_cooperation_at;
  const lastCoop = typeof body.last_cooperation_at === "string" ? body.last_cooperation_at : before.last_cooperation_at;
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE clients SET company_name = ?, ico = ?, dic = ?, address = ?, billing_info = ?, notes_internal = ?, first_cooperation_at = ?, last_cooperation_at = ?, updated_at = ? WHERE client_id = ?"
  )
    .bind(companyName, ico, dic, address, billingInfo, notesInternal, firstCoop, lastCoop, nowIso, clientId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "client_updated",
      objectType: "client",
      objectId: clientId,
      before: { company_name: before.company_name, notes_internal: before.notes_internal },
      after: { company_name: companyName, notes_internal: notesInternal },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + CLIENT_COLUMNS + " FROM clients WHERE client_id = ?")
    .bind(clientId)
    .first<ClientRow>();
  return json({ client: after ? serializeClient(after) : null });
}

export async function handleCreateClientContact(request: Request, env: Env, clientId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "clients.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const clientRow = await env.DB.prepare("SELECT client_id FROM clients WHERE client_id = ?").bind(clientId).first();
  if (!clientRow) return json({ error: "not_found" }, 404);

  let body: { full_name?: unknown; email?: unknown; phone?: unknown; role_label?: unknown; is_primary?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (!fullName) return json({ error: "invalid_full_name" }, 400);
  const isPrimary = body.is_primary === true;

  const nowIso = new Date().toISOString();
  const contactId = newId("con");
  if (isPrimary) {
    await env.DB.prepare("UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?").bind(clientId).run();
  }
  await env.DB.prepare(
    "INSERT INTO client_contacts (contact_id, client_id, full_name, email, phone, role_label, is_primary, created_at) VALUES (?,?,?,?,?,?,?,?)"
  )
    .bind(
      contactId,
      clientId,
      fullName,
      typeof body.email === "string" ? body.email.trim() || null : null,
      typeof body.phone === "string" ? body.phone.trim() || null : null,
      typeof body.role_label === "string" ? body.role_label.trim() || null : null,
      isPrimary ? 1 : 0,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "client_contact_created",
      objectType: "client_contact",
      objectId: contactId,
      after: { client_id: clientId, full_name: fullName },
      result: "success",
    })
  );

  const contacts = await loadContacts(env.DB, clientId);
  return json({ contacts: contacts.map((c) => ({ ...c, is_primary: c.is_primary === 1 })) }, 201);
}

export async function handleUpdateClientContact(
  request: Request,
  env: Env,
  clientId: string,
  contactId: string
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "clients.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + CONTACT_COLUMNS + " FROM client_contacts WHERE contact_id = ? AND client_id = ?")
    .bind(contactId, clientId)
    .first<ClientContactRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: { full_name?: unknown; email?: unknown; phone?: unknown; role_label?: unknown; is_primary?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const fullName = typeof body.full_name === "string" && body.full_name.trim() ? body.full_name.trim() : before.full_name;
  const email = typeof body.email === "string" ? body.email.trim() || null : before.email;
  const phone = typeof body.phone === "string" ? body.phone.trim() || null : before.phone;
  const roleLabel = typeof body.role_label === "string" ? body.role_label.trim() || null : before.role_label;
  const isPrimary = typeof body.is_primary === "boolean" ? body.is_primary : before.is_primary === 1;

  if (isPrimary) {
    await env.DB.prepare("UPDATE client_contacts SET is_primary = 0 WHERE client_id = ? AND contact_id != ?")
      .bind(clientId, contactId)
      .run();
  }
  await env.DB.prepare(
    "UPDATE client_contacts SET full_name = ?, email = ?, phone = ?, role_label = ?, is_primary = ? WHERE contact_id = ?"
  )
    .bind(fullName, email, phone, roleLabel, isPrimary ? 1 : 0, contactId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "client_contact_updated",
      objectType: "client_contact",
      objectId: contactId,
      before: { full_name: before.full_name },
      after: { full_name: fullName },
      result: "success",
    })
  );

  const contacts = await loadContacts(env.DB, clientId);
  return json({ contacts: contacts.map((c) => ({ ...c, is_primary: c.is_primary === 1 })) });
}

export async function handleDeleteClientContact(
  request: Request,
  env: Env,
  clientId: string,
  contactId: string
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "clients.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT contact_id FROM client_contacts WHERE contact_id = ? AND client_id = ?")
    .bind(contactId, clientId)
    .first();
  if (!before) return json({ error: "not_found" }, 404);

  await env.DB.prepare("DELETE FROM client_contacts WHERE contact_id = ?").bind(contactId).run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "client_contact_deleted",
      objectType: "client_contact",
      objectId: contactId,
      before: { client_id: clientId },
      result: "success",
    })
  );

  return json({ ok: true });
}
