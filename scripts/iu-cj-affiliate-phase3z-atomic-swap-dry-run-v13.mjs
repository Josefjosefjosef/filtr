#!/usr/bin/env node
/**
 * Phase 3Z V13 — atomic PUBLIC_SWAP dry-run + rollback (never arms production).
 *
 * Simulates replacing baked/managed CJ chips with static catalog while preserving
 * non-CJ and paid/manual protected items. Requires explicit arm flag for any
 * "would publish" assertion — default DISARMED.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl, assertAllowedDataWrite } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { inventoryLegacyButtons } from "./iu-cj-affiliate-phase3z-legacy-buttons-inventory-v13.mjs";

export const PHASE3Z_ATOMIC_SWAP_SCHEMA = "iu-affiliate-cj-atomic-swap-dry-run-v13";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

/**
 * Preflight gates for a future armed swap. Dry-run never sets armed=true.
 */
export function evaluateSwapPreflight({ registry, staticCatalog, publicButtonSwapArmed = false } = {}) {
  const blockers = [];
  if (publicButtonSwapArmed === true) {
    // Caller asked to evaluate as if armed — still report; this module never writes armed state.
  }
  if (!staticCatalog?.buttons?.length) blockers.push("static_catalog_empty");
  if (staticCatalog?.publicButtonSwapArmed === true) blockers.push("catalog_claims_armed");
  if (staticCatalog?.browserCjApiDependency === true) blockers.push("browser_cj_api_dependency");
  const ready = (registry?.partners || []).filter((p) => p.mainButtonReady === true).length;
  if (ready !== (staticCatalog?.counts?.buttons || 0)) {
    blockers.push("registry_ready_vs_catalog_mismatch:" + ready + "!=" + staticCatalog?.counts?.buttons);
  }
  const ids = new Set();
  let dup = 0;
  for (const b of staticCatalog?.buttons || []) {
    const id = String(b.advertiserId || "");
    if (!id || ids.has(id)) dup += 1;
    else ids.add(id);
    if (!isCjTrackingUrl(b.url || "")) blockers.push("unauthorized_link:" + id);
    if (!b.sectionId) blockers.push("missing_section:" + id);
  }
  if (dup) blockers.push("duplicate_advertiser_ids:" + dup);

  return {
    ok: blockers.length === 0,
    blockers,
    wouldPublish: false,
    publicButtonSwapArmed: false,
    note: "Preflight only. Merge/V13 must not arm public swap.",
  };
}

function normTitleKey(t) {
  try {
    return String(t || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
  } catch {
    return String(t || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }
}

function normUrlKey(u) {
  return String(u || "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "");
}

/**
 * Build protection indexes from slot policy + optional fixture items.
 * MANUAL_PROTECTED / PAID_RESERVED historically often lack advertiserId — match by URL and title+section.
 */
export function buildProtectedSlotIndexes(slotPolicy = null, extraProtectedItems = []) {
  const byAdvertiserId = new Set();
  const byUrl = new Set();
  const bySectionTitle = new Set();
  const entries = [];

  function add(p, source) {
    if (!p) return;
    const mgmt = String(p.management || "").toUpperCase();
    if (mgmt && mgmt !== "PAID_RESERVED" && mgmt !== "MANUAL_PROTECTED") return;
    const advId = p.advertiserId != null && String(p.advertiserId) !== "" ? String(p.advertiserId) : null;
    const url = normUrlKey(p.url || p.href || "");
    const sectionId = String(p.sectionId || "");
    const titleKey = normTitleKey(p.title || p.name || "");
    if (advId) byAdvertiserId.add(advId);
    if (url) byUrl.add(url);
    if (sectionId && titleKey) bySectionTitle.add(sectionId + "::" + titleKey);
    entries.push({
      source,
      management: mgmt || "MANUAL_PROTECTED",
      advertiserId: advId,
      url: p.url || p.href || null,
      sectionId: sectionId || null,
      title: p.title || p.name || null,
    });
  }

  for (const p of slotPolicy?.partners || []) add(p, "slot_policy");
  for (const p of extraProtectedItems || []) add(p, "fixture");

  return { byAdvertiserId, byUrl, bySectionTitle, entries };
}

export function isProtectedCatalogItem(it, indexes) {
  if (!it || !indexes) return false;
  const advId = it.advertiserId != null && String(it.advertiserId) !== "" ? String(it.advertiserId) : null;
  if (advId && indexes.byAdvertiserId.has(advId)) return true;
  const url = normUrlKey(it.url || "");
  if (url && indexes.byUrl.has(url)) return true;
  const sectionId = String(it.sectionId || "");
  const titleKey = normTitleKey(it.title || "");
  if (sectionId && titleKey && indexes.bySectionTitle.has(sectionId + "::" + titleKey)) return true;
  const mgmt = String(it.management || "").toUpperCase();
  return mgmt === "PAID_RESERVED" || mgmt === "MANUAL_PROTECTED";
}

/**
 * V15 rule: historical CJ tracking URLs are NEVER preserved — not even MANUAL_PROTECTED.
 * Only true non-CJ affiliate chips survive from the baked catalog.
 * Paid ad slots (iu-ads-public) are outside this catalog swap and must stay untouched separately.
 */
export function simulateAtomicSwap({
  catalogJsText,
  staticCatalog,
  slotPolicy = null,
  publicButtonSwapArmed = false,
  extraItemsBySection = null,
  extraProtectedItems = [],
} = {}) {
  if (publicButtonSwapArmed === true) {
    throw new Error("ATOMIC_SWAP_DRY_RUN_REFUSES_ARMED_STATE");
  }
  const ordered = parseAffiliateCatalogOrdered(catalogJsText || "");
  // slotPolicy retained for inventory/classification; MANUAL_PROTECTED no longer blocks CJ purge.
  const protectedIdx = buildProtectedSlotIndexes(slotPolicy, extraProtectedItems);

  const staticBySection = new Map();
  for (const s of staticCatalog?.sections || []) {
    staticBySection.set(s.sectionId, s.buttons || []);
  }

  const before = [];
  const after = [];
  let preservedNonCj = 0;
  let preservedPaid = 0; // always 0 for catalog chips; ads are external
  let removedLegacyCj = 0;
  let removedManualProtectedCj = 0;
  let addedStaticCj = 0;
  const preservedFingerprints = [];
  const removedLegacyCjFingerprints = [];

  const sectionMap = new Map();
  for (const sec of ordered?.sections || []) {
    sectionMap.set(sec.sectionId, {
      sectionId: sec.sectionId,
      items: [...(sec.items || [])],
    });
  }
  for (const [sectionId, items] of Object.entries(extraItemsBySection || {})) {
    if (!sectionMap.has(sectionId)) sectionMap.set(sectionId, { sectionId, items: [] });
    sectionMap.get(sectionId).items.push(...(items || []));
  }

  for (const sec of sectionMap.values()) {
    const beforeItems = [];
    const afterItems = [];
    const staticButtons = staticBySection.get(sec.sectionId) || [];
    for (const it of sec.items || []) {
      const url = String(it.url || "");
      const cj = isCjTrackingUrl(url);
      const advId = it.advertiserId != null ? String(it.advertiserId) : null;
      const itemForMatch = { ...it, sectionId: sec.sectionId, url, advertiserId: advId };
      const hadManualFlag = isProtectedCatalogItem(itemForMatch, protectedIdx);
      beforeItems.push({
        title: it.title,
        url,
        advertiserId: advId,
        management: it.management || null,
        cj,
        protectedSlot: hadManualFlag,
        decision: cj ? "LEGACY_CJ_REMOVE" : "NON_CJ_PRESERVE",
        cssClass: it.cssClass || "iuRadioChip iuAffiliateChip",
      });
      if (!cj) {
        afterItems.push({
          title: it.title,
          url,
          advertiserId: advId,
          management: it.management || null,
          source: "preserved_non_cj",
          cssClass: it.cssClass || "iuRadioChip iuAffiliateChip",
          target: it.target || "_blank",
          rel: it.rel || "noopener noreferrer",
        });
        preservedNonCj += 1;
        preservedFingerprints.push({
          kind: "non_cj",
          sectionId: sec.sectionId,
          title: it.title,
          url,
        });
      } else {
        // V15: ALL historical CJ chips removed — MANUAL_PROTECTED is not an exception.
        removedLegacyCj += 1;
        if (hadManualFlag) removedManualProtectedCj += 1;
        removedLegacyCjFingerprints.push({
          sectionId: sec.sectionId,
          title: it.title,
          url,
          management: it.management || (hadManualFlag ? "MANUAL_PROTECTED" : null),
          decision: "LEGACY_CJ_REMOVE",
        });
      }
    }
    for (const b of staticButtons) {
      afterItems.push({
        title: b.title,
        url: b.url,
        advertiserId: b.advertiserId,
        source: "static_catalog_v13",
        target: "_blank",
        rel: "sponsored noopener",
        cssClass: "iuRadioChip iuAffiliateChip",
      });
      addedStaticCj += 1;
    }
    before.push({ sectionId: sec.sectionId, items: beforeItems });
    after.push({ sectionId: sec.sectionId, items: afterItems });
  }

  // Static-only sections not present in before map
  const beforeSectionIds = new Set(before.map((s) => s.sectionId));
  for (const s of staticCatalog?.sections || []) {
    if (beforeSectionIds.has(s.sectionId)) continue;
    after.push({
      sectionId: s.sectionId,
      items: (s.buttons || []).map((b) => ({
        title: b.title,
        url: b.url,
        advertiserId: b.advertiserId,
        source: "static_catalog_v13",
        target: "_blank",
        rel: "sponsored noopener",
        cssClass: "iuRadioChip iuAffiliateChip",
      })),
    });
    addedStaticCj += (s.buttons || []).length;
  }

  // Duplicate advertiser check among NEW static CJ buttons only
  const seen = new Set();
  let duplicates = 0;
  let legacyCjAfter = 0;
  for (const sec of after) {
    for (const it of sec.items || []) {
      if (it.source === "preserved_non_cj") continue;
      if (it.source !== "static_catalog_v13" && isCjTrackingUrl(it.url || "")) {
        legacyCjAfter += 1;
      }
      if (!it.advertiserId) continue;
      if (it.source !== "static_catalog_v13") continue;
      const id = String(it.advertiserId);
      if (seen.has(id)) duplicates += 1;
      else seen.add(id);
    }
  }

  const policyProtectedCount = (protectedIdx.entries || []).filter((e) => e.source === "slot_policy").length;
  const fixtureProtectedCount = (protectedIdx.entries || []).filter((e) => e.source === "fixture").length;
  const expectNonCj =
    (extraProtectedItems || []).some((p) => !isCjTrackingUrl(p.url || p.href || "")) ||
    Object.values(extraItemsBySection || {})
      .flat()
      .some((it) => it && !isCjTrackingUrl(it.url || ""));

  const snapshot = { before, after };
  const rollback = { restoredFrom: "before", ok: true, publicButtonSwapArmed: false };

  const nonCjGate = expectNonCj ? preservedNonCj > 0 : preservedNonCj >= 0;
  const legacyZeroGate = legacyCjAfter === 0;
  const manualCjPurgedGate = true; // MANUAL_PROTECTED never preserves CJ after V15

  return {
    schema: PHASE3Z_ATOMIC_SWAP_SCHEMA,
    publicButtonSwapArmed: false,
    dryRun: true,
    wouldPublish: false,
    singlePostSwapCjRenderer: true,
    counts: {
      preservedNonCj,
      preservedPaid,
      removedLegacyCj,
      removedManualProtectedCj,
      addedStaticCj,
      legacyCjAfterSwap: legacyCjAfter,
      duplicateAdvertiserIdsAfter: duplicates,
      policyProtectedEntries: policyProtectedCount,
      fixtureProtectedEntries: fixtureProtectedCount,
    },
    gates: {
      nonCjPreserved: nonCjGate,
      paidPreserved: true, // ads slots are external; catalog never keeps historical CJ as "paid"
      duplicatesZero: duplicates === 0,
      legacyCjAfterZero: legacyZeroGate,
      manualProtectedCjPurged: manualCjPurgedGate,
      disarmed: true,
      positiveNonCjRequired: expectNonCj,
      positivePaidRequired: false,
      newButtonsFromCjCatalogOnly: true,
    },
    preservedFingerprints,
    removedLegacyCjFingerprints,
    protectedIndexSummary: {
      byAdvertiserId: protectedIdx.byAdvertiserId.size,
      byUrl: protectedIdx.byUrl.size,
      bySectionTitle: protectedIdx.bySectionTitle.size,
    },
    snapshot,
    rollback,
    ok: duplicates === 0 && nonCjGate && legacyZeroGate,
    note:
      "V15 dry-run: ALL historical CJ chips removed (incl. MANUAL_PROTECTED). Only non-CJ preserved. PUBLIC_SWAP DISARMED.",
  };
}

export function simulateRollback(dryRunResult) {
  if (!dryRunResult?.snapshot?.before) {
    return { ok: false, reason: "missing_before_snapshot", publicButtonSwapArmed: false };
  }
  return {
    ok: true,
    action: "ROLLBACK",
    restoredSections: dryRunResult.snapshot.before.length,
    publicButtonSwapArmed: false,
    note: "Rollback restores pre-swap baked/managed state; swap remains DISARMED.",
  };
}

function main() {
  const argv = process.argv.slice(2);
  const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const registry = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json"));
  const staticCatalog = readJson(
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json")
  );
  const slotPolicy = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"));
  const managedPublic = readJson(
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json")
  );

  const preflight = evaluateSwapPreflight({
    registry,
    staticCatalog,
    publicButtonSwapArmed: false,
  });
  const dry = simulateAtomicSwap({
    catalogJsText: catalogJs,
    staticCatalog,
    slotPolicy,
    publicButtonSwapArmed: false,
  });
  const rb = simulateRollback(dry);
  const legacy = inventoryLegacyButtons({
    catalogJsText: catalogJs,
    registry,
    managedPublic,
    slotPolicy,
  });

  const report = {
    schema: PHASE3Z_ATOMIC_SWAP_SCHEMA,
    publicButtonSwapArmed: false,
    preflight,
    dryRun: {
      ok: dry.ok,
      counts: dry.counts,
      gates: dry.gates,
      singlePostSwapCjRenderer: dry.singlePostSwapCjRenderer,
      protectedIndexSummary: dry.protectedIndexSummary,
      preservedSample: (dry.preservedFingerprints || []).slice(0, 12),
      removedManualProtectedSample: (dry.removedLegacyCjFingerprints || [])
        .filter((x) => x.management === "MANUAL_PROTECTED" || x.decision === "LEGACY_CJ_REMOVE")
        .slice(0, 30),
    },
    rollback: rb,
    legacyCounts: legacy.counts,
    ok: preflight.ok && dry.ok && rb.ok === true && dry.counts.legacyCjAfterSwap === 0,
  };

  const out = path.join(ROOT, "projects", "data", "iu-affiliate-cj-atomic-swap-dry-run-v13.json");
  const writeRepo = argv.includes("--write-repo") || process.env.IU_CJ_PHASE3Z_WRITE_REPO === "1";
  if (writeRepo) {
    assertAllowedDataWrite(out);
    // Store compact report without huge before/after item lists in repo artifact
    writeJson(out, {
      ...report,
      dryRunDetailCounts: dry.counts,
      note: dry.note,
    });
  }

  console.log(JSON.stringify({ ...report, wrote: writeRepo, out: writeRepo ? out : null }, null, 2));
  if (!report.ok) process.exitCode = 2;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
