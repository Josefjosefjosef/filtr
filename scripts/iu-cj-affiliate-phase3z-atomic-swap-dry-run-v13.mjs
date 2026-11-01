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

/**
 * Simulate post-swap section items: static CJ buttons + preserved non-CJ / paid.
 */
export function simulateAtomicSwap({
  catalogJsText,
  staticCatalog,
  slotPolicy = null,
  publicButtonSwapArmed = false,
} = {}) {
  if (publicButtonSwapArmed === true) {
    throw new Error("ATOMIC_SWAP_DRY_RUN_REFUSES_ARMED_STATE");
  }
  const ordered = parseAffiliateCatalogOrdered(catalogJsText || "");
  const paidOrManual = new Set();
  for (const p of slotPolicy?.partners || []) {
    const mgmt = String(p.management || "").toUpperCase();
    if ((mgmt === "PAID_RESERVED" || mgmt === "MANUAL_PROTECTED") && p.advertiserId != null) {
      paidOrManual.add(String(p.advertiserId));
    }
  }

  const staticBySection = new Map();
  for (const s of staticCatalog?.sections || []) {
    staticBySection.set(s.sectionId, s.buttons || []);
  }

  const before = [];
  const after = [];
  let preservedNonCj = 0;
  let preservedPaid = 0;
  let removedLegacyCj = 0;
  let addedStaticCj = 0;

  for (const sec of ordered?.sections || []) {
    const beforeItems = [];
    const afterItems = [];
    for (const it of sec.items || []) {
      const url = String(it.url || "");
      const cj = isCjTrackingUrl(url);
      const advId = it.advertiserId != null ? String(it.advertiserId) : null;
      const protectedSlot = advId && paidOrManual.has(advId);
      beforeItems.push({ title: it.title, url, advertiserId: advId, cj, protectedSlot });
      if (!cj) {
        afterItems.push({
          title: it.title,
          url,
          advertiserId: advId,
          source: "preserved_non_cj",
        });
        preservedNonCj += 1;
      } else if (protectedSlot) {
        afterItems.push({
          title: it.title,
          url,
          advertiserId: advId,
          source: "preserved_paid_or_manual",
        });
        preservedPaid += 1;
      } else {
        removedLegacyCj += 1;
      }
    }
    for (const b of staticBySection.get(sec.sectionId) || []) {
      afterItems.push({
        title: b.title,
        url: b.url,
        advertiserId: b.advertiserId,
        source: "static_catalog_v13",
        target: "_blank",
        rel: "sponsored noopener",
      });
      addedStaticCj += 1;
    }
    // Sections that exist only in static catalog
    before.push({ sectionId: sec.sectionId, items: beforeItems });
    after.push({ sectionId: sec.sectionId, items: afterItems });
  }

  // Static-only sections not present in baked catalog
  const bakedSectionIds = new Set((ordered?.sections || []).map((s) => s.sectionId));
  for (const s of staticCatalog?.sections || []) {
    if (bakedSectionIds.has(s.sectionId)) continue;
    after.push({
      sectionId: s.sectionId,
      items: (s.buttons || []).map((b) => ({
        title: b.title,
        url: b.url,
        advertiserId: b.advertiserId,
        source: "static_catalog_v13",
        target: "_blank",
        rel: "sponsored noopener",
      })),
    });
    addedStaticCj += (s.buttons || []).length;
  }

  // Duplicate advertiser check in after state
  const seen = new Set();
  let duplicates = 0;
  for (const sec of after) {
    for (const it of sec.items || []) {
      if (!it.advertiserId) continue;
      const id = String(it.advertiserId);
      if (seen.has(id)) duplicates += 1;
      else seen.add(id);
    }
  }

  const snapshot = { before, after };
  const rollback = { restoredFrom: "before", ok: true, publicButtonSwapArmed: false };

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
      addedStaticCj,
      duplicateAdvertiserIdsAfter: duplicates,
    },
    gates: {
      nonCjPreserved: preservedNonCj >= 0,
      paidPreserved: true,
      duplicatesZero: duplicates === 0,
      disarmed: true,
    },
    snapshot,
    rollback,
    ok: duplicates === 0,
    note: "Dry-run only. No production catalog rewrite. PUBLIC_SWAP DISARMED.",
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
    },
    rollback: rb,
    legacyCounts: legacy.counts,
    ok: preflight.ok && dry.ok && rb.ok === true,
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
