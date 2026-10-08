/**
 * Auto-generated premium order PDFs (confirmation + invoice) — idempotent, non-blocking on publish errors.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { buildSignedDocumentAccess } from "./visibility";
import { buildObjectKey, contentHashHex, extForMime } from "./r2-security";
import { premiumCategoryTitleCs, PREMIUM_PRODUCT_TYPE } from "./premium-selected-services";
import { parsePremiumOrderPayload, premiumWorkflowStatusLabelCs } from "./premium-order-workflow";
import { premiumCreativeModeLabelCs } from "./premium-creative-mode";
import {
  buildOrderConfirmationPlainLines,
  buildPremiumOrderConfirmationPdf,
} from "./premium-order-confirmation-pdf";
import { buildPremiumInvoicePdf } from "./premium-invoice-pdf";
import { assertOrderPdfContainsCustomerFields, type PremiumOrderPdfContext } from "./premium-order-pdf-fields";
import { appendPremiumOrderEvent } from "./premium-order-history";
import { archiveDocumentRevisionBeforeReplace } from "./premium-order-document-revisions";
import type { Env } from "./types";

export const PREMIUM_DOC_TYPE_ORDER = "premium_order_confirmation";
export const PREMIUM_DOC_TYPE_INVOICE = "premium_invoice_pdf";

export type PremiumOrderDocKind = "order_confirmation" | "invoice_pdf";

type JobRow = {
  job_id: string;
  order_id: string;
  doc_kind: PremiumOrderDocKind;
  status: string;
  document_id: string | null;
  last_error: string | null;
};

function idempotencyForPublish(orderId: string, kind: PremiumOrderDocKind, publishKey: string): string {
  return "premium_doc:" + kind + ":" + orderId + ":" + publishKey;
}

function variableSymbolFromInvoiceNumber(invoiceNumber: string): string {
  const digits = invoiceNumber.replace(/\D/g, "");
  return digits.slice(-10) || invoiceNumber.replace(/[^0-9A-Za-z]/g, "").slice(0, 10);
}

async function loadOrderDocumentContext(
  db: D1Database,
  orderId: string,
  input: { campaignId: string; invoiceId: string; actorUserId: string; publishIdempotencyKey: string }
): Promise<PremiumOrderPdfContext | null> {
  const row = await db
    .prepare(
      `SELECT po.*, o.client_id, o.order_number, o.customer_order_code, o.payload_json, o.contact_person, o.created_at AS order_created_at,
              c.company_name, c.ico, c.dic, c.address, c.billing_info,
              camp.evidence_code, camp.start_at, camp.end_at,
              inv.invoice_number, inv.issued_at, inv.due_at, inv.total_cents, inv.currency,
              ps.agreed_price_cents AS snap_agreed
       FROM premium_selected_orders po
       JOIN orders o ON o.order_id = po.order_id
       JOIN clients c ON c.client_id = o.client_id
       JOIN campaigns camp ON camp.campaign_id = ?
       JOIN invoices inv ON inv.invoice_id = ?
       LEFT JOIN premium_order_price_snapshots ps ON ps.order_id = po.order_id
       WHERE po.order_id = ?`
    )
    .bind(input.campaignId, input.invoiceId, orderId)
    .first<Record<string, unknown>>();
  if (!row) return null;

  const payload = parsePremiumOrderPayload(typeof row.payload_json === "string" ? row.payload_json : null);
  let payloadRaw: Record<string, unknown> = {};
  try {
    payloadRaw = JSON.parse(String(row.payload_json || "{}")) as Record<string, unknown>;
  } catch {
    payloadRaw = {};
  }
  const billing = payload.billing;
  const agreed =
    row.snap_agreed != null
      ? Number(row.snap_agreed)
      : payload.agreed_price_cents ?? Number(row.total_cents);

  const creativeId = typeof row.creative_id === "string" ? row.creative_id : null;
  let creativeFormat: string | null = null;
  let creativeHash: string | null = null;
  if (creativeId) {
    const cr = await db
      .prepare("SELECT format, content_hash, mime_type FROM creatives WHERE creative_id = ?")
      .bind(creativeId)
      .first<{ format: string; content_hash: string; mime_type: string }>();
    if (cr) {
      creativeFormat = cr.format;
      creativeHash = cr.content_hash;
    }
  }

  const categorySlug = String(row.category_slug || "");
  const position = Number(row.position) || 0;
  const publishedAt = String(row.published_at || row.published_at || new Date().toISOString());
  const evidence = typeof row.evidence_code === "string" ? row.evidence_code : input.campaignId;

  return {
    order_id: orderId,
    evidence_reference: evidence,
    product_label: "Vybrané služby a odkazy",
    company_name: String(row.company_name || ""),
    ico: String(row.ico || payload.ico || ""),
    dic: (row.dic as string) || payload.dic,
    contact_name: String(row.contact_person || ""),
    contact_email: String(row.client_contact_email || ""),
    contact_phone: payload.contact_phone,
    ordering_person_name: payload.ordering_person_name,
    authorization_confirmed: payload.authorization_confirmed,
    billing_street: billing?.street || "",
    billing_city: billing?.city || "",
    billing_zip: billing?.zip || "",
    billing_country: billing?.country || "",
    customer_registry: payload.customer_registry,
    note: payload.note,
    category_title_cs: premiumCategoryTitleCs(categorySlug),
    category_slug: categorySlug,
    position,
    position_label: "P" + String(position),
    price_cents: Math.round(Number(agreed) || 0),
    currency: String(row.currency || payloadRaw.currency || "CZK"),
    duration_months: Number(payloadRaw.duration_months) || 6,
    target_url: String(row.target_url || ""),
    creative_mode: String(row.creative_mode || payload.creative_mode || "logo"),
    creative_mode_label_cs: premiumCreativeModeLabelCs(String(row.creative_mode || "logo")),
    creative_id: creativeId,
    creative_format: creativeFormat,
    creative_original_filename: null,
    creative_content_hash: creativeHash,
    terms_version: payload.terms_version,
    terms_effective_at: payload.terms_effective_at,
    order_created_at: String(row.order_created_at || ""),
    order_submitted_at: String(row.created_at || row.order_created_at || ""),
    approved_at: publishedAt,
    published_at: publishedAt,
    campaign_start_at: String(row.start_at || publishedAt),
    campaign_end_at: String(row.end_at || ""),
    workflow_status_label: premiumWorkflowStatusLabelCs("published"),
    approver_user_id: input.actorUserId,
    approver_display_name:
      typeof row.published_by_display_name === "string" && row.published_by_display_name.trim()
        ? row.published_by_display_name.trim()
        : null,
    invoice_number: String(row.invoice_number || ""),
    invoice_id: input.invoiceId,
  };
}

async function fetchCreativeBytes(
  env: Env,
  db: D1Database,
  creativeId: string | null
): Promise<{ bytes: Uint8Array | null; mime: string | null }> {
  if (!creativeId || !env.CREATIVES) return { bytes: null, mime: null };
  const cr = await db
    .prepare("SELECT r2_key, mime_type FROM creatives WHERE creative_id = ?")
    .bind(creativeId)
    .first<{ r2_key: string; mime_type: string }>();
  if (!cr?.r2_key) return { bytes: null, mime: null };
  const obj = await env.CREATIVES.get(cr.r2_key);
  if (!obj) return { bytes: null, mime: null };
  const buf = new Uint8Array(await obj.arrayBuffer());
  return { bytes: buf, mime: cr.mime_type || obj.httpMetadata?.contentType || null };
}

async function upsertJob(
  db: D1Database,
  orderId: string,
  kind: PremiumOrderDocKind,
  idempotencyKey: string,
  nowIso: string
): Promise<JobRow> {
  const existing = await db
    .prepare("SELECT job_id, order_id, doc_kind, status, document_id, last_error FROM premium_order_document_jobs WHERE order_id = ? AND doc_kind = ?")
    .bind(orderId, kind)
    .first<JobRow>();
  if (existing) return existing;
  const jobId = newId("pdj");
  await db
    .prepare(
      "INSERT INTO premium_order_document_jobs (job_id, order_id, doc_kind, status, document_id, last_error, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .bind(jobId, orderId, kind, "pending", null, null, idempotencyKey, nowIso, nowIso)
    .run();
  return {
    job_id: jobId,
    order_id: orderId,
    doc_kind: kind,
    status: "pending",
    document_id: null,
    last_error: null,
  };
}

async function storePdfDocument(
  env: Env,
  input: {
    orderId: string;
    clientId: string;
    campaignId: string;
    invoiceId: string | null;
    docType: string;
    title: string;
    pdfBytes: Uint8Array;
    actorUserId: string;
    replaceExisting?: boolean;
    replacementReason?: string;
  }
): Promise<string> {
  if (!env.DB || !env.DOCUMENTS) throw new Error("documents_storage_not_configured");
  const hash = await contentHashHex(input.pdfBytes);
  const existing = await env.DB.prepare(
    "SELECT document_id, r2_key, content_hash, version FROM documents WHERE order_id = ? AND doc_type = ? AND status = 'active'"
  )
    .bind(input.orderId, input.docType)
    .first<{ document_id: string; r2_key: string; content_hash: string; version: number }>();
  if (existing) {
    if (!input.replaceExisting) return existing.document_id;
    const nowIso = new Date().toISOString();
    const priorHash = String(existing.content_hash || "");
    const priorVersion = Number(existing.version) || 1;
    let revisionId: string | null = null;
    let archiveKey: string | null = null;
    try {
      const oldObj = await env.DOCUMENTS.get(existing.r2_key);
      if (oldObj) {
        const oldBytes = new Uint8Array(await oldObj.arrayBuffer());
        const archived = await archiveDocumentRevisionBeforeReplace(env.DB, env.DOCUMENTS, {
          documentId: existing.document_id,
          version: priorVersion,
          contentHash: priorHash,
          r2Key: existing.r2_key,
          pdfBytes: oldBytes,
          reason: input.replacementReason || "corrective_pdf_replace",
          actorUserId: input.actorUserId,
        });
        revisionId = archived.revision_id;
        archiveKey = archived.archive_r2_key;
      }
    } catch {
      /* migration or archive path unavailable — still update active PDF below */
    }
    await env.DOCUMENTS.put(existing.r2_key, input.pdfBytes, {
      httpMetadata: { contentType: "application/pdf" },
    });
    const nextVersion = priorVersion + 1;
    await env.DB.prepare(
      "UPDATE documents SET content_hash = ?, version = ?, updated_at = ?, uploaded_by = ? WHERE document_id = ?"
    )
      .bind(hash, nextVersion, nowIso, input.actorUserId, existing.document_id)
      .run();
    try {
      await appendPremiumOrderEvent(env.DB, {
        orderId: input.orderId,
        eventType: "document_pdf_replaced",
        actorUserId: input.actorUserId,
        payload: {
          document_id: existing.document_id,
          doc_type: input.docType,
          prior_content_hash: priorHash,
          new_content_hash: hash,
          prior_version: priorVersion,
          new_version: nextVersion,
          replacement_reason: input.replacementReason || "corrective_pdf_replace",
          revision_id: revisionId,
          archive_r2_key: archiveKey,
        },
      });
    } catch {
      /* non-blocking */
    }
    return existing.document_id;
  }

  const documentId = newId("doc");
  const r2Key = buildObjectKey({ kind: "document", id: documentId, version: 1, ext: "pdf" });
  await env.DOCUMENTS.put(r2Key, input.pdfBytes, {
    httpMetadata: { contentType: "application/pdf" },
  });
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO documents (document_id, client_id, campaign_id, order_id, invoice_id, doc_type, title, version, content_hash, r2_key, visibility, client_can_download, uploaded_by, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      documentId,
      input.clientId,
      input.campaignId,
      input.orderId,
      input.invoiceId,
      input.docType,
      input.title,
      1,
      hash,
      r2Key,
      "client_visible",
      1,
      input.actorUserId,
      "active",
      nowIso,
      nowIso
    )
    .run();
  return documentId;
}

async function generateOneDocument(
  env: Env,
  orderId: string,
  kind: PremiumOrderDocKind,
  ctx: PremiumOrderPdfContext,
  input: {
    campaignId: string;
    invoiceId: string;
    clientId: string;
    actorUserId: string;
    publishIdempotencyKey: string;
    forceRegenerate?: boolean;
  }
): Promise<{ ok: true; document_id: string } | { ok: false; error: string }> {
  if (!env.DB) return { ok: false, error: "no_db" };
  const db = env.DB;
  const nowIso = new Date().toISOString();
  const idem = idempotencyForPublish(orderId, kind, input.publishIdempotencyKey);
  const job = await upsertJob(db, orderId, kind, idem, nowIso);
  if (!input.forceRegenerate && job.status === "ready" && job.document_id) {
    const still = await db
      .prepare("SELECT document_id FROM documents WHERE document_id = ? AND status = 'active'")
      .bind(job.document_id)
      .first<{ document_id: string }>();
    if (still) return { ok: true, document_id: job.document_id };
  }

  await db
    .prepare("UPDATE premium_order_document_jobs SET status = ?, updated_at = ?, last_error = NULL WHERE job_id = ?")
    .bind("generating", nowIso, job.job_id)
    .run();

  try {
    let pdfBytes: Uint8Array;
    let docType: string;
    let title: string;
    let invoiceId: string | null = input.invoiceId;

    if (kind === "order_confirmation") {
      const creative = await fetchCreativeBytes(env, db, ctx.creative_id);
      const plainLines = buildOrderConfirmationPlainLines(ctx);
      const missing = assertOrderPdfContainsCustomerFields(plainLines, ctx);
      pdfBytes = await buildPremiumOrderConfirmationPdf(ctx, creative.bytes, creative.mime);
      if (missing.length) throw new Error("order_pdf_incomplete:" + missing.slice(0, 5).join("|"));
      docType = PREMIUM_DOC_TYPE_ORDER;
      title = "Potvrzení objednávky";
      invoiceId = null;
    } else {
      const inv = await db
        .prepare("SELECT invoice_number, issued_at, due_at, total_cents, currency FROM invoices WHERE invoice_id = ?")
        .bind(input.invoiceId)
        .first<{ invoice_number: string; issued_at: string; due_at: string; total_cents: number; currency: string }>();
      if (!inv) throw new Error("invoice_not_found");
      const vs = variableSymbolFromInvoiceNumber(inv.invoice_number);
      const lineDesc =
        "Reklamní umístění — Vybrané služby a odkazy, kategorie " +
        ctx.category_title_cs +
        ", pozice " +
        ctx.position_label +
        ", období " +
        String(ctx.duration_months) +
        " měsíců";
      pdfBytes = await buildPremiumInvoicePdf({
        invoice_number: inv.invoice_number,
        variable_symbol: vs,
        issued_at: inv.issued_at,
        due_at: inv.due_at,
        taxable_date: inv.issued_at,
        buyer_company: ctx.company_name,
        buyer_ico: ctx.ico,
        buyer_dic: ctx.dic,
        buyer_address_lines: [ctx.billing_street, ctx.billing_zip + " " + ctx.billing_city, ctx.billing_country].filter(Boolean),
        buyer_registry: ctx.customer_registry,
        line_description: lineDesc,
        service_period_start: ctx.campaign_start_at,
        service_period_end: ctx.campaign_end_at,
        total_cents: inv.total_cents,
        currency: inv.currency || ctx.currency,
        order_reference: ctx.evidence_reference,
        category_title_cs: ctx.category_title_cs,
        position_label: ctx.position_label,
        duration_months: ctx.duration_months,
      });
      docType = PREMIUM_DOC_TYPE_INVOICE;
      title = "Faktura " + inv.invoice_number;
    }

    const documentId = await storePdfDocument(env, {
      orderId,
      clientId: input.clientId,
      campaignId: input.campaignId,
      invoiceId,
      docType,
      title,
      pdfBytes,
      actorUserId: input.actorUserId,
      replaceExisting: Boolean(input.forceRegenerate),
      replacementReason: input.forceRegenerate ? "admin_force_regenerate" : undefined,
    });

    const doneIso = new Date().toISOString();
    await db
      .prepare("UPDATE premium_order_document_jobs SET status = ?, document_id = ?, updated_at = ?, last_error = NULL WHERE job_id = ?")
      .bind("ready", documentId, doneIso, job.job_id)
      .run();

    try {
      await appendPremiumOrderEvent(db, {
        orderId,
        eventType: kind === "order_confirmation" ? "order_confirmation_pdf_created" : "invoice_pdf_created",
        actorUserId: input.actorUserId,
        payload: { document_id: documentId, doc_kind: kind, actor_label: "Systém" },
        createdAt: doneIso,
      });
    } catch {
      /* migration optional */
    }

    return { ok: true, document_id: documentId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .prepare("UPDATE premium_order_document_jobs SET status = ?, last_error = ?, updated_at = ? WHERE job_id = ?")
      .bind("error", msg.slice(0, 2000), new Date().toISOString(), job.job_id)
      .run();
    try {
      await appendPremiumOrderEvent(db, {
        orderId,
        eventType: "document_generation_failed",
        actorUserId: input.actorUserId,
        payload: { doc_kind: kind, error: msg.slice(0, 500), actor_label: "Systém" },
      });
    } catch {
      /* optional */
    }
    return { ok: false, error: msg };
  }
}

/** Called after successful publish — never throws; publish outcome is already committed. */
export async function ensurePremiumOrderDocumentsAfterPublish(
  env: Env,
  input: {
    orderId: string;
    campaignId: string;
    invoiceId: string;
    clientId: string;
    actorUserId: string;
    publishIdempotencyKey: string;
  }
): Promise<void> {
  if (!env.DB || !env.DOCUMENTS) return;
  const ctx = await loadOrderDocumentContext(env.DB, input.orderId, {
    campaignId: input.campaignId,
    invoiceId: input.invoiceId,
    actorUserId: input.actorUserId,
    publishIdempotencyKey: input.publishIdempotencyKey,
  });
  if (!ctx) return;

  await generateOneDocument(env, input.orderId, "order_confirmation", ctx, input);
  await generateOneDocument(env, input.orderId, "invoice_pdf", ctx, input);
}

export async function retryPremiumOrderDocuments(
  env: Env,
  orderId: string,
  actorUserId: string
): Promise<{ ok: boolean; results: Record<string, unknown> }> {
  if (!env.DB) return { ok: false, results: { error: "no_db" } };
  const po = await env.DB.prepare(
    `SELECT po.published_campaign_id, po.publish_idempotency_key, o.client_id
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     WHERE po.order_id = ?`
  )
    .bind(orderId)
    .first<{ published_campaign_id: string | null; client_id: string; publish_idempotency_key: string | null }>();
  if (!po?.published_campaign_id) return { ok: false, results: { error: "not_published" } };
  const inv = await env.DB.prepare("SELECT invoice_id FROM invoices WHERE order_id = ? AND campaign_id = ? LIMIT 1")
    .bind(orderId, po.published_campaign_id)
    .first<{ invoice_id: string }>();
  if (!inv) return { ok: false, results: { error: "invoice_missing" } };

  const publishKey = po.publish_idempotency_key || "retry:" + orderId;
  const ctx = await loadOrderDocumentContext(env.DB, orderId, {
    campaignId: po.published_campaign_id,
    invoiceId: inv.invoice_id,
    actorUserId,
    publishIdempotencyKey: publishKey,
  });
  if (!ctx) return { ok: false, results: { error: "context_failed" } };

  const base = {
    campaignId: po.published_campaign_id,
    invoiceId: inv.invoice_id,
    clientId: po.client_id,
    actorUserId,
    publishIdempotencyKey: publishKey,
  };
  const force = { ...base, forceRegenerate: true };
  const a = await generateOneDocument(env, orderId, "order_confirmation", ctx, force);
  const b = await generateOneDocument(env, orderId, "invoice_pdf", ctx, force);
  return { ok: a.ok && b.ok, results: { order_confirmation: a, invoice_pdf: b } };
}

export type AdminOrderDocumentCard = {
  kind: PremiumOrderDocKind;
  title: string;
  subtitle: string;
  status: "missing" | "pending" | "generating" | "ready" | "error";
  document_id: string | null;
  last_error: string | null;
  preview_path: string | null;
  download_path: string | null;
};

export async function listPremiumOrderDocumentsForAdmin(
  env: Env,
  request: Request,
  orderId: string
): Promise<AdminOrderDocumentCard[]> {
  if (!env.DB) return [];
  const jobs = await env.DB.prepare(
    "SELECT doc_kind, status, document_id, last_error FROM premium_order_document_jobs WHERE order_id = ?"
  )
    .bind(orderId)
    .all<{ doc_kind: PremiumOrderDocKind; status: string; document_id: string | null; last_error: string | null }>();

  const byKind = new Map<PremiumOrderDocKind, { status: string; document_id: string | null; last_error: string | null }>();
  for (const row of jobs.results || []) {
    byKind.set(row.doc_kind, row);
  }

  const cards: AdminOrderDocumentCard[] = [];
  const kinds: { kind: PremiumOrderDocKind; title: string; subtitle: string }[] = [
    { kind: "order_confirmation", title: "Potvrzení objednávky", subtitle: "PDF · Automaticky vytvořeno při schválení" },
    { kind: "invoice_pdf", title: "Faktura", subtitle: "PDF · Splatnost 3 kalendářní dny" },
  ];

  for (const k of kinds) {
    const job = byKind.get(k.kind);
    let status: AdminOrderDocumentCard["status"] = "missing";
    if (job) status = job.status as AdminOrderDocumentCard["status"];
    let preview_path: string | null = null;
    let download_path: string | null = null;
    if (job?.document_id && job.status === "ready" && env.ADS_R2_SIGNING_SECRET) {
      preview_path = "/v1/admin/premium/orders/" + encodeURIComponent(orderId) + "/documents/" + k.kind + "/access?disposition=inline";
      download_path = "/v1/admin/premium/orders/" + encodeURIComponent(orderId) + "/documents/" + k.kind + "/access?disposition=attachment";
    }
    cards.push({
      kind: k.kind,
      title: k.title,
      subtitle: k.subtitle,
      status,
      document_id: job?.document_id ?? null,
      last_error: job?.last_error ?? null,
      preview_path,
      download_path,
    });
  }
  return cards;
}

export async function handleAdminPremiumOrderDocumentAccess(
  request: Request,
  env: Env,
  orderId: string,
  kind: PremiumOrderDocKind
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  if (!env.DB || !env.ADS_R2_SIGNING_SECRET) return json({ error: "auth_not_configured" }, 503);

  const docType = kind === "order_confirmation" ? PREMIUM_DOC_TYPE_ORDER : PREMIUM_DOC_TYPE_INVOICE;
  const row = await env.DB.prepare(
    "SELECT document_id, r2_key, title, content_hash FROM documents WHERE order_id = ? AND doc_type = ? AND status = 'active' LIMIT 1"
  )
    .bind(orderId, docType)
    .first<{ document_id: string; r2_key: string; title: string; content_hash: string }>();
  if (!row) return json({ error: "document_not_ready" }, 404);

  const url = new URL(request.url);
  const disposition = url.searchParams.get("disposition") === "attachment" ? "attachment" : "inline";
  const ttlRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'DOCUMENT_SIGNED_URL_MAX_TTL_SECONDS'")
    .first<{ value: string }>();
  const ttl = Number(ttlRow?.value) || 3600;
  const access = await buildSignedDocumentAccess(env.ADS_R2_SIGNING_SECRET, row.r2_key, ttl);
  return json({
    document_id: row.document_id,
    path: access.path,
    expires_at: access.expiresAt,
    disposition,
    title: row.title,
  });
}

export async function handleAdminPremiumRetryDocuments(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  const result = await retryPremiumOrderDocuments(env, orderId, guard.userId);
  return json(result, result.ok ? 200 : 502);
}

export async function handleAdminPremiumBackfillDocuments(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { limit?: unknown; dry_run?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
  const dryRun = body.dry_run === true;

  const res = await env.DB.prepare(
    `SELECT po.order_id
     FROM premium_selected_orders po
     LEFT JOIN premium_order_document_jobs j ON j.order_id = po.order_id AND j.doc_kind = 'order_confirmation' AND j.status = 'ready'
     WHERE po.workflow_status = 'published' AND j.job_id IS NULL
     ORDER BY po.published_at ASC
     LIMIT ?`
  )
    .bind(limit)
    .all<{ order_id: string }>();

  const ids = (res.results || []).map((r) => r.order_id);
  if (dryRun) return json({ ok: true, dry_run: true, would_process: ids.length, order_ids: ids });

  const outcomes: unknown[] = [];
  for (const orderId of ids) {
    const r = await retryPremiumOrderDocuments(env, orderId, guard.userId);
    outcomes.push({ order_id: orderId, ...r });
  }
  return json({ ok: true, processed: ids.length, outcomes });
}

export async function auditPremiumDocumentGeneration(
  db: D1Database,
  actorUserId: string,
  orderId: string,
  operation: string,
  detail: Record<string, unknown>
): Promise<void> {
  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId,
      operation,
      objectType: "premium_order",
      objectId: orderId,
      before: null,
      after: detail,
      result: "success",
    })
  );
}

export function premiumProductTypeGuard(): string {
  return PREMIUM_PRODUCT_TYPE;
}
