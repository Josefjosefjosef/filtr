/**
 * Admin placement reservation endpoints (Etapa 4, kap. 11). RBAC: placements.read/placements.write.
 * Exclusive placement types may never hold two overlapping active reservations for the same
 * placement/device/section/region window — collision.ts turns a match into an HTTP 409.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { findCollision, isCollisionMode, type ReservationWindow } from "./collision";
import type { Env } from "./types";

const DEVICE_CATEGORIES = ["pc", "mobile", "tablet"] as const;
function isDeviceCategory(value: unknown): value is (typeof DEVICE_CATEGORIES)[number] {
  return typeof value === "string" && (DEVICE_CATEGORIES as readonly string[]).includes(value);
}

type ReservationRow = {
  reservation_id: string;
  placement_type_id: string;
  placement_id: string;
  campaign_id: string;
  device_category: string;
  section_id: string | null;
  region_code: string | null;
  start_at: string;
  end_at: string;
  status: string;
  created_at: string;
};

const RESERVATION_COLUMNS =
  "reservation_id, placement_type_id, placement_id, campaign_id, device_category, section_id, region_code, start_at, end_at, status, created_at";

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.floor(n));
}

export async function handleListReservations(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const placementId = url.searchParams.get("placement_id");
  const campaignId = url.searchParams.get("campaign_id");
  const limit = clampLimit(url.searchParams.get("limit"));

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (placementId) {
    conditions.push("placement_id = ?");
    params.push(placementId);
  }
  if (campaignId) {
    conditions.push("campaign_id = ?");
    params.push(campaignId);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit);

  const res = await env.DB.prepare(
    "SELECT " + RESERVATION_COLUMNS + " FROM placement_reservations " + where + " ORDER BY start_at ASC LIMIT ?"
  )
    .bind(...params)
    .all<ReservationRow>();
  return json({ reservations: res.results || [] });
}

export async function handleCreateReservation(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const placementTypeId = typeof body.placement_type_id === "string" ? body.placement_type_id.trim() : "";
  const placementId = typeof body.placement_id === "string" ? body.placement_id.trim() : "";
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
  const startAt = typeof body.start_at === "string" ? body.start_at : "";
  const endAt = typeof body.end_at === "string" ? body.end_at : "";
  if (!placementTypeId) return json({ error: "invalid_placement_type_id" }, 400);
  if (!placementId) return json({ error: "invalid_placement_id" }, 400);
  if (!campaignId) return json({ error: "invalid_campaign_id" }, 400);
  if (!isDeviceCategory(body.device_category)) return json({ error: "invalid_device_category" }, 400);
  if (!startAt || !endAt) return json({ error: "invalid_window" }, 400);
  if (new Date(startAt).getTime() >= new Date(endAt).getTime()) return json({ error: "invalid_window" }, 400);

  const campaign = await env.DB.prepare("SELECT campaign_id FROM campaigns WHERE campaign_id = ?").bind(campaignId).first();
  if (!campaign) return json({ error: "campaign_not_found" }, 400);

  const placementType = await env.DB.prepare("SELECT collision_mode FROM placement_types WHERE placement_type_id = ?")
    .bind(placementTypeId)
    .first<{ collision_mode: string }>();
  if (!placementType) return json({ error: "placement_type_not_found" }, 400);
  const collisionMode = isCollisionMode(placementType.collision_mode) ? placementType.collision_mode : "exclusive";

  const sectionId = typeof body.section_id === "string" ? body.section_id : null;
  const regionCode = typeof body.region_code === "string" ? body.region_code : null;

  const candidate: ReservationWindow = {
    placement_id: placementId,
    device_category: body.device_category,
    section_id: sectionId,
    region_code: regionCode,
    start_at: startAt,
    end_at: endAt,
    status: "reserved",
  };

  const existingRes = await env.DB.prepare(
    "SELECT " + RESERVATION_COLUMNS + " FROM placement_reservations WHERE placement_id = ?"
  )
    .bind(placementId)
    .all<ReservationRow>();
  const existing: ReservationWindow[] = (existingRes.results || []).map((r) => ({
    reservation_id: r.reservation_id,
    placement_id: r.placement_id,
    device_category: r.device_category,
    section_id: r.section_id,
    region_code: r.region_code,
    start_at: r.start_at,
    end_at: r.end_at,
    status: r.status,
  }));

  const collision = findCollision(candidate, existing, collisionMode);
  if (collision) {
    return json({ error: "reservation_collision", conflicting_reservation_id: collision.reservation_id }, 409);
  }

  const reservationId = newId("rsv");
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO placement_reservations (reservation_id, placement_type_id, placement_id, campaign_id, device_category, section_id, region_code, start_at, end_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(reservationId, placementTypeId, placementId, campaignId, body.device_category, sectionId, regionCode, startAt, endAt, "reserved", nowIso)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "reservation_created",
      objectType: "placement_reservation",
      objectId: reservationId,
      after: { placement_id: placementId, campaign_id: campaignId, start_at: startAt, end_at: endAt },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + RESERVATION_COLUMNS + " FROM placement_reservations WHERE reservation_id = ?")
    .bind(reservationId)
    .first<ReservationRow>();
  return json({ reservation: row || null }, 201);
}

export async function handleGetReservation(request: Request, env: Env, reservationId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + RESERVATION_COLUMNS + " FROM placement_reservations WHERE reservation_id = ?")
    .bind(reservationId)
    .first<ReservationRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ reservation: row });
}

export async function handleCancelReservation(request: Request, env: Env, reservationId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "placements.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + RESERVATION_COLUMNS + " FROM placement_reservations WHERE reservation_id = ?")
    .bind(reservationId)
    .first<ReservationRow>();
  if (!before) return json({ error: "not_found" }, 404);
  if (before.status === "cancelled") return json({ reservation: before });

  await env.DB.prepare("UPDATE placement_reservations SET status = 'cancelled' WHERE reservation_id = ?")
    .bind(reservationId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "reservation_cancelled",
      objectType: "placement_reservation",
      objectId: reservationId,
      before: { status: before.status },
      after: { status: "cancelled" },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + RESERVATION_COLUMNS + " FROM placement_reservations WHERE reservation_id = ?")
    .bind(reservationId)
    .first<ReservationRow>();
  return json({ reservation: after || null });
}
