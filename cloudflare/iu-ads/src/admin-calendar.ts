/**
 * Admin calendar / timeline read model (Etapa 8, kap. 18). Reservation + campaign windows in
 * [from,to], with collision flags for exclusive placement types (reuse collision.ts).
 */
import { json, requireAdminSession } from "./admin-auth";
import { findCollision, isCollisionMode, type ReservationWindow } from "./collision";
import { hasPermission } from "./rbac";
import type { Env } from "./types";

type ReservationCalRow = {
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
  collision_mode: string | null;
};

type CampaignCalRow = {
  campaign_id: string;
  title: string;
  status: string;
  evidence_code: string;
  start_at: string | null;
  end_at: string | null;
};

function parseIso(raw: string | null): string | null {
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export async function handleGetAdminCalendar(request: Request, env: Env, url: URL): Promise<Response> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const roles = session.context.roles;
  const canCampaigns = hasPermission(roles, "campaigns.read");
  const canPlacements = hasPermission(roles, "placements.read");
  if (!canCampaigns && !canPlacements) return json({ error: "forbidden" }, 403);

  const from = parseIso(url.searchParams.get("from"));
  const to = parseIso(url.searchParams.get("to"));
  if (!from || !to) return json({ error: "invalid_range", hint: "from and to ISO timestamps required" }, 400);
  if (new Date(from).getTime() >= new Date(to).getTime()) {
    return json({ error: "invalid_range", hint: "from must be before to" }, 400);
  }

  const campaigns: Array<{
    kind: "campaign";
    campaign_id: string;
    title: string;
    status: string;
    evidence_code: string;
    start_at: string;
    end_at: string;
  }> = [];

  if (canCampaigns) {
    const res = await env.DB.prepare(
      "SELECT campaign_id, title, status, evidence_code, start_at, end_at FROM campaigns WHERE start_at IS NOT NULL AND end_at IS NOT NULL AND start_at < ? AND end_at > ? ORDER BY start_at ASC"
    )
      .bind(to, from)
      .all<CampaignCalRow>();
    for (const row of res.results || []) {
      if (!row.start_at || !row.end_at) continue;
      campaigns.push({
        kind: "campaign",
        campaign_id: row.campaign_id,
        title: row.title,
        status: row.status,
        evidence_code: row.evidence_code,
        start_at: row.start_at,
        end_at: row.end_at,
      });
    }
  }

  const reservations: Array<{
    kind: "reservation";
    reservation_id: string;
    placement_id: string;
    placement_type_id: string;
    campaign_id: string;
    device_category: string;
    section_id: string | null;
    region_code: string | null;
    start_at: string;
    end_at: string;
    status: string;
    collision_mode: string;
    has_collision: boolean;
    collision_with: string | null;
  }> = [];

  if (canPlacements) {
    const res = await env.DB.prepare(
      `SELECT r.reservation_id, r.placement_type_id, r.placement_id, r.campaign_id, r.device_category,
              r.section_id, r.region_code, r.start_at, r.end_at, r.status, pt.collision_mode
       FROM placement_reservations r
       LEFT JOIN placement_types pt ON pt.placement_type_id = r.placement_type_id
       WHERE r.start_at < ? AND r.end_at > ?
       ORDER BY r.start_at ASC`
    )
      .bind(to, from)
      .all<ReservationCalRow>();

    const rows = res.results || [];
    const windows: ReservationWindow[] = rows.map((r) => ({
      reservation_id: r.reservation_id,
      placement_id: r.placement_id,
      device_category: r.device_category,
      section_id: r.section_id,
      region_code: r.region_code,
      start_at: r.start_at,
      end_at: r.end_at,
      status: r.status,
    }));

    for (const row of rows) {
      const mode = isCollisionMode(row.collision_mode) ? row.collision_mode : "exclusive";
      const candidate: ReservationWindow = {
        reservation_id: row.reservation_id,
        placement_id: row.placement_id,
        device_category: row.device_category,
        section_id: row.section_id,
        region_code: row.region_code,
        start_at: row.start_at,
        end_at: row.end_at,
        status: row.status,
      };
      const hit = findCollision(candidate, windows, mode);
      reservations.push({
        kind: "reservation",
        reservation_id: row.reservation_id,
        placement_id: row.placement_id,
        placement_type_id: row.placement_type_id,
        campaign_id: row.campaign_id,
        device_category: row.device_category,
        section_id: row.section_id,
        region_code: row.region_code,
        start_at: row.start_at,
        end_at: row.end_at,
        status: row.status,
        collision_mode: mode,
        has_collision: !!hit,
        collision_with: hit?.reservation_id || null,
      });
    }
  }

  return json({
    from,
    to,
    campaigns,
    reservations,
    items: [...campaigns, ...reservations].sort((a, b) => a.start_at.localeCompare(b.start_at)),
  });
}
