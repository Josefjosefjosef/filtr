/**
 * Centrální evidence faktur a dobropisů pro administraci (bez technických ID v UI payloadu).
 */
import { json, requireAdminPermission } from "./admin-auth";
import { formatAdminPragueDateTime } from "./premium-order-workflow";
import { AD_PRODUCT_LABEL_CS, AD_PRODUCT_PREMIUM_BUTTONS } from "./admin-ad-products";
import type { Env } from "./types";

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.floor(n));
}

export async function handleAdminInvoicesRegistry(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const q = (url.searchParams.get("q") || "").trim();
  const docKind = url.searchParams.get("doc_kind") || "all";
  const limit = clampLimit(url.searchParams.get("limit"));
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q) {
    conditions.push(
      "(inv.invoice_number LIKE ? OR c.company_name LIKE ? OR c.ico LIKE ? OR o.customer_order_code LIKE ? OR o.order_number LIKE ?)"
    );
    const like = "%" + q + "%";
    params.push(like, like, like, like, like);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit);

  const invoiceRows = await env.DB.prepare(
    `SELECT inv.invoice_id, inv.invoice_number, inv.status, inv.issued_at, inv.due_at, inv.paid_at,
            inv.total_cents, inv.currency, inv.order_id, c.company_name, c.ico,
            o.customer_order_code, o.order_number
     FROM invoices inv
     JOIN clients c ON c.client_id = inv.client_id
     LEFT JOIN orders o ON o.order_id = inv.order_id
     ${where}
     ORDER BY inv.created_at DESC
     LIMIT ?`
  )
    .bind(...params)
    .all<Record<string, unknown>>();

  let creditRows: Record<string, unknown>[] = [];
  if (docKind === "all" || docKind === "credit_notes") {
    const cr = await env.DB.prepare(
      `SELECT cn.credit_note_id, cn.credit_note_number, cn.invoice_id, cn.correction_cents,
              cn.created_at, inv.invoice_number AS original_invoice_number, inv.order_id, c.company_name, c.ico,
              o.customer_order_code, o.order_number
       FROM premium_credit_notes cn
       JOIN invoices inv ON inv.invoice_id = cn.invoice_id
       JOIN clients c ON c.client_id = inv.client_id
       LEFT JOIN orders o ON o.order_id = inv.order_id
       ORDER BY cn.created_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all<Record<string, unknown>>();
    creditRows = cr.results || [];
  }

  const invoices = (invoiceRows.results || []).map((row) => {
    const orderRef =
      (row.customer_order_code && String(row.customer_order_code).trim()) ||
      (row.order_number && String(row.order_number).trim()) ||
      (row.order_id ? String(row.order_id) : null);
    const paid = row.status === "paid" || (row.paid_at != null && String(row.paid_at).trim());
    return {
      document_kind: "invoice",
      invoice_number: row.invoice_number,
      credit_note_number: null,
      company_name: row.company_name,
      ico: row.ico,
      order_reference: orderRef,
      ad_product_label_cs: AD_PRODUCT_LABEL_CS[AD_PRODUCT_PREMIUM_BUTTONS],
      issued_at_label_cs: formatAdminPragueDateTime(row.issued_at != null ? String(row.issued_at) : null),
      due_at_label_cs: formatAdminPragueDateTime(row.due_at != null ? String(row.due_at) : null),
      total_cents: row.total_cents,
      currency: row.currency || "CZK",
      payment_label_cs: paid ? "Uhrazeno" : "Neuhrazeno",
      linked_invoice_number: null,
      order_id: row.order_id,
      preview_path: row.order_id
        ? "/v1/admin/premium/orders/" + encodeURIComponent(String(row.order_id)) + "/documents/invoice_pdf/access?disposition=inline"
        : null,
      download_path: row.order_id
        ? "/v1/admin/premium/orders/" + encodeURIComponent(String(row.order_id)) + "/documents/invoice_pdf/access?disposition=attachment"
        : null,
      pdf_job_status: row.order_id ? "linked_order" : "no_order",
    };
  });

  const credit_notes = creditRows.map((row) => ({
    document_kind: "credit_note",
    invoice_number: null,
    credit_note_number: row.credit_note_number,
    company_name: row.company_name,
    ico: row.ico,
    order_reference:
      (row.customer_order_code && String(row.customer_order_code).trim()) ||
      (row.order_number && String(row.order_number).trim()) ||
      null,
    ad_product_label_cs: AD_PRODUCT_LABEL_CS[AD_PRODUCT_PREMIUM_BUTTONS],
    issued_at_label_cs: formatAdminPragueDateTime(row.created_at != null ? String(row.created_at) : null),
    due_at_label_cs: null,
    total_cents: Math.abs(Number(row.correction_cents) || 0),
    currency: "CZK",
    payment_label_cs: null,
    linked_invoice_number: row.original_invoice_number,
    order_id: row.order_id,
    preview_path: row.order_id
      ? "/v1/admin/premium/orders/" +
        encodeURIComponent(String(row.order_id)) +
        "/documents/credit_note_pdf/access?disposition=inline"
      : null,
    download_path: row.order_id
      ? "/v1/admin/premium/orders/" +
        encodeURIComponent(String(row.order_id)) +
        "/documents/credit_note_pdf/access?disposition=attachment"
      : null,
    pdf_job_status: "credit_note",
  }));

  let documents = invoices;
  if (docKind === "credit_notes") documents = credit_notes;
  else if (docKind === "all") documents = [...invoices, ...credit_notes];

  return json({
    documents,
    export_zip_available: false,
    export_zip_message_cs: "Hromadný export ZIP bude dostupný v další verzi — zatím stáhněte jednotlivá PDF.",
  });
}

export async function handleAdminBannerPcPlaceholder(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  return json({
    ok: true,
    product_status_cs: "Připravuje se",
    message_cs:
      "Bannerová reklama v pravém sloupci PC je připravována. Současné reklamní tlačítkové pozice P1–P8 zůstávají beze změny.",
    orders: [],
  });
}
