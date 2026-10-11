/**
 * Centrální archiv potvrzení objednávek (a souvisejících PDF) napříč reklamními produkty.
 */
import { json, requireAdminPermission } from "./admin-auth";
import { formatAdminPragueDateTime } from "./premium-order-workflow";
import { AD_PRODUCT_LABEL_CS, AD_PRODUCT_PREMIUM_BUTTONS } from "./admin-ad-products";
import type { Env } from "./types";

export async function handleAdminOrderConfirmationsRegistry(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "documents.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(200, Number(url.searchParams.get("limit") || "100") || 100);
  const conditions: string[] = [
    "d.doc_type IN ('premium_order_confirmation','premium_order_cancellation')",
    "d.status = 'active'",
  ];
  const params: unknown[] = [];
  if (q) {
    conditions.push("(c.company_name LIKE ? OR c.ico LIKE ? OR o.customer_order_code LIKE ? OR o.order_number LIKE ?)");
    const like = "%" + q + "%";
    params.push(like, like, like, like);
  }
  params.push(limit);

  const res = await env.DB.prepare(
    `SELECT d.document_id, d.order_id, d.doc_type, d.version, d.created_at,
            o.customer_order_code, o.order_number, c.company_name, c.ico,
            po.workflow_status, po.accounting_cancelled_at
     FROM documents d
     JOIN orders o ON o.order_id = d.order_id
     JOIN clients c ON c.client_id = o.client_id
     LEFT JOIN premium_selected_orders po ON po.order_id = d.order_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY d.created_at DESC
     LIMIT ?`
  )
    .bind(...params)
    .all<Record<string, unknown>>();

  const items = (res.results || []).map((row) => {
    const orderRef =
      (row.customer_order_code && String(row.customer_order_code).trim()) ||
      (row.order_number && String(row.order_number).trim()) ||
      String(row.order_id || "");
    const docType = String(row.doc_type || "");
    const kind =
      docType === "premium_order_cancellation" ? "order_cancellation" : "order_confirmation";
    const title =
      kind === "order_cancellation" ? "Potvrzení o stornování objednávky" : "Potvrzení objednávky";
    const oid = String(row.order_id || "");
    const ver = Number(row.version) || 1;
    const accessBase =
      "/v1/admin/premium/orders/" + encodeURIComponent(oid) + "/documents/" + kind + "/access";
    return {
      order_reference: orderRef,
      company_name: row.company_name,
      ico: row.ico,
      ad_product_label_cs: AD_PRODUCT_LABEL_CS[AD_PRODUCT_PREMIUM_BUTTONS],
      document_title_cs: title + (ver > 1 ? " · verze " + ver : ""),
      version: ver,
      created_at_label_cs: formatAdminPragueDateTime(String(row.created_at || "")),
      workflow_status: row.workflow_status ?? null,
      preview_path: accessBase + "?disposition=inline&version=" + encodeURIComponent(String(ver)),
      download_path: accessBase + "?disposition=attachment&version=" + encodeURIComponent(String(ver)),
    };
  });

  return json({
    confirmations: items,
    export_zip_available: true,
  });
}
