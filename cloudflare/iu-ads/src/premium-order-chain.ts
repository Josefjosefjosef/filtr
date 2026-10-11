/**
 * Premium order extension chain (parent → child follow-up orders).
 */
import { formatAdminPragueDateTime } from "./premium-order-workflow";

export type PremiumOrderChainMember = {
  order_id: string;
  parent_order_id: string | null;
  created_at: string;
  billed_service_start_at: string | null;
  billed_service_end_at: string | null;
  workflow_status: string;
  payment_status: string | null;
  accounting_cancelled_at: string | null;
  ad_turned_off_at: string | null;
  customer_order_code: string | null;
  order_number: string | null;
};

export async function loadPremiumOrderChainMembers(db: D1Database, orderId: string): Promise<PremiumOrderChainMember[]> {
  let rootId = orderId;
  for (let i = 0; i < 32; i++) {
    const row = await db
      .prepare("SELECT parent_order_id FROM premium_selected_orders WHERE order_id = ?")
      .bind(rootId)
      .first<{ parent_order_id: string | null }>();
    const parent = row?.parent_order_id != null && String(row.parent_order_id).trim() ? String(row.parent_order_id) : null;
    if (!parent) break;
    rootId = parent;
  }

  const members: PremiumOrderChainMember[] = [];
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const row = await db
      .prepare(
        `SELECT po.order_id, po.parent_order_id, po.created_at, po.billed_service_start_at, po.billed_service_end_at,
                po.workflow_status, po.payment_status, po.accounting_cancelled_at, po.ad_turned_off_at,
                o.customer_order_code, o.order_number
         FROM premium_selected_orders po
         JOIN orders o ON o.order_id = po.order_id
         WHERE po.order_id = ?`
      )
      .bind(id)
      .first<PremiumOrderChainMember>();
    if (!row) continue;
    members.push(row);
    const children = await db
      .prepare("SELECT order_id FROM premium_selected_orders WHERE parent_order_id = ?")
      .bind(id)
      .all<{ order_id: string }>();
    for (const ch of children.results || []) {
      if (ch.order_id && !seen.has(String(ch.order_id))) queue.push(String(ch.order_id));
    }
  }

  members.sort((a, b) => {
    const sa = Date.parse(String(a.billed_service_start_at || a.created_at || ""));
    const sb = Date.parse(String(b.billed_service_start_at || b.created_at || ""));
    return sa - sb;
  });
  return members;
}

export function premiumOrderChainTip(members: PremiumOrderChainMember[]): PremiumOrderChainMember | null {
  if (!members.length) return null;
  return members[members.length - 1];
}

export function premiumOrderChainArchive(members: PremiumOrderChainMember[], tipOrderId: string): PremiumOrderChainMember[] {
  return members.filter((m) => String(m.order_id) !== String(tipOrderId));
}

export function premiumOrderServicePeriodLabelCs(m: PremiumOrderChainMember): string | null {
  if (m.billed_service_start_at && m.billed_service_end_at) {
    return (
      formatAdminPragueDateTime(String(m.billed_service_start_at)) +
      " – " +
      formatAdminPragueDateTime(String(m.billed_service_end_at))
    );
  }
  return null;
}

export function premiumOrderReference(m: PremiumOrderChainMember): string {
  return (
    (m.customer_order_code && String(m.customer_order_code).trim()) ||
    (m.order_number && String(m.order_number).trim()) ||
    String(m.order_id)
  );
}

export type PremiumOrderConfirmationRevisionRow = {
  version: number;
  created_at: string;
  reason: string | null;
  is_current: boolean;
};

export async function loadPremiumOrderConfirmationRevisionRows(
  db: D1Database,
  orderId: string
): Promise<PremiumOrderConfirmationRevisionRow[]> {
  const activeConfDoc = await db
    .prepare(
      "SELECT document_id, version, created_at FROM documents WHERE order_id = ? AND doc_type = 'premium_order_confirmation' AND status = 'active' ORDER BY created_at DESC LIMIT 1"
    )
    .bind(orderId)
    .first<{ document_id: string; version: number; created_at: string }>();
  const archivedRevisions = activeConfDoc
    ? await db
        .prepare(
          "SELECT version, created_at, replacement_reason FROM document_content_revisions WHERE document_id = ? ORDER BY version ASC"
        )
        .bind(activeConfDoc.document_id)
        .all<{ version: number; created_at: string; replacement_reason: string | null }>()
    : { results: [] as { version: number; created_at: string; replacement_reason: string | null }[] };
  const rows: PremiumOrderConfirmationRevisionRow[] = [];
  for (const rev of archivedRevisions.results || []) {
    rows.push({
      version: Number(rev.version),
      created_at: String(rev.created_at),
      reason: rev.replacement_reason,
      is_current: false,
    });
  }
  if (activeConfDoc) {
    rows.push({
      version: Number(activeConfDoc.version),
      created_at: String(activeConfDoc.created_at),
      reason: null,
      is_current: true,
    });
  }
  rows.sort((a, b) => a.version - b.version);
  return rows;
}
