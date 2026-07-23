/**
 * Admin campaigns endpoints (Etapa 4, kap. 7,13). RBAC: campaigns.read/campaigns.write;
 * entering approved/scheduled/active additionally requires campaigns.activate
 * (ads_manager/main_admin only — sales is denied, kap. 4/7). Every mutation → audit_logs.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { hasPermission } from "./rbac";
import {
  canTransition,
  isCampaignStatus,
  requiresActivatePermission,
  requiresRightsConfirmation,
  type CampaignStatus,
} from "./campaign-state";
import { validateTargetUrl } from "./url-safety";
import type { Env } from "./types";

type CampaignRow = {
  campaign_id: string;
  evidence_code: string;
  client_id: string;
  order_id: string | null;
  contract_id: string | null;
  invoice_id: string | null;
  title: string;
  status: string;
  label_type: string;
  start_at: string | null;
  end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  target_url: string | null;
  price_cents: number | null;
  price_ex_vat_cents: number | null;
  vat_cents: number | null;
  pricing_model: string | null;
  impression_limit: number | null;
  click_limit: number | null;
  budget_limit_cents: number | null;
  devices_json: string | null;
  sections_json: string | null;
  regions_json: string | null;
  note_internal: string | null;
  note_client: string | null;
  note_public: string | null;
  client_report_enabled: number;
  client_export_enabled: number;
  ordered_by: string | null;
  payer: string | null;
  agency_name: string | null;
  created_at: string;
  updated_at: string;
};

const CAMPAIGN_COLUMNS =
  "campaign_id, evidence_code, client_id, order_id, contract_id, invoice_id, title, status, label_type, start_at, end_at, actual_start_at, actual_end_at, target_url, price_cents, price_ex_vat_cents, vat_cents, pricing_model, impression_limit, click_limit, budget_limit_cents, devices_json, sections_json, regions_json, note_internal, note_client, note_public, client_report_enabled, client_export_enabled, ordered_by, payer, agency_name, created_at, updated_at";

const LABEL_TYPES = ["Reklama", "Inzerce", "Sponzorováno", "Placený obsah", "Komerční sdělení"] as const;

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

function parseJsonArray(raw: string | null): unknown[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeCampaign(row: CampaignRow) {
  return {
    campaign_id: row.campaign_id,
    evidence_code: row.evidence_code,
    client_id: row.client_id,
    order_id: row.order_id,
    contract_id: row.contract_id,
    invoice_id: row.invoice_id,
    title: row.title,
    status: row.status,
    label_type: row.label_type,
    start_at: row.start_at,
    end_at: row.end_at,
    actual_start_at: row.actual_start_at,
    actual_end_at: row.actual_end_at,
    target_url: row.target_url,
    price_cents: row.price_cents,
    price_ex_vat_cents: row.price_ex_vat_cents,
    vat_cents: row.vat_cents,
    pricing_model: row.pricing_model,
    impression_limit: row.impression_limit,
    click_limit: row.click_limit,
    budget_limit_cents: row.budget_limit_cents,
    devices: parseJsonArray(row.devices_json) || [],
    sections: parseJsonArray(row.sections_json) || [],
    regions: parseJsonArray(row.regions_json) || [],
    note_internal: row.note_internal,
    note_client: row.note_client,
    note_public: row.note_public,
    client_report_enabled: row.client_report_enabled === 1,
    client_export_enabled: row.client_export_enabled === 1,
    ordered_by: row.ordered_by,
    payer: row.payer,
    agency_name: row.agency_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function generateEvidenceCode(): string {
  return "AD-" + String(new Date().getFullYear()) + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

export async function handleListCampaigns(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("client_id");
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (clientId) {
    conditions.push("client_id = ?");
    params.push(clientId);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit, offset);

  const res = await env.DB.prepare(
    "SELECT " + CAMPAIGN_COLUMNS + " FROM campaigns " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<CampaignRow>();
  return json({ campaigns: (res.results || []).map(serializeCampaign), limit, offset });
}

export async function handleCreateCampaign(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!clientId) return json({ error: "invalid_client_id" }, 400);
  if (!title) return json({ error: "invalid_title" }, 400);

  const clientRow = await env.DB.prepare("SELECT client_id FROM clients WHERE client_id = ?").bind(clientId).first();
  if (!clientRow) return json({ error: "client_not_found" }, 400);

  let targetUrl: string | null = null;
  if (body.target_url !== undefined && body.target_url !== null) {
    const validated = validateTargetUrl(body.target_url);
    if (!validated.ok) return json({ error: validated.reason }, 400);
    targetUrl = validated.normalized;
  }

  const labelType =
    typeof body.label_type === "string" && (LABEL_TYPES as readonly string[]).includes(body.label_type)
      ? body.label_type
      : "Reklama";

  const evidenceCode =
    typeof body.evidence_code === "string" && body.evidence_code.trim() ? body.evidence_code.trim() : generateEvidenceCode();
  const existing = await env.DB.prepare("SELECT campaign_id FROM campaigns WHERE evidence_code = ?").bind(evidenceCode).first();
  if (existing) return json({ error: "evidence_code_taken" }, 409);

  const campaignId = newId("cmp");
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO campaigns (campaign_id, evidence_code, client_id, order_id, contract_id, invoice_id, title, status, label_type, start_at, end_at, actual_start_at, actual_end_at, target_url, price_cents, price_ex_vat_cents, vat_cents, pricing_model, impression_limit, click_limit, budget_limit_cents, devices_json, sections_json, regions_json, note_internal, note_client, note_public, client_report_enabled, client_export_enabled, ordered_by, payer, agency_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      campaignId,
      evidenceCode,
      clientId,
      typeof body.order_id === "string" ? body.order_id : null,
      typeof body.contract_id === "string" ? body.contract_id : null,
      typeof body.invoice_id === "string" ? body.invoice_id : null,
      title,
      "draft",
      labelType,
      typeof body.start_at === "string" ? body.start_at : null,
      typeof body.end_at === "string" ? body.end_at : null,
      targetUrl,
      typeof body.price_cents === "number" ? body.price_cents : null,
      typeof body.price_ex_vat_cents === "number" ? body.price_ex_vat_cents : null,
      typeof body.vat_cents === "number" ? body.vat_cents : null,
      typeof body.pricing_model === "string" ? body.pricing_model : null,
      typeof body.impression_limit === "number" ? body.impression_limit : null,
      typeof body.click_limit === "number" ? body.click_limit : null,
      typeof body.budget_limit_cents === "number" ? body.budget_limit_cents : null,
      Array.isArray(body.devices) ? JSON.stringify(body.devices) : null,
      Array.isArray(body.sections) ? JSON.stringify(body.sections) : null,
      Array.isArray(body.regions) ? JSON.stringify(body.regions) : null,
      typeof body.note_internal === "string" ? body.note_internal : null,
      typeof body.note_client === "string" ? body.note_client : null,
      typeof body.note_public === "string" ? body.note_public : null,
      body.client_report_enabled === false ? 0 : 1,
      body.client_export_enabled === true ? 1 : 0,
      typeof body.ordered_by === "string" ? body.ordered_by : null,
      typeof body.payer === "string" ? body.payer : null,
      typeof body.agency_name === "string" ? body.agency_name : null,
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "campaign_created",
      objectType: "campaign",
      objectId: campaignId,
      after: { client_id: clientId, title, evidence_code: evidenceCode, status: "draft" },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + CAMPAIGN_COLUMNS + " FROM campaigns WHERE campaign_id = ?")
    .bind(campaignId)
    .first<CampaignRow>();
  return json({ campaign: row ? serializeCampaign(row) : null }, 201);
}

export async function handleGetCampaign(request: Request, env: Env, campaignId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + CAMPAIGN_COLUMNS + " FROM campaigns WHERE campaign_id = ?")
    .bind(campaignId)
    .first<CampaignRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ campaign: serializeCampaign(row) });
}

export async function handleUpdateCampaign(request: Request, env: Env, campaignId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + CAMPAIGN_COLUMNS + " FROM campaigns WHERE campaign_id = ?")
    .bind(campaignId)
    .first<CampaignRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  // Status transitions never happen here — use POST /v1/admin/campaigns/:id/transition,
  // which enforces the state machine + campaigns.activate + rights-confirmation gates.
  if (body.status !== undefined) return json({ error: "use_transition_endpoint" }, 400);

  let targetUrl = before.target_url;
  if (body.target_url !== undefined) {
    if (body.target_url === null) {
      targetUrl = null;
    } else {
      const validated = validateTargetUrl(body.target_url);
      if (!validated.ok) return json({ error: validated.reason }, 400);
      targetUrl = validated.normalized;
    }
  }

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : before.title;
  const labelType =
    typeof body.label_type === "string" && (LABEL_TYPES as readonly string[]).includes(body.label_type)
      ? body.label_type
      : before.label_type;
  const startAt = body.start_at !== undefined ? (typeof body.start_at === "string" ? body.start_at : null) : before.start_at;
  const endAt = body.end_at !== undefined ? (typeof body.end_at === "string" ? body.end_at : null) : before.end_at;
  const priceCents = typeof body.price_cents === "number" ? body.price_cents : before.price_cents;
  const priceExVatCents = typeof body.price_ex_vat_cents === "number" ? body.price_ex_vat_cents : before.price_ex_vat_cents;
  const vatCents = typeof body.vat_cents === "number" ? body.vat_cents : before.vat_cents;
  const budgetLimitCents = typeof body.budget_limit_cents === "number" ? body.budget_limit_cents : before.budget_limit_cents;
  const devicesJson = Array.isArray(body.devices) ? JSON.stringify(body.devices) : before.devices_json;
  const sectionsJson = Array.isArray(body.sections) ? JSON.stringify(body.sections) : before.sections_json;
  const regionsJson = Array.isArray(body.regions) ? JSON.stringify(body.regions) : before.regions_json;
  const noteInternal = typeof body.note_internal === "string" ? body.note_internal : before.note_internal;
  const noteClient = typeof body.note_client === "string" ? body.note_client : before.note_client;
  const notePublic = typeof body.note_public === "string" ? body.note_public : before.note_public;
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE campaigns SET title = ?, label_type = ?, start_at = ?, end_at = ?, target_url = ?, price_cents = ?, price_ex_vat_cents = ?, vat_cents = ?, budget_limit_cents = ?, devices_json = ?, sections_json = ?, regions_json = ?, note_internal = ?, note_client = ?, note_public = ?, updated_at = ? WHERE campaign_id = ?"
  )
    .bind(
      title,
      labelType,
      startAt,
      endAt,
      targetUrl,
      priceCents,
      priceExVatCents,
      vatCents,
      budgetLimitCents,
      devicesJson,
      sectionsJson,
      regionsJson,
      noteInternal,
      noteClient,
      notePublic,
      nowIso,
      campaignId
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "campaign_updated",
      objectType: "campaign",
      objectId: campaignId,
      before: { title: before.title, target_url: before.target_url },
      after: { title, target_url: targetUrl },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + CAMPAIGN_COLUMNS + " FROM campaigns WHERE campaign_id = ?")
    .bind(campaignId)
    .first<CampaignRow>();
  return json({ campaign: after ? serializeCampaign(after) : null });
}

export async function handleTransitionCampaign(request: Request, env: Env, campaignId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + CAMPAIGN_COLUMNS + " FROM campaigns WHERE campaign_id = ?")
    .bind(campaignId)
    .first<CampaignRow>();
  if (!before) return json({ error: "not_found" }, 404);
  if (!isCampaignStatus(before.status)) return json({ error: "corrupt_status" }, 500);

  let body: { to?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!isCampaignStatus(body.to)) return json({ error: "invalid_status" }, 400);
  const from = before.status as CampaignStatus;
  const to = body.to;

  if (!canTransition(from, to)) return json({ error: "invalid_transition", from, to }, 409);

  if (requiresActivatePermission(to) && !hasPermission(guard.roles, "campaigns.activate")) {
    return json({ error: "forbidden", reason: "campaigns_activate_required" }, 403);
  }

  if (requiresRightsConfirmation(to)) {
    const rights = await env.DB.prepare("SELECT confirmation_id FROM rights_confirmations WHERE campaign_id = ? LIMIT 1")
      .bind(campaignId)
      .first();
    if (!rights) return json({ error: "rights_confirmation_required" }, 409);
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
  const nowIso = new Date().toISOString();
  const actualStartAt = to === "active" && !before.actual_start_at ? nowIso : before.actual_start_at;
  const actualEndAt = to === "ended" && !before.actual_end_at ? nowIso : before.actual_end_at;

  await env.DB.prepare(
    "UPDATE campaigns SET status = ?, actual_start_at = ?, actual_end_at = ?, updated_at = ? WHERE campaign_id = ?"
  )
    .bind(to, actualStartAt, actualEndAt, nowIso, campaignId)
    .run();

  const eventId = newId("cse");
  await env.DB.prepare(
    "INSERT INTO campaign_status_events (event_id, campaign_id, from_status, to_status, actor_user_id, reason, created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(eventId, campaignId, from, to, guard.userId, reason, nowIso)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "campaign_status_transitioned",
      objectType: "campaign",
      objectId: campaignId,
      before: { status: from },
      after: { status: to, reason },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + CAMPAIGN_COLUMNS + " FROM campaigns WHERE campaign_id = ?")
    .bind(campaignId)
    .first<CampaignRow>();
  return json({ campaign: after ? serializeCampaign(after) : null, event: { event_id: eventId, from_status: from, to_status: to } });
}
