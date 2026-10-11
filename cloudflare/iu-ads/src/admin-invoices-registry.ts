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

function parseDateBound(raw: string | null, endOfDay: boolean): string | null {
  if (!raw || !raw.trim()) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isFinite(t)) return null;
  if (endOfDay) return new Date(t + 86400000 - 1).toISOString();
  return new Date(t).toISOString();
}

function invoiceAccessPaths(orderId: string | null, kind: "invoice_pdf" | "credit_note_pdf") {
  if (!orderId) return { preview_path: null, download_path: null };
  const base =
    "/v1/admin/premium/orders/" + encodeURIComponent(orderId) + "/documents/" + kind + "/access";
  return {
    preview_path: base + "?disposition=inline",
    download_path: base + "?disposition=attachment",
  };
}

export async function handleAdminInvoicesRegistry(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const q = (url.searchParams.get("q") || "").trim();
  const docKind = url.searchParams.get("doc_kind") || "all";
  const payment = url.searchParams.get("payment") || "all";
  const fromIso = parseDateBound(url.searchParams.get("from"), false);
  const toIso = parseDateBound(url.searchParams.get("to"), true);
  const limit = clampLimit(url.searchParams.get("limit"));

  const invConditions: string[] = [];
  const invParams: unknown[] = [];

  if (q) {
    invConditions.push(
      "(inv.invoice_number LIKE ? OR c.company_name LIKE ? OR c.ico LIKE ? OR o.customer_order_code LIKE ? OR o.order_number LIKE ? OR IFNULL(o.client_contact_email,'') LIKE ? OR IFNULL(cc.email,'') LIKE ? OR inv.invoice_id IN (SELECT cn.invoice_id FROM premium_credit_notes cn WHERE cn.credit_note_number LIKE ?))"
    );
    const like = "%" + q + "%";
    invParams.push(like, like, like, like, like, like, like, like);
  }
  if (fromIso) {
    invConditions.push("inv.issued_at >= ?");
    invParams.push(fromIso);
  }
  if (toIso) {
    invConditions.push("inv.issued_at <= ?");
    invParams.push(toIso);
  }
  if (payment === "paid") {
    invConditions.push("(inv.status = 'paid' OR inv.paid_at IS NOT NULL)");
  } else if (payment === "unpaid") {
    invConditions.push("inv.status IN ('issued','sent','overdue') AND inv.paid_at IS NULL");
  }

  const invWhere = invConditions.length ? "WHERE " + invConditions.join(" AND ") : "";
  invParams.push(limit);

  let invoices: Record<string, unknown>[] = [];
  if (docKind === "all" || docKind === "invoices") {
    const invoiceRows = await env.DB.prepare(
      `SELECT inv.invoice_id, inv.invoice_number, inv.status, inv.issued_at, inv.due_at, inv.paid_at,
              inv.total_cents, inv.currency, inv.order_id, c.company_name, c.ico,
              o.customer_order_code, o.order_number
       FROM invoices inv
       JOIN clients c ON c.client_id = inv.client_id
       LEFT JOIN orders o ON o.order_id = inv.order_id
       LEFT JOIN client_contacts cc ON cc.client_id = c.client_id
       ${invWhere}
       ORDER BY inv.created_at DESC
       LIMIT ?`
    )
      .bind(...invParams)
      .all<Record<string, unknown>>();

    invoices = (invoiceRows.results || []).map((row) => {
      const orderRef =
        (row.customer_order_code && String(row.customer_order_code).trim()) ||
        (row.order_number && String(row.order_number).trim()) ||
        (row.order_id ? String(row.order_id) : null);
      const paid = row.status === "paid" || (row.paid_at != null && String(row.paid_at).trim());
      const orderId = row.order_id ? String(row.order_id) : null;
      const paths = invoiceAccessPaths(orderId, "invoice_pdf");
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
        preview_path: paths.preview_path,
        download_path: paths.download_path,
        pdf_job_status: row.order_id ? "linked_order" : "no_order",
      };
    });
  }

  let credit_notes: Record<string, unknown>[] = [];
  if (docKind === "all" || docKind === "credit_notes") {
    const crConditions: string[] = [];
    const crParams: unknown[] = [];
    if (q) {
      crConditions.push(
        "(cn.credit_note_number LIKE ? OR inv.invoice_number LIKE ? OR c.company_name LIKE ? OR c.ico LIKE ? OR o.customer_order_code LIKE ? OR o.order_number LIKE ? OR IFNULL(o.client_contact_email,'') LIKE ? OR IFNULL(cc.email,'') LIKE ?)"
      );
      const like = "%" + q + "%";
      crParams.push(like, like, like, like, like, like, like, like);
    }
    if (fromIso) {
      crConditions.push("cn.created_at >= ?");
      crParams.push(fromIso);
    }
    if (toIso) {
      crConditions.push("cn.created_at <= ?");
      crParams.push(toIso);
    }
    if (payment === "paid") {
      crConditions.push("1=0");
    } else if (payment === "unpaid") {
      /* credit notes are not invoice payment state — keep visible for unpaid filter */
    }
    crParams.push(limit);
    const crWhere = crConditions.length ? "WHERE " + crConditions.join(" AND ") : "";
    const cr = await env.DB.prepare(
      `SELECT cn.credit_note_id, cn.credit_note_number, cn.invoice_id, cn.correction_cents,
              cn.created_at, inv.invoice_number AS original_invoice_number, inv.order_id, c.company_name, c.ico,
              o.customer_order_code, o.order_number
       FROM premium_credit_notes cn
       JOIN invoices inv ON inv.invoice_id = cn.invoice_id
       JOIN clients c ON c.client_id = inv.client_id
       LEFT JOIN orders o ON o.order_id = inv.order_id
       LEFT JOIN client_contacts cc ON cc.client_id = c.client_id
       ${crWhere}
       ORDER BY cn.created_at DESC
       LIMIT ?`
    )
      .bind(...crParams)
      .all<Record<string, unknown>>();
    credit_notes = (cr.results || []).map((row) => {
      const orderId = row.order_id ? String(row.order_id) : null;
      const paths = invoiceAccessPaths(orderId, "credit_note_pdf");
      return {
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
        preview_path: paths.preview_path,
        download_path: paths.download_path,
        pdf_job_status: "credit_note",
      };
    });
  }

  let documents = invoices;
  if (docKind === "credit_notes") documents = credit_notes;
  else if (docKind === "all") {
    documents = [...invoices, ...credit_notes].sort((a, b) => {
      const ta = Date.parse(String(a.issued_at_label_cs || "")) || 0;
      const tb = Date.parse(String(b.issued_at_label_cs || "")) || 0;
      return tb - ta;
    });
    if (documents.length > limit) documents = documents.slice(0, limit);
  }

  return json({
    documents,
    export_zip_available: true,
  });
}

export async function handleAdminInvoicesRegistrySuggest(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(12, Math.max(1, Number(url.searchParams.get("limit") || "12") || 12));
  if (!q) return json({ suggestions: [] });

  const like = "%" + q + "%";
  const suggestions: { label: string; value: string; kind: string }[] = [];

  const invRows = await env.DB.prepare(
    `SELECT inv.invoice_number, c.company_name, o.customer_order_code, o.order_number
     FROM invoices inv
     JOIN clients c ON c.client_id = inv.client_id
     LEFT JOIN orders o ON o.order_id = inv.order_id
     WHERE inv.invoice_number LIKE ? OR o.customer_order_code LIKE ? OR o.order_number LIKE ?
       OR c.company_name LIKE ? OR IFNULL(c.ico,'') LIKE ?
     ORDER BY inv.issued_at DESC
     LIMIT ?`
  )
    .bind(like, like, like, like, like, limit)
    .all<{ invoice_number: string; company_name: string; customer_order_code: string | null; order_number: string | null }>();

  for (const row of invRows.results || []) {
    const ref =
      (row.customer_order_code && String(row.customer_order_code).trim()) ||
      (row.order_number && String(row.order_number).trim()) ||
      "";
    suggestions.push({
      kind: "invoice",
      value: String(row.invoice_number || ""),
      label:
        "Faktura " +
        String(row.invoice_number || "") +
        " · " +
        String(row.company_name || "") +
        (ref ? " · obj. " + ref : ""),
    });
  }

  if (suggestions.length < limit) {
    const cnRows = await env.DB.prepare(
      `SELECT cn.credit_note_number, c.company_name, o.customer_order_code, o.order_number
       FROM premium_credit_notes cn
       JOIN invoices inv ON inv.invoice_id = cn.invoice_id
       JOIN clients c ON c.client_id = inv.client_id
       LEFT JOIN orders o ON o.order_id = inv.order_id
       WHERE cn.credit_note_number LIKE ? OR c.company_name LIKE ? OR o.customer_order_code LIKE ?
       ORDER BY cn.created_at DESC
       LIMIT ?`
    )
      .bind(like, like, like, limit - suggestions.length)
      .all<{
        credit_note_number: string;
        company_name: string;
        customer_order_code: string | null;
        order_number: string | null;
      }>();
    for (const row of cnRows.results || []) {
      const ref =
        (row.customer_order_code && String(row.customer_order_code).trim()) ||
        (row.order_number && String(row.order_number).trim()) ||
        "";
      suggestions.push({
        kind: "credit_note",
        value: String(row.credit_note_number || ""),
        label:
          "Dobropis " +
          String(row.credit_note_number || "") +
          " · " +
          String(row.company_name || "") +
          (ref ? " · obj. " + ref : ""),
      });
    }
  }

  return json({ q, suggestions: suggestions.slice(0, limit) });
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
