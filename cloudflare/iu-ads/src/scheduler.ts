/**
 * Auto scheduled->active / active->ended transitions (Etapa 5, kap. 14). The predicates below are
 * pure and unit-testable without D1; `runAutoScheduler` is a best-effort DB runner invoked from the
 * public delivery path (`delivery-engine.ts`) — callers must swallow its errors, since a scheduler
 * failure must never block or corrupt delivery. It mirrors the same invariants `admin-campaigns.ts`
 * enforces for manual transitions: the state machine graph (`campaign-state.ts`) and the
 * rights-confirmation gate before entering `active` (kap. 30) — never auto-activates around it.
 */
import { insertAuditLog, newId } from "./admin-auth";
import { buildAuditEntry } from "./audit";
import { canTransition, isCampaignStatus, requiresRightsConfirmation } from "./campaign-state";

export type SchedulableCampaign = {
  campaign_id: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
};

/** ISO-8601 timestamps compare correctly as strings, so no Date parsing is needed here. */
export function shouldAutoActivate(campaign: SchedulableCampaign, nowIso: string): boolean {
  return campaign.status === "scheduled" && !!campaign.start_at && campaign.start_at <= nowIso;
}

export function shouldAutoEnd(campaign: SchedulableCampaign, nowIso: string): boolean {
  return campaign.status === "active" && !!campaign.end_at && campaign.end_at <= nowIso;
}

export type SchedulerResult = { activated: string[]; ended: string[]; skipped: string[] };

async function hasRightsConfirmation(db: D1Database, campaignId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT confirmation_id FROM rights_confirmations WHERE campaign_id = ? LIMIT 1")
    .bind(campaignId)
    .first();
  return !!row;
}

async function applyTransition(
  db: D1Database,
  campaign: SchedulableCampaign,
  to: "active" | "ended",
  nowIso: string,
  reason: "auto_start" | "auto_end"
): Promise<void> {
  const from = campaign.status;
  const actualStartAt = to === "active" ? nowIso : null;
  const actualEndAt = to === "ended" ? nowIso : null;
  await db
    .prepare(
      "UPDATE campaigns SET status = ?, actual_start_at = COALESCE(actual_start_at, ?), actual_end_at = COALESCE(actual_end_at, ?), updated_at = ? WHERE campaign_id = ?"
    )
    .bind(to, actualStartAt, actualEndAt, nowIso, campaign.campaign_id)
    .run();

  await db
    .prepare(
      "INSERT INTO campaign_status_events (event_id, campaign_id, from_status, to_status, actor_user_id, reason, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(newId("cse"), campaign.campaign_id, from, to, null, reason, nowIso)
    .run();

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: null,
      operation: "campaign_status_transitioned",
      objectType: "campaign",
      objectId: campaign.campaign_id,
      before: { status: from },
      after: { status: to, reason },
      result: "success",
    })
  );
}

/**
 * Scans `scheduled`/`active` campaigns and flips any that have crossed their `start_at`/`end_at`
 * boundary. Fail-closed: skips (never force-activates) a campaign missing its required
 * `rights_confirmations` row, and skips anything outside the documented state graph.
 */
export async function runAutoScheduler(db: D1Database, nowIso: string): Promise<SchedulerResult> {
  const result: SchedulerResult = { activated: [], ended: [], skipped: [] };
  const candidates = await db
    .prepare("SELECT campaign_id, status, start_at, end_at FROM campaigns WHERE status = 'scheduled' OR status = 'active'")
    .all<SchedulableCampaign>();

  for (const campaign of candidates.results || []) {
    if (!isCampaignStatus(campaign.status)) continue;

    if (shouldAutoActivate(campaign, nowIso)) {
      if (!canTransition(campaign.status, "active")) {
        result.skipped.push(campaign.campaign_id);
        continue;
      }
      if (requiresRightsConfirmation("active") && !(await hasRightsConfirmation(db, campaign.campaign_id))) {
        result.skipped.push(campaign.campaign_id);
        continue;
      }
      await applyTransition(db, campaign, "active", nowIso, "auto_start");
      result.activated.push(campaign.campaign_id);
      continue;
    }

    if (shouldAutoEnd(campaign, nowIso)) {
      if (!canTransition(campaign.status, "ended")) {
        result.skipped.push(campaign.campaign_id);
        continue;
      }
      await applyTransition(db, campaign, "ended", nowIso, "auto_end");
      result.ended.push(campaign.campaign_id);
    }
  }

  return result;
}
