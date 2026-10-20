#!/usr/bin/env node
/**
 * Offline banner creative registry (CJ Link Search rows) — separate from coupons/products.
 * No public feed; preview/local validation only.
 */
import { classifyBannerRole, assessActionValidity } from "./iu-cj-affiliate-phase2-media-inventory-lib.mjs";
import { evaluatePublicationGates } from "./iu-cj-affiliate-phase2-banner-permission-lib.mjs";

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
  const gates = ctx.permissionCtx
    ? evaluatePublicationGates(ctx.permissionCtx, {
        row: { ...link, bannerRole: role },
        refDate,
        intendedUse: "local_preview_metadata_and_asset_if_licensed",
      })
    : { publicationReady: false, blockers: ["permission_context_not_provided"] };

  return {
    schemaVersion: BANNER_CREATIVE_SCHEMA,
    previewOnly: true,
    materialId: String(link?.linkId || ""),
    advertiserId: String(link?.advertiserId || ""),
    partnerName: String(link?.advertiserName || link?.linkName || "").trim() || null,
    materialType: String(link?.linkType || "Banner"),
    bannerRole: role,
    dimensions: dims,
    imageSourceUrl: imageUrl,
    imageSourceVerified: imageUrl ? isHttpsAffiliateUrl(imageUrl) : false,
    affiliateClickUrl: clickUrl,
    affiliateClickVerified: isHttpsAffiliateUrl(clickUrl),
    publisherPid: pid,
    linkId: String(link?.linkId || ""),
    validFrom: link?.promotionStartDate || null,
    validTo: link?.promotionEndDate || null,
    validityState: validity.state,
    publicationReady: gates.publicationReady === true,
    blockers: Array.isArray(gates.blockers) ? gates.blockers : [],
    archive: {
      observedAt: link?.lastUpdated || link?.observedAt || null,
      source: "CJ_link_search",
    },
  };
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
  return {
    ok: hardBlockers.length === 0,
    hardBlockers,
    publicationBlockers: Array.isArray(record?.blockers) ? record.blockers : [],
    publicationReady: record?.publicationReady === true,
    localPreviewAllowed: hardBlockers.length === 0,
  };
}
