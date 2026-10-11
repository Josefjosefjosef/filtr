/**
 * Admin search suggest (company names / IČO) for reklamní objednávky.
 */
import { json, requireAdminSession } from "./admin-auth";
import { hasPermission } from "./rbac";
import type { Env } from "./types";

export async function handleAdminAdSearchSuggest(request: Request, env: Env, url: URL): Promise<Response> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  if (!hasPermission(session.context.roles, "orders.read")) {
    return json({ error: "forbidden" }, 403);
  }

  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return json({ suggestions: [] });
  if (q.length > 80) return json({ error: "query_too_long" }, 400);

  const like = "%" + q + "%";
  const res = await env.DB.prepare(
    `SELECT DISTINCT c.company_name, c.ico
     FROM clients c
     JOIN orders o ON o.client_id = c.client_id
     JOIN premium_selected_orders po ON po.order_id = o.order_id
     WHERE c.company_name LIKE ? OR IFNULL(c.ico,'') LIKE ?
     ORDER BY c.company_name ASC
     LIMIT 12`
  )
    .bind(like, like)
    .all<{ company_name: string; ico: string | null }>();

  const suggestions = (res.results || []).map((row) => ({
    label: row.company_name + (row.ico ? " · IČO " + row.ico : ""),
    company_name: row.company_name,
    ico: row.ico,
  }));

  return json({ q, suggestions });
}
