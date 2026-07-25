/**
 * Cross-entity admin search (Etapa 8, kap. 16). Role-scoped; NEVER returns plaintext client
 * codes, password hashes, secrets, r2_key, or internal notes dumps.
 */
import { json, requireAdminSession } from "./admin-auth";
import { clampLimit, likeContains } from "./admin-list-filters";
import { hasPermission } from "./rbac";
import type { Env } from "./types";

const FORBIDDEN_SEARCH_KEYS = [
  "code_hash",
  "password_hash",
  "access_code",
  "plaintext",
  "pepper",
  "secret",
  "token",
  "r2_key",
  "content_hash",
] as const;

const ENTITY_FILTERS = [
  "client",
  "campaign",
  "order",
  "contract",
  "invoice",
  "document",
  "code",
] as const;
type EntityFilter = (typeof ENTITY_FILTERS)[number];

export type SearchHit = {
  entity: EntityFilter;
  id: string;
  label: string;
  meta?: Record<string, string | null>;
};

function collectKeys(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.add(k.toLowerCase());
    collectKeys(v, out);
  }
}

function assertNoSecrets(payload: unknown): string[] {
  const keys = new Set<string>();
  collectKeys(payload, keys);
  const leaks: string[] = [];
  for (const key of FORBIDDEN_SEARCH_KEYS) {
    if (keys.has(key)) leaks.push(key);
  }
  return leaks;
}

function parseEntityFilter(raw: string | null): EntityFilter | "all" {
  if (!raw || raw === "all") return "all";
  return (ENTITY_FILTERS as readonly string[]).includes(raw) ? (raw as EntityFilter) : "all";
}

function wants(entity: EntityFilter, filter: EntityFilter | "all"): boolean {
  return filter === "all" || filter === entity;
}

export async function handleAdminSearch(request: Request, env: Env, url: URL): Promise<Response> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return json({ error: "query_too_short", min: 2 }, 400);
  if (q.length > 120) return json({ error: "query_too_long", max: 120 }, 400);

  const limit = clampLimit(url.searchParams.get("limit"), 20, 50);
  const entity = parseEntityFilter(url.searchParams.get("entity"));
  const pattern = likeContains(q);
  const roles = session.context.roles;
  const results: SearchHit[] = [];

  if (wants("client", entity) && hasPermission(roles, "clients.read")) {
    const res = await env.DB.prepare(
      "SELECT client_id, company_name, ico FROM clients WHERE company_name LIKE ? OR IFNULL(ico,'') LIKE ? OR client_id LIKE ? ORDER BY company_name ASC LIMIT ?"
    )
      .bind(pattern, pattern, pattern, limit)
      .all<{ client_id: string; company_name: string; ico: string | null }>();
    for (const row of res.results || []) {
      results.push({
        entity: "client",
        id: row.client_id,
        label: row.company_name,
        meta: { ico: row.ico },
      });
    }
  }

  if (wants("campaign", entity) && hasPermission(roles, "campaigns.read")) {
    const res = await env.DB.prepare(
      "SELECT campaign_id, title, evidence_code, status FROM campaigns WHERE title LIKE ? OR evidence_code LIKE ? OR campaign_id LIKE ? ORDER BY updated_at DESC LIMIT ?"
    )
      .bind(pattern, pattern, pattern, limit)
      .all<{ campaign_id: string; title: string; evidence_code: string; status: string }>();
    for (const row of res.results || []) {
      results.push({
        entity: "campaign",
        id: row.campaign_id,
        label: row.title,
        meta: { evidence_code: row.evidence_code, status: row.status },
      });
    }
  }

  if (wants("order", entity) && hasPermission(roles, "orders.read")) {
    const res = await env.DB.prepare(
      "SELECT order_id, order_number, status, client_id FROM orders WHERE order_number LIKE ? OR order_id LIKE ? ORDER BY created_at DESC LIMIT ?"
    )
      .bind(pattern, pattern, limit)
      .all<{ order_id: string; order_number: string; status: string; client_id: string }>();
    for (const row of res.results || []) {
      results.push({
        entity: "order",
        id: row.order_id,
        label: row.order_number,
        meta: { status: row.status, client_id: row.client_id },
      });
    }
  }

  if (wants("contract", entity) && hasPermission(roles, "contracts.read")) {
    const res = await env.DB.prepare(
      "SELECT contract_id, contract_number, status, client_id FROM contracts WHERE contract_number LIKE ? OR contract_id LIKE ? ORDER BY created_at DESC LIMIT ?"
    )
      .bind(pattern, pattern, limit)
      .all<{ contract_id: string; contract_number: string; status: string; client_id: string }>();
    for (const row of res.results || []) {
      results.push({
        entity: "contract",
        id: row.contract_id,
        label: row.contract_number,
        meta: { status: row.status, client_id: row.client_id },
      });
    }
  }

  if (wants("invoice", entity) && hasPermission(roles, "invoices.read")) {
    const res = await env.DB.prepare(
      "SELECT invoice_id, invoice_number, status, client_id FROM invoices WHERE invoice_number LIKE ? OR IFNULL(variable_symbol,'') LIKE ? OR invoice_id LIKE ? ORDER BY created_at DESC LIMIT ?"
    )
      .bind(pattern, pattern, pattern, limit)
      .all<{ invoice_id: string; invoice_number: string; status: string; client_id: string }>();
    for (const row of res.results || []) {
      results.push({
        entity: "invoice",
        id: row.invoice_id,
        label: row.invoice_number,
        meta: { status: row.status, client_id: row.client_id },
      });
    }
  }

  if (wants("document", entity) && hasPermission(roles, "documents.read")) {
    const res = await env.DB.prepare(
      "SELECT document_id, title, doc_type, visibility, status FROM documents WHERE title LIKE ? OR document_id LIKE ? ORDER BY updated_at DESC LIMIT ?"
    )
      .bind(pattern, pattern, limit)
      .all<{
        document_id: string;
        title: string;
        doc_type: string;
        visibility: string;
        status: string;
      }>();
    for (const row of res.results || []) {
      results.push({
        entity: "document",
        id: row.document_id,
        label: row.title,
        meta: { doc_type: row.doc_type, visibility: row.visibility, status: row.status },
      });
    }
  }

  // Codes: search by prefix / code_id / client_id only — never by plaintext or hash.
  if (wants("code", entity) && hasPermission(roles, "codes.read")) {
    const res = await env.DB.prepare(
      "SELECT code_id, client_id, code_prefix, status, expires_at FROM client_access_codes WHERE IFNULL(code_prefix,'') LIKE ? OR code_id LIKE ? OR client_id LIKE ? ORDER BY created_at DESC LIMIT ?"
    )
      .bind(pattern, pattern, pattern, limit)
      .all<{
        code_id: string;
        client_id: string;
        code_prefix: string | null;
        status: string;
        expires_at: string | null;
      }>();
    for (const row of res.results || []) {
      results.push({
        entity: "code",
        id: row.code_id,
        label: row.code_prefix ? "Kód " + row.code_prefix + "…" : row.code_id,
        meta: { client_id: row.client_id, status: row.status, expires_at: row.expires_at },
      });
    }
  }

  const body = {
    q,
    entity,
    results,
    count: results.length,
    empty: results.length === 0,
    entities: ENTITY_FILTERS,
  };
  const leaks = assertNoSecrets(body);
  if (leaks.length) return json({ error: "isolation_violation", leaks }, 500);
  return json(body);
}
