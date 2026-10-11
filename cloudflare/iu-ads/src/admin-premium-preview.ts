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
} from "./premium-selected-services";
import { signObjectAccess } from "./signed-access";
import { listPremiumOrderDocumentsForAdmin, resumePremiumOrderDocuments } from "./premium-order-documents";
import { premiumOrderEligibleForExtendNewOrder } from "./premium-admin-extend-new-order";
import { sumPriorCreditCorrectionsCents } from "./premium-accounting-settlement";
import { buildPremiumOrderPublicationVisibility } from "./premium-publication-consistency";
import { addCalendarMonthsFromIso } from "./premium-selected-services";
import type { Env } from "./types";

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
  const history = historyEvents.map((ev) => ({
    ...ev,
    summary_cs: formatPremiumOrderEventLineCs(ev),
  }));

  const notesRes = await env.DB.prepare(
    "SELECT note_id, body_text, author_user_id, author_label, created_at FROM premium_order_notes WHERE order_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(orderId)
    .all();
  const internal_notes = (notesRes.results || []).map((n) => ({
    note_id: (n as Record<string, unknown>).note_id,
    body_text: (n as Record<string, unknown>).body_text,
    author_label: (n as Record<string, unknown>).author_label || (n as Record<string, unknown>).author_user_id,
    created_at: (n as Record<string, unknown>).created_at,
    created_at_label_cs: formatAdminPragueDateTime(String((n as Record<string, unknown>).created_at || "")),
  }));

  const customerCode =
    typeof row.customer_order_code === "string" && row.customer_order_code.trim()
      ? row.customer_order_code.trim()
      : typeof row.order_number === "string"
        ? row.order_number
        : null;

  const workflowPublished = String(row.workflow_status || "") === "published";
  if (workflowPublished && env.DOCUMENTS) {
    try {
      await resumePremiumOrderDocuments(env, orderId, guard.userId);
    } catch {
      /* non-blocking — listing still reconciles job↔document links */
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

  const order_documents = await listPremiumOrderDocumentsForAdmin(env, request, orderId);
  const order_documents_pdf_count = order_documents.filter((d) => d.status === "ready").length;

  const extendEligible = await premiumOrderEligibleForExtendNewOrder(env.DB, orderId, nowIso);
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

  const confirmationRevisionsRes = await env.DB.prepare(
    `SELECT d.version AS current_version, dcr.version AS revision_version, dcr.created_at, dcr.replacement_reason
     FROM documents d
     LEFT JOIN document_content_revisions dcr ON dcr.document_id = d.document_id
     WHERE d.order_id = ? AND d.doc_type = 'premium_order_confirmation' AND d.status = 'active'
     ORDER BY COALESCE(dcr.version, d.version) ASC`
  )
    .bind(orderId)
    .all<Record<string, unknown>>();

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
      workflow_status_label_cs: premiumWorkflowStatusLabelCs(workflowStatusStr, {
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
    order_documents,
    order_documents_pdf_count,
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
      ? { start_at: campaignEndAt, end_at: suggestedExtendEnd }
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
    order_confirmation_revisions: (confirmationRevisionsRes.results || []).map((r) => ({
      version: r.revision_version ?? r.current_version,
      created_at_label_cs: formatAdminPragueDateTime(String(r.created_at || "")),
      reason: r.replacement_reason ?? null,
    })),
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
  });
}
