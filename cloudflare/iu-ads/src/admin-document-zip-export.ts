/**
 * Export stored PDF documents from R2 into ZIP (no PDF regeneration).
 */
import { json, requireAdminPermission } from "./admin-auth";
import { buildPdfZipArchive, sanitizeZipFilenamePart } from "./admin-pdf-zip";
import type { Env } from "./types";

async function loadActivePdfBytes(
  env: Env,
  documentId: string
): Promise<{ bytes: Uint8Array; title: string } | null> {
  if (!env.DB || !env.DOCUMENTS) return null;
  const row = await env.DB.prepare(
    "SELECT r2_key, title FROM documents WHERE document_id = ? AND status = 'active' LIMIT 1"
  )
    .bind(documentId)
    .first<{ r2_key: string; title: string }>();
  if (!row?.r2_key) return null;
  const obj = await env.DOCUMENTS.get(row.r2_key);
  if (!obj) return null;
  const buf = new Uint8Array(await obj.arrayBuffer());
  if (!buf.byteLength) return null;
  return { bytes: buf, title: row.title || documentId };
}

async function loadActivePdfByOrderAndType(
  env: Env,
  orderId: string,
  docType: string
): Promise<{ bytes: Uint8Array; title: string; document_id: string } | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT document_id, r2_key, title FROM documents WHERE order_id = ? AND doc_type = ? AND status = 'active' LIMIT 1"
  )
    .bind(orderId, docType)
    .first<{ document_id: string; r2_key: string; title: string }>();
  if (!row?.r2_key || !env.DOCUMENTS) return null;
  const obj = await env.DOCUMENTS.get(row.r2_key);
  if (!obj) return null;
  const buf = new Uint8Array(await obj.arrayBuffer());
  if (!buf.byteLength) return null;
  return { bytes: buf, title: row.title, document_id: row.document_id };
}

function parseIsoDateBound(raw: unknown, endOfDay: boolean): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isFinite(t)) return null;
  if (endOfDay) return new Date(t + 86400000 - 1).toISOString();
  return new Date(t).toISOString();
}

export async function handleAdminInvoicesRegistryZipExport(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "invoices.read");
  if (!guard.ok) return guard.response;
  if (!env.DB || !env.DOCUMENTS) return json({ error: "auth_not_configured" }, 503);

  let body: { from?: unknown; to?: unknown; kinds?: unknown; idempotency_key?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const fromIso = parseIsoDateBound(body.from, false);
  const toIso = parseIsoDateBound(body.to, true);
  if (!fromIso || !toIso) {
    return json({ error: "invalid_period", message_cs: "Zadejte platné období Od a Do." }, 400);
  }
  const kindsRaw = Array.isArray(body.kinds) ? body.kinds.map(String) : ["all"];
  const wantInv = kindsRaw.includes("all") || kindsRaw.includes("invoices");
  const wantCredit = kindsRaw.includes("all") || kindsRaw.includes("credit_notes");

  const entries: { path: string; bytes: Uint8Array }[] = [];
  const errors: string[] = [];

  if (wantInv) {
    const invs = await env.DB.prepare(
      `SELECT inv.invoice_number, inv.issued_at, d.document_id
       FROM invoices inv
       JOIN documents d ON d.invoice_id = inv.invoice_id AND d.doc_type = 'premium_invoice_pdf' AND d.status = 'active'
       WHERE inv.issued_at >= ? AND inv.issued_at <= ?
       ORDER BY inv.issued_at ASC
       LIMIT 200`
    )
      .bind(fromIso, toIso)
      .all<{ invoice_number: string; issued_at: string; document_id: string }>();
    for (const row of invs.results || []) {
      const loaded = await loadActivePdfBytes(env, String(row.document_id));
      if (!loaded) {
        errors.push("Chybí PDF faktury " + String(row.invoice_number));
        continue;
      }
      entries.push({
        path: sanitizeZipFilenamePart("faktura_" + row.invoice_number),
        bytes: loaded.bytes,
      });
    }
  }

  if (wantCredit) {
    const credits = await env.DB.prepare(
      `SELECT cn.credit_note_number, cn.created_at, cn.order_id
       FROM premium_credit_notes cn
       WHERE cn.created_at >= ? AND cn.created_at <= ?
       ORDER BY cn.created_at ASC
       LIMIT 200`
    )
      .bind(fromIso, toIso)
      .all<{ credit_note_number: string; created_at: string; order_id: string }>();
    for (const row of credits.results || []) {
      const loaded = await loadActivePdfByOrderAndType(env, String(row.order_id), "premium_credit_note_pdf");
      if (!loaded) {
        errors.push("Chybí PDF dobropisu " + String(row.credit_note_number));
        continue;
      }
      entries.push({
        path: sanitizeZipFilenamePart("dobropis_" + row.credit_note_number),
        bytes: loaded.bytes,
      });
    }
  }

  if (!entries.length) {
    return json(
      {
        error: "no_documents",
        message_cs: "Ve zvoleném období nejsou dostupná uložená PDF.",
        errors,
      },
      404
    );
  }

  const zip = buildPdfZipArchive(entries);
  const fname = "faktury-" + fromIso.slice(0, 10) + "-" + toIso.slice(0, 10) + ".zip";
  return new Response(zip, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="' + fname + '"',
      "Cache-Control": "private, no-store",
      "X-IU-Export-Errors": errors.length ? errors.slice(0, 5).join("; ") : "",
    },
  });
}

export async function handleAdminOrderConfirmationsRegistryZipExport(
  request: Request,
  env: Env
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "documents.read");
  if (!guard.ok) return guard.response;
  if (!env.DB || !env.DOCUMENTS) return json({ error: "auth_not_configured" }, 503);

  let body: { from?: unknown; to?: unknown; kinds?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const fromIso = parseIsoDateBound(body.from, false);
  const toIso = parseIsoDateBound(body.to, true);
  if (!fromIso || !toIso) {
    return json({ error: "invalid_period", message_cs: "Zadejte platné období Od a Do." }, 400);
  }
  const kindsRaw = Array.isArray(body.kinds) ? body.kinds.map(String) : ["all"];
  const types: string[] = [];
  if (kindsRaw.includes("all") || kindsRaw.includes("order_confirmation")) {
    types.push("premium_order_confirmation");
  }
  if (kindsRaw.includes("all") || kindsRaw.includes("order_cancellation")) {
    types.push("premium_order_cancellation");
  }
  if (!types.length) types.push("premium_order_confirmation");

  const placeholders = types.map(() => "?").join(",");
  const docs = await env.DB.prepare(
    `SELECT d.document_id, d.doc_type, d.version, d.created_at, o.customer_order_code, o.order_number
     FROM documents d
     JOIN orders o ON o.order_id = d.order_id
     WHERE d.status = 'active' AND d.doc_type IN (${placeholders})
       AND d.created_at >= ? AND d.created_at <= ?
     ORDER BY d.created_at ASC
     LIMIT 300`
  )
    .bind(...types, fromIso, toIso)
    .all<Record<string, unknown>>();

  const entries: { path: string; bytes: Uint8Array }[] = [];
  const errors: string[] = [];
  for (const row of docs.results || []) {
    const loaded = await loadActivePdfBytes(env, String(row.document_id));
    const ref =
      (row.customer_order_code && String(row.customer_order_code)) ||
      (row.order_number && String(row.order_number)) ||
      "objednavka";
    if (!loaded) {
      errors.push("Chybí PDF u " + ref);
      continue;
    }
    const prefix = String(row.doc_type) === "premium_order_cancellation" ? "storno_" : "potvrzeni_";
    entries.push({
      path: sanitizeZipFilenamePart(prefix + ref + "_v" + String(row.version || 1)),
      bytes: loaded.bytes,
    });
  }

  if (!entries.length) {
    return json({ error: "no_documents", message_cs: "Ve zvoleném období nejsou PDF potvrzení.", errors }, 404);
  }

  const zip = buildPdfZipArchive(entries);
  const fname = "potvrzeni-" + fromIso.slice(0, 10) + "-" + toIso.slice(0, 10) + ".zip";
  return new Response(zip, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="' + fname + '"',
      "Cache-Control": "private, no-store",
    },
  });
}

export { loadActivePdfByOrderAndType };
