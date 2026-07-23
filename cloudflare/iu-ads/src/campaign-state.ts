/**
 * Campaign status state machine (Etapa 4, kap. 13). Pure, testable transition rules +
 * gating predicates only — `admin-campaigns.ts` applies them, enforces RBAC via
 * `requireAdminPermission`, and records every transition in `campaign_status_events`.
 */

export const CAMPAIGN_STATUSES = [
  "draft",
  "awaiting_assets",
  "awaiting_legal",
  "awaiting_tech",
  "awaiting_approval",
  "approved",
  "scheduled",
  "active",
  "paused",
  "ended",
  "cancelled",
  "archived",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === "string" && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/**
 * Forward pipeline draft -> ... -> active, with a step-back edge for corrections and a
 * `cancelled` escape hatch from every non-terminal state (05-database-model.md#stavy-kampane).
 * `archived` is the terminal sink reachable only from `ended`/`cancelled`.
 */
const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["awaiting_assets", "cancelled"],
  awaiting_assets: ["awaiting_legal", "draft", "cancelled"],
  awaiting_legal: ["awaiting_tech", "awaiting_assets", "cancelled"],
  awaiting_tech: ["awaiting_approval", "awaiting_legal", "cancelled"],
  awaiting_approval: ["approved", "awaiting_tech", "cancelled"],
  approved: ["scheduled", "awaiting_approval", "cancelled"],
  scheduled: ["active", "approved", "cancelled"],
  active: ["paused", "ended", "cancelled"],
  paused: ["active", "ended", "cancelled"],
  ended: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

export function allowedNextStatuses(from: CampaignStatus): readonly CampaignStatus[] {
  return TRANSITIONS[from] || [];
}

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return allowedNextStatuses(from).includes(to);
}

export function isTerminalStatus(status: CampaignStatus): boolean {
  return allowedNextStatuses(status).length === 0;
}

/**
 * Entering any of these requires the `campaigns.activate` permission on top of
 * `campaigns.write` — `ads_manager`/`main_admin` only; `sales` is denied (kap. 4/7:
 * "aktivace reklamy jen se schválením").
 */
export const ACTIVATE_GATE_STATUSES: readonly CampaignStatus[] = ["approved", "scheduled", "active"];

export function requiresActivatePermission(to: CampaignStatus): boolean {
  return (ACTIVATE_GATE_STATUSES as readonly string[]).includes(to);
}

/**
 * Entering `active` requires at least one recorded `rights_confirmations` row for the
 * campaign (kap. 30) — checked against the DB by `admin-campaigns.ts`, not here.
 */
export const RIGHTS_REQUIRED_STATUSES: readonly CampaignStatus[] = ["active"];

export function requiresRightsConfirmation(to: CampaignStatus): boolean {
  return (RIGHTS_REQUIRED_STATUSES as readonly string[]).includes(to);
}
