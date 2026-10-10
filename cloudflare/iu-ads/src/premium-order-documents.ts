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
import { buildPremiumCreditNotePdf } from "./premium-credit-note-pdf";
import { buildPremiumOrderCancellationPdf } from "./premium-order-cancellation-pdf";
import { buildPremiumInvoicePdf } from "./premium-invoice-pdf";
import { resolvePremiumAdWebPlacementUrl } from "./premium-ad-web-placement";
import {
  assertOrderPdfContainsCustomerFields,
  resolvePremiumOrderPdfBillingFields,
  type PremiumOrderPdfContext,
} from "./premium-order-pdf-fields";
import { appendPremiumOrderEvent } from "./premium-order-history";
import { archiveDocumentRevisionBeforeReplace } from "./premium-order-document-revisions";
import type { Env } from "./types";

export const PREMIUM_DOC_TYPE_ORDER = "premium_order_confirmation";
export const PREMIUM_DOC_TYPE_INVOICE = "premium_invoice_pdf";
export const PREMIUM_DOC_TYPE_CANCELLATION = "premium_order_cancellation";
export const PREMIUM_DOC_TYPE_CREDIT_NOTE = "premium_credit_note_pdf";

export type PremiumOrderDocKind =
  | "order_confirmation"
  | "invoice_pdf"
  | "order_cancellation"
  | "credit_note_pdf";

/** Jobs in `generating` longer than this are treated as interrupted (Worker CPU/time limit). */
export const PREMIUM_DOC_GENERATING_STALE_MS = 90_000;

export function docTypeForPremiumOrderDocKind(kind: PremiumOrderDocKind): string {
  switch (kind) {
    case "order_confirmation":
      return PREMIUM_DOC_TYPE_ORDER;
    case "invoice_pdf":
      return PREMIUM_DOC_TYPE_INVOICE;
    case "order_cancellation":
      return PREMIUM_DOC_TYPE_CANCELLATION;
    case "credit_note_pdf":
      return PREMIUM_DOC_TYPE_CREDIT_NOTE;
    default:
      return PREMIUM_DOC_TYPE_ORDER;
  }
}

export function premiumDocJobIsStaleGenerating(
  status: string,
  updatedAtIso: string | null | undefined,
  nowMs = Date.now()
): boolean {
  if (status !== "generating") return false;
  const t = Date.parse(String(updatedAtIso || ""));
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= PREMIUM_DOC_GENERATING_STALE_MS;
}

type JobRow = {
  job_id: string;
  order_id: string;
  doc_kind: PremiumOrderDocKind;
  status: string;
  document_id: string | null;
  last_error: string | null;
  updated_at?: string | null;
};

type ActiveOrderDocumentRow = { document_id: string; r2_key: string };

/**
 * Resolve active premium PDF for an order. Primary key is documents.order_id; many historical rows
 * only have campaign_id (published_campaign_id) — without this fallback admin UI stays "missing".
 */
export async function fetchActiveOrderDocument(
  db: D1Database,
  orderId: string,
  docType: string
): Promise<ActiveOrderDocumentRow | null> {
  const direct = await db
    .prepare(
      "SELECT document_id, r2_key FROM documents WHERE order_id = ? AND doc_type = ? AND status = 'active' LIMIT 1"
    )
    .bind(orderId, docType)
    .first<ActiveOrderDocumentRow>();
  if (direct?.document_id && direct.r2_key) return direct;

  const viaCampaign = await db
    .prepare(
      `SELECT d.document_id, d.r2_key, d.order_id AS linked_order_id
       FROM documents d
       INNER JOIN premium_selected_orders po ON po.published_campaign_id = d.campaign_id
       WHERE po.order_id = ? AND d.doc_type = ? AND d.status = 'active'
       LIMIT 1`
    )
    .bind(orderId, docType)
    .first<ActiveOrderDocumentRow & { linked_order_id: string | null }>();

  if (!viaCampaign?.document_id || !viaCampaign.r2_key) return null;

  const linked = viaCampaign.linked_order_id;
  const nowIso = new Date().toISOString();
  if (!linked) {
    await db
      .prepare("UPDATE documents SET order_id = ?, updated_at = ? WHERE document_id = ? AND order_id IS NULL")
      .bind(orderId, nowIso, viaCampaign.document_id)
      .run();
  } else if (linked !== orderId) {
    // Campaign belongs to this order (JOIN); repair mis-linked document.order_id without regenerating PDF.
    await db
      .prepare("UPDATE documents SET order_id = ?, updated_at = ? WHERE document_id = ?")
      .bind(orderId, nowIso, viaCampaign.document_id)
      .run();
  }

  return { document_id: viaCampaign.document_id, r2_key: viaCampaign.r2_key };
}

/** Link job row to an already-stored PDF (R2+D1) without regenerating. */
export async function linkPremiumOrderDocumentJobToActiveDocument(
  db: D1Database,
  jobId: string,
  documentId: string
): Promise<void> {
  const doneIso = new Date().toISOString();
  await db
    .prepare(
      "UPDATE premium_order_document_jobs SET status = ?, document_id = ?, updated_at = ?, last_error = NULL WHERE job_id = ?"
    )
    .bind("ready", documentId, doneIso, jobId)
    .run();
}

/** When D1 already has the PDF but the job row is absent or out of sync, link without regenerating. */
export async function ensurePremiumOrderDocumentJobReflectsActiveDocument(
  db: D1Database,
  orderId: string,
  kind: PremiumOrderDocKind,
  documentId: string,
  existingJobId?: string | null
): Promise<void> {
  if (existingJobId) {
    await linkPremiumOrderDocumentJobToActiveDocument(db, existingJobId, documentId);
    return;
  }
  const row = await db
    .prepare("SELECT job_id FROM premium_order_document_jobs WHERE order_id = ? AND doc_kind = ? LIMIT 1")
    .bind(orderId, kind)
    .first<{ job_id: string }>();
  if (row?.job_id) {
    await linkPremiumOrderDocumentJobToActiveDocument(db, row.job_id, documentId);
    return;
  }
  const nowIso = new Date().toISOString();
  const jobId = newId("pdj");
  const idem = "d1_active:" + orderId + ":" + kind;
  await db
    .prepare(
      "INSERT INTO premium_order_document_jobs (job_id, order_id, doc_kind, status, document_id, last_error, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .bind(jobId, orderId, kind, "ready", documentId, null, idem, nowIso, nowIso)
    .run();
}

/**
 * If PDF exists but job is not ready, or job is stale `generating`, reconcile state.
 * Returns linked document_id when job can be considered ready without new PDF bytes.
 */
export async function reconcilePremiumOrderDocumentJob(
  db: D1Database,
  orderId: string,
  kind: PremiumOrderDocKind,
  job: JobRow
): Promise<{ linked_document_id: string | null; stale_generating: boolean }> {
  const docType = docTypeForPremiumOrderDocKind(kind);
  const active = await fetchActiveOrderDocument(db, orderId, docType);
  if (active) {
    if (job.status !== "ready" || job.document_id !== active.document_id) {
      await linkPremiumOrderDocumentJobToActiveDocument(db, job.job_id, active.document_id);
    }
    return { linked_document_id: active.document_id, stale_generating: false };
  }
  const stale = premiumDocJobIsStaleGenerating(job.status, job.updated_at);
  if (stale) {
    await db
      .prepare(
        "UPDATE premium_order_document_jobs SET status = ?, last_error = ?, updated_at = ? WHERE job_id = ? AND status = 'generating'"
      )
      .bind("pending", "stale_generating_recovered", new Date().toISOString(), job.job_id)
      .run();
  }
  return { linked_document_id: null, stale_generating: stale };
}

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
  input: { campaignId: string; invoiceId: string; actorUserId: string; publishIdempotencyKey: string },
  opts?: { campaignFallbackAttempted?: boolean; allowMissingInvoice?: boolean }
): Promise<PremiumOrderPdfContext | null> {
  const po = await db
    .prepare("SELECT * FROM premium_selected_orders WHERE order_id = ? LIMIT 1")
    .bind(orderId)
    .first<Record<string, unknown>>();
  if (!po) return null;

  const order = await db
    .prepare(
      "SELECT client_id, order_number, customer_order_code, payload_json, contact_person, created_at FROM orders WHERE order_id = ? LIMIT 1"
    )
    .bind(orderId)
    .first<Record<string, unknown>>();
  if (!order?.client_id) return null;

  const client = await db
    .prepare(
      "SELECT company_name, ico, dic, address, billing_info FROM clients WHERE client_id = ? LIMIT 1"
    )
    .bind(order.client_id)
    .first<Record<string, unknown>>();
  if (!client) return null;

  const inv = await db
    .prepare(
      "SELECT invoice_id, invoice_number, issued_at, due_at, total_cents, currency, campaign_id FROM invoices WHERE invoice_id = ? LIMIT 1"
    )
    .bind(input.invoiceId)
    .first<Record<string, unknown>>();
  if (!inv?.invoice_id) {
    if (opts?.campaignFallbackAttempted && !opts?.allowMissingInvoice) return null;
    const invByOrder = await db
      .prepare(
        "SELECT invoice_id, campaign_id FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
      )
      .bind(orderId)
      .first<{ invoice_id: string; campaign_id: string | null }>();
    if (invByOrder?.invoice_id && invByOrder.invoice_id !== input.invoiceId) {
      const altCampaign =
        typeof invByOrder.campaign_id === "string" && invByOrder.campaign_id.trim()
          ? invByOrder.campaign_id.trim()
          : input.campaignId;
      return loadOrderDocumentContext(
        db,
        orderId,
        { ...input, invoiceId: invByOrder.invoice_id, campaignId: altCampaign },
        { campaignFallbackAttempted: true, allowMissingInvoice: opts?.allowMissingInvoice }
      );
    }
    if (!opts?.allowMissingInvoice) return null;
  }

  let campaignId = input.campaignId;
  const invCampaign =
    inv && typeof inv.campaign_id === "string" && inv.campaign_id.trim() ? inv.campaign_id.trim() : null;
  if (!opts?.campaignFallbackAttempted && invCampaign && invCampaign !== campaignId) {
    return loadOrderDocumentContext(
      db,
      orderId,
      { ...input, campaignId: invCampaign },
      { campaignFallbackAttempted: true }
    );
  }

  const camp = await db
    .prepare("SELECT evidence_code, start_at, end_at FROM campaigns WHERE campaign_id = ? LIMIT 1")
    .bind(campaignId)
    .first<{ evidence_code: string | null; start_at: string | null; end_at: string | null }>();

  const snap = await db
    .prepare("SELECT agreed_price_cents FROM premium_order_price_snapshots WHERE order_id = ? LIMIT 1")
    .bind(orderId)
    .first<{ agreed_price_cents: number | null }>();

  const row: Record<string, unknown> = {
    ...po,
    client_id: order.client_id,
    order_number: order.order_number,
    customer_order_code: order.customer_order_code,
    payload_json: order.payload_json,
    contact_person: order.contact_person,
    order_created_at: order.created_at,
    company_name: client.company_name,
    ico: client.ico,
    dic: client.dic,
    address: client.address,
    billing_info: client.billing_info,
    client_email: null,
    evidence_code: camp?.evidence_code ?? null,
    start_at: camp?.start_at ?? null,
    end_at: camp?.end_at ?? null,
    invoice_number: inv?.invoice_number ?? null,
    issued_at: inv?.issued_at ?? null,
    due_at: inv?.due_at ?? null,
    total_cents: inv?.total_cents ?? snap?.agreed_price_cents ?? null,
    currency: inv?.currency ?? "CZK",
    snap_agreed: snap?.agreed_price_cents ?? null,
  };

  const payload = parsePremiumOrderPayload(typeof row.payload_json === "string" ? row.payload_json : null);
  let payloadRaw: Record<string, unknown> = {};
  try {
    payloadRaw = JSON.parse(String(row.payload_json || "{}")) as Record<string, unknown>;
  } catch {
    payloadRaw = {};
  }
  const billing = resolvePremiumOrderPdfBillingFields({
    billing: payload.billing,
    clientAddress: typeof row.address === "string" ? row.address : null,
    clientBillingInfo: typeof row.billing_info === "string" ? row.billing_info : null,
  });
  const agreed =
    row.snap_agreed != null
      ? Number(row.snap_agreed)
      : payload.agreed_price_cents ?? Number(row.total_cents);

  const creativeId = typeof row.creative_id === "string" ? row.creative_id : null;
  let creativeFormat: string | null = null;
  let creativeHash: string | null = null;
  let creativeUploadedAt: string | null = null;
  let creativeApprovedAt: string | null = null;
  if (creativeId) {
    const cr = await db
      .prepare("SELECT format, content_hash, mime_type, created_at, approved_at FROM creatives WHERE creative_id = ?")
      .bind(creativeId)
      .first<{
        format: string;
        content_hash: string;
        mime_type: string;
        created_at: string;
        approved_at: string | null;
      }>();
    if (cr) {
      creativeFormat = cr.format;
      creativeHash = cr.content_hash;
      creativeUploadedAt = cr.created_at || null;
      creativeApprovedAt = cr.approved_at || null;
    }
  }

  const categorySlug = String(row.category_slug || "");
  const position = Number(row.position) || 0;
  const publishedAt = String(row.published_at || new Date().toISOString());
  const approvedAt = creativeApprovedAt || publishedAt;
  const evidence = typeof row.evidence_code === "string" ? row.evidence_code : campaignId;
  const adSnapshot =
    typeof payloadRaw.ad_web_placement_url === "string" ? payloadRaw.ad_web_placement_url.trim() : null;
  const adWebPlacementUrl = resolvePremiumAdWebPlacementUrl({
    category_slug: categorySlug,
    snapshot_url: adSnapshot,
  });

  return {
    order_id: orderId,
    evidence_reference: evidence,
    product_label: "Vybrané služby a odkazy",
    company_name: String(row.company_name || ""),
    ico: String(row.ico || payload.ico || ""),
    dic: (row.dic as string) || payload.dic,
    contact_name: String(row.contact_person || payload.ordering_person_name || row.company_name || ""),
    contact_email: String(
      row.client_contact_email ||
        row.client_email ||
        (typeof payloadRaw.contact_email === "string" ? payloadRaw.contact_email : "")
    ),
    contact_phone: payload.contact_phone,
    ordering_person_name: payload.ordering_person_name,
    authorization_confirmed: payload.authorization_confirmed,
    billing_street: billing.street,
    billing_city: billing.city,
    billing_zip: billing.zip,
    billing_country: billing.country,
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
    ad_web_placement_url: adWebPlacementUrl,
    b2b_only: payloadRaw.b2b_only === true || payloadRaw.b2b_only === undefined,
    creative_mode: String(row.creative_mode || payload.creative_mode || "logo"),
    creative_mode_label_cs: premiumCreativeModeLabelCs(String(row.creative_mode || "logo")),
    creative_id: creativeId,
    creative_format: creativeFormat,
    creative_original_filename: null,
    creative_content_hash: creativeHash,
    creative_uploaded_at: creativeUploadedAt,
    creative_approved_at: creativeApprovedAt,
    terms_version: payload.terms_version,
    terms_effective_at: payload.terms_effective_at,
    order_created_at: String(row.order_created_at || ""),
    order_submitted_at: String(row.created_at || row.order_created_at || ""),
    approved_at: approvedAt,
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

/** Load PDF context for storno/credit-note generation (post-publish or rejection). */
export async function loadPremiumOrderPdfContextByOrderId(
  db: D1Database,
  orderId: string
): Promise<{ ctx: PremiumOrderPdfContext; campaignId: string; invoiceId: string | null; clientId: string } | null> {
  const po = await db
    .prepare("SELECT published_campaign_id, publish_idempotency_key FROM premium_selected_orders WHERE order_id = ?")
    .bind(orderId)
    .first<{ published_campaign_id: string | null; publish_idempotency_key: string | null }>();
  const invoice = await db
    .prepare("SELECT invoice_id, campaign_id FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(orderId)
    .first<{ invoice_id: string; campaign_id: string | null }>();
  const campaignId =
    (typeof po?.published_campaign_id === "string" && po.published_campaign_id.trim()) ||
    (typeof invoice?.campaign_id === "string" && invoice.campaign_id.trim()) ||
    "camp_storno_" + orderId;
  const invoiceId = invoice?.invoice_id ?? null;
  const ctx = await loadOrderDocumentContext(
    db,
    orderId,
    {
      campaignId,
      invoiceId: invoiceId || "inv_missing_" + orderId,
      actorUserId: "system",
      publishIdempotencyKey: po?.publish_idempotency_key || "storno:" + orderId,
    },
    { allowMissingInvoice: !invoiceId }
  );
  if (!ctx) return null;
  const order = await db.prepare("SELECT client_id FROM orders WHERE order_id = ?").bind(orderId).first<{ client_id: string }>();
  if (!order?.client_id) return null;
  return { ctx, campaignId, invoiceId, clientId: order.client_id };
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
    .prepare(
      "SELECT job_id, order_id, doc_kind, status, document_id, last_error, updated_at FROM premium_order_document_jobs WHERE order_id = ? AND doc_kind = ?"
    )
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
    /** Admin recovery: generate PDF even when legacy payload omitted optional confirmation fields. */
    relaxedCustomerPdfAssert?: boolean;
  }
): Promise<{ ok: true; document_id: string } | { ok: false; error: string }> {
  if (!env.DB) return { ok: false, error: "no_db" };
  const db = env.DB;
  const nowIso = new Date().toISOString();
  const idem = idempotencyForPublish(orderId, kind, input.publishIdempotencyKey);
  const job = await upsertJob(db, orderId, kind, idem, nowIso);
  const reconciled = await reconcilePremiumOrderDocumentJob(db, orderId, kind, job);
  if (reconciled.linked_document_id && !input.forceRegenerate) {
    return { ok: true, document_id: reconciled.linked_document_id };
  }
  if (!input.forceRegenerate && job.status === "ready" && job.document_id) {
    const still = await db
      .prepare("SELECT document_id FROM documents WHERE document_id = ? AND status = 'active'")
      .bind(job.document_id)
      .first<{ document_id: string }>();
    if (still) return { ok: true, document_id: job.document_id };
  }

  const staleCutoffIso = new Date(Date.now() - PREMIUM_DOC_GENERATING_STALE_MS).toISOString();
  const claim = await db
    .prepare(
      `UPDATE premium_order_document_jobs SET status = ?, updated_at = ?, last_error = NULL
       WHERE job_id = ?
       AND (status IN ('pending', 'error') OR (status = 'generating' AND updated_at <= ?))`
    )
    .bind("generating", nowIso, job.job_id, staleCutoffIso)
    .run();
  const claimed = Number((claim as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
  if (!claimed) {
    const fresh = await db
      .prepare("SELECT status, document_id FROM premium_order_document_jobs WHERE job_id = ?")
      .bind(job.job_id)
      .first<{ status: string; document_id: string | null }>();
    if (fresh?.status === "ready" && fresh.document_id) {
      return { ok: true, document_id: fresh.document_id };
    }
    if (fresh?.status === "generating" && !input.forceRegenerate) {
      return { ok: false, error: "generation_in_progress" };
    }
    await db
      .prepare("UPDATE premium_order_document_jobs SET status = ?, updated_at = ?, last_error = NULL WHERE job_id = ?")
      .bind("generating", nowIso, job.job_id)
      .run();
  }

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
      if (!input.relaxedCustomerPdfAssert && missing.length) {
        throw new Error("order_pdf_incomplete:" + missing.slice(0, 5).join("|"));
      }
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

  const base = {
    campaignId: input.campaignId,
    invoiceId: input.invoiceId,
    clientId: input.clientId,
    actorUserId: input.actorUserId,
    publishIdempotencyKey: input.publishIdempotencyKey,
  };
  const r1 = await generateOneDocument(env, input.orderId, "order_confirmation", ctx, base);
  const r2 = await generateOneDocument(env, input.orderId, "invoice_pdf", ctx, base);
  if (!r1.ok || !r2.ok) {
    await resumePremiumOrderDocuments(env, input.orderId, input.actorUserId);
  }
}

export async function resumePremiumOrderDocuments(
  env: Env,
  orderId: string,
  actorUserId: string,
  opts?: { forceRegenerateReady?: boolean }
): Promise<{ ok: boolean; results: Record<string, unknown> }> {
  if (!env.DB) return { ok: false, results: { error: "no_db" } };
  if (!env.DOCUMENTS) return { ok: false, results: { error: "documents_not_configured" } };
  const po = await env.DB.prepare(
    `SELECT po.published_campaign_id, po.publish_idempotency_key, o.client_id
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     WHERE po.order_id = ?`
  )
    .bind(orderId)
    .first<{ published_campaign_id: string | null; client_id: string; publish_idempotency_key: string | null }>();
  if (!po) return { ok: false, results: { error: "premium_order_not_found" } };
  let inv = await env.DB.prepare(
    "SELECT invoice_id, invoice_number, campaign_id FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(orderId)
    .first<{ invoice_id: string; invoice_number: string; campaign_id: string | null }>();
  if (!inv?.invoice_id) return { ok: false, results: { error: "invoice_missing" } };

  const publishedCampaignId =
    po?.published_campaign_id && String(po.published_campaign_id).trim()
      ? String(po.published_campaign_id).trim()
      : inv.campaign_id && String(inv.campaign_id).trim()
        ? String(inv.campaign_id).trim()
        : null;
  if (!publishedCampaignId) return { ok: false, results: { error: "not_published" } };

  const publishKey = po.publish_idempotency_key || "retry:" + orderId;
  const ctx = await loadOrderDocumentContext(env.DB, orderId, {
    campaignId: publishedCampaignId,
    invoiceId: inv.invoice_id,
    actorUserId,
    publishIdempotencyKey: publishKey,
  });
  if (!ctx) return { ok: false, results: { error: "context_failed", invoice_id: inv.invoice_id, campaign_id: publishedCampaignId } };

  const base = {
    campaignId: publishedCampaignId,
    invoiceId: inv.invoice_id,
    clientId: po.client_id,
    actorUserId,
    publishIdempotencyKey: publishKey,
  };

  const results: Record<string, unknown> = {
    invoice_id: inv.invoice_id,
    invoice_number: inv.invoice_number,
  };
  const kinds: PremiumOrderDocKind[] = ["order_confirmation", "invoice_pdf"];
  const resetIso = new Date().toISOString();
  for (const kind of kinds) {
    await env.DB.prepare(
      `UPDATE premium_order_document_jobs SET status = ?, last_error = NULL, updated_at = ?
       WHERE order_id = ? AND doc_kind = ? AND status IN ('generating', 'error')`
    )
      .bind("pending", resetIso, orderId, kind)
      .run();
  }
  let allOk = true;
  for (const kind of kinds) {
    const job = await env.DB.prepare(
      "SELECT job_id, order_id, doc_kind, status, document_id, last_error, updated_at FROM premium_order_document_jobs WHERE order_id = ? AND doc_kind = ?"
    )
      .bind(orderId, kind)
      .first<JobRow>();
    if (job) {
      const linked = await reconcilePremiumOrderDocumentJob(env.DB, orderId, kind, job);
      if (linked.linked_document_id && !opts?.forceRegenerateReady) {
        results[kind] = { ok: true, document_id: linked.linked_document_id, recovered: "linked_active_document" };
        continue;
      }
    }
    if (
      !opts?.forceRegenerateReady &&
      job?.status === "ready" &&
      job.document_id &&
      !(await fetchActiveOrderDocument(env.DB, orderId, docTypeForPremiumOrderDocKind(kind)))
    ) {
      results[kind] = await generateOneDocument(env, orderId, kind, ctx, {
        ...base,
        forceRegenerate: true,
        relaxedCustomerPdfAssert: true,
      });
    } else if (!opts?.forceRegenerateReady && job?.status === "ready" && job.document_id) {
      results[kind] = { ok: true, document_id: job.document_id, skipped: true };
      continue;
    } else {
      results[kind] = await generateOneDocument(env, orderId, kind, ctx, {
        ...base,
        forceRegenerate: Boolean(opts?.forceRegenerateReady),
        relaxedCustomerPdfAssert: true,
      });
    }
    if (!(results[kind] as { ok?: boolean }).ok) allOk = false;
  }
  return { ok: allOk, results };
}

/** Admin retry — completes missing/stuck docs; does not force-regenerate ready PDFs. */
export async function retryPremiumOrderDocuments(
  env: Env,
  orderId: string,
  actorUserId: string
): Promise<{ ok: boolean; results: Record<string, unknown> }> {
  return resumePremiumOrderDocuments(env, orderId, actorUserId, { forceRegenerateReady: false });
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
  _request: Request,
  orderId: string
): Promise<AdminOrderDocumentCard[]> {
  if (!env.DB) return [];
  const jobs = await env.DB.prepare(
    "SELECT job_id, doc_kind, status, document_id, last_error, updated_at FROM premium_order_document_jobs WHERE order_id = ?"
  )
    .bind(orderId)
    .all<{
      job_id: string;
      doc_kind: PremiumOrderDocKind;
      status: string;
      document_id: string | null;
      last_error: string | null;
      updated_at: string | null;
    }>();

  for (const row of jobs.results || []) {
    try {
      await reconcilePremiumOrderDocumentJob(env.DB, orderId, row.doc_kind, {
        job_id: row.job_id,
        order_id: orderId,
        doc_kind: row.doc_kind,
        status: row.status,
        document_id: row.document_id,
        last_error: row.last_error,
        updated_at: row.updated_at,
      });
    } catch {
      /* non-blocking */
    }
  }

  const jobsRefreshed = await env.DB.prepare(
    "SELECT doc_kind, status, document_id, last_error FROM premium_order_document_jobs WHERE order_id = ?"
  )
    .bind(orderId)
    .all<{ doc_kind: PremiumOrderDocKind; status: string; document_id: string | null; last_error: string | null }>();

  const byKind = new Map<PremiumOrderDocKind, { status: string; document_id: string | null; last_error: string | null }>();
  for (const row of jobsRefreshed.results || []) {
    byKind.set(row.doc_kind, row);
  }

  const cards: AdminOrderDocumentCard[] = [];
  const kinds: { kind: PremiumOrderDocKind; title: string; subtitle: string }[] = [
    { kind: "order_confirmation", title: "Potvrzení objednávky", subtitle: "PDF · Automaticky vytvořeno při schválení" },
    { kind: "invoice_pdf", title: "Faktura", subtitle: "PDF · Splatnost 3 kalendářní dny" },
    { kind: "order_cancellation", title: "Potvrzení o stornování objednávky", subtitle: "PDF · Storno / zamítnutí" },
    { kind: "credit_note_pdf", title: "Dobropis k faktuře", subtitle: "PDF · Opravný účetní doklad" },
  ];

  for (const k of kinds) {
    const job = byKind.get(k.kind);
    const docType = docTypeForPremiumOrderDocKind(k.kind);
    let documentId: string | null = job?.document_id ?? null;
    let status: AdminOrderDocumentCard["status"] = "missing";
    let lastError: string | null = job?.last_error ?? null;

    const active = await fetchActiveOrderDocument(env.DB, orderId, docType);
    if (active) {
      documentId = active.document_id;
      status = "ready";
      lastError = null;
      try {
        await ensurePremiumOrderDocumentJobReflectsActiveDocument(
          env.DB,
          orderId,
          k.kind,
          active.document_id,
          jobs.results?.find((r) => r.doc_kind === k.kind)?.job_id
        );
      } catch {
        /* non-blocking — admin cards still show ready from D1 */
      }
    } else if (job) {
      status = job.status as AdminOrderDocumentCard["status"];
      if (status === "ready") {
        status = documentId ? "error" : "missing";
        if (status === "error" && !lastError) lastError = "document_row_missing";
      }
    }

    let preview_path: string | null = null;
    let download_path: string | null = null;
    if (documentId && status === "ready" && env.ADS_R2_SIGNING_SECRET) {
      preview_path = "/v1/admin/premium/orders/" + encodeURIComponent(orderId) + "/documents/" + k.kind + "/access?disposition=inline";
      download_path = "/v1/admin/premium/orders/" + encodeURIComponent(orderId) + "/documents/" + k.kind + "/access?disposition=attachment";
    }
    cards.push({
      kind: k.kind,
      title: k.title,
      subtitle: k.subtitle,
      status,
      document_id: documentId,
      last_error: lastError,
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

  const docType = docTypeForPremiumOrderDocKind(kind);
  const active = await fetchActiveOrderDocument(env.DB, orderId, docType);
  if (!active) return json({ error: "document_not_ready" }, 404);
  const row = await env.DB.prepare(
    "SELECT document_id, r2_key, title, content_hash FROM documents WHERE document_id = ? AND status = 'active' LIMIT 1"
  )
    .bind(active.document_id)
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
  try {
    const result = await retryPremiumOrderDocuments(env, orderId, guard.userId);
    return json(result, result.ok ? 200 : 502);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, results: { error: "retry_unhandled", detail: msg.slice(0, 500) } }, 500);
  }
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
     WHERE po.workflow_status = 'published'
       AND NOT EXISTS (
         SELECT 1 FROM premium_order_document_jobs j
         WHERE j.order_id = po.order_id AND j.doc_kind = 'order_confirmation' AND j.status = 'ready'
       )
     ORDER BY po.published_at ASC
     LIMIT ?`
  )
    .bind(limit)
    .all<{ order_id: string }>();

  const ids = (res.results || []).map((r) => r.order_id);
  if (dryRun) return json({ ok: true, dry_run: true, would_process: ids.length, order_ids: ids });

  const outcomes: unknown[] = [];
  for (const orderId of ids) {
    try {
      const r = await retryPremiumOrderDocuments(env, orderId, guard.userId);
      outcomes.push({ order_id: orderId, ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ order_id: orderId, ok: false, results: { error: msg.slice(0, 500) } });
    }
  }
  return json({ ok: true, processed: ids.length, outcomes });
}

async function generateStornoKindDocument(
  env: Env,
  orderId: string,
  kind: Extract<PremiumOrderDocKind, "order_cancellation" | "credit_note_pdf">,
  input: {
    campaignId: string;
    clientId: string;
    invoiceId: string | null;
    actorUserId: string;
    idempotencyKey: string;
    forceRegenerate?: boolean;
  }
): Promise<{ ok: true; document_id: string } | { ok: false; error: string }> {
  if (!env.DB) return { ok: false, error: "no_db" };
  const db = env.DB;
  const loaded = await loadPremiumOrderPdfContextByOrderId(db, orderId);
  if (!loaded) return { ok: false, error: "context_not_found" };
  const { ctx, campaignId, invoiceId, clientId } = loaded;
  const nowIso = new Date().toISOString();
  const job = await upsertJob(db, orderId, kind, input.idempotencyKey, nowIso);
  const reconciled = await reconcilePremiumOrderDocumentJob(db, orderId, kind, job);
  if (reconciled.linked_document_id && !input.forceRegenerate) {
    return { ok: true, document_id: reconciled.linked_document_id };
  }

  const staleCutoffIso = new Date(Date.now() - PREMIUM_DOC_GENERATING_STALE_MS).toISOString();
  await db
    .prepare(
      `UPDATE premium_order_document_jobs SET status = ?, updated_at = ?, last_error = NULL
       WHERE job_id = ? AND (status IN ('pending', 'error') OR (status = 'generating' AND updated_at <= ?))`
    )
    .bind("generating", nowIso, job.job_id, staleCutoffIso)
    .run();

  try {
    const storno = await db
      .prepare(
        `SELECT storno_number, storno_kind, reason, invoice_id, credit_note_id FROM premium_order_storno_records WHERE order_id = ?`
      )
      .bind(orderId)
      .first<{
        storno_number: string;
        storno_kind: string;
        reason: string | null;
        invoice_id: string | null;
        credit_note_id: string | null;
      }>();
    if (!storno) throw new Error("storno_record_missing");

    const poExtra = await db
      .prepare(
        "SELECT ad_turned_off_at, payment_status, published_at, workflow_status FROM premium_selected_orders WHERE order_id = ?"
      )
      .bind(orderId)
      .first<{
        ad_turned_off_at: string | null;
        payment_status: string | null;
        published_at: string | null;
        workflow_status: string;
      }>();

    let pdfBytes: Uint8Array;
    let docType: string;
    let title: string;
    let linkInvoiceId: string | null = invoiceId ?? storno.invoice_id;

    if (kind === "order_cancellation") {
      let invoiceNumber: string | null = ctx.invoice_number;
      if (storno.invoice_id) {
        const invRow = await db
          .prepare("SELECT invoice_number FROM invoices WHERE invoice_id = ?")
          .bind(storno.invoice_id)
          .first<{ invoice_number: string }>();
        invoiceNumber = invRow?.invoice_number ?? invoiceNumber;
      }
      let creditNoteNumber: string | null = null;
      if (storno.credit_note_id) {
        const cn = await db
          .prepare("SELECT credit_note_number FROM premium_credit_notes WHERE credit_note_id = ?")
          .bind(storno.credit_note_id)
          .first<{ credit_note_number: string }>();
        creditNoteNumber = cn?.credit_note_number ?? null;
      }
      const actorRow = await db
        .prepare("SELECT display_name FROM admin_users WHERE user_id = ?")
        .bind(input.actorUserId)
        .first<{ display_name: string }>();
      pdfBytes = await buildPremiumOrderCancellationPdf({
        ctx,
        storno_number: storno.storno_number,
        storno_kind: storno.storno_kind === "cancellation" ? "cancellation" : "rejection",
        reason: storno.reason || "—",
        issued_at: nowIso,
        issuer_display_name: actorRow?.display_name?.trim() || input.actorUserId,
        invoice_number: invoiceNumber,
        credit_note_number: creditNoteNumber,
        order_was_approved: poExtra?.workflow_status === "published" || poExtra?.workflow_status === "cancelled",
        ad_was_published: !!poExtra?.published_at,
        ad_turned_off_at: poExtra?.ad_turned_off_at ?? null,
        payment_status_label: poExtra?.payment_status === "paid" ? "Uhrazeno" : "Neuhrazeno",
      });
      docType = PREMIUM_DOC_TYPE_CANCELLATION;
      title = "Storno objednávky " + storno.storno_number;
      linkInvoiceId = storno.invoice_id;
    } else {
      const creditNoteId = storno.credit_note_id;
      if (!creditNoteId) throw new Error("credit_note_not_applicable");
      const cn = await db
        .prepare(
          `SELECT credit_note_number, correction_cents, original_total_cents, new_total_cents, reason, issued_at,
                  correction_effective_at, payment_status_snapshot, amount_paid_cents_snapshot, invoice_id
           FROM premium_credit_notes WHERE credit_note_id = ?`
        )
        .bind(creditNoteId)
        .first<{
          credit_note_number: string;
          correction_cents: number;
          original_total_cents: number;
          new_total_cents: number;
          reason: string | null;
          issued_at: string;
          correction_effective_at: string;
          payment_status_snapshot: string;
          amount_paid_cents_snapshot: number;
          invoice_id: string;
        }>();
      if (!cn) throw new Error("credit_note_row_missing");
      const inv = await db
        .prepare("SELECT invoice_number, issued_at, currency FROM invoices WHERE invoice_id = ?")
        .bind(cn.invoice_id)
        .first<{ invoice_number: string; issued_at: string; currency: string }>();
      if (!inv) throw new Error("invoice_not_found");
      pdfBytes = await buildPremiumCreditNotePdf({
        ctx,
        credit_note_number: cn.credit_note_number,
        invoice_number: inv.invoice_number,
        invoice_issued_at: inv.issued_at,
        issued_at: cn.issued_at,
        correction_effective_at: cn.correction_effective_at,
        original_total_cents: cn.original_total_cents,
        correction_cents: cn.correction_cents,
        new_total_cents: cn.new_total_cents,
        currency: inv.currency || ctx.currency,
        reason: cn.reason || storno.reason || "—",
        payment_status_label: cn.payment_status_snapshot === "paid" ? "Uhrazeno" : "Neuhrazeno",
        amount_paid_cents: cn.amount_paid_cents_snapshot,
      });
      docType = PREMIUM_DOC_TYPE_CREDIT_NOTE;
      title = "Dobropis " + cn.credit_note_number;
      linkInvoiceId = cn.invoice_id;
    }

    const documentId = await storePdfDocument(env, {
      orderId,
      clientId,
      campaignId: input.campaignId || campaignId,
      invoiceId: linkInvoiceId,
      docType,
      title,
      pdfBytes,
      actorUserId: input.actorUserId,
      replaceExisting: Boolean(input.forceRegenerate),
      replacementReason: input.forceRegenerate ? "storno_regenerate" : undefined,
    });

    await db
      .prepare("UPDATE premium_order_document_jobs SET status = ?, document_id = ?, updated_at = ?, last_error = NULL WHERE job_id = ?")
      .bind("ready", documentId, new Date().toISOString(), job.job_id)
      .run();
    return { ok: true, document_id: documentId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .prepare("UPDATE premium_order_document_jobs SET status = ?, last_error = ?, updated_at = ? WHERE job_id = ?")
      .bind("error", msg.slice(0, 2000), new Date().toISOString(), job.job_id)
      .run();
    return { ok: false, error: msg };
  }
}

export async function ensurePremiumStornoDocuments(
  env: Env,
  orderId: string,
  actorUserId: string,
  opts?: { forceRetryIncomplete?: boolean }
): Promise<{ ok: boolean; results: Record<string, unknown> }> {
  if (!env.DB) return { ok: false, results: { error: "no_db" } };
  const loaded = await loadPremiumOrderPdfContextByOrderId(env.DB, orderId);
  if (!loaded) return { ok: false, results: { error: "context_not_found" } };

  const storno = await env.DB.prepare(
    "SELECT storno_id, credit_note_id FROM premium_order_storno_records WHERE order_id = ?"
  )
    .bind(orderId)
    .first<{ storno_id: string; credit_note_id: string | null }>();
  if (!storno) return { ok: false, results: { error: "storno_record_missing" } };

  const baseKey = "storno_doc:" + orderId + ":" + storno.storno_id;
  const results: Record<string, unknown> = {};
  const cancel = await generateStornoKindDocument(env, orderId, "order_cancellation", {
    campaignId: loaded.campaignId,
    clientId: loaded.clientId,
    invoiceId: loaded.invoiceId,
    actorUserId,
    idempotencyKey: baseKey + ":cancellation",
    forceRegenerate: opts?.forceRetryIncomplete,
  });
  results.order_cancellation = cancel;
  let allOk = cancel.ok;
  if (storno.credit_note_id) {
    const credit = await generateStornoKindDocument(env, orderId, "credit_note_pdf", {
      campaignId: loaded.campaignId,
      clientId: loaded.clientId,
      invoiceId: loaded.invoiceId,
      actorUserId,
      idempotencyKey: baseKey + ":credit",
      forceRegenerate: opts?.forceRetryIncomplete,
    });
    results.credit_note_pdf = credit;
    allOk = allOk && credit.ok;
  }
  return { ok: allOk, results };
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
