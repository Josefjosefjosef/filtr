/**
 * Operator-confirmed one-shot reset of all premium test operational data (main admin).
 * Preserves catalog, placements, admin users, system settings, placement types.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { adminRolesIncludeMainAdmin } from "./premium-admin-main-guard";
import {
  hardDeleteCampaignGraph,
  purgePremiumOrderPhysically,
  PurgeDatabaseError,
  purgeDbStep,
  sanitizePurgeDbHint,
} from "./premium-order-purge";
import type { Env } from "./types";

export const PREMIUM_TEST_RESET_CONFIRM_PHRASE = "VYMAZAT TESTOVACI DATA";

export type PremiumTestDataResetStats = {
  orders_removed: number;
  campaigns_removed: number;
  documents_removed: number;
  orphan_campaigns_removed: number;
  orphan_documents_removed: number;
  placements_cleared: number;
};

/** Delete child premium orders before parents. */
export function sortPremiumOrdersForPurge(
  rows: { order_id: string; parent_order_id: string | null }[]
): string[] {
  const remaining = new Set(rows.map((r) => r.order_id));
  const parentOf = new Map<string, string | null>();
  for (const r of rows) parentOf.set(r.order_id, r.parent_order_id);

  const ordered: string[] = [];
  while (remaining.size) {
    let picked: string | null = null;
    for (const id of remaining) {
      const hasChildStillRemaining = [...remaining].some((other) => parentOf.get(other) === id);
      if (!hasChildStillRemaining) {
        picked = id;
        break;
      }
    }
    if (!picked) {
      ordered.push(...remaining);
      break;
    }
    ordered.push(picked);
    remaining.delete(picked);
  }
  return ordered;
}

async function deleteOrphanPremiumDocuments(env: Env): Promise<number> {
  if (!env.DB) return 0;
  const db = env.DB;
  const bucket = env.DOCUMENTS;
  const docs = await db
    .prepare(
      `SELECT document_id, r2_key FROM documents
       WHERE order_id IS NOT NULL
          OR campaign_id IS NOT NULL
          OR doc_type LIKE 'premium_%'`
    )
    .bind()
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

export async function resetAllPremiumTestOperationalData(
  env: Env,
  actorUserId: string
): Promise<PremiumTestDataResetStats> {
  if (!env.DB) throw new Error("auth_not_configured");
  const db = env.DB;
  const nowIso = new Date().toISOString();
  const stats: PremiumTestDataResetStats = {
    orders_removed: 0,
    campaigns_removed: 0,
    documents_removed: 0,
    orphan_campaigns_removed: 0,
    orphan_documents_removed: 0,
    placements_cleared: 0,
  };

  const allPo = await db
    .prepare(
      `SELECT po.order_id, po.placement_id, po.published_campaign_id, po.creative_id, po.parent_order_id, o.client_id
       FROM premium_selected_orders po
       JOIN orders o ON o.order_id = po.order_id`
    )
    .bind()
    .all<{
      order_id: string;
      placement_id: string;
      published_campaign_id: string | null;
      creative_id: string | null;
      parent_order_id: string | null;
      client_id: string;
    }>();

  // Bulk reset is main-admin + confirm phrase only (operator attests all rows are non-production tests).
  // Per-order purge keeps paid-accounting guard via premiumOrderEligibleForSystemPurge.

  const orderIds = sortPremiumOrdersForPurge(allPo.results || []);

  for (const orderId of orderIds) {
    const po = (allPo.results || []).find((r) => r.order_id === orderId);
    if (!po) continue;

    const phys = await purgePremiumOrderPhysically(env, orderId);
    stats.documents_removed += phys.documents_removed;

    const campId = po.published_campaign_id;
    if (campId) {
      await db
        .prepare(
          "UPDATE premium_selected_placements SET active_campaign_id = NULL, updated_at = ? WHERE placement_id = ? AND active_campaign_id = ?"
        )
        .bind(nowIso, po.placement_id, campId)
        .run();
      await db
        .prepare(
          "UPDATE premium_selected_orders SET published_campaign_id = NULL, creative_id = NULL, updated_at = ? WHERE order_id = ?"
        )
        .bind(nowIso, orderId)
        .run();
      await hardDeleteCampaignGraph(env, campId, { skipSharedCreativeCheck: true });
      stats.campaigns_removed += 1;
    } else if (po.creative_id) {
      const cr = await db
        .prepare("SELECT r2_key FROM creatives WHERE creative_id = ? AND client_id = ?")
        .bind(po.creative_id, po.client_id)
        .first<{ r2_key: string | null }>();
      if (cr?.r2_key && env.CREATIVES) {
        try {
          await env.CREATIVES.delete(cr.r2_key);
        } catch {
          /* best effort */
        }
      }
      await db.prepare("DELETE FROM creatives WHERE creative_id = ? AND client_id = ?").bind(po.creative_id, po.client_id).run();
    }

    await purgeDbStep("reset_premium_order_notes", () =>
      db.prepare("DELETE FROM premium_order_notes WHERE order_id = ?").bind(orderId).run()
    );
    await purgeDbStep("reset_premium_order_events", () =>
      db.prepare("DELETE FROM premium_order_events WHERE order_id = ?").bind(orderId).run()
    );
    await purgeDbStep("reset_premium_order_renewals", () =>
      db.prepare("DELETE FROM premium_order_renewals WHERE order_id = ? OR follow_up_order_id = ?").bind(orderId, orderId).run()
    );
    await purgeDbStep("reset_premium_order_public_revisions", () =>
      db.prepare("DELETE FROM premium_order_public_revisions WHERE order_id = ?").bind(orderId).run()
    );
    await purgeDbStep("reset_premium_publish_events", () =>
      db.prepare("DELETE FROM premium_publish_events WHERE order_id = ?").bind(orderId).run()
    );
    await purgeDbStep("reset_premium_order_portal_codes", () =>
      db.prepare("DELETE FROM premium_order_portal_codes WHERE order_id = ?").bind(orderId).run()
    );
    await purgeDbStep("reset_premium_order_price_snapshots", () =>
      db.prepare("DELETE FROM premium_order_price_snapshots WHERE order_id = ?").bind(orderId).run()
    );
    await purgeDbStep("reset_premium_selected_orders", () =>
      db.prepare("DELETE FROM premium_selected_orders WHERE order_id = ?").bind(orderId).run()
    );
    await purgeDbStep("reset_orders", () => db.prepare("DELETE FROM orders WHERE order_id = ?").bind(orderId).run());

    stats.orders_removed += 1;
  }

  const orphanCamps = await db.prepare("SELECT campaign_id FROM campaigns").bind().all<{ campaign_id: string }>();
  for (const c of orphanCamps.results || []) {
    await hardDeleteCampaignGraph(env, c.campaign_id, { skipSharedCreativeCheck: true });
    stats.orphan_campaigns_removed += 1;
    stats.campaigns_removed += 1;
  }

  const cleared = await db
    .prepare("UPDATE premium_selected_placements SET active_campaign_id = NULL, updated_at = ? WHERE active_campaign_id IS NOT NULL")
    .bind(nowIso)
    .run();
  stats.placements_cleared = Number(cleared.meta?.changes ?? 0) || 0;

  await db.prepare("DELETE FROM complaints WHERE campaign_id IS NOT NULL").bind().run();
  await db.prepare("DELETE FROM premium_renewal_offers").bind().run();

  await db.prepare("DELETE FROM orders WHERE order_id NOT IN (SELECT order_id FROM premium_selected_orders)").bind().run();

  stats.orphan_documents_removed = await deleteOrphanPremiumDocuments(env);

  await purgeDbStep("reset_orphan_credit_notes", () =>
    db.prepare("DELETE FROM premium_credit_notes WHERE order_id NOT IN (SELECT order_id FROM premium_selected_orders)").bind().run()
  );
  await purgeDbStep("reset_orphan_invoices", () =>
    db.prepare("DELETE FROM invoices WHERE order_id NOT IN (SELECT order_id FROM orders) OR order_id IS NULL").bind().run()
  );
  await purgeDbStep("reset_orphan_contracts", () =>
    db.prepare("DELETE FROM contracts WHERE order_id IS NOT NULL AND order_id NOT IN (SELECT order_id FROM orders)").bind().run()
  );

  const orphanClients = await db
    .prepare(
      `SELECT client_id FROM clients
       WHERE client_id NOT IN (SELECT client_id FROM orders)
         AND client_id NOT IN (SELECT client_id FROM campaigns)`
    )
    .bind()
    .all<{ client_id: string }>();
  for (const row of orphanClients.results || []) {
    const clientId = row.client_id;
    await purgeDbStep("reset_orphan_client_renewal_offers", () =>
      db.prepare("DELETE FROM premium_renewal_offers WHERE client_id = ?").bind(clientId).run()
    );
    await purgeDbStep("reset_orphan_client_complaints", () =>
      db.prepare("DELETE FROM complaints WHERE client_id = ?").bind(clientId).run()
    );
    const invIds = await db
      .prepare("SELECT invoice_id FROM invoices WHERE client_id = ?")
      .bind(clientId)
      .all<{ invoice_id: string }>();
    for (const inv of invIds.results || []) {
      await purgeDbStep("reset_orphan_client_credit_notes", () =>
        db.prepare("DELETE FROM premium_credit_notes WHERE invoice_id = ?").bind(inv.invoice_id).run()
      );
    }
    await purgeDbStep("reset_orphan_client_invoices", () =>
      db.prepare("DELETE FROM invoices WHERE client_id = ?").bind(clientId).run()
    );
    await purgeDbStep("reset_orphan_client_contracts", () =>
      db.prepare("DELETE FROM contracts WHERE client_id = ?").bind(clientId).run()
    );
    const clientDocs = await db
      .prepare("SELECT document_id, r2_key FROM documents WHERE client_id = ?")
      .bind(clientId)
      .all<{ document_id: string; r2_key: string }>();
    for (const doc of clientDocs.results || []) {
      await purgeDbStep("reset_orphan_client_document_revisions", async () => {
        const revs = await db
          .prepare("SELECT r2_key FROM document_content_revisions WHERE document_id = ?")
          .bind(doc.document_id)
          .all<{ r2_key: string }>();
        for (const rev of revs.results || []) {
          if (env.DOCUMENTS && rev.r2_key) {
            try {
              await env.DOCUMENTS.delete(rev.r2_key);
            } catch {
              /* best effort */
            }
          }
        }
        await db.prepare("DELETE FROM document_content_revisions WHERE document_id = ?").bind(doc.document_id).run();
      });
      await purgeDbStep("reset_orphan_client_documents", async () => {
        if (env.DOCUMENTS && doc.r2_key) {
          try {
            await env.DOCUMENTS.delete(doc.r2_key);
          } catch {
            /* best effort */
          }
        }
        await db.prepare("DELETE FROM documents WHERE document_id = ?").bind(doc.document_id).run();
      });
    }
    const clientCreatives = await db
      .prepare("SELECT creative_id, r2_key FROM creatives WHERE client_id = ?")
      .bind(clientId)
      .all<{ creative_id: string; r2_key: string }>();
    for (const cr of clientCreatives.results || []) {
      await purgeDbStep("reset_orphan_client_creatives", async () => {
        if (env.CREATIVES && cr.r2_key) {
          try {
            await env.CREATIVES.delete(cr.r2_key);
          } catch {
            /* best effort */
          }
        }
        await db.prepare("DELETE FROM creatives WHERE creative_id = ?").bind(cr.creative_id).run();
      });
    }
    await purgeDbStep("reset_orphan_client_codes", () =>
      db
        .prepare("DELETE FROM client_code_campaigns WHERE code_id IN (SELECT code_id FROM client_access_codes WHERE client_id = ?)")
        .bind(clientId)
        .run()
    );
    await purgeDbStep("reset_orphan_client_sessions", () =>
      db
        .prepare("DELETE FROM client_sessions WHERE code_id IN (SELECT code_id FROM client_access_codes WHERE client_id = ?)")
        .bind(clientId)
        .run()
    );
    await purgeDbStep("reset_orphan_client_access_codes", () =>
      db.prepare("DELETE FROM client_access_codes WHERE client_id = ?").bind(clientId).run()
    );
    await purgeDbStep("reset_orphan_client_contacts", () =>
      db.prepare("DELETE FROM client_contacts WHERE client_id = ?").bind(clientId).run()
    );
    await purgeDbStep("reset_orphan_clients", () => db.prepare("DELETE FROM clients WHERE client_id = ?").bind(clientId).run());
  }

  return stats;
}

export async function handleAdminPremiumTestDataReset(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!adminRolesIncludeMainAdmin(guard.roles)) {
    return json({ error: "main_admin_required", message_cs: "Reset smí provést pouze hlavní administrátor." }, 403);
  }
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { confirm?: unknown; confirm_phrase?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body", message_cs: "Neplatné tělo požadavku." }, 400);
  }
  if (body.confirm !== true) {
    return json({ error: "confirmation_required", message_cs: "Potvrzení resetu je povinné." }, 400);
  }
  const phrase = typeof body.confirm_phrase === "string" ? body.confirm_phrase.trim().toUpperCase() : "";
  if (phrase !== PREMIUM_TEST_RESET_CONFIRM_PHRASE) {
    return json(
      {
        error: "confirm_phrase_required",
        message_cs: `Pro reset zadejte přesně: ${PREMIUM_TEST_RESET_CONFIRM_PHRASE}`,
      },
      400
    );
  }

  try {
    const stats = await resetAllPremiumTestOperationalData(env, guard.userId);
    await insertAuditLog(
      env.DB,
      buildAuditEntry({
        auditId: newId("aud"),
        actorUserId: guard.userId,
        operation: "premium_test_data_reset",
        objectType: "premium_system",
        objectId: "all_test_operational",
        after: stats,
        result: "success",
      })
    );
    return json({
      ok: true,
      message_cs: "Testovací provozní data byla odstraněna. Katalog pozic a administrace zůstávají beze změny.",
      stats,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const purgeStep = err instanceof PurgeDatabaseError ? err.step : undefined;
    const dbHint = sanitizePurgeDbHint(msg);
    console.error("premium_test_data_reset_failed", { purgeStep, dbHint });
    return json(
      {
        error: "reset_failed",
        purge_step: purgeStep,
        db_hint: dbHint,
        message_cs: "Reset testovacích dat nebyl dokončen — zkuste znovu nebo kontaktujte podporu.",
      },
      500
    );
  }
}
