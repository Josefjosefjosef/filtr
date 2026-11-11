import {
  evaluateUncappedGrowthReadiness,
  runUncappedGrowthVolumeScenarios,
} from "./iu-cj-affiliate-phase3z-uncapped-growth-readiness-v51-8.mjs";
import {
  reconcilePublicationProposedVsPublished,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const volume = runUncappedGrowthVolumeScenarios();
assert(volume.ok === true, "volume scenarios: " + JSON.stringify(volume.failed));

const notReady = evaluateUncappedGrowthReadiness({
  productionCapped: true,
  ownerGateActive: true,
  observation48hComplete: false,
  liveSyncEnvWired: false,
});
assert(notReady.verdict === "NOT_READY_FOR_UNCAPPED_GROWTH", "default not ready");
assert(notReady.blockers.includes("PENDING_48H_OBSERVATION"), "obs blocker");
assert(notReady.blockers.includes("LIVE_SYNC_ENV_GATE_NOT_WIRED"), "env blocker");
assert(notReady.codePath.cappedDefaultIntact === true, "capped default");

const ready = evaluateUncappedGrowthReadiness({
  productionCapped: true,
  ownerGateActive: true,
  observation48hComplete: true,
  liveSyncEnvWired: true,
});
assert(ready.verdict === "READY_FOR_UNCAPPED_GROWTH", "ready when gates met");
assert(Array.isArray(ready.activationRunbook.steps) && ready.activationRunbook.steps.length >= 8, "runbook");

const recon = reconcilePublicationProposedVsPublished({
  publicationDelta: {
    prevUnique: 3424,
    nextUnique: 1550,
    removedCount: 3294,
    addedCount: 1420,
    removedByClass: { NOT_YET_SEEN: 3294 },
  },
  publicationRestore: { carried: 3294, uniqueAfter: 4844 },
  publicGrowthBudget: {
    publicEligibleAfter: 3423,
    deferredNew: 1414,
    keptNew: 0,
    exceptionalGrowthRequiresOwner: true,
    cumulativeAddedSinceBaseline: 500,
    cumulativeRemaining: 0,
  },
});
assert(
  recon.classification === "EXPECTED_INCOMPLETE_WINDOW_CHURN_ABSORBED_BY_LKG",
  "reconcile class",
);
assert(recon.unauthorizedMassRemoval === false, "no unauthorized mass removal");

console.log(
  JSON.stringify({
    IU_CJ_UNCAPPED_GROWTH_READINESS_SELFTEST: "PASS",
    volumeScenarios: volume.scenarios.length,
    defaultVerdict: notReady.verdict,
    readyWhenGatesMet: ready.verdict,
    reconcileClass: recon.classification,
  }),
);
