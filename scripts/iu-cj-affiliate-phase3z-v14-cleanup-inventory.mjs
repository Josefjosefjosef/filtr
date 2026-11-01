#!/usr/bin/env node
/**
 * Phase 3Z V14 — cleanup classification for historical CJ paths.
 * Decisions: REMOVED_NOW | PRESERVED_FOR_ROLLBACK | DEACTIVATE_ON_APPROVED_SWAP | ACTIVE_REQUIRED
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PHASE3Z_V14_CLEANUP_INVENTORY = Object.freeze({
  schema: "iu-cj-affiliate-phase3z-v14-cleanup-inventory",
  publicButtonSwapArmed: false,
  singlePostSwapCjRenderer: true,
  items: [
    {
      id: "static-main-catalog-v13",
      path: "projects/data/iu-affiliate-cj-main-buttons-static-v13.json",
      decision: "ACTIVE_REQUIRED",
      role: "Authoritative pre-generated CJ main-button catalog",
    },
    {
      id: "static-catalog-generator-v13",
      path: "scripts/iu-cj-affiliate-phase3z-static-main-catalog-v13.mjs",
      decision: "ACTIVE_REQUIRED",
      role: "Deterministic catalog materializer from registry",
    },
    {
      id: "partner-registry-v1",
      path: "projects/data/iu-affiliate-cj-partner-registry-v1.json",
      decision: "ACTIVE_REQUIRED",
      role: "JOINED registry + readiness",
    },
    {
      id: "baked-catalog-js",
      path: "assets/iu-affiliate-catalog.js",
      decision: "DEACTIVATE_ON_APPROVED_SWAP",
      role: "Current public CJ chip source (baked IU_AFFILIATE_CATALOG)",
      swapAction:
        "Stop using baked CJ items as main-button source; keep file for non-CJ/nav/shell until migrated",
    },
    {
      id: "managed-public-overlay",
      path: "projects/data/iu-affiliate-cj-managed-public-v1.json",
      decision: "DEACTIVATE_ON_APPROVED_SWAP",
      role: "Dynamic managed CJ overlay on baked chips",
      swapAction:
        "Disable applyManagedPublicOverlay for main buttons; coupons/products remain deferred",
    },
    {
      id: "slot-policy",
      path: "projects/data/iu-affiliate-slot-policy-v1.json",
      decision: "ACTIVE_REQUIRED",
      role: "MANUAL_PROTECTED / PAID_RESERVED policy for preservation",
    },
    {
      id: "phase3z-partner-chips-css",
      path: "assets/iu-affiliate-phase3z-partner-chips-v1.css",
      decision: "ACTIVE_REQUIRED",
      role: "Compact chip geometry (Radio dimensions, section colors)",
    },
    {
      id: "ads-public",
      path: "assets/iu-ads-public-v1.js",
      decision: "ACTIVE_REQUIRED",
      role: "Paid ad slots — must never be swapped/removed by CJ catalog cutover",
    },
    {
      id: "atomic-swap-dry-run",
      path: "scripts/iu-cj-affiliate-phase3z-atomic-swap-dry-run-v13.mjs",
      decision: "PRESERVED_FOR_ROLLBACK",
      role: "Dry-run + rollback simulator; never arms production",
    },
    {
      id: "legacy-buttons-inventory",
      path: "scripts/iu-cj-affiliate-phase3z-legacy-buttons-inventory-v13.mjs",
      decision: "PRESERVED_FOR_ROLLBACK",
      role: "Inventory of baked/managed CJ for swap mapping",
    },
    {
      id: "offers-phase2",
      path: "assets/iu-affiliate-phase2-offers-v1.js",
      decision: "ACTIVE_REQUIRED",
      role: "Coupons/products deferred; keep liveEnabled gate false by default",
    },
    {
      id: "duplicate-category-maps",
      path: "scripts/iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs",
      decision: "ACTIVE_REQUIRED",
      role: "CJ-FIRST destination typing; not a parallel renderer",
    },
    {
      id: "catalog-sync-workflow",
      path: ".github/workflows/cj-affiliate-catalog-sync.yml",
      decision: "ACTIVE_REQUIRED",
      role: "Scheduled background catalog refresh; must respect DISARMED",
    },
    {
      id: "v14-positive-preservation",
      path: "scripts/iu-cj-affiliate-phase3z-v14-positive-preservation.mjs",
      decision: "ACTIVE_REQUIRED",
      role: "Positive non-CJ + paid preservation proofs",
    },
    {
      id: "v14-dom-inventory",
      path: "scripts/iu-cj-affiliate-phase3z-v14-dom-inventory.mjs",
      decision: "ACTIVE_REQUIRED",
      role: "Full DOM inventory + preview for all static buttons",
    },
  ],
  deactivateOnApprovedSwap: [
    "baked CJ items as sole main-button source in iu-affiliate-catalog.js",
    "managed-public overlay as competing main-button renderer",
  ],
  remainActiveAfterSwap: [
    "static catalog JSON + generator",
    "slot-policy MANUAL_PROTECTED / PAID_RESERVED",
    "iu-ads-public paid slots",
    "non-CJ preserved chips",
    "phase3z compact chip CSS",
    "nav/shell of affiliate sections",
  ],
});

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  console.log(JSON.stringify(PHASE3Z_V14_CLEANUP_INVENTORY, null, 2));
}
