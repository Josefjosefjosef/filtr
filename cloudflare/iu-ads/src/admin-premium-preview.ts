/**
 * Admin premium order detail + creative preview (same geometry as public card).
 */
import { json, requireAdminPermission } from "./admin-auth";
import { PREMIUM_CREATIVE_MODES, premiumCreativeModeLabelCs, premiumCreativeSlotClassSuffix } from "./premium-creative-mode";
import {
  formatAdminPragueDateTime,
  isPremiumOrderPublishable,
  parsePremiumOrderPayload,
  premiumOrderMissingPublishFields,
  premiumWorkflowStatusLabelCs,
} from "./premium-order-workflow";
import { buildAdminPremiumPreviewScopedCss, wrapAdminPremiumPreviewHtml } from "./premium-admin-preview-css";
import { listPremiumOrderEvents, formatPremiumOrderEventLineCs } from "./premium-order-history";
import {
  formatPremiumTotalPriceLabelCs,
  premiumCategoryTitleCs,
  PREMIUM_AFFILIATE_CATEGORY_SLUGS,
  PREMIUM_DURATION_MONTHS,
  parsePremiumPlacementId,
  resolveAuthoritativePriceCents,
  type PremiumPosition,
} from "./premium-selected-services";
import { signObjectAccess } from "./signed-access";
import {
  filterPremiumOrderDocumentsForAdminView,
  listPremiumOrderDocumentsForAdmin,
  resumePremiumOrderDocuments,
} from "./premium-order-documents";
import { bindPremiumOrderTermsArchive, loadPremiumOrderTermsArchiveHtml } from "./premium-terms-archive";
import { premiumOrderEligibleForExtendNewOrder } from "./premium-admin-extend-new-order";
import { sumPriorCreditCorrectionsCents } from "./premium-accounting-settlement";
import { buildPremiumOrderPublicationVisibility } from "./premium-publication-consistency";
import { addCalendarMonthsFromIso } from "./premium-selected-services";
import {
  loadPremiumOrderChainMembers,
  loadPremiumOrderConfirmationRevisionRows,
  premiumOrderChainArchive,
  premiumOrderChainTip,
  premiumOrderReference,
  premiumOrderServicePeriodLabelCs,
  type PremiumOrderChainMember,
  type PremiumOrderConfirmationRevisionRow,
} from "./premium-order-chain";
import type { AdminOrderDocumentCard } from "./premium-order-documents";
import type { Env } from "./types";

function mapConfirmationRevisionsForAdminApi(
  orderId: string,
  rows: PremiumOrderConfirmationRevisionRow[]
): {
  version: number;
  created_at_label_cs: string;
  reason: string | null;
  is_current: boolean;
  preview_path: string;
  download_path: string;
}[] {
  const accessBase =
    "/v1/admin/premium/orders/" + encodeURIComponent(orderId) + "/documents/order_confirmation/access";
  return rows.map((r) => {
    const v = Number(r.version);
    return {
      version: v,
      created_at_label_cs: formatAdminPragueDateTime(r.created_at),
      reason: r.reason,
      is_current: r.is_current,
      preview_path: accessBase + "?disposition=inline&version=" + encodeURIComponent(String(v)),
      download_path: accessBase + "?disposition=attachment&version=" + encodeURIComponent(String(v)),
    };
  });
}

function serializeAdminDocumentCards(cards: AdminOrderDocumentCard[]) {
  return cards.map((d) => ({
    kind: d.kind,
    title: d.title,
    subtitle: d.subtitle,
    status: d.status,
    last_error: d.last_error,
    preview_path: d.preview_path,
    download_path: d.download_path,
  }));
}

async function buildPremiumOrderHistoryGroups(
  env: Env,
  request: Request,
  members: PremiumOrderChainMember[],
  tipOrderId: string
): Promise<Record<string, unknown>[]> {
  const groups: Record<string, unknown>[] = [];
  const tipMember = members.find((m) => String(m.order_id) === String(tipOrderId));
  const tipRevisions = await loadPremiumOrderConfirmationRevisionRows(env.DB!, tipOrderId);
  const superseded = tipRevisions.filter((r) => !r.is_current);
  if (superseded.length) {
    groups.push({
      group_kind: "confirmation_amendments",
      order_id: tipOrderId,
      order_reference: tipMember ? premiumOrderReference(tipMember) : tipOrderId,
      title_cs: "Opravné verze potvrzení — aktuální období",
      confirmation_revisions: mapConfirmationRevisionsForAdminApi(tipOrderId, superseded),
    });
  }

  const archive = premiumOrderChainArchive(members, tipOrderId);
  archive.sort((a, b) => {
    const sa = Date.parse(String(a.billed_service_start_at || a.created_at || ""));
    const sb = Date.parse(String(b.billed_service_start_at || b.created_at || ""));
    return sb - sa;
  });

  for (const m of archive) {
    const oid = String(m.order_id);
    let docs = await listPremiumOrderDocumentsForAdmin(env, request, oid);
    docs = filterPremiumOrderDocumentsForAdminView(docs, {
      workflow_status: String(m.workflow_status || ""),
      published_at: m.workflow_status === "published" ? "1" : null,
    });
    const inv = await env.DB!.prepare(
      "SELECT invoice_number, status, paid_at FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
    )
      .bind(oid)
      .first<{ invoice_number: string; status: string; paid_at: string | null }>();
    const payStatus = String(m.payment_status || "unpaid");
    const invoicePaid = payStatus === "paid" || inv?.status === "paid" || !!inv?.paid_at;
    const revs = await loadPremiumOrderConfirmationRevisionRows(env.DB!, oid);
    const ws = String(m.workflow_status || "");
    groups.push({
      group_kind: "order_period",
      order_id: oid,
      order_reference: premiumOrderReference(m),
      service_period_label_cs: premiumOrderServicePeriodLabelCs(m),
      created_at_label_cs: formatAdminPragueDateTime(String(m.created_at || "")),
      invoice_number: inv?.invoice_number ?? null,
      invoice_payment_label_cs: inv ? (invoicePaid ? "Faktura uhrazena" : "Faktura neuhrazena") : null,
      workflow_status_label_cs: m.accounting_cancelled_at
        ? "Stornováno"
        : premiumWorkflowStatusLabelCs(ws, {}),
      documents: serializeAdminDocumentCards(docs),
      confirmation_revisions: mapConfirmationRevisionsForAdminApi(oid, revs.filter((r) => !r.is_current)),
    });
  }
  return groups;
}

function previewCardHtml(input: {
  mode: string;
  previewUrl: string | null;
  targetUrl: string | null;
}): string {
  const modeNorm = input.mode || "logo";
  const modeClass = "iuPremiumSlot--" + premiumCreativeSlotClassSuffix(modeNorm);
  const img = input.previewUrl
    ? '<img class="iuPremiumSlotImg" src="' +
      input.previewUrl.replace(/"/g, "&quot;") +
      '" alt="Náhled kreativity" loading="lazy"/>'
    : '<span class="iuPremiumSlotCta">Bez náhledu</span>';
  const inner =
    '<a class="iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--preview ' +
    modeClass +
    '" data-creative-mode="' +
    modeNorm.replace(/"/g, "&quot;") +
    '" href="' +
    (input.targetUrl || "#").replace(/"/g, "&quot;") +
    '" rel="noopener" target="_blank" style="pointer-events:none">' +
    img +
    "</a>";
  return wrapAdminPremiumPreviewHtml(inner);
}

export async function handleAdminPremiumOrderDetail(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare(
    `SELECT po.*, o.client_id, o.order_number, o.customer_order_code, o.payload_json, o.contact_person,
            o.created_at AS order_created_at,
            c.company_name, c.ico, c.dic, c.address, c.billing_info,
            ps.agreed_price_cents, ps.catalog_price_cents, ps.currency AS snap_currency,
            camp.status AS campaign_status, camp.start_at AS campaign_start_at, camp.end_at AS campaign_end_at
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     JOIN clients c ON c.client_id = o.client_id
     LEFT JOIN premium_order_price_snapshots ps ON ps.order_id = po.order_id
     LEFT JOIN campaigns camp ON camp.campaign_id = po.published_campaign_id
     WHERE po.order_id = ?`
  )
    .bind(orderId)
    .first<Record<string, unknown>>();

  if (!row) return json({ error: "not_found" }, 404);

  let creative: Record<string, unknown> | null = null;
  let previewUrl: string | null = null;
  const creativeId = row.creative_id;
  if (typeof creativeId === "string" && creativeId && env.ADS_R2_SIGNING_SECRET) {
    const cr = await env.DB.prepare(
      "SELECT creative_id, format, review_status, r2_key, content_hash, width, height FROM creatives WHERE creative_id = ?"
    )
      .bind(creativeId)
      .first<{ creative_id: string; format: string; review_status: string; r2_key: string; content_hash: string; width: number; height: number }>();
    if (cr) {
      const exp = Math.floor(Date.now() / 1000) + 900;
      const sig = await signObjectAccess(env.ADS_R2_SIGNING_SECRET, {
        objectKey: cr.r2_key,
        bucket: "CREATIVES",
        exp,
      });
      const origin = new URL(request.url).origin;
      previewUrl =
        origin +
        "/v1/objects/get?bucket=CREATIVES&key=" +
        encodeURIComponent(cr.r2_key) +
        "&exp=" +
        String(exp) +
        "&sig=" +
        encodeURIComponent(sig);
      creative = {
        creative_id: cr.creative_id,
        format: cr.format,
        review_status: cr.review_status,
        content_hash: cr.content_hash,
        width: cr.width,
        height: cr.height,
        preview_url: previewUrl,
      };
    }
  }

  const placementRow = await env.DB.prepare(
    "SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?"
  )
    .bind(row.placement_id)
    .first<{ active_campaign_id: string | null }>();
  const publishedCampaignId =
    typeof row.published_campaign_id === "string" ? row.published_campaign_id : null;
  const activeOnPlacement = placementRow?.active_campaign_id ?? null;
  const placementConflict =
    activeOnPlacement &&
    publishedCampaignId &&
    activeOnPlacement !== publishedCampaignId
      ? { active_campaign_id: activeOnPlacement, foreign_owner: true }
      : null;

  const mode = String(row.creative_mode || "logo");
  const previewHtml = previewCardHtml({
    mode,
    previewUrl,
    targetUrl: typeof row.target_url === "string" ? row.target_url : null,
  });

  const agreed = row.agreed_price_cents ?? row.catalog_price_cents;
  const priceLabel = agreed != null ? formatPremiumTotalPriceLabelCs(Number(agreed)) : null;

  const payloadSnap = parsePremiumOrderPayload(
    typeof row.payload_json === "string" ? row.payload_json : null
  );
  const agreedCents =
    row.agreed_price_cents != null
      ? Number(row.agreed_price_cents)
      : payloadSnap.agreed_price_cents ?? row.catalog_price_cents;
  const priceLabelDetail =
    agreedCents != null && Number.isFinite(Number(agreedCents))
      ? formatPremiumTotalPriceLabelCs(Number(agreedCents))
      : priceLabel;

  const noteClient =
    typeof row.note_client === "string" && row.note_client.trim() ? row.note_client.trim() : payloadSnap.note;

  const creativeIdStr =
    typeof row.creative_id === "string" && row.creative_id.trim() ? row.creative_id.trim() : null;
  const targetUrlStr = typeof row.target_url === "string" ? row.target_url : null;
  const workflowStatusStr = String(row.workflow_status || "");
  const missingPublishFields = premiumOrderMissingPublishFields({
    creative_id: creativeIdStr,
    target_url: targetUrlStr,
  });
  const publishable = isPremiumOrderPublishable({
    workflow_status: workflowStatusStr,
    creative_id: creativeIdStr,
    target_url: targetUrlStr,
  });

  const contactPersonOrder =
    typeof row.contact_person === "string" && row.contact_person.trim() ? row.contact_person.trim() : null;
  const contactPhonePayload = payloadSnap.contact_phone;
  const paymentStatus = String(row.payment_status || "unpaid");
  const nowIso = new Date().toISOString();
  const campaignEndAt = row.campaign_end_at != null ? String(row.campaign_end_at) : null;
  const campaignStatus = row.campaign_status != null ? String(row.campaign_status) : null;
  const nowMs = Date.now();
  let endingSoonDays: number | null = null;
  if (campaignEndAt) {
    const endMs = Date.parse(campaignEndAt);
    if (Number.isFinite(endMs)) {
      const days = Math.ceil((endMs - nowMs) / 86400000);
      if (days >= 0 && days <= 30) endingSoonDays = days;
    }
  }

  const historyEvents = await listPremiumOrderEvents(env.DB, orderId);
  const actorIds = [
    ...new Set(
      historyEvents.map((ev) => ev.actor_user_id).filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const actorLabelById = new Map<string, string>();
  if (actorIds.length) {
    const placeholders = actorIds.map(() => "?").join(",");
    const actorRows = await env.DB.prepare(
      "SELECT user_id, display_name, email FROM admin_users WHERE user_id IN (" + placeholders + ")"
    )
      .bind(...actorIds)
      .all<{ user_id: string; display_name: string | null; email: string | null }>();
    for (const ar of actorRows.results || []) {
      const label = (ar.display_name && ar.display_name.trim()) || (ar.email && ar.email.trim()) || "Administrátor";
      actorLabelById.set(ar.user_id, label);
    }
  }
  const history = historyEvents.map((ev) => {
    const payload = { ...ev.payload };
    if (ev.actor_user_id && !payload.actor_label) {
      payload.actor_label = actorLabelById.get(ev.actor_user_id) || "Administrátor";
    }
    const enriched = { ...ev, payload };
    return {
      ...enriched,
      summary_cs: formatPremiumOrderEventLineCs(enriched),
    };
  });

  const notesRes = await env.DB.prepare(
    "SELECT note_id, body_text, author_user_id, author_label, created_at FROM premium_order_notes WHERE order_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(orderId)
    .all();
  const internal_notes = (notesRes.results || []).map((n) => ({
    note_id: (n as Record<string, unknown>).note_id,
    body_text: (n as Record<string, unknown>).body_text,
    created_at: (n as Record<string, unknown>).created_at,
    created_at_label_cs: formatAdminPragueDateTime(String((n as Record<string, unknown>).created_at || "")),
  }));

  const customerCode =
    typeof row.customer_order_code === "string" && row.customer_order_code.trim()
      ? row.customer_order_code.trim()
      : typeof row.order_number === "string"
        ? row.order_number
        : null;

  const workflowStatusStrEarly = String(row.workflow_status || "");
  const workflowPublished = workflowStatusStrEarly === "published";
  if (env.DOCUMENTS) {
    try {
      const docJobPending = await env.DB.prepare(
        "SELECT 1 FROM premium_order_document_jobs WHERE order_id = ? AND status IN ('pending','generating','missing','error') LIMIT 1"
      )
        .bind(orderId)
        .first();
      if (workflowPublished && docJobPending) {
        await resumePremiumOrderDocuments(env, orderId, guard.userId);
      } else if (workflowStatusStrEarly === "cancelled" || workflowStatusStrEarly === "rejected") {
        const stornoPending = await env.DB.prepare(
          "SELECT 1 FROM premium_order_document_jobs WHERE order_id = ? AND doc_kind IN ('order_cancellation','credit_note_pdf') AND status IN ('pending','generating','missing','error') LIMIT 1"
        )
          .bind(orderId)
          .first();
        if (stornoPending) {
          const { ensurePremiumStornoDocuments } = await import("./premium-order-documents");
          await ensurePremiumStornoDocuments(env, orderId, guard.userId, { forceRetryIncomplete: true });
        }
      }
    } catch {
      /* non-blocking — listing still reconciles job↔document links */
    }
  }

  let terms_archive_available = false;
  let terms_archive_warning_cs: string | null = null;
  if (payloadSnap.terms_version) {
    try {
      const bind = await bindPremiumOrderTermsArchive(
        env,
        orderId,
        String(payloadSnap.terms_version),
        payloadSnap.terms_effective_at
      );
      terms_archive_available = bind.ok && !bind.missing;
      if (!terms_archive_available) {
        terms_archive_warning_cs =
          "Archivní znění obchodních podmínek pro tuto objednávku není k dispozici — nezobrazujeme aktuální verzi.";
      }
    } catch {
      terms_archive_warning_cs = "Archiv podmínek není dostupný (chybí migrace nebo úložiště).";
    }
  }

  const invoiceRow = await env.DB.prepare(
    "SELECT invoice_id, invoice_number, total_cents, currency, status, paid_at FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(orderId)
    .first<{
      invoice_id: string;
      invoice_number: string;
      total_cents: number;
      currency: string;
      status: string;
      paid_at: string | null;
    }>();

  let invoiceAccounting: {
    prior_corrected_cents: number;
    remaining_correctable_cents: number;
    suggested_payment_settlement: "unpaid" | "paid" | "partial";
  } | null = null;
  if (invoiceRow) {
    const priorRes = await env.DB.prepare(
      "SELECT correction_cents FROM premium_credit_notes WHERE invoice_id = ?"
    )
      .bind(invoiceRow.invoice_id)
      .all<{ correction_cents: number }>();
    const priorCorrected = sumPriorCreditCorrectionsCents(priorRes.results || []);
    const totalCents = Math.round(Number(invoiceRow.total_cents) || 0);
    const suggestedPayment: "unpaid" | "paid" | "partial" =
      paymentStatus === "paid" || invoiceRow.status === "paid" || invoiceRow.paid_at ? "paid" : "unpaid";
    invoiceAccounting = {
      prior_corrected_cents: priorCorrected,
      remaining_correctable_cents: Math.max(0, totalCents - priorCorrected),
      suggested_payment_settlement: suggestedPayment,
    };
  }

  const campaignStartAt = row.campaign_start_at != null ? String(row.campaign_start_at) : null;
  const isAdTurnedOff = !!row.ad_turned_off_at;
  const accountingCancelBlockedReason =
    workflowStatusStr === "published" && !isAdTurnedOff
      ? "Před stornem musí být reklama definitivně vypnutá (tlačítko „Vypnout reklamu“). Dočasné pozastavení nestačí."
      : workflowStatusStr !== "published"
        ? "Storno objednávky a faktury je dostupné pouze u schválené a dříve zveřejněné objednávky."
        : null;

  const chainMembers = await loadPremiumOrderChainMembers(env.DB, orderId);
  const chainTip = premiumOrderChainTip(chainMembers);
  const documentsOrderId = chainTip?.order_id ?? orderId;
  const extendSourceOrderId = documentsOrderId;

  const tipWorkflow = chainTip ? String(chainTip.workflow_status || "") : workflowStatusStr;
  let order_documents = await listPremiumOrderDocumentsForAdmin(env, request, documentsOrderId);
  order_documents = filterPremiumOrderDocumentsForAdminView(order_documents, {
    workflow_status: tipWorkflow,
    published_at: tipWorkflow === "published" ? "1" : null,
  });
  order_documents = order_documents.filter((d) => d.kind === "order_confirmation" || d.kind === "invoice_pdf");
  const order_documents_pdf_count = order_documents.filter((d) => d.status === "ready").length;
  const order_history_groups = await buildPremiumOrderHistoryGroups(env, request, chainMembers, documentsOrderId);

  const extendEligible = await premiumOrderEligibleForExtendNewOrder(env.DB, extendSourceOrderId, nowIso);
  const suggestedExtendEnd =
    campaignEndAt && extendEligible.ok ? addCalendarMonthsFromIso(campaignEndAt, 6) : null;

  const relatedOrdersRes = await env.DB.prepare(
    `SELECT po.order_id, o.customer_order_code, o.order_number, po.billed_service_start_at, po.billed_service_end_at, po.created_at,
            inv.invoice_number
     FROM premium_selected_orders po
     JOIN orders o ON o.order_id = po.order_id
     LEFT JOIN invoices inv ON inv.order_id = po.order_id
     WHERE po.parent_order_id = ? OR po.order_id = (SELECT parent_order_id FROM premium_selected_orders WHERE order_id = ? LIMIT 1)
     ORDER BY po.created_at ASC`
  )
    .bind(orderId, orderId)
    .all<Record<string, unknown>>();

  const amendConfirmationReady = !!(
    await env.DB.prepare(
      "SELECT 1 FROM premium_order_document_jobs WHERE order_id = ? AND doc_kind = 'order_confirmation' AND status = 'ready' LIMIT 1"
    )
      .bind(orderId)
      .first()
  );
  const order_amend_allowed =
    workflowStatusStr === "published" &&
    !!row.published_campaign_id &&
    amendConfirmationReady &&
    !isAdTurnedOff;

  let extendSuggestedPriceKc: string | null = null;
  if (extendEligible.ok) {
    const parsedPl = parsePremiumPlacementId(String(row.placement_id || ""));
    if (parsedPl) {
      const cents = resolveAuthoritativePriceCents(
        String(row.placement_id),
        parsedPl.position as PremiumPosition,
        null,
        null
      );
      extendSuggestedPriceKc = formatPremiumTotalPriceLabelCs(cents).replace(/\s*Kč\s*$/, "").trim();
    }
  }

  const publication_visibility = await buildPremiumOrderPublicationVisibility(env.DB, {
    orderId: String(row.order_id || ""),
    placementId: String(row.placement_id || ""),
    workflowStatus: workflowStatusStr,
    publishedCampaignId:
      row.published_campaign_id != null && String(row.published_campaign_id).trim()
        ? String(row.published_campaign_id)
        : null,
    campaignStatus: campaignStatus,
    campaignEndAt: campaignEndAt,
    campaignStartAt: row.campaign_start_at != null ? String(row.campaign_start_at) : null,
    targetUrl: targetUrlStr,
    nowIso,
  });

  return json({
    preview_scoped_css: buildAdminPremiumPreviewScopedCss(),
    order: {
      order_id: row.order_id,
      order_number: row.order_number,
      customer_order_code: customerCode,
      client_id: row.client_id,
      company_name: row.company_name,
      ico: row.ico ?? payloadSnap.ico,
      dic: row.dic ?? payloadSnap.dic,
      address: row.address,
      billing_info: row.billing_info,
      contact_person_name: contactPersonOrder,
      contact_name: contactPersonOrder,
      contact_email:
        typeof row.client_contact_email === "string" && row.client_contact_email.trim()
          ? row.client_contact_email.trim()
          : null,
      contact_phone: contactPhonePayload,
      placement_id: row.placement_id,
      category_slug: row.category_slug,
      category_title_cs: premiumCategoryTitleCs(String(row.category_slug || "")),
      position: row.position,
      position_label: "P" + String(row.position),
      workflow_status: row.workflow_status,
      workflow_status_label_cs: isAdTurnedOff
        ? "Reklama vypnuta"
        : premiumWorkflowStatusLabelCs(workflowStatusStr, {
            creative_id: creativeIdStr,
            target_url: targetUrlStr,
          }),
      publishable,
      missing_publish_fields: missingPublishFields,
      target_url: row.target_url,
      creative_mode: row.creative_mode,
      creative_mode_label_cs: premiumCreativeModeLabelCs(String(row.creative_mode || "logo")),
      price_label_cs: priceLabelDetail,
      duration_months: PREMIUM_DURATION_MONTHS,
      ordering_person_name: payloadSnap.ordering_person_name,
      authorization_confirmed: payloadSnap.authorization_confirmed,
      terms_version: payloadSnap.terms_version,
      terms_effective_at: payloadSnap.terms_effective_at,
      submitted_at: row.created_at,
      submitted_at_label_cs: formatAdminPragueDateTime(String(row.created_at || "")),
      published_at: row.published_at ?? null,
      published_at_label_cs: formatAdminPragueDateTime(
        row.published_at != null ? String(row.published_at) : null
      ),
      campaign_start_at: campaignStartAt,
      campaign_start_at_label_cs: formatAdminPragueDateTime(campaignStartAt),
      campaign_end_at: campaignEndAt,
      campaign_end_at_label_cs: formatAdminPragueDateTime(campaignEndAt),
      service_period_label_cs:
        campaignStartAt && campaignEndAt
          ? formatAdminPragueDateTime(campaignStartAt) + " – " + formatAdminPragueDateTime(campaignEndAt)
          : null,
      accounting_cancel_blocked_reason_cs: accountingCancelBlockedReason,
      accounting_cancel_allowed: workflowStatusStr === "published" && isAdTurnedOff,
      campaign_status: campaignStatus,
      is_paused: campaignStatus === "paused" && !row.ad_turned_off_at,
      ad_turned_off_at: row.ad_turned_off_at ?? null,
      ad_turned_off_at_label_cs: formatAdminPragueDateTime(
        row.ad_turned_off_at != null ? String(row.ad_turned_off_at) : null
      ),
      is_ad_turned_off: !!row.ad_turned_off_at,
      ad_turn_off_reason: row.ad_turn_off_reason ?? null,
      accounting_cancelled_at: row.accounting_cancelled_at ?? null,
      payment_status: paymentStatus,
      payment_status_label_cs:
        paymentStatus === "paid"
          ? "Uhrazeno"
          : paymentStatus === "partial"
            ? "Uhrazeno částečně"
            : "Neuhrazeno",
      invoice_issued: !!invoiceRow,
      invoice_paid: !!(invoiceRow && (paymentStatus === "paid" || invoiceRow.status === "paid" || invoiceRow.paid_at)),
      invoice_payment_label_cs: !invoiceRow
        ? null
        : paymentStatus === "paid" || invoiceRow.status === "paid" || invoiceRow.paid_at
          ? "Faktura uhrazena"
          : "Faktura neuhrazena",
      order_amend_allowed,
      price_cents: agreedCents != null && Number.isFinite(Number(agreedCents)) ? Number(agreedCents) : null,
      billing_street: payloadSnap.billing?.street ?? null,
      billing_city: payloadSnap.billing?.city ?? null,
      billing_zip: payloadSnap.billing?.zip ?? null,
      billing_country: payloadSnap.billing?.country ?? "CZ",
      ad_title: payloadSnap.ad_title ?? null,
      service_start_at:
        (row.billed_service_start_at as string | null) ??
        (row.campaign_start_at as string | null) ??
        null,
      service_end_at:
        (row.billed_service_end_at as string | null) ?? (row.campaign_end_at as string | null) ?? null,
      paid_at: row.paid_at ?? null,
      payment_received_at: row.payment_received_at ?? null,
      ending_soon_days: endingSoonDays,
      admin_paused_at: row.admin_paused_at ?? null,
      admin_pause_reason: row.admin_pause_reason ?? null,
      note_client: noteClient,
      published_campaign_id: row.published_campaign_id ?? null,
      creative_id: row.creative_id ?? null,
      submitted_label_cs: "Odesláno ke schválení a zveřejnění objednatelem",
    },
    creative,
    preview_html: previewHtml,
    preview_css_href: "/assets/iu-premium-selected-services-v1.css?v=premium-selected-v1-20261006-five-modes",
    preview_render_js_href: "https://infouzel.cz/assets/iu-premium-creative-render-v1.js?v=premium-creative-v1-20261006",
    placement_conflict: placementConflict,
    publication_visibility,
    history,
    internal_notes,
    documents_order_id: documentsOrderId,
    extend_chain_source_order_id: extendSourceOrderId,
    order_documents,
    order_documents_pdf_count,
    order_history_groups,
    invoice: invoiceRow
      ? {
          invoice_id: invoiceRow.invoice_id,
          invoice_number: invoiceRow.invoice_number,
          total_cents: invoiceRow.total_cents,
          currency: invoiceRow.currency,
          status: invoiceRow.status,
        }
      : null,
    invoice_accounting: invoiceAccounting,
    extend_new_order_allowed: extendEligible.ok,
    extend_new_order_blocked_reason_cs: extendEligible.ok ? null : extendEligible.message_cs,
    extend_suggested_period: extendEligible.ok
      ? { start_at: campaignEndAt, end_at: suggestedExtendEnd, price_kc: extendSuggestedPriceKc }
      : null,
    related_orders: (relatedOrdersRes.results || []).map((r) => ({
      order_id: r.order_id,
      order_reference: r.customer_order_code || r.order_number,
      invoice_number: r.invoice_number ?? null,
      service_period_label_cs:
        r.billed_service_start_at && r.billed_service_end_at
          ? formatAdminPragueDateTime(String(r.billed_service_start_at)) +
            " – " +
            formatAdminPragueDateTime(String(r.billed_service_end_at))
          : null,
      created_at_label_cs: formatAdminPragueDateTime(String(r.created_at || "")),
    })),
    order_confirmation_revisions: [],
    edit_form_options: {
      categories: PREMIUM_AFFILIATE_CATEGORY_SLUGS.map((slug) => ({
        slug,
        title_cs: premiumCategoryTitleCs(slug),
      })),
      creative_modes: PREMIUM_CREATIVE_MODES.map((mode) => ({
        id: mode,
        label_cs: premiumCreativeModeLabelCs(mode),
      })),
      positions: [1, 2, 3, 4, 5, 6, 7, 8],
    },
    terms_archive_available,
    terms_archive_warning_cs,
  });
}

export async function handleAdminPremiumOrderTermsArchive(
  request: Request,
  env: Env,
  orderId: string
): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;
  const loaded = await loadPremiumOrderTermsArchiveHtml(env, orderId);
  if (!loaded.ok || !loaded.html) {
    return json({ ok: false, message_cs: loaded.message_cs || "Archiv podmínek není k dispozici." }, 404);
  }
  const nonce = crypto.randomUUID();
  return new Response(loaded.html.replace(/nonce="archive"/g, 'nonce="' + nonce + '"'), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'nonce-" + nonce + "'; base-uri 'none'",
    },
  });
}
