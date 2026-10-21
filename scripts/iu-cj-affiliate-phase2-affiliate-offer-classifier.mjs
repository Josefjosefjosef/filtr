/**
 * Structured affiliate offer classification (v2) — multi-offer per message, no invented fields.
 */
import {
  buildCommercialActionKey,
  detectTerritories,
  extractCommercialDraftsForOfflineTest,
  segmentCommercialBlocks,
} from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

const CID_TOKEN = /\bCID[:\s]+(\d{6,})\b/i;
const LINK_ID = /\bLINK\s*ID[:\s]+(\d{6,})\b/i;

export const OFFER_CATEGORY = Object.freeze({
  coupon: "coupon",
  discount_no_coupon: "discount_no_coupon",
  fixed_amount_discount: "fixed_amount_discount",
  free_shipping: "free_shipping",
  gift_with_order: "gift_with_order",
  quantity_deal: "quantity_deal",
  product_discount: "product_discount",
  product_new_no_discount: "product_new_no_discount",
  bundle_offer: "bundle_offer",
  time_limited: "time_limited",
  while_stocks_last: "while_stocks_last",
  new_partner_program: "new_partner_program",
  commission_or_cookie_change: "commission_or_cookie_change",
  contract_terms_change: "contract_terms_change",
  promotion_ban: "promotion_ban",
  service_cancellation: "service_cancellation",
  banners_creatives: "banners_creatives",
  editorial_newsletter: "editorial_newsletter",
  multi_advertiser_digest: "multi_advertiser_digest",
  needs_review: "needs_review",
});

export const OFFER_PIPELINE_STATE = Object.freeze({
  received: "received",
  parsed: "parsed",
  classified: "classified",
  needs_verification: "needs_verification",
  verified: "verified",
  needs_review: "needs_review",
  quarantined: "quarantined",
  blocked: "blocked",
  eligible_for_publication: "eligible_for_publication",
  expired: "expired",
});

const COUPON_CODE = /\b([A-Z0-9]{4,20})\b/g;

function categoriesForBlock(block, message, draft) {
  const cats = new Set();
  const text = block + "\n" + String(message.subject || "");
  if (draft?.couponCode || /\b(kupón|coupon|kód)\b/i.test(text)) cats.add(OFFER_CATEGORY.coupon);
  if (/\b\d{1,2}\s*%/.test(text) && !draft?.couponCode) cats.add(OFFER_CATEGORY.discount_no_coupon);
  if (/\b\d+\s*(Kč|CZK|EUR|€)\b/i.test(text)) cats.add(OFFER_CATEGORY.fixed_amount_discount);
  if (/doprava zdarma|free shipping/i.test(text)) cats.add(OFFER_CATEGORY.free_shipping);
  if (/dárek|gift with|free gift/i.test(text)) cats.add(OFFER_CATEGORY.gift_with_order);
  if (/\b2\s*\+\s*1|\b2\s*\+\s*2|buy\s+\d+/i.test(text)) cats.add(OFFER_CATEGORY.quantity_deal);
  if (/model|produkt|sku|item/i.test(text) && /\d\s*%/.test(text)) cats.add(OFFER_CATEGORY.product_discount);
  if (/novinka|new product/i.test(text) && !/\d\s*%/.test(text)) cats.add(OFFER_CATEGORY.product_new_no_discount);
  if (/balení|bundle|set/i.test(text)) cats.add(OFFER_CATEGORY.bundle_offer);
  if (/do \d{1,2}\.\s*\d{1,2}|until|expires|platnost/i.test(text)) cats.add(OFFER_CATEGORY.time_limited);
  if (/vyprodán|while stocks|do vyprodání/i.test(text)) cats.add(OFFER_CATEGORY.while_stocks_last);
  if (/welcome|new program|nový program/i.test(text)) cats.add(OFFER_CATEGORY.new_partner_program);
  if (/proviz|commission|cookie/i.test(text)) cats.add(OFFER_CATEGORY.commission_or_cookie_change);
  if (/terms|podmínky|smluv|SEM|brand bid/i.test(text)) cats.add(OFFER_CATEGORY.contract_terms_change);
  if (/nesmíte propagovat|do not promote|zákaz propagace|remove.*feed/i.test(text)) cats.add(OFFER_CATEGORY.promotion_ban);
  if (/přerušena|discontinued|remove.*route|spojení/i.test(text)) cats.add(OFFER_CATEGORY.service_cancellation);
  if (/banner|kreativ|creative/i.test(text)) cats.add(OFFER_CATEGORY.banners_creatives);
  if (/editorial|inspirace|newsletter|tipy na/i.test(text)) cats.add(OFFER_CATEGORY.editorial_newsletter);
  if ((text.match(/CID[:\s]+\d+/gi) || []).length >= 3) cats.add(OFFER_CATEGORY.multi_advertiser_digest);
  if (cats.size === 0) cats.add(OFFER_CATEGORY.needs_review);
  return [...cats];
}

function offerRecordFromDraft(draft, block, message, mailboxKey, index) {
  const territory = draft.territory || detectTerritories(block, { actionScopeOnly: true });
  return {
    offerId: draft.commercialActionKey,
    pipelineState: OFFER_PIPELINE_STATE.classified,
    categories: categoriesForBlock(block, message, draft),
    advertiser: {
      declaredCid: draft.advertiserCid || (block.match(CID_TOKEN) || [])[1] || message.declaredCid || null,
      name: message.declaredPartnerName || null,
      network: message.network || null,
    },
    market: {
      territorySignal: territory?.signal || null,
      markets: territory?.markets || null,
      czEligible: territory?.czEligible ?? null,
    },
    offer: {
      type: draft.kind || null,
      campaignName: null,
      discountValue: draft.discountPercent ?? draft.discountAmount ?? null,
      discountUnit: draft.discountPercent != null ? "percent" : draft.discountAmount != null ? "currency" : null,
      couponCode: draft.couponCode ?? null,
      minOrder: draft.minOrderValue ?? null,
      productScope: draft.productScope ?? null,
      combinable: null,
      startDate: draft.validFrom ?? null,
      endDate: draft.validTo ?? null,
      whileStocksLast: /vyprodán|while stocks/i.test(block),
      linkId: (block.match(LINK_ID) || [])[1] || null,
      targetUrl: draft.landingUrl ?? null,
      affiliateUrlVerified: null,
      publisherCommission: null,
    },
    governance: {
      verificationState: "unverified",
      contractPermissionState: "not_evaluated",
      publicationState: "not_eligible_staging",
      evidenceRefs: [{ kind: "mailbox_block", actionIndex: index, blockFingerprint: draft.rawBlockFingerprint }],
    },
    autoAllowed: false,
  };
}

/** Negative / contract-only signals without treating as coupon offers. */
export function extractNonOfferEvents(message) {
  const body = String(message.bodyText || "") + "\n" + String(message.bodyHtmlStripped || "");
  const events = [];
  if (/Rhode|nesmíte propagovat|do not promote/i.test(body)) {
    events.push({ kind: OFFER_CATEGORY.promotion_ban, scope: "brand", target: "Rhode", pipelineState: OFFER_PIPELINE_STATE.needs_review });
  }
  if (/přerušena.*trasa|remove.*connection|international route/i.test(body)) {
    events.push({ kind: OFFER_CATEGORY.service_cancellation, scope: "route", pipelineState: OFFER_PIPELINE_STATE.needs_review });
  }
  return events;
}

export function extractStructuredOffersFromMessage(message, mailboxKey) {
  const body = String(message.bodyText || "");
  const blocks = segmentCommercialBlocks(body);
  const envelope = extractCommercialDraftsForOfflineTest(message, null);
  const drafts = envelope.ok ? envelope.drafts : [];
  const offers = [];
  for (let i = 0; i < drafts.length; i += 1) {
    const block = blocks[i]?.text || body;
    offers.push(offerRecordFromDraft(drafts[i], block, message, mailboxKey, i));
  }
  if (offers.length === 0 && /proviz|commission|cookie|SEM/i.test(body)) {
    offers.push({
      offerId: buildCommercialActionKey(mailboxKey, 0, "contract"),
      pipelineState: OFFER_PIPELINE_STATE.needs_review,
      categories: [OFFER_CATEGORY.commission_or_cookie_change, OFFER_CATEGORY.contract_terms_change],
      advertiser: { declaredCid: (body.match(CID_TOKEN) || [])[1] || null, name: null, network: null },
      governance: { verificationState: "unverified", publicationState: "not_eligible_staging" },
      autoAllowed: false,
    });
  }
  const events = extractNonOfferEvents(message);
  return { offers, negativeEvents: events, multiOffer: offers.length > 1 };
}
