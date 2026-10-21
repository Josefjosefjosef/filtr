/** Offline banner withdrawal / invalidation decisions (archive retained). */
import { parseAffiliateClickUrl } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const BANNER_WITHDRAWAL_REASON = Object.freeze({
  campaign_expired: "campaign_expired",
  campaign_not_yet_active: "campaign_not_yet_active",
  permission_revoked: "permission_revoked",
  partner_unknown: "partner_unknown",
  contract_denial_supersedes: "contract_denial_supersedes",
  invalid_affiliate_url: "invalid_affiliate_url",
  foreign_publisher_pid: "foreign_publisher_pid",
  missing_evidence: "missing_evidence",
  security_block: "security_block",
  duplicate_superseded: "duplicate_superseded",
  publication_not_approved: "publication_not_approved",
});

/**
 * Withdrawal supersedes prior approval (fail-closed).
 * @param {object} record banner creative record
 * @param {object} ctx
 */
export function assessBannerWithdrawalDecision(record, ctx = {}) {
  const reasons = [];
  const refDate = ctx.refDate instanceof Date ? ctx.refDate : new Date();
  const expectedPid = String(ctx.expectedWebsitePid || record?.publisherPid || "").trim();

  if (ctx.partnerKnown === false) reasons.push(BANNER_WITHDRAWAL_REASON.partner_unknown);
  if (ctx.permissionRevoked === true) reasons.push(BANNER_WITHDRAWAL_REASON.permission_revoked);
  if (ctx.supersedingDenial === true) reasons.push(BANNER_WITHDRAWAL_REASON.contract_denial_supersedes);
  if (ctx.securityBlock === true) reasons.push(BANNER_WITHDRAWAL_REASON.security_block);
  if (ctx.missingEvidence === true) reasons.push(BANNER_WITHDRAWAL_REASON.missing_evidence);
  if (ctx.duplicateSuperseded === true) reasons.push(BANNER_WITHDRAWAL_REASON.duplicate_superseded);

  if (
    record?.validityState === "expired_before_reference" ||
    record?.validityState === "documented_inactive"
  ) {
    reasons.push(BANNER_WITHDRAWAL_REASON.campaign_expired);
  }
  if (record?.validityState === "documented_not_yet_active") {
    reasons.push(BANNER_WITHDRAWAL_REASON.campaign_not_yet_active);
  }

  const click = String(record?.affiliateClickUrl || "");
  if (!record?.affiliateClickVerified) {
    reasons.push(BANNER_WITHDRAWAL_REASON.invalid_affiliate_url);
  } else if (expectedPid && click) {
    const parsed = parseAffiliateClickUrl(click, expectedPid);
    if (!parsed.matchesExpectedWebsitePid) {
      reasons.push(BANNER_WITHDRAWAL_REASON.foreign_publisher_pid);
    }
  }

  if (record?.publicationReady !== true) {
    reasons.push(BANNER_WITHDRAWAL_REASON.publication_not_approved);
  }

  const unique = [...new Set(reasons)];
  return {
    withdraw: unique.length > 0,
    publishable: false,
    reasons: unique,
    evaluatedAt: refDate.toISOString(),
    retainsArchiveEvidence: true,
    displayAllowed: false,
  };
}
