#!/usr/bin/env node
/**
 * Phase 3Z V12 — inventář CJ komponent (KEEP / MODIFY / MERGE / REMOVE).
 * Offline, deterministic. Does not delete files; documents decisions for audit.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PHASE3Z_V12_CLEANUP_INVENTORY = Object.freeze({
  schema: "iu-cj-affiliate-phase3z-v12-cleanup-inventory",
  publicButtonSwapArmed: false,
  singleActiveMainButtonPipeline: true,
  items: [
    {
      id: "phase3z-partner-registry-v1",
      path: "scripts/iu-cj-affiliate-phase3z-partner-registry-v1.mjs",
      decision: "MODIFY",
      role: "Canonical JOINED registry + button catalog builder",
      change: "Wire attachMainButtonReadiness (CJ-FIRST) after publication readiness",
      replacedBy: null,
      dependents: ["cj-affiliate-phase3z-partner-registry.yml", "cj-affiliate-catalog-sync.yml"],
      removalTest: null,
    },
    {
      id: "publication-readiness-v9",
      path: "scripts/iu-cj-affiliate-phase3z-publication-readiness-v9.mjs",
      decision: "KEEP",
      role: "Legacy PUBLICATION_READY (CONTENT_VERIFIED path) for coupons/products later",
      change: "Must not block MAIN_BUTTON_READY",
      replacedBy: "main-button-readiness-v12 for main buttons",
      dependents: ["partner-registry", "catalog-sync"],
      removalTest: null,
    },
    {
      id: "main-button-readiness-v12",
      path: "scripts/iu-cj-affiliate-phase3z-main-button-readiness-v12.mjs",
      decision: "KEEP",
      role: "Authoritative MAIN_BUTTON_READY gate (CJ-FIRST)",
      change: "New in V12",
      replacedBy: null,
      dependents: ["partner-registry", "attach-main-buttons", "selftest"],
      removalTest: null,
    },
    {
      id: "main-button-email-hints-v12",
      path: "scripts/iu-cj-affiliate-phase3z-main-button-email-hints-v12.mjs",
      decision: "KEEP",
      role: "Forpsi/email assortment + SEM/coupon restriction hints for main buttons",
      change: "Reuses identity pairing; fixtures GANT/Čedok",
      replacedBy: null,
      dependents: ["attach-main-buttons", "selftest"],
      removalTest: null,
    },
    {
      id: "phase3r-email-pipeline",
      path: "scripts/iu-cj-affiliate-phase3r-pipeline-v1.mjs",
      decision: "KEEP",
      role: "Existing Forpsi/AI email ingest → CJ reconcile (hints only)",
      change: "Not replaced; main-button hints consume structured events later",
      replacedBy: null,
      dependents: ["cj-affiliate-email-ingest.yml"],
      removalTest: null,
    },
    {
      id: "deep-content-review-v9",
      path: "scripts/iu-cj-affiliate-phase3z-deep-content-review-v9.mjs",
      decision: "MODIFY",
      role: "Merchant-web content probes",
      change: "Demoted: must not gate MAIN_BUTTON_READY; retained for future coupon/product phase",
      replacedBy: "CJ API + email for main-button classification",
      dependents: ["catalog-sync content steps"],
      removalTest: "main-button-readiness-v12-selftest scenarios 04-09",
    },
    {
      id: "merchant-evidence-v9",
      path: "scripts/iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs",
      decision: "MODIFY",
      role: "Destination typing + curated merchant overrides",
      change: "Allegro → aff-inzerce-bazary (CJ-FIRST); EXTERNAL_TRACKER policy softened at MAIN_BUTTON layer",
      replacedBy: null,
      dependents: ["partner-registry", "selftests"],
      removalTest: "v12_allegro_marketplace_inzerce_bazary",
    },
    {
      id: "assortment-v8",
      path: "scripts/iu-cj-affiliate-phase3z-assortment-v8.mjs",
      decision: "KEEP",
      role: "Assortment profile + section pick helpers",
      change: "Still used for registry build; MAIN_BUTTON may override section via CJ-FIRST map",
      replacedBy: null,
      dependents: ["partner-registry"],
      removalTest: null,
    },
    {
      id: "section-map-phase3e",
      path: "scripts/iu-cj-affiliate-phase3e-partner-recon-v1.mjs",
      decision: "MERGE",
      role: "CJ category → section evidence map",
      change: "Remains single category map source inside partner-registry CJ_CATEGORY_SECTION_EVIDENCE",
      replacedBy: "Unified map in partner-registry + CJ_FIRST_SECTION_OVERRIDES",
      dependents: ["partner-registry"],
      removalTest: null,
    },
    {
      id: "catalog-sync-publish-gate",
      path: "scripts/iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs",
      decision: "KEEP",
      role: "Publish gate + isCjTrackingUrl + DISARMED enforcement",
      change: "Must keep publicButtonSwapArmed false",
      replacedBy: null,
      dependents: ["catalog-sync.yml"],
      removalTest: "ops-guards + publish-gate selftests",
    },
    {
      id: "phase3f-dynamic-catalog",
      path: "scripts/iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs",
      decision: "KEEP",
      role: "Policy management classification (CJ_MANAGED / PAID / MANUAL)",
      change: "Historical dynamic chips; swap still DISARMED",
      replacedBy: null,
      dependents: ["partner-registry"],
      removalTest: null,
    },
    {
      id: "baked-catalog-js",
      path: "assets/iu-affiliate-catalog.js",
      decision: "KEEP",
      role: "Production baked partner chips (public until GO)",
      change: "No public swap in V12; migration prep only via registry MAIN_BUTTON_READY",
      replacedBy: "Future armed swap from CJ registry",
      dependents: ["Pages production"],
      removalTest: "DISARMED gate + ads freeze",
    },
    {
      id: "partner-chips-css",
      path: "assets/iu-affiliate-phase3z-partner-chips-v1.css",
      decision: "KEEP",
      role: "Main button chip styling (Rádia-compact)",
      change: "No redesign in V12",
      replacedBy: null,
      dependents: ["UI preview"],
      removalTest: null,
    },
    {
      id: "lkg-ops-guards-v9",
      path: "scripts/iu-cj-affiliate-phase3z-ops-guards-v9-selftest.mjs",
      decision: "KEEP",
      role: "LKG / circuit breaker / DISARMED publish gate tests",
      change: "Retained; ENDED must not LKG-activate unauthorized buttons",
      replacedBy: null,
      dependents: ["catalog-sync.yml"],
      removalTest: "ops-guards-v9-selftest",
    },
    {
      id: "parallel-cj-robot",
      path: "(none — must not exist)",
      decision: "REMOVE",
      role: "Any second active CJ main-button pipeline",
      change: "Forbidden; single pipeline via partner-registry + main-button-readiness-v12",
      replacedBy: "phase3z-partner-registry-v1 + main-button-readiness-v12",
      dependents: [],
      removalTest: "singleActiveMainButtonPipeline assertion in inventory + selftest",
      removalProof: {
        purposeWas: "Would duplicate JOINED→button authority",
        replacedWith: "Single attachMainButtonReadiness attach point",
        dependentsChecked: ["scripts/*phase3z*", ".github/workflows/cj-affiliate-*.yml"],
        safetyTest: "iu-cj-affiliate-phase3z-main-button-readiness-v12-selftest",
      },
    },
  ],
});

export function summarizeCleanupInventory(inv = PHASE3Z_V12_CLEANUP_INVENTORY) {
  const counts = { KEEP: 0, MODIFY: 0, MERGE: 0, REMOVE: 0 };
  for (const it of inv.items || []) {
    counts[it.decision] = (counts[it.decision] || 0) + 1;
  }
  return {
    schema: inv.schema,
    counts,
    publicButtonSwapArmed: false,
    singleActiveMainButtonPipeline: inv.singleActiveMainButtonPipeline === true,
    items: inv.items,
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  console.log(JSON.stringify(summarizeCleanupInventory(), null, 2));
}
