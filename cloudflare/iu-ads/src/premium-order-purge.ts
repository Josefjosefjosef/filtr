/**
 * Physical purge of a premium test order (D1 + R2). Main admin only.
 */
import type { Env } from "./types";

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

export async function purgePremiumOrderPhysically(env: Env, orderId: string): Promise<{ documents_removed: number }> {
  if (!env.DB) throw new Error("auth_not_configured");
  const db = env.DB;
  const bucket = env.DOCUMENTS;

  await db.prepare("DELETE FROM premium_order_document_jobs WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_credit_notes WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_order_storno_records WHERE order_id = ?").bind(orderId).run();
  await db.prepare("DELETE FROM premium_publish_events WHERE order_id = ?").bind(orderId).run();

  const invRows = await db.prepare("SELECT invoice_id FROM invoices WHERE order_id = ?").bind(orderId).all<{ invoice_id: string }>();
  for (const inv of invRows.results || []) {
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
