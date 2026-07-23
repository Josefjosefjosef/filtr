/**
 * Placement reservation collision detection (Etapa 4, kap. 11). `placement_types.collision_mode`
 * `exclusive` means at most one active reservation may hold a given placement/device/section/region
 * window at a time — `admin-reservations.ts` turns any detected collision into an HTTP 409.
 * `shared` placement types (e.g. rotating tiles) never collide here.
 */

export type CollisionMode = "exclusive" | "shared";

export function isCollisionMode(value: unknown): value is CollisionMode {
  return value === "exclusive" || value === "shared";
}

export type ReservationWindow = {
  reservation_id?: string;
  placement_id: string;
  device_category: string;
  section_id: string | null;
  region_code: string | null;
  start_at: string;
  end_at: string;
  status: string;
};

/** Only these statuses hold a placement window; cancelled/expired reservations never collide. */
const ACTIVE_RESERVATION_STATUSES = new Set(["reserved", "confirmed"]);

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aS = new Date(aStart).getTime();
  const aE = new Date(aEnd).getTime();
  const bS = new Date(bStart).getTime();
  const bE = new Date(bEnd).getTime();
  if (![aS, aE, bS, bE].every(Number.isFinite)) return false;
  return aS < bE && bS < aE;
}

function scopeMatches(a: ReservationWindow, b: ReservationWindow): boolean {
  return (
    a.placement_id === b.placement_id &&
    a.device_category === b.device_category &&
    (a.section_id || null) === (b.section_id || null) &&
    (a.region_code || null) === (b.region_code || null)
  );
}

/** Returns the first conflicting reservation, or null when the candidate window is free. */
export function findCollision(
  candidate: ReservationWindow,
  existing: readonly ReservationWindow[],
  collisionMode: CollisionMode
): ReservationWindow | null {
  if (collisionMode !== "exclusive") return null;
  for (const other of existing) {
    if (candidate.reservation_id && other.reservation_id === candidate.reservation_id) continue;
    if (!ACTIVE_RESERVATION_STATUSES.has(other.status)) continue;
    if (!scopeMatches(candidate, other)) continue;
    if (rangesOverlap(candidate.start_at, candidate.end_at, other.start_at, other.end_at)) return other;
  }
  return null;
}

export function hasCollision(
  candidate: ReservationWindow,
  existing: readonly ReservationWindow[],
  collisionMode: CollisionMode
): boolean {
  return findCollision(candidate, existing, collisionMode) !== null;
}
