/**
 * Phase A: prepare partner → section → first free empty-* slot plan (no public publish).
 * Phase B: stub only — requires explicit publication approval; never mutates catalog here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTrustedCjClickHost, parseAffiliateClickUrl } from "./iu-cj-affiliate-phase2-product-api.mjs";
import {
  buildCatalogSlotInventory,
  findFirstFreeEmptySlot,
  findOccupiedButtonForPartner,
  SLOT_KIND,
} from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_APPROVED = path.join(ROOT, "scripts", "fixtures", "cj-phase2-approved-partners-v1.json");

export const PLAN_DECISION = Object.freeze({
  already_has_button: "already_has_button",
  planned_fill: "planned_fill",
  no_free_slot: "no_free_slot",
  /** Phase 3F: append CJ_MANAGED chip without freeEmpty slot (overlay path). */
  unlimited_append: "unlimited_append",
  manual_review: "manual_review",
  unmapped: "unmapped",
  missing_affiliate_url: "missing_affiliate_url",
  invalid_affiliate_url: "invalid_affiliate_url",
  not_publication_approved: "not_publication_approved",
  skip_duplicate_partner: "skip_duplicate_partner",
});

export function loadApprovedPartnersRegistry(filePath = DEFAULT_APPROVED) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    schemaVersion: raw.schemaVersion || 1,
    publishableByDefault: raw.publishableByDefault === true,
    partners: Array.isArray(raw.partners) ? raw.partners : [],
    sourcePath: filePath,
  };
}

export function verifyAffiliateUrl(url, expectedWebsitePid = "101883843", options = {}) {
  const raw = String(url || "").trim();
  if (!raw) return { ok: false, reason: "missing_affiliate_url", verifiedAt: null };
  if (!/^https:\/\//i.test(raw)) return { ok: false, reason: "invalid_affiliate_url_scheme", verifiedAt: null };
  if (!isTrustedCjClickHost(raw)) return { ok: false, reason: "untrusted_click_host", verifiedAt: null };
  const parsed = parseAffiliateClickUrl(raw, expectedWebsitePid);
  if (!parsed.documentedFormat) return { ok: false, reason: "undocumented_click_url", verifiedAt: null };
  if (expectedWebsitePid && !parsed.matchesExpectedWebsitePid) {
    return { ok: false, reason: "website_pid_mismatch", verifiedAt: null, detail: parsed };
  }
  return {
    ok: true,
    reason: "verified",
    verifiedAt: options.verifiedAt || options.observedAt || new Date().toISOString(),
    cjLinkId: parsed.linkIdInUrl,
    websitePid: parsed.websitePidInUrl,
  };
}

function isPublicationApproved(partner) {
  const s = String(partner?.approvalState || "");
  return s === "approved_live" || s === "approved_pending_button";
}

/**
 * Deterministic partner → section resolution (no AI as authority).
 */
export function resolvePartnerSection(partner, mappingRules = {}) {
  if (partner?.primarySectionId) {
    return { sectionId: partner.primarySectionId, reason: "explicit_approved_primary_section", confidence: "high" };
  }
  const manual = mappingRules?.manualPrimarySectionByAdvertiserId?.[String(partner?.advertiserId || "")];
  if (manual?.sectionId) {
    return { sectionId: manual.sectionId, reason: manual.reason || "manual_advertiser_override", confidence: "high" };
  }
  if (String(partner?.approvalState) === "manual_review") {
    return { sectionId: null, reason: "manual_review_required", confidence: "none" };
  }
  return { sectionId: null, reason: "unmapped_no_trusted_section", confidence: "none" };
}

/**
 * Phase A planner — idempotent, never mutates catalog.
 */
export function planPartnerSlotAssignments(options = {}) {
  const registry = options.registry || loadApprovedPartnersRegistry(options.approvedPartnersPath);
  const inventory = options.inventory || buildCatalogSlotInventory({ catalogSrc: options.catalogSrc, slotPolicy: options.slotPolicy });
  const websitePid = options.websitePid || "101883843";
  const mappingRules = options.mappingRules || {};
  const observedAt = options.observedAt || new Date().toISOString();

  const decisions = [];
  const plannedFills = [];
  const claimedFreeSlots = new Set();
  const seenPartnerIds = new Set();

  for (const partner of registry.partners) {
    const partnerId = String(partner.partnerId || partner.advertiserId || "");
    if (seenPartnerIds.has(partnerId)) {
      decisions.push({
        partnerId,
        decision: PLAN_DECISION.skip_duplicate_partner,
        publishable: false,
      });
      continue;
    }
    seenPartnerIds.add(partnerId);

    if (!isPublicationApproved(partner)) {
      const decision =
        String(partner.approvalState) === "manual_review"
          ? PLAN_DECISION.manual_review
          : String(partner.approvalState || "").includes("not_publication")
            ? PLAN_DECISION.not_publication_approved
            : PLAN_DECISION.unmapped;
      decisions.push({
        partnerId,
        advertiserId: partner.advertiserId || null,
        displayName: partner.displayName || null,
        decision,
        sectionId: null,
        slotIndex: null,
        publishable: false,
        reason: partner.approvalState || "not_approved",
      });
      continue;
    }

    const existing = findOccupiedButtonForPartner(inventory, partner);
    if (existing.found) {
      decisions.push({
        partnerId,
        advertiserId: partner.advertiserId || null,
        displayName: partner.displayName || null,
        decision: PLAN_DECISION.already_has_button,
        sectionId: existing.button.sectionId,
        slotIndex: existing.button.slotIndex,
        existingTitle: existing.button.title,
        existingUrl: existing.button.url,
        match: existing.match,
        ambiguous: existing.ambiguous === true,
        publishable: false,
        note: "Do not overwrite or duplicate existing public button",
      });
      continue;
    }

    const sectionRes = resolvePartnerSection(partner, mappingRules);
    if (!sectionRes.sectionId) {
      decisions.push({
        partnerId,
        advertiserId: partner.advertiserId || null,
        displayName: partner.displayName || null,
        decision: PLAN_DECISION.manual_review,
        sectionId: null,
        slotIndex: null,
        publishable: false,
        reason: sectionRes.reason,
      });
      continue;
    }

    const urlCheck = verifyAffiliateUrl(partner.affiliateUrl, websitePid, { observedAt });
    if (!urlCheck.ok) {
      decisions.push({
        partnerId,
        advertiserId: partner.advertiserId || null,
        displayName: partner.displayName || null,
        decision:
          urlCheck.reason === "missing_affiliate_url"
            ? PLAN_DECISION.missing_affiliate_url
            : PLAN_DECISION.invalid_affiliate_url,
        sectionId: sectionRes.sectionId,
        slotIndex: null,
        publishable: false,
        reason: urlCheck.reason,
      });
      continue;
    }

    const free = findFirstFreeEmptySlot(inventory, sectionRes.sectionId);
    if (!free.ok) {
      decisions.push({
        partnerId,
        advertiserId: partner.advertiserId || null,
        displayName: partner.displayName || null,
        decision: PLAN_DECISION.no_free_slot,
        sectionId: sectionRes.sectionId,
        slotIndex: null,
        publishable: false,
        reason: free.reason,
      });
      continue;
    }

    const claimKey = sectionRes.sectionId + ":" + free.slot.slotIndex;
    if (claimedFreeSlots.has(claimKey)) {
      // Concurrent/sequential claim within same plan — find next free
      const sec = inventory.sections.find((s) => s.sectionId === sectionRes.sectionId);
      const next = (sec?.slots || []).find(
        (s) => s.slotKind === SLOT_KIND.free_empty && !claimedFreeSlots.has(sectionRes.sectionId + ":" + s.slotIndex)
      );
      if (!next) {
        decisions.push({
          partnerId,
          advertiserId: partner.advertiserId || null,
          displayName: partner.displayName || null,
          decision: PLAN_DECISION.no_free_slot,
          sectionId: sectionRes.sectionId,
          slotIndex: null,
          publishable: false,
          reason: "no_free_slot_after_concurrent_claim",
        });
        continue;
      }
      claimedFreeSlots.add(sectionRes.sectionId + ":" + next.slotIndex);
      const fill = {
        partnerId,
        advertiserId: partner.advertiserId || null,
        displayName: partner.displayName,
        partnerSlug: partner.partnerSlug || null,
        sectionId: sectionRes.sectionId,
        slotIndex: next.slotIndex,
        slotSlug: next.slug,
        affiliateUrl: partner.affiliateUrl,
        affiliateUrlSource: partner.affiliateUrlSource || null,
        affiliateUrlVerification: urlCheck,
        cjLinkId: urlCheck.cjLinkId || partner.cjLinkId || null,
        observedAt,
        phase: "A",
        publicCatalogMutation: false,
        publishable: false,
        rel: "sponsored noopener",
        target: "_blank",
      };
      plannedFills.push(fill);
      decisions.push({
        partnerId,
        decision: PLAN_DECISION.planned_fill,
        ...fill,
      });
      continue;
    }

    claimedFreeSlots.add(claimKey);
    const fill = {
      partnerId,
      advertiserId: partner.advertiserId || null,
      displayName: partner.displayName,
      partnerSlug: partner.partnerSlug || null,
      sectionId: sectionRes.sectionId,
      slotIndex: free.slot.slotIndex,
      slotSlug: free.slot.slug,
      affiliateUrl: partner.affiliateUrl,
      affiliateUrlSource: partner.affiliateUrlSource || null,
      affiliateUrlVerification: urlCheck,
      cjLinkId: urlCheck.cjLinkId || partner.cjLinkId || null,
      observedAt,
      phase: "A",
      publicCatalogMutation: false,
      publishable: false,
      rel: "sponsored noopener",
      target: "_blank",
    };
    plannedFills.push(fill);
    decisions.push({
      partnerId,
      decision: PLAN_DECISION.planned_fill,
      ...fill,
    });
  }

  const counts = {
    already_has_button: decisions.filter((d) => d.decision === PLAN_DECISION.already_has_button).length,
    planned_fill: plannedFills.length,
    no_free_slot: decisions.filter((d) => d.decision === PLAN_DECISION.no_free_slot).length,
    manual_review: decisions.filter((d) => d.decision === PLAN_DECISION.manual_review).length,
    unmapped: decisions.filter((d) => d.decision === PLAN_DECISION.unmapped).length,
    not_publication_approved: decisions.filter((d) => d.decision === PLAN_DECISION.not_publication_approved).length,
    missing_affiliate_url: decisions.filter((d) => d.decision === PLAN_DECISION.missing_affiliate_url).length,
    invalid_affiliate_url: decisions.filter((d) => d.decision === PLAN_DECISION.invalid_affiliate_url).length,
  };

  return {
    ok: true,
    phase: "A",
    generatedAt: observedAt,
    publishable: false,
    publicCatalogMutation: false,
    catalogMutated: false,
    inventorySummary: {
      sectionCount: inventory.sectionCount,
      occupiedButtonCount: inventory.occupiedButtonCount,
      freeEmptySlotCount: inventory.freeEmptySlotCount,
      reservedSlotCount: inventory.reservedSlotCount,
      blockedSlotCount: inventory.blockedSlotCount,
      paidSlotCount: inventory.paidSlotCount,
      livePartnerCount: inventory.livePartnerCount,
    },
    counts,
    plannedFills,
    decisions,
    phaseB: {
      ready: false,
      blocked: true,
      reason: "phase_B_requires_explicit_publication_approval",
      requires: [
        "explicit_plan_approval",
        "revalidate_slot_still_free",
        "revalidate_partner_approval",
        "revalidate_affiliate_url",
        "standard_PR_and_required_CI",
      ],
    },
    CJ_LIVE_HTTP_CALLS: 0,
  };
}

/**
 * Phase 3F — unlimited dynamic fills (no freeEmpty gate).
 * Plans CJ_MANAGED append via managed-public overlay; never mutates catalog JS;
 * never touches MANUAL_PROTECTED. publishable stays false until promote GO.
 */
export function planUnlimitedDynamicFills(options = {}) {
  const partners = Array.isArray(options.partners) ? options.partners : [];
  const websitePid = options.websitePid || "101883843";
  const observedAt = options.observedAt || new Date().toISOString();
  const decisions = [];
  const plannedAppends = [];

  for (const partner of partners) {
    const partnerId = partner.partnerId || partner.advertiserId || null;
    const sectionId = partner.primarySectionId || partner.sectionId || null;
    if (!isPublicationApproved(partner) && options.requireApproval !== false) {
      decisions.push({
        partnerId,
        advertiserId: partner.advertiserId || null,
        decision: PLAN_DECISION.not_publication_approved,
        sectionId,
        publishable: false,
      });
      continue;
    }
    if (!sectionId) {
      decisions.push({
        partnerId,
        advertiserId: partner.advertiserId || null,
        decision: PLAN_DECISION.unmapped,
        sectionId: null,
        publishable: false,
        reason: "missing_section",
      });
      continue;
    }
    const urlCheck = verifyAffiliateUrl(partner.affiliateUrl, websitePid, { observedAt });
    if (!urlCheck.ok) {
      decisions.push({
        partnerId,
        advertiserId: partner.advertiserId || null,
        decision:
          urlCheck.reason === "missing_affiliate_url"
            ? PLAN_DECISION.missing_affiliate_url
            : PLAN_DECISION.invalid_affiliate_url,
        sectionId,
        publishable: false,
        reason: urlCheck.reason,
      });
      continue;
    }
    const fill = {
      partnerId,
      advertiserId: partner.advertiserId || null,
      displayName: partner.displayName || null,
      sectionId,
      slotIndex: null,
      slotSlug: null,
      unlimitedAppend: true,
      affiliateUrl: partner.affiliateUrl,
      affiliateUrlVerification: urlCheck,
      observedAt,
      phase: "3F",
      publicCatalogMutation: false,
      publishable: false,
      rel: "sponsored noopener",
      target: "_blank",
    };
    plannedAppends.push(fill);
    decisions.push({
      partnerId,
      advertiserId: partner.advertiserId || null,
      decision: PLAN_DECISION.unlimited_append,
      sectionId,
      publishable: false,
      reason: "dynamic_overlay_append_no_slot_limit",
    });
  }

  return {
    ok: true,
    phase: "3F",
    unlimited: true,
    freeEmptyGate: false,
    publishable: false,
    catalogMutated: false,
    plannedAppends,
    decisions,
    counts: {
      partners: partners.length,
      unlimited_append: plannedAppends.length,
      blocked: decisions.filter((d) => d.decision !== PLAN_DECISION.unlimited_append).length,
    },
    note: "Appends land via managed-public overlay; MANUAL_PROTECTED untouched; promote remains DISARMED by default.",
  };
}

/**
 * Phase B apply stub — fail-closed unless publicationApproved === true.
 * Still does not mutate catalog in this module (preparation only).
 */
export function applyPartnerSlotPlanPhaseB(plan, options = {}) {
  if (options.publicationApproved !== true) {
    return {
      ok: false,
      applied: false,
      blocked: true,
      reason: "publication_not_approved",
      catalogMutated: false,
      publishable: false,
    };
  }
  if (!plan || plan.phase !== "A" || !Array.isArray(plan.plannedFills)) {
    return { ok: false, applied: false, blocked: true, reason: "invalid_phase_a_plan", catalogMutated: false };
  }
  const inventory = options.inventory || buildCatalogSlotInventory({ catalogSrc: options.catalogSrc });
  for (const fill of plan.plannedFills) {
    const sec = inventory.sections.find((s) => s.sectionId === fill.sectionId);
    const slot = sec?.slots?.[fill.slotIndex];
    if (!slot || slot.slotKind !== SLOT_KIND.free_empty) {
      return {
        ok: false,
        applied: false,
        blocked: true,
        reason: "slot_no_longer_free",
        conflict: { sectionId: fill.sectionId, slotIndex: fill.slotIndex },
        catalogMutated: false,
      };
    }
    const urlCheck = verifyAffiliateUrl(fill.affiliateUrl, options.websitePid || "101883843");
    if (!urlCheck.ok) {
      return { ok: false, applied: false, blocked: true, reason: "affiliate_url_revalidation_failed", catalogMutated: false };
    }
  }
  // Intentional: even with approval flag, this task forbids public mutation.
  return {
    ok: false,
    applied: false,
    blocked: true,
    reason: "phase_B_catalog_mutation_disabled_in_this_task",
    catalogMutated: false,
    publishable: false,
    wouldApplyCount: plan.plannedFills.length,
  };
}

/** Offline batch: catalog normalize records → partner slot plan (Phase A). */
export function runOfflineBatchIngestWithSlotPlan(options = {}) {
  const normalizeResult = options.normalizeResult;
  const plan = planPartnerSlotAssignments(options);
  return {
    ok: true,
    phase: "A",
    publishable: false,
    catalogMutated: false,
    normalize: normalizeResult
      ? {
          ok: normalizeResult.ok,
          recordCount: (normalizeResult.records || []).length,
          publishable: false,
        }
      : null,
    slotPlan: {
      plannedFills: plan.plannedFills.length,
      counts: plan.counts,
      phaseBBlocked: plan.phaseB.blocked === true,
    },
    CJ_LIVE_HTTP_CALLS: 0,
  };
}
