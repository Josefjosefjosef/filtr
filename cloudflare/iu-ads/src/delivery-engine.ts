/**
 * Public delivery engine (Etapa 5, kap. 1,8,9,14,43). Selects active campaign placements that
 * have an approved creative for the requesting device/section, then maps them into the
 * allowlisted Public Ad Delivery shape (`06-api-contracts.md`) — `isolation.ts`'s
 * `sanitizePublicAds`/`assertNoForbiddenPublicKeys` still run on the result in `index.ts` as a
 * second, independent guard. Every creative URL is a short-lived signed Worker path
 * (`signed-access.ts`) — never a permanent public R2 URL, even once a creative is `approved`.
 *
 * Callers must only invoke `selectPublicAds` when `isPublicDeliveryActive(flags)` is already
 * true; every other code path in `index.ts` stays on `emptyPublicDelivery` and never reaches
 * this module, so a bug here can only ever under-deliver, never bypass the safe-mode/flag gate.
 */
import { runAutoScheduler } from "./scheduler";
import { signObjectAccess } from "./signed-access";
import type { DeviceCategory, Env, PublicAd } from "./types";

const DEVICE_CATEGORIES = ["pc", "mobile", "tablet"] as const;
export function isDeviceCategory(value: unknown): value is DeviceCategory {
  return typeof value === "string" && (DEVICE_CATEGORIES as readonly string[]).includes(value);
}

const DEFAULT_CACHE_TTL_SECONDS = 300;
const MAX_CACHE_TTL_SECONDS = 3600;
const DEFAULT_LABEL = "Reklama";

type PlacementCandidateRow = {
  campaign_placement_id: string;
  campaign_id: string;
  placement_id: string;
  placement_type_id: string;
  section_id: string | null;
  device_category: string;
  priority: number;
  start_at: string | null;
  end_at: string | null;
  status: string;
};

type CampaignWindowRow = {
  campaign_id: string;
  status: string;
  label_type: string;
  target_url: string | null;
  start_at: string | null;
  end_at: string | null;
};

type PlacementTypeSlotRow = {
  placement_type_id: string;
  technical_type: string;
  anchor: string;
  collision_mode: string;
};

type DeliveryCreativeRow = {
  creative_id: string;
  format: string;
  width: number | null;
  height: number | null;
  r2_key: string;
};

export type DeliveryRequest = {
  device: DeviceCategory;
  section: string | null;
};

type EligibleRow = {
  placement: PlacementCandidateRow;
  slot: PlacementTypeSlotRow;
  campaign: CampaignWindowRow;
  creative: DeliveryCreativeRow;
};

function withinWindow(startAt: string | null, endAt: string | null, nowIso: string): boolean {
  if (startAt && startAt > nowIso) return false;
  if (endAt && endAt < nowIso) return false;
  return true;
}

/** A placement without a `section_id` is global (eligible everywhere); otherwise it must match. */
function matchesSection(placementSection: string | null, requestedSection: string | null): boolean {
  if (!placementSection) return true;
  return placementSection === requestedSection;
}

/** Fail-closed: if the kill-switch can't be read, treat delivery as paused rather than as clear. */
async function isEmergencyPaused(db: D1Database): Promise<boolean> {
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'EMERGENCY_PAUSE_ALL'").first<{ value: string }>();
    if (!row) return false;
    return row.value.trim().toLowerCase() === "true";
  } catch {
    return true;
  }
}

async function loadCacheTtlSeconds(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT value FROM system_settings WHERE key = 'PUBLIC_DELIVERY_CACHE_TTL_SECONDS'")
      .first<{ value: string }>();
    const n = Number(row?.value);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_CACHE_TTL_SECONDS;
    return Math.min(n, MAX_CACHE_TTL_SECONDS);
  } catch {
    return DEFAULT_CACHE_TTL_SECONDS;
  }
}

async function loadDefaultLabel(db: D1Database): Promise<string> {
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'ADS_LABEL_DEFAULT'").first<{ value: string }>();
    return row?.value?.trim() || DEFAULT_LABEL;
  } catch {
    return DEFAULT_LABEL;
  }
}

/**
 * Collision-mode dedupe (kap. 11 semantics reapplied at delivery time as defense-in-depth):
 * `exclusive` placement types keep only the lowest-`priority` candidate per
 * placement/device/section; `shared` placement types may serve every eligible match.
 */
function dedupeByCollisionMode(rows: readonly EligibleRow[]): EligibleRow[] {
  const winners = new Map<string, EligibleRow>();
  const passthrough: EligibleRow[] = [];
  for (const row of rows) {
    if (row.slot.collision_mode !== "exclusive") {
      passthrough.push(row);
      continue;
    }
    const key = row.placement.placement_id + "|" + row.placement.device_category + "|" + (row.placement.section_id || "");
    const current = winners.get(key);
    if (!current || row.placement.priority < current.placement.priority) {
      winners.set(key, row);
    }
  }
  return [...winners.values(), ...passthrough];
}

/**
 * Returns the allowlist-shaped public ads eligible for `request`, or `[]` on any fail-closed
 * condition (no DB, no signing secret, emergency pause, no active/approved match). Runs the
 * best-effort auto scheduler first so a campaign that just crossed `start_at`/`end_at` is
 * reflected in this same response.
 */
export async function selectPublicAds(env: Env, requestOrigin: string, request: DeliveryRequest): Promise<PublicAd[]> {
  if (!env.DB) return [];
  const db = env.DB;
  const nowIso = new Date().toISOString();

  try {
    await runAutoScheduler(db, nowIso);
  } catch {
    // Scheduler failures must never block (or falsely widen) delivery — fall through with
    // whatever statuses already exist in the DB.
  }

  if (await isEmergencyPaused(db)) return [];
  if (!env.ADS_R2_SIGNING_SECRET) return []; // Cannot mint a safe creative URL — fail closed.

  const placementsRes = await db
    .prepare(
      "SELECT campaign_placement_id, campaign_id, placement_id, placement_type_id, section_id, device_category, priority, start_at, end_at, status FROM campaign_placements WHERE status = 'active' AND device_category = ?"
    )
    .bind(request.device)
    .all<PlacementCandidateRow>();

  const eligible: EligibleRow[] = [];

  for (const placement of placementsRes.results || []) {
    if (!matchesSection(placement.section_id, request.section)) continue;
    if (!withinWindow(placement.start_at, placement.end_at, nowIso)) continue;

    const campaign = await db
      .prepare("SELECT campaign_id, status, label_type, target_url, start_at, end_at FROM campaigns WHERE campaign_id = ?")
      .bind(placement.campaign_id)
      .first<CampaignWindowRow>();
    if (!campaign || campaign.status !== "active") continue;
    if (!withinWindow(campaign.start_at, campaign.end_at, nowIso)) continue;

    const slot = await db
      .prepare("SELECT placement_type_id, technical_type, anchor, collision_mode FROM placement_types WHERE placement_type_id = ?")
      .bind(placement.placement_type_id)
      .first<PlacementTypeSlotRow>();
    if (!slot) continue;

    // Unapproved (pending/rejected) creatives are never delivered — review_status is server-enforced here.
    const creative = await db
      .prepare(
        "SELECT creative_id, format, width, height, r2_key FROM creatives WHERE campaign_id = ? AND review_status = 'approved' AND (device_category = ? OR device_category = 'universal') ORDER BY updated_at DESC LIMIT 1"
      )
      .bind(placement.campaign_id, request.device)
      .first<DeliveryCreativeRow>();
    if (!creative) continue;

    eligible.push({ placement, slot, campaign, creative });
  }

  const deduped = dedupeByCollisionMode(eligible);
  const ttl = await loadCacheTtlSeconds(db);
  const defaultLabel = await loadDefaultLabel(db);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const origin = requestOrigin.replace(/\/+$/, "");

  const ads: PublicAd[] = [];
  for (const row of deduped) {
    const sig = await signObjectAccess(env.ADS_R2_SIGNING_SECRET, { objectKey: row.creative.r2_key, bucket: "CREATIVES", exp });
    const cdnUrl =
      origin +
      "/v1/objects/get?bucket=CREATIVES&key=" +
      encodeURIComponent(row.creative.r2_key) +
      "&exp=" +
      String(exp) +
      "&sig=" +
      encodeURIComponent(sig);
    ads.push({
      campaign_id: row.campaign.campaign_id,
      placement_id: row.placement.placement_id,
      section_id: row.placement.section_id || "",
      slot_type: row.slot.technical_type,
      device_category: request.device,
      label: row.campaign.label_type || defaultLabel,
      creative: {
        format: row.creative.format,
        width: row.creative.width || 0,
        height: row.creative.height || 0,
        cdn_url: cdnUrl,
      },
      target_url: row.campaign.target_url || "",
      anchor: row.slot.anchor,
    });
  }
  return ads;
}
