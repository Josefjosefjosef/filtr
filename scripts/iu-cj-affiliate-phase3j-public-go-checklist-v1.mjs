#!/usr/bin/env node
/**
 * Phase 3J — public CJ LIVE GO checklist (DO NOT EXECUTE activation).
 * Prints the exact steps for a later human GO. Never flips LIVE_ENABLED.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function buildPhase3jPublicGoChecklist() {
  return {
    schema: "iu-cj-phase3j-public-go-checklist-v1",
    at: new Date().toISOString(),
    executeNow: false,
    liveEnabledRequiredAfterGo: true,
    currentDefaults: {
      CJ_MANAGED_PUBLIC_LIVE_ENABLED: "false",
      liveEnabled: false,
      publishArmed: false,
      CJ_LIVE_PUBLISHING: "DISARMED",
    },
    steps: [
      {
        n: 1,
        title: "Verify last successful R2 staging burn-in",
        proof: "workflow CJ Affiliate R2 staging burn-in conclusion=success + publish ok response",
      },
      {
        n: 2,
        title: "Verify snapshot integrity (sha256 + partner/active counts)",
        proof: "publish meta contentSha256 matches source JSON",
      },
      {
        n: 3,
        title: "Security gates: noauth POST 401, secrets not in logs, NDIC/CHMI/CNB healthy",
        proof: "curl + recent CHMI/CNB workflow success",
      },
      {
        n: 4,
        title: "Confirm main SHA + required checks green",
        proof: "git rev-parse origin/main + branch protection contexts",
      },
      {
        n: 5,
        title: "Confirm IU_DATA_PR_MERGE_HOLD=0 and no conflicting data PRs",
        proof: "gh variable get",
      },
      {
        n: 6,
        title: "Flip ONLY worker var CJ_MANAGED_PUBLIC_LIVE_ENABLED=true (wrangler/dashboard)",
        proof: "deploy with live true; never commit plaintext secrets",
        risk: "Public GET begins serving R2 current key",
      },
      {
        n: 7,
        title: "Verify public GET returns x-iu-cj-managed-public-source: r2",
        proof: "curl -D headers to managed-public-v1.json",
      },
      {
        n: 8,
        title: "Spot-check buttons/coupons/products PC/tablet/mobile/PWA + light/dark",
        proof: "manual QA + smoke affiliate guards",
      },
      {
        n: 9,
        title: "Confirm MANUAL_PROTECTED / paid ad slots unchanged",
        proof: "iu-ads-regression-freeze PASS",
      },
      {
        n: 10,
        title: "Rollback plan ready: set LIVE_ENABLED=false OR restore LKG via authenticated rollback",
        proof: "worker LKG key + wrangler var flip",
      },
      {
        n: 11,
        title: "Post-GO monitoring: catalog-sync schedule, R2 publish arm policy, error budgets",
        proof: "workflow run history 24–72h",
      },
      {
        n: 12,
        title: "Cost note: R2 Class A/B ops + Worker requests within existing account; no new paid plan expected for current volume",
        proof: "Cloudflare usage dashboard after 7 days",
      },
    ],
    remainingProductBlockers: [
      {
        advertiserId: "5578976",
        name: "Novakid INT",
        status: "MANUAL_REVIEW",
        recommendation: "Do not force into aff-deti-hracky; consider dedicated Education section only with product GO",
      },
      {
        advertiserId: "7804601",
        name: "GearUP",
        status: "MANUAL_REVIEW",
        recommendation: "Do not force into aff-knihy; consider Gaming section only with product GO",
      },
      {
        advertiserId: "5614135",
        name: "Gavri.cz",
        status: "KEEP_DRIFT_NOT_CONFIRMED_ENDED",
        recommendation: "Remove only after CJ confirms ENDED",
      },
    ],
    note: "This checklist is informational. Phase 3J must leave LIVE_ENABLED=false.",
  };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const plan = buildPhase3jPublicGoChecklist();
  const outDir = path.join(process.env.TEMP || "/tmp", "iu-cj-phase3j-go");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "public-go-checklist.json");
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
  console.log(
    JSON.stringify({
      IU_CJ_PHASE3J_PUBLIC_GO_CHECKLIST: "OK",
      executeNow: false,
      steps: plan.steps.length,
      blockers: plan.remainingProductBlockers.length,
      outPath,
    })
  );
}
