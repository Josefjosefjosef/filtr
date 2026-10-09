import type { CustomerRegistrySnapshot } from "./premium-ares-registry";
import { resolvePremiumAdWebPlacementUrl } from "./premium-ad-web-placement";

/**
 * Customer-visible order payload keys — must appear in order confirmation PDF (regression guard).
 * Excludes internal secrets (portal codes, token hashes, order_token).
 */
export const PREMIUM_ORDER_PDF_EXCLUDED_PAYLOAD_KEYS = new Set([
  "renewal_offer_id",
  "order_token_hash",
  "customer_order_code",
  "portal_code",
]);

/** Top-level payload keys written at submit time (public-premium-order.ts). */
export const PREMIUM_ORDER_SUBMIT_PAYLOAD_KEYS = [
  "product",
  "placement_id",
  "category_slug",
  "position",
  "creative_mode",
  "target_url",
  "agreed_price_cents",
  "currency",
  "duration_months",
  "b2b_only",
  "ico",
  "terms_version",
  "terms_effective_at",
  "price_snapshot",
  "billing",
  "ordering_person_name",
  "authorization_confirmed",
  "contact_phone",
  "ad_web_placement_url",
] as const;

export type PremiumOrderPdfContext = {
  order_id: string;
  evidence_reference: string;
  product_label: string;
  company_name: string;
  ico: string;
  dic: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  ordering_person_name: string | null;
  authorization_confirmed: boolean;
  billing_street: string;
  billing_city: string;
  billing_zip: string;
  billing_country: string;
  customer_registry: CustomerRegistrySnapshot | null;
  note: string | null;
  category_title_cs: string;
  category_slug: string;
  position: number;
  position_label: string;
  price_cents: number;
  currency: string;
  duration_months: number;
  target_url: string;
  ad_web_placement_url: string | null;
  b2b_only: boolean;
  creative_mode: string;
  creative_mode_label_cs: string;
  creative_id: string | null;
  creative_format: string | null;
  creative_original_filename: string | null;
  creative_content_hash: string | null;
  creative_uploaded_at: string | null;
  creative_approved_at: string | null;
  terms_version: string | null;
  terms_effective_at: string | null;
  order_created_at: string;
  order_submitted_at: string;
  approved_at: string;
  published_at: string;
  campaign_start_at: string;
  campaign_end_at: string;
  workflow_status_label: string;
  approver_user_id: string | null;
  approver_display_name: string | null;
  invoice_number: string | null;
  invoice_id: string | null;
};

export function premiumOrderAdWebPlacementForPdf(ctx: PremiumOrderPdfContext): string | null {
  return resolvePremiumAdWebPlacementUrl({
    category_slug: ctx.category_slug,
    snapshot_url: ctx.ad_web_placement_url,
  });
}

export function listRequiredCustomerPayloadKeys(payload: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const k of PREMIUM_ORDER_SUBMIT_PAYLOAD_KEYS) {
    if (k in payload && !PREMIUM_ORDER_PDF_EXCLUDED_PAYLOAD_KEYS.has(k)) keys.push(k);
  }
  for (const k of Object.keys(payload)) {
    if (PREMIUM_ORDER_PDF_EXCLUDED_PAYLOAD_KEYS.has(k)) continue;
    if (keys.includes(k)) continue;
    if (k.startsWith("_")) continue;
    keys.push(k);
  }
  return keys.sort();
}

/** Flattened searchable strings that must exist inside order confirmation PDF bytes. */
export function orderConfirmationPdfRequiredSnippets(ctx: PremiumOrderPdfContext): string[] {
  const placementUrl = premiumOrderAdWebPlacementForPdf(ctx);
  const out: string[] = [
    ctx.evidence_reference,
    ctx.company_name,
    ctx.ico,
    ctx.contact_name,
    ctx.contact_email,
    ctx.category_title_cs,
    ctx.position_label,
    ctx.target_url,
    ctx.creative_mode_label_cs || ctx.creative_mode,
  ];
  if (placementUrl) out.push(placementUrl);
  if (ctx.creative_content_hash) out.push(ctx.creative_content_hash);
  if (ctx.approver_display_name) out.push(ctx.approver_display_name);
  if (ctx.dic) out.push(ctx.dic);
  if (ctx.customer_registry?.display_line_cs) out.push(ctx.customer_registry.display_line_cs);
  if (ctx.ordering_person_name) out.push(ctx.ordering_person_name);
  if (ctx.contact_phone) out.push(ctx.contact_phone);
  if (ctx.note) out.push(ctx.note);
  if (ctx.terms_version) out.push(ctx.terms_version);
  if (ctx.invoice_number) out.push(ctx.invoice_number);
  out.push(ctx.billing_street, ctx.billing_city, ctx.billing_zip);
  return out.filter((s) => typeof s === "string" && s.trim().length >= 2);
}

export function assertOrderPdfContainsCustomerFields(plainLines: string[], ctx: PremiumOrderPdfContext): string[] {
  const hay = plainLines.join("\n");
  const missing: string[] = [];
  for (const snippet of orderConfirmationPdfRequiredSnippets(ctx)) {
    if (!hay.includes(snippet)) missing.push(snippet);
  }
  const forbidden = ["order_token_hash", "ADS_CODE_PEPPER", "customer_order_code"];
  for (const f of forbidden) {
    if (hay.includes(f)) missing.push("FORBIDDEN:" + f);
  }
  return missing;
}
