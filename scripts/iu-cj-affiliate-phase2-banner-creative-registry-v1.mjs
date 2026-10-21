#!/usr/bin/env node
/**
 * Offline banner creative registry (CJ Link Search rows) — separate from coupons/products.
 * No public feed; preview/local validation only.
 */
import { classifyBannerRole, assessActionValidity, hashCreativeText } from "./iu-cj-affiliate-phase2-media-inventory-lib.mjs";
import { evaluatePublicationGates } from "./iu-cj-affiliate-phase2-banner-permission-lib.mjs";
import {
  AFFILIATE_CONTENT_KIND,
  classifyCjAffiliateContentKind,
  detectProductImageMislabeledAsBanner,
} from "./iu-cj-affiliate-phase2-affiliate-content-kind.mjs";
import {
  rejectActiveScriptOrHtmlCreative,
  validateBannerImageSourceUrl,
} from "./iu-cj-affiliate-phase2-banner-asset-security-lib.mjs";
import { assessBannerWithdrawalDecision } from "./iu-cj-affiliate-phase2-banner-lifecycle-lib.mjs";
import { parseAffiliateClickUrl } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const BANNER_CREATIVE_SCHEMA = "cj_phase2_banner_creative_v1";

const PRIVATE_HOST =
  /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.)/i;

export function parseBannerDimensions(linkName) {
  const m = String(linkName || "").match(/(\d{2,4})\s*[x×]\s*(\d{2,4})/i);
  if (!m) return { width: null, height: null, parsed: false };
  return { width: Number(m[1]), height: Number(m[2]), parsed: true };
}

export function isHttpsAffiliateUrl(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:") return false;
    if (PRIVATE_HOST.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} link CJ link-search row
 * @param {{ publisherPid?: string, refDate?: Date, permissionCtx?: object }} ctx
 */
export function buildBannerCreativeRecord(link, ctx = {}) {
  const refDate = ctx.refDate instanceof Date ? ctx.refDate : new Date();
  const role = classifyBannerRole(link || {});
  const validity = assessActionValidity(role, link || {}, refDate);
  const dims = parseBannerDimensions(link?.linkName);
  const imageUrl = String(link?.adContent || link?.creativeUrl || "").trim() || null;
  const clickUrl = String(link?.clickUrl || link?.destination || "").trim() || null;
  const pid = String(ctx.publisherPid || link?.websiteId || "").trim() || null;
  const contentKind = classifyCjAffiliateContentKind(link || {});
  const mislabel = detectProductImageMislabeledAsBanner(link || {});
  const scriptGate = rejectActiveScriptOrHtmlCreative(imageUrl || clickUrl);
  const clickParsed = clickUrl ? parseAffiliateClickUrl(clickUrl, pid) : null;
  const gates = ctx.permissionCtx
    ? evaluatePublicationGates(ctx.permissionCtx, {
        row: { ...link, bannerRole: role },
        refDate,
        intendedUse: "local_preview_metadata_and_asset_if_licensed",
      })
    : { publicationReady: false, blockers: ["permission_context_not_provided"] };

  const blockers = Array.isArray(gates.blockers) ? [...gates.blockers] : [];
  if (contentKind !== AFFILIATE_CONTENT_KIND.banner) blockers.push("content_kind_not_banner:" + contentKind);
  if (mislabel.mislabeled) blockers.push(mislabel.reason);
  if (!scriptGate.ok) blockers.push(scriptGate.reason);

  const record = {
    schemaVersion: BANNER_CREATIVE_SCHEMA,
    previewOnly: true,
    publishable: false,
    contentKind: AFFILIATE_CONTENT_KIND.banner,
    materialId: String(link?.linkId || ""),
    advertiserId: String(link?.advertiserId || ""),
    partnerName: String(link?.advertiserName || link?.linkName || "").trim() || null,
    materialType: String(link?.linkType || "Banner"),
    bannerRole: role,
    dimensions: dims,
    imageSourceUrl: imageUrl,
    imageSourceVerified: imageUrl ? isHttpsAffiliateUrl(imageUrl) && scriptGate.ok : false,
    affiliateClickUrl: clickUrl,
    affiliateClickVerified:
      isHttpsAffiliateUrl(clickUrl) &&
      (!pid || clickParsed?.matchesExpectedWebsitePid === true),
    publisherPid: pid,
    linkId: String(link?.linkId || ""),
    creativeFingerprint: hashCreativeText(link?.linkName || link?.description || ""),
    validFrom: link?.promotionStartDate || null,
    validTo: link?.promotionEndDate || null,
    validityState: validity.state,
    publicationReady: gates.publicationReady === true,
    blockers,
    archive: {
      observedAt: link?.lastUpdated || link?.observedAt || null,
      source: "CJ_link_search",
      dataOrigin: ctx.dataOrigin || "offline_fixture",
    },
    validationState: "pending",
  };

  record.withdrawal = assessBannerWithdrawalDecision(record, {
    refDate,
    expectedWebsitePid: pid,
    partnerKnown: ctx.partnerKnown !== false,
    permissionRevoked: ctx.permissionRevoked === true,
    supersedingDenial: ctx.supersedingDenial === true,
    missingEvidence: !ctx.permissionCtx,
    securityBlock: !scriptGate.ok || mislabel.mislabeled,
  });
  record.validationState = record.withdrawal.withdraw ? "withdrawn" : "blocked_preview";
  if (record.publicationReady && !record.withdrawal.withdraw) {
    record.validationState = "eligible_for_archive_only";
  }
  return record;
}

export async function validateBannerImageSourceForRecord(record, options = {}) {
  if (!record?.imageSourceUrl) {
    return { ok: false, reason: "missing_image_source_url" };
  }
  return validateBannerImageSourceUrl(record.imageSourceUrl, options);
}

export function validateBannerCreativeForLocalPreview(record) {
  const hardBlockers = [];
  if (!record?.materialId) hardBlockers.push("missing_material_id");
  if (!record?.advertiserId) hardBlockers.push("missing_advertiser_id");
  if (!record?.affiliateClickVerified) hardBlockers.push("affiliate_click_url_not_verified");
  if (record?.imageSourceUrl && !record?.imageSourceVerified) {
    hardBlockers.push("image_source_url_not_https_or_private");
  }
  if (record?.validityState === "expired_before_reference") hardBlockers.push("expired");
  if (record?.bannerRole === "U_unknown_unclassified_banner") hardBlockers.push("unclassified_banner_role");
  const withdrawReasons = (record?.withdrawal?.reasons || []).filter(
    (r) => r !== "publication_not_approved" && r !== "missing_evidence"
  );
  if (withdrawReasons.length > 0) hardBlockers.push("withdrawn:" + withdrawReasons.join(","));
  if (record?.publishable === true) hardBlockers.push("unexpected_publishable_true");
  return {
    ok: hardBlockers.length === 0,
    hardBlockers,
    publicationBlockers: Array.isArray(record?.blockers) ? record.blockers : [],
    publicationReady: record?.publicationReady === true,
    publishable: false,
    localPreviewAllowed: hardBlockers.length === 0,
  };
}
