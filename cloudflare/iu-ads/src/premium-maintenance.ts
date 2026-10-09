/**
 * Premium maintenance: expiry sync, renewal offers (cron-safe).
 */
import { addCalendarDaysFromIso } from "./premium-selected-services";
import { resumePremiumOrderDocuments } from "./premium-order-documents";
import { repairPremiumPublicationConsistency } from "./premium-publication-consistency";
import type { Env } from "./types";

async function getSetting(db: D1Database, key: string, fallback: number): Promise<number> {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first<{ value: string }>();
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function runPremiumMaintenance(env: Env): Promise<{
  cleared: number;
  offers: number;
  document_jobs_healed: number;
  publication_repaired: number;
  publication_incidents: number;
}> {
  if (!env.DB) return { cleared: 0, offers: 0, document_jobs_healed: 0, publication_repaired: 0, publication_incidents: 0 };
  const db = env.DB;
  const nowIso = new Date().toISOString();
  let document_jobs_healed = 0;

  if (env.DOCUMENTS) {
    const staleCutoff = new Date(Date.now() - 90_000).toISOString();
    const stuck = await db
      .prepare(
        `SELECT j.order_id FROM premium_order_document_jobs j
         JOIN premium_selected_orders po ON po.order_id = j.order_id
         WHERE po.workflow_status = 'published'
         AND j.status IN ('generating', 'pending', 'error')
         AND (j.status != 'generating' OR j.updated_at <= ?)
         ORDER BY j.updated_at ASC
         LIMIT 3`
      )
      .bind(staleCutoff)
      .all<{ order_id: string }>();
    for (const row of stuck.results || []) {
      try {
        const r = await resumePremiumOrderDocuments(env, row.order_id, "system:premium_maintenance");
        if (r.ok) document_jobs_healed++;
      } catch {
        /* cron-safe */
      }
    }
  }

  const expired = await db
    .prepare(
      `SELECT p.placement_id, p.active_campaign_id
       FROM premium_selected_placements p
       JOIN campaigns c ON c.campaign_id = p.active_campaign_id
       WHERE p.active_campaign_id IS NOT NULL AND c.end_at IS NOT NULL AND c.end_at <= ?`
    )
    .bind(nowIso)
    .all<{ placement_id: string; active_campaign_id: string }>();

  const dueScheduled = await db
    .prepare(
      `SELECT campaign_id, order_id FROM campaigns
       WHERE pricing_model = 'premium_selected_services_v1' AND status = 'scheduled' AND start_at <= ?`
    )
    .bind(nowIso)
    .all<{ campaign_id: string; order_id: string | null }>();

  for (const row of dueScheduled.results || []) {
    await db
      .prepare("UPDATE campaigns SET status = 'active', actual_start_at = ?, updated_at = ? WHERE campaign_id = ?")
      .bind(nowIso, nowIso, row.campaign_id)
      .run();
    const po = await db
      .prepare("SELECT placement_id FROM premium_selected_orders WHERE published_campaign_id = ? OR order_id = ?")
      .bind(row.campaign_id, row.order_id || "")
      .first<{ placement_id: string }>();
    if (po?.placement_id) {
      await db
        .prepare("UPDATE premium_selected_placements SET active_campaign_id = ?, updated_at = ? WHERE placement_id = ?")
        .bind(row.campaign_id, nowIso, po.placement_id)
        .run();
    }
  }

  let cleared = 0;
  for (const row of expired.results || []) {
    await db.prepare("UPDATE campaigns SET status = 'ended', updated_at = ? WHERE campaign_id = ? AND status IN ('active','paused','scheduled')")
      .bind(nowIso, row.active_campaign_id)
      .run();
    await db
      .prepare("UPDATE premium_selected_placements SET active_campaign_id = NULL, updated_at = ? WHERE placement_id = ?")
      .bind(nowIso, row.placement_id)
      .run();
    cleared++;
  }

  const offerDays = await getSetting(db, "PREMIUM_RENEWAL_OFFER_DAYS_BEFORE_END", 30);
  const windowDays = await getSetting(db, "PREMIUM_RENEWAL_WINDOW_DAYS", 14);
  const horizonStart = addCalendarDaysFromIso(nowIso, offerDays);
  const horizonEnd = addCalendarDaysFromIso(nowIso, offerDays + 1);

  const campaigns = await db
    .prepare(
      `SELECT c.campaign_id, c.client_id, c.end_at, po.placement_id, p.current_price_cents, p.currency
       FROM campaigns c
       JOIN premium_selected_orders po ON po.published_campaign_id = c.campaign_id
       JOIN premium_selected_placements p ON p.placement_id = po.placement_id
       WHERE c.pricing_model = 'premium_selected_services_v1' AND c.status = 'active'
       AND c.end_at >= ? AND c.end_at < ?`
    )
    .bind(nowIso, horizonEnd)
    .all<{
      campaign_id: string;
      client_id: string;
      end_at: string;
      placement_id: string;
      current_price_cents: number;
      currency: string;
    }>();

  let offers = 0;
  for (const camp of campaigns.results || []) {
    const existing = await db
      .prepare("SELECT offer_id FROM premium_renewal_offers WHERE campaign_id = ? AND status = 'offered' LIMIT 1")
      .bind(camp.campaign_id)
      .first();
    if (existing) continue;
    const offerId = "pro_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const windowEnd = addCalendarDaysFromIso(nowIso, windowDays);
    await db
      .prepare(
        "INSERT INTO premium_renewal_offers (offer_id, campaign_id, client_id, placement_id, offered_price_cents, currency, window_start_at, window_end_at, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      )
      .bind(
        offerId,
        camp.campaign_id,
        camp.client_id,
        camp.placement_id,
        camp.current_price_cents,
        camp.currency || "CZK",
        nowIso,
        windowEnd,
        "offered",
        nowIso,
        nowIso
      )
      .run();
    offers++;
  }

  const publicationRepair = await repairPremiumPublicationConsistency(env, {
    actorUserId: "system:premium_maintenance",
  });

  return {
    cleared,
    offers,
    document_jobs_healed,
    publication_repaired: publicationRepair.repaired,
    publication_incidents: publicationRepair.incidents.length,
  };
}
