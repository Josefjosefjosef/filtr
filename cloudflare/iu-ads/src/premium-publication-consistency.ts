/**
 * Premium selected-services: single source of truth between D1 placement lock and public render API.
 * No visitor tracking — compares authoritative DB state only.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, newId } from "./admin-auth";
import { isPremiumCampaignLiveNow } from "./premium-display";
import type { Env } from "./types";

export const PREMIUM_PUBLICATION_AUTO_REPAIR_REASONS = new Set([
  "linked_order_rejected",
  "order_rejected",
  "order_not_published",
  "no_published_order",
  "campaign_not_live",
]);

export type PremiumPublicationAuthority = {
  authorized: boolean;
  reason_code: string;
  governing_order_id: string | null;
  workflow_status: string | null;
};

type CampaignRow = {
  campaign_id: string;
  order_id: string | null;
  status: string | null;
  end_at: string | null;
  start_at: string | null;
  target_url: string | null;
};

type PremiumOrderLinkRow = {
  order_id: string;
  workflow_status: string;
  placement_id: string;
  published_campaign_id: string | null;
};

export async function assessPremiumCampaignPublicAuthority(
  db: D1Database,
  campaignId: string,
  nowIso: string
): Promise<PremiumPublicationAuthority> {
  const camp = await db
    .prepare("SELECT campaign_id, order_id, status, end_at, start_at, target_url FROM campaigns WHERE campaign_id = ?")
    .bind(campaignId)
    .first<CampaignRow>();
  if (!camp) {
    return { authorized: false, reason_code: "campaign_missing", governing_order_id: null, workflow_status: null };
  }

  const linked = await db
    .prepare(
      "SELECT order_id, workflow_status, placement_id, published_campaign_id FROM premium_selected_orders WHERE published_campaign_id = ?"
    )
    .bind(campaignId)
    .all<PremiumOrderLinkRow>();

  const publishedApproved = (linked.results || []).filter((row) => row.workflow_status === "published");
  if (publishedApproved.length > 1) {
    return {
      authorized: false,
      reason_code: "multiple_published_orders",
      governing_order_id: publishedApproved[0]?.order_id ?? null,
      workflow_status: "published",
    };
  }

  if (publishedApproved.length === 1) {
    const live = isPremiumCampaignLiveNow({
      campaign_status: camp.status,
      target_url: camp.target_url,
      start_at: camp.start_at,
      end_at: camp.end_at,
      nowIso,
    });
    if (!live) {
      return {
        authorized: false,
        reason_code: "campaign_not_live",
        governing_order_id: publishedApproved[0].order_id,
        workflow_status: "published",
      };
    }
    return {
      authorized: true,
      reason_code: "ok",
      governing_order_id: publishedApproved[0].order_id,
      workflow_status: "published",
    };
  }

  const rejectedLink = (linked.results || []).find((row) => row.workflow_status === "rejected");
  if (rejectedLink) {
    return {
      authorized: false,
      reason_code: "linked_order_rejected",
      governing_order_id: rejectedLink.order_id,
      workflow_status: "rejected",
    };
  }

  if (camp.order_id) {
    const po = await db
      .prepare("SELECT order_id, workflow_status FROM premium_selected_orders WHERE order_id = ?")
      .bind(camp.order_id)
      .first<{ order_id: string; workflow_status: string }>();
    if (po?.workflow_status === "rejected") {
      return {
        authorized: false,
        reason_code: "order_rejected",
        governing_order_id: po.order_id,
        workflow_status: "rejected",
      };
    }
    if (po && po.workflow_status !== "published") {
      return {
        authorized: false,
        reason_code: "order_not_published",
        governing_order_id: po.order_id,
        workflow_status: po.workflow_status,
      };
    }
  }

  return { authorized: false, reason_code: "no_published_order", governing_order_id: null, workflow_status: null };
}

export async function detachPremiumCampaignFromPublicPlacement(
  db: D1Database,
  input: {
    placementId: string;
    campaignId: string;
    nowIso: string;
    actorUserId: string;
    reason: string;
  }
): Promise<boolean> {
  const placement = await db
    .prepare("SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?")
    .bind(input.placementId)
    .first<{ active_campaign_id: string | null }>();
  if (!placement) return false;

  await db
    .prepare(
      "UPDATE campaigns SET status = CASE WHEN status IN ('active','scheduled','paused') THEN 'cancelled' ELSE status END, updated_at = ? WHERE campaign_id = ?"
    )
    .bind(input.nowIso, input.campaignId)
    .run();

  if (placement.active_campaign_id === input.campaignId) {
    await db
      .prepare("UPDATE premium_selected_placements SET active_campaign_id = NULL, updated_at = ? WHERE placement_id = ? AND active_campaign_id = ?")
      .bind(input.nowIso, input.placementId, input.campaignId)
      .run();
  }

  await db
    .prepare(
      "INSERT INTO campaign_status_events (event_id, campaign_id, from_status, to_status, actor_user_id, reason, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(
      newId("cse"),
      input.campaignId,
      null,
      "cancelled",
      input.actorUserId,
      input.reason.slice(0, 500),
      input.nowIso
    )
    .run();

  return true;
}

async function collectCampaignIdsToStopForOrder(
  db: D1Database,
  input: { orderId: string; placementId: string; publishedCampaignId: string | null }
): Promise<string[]> {
  const ids = new Set<string>();
  if (input.publishedCampaignId) ids.add(input.publishedCampaignId);

  const byOrder = await db
    .prepare(
      "SELECT campaign_id FROM campaigns WHERE order_id = ? AND status IN ('active','scheduled','paused')"
    )
    .bind(input.orderId)
    .all<{ campaign_id: string }>();
  for (const row of byOrder.results || []) ids.add(row.campaign_id);

  const placement = await db
    .prepare("SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?")
    .bind(input.placementId)
    .first<{ active_campaign_id: string | null }>();
  if (placement?.active_campaign_id) {
    const camp = await db
      .prepare("SELECT campaign_id, order_id FROM campaigns WHERE campaign_id = ?")
      .bind(placement.active_campaign_id)
      .first<{ campaign_id: string; order_id: string | null }>();
    if (camp?.order_id === input.orderId) ids.add(camp.campaign_id);
  }

  return [...ids];
}

export async function executePremiumOrderReject(
  env: Env,
  input: { orderId: string; actorUserId: string; reason: string | null; idempotencyKey?: string }
): Promise<
  | { ok: true; idempotent: boolean; unpublished_campaign_ids: string[] }
  | { ok: false; status: number; error: string }
> {
  if (!env.DB) return { ok: false, status: 503, error: "auth_not_configured" };
  const db = env.DB;
  const nowIso = new Date().toISOString();

  const po = await db
    .prepare(
      "SELECT order_id, placement_id, workflow_status, published_campaign_id FROM premium_selected_orders WHERE order_id = ?"
    )
    .bind(input.orderId)
    .first<{
      order_id: string;
      placement_id: string;
      workflow_status: string;
      published_campaign_id: string | null;
    }>();
  if (!po) return { ok: false, status: 404, error: "premium_order_not_found" };

  if (po.workflow_status === "rejected") {
    return { ok: true, idempotent: true, unpublished_campaign_ids: [] };
  }

  const campaignIds = await collectCampaignIdsToStopForOrder(db, {
    orderId: po.order_id,
    placementId: po.placement_id,
    publishedCampaignId: po.published_campaign_id,
  });

  const unpublished: string[] = [];
  for (const campaignId of campaignIds) {
    await detachPremiumCampaignFromPublicPlacement(db, {
      placementId: po.placement_id,
      campaignId,
      nowIso,
      actorUserId: input.actorUserId,
      reason: input.reason ? "premium_order_rejected:" + input.reason : "premium_order_rejected",
    });
    unpublished.push(campaignId);
  }

  await db
    .prepare(
      "UPDATE premium_selected_orders SET workflow_status = 'rejected', rejection_reason = ?, updated_at = ? WHERE order_id = ?"
    )
    .bind(input.reason, nowIso, input.orderId)
    .run();

  try {
    const { appendPremiumOrderEvent } = await import("./premium-order-history");
    await appendPremiumOrderEvent(db, {
      orderId: input.orderId,
      eventType: "order_rejected",
      actorUserId: input.actorUserId,
      payload: {
        reason: input.reason,
        actor_label: input.actorUserId,
        idempotency_key: input.idempotencyKey ?? null,
        unpublished_campaign_ids: unpublished,
      },
    });
  } catch {
    /* events table optional until migration */
  }

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: input.actorUserId,
      operation: "premium_order_rejected",
      objectType: "premium_order",
      objectId: input.orderId,
      before: { workflow_status: po.workflow_status, published_campaign_id: po.published_campaign_id },
      after: { workflow_status: "rejected", rejection_reason: input.reason, unpublished_campaign_ids: unpublished },
      result: "success",
    })
  );

  return { ok: true, idempotent: false, unpublished_campaign_ids: unpublished };
}

export type PremiumPublicationConsistencyIssue = {
  placement_id: string;
  category_slug: string;
  active_campaign_id: string;
  reason_code: string;
  governing_order_id: string | null;
  auto_repair_eligible: boolean;
};

export async function scanPremiumPublicationConsistency(
  db: D1Database,
  nowIso: string
): Promise<{ issues: PremiumPublicationConsistencyIssue[]; ok: boolean }> {
  const rows = await db
    .prepare(
      "SELECT placement_id, category_slug, active_campaign_id FROM premium_selected_placements WHERE active_campaign_id IS NOT NULL"
    )
    .all<{ placement_id: string; category_slug: string; active_campaign_id: string }>();

  const issues: PremiumPublicationConsistencyIssue[] = [];
  for (const row of rows.results || []) {
    const auth = await assessPremiumCampaignPublicAuthority(db, row.active_campaign_id, nowIso);
    if (auth.authorized) continue;
    issues.push({
      placement_id: row.placement_id,
      category_slug: row.category_slug,
      active_campaign_id: row.active_campaign_id,
      reason_code: auth.reason_code,
      governing_order_id: auth.governing_order_id,
      auto_repair_eligible: PREMIUM_PUBLICATION_AUTO_REPAIR_REASONS.has(auth.reason_code),
    });
  }
  return { issues, ok: issues.length === 0 };
}

export async function repairPremiumPublicationConsistency(
  env: Env,
  input: { actorUserId: string; nowIso?: string }
): Promise<{ repaired: number; incidents: PremiumPublicationConsistencyIssue[] }> {
  if (!env.DB) return { repaired: 0, incidents: [] };
  const db = env.DB;
  const nowIso = input.nowIso ?? new Date().toISOString();
  const scan = await scanPremiumPublicationConsistency(db, nowIso);
  let repaired = 0;
  const incidents: PremiumPublicationConsistencyIssue[] = [];

  for (const issue of scan.issues) {
    if (!issue.auto_repair_eligible) {
      incidents.push(issue);
      continue;
    }
    await detachPremiumCampaignFromPublicPlacement(db, {
      placementId: issue.placement_id,
      campaignId: issue.active_campaign_id,
      nowIso,
      actorUserId: input.actorUserId,
      reason: "consistency_auto_repair:" + issue.reason_code,
    });
    repaired++;
  }

  return { repaired, incidents };
}

export function premiumPublicationMismatchLabelCs(reasonCode: string): string {
  switch (reasonCode) {
    case "linked_order_rejected":
      return "Veřejná reklama navázaná na zamítnutou objednávku";
    case "order_rejected":
      return "Kampaň patří zamítnuté objednávce";
    case "order_not_published":
      return "Kampaň bez schválené a zveřejněné objednávky";
    case "no_published_order":
      return "Aktivní kampaň bez platné publikační objednávky";
    case "multiple_published_orders":
      return "Více zveřejněných objednávek ke stejné kampani — vyžaduje ruční řešení";
    case "campaign_not_live":
      return "Kampaň není v aktivním veřejném období";
    default:
      return "Nesoulad veřejné publikace a administrace";
  }
}

export async function buildPremiumOrderPublicationVisibility(
  db: D1Database,
  input: {
    orderId: string;
    placementId: string;
    workflowStatus: string;
    publishedCampaignId: string | null;
    campaignStatus: string | null;
    campaignEndAt: string | null;
    campaignStartAt: string | null;
    targetUrl: string | null;
    nowIso: string;
  }
): Promise<Record<string, unknown>> {
  const placementRow = await db
    .prepare("SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?")
    .bind(input.placementId)
    .first<{ active_campaign_id: string | null }>();
  const placementActiveCampaignId = placementRow?.active_campaign_id ?? null;

  let publishedAuthority: PremiumPublicationAuthority | null = null;
  if (input.publishedCampaignId) {
    publishedAuthority = await assessPremiumCampaignPublicAuthority(db, input.publishedCampaignId, input.nowIso);
  }

  let activeAuthority: PremiumPublicationAuthority | null = null;
  if (placementActiveCampaignId) {
    activeAuthority = await assessPremiumCampaignPublicAuthority(db, placementActiveCampaignId, input.nowIso);
  }

  const orderApprovedPublished = input.workflowStatus === "published";
  const placementMatchesOrderCampaign =
    !!input.publishedCampaignId && placementActiveCampaignId === input.publishedCampaignId;
  const expectedInPublicOutput =
    orderApprovedPublished && placementMatchesOrderCampaign && (publishedAuthority?.authorized ?? false);
  const publicOutputVerified =
    !!placementActiveCampaignId && (activeAuthority?.authorized ?? false) && placementMatchesOrderCampaign;
  const consistencyMismatch =
    !!placementActiveCampaignId &&
    !(activeAuthority?.authorized ?? false) &&
    (input.workflowStatus === "rejected" ||
      !orderApprovedPublished ||
      !placementMatchesOrderCampaign ||
      (publishedAuthority != null && !publishedAuthority.authorized));

  return {
    order_approved_published: orderApprovedPublished,
    placement_active_campaign_id: placementActiveCampaignId,
    order_published_campaign_id: input.publishedCampaignId,
    placement_matches_order_campaign: placementMatchesOrderCampaign,
    expected_in_public_output: expectedInPublicOutput,
    public_output_verified: publicOutputVerified,
    consistency_mismatch: consistencyMismatch,
    mismatch_reason_code: consistencyMismatch ? activeAuthority?.reason_code ?? publishedAuthority?.reason_code ?? null : null,
    mismatch_reason_cs: consistencyMismatch
      ? premiumPublicationMismatchLabelCs(activeAuthority?.reason_code ?? publishedAuthority?.reason_code ?? "")
      : null,
    publication_source: input.publishedCampaignId ? "premium_publish_campaign" : null,
  };
}
