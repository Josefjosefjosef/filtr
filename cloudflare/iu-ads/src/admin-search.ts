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

type SearchHit = {
  entity: string;
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

export async function handleAdminSearch(request: Request, env: Env, url: URL): Promise<Response> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return json({ error: "query_too_short", min: 2 }, 400);
  if (q.length > 120) return json({ error: "query_too_long", max: 120 }, 400);

  const limit = clampLimit(url.searchParams.get("limit"), 20, 50);
  const pattern = likeContains(q);
  const roles = session.context.roles;
  const results: SearchHit[] = [];

  if (hasPermission(roles, "clients.read")) {
    const res = await env.DB.prepare(
      "SELECT client_id, company_name, ico FROM clients WHERE company_name LIKE ? OR IFNULL(ico,'') LIKE ? ORDER BY company_name ASC LIMIT ?"
    )
      .bind(pattern, pattern, limit)
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

  if (hasPermission(roles, "campaigns.read")) {
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

  if (hasPermission(roles, "invoices.read")) {
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

  if (hasPermission(roles, "documents.read")) {
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

  const body = { q, results, count: results.length };
  const leaks = assertNoSecrets(body);
  if (leaks.length) return json({ error: "isolation_violation", leaks }, 500);
  return json(body);
}
