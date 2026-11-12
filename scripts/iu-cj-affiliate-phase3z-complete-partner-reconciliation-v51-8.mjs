/**
 * V51.8 — complete CJ partner reconciliation.
 * Authority: live staging Advertiser Lookup (joined) + prior managed/policy for ENDED detection.
 * CJ Advertiser Lookup relationship-status ∈ {joined, notjoined} only (no PENDING/DECLINED enums).
 * Does NOT arm uncapped growth / email-only / public product identity flood.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  classifyPartnerLifecycleTransition,
  normalizeRelationshipStatus,
} from "./iu-cj-affiliate-phase3z-partner-lifecycle-v51-8.mjs";

export const PARTNER_RECON_SCHEMA = "iu-cj-affiliate-phase3z-complete-partner-reconciliation-v51-8";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p, fallback = null) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function uniq(ids) {
  return [...new Set((ids || []).map(String).filter((x) => x && x !== "null" && x !== "undefined"))].sort();
}

/**
 * CJ API completeness proof from sync audit + staging advertisers.
 */
export function assertJoinedFetchCompleteness(staging, audit) {
  const advertisers = Array.isArray(staging?.advertisers) ? staging.advertisers : [];
  const ids = uniq(advertisers.map((a) => a.advertiserId));
  const totalMatched = audit?.advertiserTotalMatched;
  const httpAdv = (audit?.http || []).filter((h) => String(h.kind || "").includes("advertiser"));
  const pagesOk = httpAdv.length > 0 && httpAdv.every((h) => h.ok === true);
  const incomplete = Boolean(audit?.errors?.some((e) => /pagination_incomplete|empty_page_before_complete/i.test(String(e))));
  const matchedOk =
    totalMatched == null
      ? false
      : Number(totalMatched) === advertisers.length && advertisers.length === ids.length;
  return {
    ok:
      staging?.source === "cj_api_xml" &&
      staging?.apiOutage !== true &&
      pagesOk &&
      !incomplete &&
      matchedOk &&
      ids.length > 0,
    advertiserCount: advertisers.length,
    uniqueIds: ids.length,
    totalMatched: totalMatched ?? null,
    httpAdvertiserPages: httpAdv.length,
    pagesOk,
    incomplete,
    matchedOk,
    source: staging?.source || null,
    generatedAt: staging?.generatedAt || null,
    note:
      "Completeness requires live XML fetch, all advertiser pages OK, and records.length === totalMatched with unique IDs.",
  };
}

/**
 * Build set inventories for reconciliation.
 */
export function buildPartnerReconciliation(opts = {}) {
  const staging = opts.staging || { advertisers: [] };
  const audit = opts.audit || {};
  const registryPartners = Array.isArray(opts.registryPartners) ? opts.registryPartners : [];
  const policyPartners = Array.isArray(opts.policyPartners) ? opts.policyPartners : [];
  const managedPartners = Array.isArray(opts.managedPartners) ? opts.managedPartners : [];
  const offersSections = Array.isArray(opts.offersSections) ? opts.offersSections : [];
  const sectionMap = opts.sectionMap && typeof opts.sectionMap === "object" ? opts.sectionMap : {};

  const completeness = assertJoinedFetchCompleteness(staging, audit);

  const cjJoinedAll = uniq(
    (staging.advertisers || [])
      .filter((a) => normalizeRelationshipStatus(a.relationshipStatus) === "joined")
      .map((a) => a.advertiserId),
  );
  const cjJoinedMap = new Map(
    (staging.advertisers || []).map((a) => [String(a.advertiserId), a]),
  );

  const robotIds = uniq(registryPartners.map((p) => p.advertiserId));
  const robotById = new Map(registryPartners.map((p) => [String(p.advertiserId), p]));

  const policyIds = uniq(policyPartners.map((p) => p.advertiserId));
  const policyById = new Map(
    policyPartners.filter((p) => p?.advertiserId != null).map((p) => [String(p.advertiserId), p]),
  );

  const managedIds = uniq(managedPartners.map((p) => p.advertiserId));
  const managedById = new Map(
    managedPartners.filter((p) => p?.advertiserId != null).map((p) => [String(p.advertiserId), p]),
  );
  const publicActiveManaged = managedPartners.filter((p) => p && p.active !== false);
  const publicActiveIds = uniq(publicActiveManaged.map((p) => p.advertiserId));

  const offersAdvIds = uniq(offersSections.map((s) => s.advertiserId));

  const JOINED_MISSING_FROM_ROBOT = cjJoinedAll.filter((id) => !robotById.has(id));
  const JOINED_MISSING_FROM_POLICY = cjJoinedAll.filter((id) => !policyById.has(id));
  const JOINED_MISSING_FROM_MANAGED = cjJoinedAll.filter((id) => !managedById.has(id));
  const JOINED_MISSING_FROM_PUBLIC = cjJoinedAll.filter((id) => !publicActiveIds.includes(id));

  const ENDED_STILL_PUBLIC = publicActiveIds.filter((id) => !cjJoinedMap.has(id));
  const PENDING_STILL_PUBLIC = []; // Advertiser Lookup has no pending enum; reserved

  const inventory = cjJoinedAll.map((id) => {
    const cj = cjJoinedMap.get(id) || {};
    const robot = robotById.get(id) || null;
    const policy = policyById.get(id) || null;
    const managed = managedById.get(id) || null;
    const onOffers = offersAdvIds.includes(id);
    const hasUrl = Boolean(robot?.selectedClickUrl || managed?.url || policy?.url);
    const urlOk = isCjTrackingUrl(robot?.selectedClickUrl || managed?.url || policy?.url || "");
    const sectionId =
      robot?.sectionId || managed?.sectionId || policy?.sectionId || sectionMap[id] || null;
    const mainReady = robot?.mainButtonReady === true || robot?.mainButtonStatus === "MAIN_BUTTON_READY";
    const enrollmentEligible =
      mainReady && hasUrl && urlOk && Boolean(sectionId) && (!policy || policy.management === "CJ_MANAGED");
    let hideReason = null;
    if (!sectionId) hideReason = "MISSING_CATEGORY";
    else if (!hasUrl || !urlOk) hideReason = "INVALID_OR_MISSING_AFFILIATE_URL";
    else if (robot?.mainButtonStatus === "UNSUITABLE_CUSTOMER_DESTINATION")
      hideReason = "UNSUITABLE_CUSTOMER_DESTINATION";
    else if (robot?.czMarketEligibilityVerified === false) hideReason = "CZ_NOT_VERIFIED";
    else if (!publicActiveIds.includes(id) && enrollmentEligible)
      hideReason = "ELIGIBLE_AWAITING_POLICY_OR_PUBLISH";
    else if (!publicActiveIds.includes(id) && !policy)
      hideReason = "UNASSIGNED_NOT_IN_SLOT_POLICY";
    else if (!publicActiveIds.includes(id)) hideReason = "NOT_ON_PUBLIC_MANAGED_OVERLAY";

    return {
      advertiserId: id,
      cjName: cj.advertiserName || robot?.cjName || null,
      displayNameCs: robot?.displayNameCs || managed?.title || policy?.title || null,
      relationshipStatus: "joined",
      accountStatus: cj.accountStatus || robot?.accountStatus || null,
      programUrl: cj.programUrl || robot?.programUrl || null,
      primaryCategory: cj.primaryCategory || robot?.categoryKey || null,
      sectionId,
      management: policy?.management || robot?.management || null,
      hasAffiliateUrl: hasUrl,
      affiliateUrlValid: urlOk,
      mainButtonReady: mainReady,
      mainButtonStatus: robot?.mainButtonStatus || null,
      onRobot: Boolean(robot),
      onPolicy: Boolean(policy),
      onManagedPublic: Boolean(managed),
      managedActive: managed ? managed.active !== false : false,
      onOffersProducts: onOffers,
      assortmentMulti: (robot?.assortmentProfile?.significantGroups || []).length > 1,
      enrollmentEligible,
      hideReason,
      lastVerifiedAt: robot?.lastVerifiedAt || null,
    };
  });

  const enrollCandidates = inventory.filter(
    (r) => r.enrollmentEligible && (!r.onPolicy || !r.onManagedPublic || !r.managedActive),
  );
  const legitimatelyUnpublished = inventory.filter(
    (r) => !r.managedActive && !r.enrollmentEligible,
  );
  const missingCategory = inventory.filter((r) => !r.sectionId).map((r) => r.advertiserId);
  const invalidAffiliateUrl = inventory
    .filter((r) => !r.affiliateUrlValid)
    .map((r) => r.advertiserId);

  const duplicatePrograms = [];
  const byBrand = new Map();
  for (const r of inventory) {
    const key = String(r.cjName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    if (!key) continue;
    if (!byBrand.has(key)) byBrand.set(key, []);
    byBrand.get(key).push(r.advertiserId);
  }
  for (const [brand, ids] of byBrand) {
    if (ids.length > 1) duplicatePrograms.push({ brandKey: brand, advertiserIds: ids });
  }

  // Lifecycle evidence for ENDED still public
  const endedLifecycle = ENDED_STILL_PUBLIC.map((id) => {
    const prev = managedById.get(id);
    const t = classifyPartnerLifecycleTransition("joined", "ended");
    return {
      advertiserId: id,
      title: prev?.title || null,
      url: prev?.url || null,
      sectionId: prev?.sectionId || null,
      transition: t.transition,
      action: "SET_ACTIVE_FALSE",
    };
  });

  const counts = {
    cjAllKnownInLookupJoined: cjJoinedAll.length,
    cjJoinedActive: cjJoinedAll.length,
    cjPending: null, // not provided by Advertiser Lookup
    cjEndedDetectedViaManagedDiff: ENDED_STILL_PUBLIC.length,
    robotRegistered: robotIds.length,
    policyRegistered: policyIds.length,
    publicActiveManaged: publicActiveIds.length,
    offersProductAdvertisers: offersAdvIds.length,
    joinedMissingFromRobot: JOINED_MISSING_FROM_ROBOT.length,
    joinedMissingFromPolicy: JOINED_MISSING_FROM_POLICY.length,
    joinedMissingFromManaged: JOINED_MISSING_FROM_MANAGED.length,
    joinedMissingFromPublic: JOINED_MISSING_FROM_PUBLIC.length,
    endedStillPublic: ENDED_STILL_PUBLIC.length,
    pendingStillPublic: PENDING_STILL_PUBLIC.length,
    enrollmentEligible: enrollCandidates.length,
    legitimatelyUnpublished: legitimatelyUnpublished.length,
    missingCategory: missingCategory.length,
    invalidAffiliateUrl: invalidAffiliateUrl.length,
    duplicateProgramGroups: duplicatePrograms.length,
  };

  return {
    schema: PARTNER_RECON_SCHEMA,
    at: new Date().toISOString(),
    completeness,
    counts,
    sets: {
      CJ_JOINED_ALL: cjJoinedAll,
      ROBOT_REGISTERED: robotIds,
      PUBLIC_ACTIVE: publicActiveIds,
      JOINED_MISSING_FROM_ROBOT,
      JOINED_MISSING_FROM_POLICY,
      JOINED_MISSING_FROM_MANAGED,
      JOINED_MISSING_FROM_PUBLIC,
      ENDED_STILL_PUBLIC,
      PENDING_STILL_PUBLIC,
      DUPLICATE_PROGRAMS: duplicatePrograms,
      INVALID_AFFILIATE_URL: invalidAffiliateUrl,
      MISSING_CATEGORY: missingCategory,
      ENROLLMENT_CANDIDATES: enrollCandidates.map((r) => r.advertiserId),
    },
    inventory,
    enrollCandidates,
    endedLifecycle,
    apiStatusMapping: {
      joined: "JOINED / ACTIVE cooperation",
      notjoined: "Not currently joined (covers never-joined + ended/declined from Lookup POV)",
      pending: "NOT_EXPOSED_BY_ADVERTISER_LOOKUP",
      declined: "NOT_EXPOSED_BY_ADVERTISER_LOOKUP",
      ended: "INFERRED_WHEN_ABSENT_FROM_JOINED_BUT_PRESENT_IN_PRIOR_MANAGED_OR_POLICY",
    },
    note:
      "Robot registry is expected to equal CJ_JOINED_ALL after each live fetch. Public buttons require slot-policy CJ_MANAGED + publish gate. Product offers remain growth-gated.",
  };
}

/**
 * Apply safe policy + section-map enrollment for eligible JOINED partners.
 * Never mutates MANUAL_PROTECTED / PAID_RESERVED rows. Removes bogus null advertiserIds.
 */
export function applyPartnerEnrollment(opts = {}) {
  const recon = opts.recon || buildPartnerReconciliation(opts);
  const policy = JSON.parse(JSON.stringify(opts.policy || { partners: [] }));
  const sectionMap = JSON.parse(JSON.stringify(opts.sectionMap || {}));
  const managed = JSON.parse(
    JSON.stringify(opts.managed || { schema: "iu-affiliate-cj-managed-public-v1", partners: [] }),
  );

  const partners = Array.isArray(policy.partners) ? policy.partners : [];
  // MANUAL_PROTECTED / PAID_RESERVED may intentionally use advertiserId:null (baked chips).
  // Only drop bogus null-ID rows that are not protected.
  policy.partners = partners.filter((p) => {
    if (!p) return false;
    const mgmt = String(p.management || "");
    if (mgmt === "MANUAL_PROTECTED" || mgmt === "PAID_RESERVED") return true;
    return p.advertiserId != null && String(p.advertiserId) !== "null";
  });

  const byId = new Map(
    policy.partners
      .filter((p) => p?.advertiserId != null && String(p.advertiserId) !== "null")
      .map((p) => [String(p.advertiserId), p]),
  );
  const added = [];
  const skippedProtected = [];
  const sectionMapAdded = [];

  for (const row of recon.enrollCandidates) {
    const id = String(row.advertiserId);
    const existing = byId.get(id);
    if (existing && (existing.management === "MANUAL_PROTECTED" || existing.management === "PAID_RESERVED")) {
      skippedProtected.push(id);
      continue;
    }
    // Never convert a protected null-ID chip by title collision; only add discrete CJ_MANAGED rows.
    const robot = (opts.registryPartners || []).find((p) => String(p.advertiserId) === id);
    const url = robot?.selectedClickUrl || existing?.url || "";
    const sectionId = row.sectionId || existing?.sectionId;
    const title = robot?.displayNameCs || robot?.cjName || existing?.title || row.cjName || id;
    if (!sectionId || !isCjTrackingUrl(url)) continue;

    if (!sectionMap[id]) {
      sectionMap[id] = sectionId;
      sectionMapAdded.push(id);
    }

    const next = {
      sectionId,
      sectionTitle: existing?.sectionTitle || robot?.sectionTitleCs || sectionId,
      slotIndex: existing?.slotIndex != null ? existing.slotIndex : policy.partners.length,
      title,
      url,
      advertiserId: id,
      management: "CJ_MANAGED",
    };
    if (existing) {
      Object.assign(existing, next, { management: "CJ_MANAGED" });
    } else {
      policy.partners.push(next);
      byId.set(id, next);
      added.push(id);
    }
  }

  // ENDED still public → active:false on managed overlay; drop from CJ_MANAGED policy auto-list only if not protected
  const endedDeactivated = [];
  for (const ended of recon.endedLifecycle) {
    const id = String(ended.advertiserId);
    const mp = (managed.partners || []).find((p) => String(p.advertiserId) === id);
    if (mp && mp.active !== false) {
      mp.active = false;
      mp.endedReason = "absent_from_cj_joined_lookup";
      endedDeactivated.push(id);
    }
    const pol = byId.get(id);
    if (pol && pol.management === "CJ_MANAGED") {
      // keep row for audit but mark inactive via managed; do not delete MANUAL_PROTECTED
      pol.endedConfirmed = true;
    }
  }

  // Ensure enrolled also appear on managed overlay (active) when eligible
  if (!Array.isArray(managed.partners)) managed.partners = [];
  const managedById = new Map(managed.partners.map((p) => [String(p.advertiserId), p]));
  const managedAdded = [];
  for (const id of added) {
    const pol = byId.get(id);
    if (!pol) continue;
    const prev = managedById.get(id);
    const row = {
      advertiserId: id,
      sectionId: pol.sectionId,
      title: pol.title,
      url: pol.url,
      active: true,
    };
    if (prev) Object.assign(prev, row);
    else {
      managed.partners.push(row);
      managedAdded.push(id);
    }
  }

  const cjManaged = policy.partners.filter((p) => p.management === "CJ_MANAGED").length;
  const manual = policy.partners.filter((p) => p.management === "MANUAL_PROTECTED").length;
  const paid = policy.partners.filter((p) => p.management === "PAID_RESERVED").length;
  policy.counts = {
    total: policy.partners.length,
    MANUAL_PROTECTED: manual,
    CJ_MANAGED: cjManaged,
    PAID_RESERVED: paid,
  };
  policy.generatedAt = new Date().toISOString();
  sectionMap._updatedAt = new Date().toISOString();
  sectionMap._source = "phase3z-complete-partner-reconciliation-v51-8";
  managed.updatedAt = new Date().toISOString();

  return {
    policy,
    sectionMap,
    managed,
    added,
    managedAdded,
    sectionMapAdded,
    endedDeactivated,
    skippedProtected,
    enrollCandidateCount: recon.enrollCandidates.length,
  };
}

export function runPartnerReconciliationSelftest() {
  const staging = {
    source: "cj_api_xml",
    apiOutage: false,
    generatedAt: "2026-11-12T00:00:00.000Z",
    advertisers: [
      { advertiserId: "1", advertiserName: "A", relationshipStatus: "joined", accountStatus: "Active" },
      { advertiserId: "2", advertiserName: "B", relationshipStatus: "joined", accountStatus: "Active" },
      { advertiserId: "3", advertiserName: "C", relationshipStatus: "joined", accountStatus: "Active" },
    ],
  };
  const audit = {
    advertiserTotalMatched: 3,
    http: [
      { kind: "advertiser_lookup_joined", page: 1, ok: true },
    ],
    errors: [],
  };
  const registryPartners = [
    {
      advertiserId: "1",
      cjName: "A",
      displayNameCs: "A",
      sectionId: "aff-elektro",
      selectedClickUrl: "https://www.kqzyfj.com/click-101883843-111",
      mainButtonReady: true,
      mainButtonStatus: "MAIN_BUTTON_READY",
      management: "UNASSIGNED",
    },
    {
      advertiserId: "2",
      cjName: "B",
      sectionId: "aff-moda",
      selectedClickUrl: "https://www.kqzyfj.com/click-101883843-222",
      mainButtonReady: true,
      mainButtonStatus: "MAIN_BUTTON_READY",
      management: "CJ_MANAGED",
    },
    {
      advertiserId: "3",
      cjName: "C",
      sectionId: null,
      selectedClickUrl: "https://www.kqzyfj.com/click-101883843-333",
      mainButtonReady: false,
      mainButtonStatus: "SECTION_UNRESOLVED",
      management: "UNASSIGNED",
    },
  ];
  const policyPartners = [
    {
      advertiserId: null,
      management: "MANUAL_PROTECTED",
      sectionId: "aff-ubytovani-hotely",
      title: "Booking.com",
      url: "https://www.anrdoezrs.net/click-101883843-13323565",
    },
    {
      advertiserId: "2",
      management: "CJ_MANAGED",
      sectionId: "aff-moda",
      title: "B",
      url: "https://www.kqzyfj.com/click-101883843-222",
    },
    {
      advertiserId: "9",
      management: "CJ_MANAGED",
      sectionId: "aff-auto-moto",
      title: "EndedStillPublic",
      url: "https://www.kqzyfj.com/click-101883843-999",
    },
  ];
  const managedPartners = [
    {
      advertiserId: "2",
      sectionId: "aff-moda",
      title: "B",
      url: "https://www.kqzyfj.com/click-101883843-222",
      active: true,
    },
    {
      advertiserId: "9",
      sectionId: "aff-auto-moto",
      title: "EndedStillPublic",
      url: "https://www.kqzyfj.com/click-101883843-999",
      active: true,
    },
  ];

  const recon = buildPartnerReconciliation({
    staging,
    audit,
    registryPartners,
    policyPartners,
    managedPartners,
    offersSections: [{ advertiserId: "2" }],
  });
  const applied = applyPartnerEnrollment({
    recon,
    policy: { partners: policyPartners },
    sectionMap: {},
    managed: { partners: managedPartners },
    registryPartners,
  });

  const checks = [
    {
      name: "completeness_ok",
      ok: recon.completeness.ok === true,
    },
    {
      name: "joined_count",
      ok: recon.counts.cjJoinedActive === 3,
    },
    {
      name: "missing_robot_zero",
      ok: recon.counts.joinedMissingFromRobot === 0,
    },
    {
      name: "ended_still_public",
      ok: recon.sets.ENDED_STILL_PUBLIC.includes("9"),
    },
    {
      name: "enroll_adds_1",
      ok: applied.added.includes("1"),
    },
    {
      name: "ended_deactivated",
      ok: applied.endedDeactivated.includes("9"),
    },
    {
      name: "missing_category_3",
      ok: recon.sets.MISSING_CATEGORY.includes("3"),
    },
    {
      name: "manual_protected_preserved",
      ok:
        applied.policy.partners.some(
          (p) => p.management === "MANUAL_PROTECTED" && p.title === "Booking.com" && p.advertiserId == null,
        ) === true,
    },
  ];
  const failed = checks.filter((c) => !c.ok);
  return { ok: failed.length === 0, failed: failed.map((f) => f.name), checks, reconCounts: recon.counts };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const dataDir = path.join(ROOT, "projects", "data");
  const stagingPath =
    process.env.IU_CJ_STAGING_PATH ||
    path.join(process.env.TEMP || "/tmp", "iu-cj-v518-partner-recon/staging/iu-affiliate-cj-staging-v1.json");
  const auditPath =
    process.env.IU_CJ_SYNC_AUDIT_PATH ||
    path.join(process.env.TEMP || "/tmp", "iu-cj-v518-partner-recon/staging/iu-affiliate-cj-sync-audit-v1.json");
  const registryPath =
    process.env.IU_CJ_REGISTRY_PATH ||
    path.join(
      process.env.TEMP || "/tmp",
      "iu-cj-v518-partner-recon/registry/phase3z-out/iu-affiliate-cj-partner-registry-v1.json",
    );

  const staging = readJson(stagingPath, { advertisers: [] });
  const audit = readJson(auditPath, {});
  const registry = readJson(registryPath, { partners: [] });
  const policy = readJson(path.join(dataDir, "iu-affiliate-slot-policy-v1.json"), { partners: [] });
  const sectionMap = readJson(path.join(dataDir, "iu-affiliate-cj-section-map-v1.json"), {});
  const managed = readJson(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), {
    partners: [],
  });
  // Prefer production managed snapshot when provided
  const managedProdPath = process.env.IU_CJ_MANAGED_PUBLIC_PATH;
  const managedEffective = managedProdPath ? readJson(managedProdPath, managed) : managed;
  const offers = readJson(path.join(dataDir, "iu-affiliate-cj-offers-public-v1.json"), { sections: [] });

  const recon = buildPartnerReconciliation({
    staging,
    audit,
    registryPartners: registry.partners || [],
    policyPartners: policy.partners || [],
    managedPartners: managedEffective.partners || [],
    offersSections: offers.sections || [],
    sectionMap,
  });

  const outDir =
    process.env.IU_CJ_RECON_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-cj-v518-partner-recon/evidence");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "complete-reconciliation.json"), JSON.stringify(recon, null, 2) + "\n");

  const apply = process.env.IU_CJ_RECON_APPLY === "1";
  let applied = null;
  if (apply) {
    applied = applyPartnerEnrollment({
      recon,
      policy,
      sectionMap,
      managed: managedEffective,
      registryPartners: registry.partners || [],
    });
    fs.writeFileSync(
      path.join(dataDir, "iu-affiliate-slot-policy-v1.json"),
      JSON.stringify(applied.policy, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(dataDir, "iu-affiliate-cj-section-map-v1.json"),
      JSON.stringify(applied.sectionMap, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"),
      JSON.stringify(applied.managed, null, 2) + "\n",
    );
    fs.writeFileSync(path.join(outDir, "enrollment-apply.json"), JSON.stringify({
      added: applied.added,
      managedAdded: applied.managedAdded,
      sectionMapAdded: applied.sectionMapAdded,
      endedDeactivated: applied.endedDeactivated,
      skippedProtected: applied.skippedProtected,
      enrollCandidateCount: applied.enrollCandidateCount,
    }, null, 2) + "\n");
  }

  console.log(
    JSON.stringify(
      {
        schema: PARTNER_RECON_SCHEMA,
        completenessOk: recon.completeness.ok,
        counts: recon.counts,
        applied: apply,
        added: applied?.added?.length || 0,
        endedDeactivated: applied?.endedDeactivated || [],
      },
      null,
      2,
    ),
  );
}
