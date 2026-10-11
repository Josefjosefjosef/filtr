/**
 * Physical purge of a premium test order (D1 + R2). Main admin only.
 */
import { parsePremiumOrderPayload } from "./premium-order-workflow";
import type { Env } from "./types";

export type PremiumSystemPurgeEligibility =
  | { ok: true; via: "dev_marker" | "explicit_test_confirmed" }
  | { ok: false; error: string; message_cs: string };

export type PremiumSystemPurgeOptions = {
  /** Main admin confirms the record is a non-production test case without paid accounting evidence. */
  explicitTestPurgeConfirmed?: boolean;
};

async function premiumOrderHasPaidAccountingEvidence(db: D1Database, orderId: string): Promise<boolean> {
  const pay = await db
    .prepare(
      `SELECT COALESCE(payment_status, 'unpaid') AS payment_status, paid_at
       FROM premium_selected_orders WHERE order_id = ?`
    )
    .bind(orderId)
    .first<{ payment_status: string; paid_at: string | null }>();
  if (pay?.payment_status === "paid" || pay?.paid_at) return true;
  const inv = await db
    .prepare("SELECT status, paid_at FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(orderId)
    .first<{ status: string | null; paid_at: string | null }>();
  return inv?.status === "paid" || !!inv?.paid_at;
}

/** Dev/E2E markers, or main-admin explicit test confirm when nothing was paid. */
export async function premiumOrderEligibleForSystemPurge(
  db: D1Database,
  orderId: string,
  options?: PremiumSystemPurgeOptions
): Promise<PremiumSystemPurgeEligibility> {
  const row = await db
    .prepare(
      `SELECT po.target_url, o.payload_json, c.company_name, c.billing_info,
              cc.email AS contact_email
       FROM premium_selected_orders po
       JOIN orders o ON o.order_id = po.order_id
       JOIN clients c ON c.client_id = o.client_id
       LEFT JOIN client_contacts cc ON cc.client_id = c.client_id AND cc.is_primary = 1
       WHERE po.order_id = ?`
    )
    .bind(orderId)
    .first<{
      target_url: string | null;
      payload_json: string | null;
      company_name: string | null;
      contact_email: string | null;
    }>();
  if (!row) return { ok: false, error: "not_found", message_cs: "Objednávka nenalezena." };

  if (await premiumOrderHasPaidAccountingEvidence(db, orderId)) {
    return {
      ok: false,
      error: "purge_paid_accounting",
      message_cs:
        "Úplné odstranění není možné u objednávky s evidovanou úhradou. Zachovejte účetní doklady a použijte archivaci.",
    };
  }

  let payloadRaw: Record<string, unknown> = {};
  try {
    payloadRaw = JSON.parse(String(row.payload_json || "{}")) as Record<string, unknown>;
  } catch {
    payloadRaw = {};
  }
  const snap = parsePremiumOrderPayload(typeof row.payload_json === "string" ? row.payload_json : null);
  void snap;

  const email = String(row.contact_email || "").toLowerCase();
  const company = String(row.company_name || "");
  const target = String(row.target_url || "");
  const devTest =
    payloadRaw.iu_dev_test === true ||
    email.endsWith("@example.invalid") ||
    /IU_TEST|iu-premium-e2e|E2E/i.test(company) ||
    target.includes("example.invalid");

  if (devTest) return { ok: true, via: "dev_marker" };

  if (options?.explicitTestPurgeConfirmed === true) {
    return { ok: true, via: "explicit_test_confirmed" };
  }

  return {
    ok: false,
    error: "purge_not_eligible",
    message_cs:
      "Úplné odstranění vyžaduje potvrzení testovacího záznamu (dev/E2E marker nebo explicitní potvrzení hlavního administrátora u neuhrazené objednávky).",
  };
}

async function deleteDocumentRowsAndR2(
  db: D1Database,
  bucket: R2Bucket | undefined,
  orderId: string
): Promise<number> {
  const docs = await db
    .prepare("SELECT document_id, r2_key FROM documents WHERE order_id = ?")
    .bind(orderId)
    .all<{ document_id: string; r2_key: string }>();
  let n = 0;
  for (const doc of docs.results || []) {
    const revs = await db
      .prepare("SELECT r2_key FROM document_content_revisions WHERE document_id = ?")
      .bind(doc.document_id)
      .all<{ r2_key: string }>();
    for (const rev of revs.results || []) {
      if (bucket && rev.r2_key) {
        try {
          await bucket.delete(rev.r2_key);
        } catch {
          /* best effort */
        }
      }
    }
    await db.prepare("DELETE FROM document_content_revisions WHERE document_id = ?").bind(doc.document_id).run();
    if (bucket && doc.r2_key) {
      try {
        await bucket.delete(doc.r2_key);
      } catch {
        /* best effort */
      }
    }
    await db.prepare("DELETE FROM documents WHERE document_id = ?").bind(doc.document_id).run();
    n++;
  }
  return n;
}

/** Remove campaign graph when no other premium order still references the campaign (purge only). */
export async function deleteExclusiveCampaignForPurge(
  env: Env,
  campId: string,
  orderId: string
): Promise<void> {
  if (!env.DB) throw new Error("auth_not_configured");
  const db = env.DB;
  const nowIso = new Date().toISOString();

  const otherOrder = await db
    .prepare("SELECT order_id FROM premium_selected_orders WHERE published_campaign_id = ? AND order_id != ? LIMIT 1")
    .bind(campId, orderId)
    .first();
  if (otherOrder) {
    await db.prepare("UPDATE campaigns SET status = 'cancelled', updated_at = ? WHERE campaign_id = ?").bind(nowIso, campId).run();
    return;
  }

  await db.prepare("DELETE FROM client_code_campaigns WHERE campaign_id = ?").bind(campId).run();
  await db.prepare("DELETE FROM client_report_snapshots WHERE campaign_id = ?").bind(campId).run();
  await db.prepare("DELETE FROM campaign_state_events WHERE campaign_id = ?").bind(campId).run();
  await db.prepare("DELETE FROM placement_reservations WHERE campaign_id = ?").bind(campId).run();
  await db.prepare("DELETE FROM rights_confirmations WHERE campaign_id = ?").bind(campId).run();
  await db.prepare("DELETE FROM premium_renewal_offers WHERE campaign_id = ?").bind(campId).run();

  const creatives = await db
    .prepare("SELECT creative_id, r2_key, client_id FROM creatives WHERE campaign_id = ?")
    .bind(campId)
    .all<{ creative_id: string; r2_key: string; client_id: string }>();
  for (const cr of creatives.results || []) {
    const shared = await db
      .prepare("SELECT COUNT(*) AS c FROM premium_selected_orders WHERE creative_id = ? AND order_id != ?")
      .bind(cr.creative_id, orderId)
      .first<{ c: number }>();
    if (Number(shared?.c)) {
      await db
        .prepare("UPDATE creatives SET campaign_id = NULL, updated_at = ? WHERE creative_id = ?")
        .bind(nowIso, cr.creative_id)
        .run();
      continue;
    }
    if (cr.r2_key && env.CREATIVES) {
      try {
        await env.CREATIVES.delete(cr.r2_key);
      } catch {
        /* best effort */
      }
    }
    await db.prepare("DELETE FROM creatives WHERE creative_id = ?").bind(cr.creative_id).run();
  }

  await db.prepare("DELETE FROM campaign_placements WHERE campaign_id = ?").bind(campId).run();
  await db.prepare("DELETE FROM campaigns WHERE campaign_id = ?").bind(campId).run();
}

export async function purgePremiumOrderPhysically(env: Env, orderId: string): Promise<{ documents_removed: number }> {
  if (!env.DB) throw new Error("auth_not_configured");
  const db = env.DB;
  const bucket = env.DOCUMENTS;

  await db.prepare("DELETE FROM contracts WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_order_document_jobs WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_credit_notes WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_order_storno_records WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_publish_events WHERE order_id = ?").bind(orderId).run();

  const invRows = await db.prepare("SELECT invoice_id FROM invoices WHERE order_id = ?").bind(orderId).all<{ invoice_id: string }>();
  for (const inv of invRows.results || []) {
    await db.prepare("DELETE FROM premium_credit_notes WHERE invoice_id = ?").bind(inv.invoice_id).run();
    await db.prepare("DELETE FROM invoices WHERE invoice_id = ?").bind(inv.invoice_id).run();
  }

  const docsRemoved = await deleteDocumentRowsAndR2(db, bucket, orderId);

  await db.prepare("DELETE FROM premium_order_notes WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_order_events WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_order_renewals WHERE order_id = ? OR follow_up_order_id = ?")
    .bind(orderId, orderId)
    .run();
  await db.prepare("DELETE FROM premium_order_public_revisions WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_order_portal_codes WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_order_price_snapshots WHERE order_id = ?").bind(orderId).run();

  return { documents_removed: docsRemoved };
}
