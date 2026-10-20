/** Real v15 publication gate for email-derived rows — staging only, never auto-publish. */
import {
  buildPermissionContextForAdvertiser,
  evaluatePublicationGates,
} from "./iu-cj-affiliate-phase2-banner-permission-lib.mjs";
import { assessActionValidity } from "./iu-cj-affiliate-phase2-media-inventory-lib.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

export function buildEmailDerivedBannerRow(message, staging, options = {}) {
  const body = String(message.bodyText || "") + "\n" + String(message.bodyHtmlStripped || "");
  const linkIdMatch = body.match(/LINK\s*ID\s*:?\s*(\d+)/i);
  const cidMatch = body.match(/CID\s*:?\s*(\d+)/i);
  const hasAffiliateUrl = /https?:\/\/(www\.)?(an\.|cj\.|tkqlhce\.com)/i.test(body);
  return {
    bannerRole: staging.affiliateCategories?.includes("coupon") ? "C_coupon_campaign_banner" : "B_time_bound_partner_action",
    relationshipStatus: options.relationshipStatus || "joined",
    affiliateClickUrlPresent: hasAffiliateUrl || Boolean(linkIdMatch),
    partnerLinkVerified: false,
    marketTargeting: options.marketTargeting || (body.match(/\bCZ\b/i) ? "CZ" : "UNKNOWN"),
    storeHost: options.storeHost || null,
    languageHint: body.match(/[ěščřžýáíéúů]/i) ? "CZ" : null,
    czDeliveryDocumented: false,
    czAudienceRelevanceDocumented: false,
    linkName: message.subject || null,
    scopeSummary: { scopeType: options.scopeType || null },
    actionValidity: assessActionValidity(
      {
        promotionStartDate: options.promotionStartDate || null,
        promotionEndDate: options.promotionEndDate || null,
      },
      options.refDate || new Date()
    ),
    publicationReadiness: {
      competitorDestinationBlocked: false,
      couponTextGate: options.refCouponGate || null,
    },
    technicalAvailability: { localImageFile: null },
    resolvedCid: cidMatch ? cidMatch[1] : staging.partnerIdentity?.advertiserId || null,
    linkId: linkIdMatch ? linkIdMatch[1] : null,
  };
}

/**
 * Invokes real evaluatePublicationGates; publicationReady stays false unless all blockers cleared.
 */
export function assessEmailStagingPublicationV15(message, staging, options = {}) {
  const cid = options.advertiserCid || staging.partnerIdentity?.advertiserId || "unknown";
  const ctx = buildPermissionContextForAdvertiser(cid, options.licenseBasis || {}, options.programTermsProbe || null);
  const row = buildEmailDerivedBannerRow(message, staging, options);
  const gates = evaluatePublicationGates(row, ctx, options.refCouponGate || null);
  const publicationReady = gates.state === "ready_pending_manual_confirmation" && (gates.blockers?.length || 0) === 0;
  return {
    gateVersion: "v15_evaluatePublicationGates",
    publicationReady: publicationReady && PRODUCTION_SIGNING_ENABLED === true ? publicationReady : false,
    stagingPublishable: false,
    productionSigningEnabled: PRODUCTION_SIGNING_ENABLED,
    gateState: gates.state,
    blockers: gates.blockers || [],
    advisories: gates.advisories || [],
    permissionPublicDisplay: gates.permissionPublicDisplay || null,
    note: "email_staging_never_auto_publishes",
  };
}
