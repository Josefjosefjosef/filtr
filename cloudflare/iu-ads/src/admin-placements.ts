/**
 * Admin placement endpoints (Etapa 4, kap. 10). RBAC: placements.read/placements.write.
 * Covers the placement-type catalog and per-campaign placement instances; reservations
 * (with collision checks) live in admin-reservations.ts.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { isCollisionMode } from "./collision";
import type { Env } from "./types";

const DEVICE_CATEGORIES = ["pc", "mobile", "tablet"] as const;
function isDeviceCategory(value: unknown): value is (typeof DEVICE_CATEGORIES)[number] {
  return typeof value === "string" && (DEVICE_CATEGORIES as readonly string[]).includes(value);
}

type PlacementTypeRow = {
  placement_type_id: string;
  name_cs: string;
  technical_type: string;
  section_id: string | null;
  insert_rule: string;
  anchor: string;
  devices_json: string;
  formats_json: string | null;
  min_width: number | null;
  max_width: number | null;
  min_height: number | null;
  max_height: number | null;
  security_constraints_json: string | null;
  collision_mode: string;
  responsive_rules_json: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

const PLACEMENT_TYPE_COLUMNS =
  "placement_type_id, name_cs, technical_type, section_id, insert_rule, anchor, devices_json, formats_json, min_width, max_width, min_height, max_height, security_constraints_json, collision_mode, responsive_rules_json, is_active, created_at, updated_at";

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function serializePlacementType(row: PlacementTypeRow) {
  return {
    placement_type_id: row.placement_type_id,
    name_cs: row.name_cs,
    technical_type: row.technical_type,
    section_id: row.section_id,
    insert_rule: row.insert_rule,
    anchor: row.anchor,
    devices: parseJson(row.devices_json) || [],
    formats: parseJson(row.formats_json) || [],
    min_width: row.min_width,
    max_width: row.max_width,
    min_height: row.min_height,
    max_height: row.max_height,
    security_constraints: parseJson(row.security_constraints_json) || {},
    collision_mode: row.collision_mode,
    responsive_rules: parseJson(row.responsive_rules_json) || null,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleListPlacementTypes(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const activeOnly = url.searchParams.get("active") === "true";
  const where = activeOnly ? "WHERE is_active = 1" : "";
  const res = await env.DB.prepare("SELECT " + PLACEMENT_TYPE_COLUMNS + " FROM placement_types " + where + " ORDER BY name_cs ASC")
    .all<PlacementTypeRow>();
  return json({ placement_types: (res.results || []).map(serializePlacementType) });
}

export async function handleCreatePlacementType(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const nameCs = typeof body.name_cs === "string" ? body.name_cs.trim() : "";
  const technicalType = typeof body.technical_type === "string" ? body.technical_type.trim() : "";
  const insertRule = typeof body.insert_rule === "string" ? body.insert_rule.trim() : "";
  const anchor = typeof body.anchor === "string" ? body.anchor.trim() : "";
  if (!nameCs) return json({ error: "invalid_name_cs" }, 400);
  if (!technicalType) return json({ error: "invalid_technical_type" }, 400);
  if (!insertRule) return json({ error: "invalid_insert_rule" }, 400);
  if (!anchor) return json({ error: "invalid_anchor" }, 400);
  if (!Array.isArray(body.devices) || !body.devices.every(isDeviceCategory)) {
    return json({ error: "invalid_devices" }, 400);
  }
  const collisionMode = isCollisionMode(body.collision_mode) ? body.collision_mode : "exclusive";

  const placementTypeId = newId("pt");
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO placement_types (placement_type_id, name_cs, technical_type, section_id, insert_rule, anchor, devices_json, formats_json, min_width, max_width, min_height, max_height, security_constraints_json, collision_mode, responsive_rules_json, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      placementTypeId,
      nameCs,
      technicalType,
      typeof body.section_id === "string" ? body.section_id : null,
      insertRule,
      anchor,
      JSON.stringify(body.devices),
      Array.isArray(body.formats) ? JSON.stringify(body.formats) : null,
      typeof body.min_width === "number" ? body.min_width : null,
      typeof body.max_width === "number" ? body.max_width : null,
      typeof body.min_height === "number" ? body.min_height : null,
      typeof body.max_height === "number" ? body.max_height : null,
      body.security_constraints !== undefined ? JSON.stringify(body.security_constraints) : null,
      collisionMode,
      body.responsive_rules !== undefined ? JSON.stringify(body.responsive_rules) : null,
      body.is_active === false ? 0 : 1,
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "placement_type_created",
      objectType: "placement_type",
      objectId: placementTypeId,
      after: { name_cs: nameCs, technical_type: technicalType, collision_mode: collisionMode },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + PLACEMENT_TYPE_COLUMNS + " FROM placement_types WHERE placement_type_id = ?")
    .bind(placementTypeId)
    .first<PlacementTypeRow>();
  return json({ placement_type: row ? serializePlacementType(row) : null }, 201);
}

export async function handleGetPlacementType(request: Request, env: Env, placementTypeId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + PLACEMENT_TYPE_COLUMNS + " FROM placement_types WHERE placement_type_id = ?")
    .bind(placementTypeId)
    .first<PlacementTypeRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ placement_type: serializePlacementType(row) });
}

export async function handleUpdatePlacementType(request: Request, env: Env, placementTypeId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + PLACEMENT_TYPE_COLUMNS + " FROM placement_types WHERE placement_type_id = ?")
    .bind(placementTypeId)
    .first<PlacementTypeRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.collision_mode !== undefined && !isCollisionMode(body.collision_mode)) {
    return json({ error: "invalid_collision_mode" }, 400);
  }

  const nameCs = typeof body.name_cs === "string" && body.name_cs.trim() ? body.name_cs.trim() : before.name_cs;
  const collisionMode = isCollisionMode(body.collision_mode) ? body.collision_mode : before.collision_mode;
  const isActive = typeof body.is_active === "boolean" ? (body.is_active ? 1 : 0) : before.is_active;
  const nowIso = new Date().toISOString();

  await env.DB.prepare("UPDATE placement_types SET name_cs = ?, collision_mode = ?, is_active = ?, updated_at = ? WHERE placement_type_id = ?")
    .bind(nameCs, collisionMode, isActive, nowIso, placementTypeId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "placement_type_updated",
      objectType: "placement_type",
      objectId: placementTypeId,
      before: { collision_mode: before.collision_mode, is_active: before.is_active === 1 },
      after: { collision_mode: collisionMode, is_active: isActive === 1 },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + PLACEMENT_TYPE_COLUMNS + " FROM placement_types WHERE placement_type_id = ?")
    .bind(placementTypeId)
    .first<PlacementTypeRow>();
  return json({ placement_type: after ? serializePlacementType(after) : null });
}

type CampaignPlacementRow = {
  campaign_placement_id: string;
  campaign_id: string;
  placement_id: string;
  placement_type_id: string;
  section_id: string | null;
  region_code: string | null;
  device_category: string;
  priority: number;
  start_at: string | null;
  end_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const CAMPAIGN_PLACEMENT_COLUMNS =
  "campaign_placement_id, campaign_id, placement_id, placement_type_id, section_id, region_code, device_category, priority, start_at, end_at, status, created_at, updated_at";

export async function handleListCampaignPlacements(request: Request, env: Env, campaignId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const res = await env.DB.prepare(
    "SELECT " + CAMPAIGN_PLACEMENT_COLUMNS + " FROM campaign_placements WHERE campaign_id = ? ORDER BY created_at DESC"
  )
    .bind(campaignId)
    .all<CampaignPlacementRow>();
  return json({ campaign_placements: res.results || [] });
}

export async function handleCreateCampaignPlacement(request: Request, env: Env, campaignId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const campaign = await env.DB.prepare("SELECT campaign_id FROM campaigns WHERE campaign_id = ?").bind(campaignId).first();
  if (!campaign) return json({ error: "campaign_not_found" }, 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const placementId = typeof body.placement_id === "string" ? body.placement_id.trim() : "";
  const placementTypeId = typeof body.placement_type_id === "string" ? body.placement_type_id.trim() : "";
  if (!placementId) return json({ error: "invalid_placement_id" }, 400);
  if (!placementTypeId) return json({ error: "invalid_placement_type_id" }, 400);
  if (!isDeviceCategory(body.device_category)) return json({ error: "invalid_device_category" }, 400);

  const placementType = await env.DB.prepare("SELECT placement_type_id FROM placement_types WHERE placement_type_id = ?")
    .bind(placementTypeId)
    .first();
  if (!placementType) return json({ error: "placement_type_not_found" }, 400);

  const campaignPlacementId = newId("cpl");
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO campaign_placements (campaign_placement_id, campaign_id, placement_id, placement_type_id, section_id, region_code, device_category, priority, start_at, end_at, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      campaignPlacementId,
      campaignId,
      placementId,
      placementTypeId,
      typeof body.section_id === "string" ? body.section_id : null,
      typeof body.region_code === "string" ? body.region_code : null,
      body.device_category,
      typeof body.priority === "number" ? body.priority : 100,
      typeof body.start_at === "string" ? body.start_at : null,
      typeof body.end_at === "string" ? body.end_at : null,
      "planned",
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "campaign_placement_created",
      objectType: "campaign_placement",
      objectId: campaignPlacementId,
      after: { campaign_id: campaignId, placement_id: placementId, placement_type_id: placementTypeId },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + CAMPAIGN_PLACEMENT_COLUMNS + " FROM campaign_placements WHERE campaign_placement_id = ?")
    .bind(campaignPlacementId)
    .first<CampaignPlacementRow>();
  return json({ campaign_placement: row || null }, 201);
}

export async function handleUpdateCampaignPlacement(
  request: Request,
  env: Env,
  campaignId: string,
  campaignPlacementId: string
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare(
    "SELECT " + CAMPAIGN_PLACEMENT_COLUMNS + " FROM campaign_placements WHERE campaign_placement_id = ? AND campaign_id = ?"
  )
    .bind(campaignPlacementId, campaignId)
    .first<CampaignPlacementRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: { status?: unknown; priority?: unknown; start_at?: unknown; end_at?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const status = typeof body.status === "string" && body.status.trim() ? body.status.trim() : before.status;
  const priority = typeof body.priority === "number" ? body.priority : before.priority;
  const startAt = body.start_at !== undefined ? (typeof body.start_at === "string" ? body.start_at : null) : before.start_at;
  const endAt = body.end_at !== undefined ? (typeof body.end_at === "string" ? body.end_at : null) : before.end_at;
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE campaign_placements SET status = ?, priority = ?, start_at = ?, end_at = ?, updated_at = ? WHERE campaign_placement_id = ?"
  )
    .bind(status, priority, startAt, endAt, nowIso, campaignPlacementId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "campaign_placement_updated",
      objectType: "campaign_placement",
      objectId: campaignPlacementId,
      before: { status: before.status },
      after: { status },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + CAMPAIGN_PLACEMENT_COLUMNS + " FROM campaign_placements WHERE campaign_placement_id = ?")
    .bind(campaignPlacementId)
    .first<CampaignPlacementRow>();
  return json({ campaign_placement: after || null });
}
