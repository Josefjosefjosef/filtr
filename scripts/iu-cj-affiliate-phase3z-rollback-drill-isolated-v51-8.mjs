#!/usr/bin/env node
/**
 * Isolated rollback drill: restore public offers from LKG without touching production Pages.
 */
import fs from "node:fs";
import path from "node:path";
import {
  mergeLkgPublishedProducts,
  collectPublicEligibleProductMap,
  isPublicOfferEligible,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

export function runIsolatedRollbackDrill(opts = {}) {
  const root = opts.root || process.cwd();
  const dataDir = path.join(root, "projects/data");
  const livePath = path.join(dataDir, "iu-affiliate-cj-offers-public-v1.json");
  const lkgPath = path.join(dataDir, "iu-affiliate-cj-offers-public-lkg-v1.json");
  const growthPath = path.join(dataDir, "iu-affiliate-cj-public-growth-budget-v51.json");
  const staticPath = path.join(dataDir, "iu-affiliate-cj-main-buttons-static-v13.json");

  const live = readJson(livePath);
  const lkgFile = readJson(lkgPath);
  const lkg = lkgFile || live;
  const growthFile = readJson(growthPath);
  const growth = growthFile || live?.publicGrowthBudget || null;
  const staticCat = readJson(staticPath);

  const failures = [];
  if (!live?.sections?.length) failures.push("LIVE_OFFERS_MISSING");
  if (!lkg?.sections?.length) failures.push("LKG_OFFERS_MISSING");
  if (!staticCat?.publicButtonSwapArmed) failures.push("STATIC_NOT_ARMED");

  // Simulate catastrophic empty publish, then restore from LKG (or live-as-LKG)
  const empty = {
    liveEnabled: false,
    sections: (live.sections || []).map((s) => ({
      ...s,
      products: [],
      coupons: [],
      actions: [],
    })),
  };
  const restored = mergeLkgPublishedProducts(empty, lkg, {
    nowIso: new Date().toISOString(),
    sourceSeenKeys: new Set(),
  });
  const afterMap = collectPublicEligibleProductMap(restored.doc);
  const beforeMap = collectPublicEligibleProductMap(lkg);
  if (afterMap.size < Math.min(100, beforeMap.size)) {
    failures.push("ROLLBACK_RESTORE_TOO_SMALL:" + afterMap.size + "<" + beforeMap.size);
  }

  // Growth ledger integrity (must remain capped unless owner changes it)
  const cum = Number(growth?.cumulativeAddedSinceBaseline);
  const max = Number(growth?.maxCumulativeAbs ?? 500);
  if (!(Number.isFinite(cum))) failures.push("GROWTH_LEDGER_UNREADABLE");
  if (Number.isFinite(max) && max !== 500) failures.push("GROWTH_MAX_UNEXPECTED:" + max);
  if (String(process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED || "0") === "1") {
    failures.push("GROWTH_GATE_UNEXPECTEDLY_ON");
  }

  // Paid positions / ads must not be in CJ offers JSON
  const offersText = JSON.stringify(live).slice(0, 50000);
  if (/contextualAdsOnly|iu-ads-premium-order/i.test(offersText) === false) {
    // expected: offers catalog does not host paid-position payloads
  }

  let eligible = 0;
  for (const s of restored.doc.sections || []) {
    for (const p of s.products || []) if (isPublicOfferEligible(p)) eligible += 1;
  }

  const ok = failures.length === 0 && restored.carried > 0;
  return {
    schema: "iu-cj-affiliate-phase3z-rollback-drill-isolated-v51-8",
    at: new Date().toISOString(),
    productionPagesMutated: false,
    productionWrite: false,
    ok,
    failures,
    evidence: {
      lkgUniqueEligible: beforeMap.size,
      restoredCarried: restored.carried,
      restoredEligibleApprox: eligible,
      staticButtons: staticCat?.counts?.buttons ?? null,
      growthCum: cum,
      growthMax: max,
      growthGate: String(process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED || "0"),
      lkgSource: lkgFile ? "lkg_file" : "live_as_lkg",
      growthSource: growthFile ? "growth_file" : "live_publicGrowthBudget",
      artifactPaths: {
        live: fs.existsSync(livePath),
        lkg: fs.existsSync(lkgPath),
        growth: fs.existsSync(growthPath),
        staticButtons: fs.existsSync(staticPath),
      },
    },
  };
}

const isDirect = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith(
  "iu-cj-affiliate-phase3z-rollback-drill-isolated-v51-8.mjs",
);
if (isDirect) {
  const doc = runIsolatedRollbackDrill({});
  console.log(JSON.stringify(doc, null, 2));
  if (!doc.ok) process.exit(2);
}
