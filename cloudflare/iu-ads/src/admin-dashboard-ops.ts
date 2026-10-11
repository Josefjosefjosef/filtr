/**
 * Provozní KPI pro Dashboard administrace (reklamní objednávky, faktury — bez analytiky návštěvnosti).
 */
import { countPendingPremiumOrders } from "./premium-order-workflow";
import { AD_PRODUCT_BANNER_PC_RIGHT } from "./admin-ad-products";

export type AdminDashboardOpsV1 = {
  new_orders_pending: { count: number; highlight: boolean };
  awaiting_payment: { count: number; total_unpaid_cents: number; vat_note_cs: string };
  active_premium_buttons: { count: number };
  active_banners: { count: number; status_cs: string };
  ending_within_14_days: { count: number };
  ads_turned_off: { count: number };
  invoiced_this_month: { net_cents: number; credit_cents: number; vat_note_cs: string };
  paid_this_month: { total_cents: number; vat_note_cs: string };
};

function pragueMonthBoundsUtc(now: Date): { startIso: string; endIso: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value || "1970";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const start = new Date(`${y}-${m}-01T00:00:00+01:00`);
  const endMonth = Number(m) === 12 ? 1 : Number(m) + 1;
  const endYear = Number(m) === 12 ? Number(y) + 1 : Number(y);
  const end = new Date(
    `${String(endYear).padStart(4, "0")}-${String(endMonth).padStart(2, "0")}-01T00:00:00+01:00`
  );
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function loadAdminDashboardOpsV1(db: D1Database, nowIso: string): Promise<AdminDashboardOpsV1> {
  const nowMs = Date.parse(nowIso);
  const in14 = new Date(nowMs + 14 * 86400000).toISOString();
  const pending = await countPendingPremiumOrders(db);

  const unpaidRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(inv.total_cents), 0) AS total_cents
       FROM premium_selected_orders po
       JOIN invoices inv ON inv.order_id = po.order_id
       WHERE po.workflow_status = 'published'
         AND COALESCE(po.payment_status, 'unpaid') != 'paid'
         AND inv.status IN ('issued', 'sent', 'overdue')
         AND inv.paid_at IS NULL`
    )
    .first<{ cnt: number; total_cents: number }>();

  const activeButtons = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM premium_selected_orders po
       JOIN campaigns c ON c.campaign_id = po.published_campaign_id
       WHERE po.workflow_status = 'published'
         AND po.ad_turned_off_at IS NULL
         AND c.status = 'active'
         AND c.end_at > ?`
    )
    .bind(nowIso)
    .first<{ cnt: number }>();

  const ending14 = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM premium_selected_orders po
       JOIN campaigns c ON c.campaign_id = po.published_campaign_id
       WHERE po.workflow_status = 'published'
         AND po.ad_turned_off_at IS NULL
         AND c.status = 'active'
         AND c.end_at > ?
         AND c.end_at <= ?`
    )
    .bind(nowIso, in14)
    .first<{ cnt: number }>();

  const turnedOff = await db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM premium_selected_orders WHERE ad_turned_off_at IS NOT NULL AND workflow_status = 'published'"
    )
    .first<{ cnt: number }>();

  const { startIso, endIso } = pragueMonthBoundsUtc(new Date(nowIso));
  const invoicedRow = await db
    .prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS issued_cents
       FROM invoices WHERE issued_at >= ? AND issued_at < ? AND status NOT IN ('draft','cancelled')`
    )
    .bind(startIso, endIso)
    .first<{ issued_cents: number }>();
  const creditRow = await db
    .prepare(
      `SELECT COALESCE(SUM(ABS(correction_cents)), 0) AS credit_cents
       FROM premium_credit_notes WHERE created_at >= ? AND created_at < ?`
    )
    .bind(startIso, endIso)
    .first<{ credit_cents: number }>();

  const paidRow = await db
    .prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS paid_cents
       FROM invoices WHERE paid_at >= ? AND paid_at < ? AND status = 'paid'`
    )
    .bind(startIso, endIso)
    .first<{ paid_cents: number }>();

  const issued = Number(invoicedRow?.issued_cents) || 0;
  const credit = Number(creditRow?.credit_cents) || 0;

  return {
    new_orders_pending: { count: pending, highlight: pending > 0 },
    awaiting_payment: {
      count: Number(unpaidRow?.cnt) || 0,
      total_unpaid_cents: Number(unpaidRow?.total_cents) || 0,
      vat_note_cs: "Částky bez DPH (dodavatel není plátce DPH).",
    },
    active_premium_buttons: { count: Number(activeButtons?.cnt) || 0 },
    active_banners: { count: 0, status_cs: "Připravuje se" },
    ending_within_14_days: { count: Number(ending14?.cnt) || 0 },
    ads_turned_off: { count: Number(turnedOff?.cnt) || 0 },
    invoiced_this_month: {
      net_cents: Math.max(0, issued - credit),
      credit_cents: credit,
      vat_note_cs: "Fakturováno tento měsíc — částky bez DPH, po odečtení dobropisů.",
    },
    paid_this_month: {
      total_cents: Number(paidRow?.paid_cents) || 0,
      vat_note_cs: "Uhrazeno tento měsíc — skutečně evidované platby, bez DPH.",
    },
  };
}

export type AdminAttentionItem = {
  kind: string;
  label_cs: string;
  count: number;
  nav_view: string;
  filter_hint?: string;
};

export async function loadAdminDashboardAttention(db: D1Database, nowIso: string): Promise<AdminAttentionItem[]> {
  const ops = await loadAdminDashboardOpsV1(db, nowIso);
  const items: AdminAttentionItem[] = [];
  if (ops.new_orders_pending.count > 0) {
    items.push({
      kind: "pending_review",
      label_cs: "Nové objednávky čekající na schválení",
      count: ops.new_orders_pending.count,
      nav_view: "premium",
      filter_hint: "pending_review",
    });
  }
  if (ops.awaiting_payment.count > 0) {
    items.push({
      kind: "unpaid_invoices",
      label_cs: "Neuhrazené faktury u zveřejněných objednávek",
      count: ops.awaiting_payment.count,
      nav_view: "invoices",
    });
  }
  if (ops.ending_within_14_days.count > 0) {
    items.push({
      kind: "ending_soon",
      label_cs: "Reklamy končící do 14 dnů",
      count: ops.ending_within_14_days.count,
      nav_view: "premium",
      filter_hint: "ending_14",
    });
  }
  const docErrors = await db
    .prepare(
      "SELECT COUNT(*) AS cnt FROM premium_order_document_jobs WHERE status IN ('error','missing')"
    )
    .first<{ cnt: number }>();
  const docErrCount = Number(docErrors?.cnt) || 0;
  if (docErrCount > 0) {
    items.push({
      kind: "pdf_incomplete",
      label_cs: "Nedokončené nebo chybějící PDF u objednávek",
      count: docErrCount,
      nav_view: "premium",
    });
  }
  return items;
}

export { AD_PRODUCT_BANNER_PC_RIGHT };
