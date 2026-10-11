/**
 * Physical purge of a premium test order (D1 + R2). Main admin only.
 */
import { parsePremiumOrderPayload } from "./premium-order-workflow";
import type { Env } from "./types";

/** Thrown when a purge SQL step fails; step is safe to expose to main admins. */
export class PurgeDatabaseError extends Error {
  readonly step: string;

  constructor(step: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(msg);
    this.name = "PurgeDatabaseError";
    this.step = step;
  }
}

export function sanitizePurgeDbHint(message: string): string | undefined {
  const m = message;
  if (/no such table:\s*(\S+)/i.test(m)) return "sqlite_no_such_table";
  if (/FOREIGN KEY constraint failed/i.test(m)) return "sqlite_foreign_key";
  if (/SQLITE_CONSTRAINT/i.test(m)) return "sqlite_constraint";
  if (/UNIQUE constraint failed/i.test(m)) return "sqlite_unique";
  return undefined;
}

async function purgeDbStep(step: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    throw new PurgeDatabaseError(step, err);
  }
}

export type PremiumSystemPurgeEligibility =
  | { ok: true; via: "dev_marker" | "explicit_test_confirmed" }
  | { ok: false; error: string; message_cs: string };

export type PremiumSystemPurgeOptions = {
  /** Main admin confirms the record is a non-production test case without paid accounting evidence. */
  explicitTestPurgeConfirmed?: boolean;
};

export async function premiumOrderHasPaidAccountingEvidence(db: D1Database, orderId: string): Promise<boolean> {
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
  orderId: string,
  campaignId?: string | null
): Promise<number> {
  const byOrder = await db
    .prepare("SELECT document_id, r2_key FROM documents WHERE order_id = ?")
    .bind(orderId)
    .all<{ document_id: string; r2_key: string }>();
  const byCampaign =
    campaignId && campaignId.length
      ? await db
          .prepare(
            "SELECT document_id, r2_key FROM documents WHERE campaign_id = ? AND (order_id IS NULL OR order_id != ?)"
          )
          .bind(campaignId, orderId)
          .all<{ document_id: string; r2_key: string }>()
      : { results: [] as { document_id: string; r2_key: string }[] };
  const seen = new Set<string>();
  const docs: { document_id: string; r2_key: string }[] = [];
  for (const row of [...(byOrder.results || []), ...(byCampaign.results || [])]) {
    if (seen.has(row.document_id)) continue;
    seen.add(row.document_id);
    docs.push(row);
  }
  let n = 0;
  for (const doc of docs) {
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

/** Hard-delete campaign graph (R2 creatives + D1 dependents). Used for exclusive purge and operator reset. */
export async function hardDeleteCampaignGraph(
  env: Env,
  campId: string,
  options?: { orderIdForCreativeSharing?: string | null; skipSharedCreativeCheck?: boolean }
): Promise<void> {
  if (!env.DB) throw new Error("auth_not_configured");
  const db = env.DB;
  const orderId = options?.orderIdForCreativeSharing ?? "";
  const skipShared = options?.skipSharedCreativeCheck === true;

  await purgeDbStep("campaign_client_code_links", () =>
    db.prepare("DELETE FROM client_code_campaigns WHERE campaign_id = ?").bind(campId).run()
  );
  await purgeDbStep("campaign_report_snapshots", () =>
    db.prepare("DELETE FROM client_report_snapshots WHERE campaign_id = ?").bind(campId).run()
  );
  await purgeDbStep("campaign_status_events", () =>
    db.prepare("DELETE FROM campaign_status_events WHERE campaign_id = ?").bind(campId).run()
  );
  await purgeDbStep("campaign_placement_reservations", () =>
    db.prepare("DELETE FROM placement_reservations WHERE campaign_id = ?").bind(campId).run()
  );
  await purgeDbStep("campaign_rights_confirmations", () =>
    db.prepare("DELETE FROM rights_confirmations WHERE campaign_id = ?").bind(campId).run()
  );
  await purgeDbStep("campaign_renewal_offers", () =>
    db.prepare("DELETE FROM premium_renewal_offers WHERE campaign_id = ?").bind(campId).run()
  );

  const creatives = await db
    .prepare("SELECT creative_id, r2_key, client_id FROM creatives WHERE campaign_id = ?")
    .bind(campId)
    .all<{ creative_id: string; r2_key: string; client_id: string }>();
  const nowIso = new Date().toISOString();
  for (const cr of creatives.results || []) {
    if (!skipShared) {
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
    }
    if (cr.r2_key && env.CREATIVES) {
      try {
        await env.CREATIVES.delete(cr.r2_key);
      } catch {
        /* best effort */
      }
    }
    await purgeDbStep("campaign_creative", () =>
      db.prepare("DELETE FROM creatives WHERE creative_id = ?").bind(cr.creative_id).run()
    );
  }

  await purgeDbStep("campaign_placements", () =>
    db.prepare("DELETE FROM campaign_placements WHERE campaign_id = ?").bind(campId).run()
  );
  await purgeDbStep("campaign_row", () => db.prepare("DELETE FROM campaigns WHERE campaign_id = ?").bind(campId).run());
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

  await hardDeleteCampaignGraph(env, campId, { orderIdForCreativeSharing: orderId, skipSharedCreativeCheck: false });
}

export async function purgePremiumOrderPhysically(env: Env, orderId: string): Promise<{ documents_removed: number }> {
  if (!env.DB) throw new Error("auth_not_configured");
  const db = env.DB;
  const bucket = env.DOCUMENTS;

  const poRow = await db
    .prepare("SELECT published_campaign_id FROM premium_selected_orders WHERE order_id = ?")
    .bind(orderId)
    .first<{ published_campaign_id: string | null }>();
  const campaignId = poRow?.published_campaign_id ?? null;

  await purgeDbStep("order_contracts", () => db.prepare("DELETE FROM contracts WHERE order_id = ?").bind(orderId).run());
  await purgeDbStep("order_document_jobs", () =>
    db.prepare("DELETE FROM premium_order_document_jobs WHERE order_id = ?").bind(orderId).run()
  );
  await purgeDbStep("order_credit_notes", () =>
    db.prepare("DELETE FROM premium_credit_notes WHERE order_id = ?").bind(orderId).run()
  );
  await purgeDbStep("order_storno_records", () =>
    db.prepare("DELETE FROM premium_order_storno_records WHERE order_id = ?").bind(orderId).run()
  );
  await purgeDbStep("order_publish_events", () =>
    db.prepare("DELETE FROM premium_publish_events WHERE order_id = ?").bind(orderId).run()
  );

  const invRows = await db.prepare("SELECT invoice_id FROM invoices WHERE order_id = ?").bind(orderId).all<{ invoice_id: string }>();
  for (const inv of invRows.results || []) {
    await purgeDbStep("order_invoice_credit_notes", () =>
      db.prepare("DELETE FROM premium_credit_notes WHERE invoice_id = ?").bind(inv.invoice_id).run()
    );
    await purgeDbStep("order_invoices", () =>
      db.prepare("DELETE FROM invoices WHERE invoice_id = ?").bind(inv.invoice_id).run()
    );
  }

  let docsRemoved = 0;
  await purgeDbStep("order_documents", async () => {
    docsRemoved = await deleteDocumentRowsAndR2(db, bucket, orderId, campaignId);
  });

  await purgeDbStep("order_notes", () => db.prepare("DELETE FROM premium_order_notes WHERE order_id = ?").bind(orderId).run());
  await purgeDbStep("order_events", () => db.prepare("DELETE FROM premium_order_events WHERE order_id = ?").bind(orderId).run());
  await purgeDbStep("order_renewals", () =>
    db.prepare("DELETE FROM premium_order_renewals WHERE order_id = ? OR follow_up_order_id = ?").bind(orderId, orderId).run()
  );
  await purgeDbStep("order_public_revisions", () =>
    db.prepare("DELETE FROM premium_order_public_revisions WHERE order_id = ?").bind(orderId).run()
  );
  await purgeDbStep("order_portal_codes", () =>
    db.prepare("DELETE FROM premium_order_portal_codes WHERE order_id = ?").bind(orderId).run()
  );
  await purgeDbStep("order_price_snapshots", () =>
    db.prepare("DELETE FROM premium_order_price_snapshots WHERE order_id = ?").bind(orderId).run()
  );

  return { documents_removed: docsRemoved };
}
