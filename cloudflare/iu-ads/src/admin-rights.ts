/**
 * Admin rights-confirmation endpoints (Etapa 3, kap. 30). RBAC: rights.read/rights.write
 * (ads_manager/main_admin) — a campaign must have a rights confirmation before activation
 * (enforced in Etapa 4's campaign state machine; this module only records confirmations).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

type RightsConfirmationRow = {
  confirmation_id: string;
  campaign_id: string;
  confirmed_by_name: string;
  confirmed_at: string;
  statement_text: string;
  terms_version: string;
  document_id: string | null;
  created_at: string;
};

const RIGHTS_COLUMNS =
  "confirmation_id, campaign_id, confirmed_by_name, confirmed_at, statement_text, terms_version, document_id, created_at";

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

export async function handleListRightsConfirmations(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "rights.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const campaignId = url.searchParams.get("campaign_id");
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const where = campaignId ? "WHERE campaign_id = ?" : "";
  const params: unknown[] = campaignId ? [campaignId, limit, offset] : [limit, offset];

  const res = await env.DB.prepare(
    "SELECT " + RIGHTS_COLUMNS + " FROM rights_confirmations " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<RightsConfirmationRow>();
  return json({ confirmations: res.results || [], limit, offset });
}

export async function handleCreateRightsConfirmation(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "rights.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: {
    campaign_id?: unknown;
    confirmed_by_name?: unknown;
    statement_text?: unknown;
    terms_version?: unknown;
    document_id?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
  const confirmedByName = typeof body.confirmed_by_name === "string" ? body.confirmed_by_name.trim() : "";
  const statementText = typeof body.statement_text === "string" ? body.statement_text.trim() : "";
  const termsVersion = typeof body.terms_version === "string" ? body.terms_version.trim() : "";
  if (!campaignId) return json({ error: "invalid_campaign_id" }, 400);
  if (!confirmedByName) return json({ error: "invalid_confirmed_by_name" }, 400);
  if (!statementText) return json({ error: "invalid_statement_text" }, 400);
  if (!termsVersion) return json({ error: "invalid_terms_version" }, 400);

  const nowIso = new Date().toISOString();
  const confirmationId = newId("rgt");
  await env.DB.prepare(
    "INSERT INTO rights_confirmations (confirmation_id, campaign_id, confirmed_by_name, confirmed_at, statement_text, terms_version, document_id, created_at) VALUES (?,?,?,?,?,?,?,?)"
  )
    .bind(
      confirmationId,
      campaignId,
      confirmedByName,
      nowIso,
      statementText,
      termsVersion,
      typeof body.document_id === "string" ? body.document_id : null,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "rights_confirmed",
      objectType: "rights_confirmation",
      objectId: confirmationId,
      after: { campaign_id: campaignId, confirmed_by_name: confirmedByName, terms_version: termsVersion },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + RIGHTS_COLUMNS + " FROM rights_confirmations WHERE confirmation_id = ?")
    .bind(confirmationId)
    .first<RightsConfirmationRow>();
  return json({ confirmation: row }, 201);
}

export async function handleGetRightsConfirmation(request: Request, env: Env, confirmationId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "rights.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + RIGHTS_COLUMNS + " FROM rights_confirmations WHERE confirmation_id = ?")
    .bind(confirmationId)
    .first<RightsConfirmationRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ confirmation: row });
}
