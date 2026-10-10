/**
 * Definitive ad turn-off: unpublish + release placement; does NOT cancel order or invoice.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, newId } from "./admin-auth";
import { appendPremiumOrderEvent } from "./premium-order-history";
import {
  collectCampaignIdsToStopForOrder,
  detachPremiumCampaignFromPublicPlacement,
} from "./premium-publication-consistency";
import type { Env } from "./types";

export type PremiumAdTurnOffResult =
  | { ok: true; idempotent: boolean; unpublished_campaign_ids: string[] }
  | { ok: false; status: number; error: string; message_cs?: string };

export async function executePremiumAdTurnOff(
  env: Env,
  input: { orderId: string; actorUserId: string; reason: string; idempotencyKey?: string }
): Promise<PremiumAdTurnOffResult> {
  if (!env.DB) return { ok: false, status: 503, error: "auth_not_configured" };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, status: 400, error: "reason_required" };

  const db = env.DB;
  const nowIso = new Date().toISOString();

  const po = await db
    .prepare(
      `SELECT order_id, placement_id, workflow_status, published_campaign_id, ad_turned_off_at
       FROM premium_selected_orders WHERE order_id = ?`
    )
    .bind(input.orderId)
    .first<{
      order_id: string;
      placement_id: string;
      workflow_status: string;
      published_campaign_id: string | null;
      ad_turned_off_at: string | null;
    }>();
  if (!po) return { ok: false, status: 404, error: "premium_order_not_found" };
  if (po.workflow_status !== "published") {
    return {
      ok: false,
      status: 409,
      error: "not_published",
      message_cs: "Vypnout reklamu lze pouze u schválené a zveřejněné objednávky.",
    };
  }
  if (po.ad_turned_off_at) {
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
      reason: "premium_ad_turned_off:" + reason.slice(0, 400),
    });
    unpublished.push(campaignId);
  }

  await db
    .prepare(
      `UPDATE premium_selected_orders SET ad_turned_off_at = ?, ad_turned_off_by = ?, ad_turn_off_reason = ?,
       admin_paused_at = NULL, admin_paused_by = NULL, admin_pause_reason = NULL, updated_at = ?
       WHERE order_id = ? AND ad_turned_off_at IS NULL`
    )
    .bind(nowIso, input.actorUserId, reason, nowIso, input.orderId)
    .run();

  await appendPremiumOrderEvent(db, {
    orderId: input.orderId,
    eventType: "ad_turned_off",
    actorUserId: input.actorUserId,
    payload: {
      reason,
      actor_label: input.actorUserId,
      idempotency_key: input.idempotencyKey ?? null,
      unpublished_campaign_ids: unpublished,
    },
  });

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: input.actorUserId,
      operation: "premium_ad_turned_off",
      objectType: "premium_order",
      objectId: input.orderId,
      before: { ad_turned_off_at: null, published_campaign_id: po.published_campaign_id },
      after: { ad_turned_off_at: nowIso, unpublished_campaign_ids: unpublished },
      result: "success",
    })
  );

  return { ok: true, idempotent: false, unpublished_campaign_ids: unpublished };
}

export function premiumAdTurnOffBlocksResume(po: { ad_turned_off_at?: string | null }): boolean {
  return !!po.ad_turned_off_at;
}
