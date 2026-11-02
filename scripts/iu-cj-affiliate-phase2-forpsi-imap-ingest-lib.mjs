/** FORPSI staging ingest — classification + v24 dedup; no production trust, no auto-publish. */
import {
  AFFILIATE_MAILBOX_ADDRESS,
  FORPSI_IMAP_RULES_VERSION,
} from "./iu-cj-affiliate-phase2-forpsi-imap-config.mjs";
import {
  BRANCH,
  COMMERCIAL_KIND,
  CONTRACT_KIND,
  IMAP_ADAPTER_TRUST_SOURCE,
  PROCESSING_STATE,
  PRODUCTION_SIGNING_ENABLED,
  classifyPartnerEmail,
  extractCommercialDraftsForOfflineTest,
  extractContractDrafts,
  processPartnerMessageFromImapAdapter,
  resolveCjPartnerIdentity,
  resolveOfflineTestMailboxIdentity,
  shouldSkipDuplicate,
  assessAuthenticationHints,
  parseImapAdapterIdentityEnvelopeStructure,
} from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import { buildAdapterSessionRef, stripHtmlToText } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";
import {
  extractStructuredOffersFromMessage,
  OFFER_PIPELINE_STATE,
} from "./iu-cj-affiliate-phase2-affiliate-offer-classifier.mjs";

export { FORPSI_IMAP_RULES_VERSION };

export const AFFILIATE_EMAIL_CATEGORY = Object.freeze({
  partner_welcome: "partner_welcome",
  program_approval: "program_approval",
  program_rejection_or_end: "program_rejection_or_end",
  program_terms: "program_terms",
  terms_change: "terms_change",
  coupon: "coupon",
  limited_time_discount: "limited_time_discount",
  product_promotion: "product_promotion",
  product_catalog_or_feed: "product_catalog_or_feed",
  promotion_change_or_end: "promotion_change_or_end",
  administrative_notice: "administrative_notice",
  requires_review: "requires_review",
});

export function mapToAffiliateCategories(message, classification, partnerIdentity = {}) {
  const subject = String(message.subject || "");
  const body = String(message.bodyText || "") + "\n" + String(message.bodyHtmlStripped || "");
  const text = subject + "\n" + body;
  const out = new Set();

  if (classification.commercialKinds.includes(COMMERCIAL_KIND.program_welcome)) {
    out.add(AFFILIATE_EMAIL_CATEGORY.partner_welcome);
  }
  // V21: broad multi-language welcome / approval recognition (CS/SK/EN).
  if (
    /approved|schv[aá]len|accepted|accept(?:ed)?|welcome to (?:the |our )?(?:program|affiliate)|v[ií]tejte|v[ií]t[aá]me v (?:na[šs]em )?program|partnersk(?:ém|y|ého)? program|byli jste přijati|va[šs]e ž[aá]dost byla přijata|[uú]čet byl schv[aá]len|partnership approved|advertiser invitation|publisher application|congratulat(?:ions)?.*accept|thank you for joining|you've been approved|application (?:has been )?accepted|program approval|joined (?:the |our )?program/i.test(
      text
    )
  ) {
    out.add(AFFILIATE_EMAIL_CATEGORY.program_approval);
    out.add(AFFILIATE_EMAIL_CATEGORY.partner_welcome);
  }
  if (/rejected|declined|terminated|ukončen|zamítn/i.test(text)) {
    out.add(AFFILIATE_EMAIL_CATEGORY.program_rejection_or_end);
  }
  if (classification.contractKinds.includes(CONTRACT_KIND.program_terms_notice)) {
    out.add(AFFILIATE_EMAIL_CATEGORY.program_terms);
  }
  if (/updated terms|změna podmínek|new program terms/i.test(text)) {
    out.add(AFFILIATE_EMAIL_CATEGORY.terms_change);
  }
  if (classification.commercialKinds.includes(COMMERCIAL_KIND.coupon_offer)) {
    out.add(AFFILIATE_EMAIL_CATEGORY.coupon);
  }
  if (classification.commercialKinds.includes(COMMERCIAL_KIND.multi_action_promo) || /\b\d{1,2}\s*%\s*off\b/i.test(text)) {
    out.add(AFFILIATE_EMAIL_CATEGORY.limited_time_discount);
  }
  if (
    classification.commercialKinds.includes(COMMERCIAL_KIND.marketing_inspiration) ||
    classification.commercialKinds.includes(COMMERCIAL_KIND.shipping_promo) ||
    classification.commercialKinds.includes(COMMERCIAL_KIND.commission_change)
  ) {
    out.add(AFFILIATE_EMAIL_CATEGORY.product_promotion);
  }
  if (/product feed|catalog|katalog|data feed|xml feed/i.test(text)) {
    out.add(AFFILIATE_EMAIL_CATEGORY.product_catalog_or_feed);
  }
  if (/ends today|expires|ukončení akce|promotion end/i.test(text)) {
    out.add(AFFILIATE_EMAIL_CATEGORY.promotion_change_or_end);
  }
  if (/invoice|faktura|password reset|newsletter admin|maintenance/i.test(text)) {
    out.add(AFFILIATE_EMAIL_CATEGORY.administrative_notice);
  }

  if (classification.branch === BRANCH.unknown || out.size === 0) {
    out.add(AFFILIATE_EMAIL_CATEGORY.requires_review);
  }
  if (partnerIdentity.confidence === "missing" || partnerIdentity.confidence === "needs_verification") {
    out.add(AFFILIATE_EMAIL_CATEGORY.requires_review);
  }

  return [...out];
}

export function buildStagingAdapterEnvelope(message, sessionRef) {
  return {
    adapterTrustSource: IMAP_ADAPTER_TRUST_SOURCE,
    adapterSessionRef: sessionRef,
    mailboxIdentity: {
      mailbox: message.mailbox || AFFILIATE_MAILBOX_ADDRESS,
      folder: message.folder || "INBOX",
      uidvalidity: message.uidvalidity,
      uid: message.uid,
    },
    stagingOnly: true,
    forpsiAdapterVersion: FORPSI_IMAP_RULES_VERSION,
  };
}

/**
 * Staging path: full classification + dedup using offline test extraction.
 * Production IMAP trust remains blocked; production ingest API still quarantines.
 */
export function processPartnerMessageForForpsiStaging(message, context = {}) {
  const merged = {
    ...message,
    mailbox: message.mailbox || AFFILIATE_MAILBOX_ADDRESS,
    folder: message.folder || "INBOX",
    uid: context.uid ?? message.uid,
    uidvalidity: context.uidvalidity ?? message.uidvalidity,
    bodyHtmlStripped:
      message.bodyHtmlStripped ||
      (message.bodyHtml ? stripHtmlToText(message.bodyHtml) : "") ||
      "",
  };

  const sessionRef = buildAdapterSessionRef({
    mailbox: merged.mailbox,
    folder: merged.folder,
    uidvalidity: merged.uidvalidity,
    adapterRunId: context.adapterRunId || "staging",
  });
  const envelope = buildStagingAdapterEnvelope(merged, sessionRef);
  const prodGate = processPartnerMessageFromImapAdapter(merged, envelope, context);
  const structural = parseImapAdapterIdentityEnvelopeStructure(envelope);

  const identityRes = resolveOfflineTestMailboxIdentity(merged, null);
  if (!identityRes.ok) {
    return {
      state: PROCESSING_STATE.quarantined,
      quarantineReason: identityRes.reason,
      affiliateCategories: [AFFILIATE_EMAIL_CATEGORY.requires_review],
      autoAllowed: false,
      productionImapTrust: prodGate,
      structuralEnvelopeOk: structural.structuralOk,
    };
  }
  const mailboxKey = identityRes.mailboxKey;

  const auth = assessAuthenticationHints({
    spf: message.spf,
    dkim: message.dkim,
    dmarc: message.dmarc,
    fromAddress: message.from,
    authSource: message.authSource || "staging_unverified",
  });

  if (message.simulateSpoof || auth.trustTier === "unauthenticated_quarantine") {
    return {
      mailboxKey,
      state: PROCESSING_STATE.quarantined,
      quarantineReason: "sender_authentication_failed",
      affiliateCategories: [AFFILIATE_EMAIL_CATEGORY.requires_review],
      autoAllowed: false,
      productionImapTrust: prodGate,
    };
  }

  const dup = shouldSkipDuplicate(context.existingKeys || [], mailboxKey);
  if (dup.skip) {
    return {
      mailboxKey,
      state: PROCESSING_STATE.duplicate_skipped,
      duplicateReason: dup.reason,
      affiliateCategories: [],
      autoAllowed: false,
      productionImapTrust: prodGate,
    };
  }

  const partner = resolveCjPartnerIdentity(merged, context.catalogAdvertisers || [], context);
  if (partner.promptInjectionRisk) {
    return {
      mailboxKey,
      state: PROCESSING_STATE.quarantined,
      quarantineReason: "prompt_injection_pattern",
      affiliateCategories: [AFFILIATE_EMAIL_CATEGORY.requires_review],
      autoAllowed: false,
      productionImapTrust: prodGate,
    };
  }

  const classification = classifyPartnerEmail(merged);
  const affiliateCategories = mapToAffiliateCategories(merged, classification, partner);

  const commercialEnvelope = extractCommercialDraftsForOfflineTest(merged, mailboxKey);
  const commercialDrafts = commercialEnvelope.ok ? commercialEnvelope.drafts : [];
  const contractDrafts = extractContractDrafts(merged, mailboxKey);
  const structured = extractStructuredOffersFromMessage(merged, mailboxKey);

  const needsReview =
    affiliateCategories.includes(AFFILIATE_EMAIL_CATEGORY.requires_review) ||
    auth.trustTier === "auth_unverified" ||
    classification.hints.length > 0;

  const state = needsReview ? PROCESSING_STATE.needs_review : PROCESSING_STATE.parsed;

  return {
    mailboxKey,
    state,
    branch: classification.branch,
    commercialKinds: classification.commercialKinds,
    contractKinds: classification.contractKinds,
    affiliateCategories,
    commercialDrafts,
    contractDrafts,
    structuredOffers: structured.offers,
    negativeEvents: structured.negativeEvents,
    multiOfferMessage: structured.multiOffer,
    pipelineState: OFFER_PIPELINE_STATE.classified,
    partnerSummary: {
      declaredCid: partner.declaredCid ?? null,
      declaredPartnerName: partner.declaredPartnerName ?? null,
      linkId: partner.linkId ?? null,
      confidence: partner.confidence,
      catalogAdvertiserId: partner.catalogMatch?.advertiserId ?? null,
      catalogMatchName: partner.catalogMatch?.advertiserName ?? null,
      relationshipStatus: partner.catalogMatch?.relationshipStatus ?? null,
    },
    auth,
    autoAllowed: false,
    publicationGateV15: "unchanged_not_evaluated_in_staging",
    productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
    productionImapTrust: prodGate,
    stagingOnly: true,
  };
}
