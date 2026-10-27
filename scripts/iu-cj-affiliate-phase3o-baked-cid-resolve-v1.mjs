#!/usr/bin/env node
/**
 * Phase 3O — resolve baked-without-CID using live CJ staging evidence only.
 * Never invents advertiser IDs or tracking URLs. Never arms LIVE.
 *
 * Trust order:
 *  1) linkId from baked CJ click URL → Link Search advertiserId (if present + joined)
 *  2) unique normalizePartnerBrand(title) → joined advertiser (requires trusted baked URL)
 *  3) otherwise MANUAL_REVIEW (ambiguous / missing / unpaid-ads untouched)
 */
import {
  isCjTrackingUrl,
  extractLinkIdFromUrl,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { normalizePartnerBrand } from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";
import { inventuryUnifiedButtons, planBakedMigrationUnderManaged, LIFECYCLE_ACTION } from "./iu-cj-affiliate-phase3m-unified-lifecycle-v1.mjs";

export const PHASE3O_BAKED_RESOLVE_SCHEMA = "iu-cj-affiliate-phase3o-baked-cid-resolve-v1";

function isJoined(row) {
  return String(row?.relationshipStatus || row?.status || "")
    .toLowerCase()
    .includes("join");
}

function pickTrustedClickUrl(linkRows = []) {
  for (const L of linkRows) {
    const u = L?.clickUrl || L?.url || "";
    if (isCjTrackingUrl(u)) return u;
  }
  return null;
}

/**
 * Classify each baked-without-CID row against live advertisers + links.
 */
export function classifyBakedWithoutCid({
  inventory,
  advertisers = [],
  links = [],
  managedPublic = null,
} = {}) {
  const advById = new Map(
    (advertisers || []).map((a) => [String(a.advertiserId || a.id), a])
  );
  const linksByLinkId = new Map();
  const linksByAdv = new Map();
  for (const L of links || []) {
    const lid = String(L.linkId || L.id || "");
    const aid = String(L.advertiserId || "");
    if (lid) linksByLinkId.set(lid, L);
    if (aid) {
      if (!linksByAdv.has(aid)) linksByAdv.set(aid, []);
      linksByAdv.get(aid).push(L);
    }
  }

  const nameToIds = new Map();
  for (const a of advertisers || []) {
    const n = normalizePartnerBrand(a.advertiserName || a.partnerName || "");
    if (!n) continue;
    if (!nameToIds.has(n)) nameToIds.set(n, new Set());
    nameToIds.get(n).add(String(a.advertiserId));
  }

  const managedPartners = Array.isArray(managedPublic?.partners)
    ? managedPublic.partners
    : Array.isArray(managedPublic)
      ? managedPublic
      : [];
  const managedIds = new Set(managedPartners.map((p) => String(p.advertiserId)));

  const rows = (inventory?.baked || []).filter((b) => !b.advertiserId);
  const classifications = [];

  for (const b of rows) {
    const extracted = extractLinkIdFromUrl(b.url);
    const linkId = extracted?.linkId || null;
    const linkHit = linkId ? linksByLinkId.get(String(linkId)) : null;
    const nameKey = normalizePartnerBrand(b.title);
    const nameIds = nameToIds.has(nameKey) ? [...nameToIds.get(nameKey)] : [];
    let status = "MANUAL_REVIEW";
    let reason = "unresolved";
    let advertiserId = null;
    let evidence = [];
    let candidateHint = null;

    if (linkHit?.advertiserId) {
      advertiserId = String(linkHit.advertiserId);
      evidence.push("linkId_map");
      const adv = advById.get(advertiserId);
      if (adv && isJoined(adv) && isCjTrackingUrl(b.url)) {
        status = "RESOLVED_ACTIVE_JOINED";
        reason = "baked_linkId_to_joined_cid";
      } else if (adv && !isJoined(adv)) {
        status = "MANUAL_REVIEW";
        reason = "link_maps_cid_not_joined";
      } else if (!adv) {
        status = "MANUAL_REVIEW";
        reason = "link_maps_cid_missing_advertiser_row";
      } else {
        status = "MANUAL_REVIEW";
        reason = "link_maps_but_untrusted_url";
      }
    } else if (nameIds.length === 1 && isCjTrackingUrl(b.url)) {
      advertiserId = nameIds[0];
      evidence.push("unique_name_match");
      const adv = advById.get(advertiserId);
      if (adv && isJoined(adv)) {
        status = "RESOLVED_ACTIVE_JOINED";
        reason = "unique_name_plus_trusted_baked_url";
      } else {
        status = "MANUAL_REVIEW";
        reason = "name_match_but_not_joined";
      }
    } else if (nameIds.length > 1) {
      status = "MANUAL_REVIEW";
      reason = "ambiguous_name_match";
      evidence.push("name_ids=" + nameIds.join(","));
    } else {
      // Soft hint only (never auto-resolve compound / partial names)
      const soft = [...advById.values()].filter((a) => {
        const n = normalizePartnerBrand(a.advertiserName || "");
        return n && nameKey && (n.includes(nameKey) || nameKey.includes(n));
      });
      if (soft.length === 1) {
        candidateHint = {
          advertiserId: String(soft[0].advertiserId),
          name: soft[0].advertiserName,
          relationshipStatus: soft[0].relationshipStatus,
        };
        status = "MANUAL_REVIEW";
        reason = "partial_name_hint_only";
        evidence.push("soft_name_hint");
      } else if (managedPartners.some((p) => normalizePartnerBrand(p.title) === nameKey)) {
        const hit = managedPartners.find((p) => normalizePartnerBrand(p.title) === nameKey);
        advertiserId = String(hit.advertiserId);
        status = "DUPLICATE_OF_MANAGED";
        reason = "baked_title_matches_managed_partner";
        evidence.push("managed_title");
      } else if (!isCjTrackingUrl(b.url)) {
        status = "MANUAL_REVIEW";
        reason = "non_cj_or_untrusted_url";
      } else {
        status = "MANUAL_REVIEW";
        reason = linkId ? "linkId_not_in_current_link_search" : "no_linkId_and_no_name_match";
      }
    }

    classifications.push({
      title: b.title,
      sectionId: b.sectionId,
      url: b.url,
      linkId,
      advertiserId,
      status,
      reason,
      evidence,
      candidateHint,
      urlTrusted: isCjTrackingUrl(b.url),
      alreadyInManaged: advertiserId ? managedIds.has(String(advertiserId)) : false,
      joinedStatus: advertiserId
        ? advById.get(String(advertiserId))?.relationshipStatus || null
        : null,
    });
  }

  const byStatus = classifications.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});

  return {
    schema: PHASE3O_BAKED_RESOLVE_SCHEMA,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    counts: {
      bakedWithoutCid: classifications.length,
      resolvedActiveJoined: byStatus.RESOLVED_ACTIVE_JOINED || 0,
      manualReview: byStatus.MANUAL_REVIEW || 0,
      duplicateOfManaged: byStatus.DUPLICATE_OF_MANAGED || 0,
      byStatus,
    },
    classifications,
  };
}

/**
 * Build migration plan inputs from classifications (preview only).
 */
export function buildMigrationInputsFromClassifications(classifications = []) {
  const confirmedNameToAdvertiserId = {};
  const urlByAdvertiser = {};
  for (const c of classifications) {
    if (c.status !== "RESOLVED_ACTIVE_JOINED" || !c.advertiserId) continue;
    confirmedNameToAdvertiserId[c.title] = String(c.advertiserId);
    if (isCjTrackingUrl(c.url) && !urlByAdvertiser[c.advertiserId]) {
      urlByAdvertiser[c.advertiserId] = c.url;
    }
  }
  return { confirmedNameToAdvertiserId, urlByAdvertiser };
}

/**
 * Probe advertiser for trusted CJ click URL from Link Search rows.
 * Never synthesizes click-<pid>-<cid>.
 */
export function resolveAdvertiserTrustedUrl({
  advertiserId,
  advertisers = [],
  links = [],
  suggestedSection = null,
  titleHints = [],
} = {}) {
  const id = String(advertiserId || "");
  const adv =
    (advertisers || []).find((a) => String(a.advertiserId) === id) ||
    (advertisers || []).find((a) =>
      titleHints.some((h) =>
        normalizePartnerBrand(a.advertiserName || "").includes(normalizePartnerBrand(h))
      )
    ) ||
    null;
  if (!adv) {
    return {
      found: false,
      status: "NOT_IN_JOINED",
      advertiserId: id || null,
      hasTrustedCjUrl: false,
      readyForManagedAdd: false,
    };
  }
  const advLinks = (links || []).filter((L) => String(L.advertiserId) === String(adv.advertiserId));
  const trustedUrl = pickTrustedClickUrl(advLinks);
  const joinedOk = isJoined(adv);
  if (!joinedOk) {
    return {
      found: true,
      status: "NOT_JOINED",
      advertiserId: String(adv.advertiserId),
      advertiserName: adv.advertiserName,
      linkCount: advLinks.length,
      hasTrustedCjUrl: false,
      readyForManagedAdd: false,
    };
  }
  if (!trustedUrl) {
    return {
      found: true,
      status: "MANUAL_REVIEW_MISSING_URL",
      reason: "CJ_LINK_SEARCH_EMPTY_FOR_ADVERTISER",
      advertiserId: String(adv.advertiserId),
      advertiserName: adv.advertiserName,
      relationshipStatus: adv.relationshipStatus,
      accountStatus: adv.accountStatus || null,
      programUrl: adv.programUrl || null,
      suggestedSection: suggestedSection || null,
      linkCount: advLinks.length,
      hasTrustedCjUrl: false,
      readyForManagedAdd: false,
      note: "Do not substitute programUrl/storefront URL for affiliate click URL",
    };
  }
  if (!suggestedSection) {
    return {
      found: true,
      status: "MANUAL_REVIEW",
      reason: "no_trusted_section",
      advertiserId: String(adv.advertiserId),
      advertiserName: adv.advertiserName,
      affiliateUrl: trustedUrl,
      linkCount: advLinks.length,
      hasTrustedCjUrl: true,
      readyForManagedAdd: false,
    };
  }
  return {
    found: true,
    status: "READY_FOR_MANAGED_ADD",
    advertiserId: String(adv.advertiserId),
    advertiserName: adv.advertiserName,
    sectionId: suggestedSection,
    affiliateUrl: trustedUrl,
    linkCount: advLinks.length,
    hasTrustedCjUrl: true,
    readyForManagedAdd: true,
  };
}

/**
 * End-to-end classify + plan (still productionMigrated=false unless caller applies).
 */
export function planBakedMigrationFromLiveStaging({
  catalogSrc = null,
  inventory: inventoryIn = null,
  managedPublic,
  advertisers = [],
  links = [],
} = {}) {
  const inventory =
    inventoryIn || inventuryUnifiedButtons({ catalogSrc, managedPublic });
  const classified = classifyBakedWithoutCid({
    inventory,
    advertisers,
    links,
    managedPublic,
  });
  const { confirmedNameToAdvertiserId, urlByAdvertiser } =
    buildMigrationInputsFromClassifications(classified.classifications);
  const joined = (advertisers || []).map((a) => ({
    advertiserId: String(a.advertiserId),
    advertiserName: a.advertiserName,
    relationshipStatus: a.relationshipStatus,
  }));
  const plan = planBakedMigrationUnderManaged({
    inventory,
    joined,
    confirmedNameToAdvertiserId,
    urlByAdvertiser,
  });
  return {
    schema: PHASE3O_BAKED_RESOLVE_SCHEMA,
    liveEnabled: false,
    publishArmed: false,
    cjLivePublishing: "DISARMED",
    productionMigrated: false,
    inventoryCounts: inventory.counts,
    classified,
    plan,
    migrateSlice: plan.migrateSlice,
    LIFECYCLE_ACTION,
  };
}

export {
  inventuryUnifiedButtons,
  planBakedMigrationUnderManaged,
  isCjTrackingUrl,
  pickTrustedClickUrl,
};
