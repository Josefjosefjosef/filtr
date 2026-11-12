/**
 * V51.8 — full 28-capability robot matrix (honest statuses).
 */
import fs from "node:fs";
import path from "node:path";

export const ROBOT_28_MATRIX_SCHEMA = "iu-cj-affiliate-phase3z-robot-28-capability-matrix-v51-8";

/** @typedef {"IMPLEMENTED"|"TESTED"|"PRODUCTION_VERIFIED"|"PENDING_OBSERVATION"|"BLOCKED_OWNER_ACTION"|"NOT_IMPLEMENTED"} CapStatus */

function cap(id, name, impl, test, status, note, owner = false, observation = false) {
  return {
    id,
    name,
    implementationFile: impl,
    testFile: test,
    status,
    productionEvidence: status === "PRODUCTION_VERIFIED" ? "see evidence pack / prod runs" : null,
    remainingBlocker:
      status === "PENDING_OBSERVATION"
        ? "time-gated observation"
        : status === "BLOCKED_OWNER_ACTION"
          ? "owner action required"
          : status === "NOT_IMPLEMENTED"
            ? "missing implementation"
            : null,
    dependsOnOwner: owner,
    dependsOnObservation: observation,
    note,
  };
}

export function buildRobot28CapabilityMatrix(opts = {}) {
  const recoveryVerified = opts.cloudflareRecoveryVerified === true;
  const items = [
    cap(1, "Detect CJ partner status", "scripts/iu-cj-affiliate-phase3z-partner-registry-v1.mjs", "scripts/iu-cj-affiliate-phase3z-partner-registry-v1-selftest.mjs", "PRODUCTION_VERIFIED", "JOINED/ENDED from CJ API"),
    cap(2, "JOINED/ENDED/REJOINED lifecycle", "scripts/iu-cj-affiliate-phase3z-partner-lifecycle-v51-8.mjs", "scripts/iu-cj-affiliate-phase3z-partner-lifecycle-v51-8-selftest.mjs", "TESTED", "Offline lifecycle + registry rules; prod partner counts verified"),
    cap(3, "Load authorized product feeds", "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs", "scripts/iu-cj-affiliate-offers-live-sync-v1-selftest.mjs", "PRODUCTION_VERIFIED", "Inventory + progressive feeds"),
    cap(4, "Checkpoint continuation", "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs", "catalog-sync selftests", "PRODUCTION_VERIFIED", "Feed/product/refresh checkpoints"),
    cap(5, "Add new valid products", "scripts/iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs", "scripts/iu-cj-affiliate-phase3z-uncapped-growth-readiness-v51-8-selftest.mjs", "PRODUCTION_VERIFIED", "Capped by growth ledger until owner uncapped"),
    cap(6, "Update existing products", "scripts/iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs", "scripts/iu-cj-affiliate-phase3z-reverify-freshness-policy-v51-8-selftest.mjs", "PRODUCTION_VERIFIED", "Refresh + reverify rotation"),
    cap(7, "Update prices / original prices", "scripts/iu-cj-affiliate-phase3z-product-reverify-v50.mjs", "scripts/iu-cj-affiliate-phase3z-reverify-consistency-v51-6-selftest.mjs", "PRODUCTION_VERIFIED", "Reverify ledger price classes"),
    cap(8, "Update discounts", "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs", "offers-live-sync selftest", "PRODUCTION_VERIFIED", "Derived from price fields"),
    cap(9, "Update availability", "scripts/iu-cj-affiliate-phase3z-product-reverify-v50.mjs", "reverify selftests", "PRODUCTION_VERIFIED", "UNKNOWN when CJ omits"),
    cap(10, "Update product photos", "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs", "offers-live-sync selftest", "PRODUCTION_VERIFIED", "imageUrl refresh on match"),
    cap(11, "Update affiliate URL", "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs", "publish-gate selftests", "PRODUCTION_VERIFIED", "CJ tracking URL validation"),
    cap(12, "Update categories", "scripts/iu-cj-affiliate-phase3z-partner-registry-v1.mjs", "partner-registry selftest", "PRODUCTION_VERIFIED", "Assortment + hysteresis"),
    cap(13, "Process coupons", "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs", "offers-live-sync selftest", "PRODUCTION_VERIFIED", "Expiry hidden"),
    cap(14, "Process promotions", "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs", "offers-live-sync selftest", "PRODUCTION_VERIFIED", "Expiry hidden"),
    cap(15, "Authorized email offers", "scripts/iu-cj-affiliate-phase3r-email-offer-reconcile-v1.mjs", "scripts/iu-cj-affiliate-phase3z-email-technical-readiness-v51-8-selftest.mjs", "BLOCKED_OWNER_ACTION", "Code ready; mailbox secrets + arm pending", true, false),
    cap(16, "Offer validity start/end", "scripts/iu-cj-affiliate-offers-live-sync-v1.mjs", "offers freshness", "PRODUCTION_VERIFIED", "Expired coupons/actions hidden"),
    cap(17, "Remove invalid public offers", "scripts/iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs", "publication-lkg selftest", "PRODUCTION_VERIFIED", "ENDED/revoked/invalid gates"),
    cap(18, "Retain products on incomplete feeds", "scripts/iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs", "publication-lkg selftest", "PRODUCTION_VERIFIED", "LKG carry"),
    cap(19, "LKG aging", "scripts/iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs", "publication-lkg selftest", "TESTED", "Gradual aging 720h / 25 per run"),
    cap(20, "Identity collisions", "scripts/iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs", "uncapped readiness selftest", "TESTED", "Compound advertiser|productId"),
    cap(21, "Recover after outage", "cloudflare/cj-catalog-sync-watchdog", "scripts/iu-cj-affiliate-phase3z-cf-watchdog-recovery-proof-v51-8-selftest.mjs", recoveryVerified ? "PRODUCTION_VERIFIED" : "TESTED", recoveryVerified ? "CF authorized catch-up proven" : "Awaiting PRODUCTION_RECOVERY_VERIFIED evidence", false, !recoveryVerified),
    cap(22, "Prevent duplicate publication", "cj-affiliate-catalog-sync concurrency", "schedule-catchup-v44 selftest", "PRODUCTION_VERIFIED", "Single concurrency group"),
    cap(23, "Resume after interruption", "checkpoints + catch-up", "catchup/gap-deepen selftests", "PRODUCTION_VERIFIED", "Checkpoint + catch-up"),
    cap(24, "Publish via CI pipeline", ".github/workflows/cj-affiliate-catalog-sync.yml", "required CI", "PRODUCTION_VERIFIED", "Data PR → CI → merge → Pages"),
    cap(25, "Self-monitor", "scripts/iu-cj-affiliate-phase3z-ops-monitoring-snapshot-v51-8.mjs", "ops snapshot", "IMPLEMENTED", "Snapshot builder; alerting channel owner"),
    cap(26, "Record errors and recovery", "offers-sync-audit + partnerFetchErrorCases", "invalid-feed audit", "PRODUCTION_VERIFIED", "67 INVALID_FEED external cases"),
    cap(27, "Operate without local PC", "GHA + CF Workers", "deploy workflows", "PRODUCTION_VERIFIED", "Cloud-only engines"),
    cap(28, "Uncapped growth after approval", "scripts/iu-cj-affiliate-phase3z-uncapped-growth-readiness-v51-8.mjs", "uncapped + deferred-drain selftests", "BLOCKED_OWNER_ACTION", "DISARMED; drip proven offline", true, true),
  ];

  const counts = {
    total: items.length,
    productionVerified: items.filter((i) => i.status === "PRODUCTION_VERIFIED").length,
    tested: items.filter((i) => i.status === "TESTED").length,
    implemented: items.filter((i) => i.status === "IMPLEMENTED").length,
    pendingObservation: items.filter((i) => i.status === "PENDING_OBSERVATION").length,
    blockedOwner: items.filter((i) => i.status === "BLOCKED_OWNER_ACTION").length,
    notImplemented: items.filter((i) => i.status === "NOT_IMPLEMENTED").length,
  };

  return {
    schema: ROBOT_28_MATRIX_SCHEMA,
    at: new Date().toISOString(),
    cloudflareRecoveryVerified: recoveryVerified,
    counts,
    items,
    ownerActionsRequired: items.filter((i) => i.dependsOnOwner).map((i) => i.id + ":" + i.name),
    observationRequired: items.filter((i) => i.dependsOnObservation).map((i) => i.id + ":" + i.name),
  };
}

export function writeRobot28CapabilityMatrix(outPath, opts = {}) {
  const report = buildRobot28CapabilityMatrix(opts);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return report;
}
