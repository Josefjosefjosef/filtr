/**
 * V51.8 — uncapped public growth readiness (code path only).
 * Default production remains capped 500/500 + owner gate until explicit owner activation.
 * This module never arms LIVE uncapped growth by itself.
 */
import fs from "node:fs";
import path from "node:path";
import {
  applyPublicGrowthBudget,
  computePublicGrowthBudget,
  evaluateIdentityChurnGate,
  evaluateProductShrinkageGate,
  mergeLkgPublishedProducts,
  compoundProductKey,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

export const UNCAPPED_GROWTH_READINESS_SCHEMA =
  "iu-cj-affiliate-phase3z-uncapped-growth-readiness-v51-8";

function makeProduct(advertiserId, productId, opts = {}) {
  return {
    advertiserId: String(advertiserId),
    productId: String(productId),
    title: opts.title || `P-${productId}`,
    imageUrl: opts.imageUrl || "https://example.com/p.jpg",
    currentPrice: opts.currentPrice != null ? opts.currentPrice : 99,
    currency: opts.currency || "CZK",
    affiliateUrl:
      opts.affiliateUrl ||
      `https://www.kqzyfj.com/click-101883843-${advertiserId}-${productId}`,
    publicationReady: opts.publicationReady !== false,
    availability: opts.availability || "IN_STOCK",
  };
}

function makeDoc(products, liveEnabled = true) {
  return {
    liveEnabled,
    sections: [
      {
        sectionKey: "aff-elektro",
        advertiserId: "1",
        partnerName: "A",
        coupons: [],
        actions: [],
        products,
      },
    ],
  };
}

/**
 * Synthetic volume scenarios — never publish; offline only.
 */
export function runUncappedGrowthVolumeScenarios() {
  const prevN = 200;
  const prev = makeDoc(
    Array.from({ length: prevN }, (_, i) => makeProduct(1, `live-${i}`)),
    true,
  );
  const results = [];

  function scenario(name, nextExtra, opts = {}) {
    const nextProducts = [
      ...Array.from({ length: prevN }, (_, i) => makeProduct(1, `live-${i}`)),
      ...nextExtra,
    ];
    const next = makeDoc(nextProducts, false);
    const applied = applyPublicGrowthBudget(next, prev, {
      uncappedMode: opts.uncappedMode === true,
      maxGrowthAbs: opts.maxGrowthAbs ?? 500,
      maxGrowthRatio: opts.maxGrowthRatio ?? 0.2,
      surgeRatio: opts.surgeRatio ?? 0.5,
      cumulativeAddedSinceBaseline: opts.cumulativeAddedSinceBaseline ?? 0,
      maxCumulativeAbs: opts.maxCumulativeAbs ?? 500,
    });
    results.push({
      name,
      uncappedMode: opts.uncappedMode === true,
      newCandidates: nextExtra.length,
      keptNew: applied.keptNew.length,
      deferredNew: applied.deferredNew.length,
      allowedNew: applied.budget.allowedNew,
      surgePause: applied.budget.surgePause === true,
      publicEligibleAfter: applied.publicEligibleAfter,
      ok: opts.expectOk(applied),
    });
  }

  scenario(
    "capped_100_new_budget_exhausted",
    Array.from({ length: 100 }, (_, i) => makeProduct(2, `n100-${i}`)),
    {
      uncappedMode: false,
      cumulativeAddedSinceBaseline: 500,
      expectOk: (a) => a.keptNew.length === 0 && a.deferredNew.length === 100,
    },
  );
  scenario(
    "uncapped_100_ratio_bounded",
    Array.from({ length: 100 }, (_, i) => makeProduct(2, `u100-${i}`)),
    {
      uncappedMode: true,
      expectOk: (a) => a.keptNew.length === 40 && a.deferredNew.length === 60, // 20% of 200
    },
  );
  scenario(
    "uncapped_1000_surge_drip",
    Array.from({ length: 1000 }, (_, i) => makeProduct(2, `u1k-${i}`)),
    {
      uncappedMode: true,
      expectOk: (a) =>
        a.budget.surgePause === true &&
        a.keptNew.length === 40 &&
        a.deferredNew.length === 960,
    },
  );
  scenario(
    "uncapped_10000_surge_drip",
    Array.from({ length: 10000 }, (_, i) => makeProduct(2, `u10k-${i}`)),
    {
      uncappedMode: true,
      expectOk: (a) =>
        a.budget.surgePause === true &&
        a.keptNew.length === 40 &&
        a.deferredNew.length === 9960,
    },
  );
  // Second run after first drip: remaining backlog continues (checkpoint continuity).
  {
    const afterFirst = applyPublicGrowthBudget(
      makeDoc([
        ...Array.from({ length: prevN }, (_, i) => makeProduct(1, `live-${i}`)),
        ...Array.from({ length: 1000 }, (_, i) => makeProduct(2, `ckpt-${i}`)),
      ]),
      prev,
      { uncappedMode: true },
    );
    const afterSecond = applyPublicGrowthBudget(
      makeDoc([
        ...Array.from({ length: prevN }, (_, i) => makeProduct(1, `live-${i}`)),
        ...Array.from({ length: 1000 }, (_, i) => makeProduct(2, `ckpt-${i}`)),
      ]),
      afterFirst.doc,
      { uncappedMode: true },
    );
    const expectedSecond = Math.floor((prevN + afterFirst.keptNew.length) * 0.2 + 1e-9);
    results.push({
      name: "uncapped_checkpoint_continuation_drip",
      uncappedMode: true,
      newCandidates: 1000,
      keptNew: afterSecond.keptNew.length,
      deferredNew: afterSecond.deferredNew.length,
      allowedNew: afterSecond.budget.allowedNew,
      surgePause: afterSecond.budget.surgePause === true,
      publicEligibleAfter: afterSecond.publicEligibleAfter,
      ok:
        afterFirst.keptNew.length === 40 &&
        afterSecond.keptNew.length === expectedSecond &&
        afterSecond.publicEligibleAfter === prevN + 40 + expectedSecond &&
        afterSecond.deferredNew.length === 1000 - 40 - expectedSecond,
    });
  }
  scenario(
    "duplicates_collapsed",
    [
      makeProduct(2, "dup"),
      makeProduct(2, "dup"),
      makeProduct(2, "dup"),
    ],
    {
      uncappedMode: true,
      expectOk: (a) => a.keptNew.length === 1,
    },
  );
  scenario(
    "invalid_price_excluded",
    [makeProduct(2, "badprice", { currentPrice: 0 })],
    {
      uncappedMode: true,
      expectOk: (a) => a.keptNew.length === 0 && a.deferredNew.length === 0,
    },
  );
  scenario(
    "identity_collision_different_advertisers_ok",
    [makeProduct(9, "live-0")], // same productId, different advertiser
    {
      uncappedMode: true,
      expectOk: (a) => {
        const key = compoundProductKey(9, "live-0");
        return a.keptNew.includes(key);
      },
    },
  );

  // Shrinkage / LKG still refuse unauthorized mass drop even with uncapped growth opts.
  const shrunk = makeDoc([makeProduct(1, "live-0")], false);
  const merge = mergeLkgPublishedProducts(shrunk, prev, {
    incompleteAdvertisers: new Set(["1"]),
    fetchedAdvertisers: new Set(),
  });
  const shrinkGate = evaluateProductShrinkageGate(prev, merge.doc, {
    lkgMerged: merge.carried > 0,
  });
  const deltaChurn = {
    removedCount: prevN - 1,
    addedCount: 0,
    prevUnique: prevN,
    nextUnique: 1,
    removedByClass: { NOT_YET_SEEN: prevN - 1 },
  };
  const churnGate = evaluateIdentityChurnGate(deltaChurn, { lkgMerged: true });
  results.push({
    name: "shrinkage_lkg_preserves_prev",
    ok: merge.carried >= prevN - 1 && shrinkGate.ok === true && churnGate.ok === true,
    carried: merge.carried,
    shrinkOk: shrinkGate.ok,
    churnOk: churnGate.ok,
  });

  const failed = results.filter((r) => r.ok !== true);
  return {
    ok: failed.length === 0,
    failed: failed.map((r) => r.name),
    scenarios: results,
  };
}

export function buildUncappedGrowthActivationRunbook() {
  return {
    productionDefaultRemainsCapped: true,
    steps: [
      "Confirm ≥48h clean schedule cadence + catch-up recovery evidence.",
      "Confirm identityReconcile class EXPECTED_INCOMPLETE_WINDOW_CHURN_ABSORBED_BY_LKG on recent promotes.",
      "Confirm partner INVALID_FEED errors are external-only and LKG retained.",
      "Owner approval recorded (ticket/PR) to raise/remove absolute cumulative 500.",
      "Confirm live-sync already reads IU_CJ_PUBLIC_GROWTH_UNCAPPED (wired; default unset/0 = DISARMED).",
      "Set IU_CJ_PUBLIC_GROWTH_UNCAPPED=1 only as Actions variable/secret on catalog-sync job (never commit true).",
      "Keep maxGrowthRatio (default 0.2) + surgeRatio drip flag (default 0.5): surge flags owner review but does NOT zero per-run drip; deferred remainder continues via checkpoints.",
      "Keep shrinkage / identity churn / durable LKG / fail-closed ledger.",
      "Burn-in one catch-up + one schedule with deferredNew→keptNew observation.",
      "Rollback: unset env; restore growth ledger maxCumulativeAbs=500; ownerGate stays true until ledger rebuilt deliberately.",
    ],
    neverDo: [
      "Do not reset cumulative growth ledger to reopen a silent +500 batch.",
      "Do not disable shrinkage or identity churn guards.",
      "Do not publish unverified identities or weaken CSP.",
    ],
  };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.productionCapped=true]
 * @param {boolean} [opts.ownerGateActive=true]
 * @param {boolean} [opts.observation48hComplete=false]
 * @param {boolean} [opts.liveSyncEnvWired=false] true only after live-sync honors IU_CJ_PUBLIC_GROWTH_UNCAPPED
 */
export function detectLiveSyncUncappedEnvWired(repoRoot = process.cwd()) {
  try {
    const p = path.join(repoRoot, "scripts", "iu-cj-affiliate-offers-live-sync-v1.mjs");
    const t = fs.readFileSync(p, "utf8");
    return (
      /IU_CJ_PUBLIC_GROWTH_UNCAPPED/.test(t) &&
      /uncappedMode\s*=/.test(t) &&
      /applyPublicGrowthBudget\([\s\S]*uncappedMode/.test(t)
    );
  } catch {
    return false;
  }
}

export function evaluateUncappedGrowthReadiness(opts = {}) {
  const volume = runUncappedGrowthVolumeScenarios();
  const codePath = {
    computeSupportsUncappedMode:
      computePublicGrowthBudget(100, { uncappedMode: true, newCandidatesCount: 10 })
        .uncappedMode === true,
    surgePauseWorks:
      computePublicGrowthBudget(100, {
        uncappedMode: true,
        newCandidatesCount: 80,
        surgeRatio: 0.5,
      }).surgePause === true,
    cappedDefaultIntact:
      computePublicGrowthBudget(100, { cumulativeAddedSinceBaseline: 500 }).allowedNew === 0,
  };
  const productionCapped = opts.productionCapped !== false;
  const ownerGateActive = opts.ownerGateActive !== false;
  const observation48hComplete = opts.observation48hComplete === true;
  const liveSyncEnvWired =
    opts.liveSyncEnvWired === true
      ? true
      : opts.liveSyncEnvWired === false
        ? false
        : detectLiveSyncUncappedEnvWired(opts.repoRoot || process.cwd());
  const blockers = [];
  if (!volume.ok) blockers.push("VOLUME_SCENARIOS_FAILED:" + volume.failed.join(","));
  if (!codePath.computeSupportsUncappedMode) blockers.push("CODE_PATH_MISSING_UNCAPPED");
  if (!codePath.surgePauseWorks) blockers.push("SURGE_PAUSE_MISSING");
  if (!codePath.cappedDefaultIntact) blockers.push("CAPPED_DEFAULT_REGRESSED");
  if (!observation48hComplete) blockers.push("PENDING_48H_OBSERVATION");
  if (!liveSyncEnvWired) blockers.push("LIVE_SYNC_ENV_GATE_NOT_WIRED");
  if (productionCapped && ownerGateActive) {
    // expected until owner approval — not a code failure, but blocks READY activation claim
  }
  const ready =
    volume.ok &&
    codePath.computeSupportsUncappedMode &&
    codePath.surgePauseWorks &&
    codePath.cappedDefaultIntact &&
    observation48hComplete &&
    liveSyncEnvWired;
  return {
    schema: UNCAPPED_GROWTH_READINESS_SCHEMA,
    at: new Date().toISOString(),
    verdict: ready ? "READY_FOR_UNCAPPED_GROWTH" : "NOT_READY_FOR_UNCAPPED_GROWTH",
    productionCapped,
    ownerGateActive,
    observation48hComplete,
    liveSyncEnvWired,
    codePath,
    volume,
    blockers,
    activationRunbook: buildUncappedGrowthActivationRunbook(),
    note:
      "READY requires owner-approved live-sync env wiring + 48h observation. Absolute 500 remains until then.",
  };
}

export function writeUncappedGrowthReadinessReport(outPath, opts = {}) {
  const report = evaluateUncappedGrowthReadiness(opts);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return report;
}
