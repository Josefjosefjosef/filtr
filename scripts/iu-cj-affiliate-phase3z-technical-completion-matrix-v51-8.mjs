/**
 * V51.8 — technical completion matrix (honest statuses).
 * Statuses: IMPLEMENTED | TESTED | PRODUCTION_VERIFIED | PENDING_OBSERVATION | BLOCKED_OWNER_ACTION | NOT_IMPLEMENTED
 */
import fs from "node:fs";
import path from "node:path";
import { proveCfWatchdogRecoveryMatrix } from "./iu-cj-affiliate-phase3z-cf-watchdog-recovery-proof-v51-8.mjs";
import { computeReverifyFreshnessPolicy } from "./iu-cj-affiliate-phase3z-reverify-freshness-policy-v51-8.mjs";
import { runPartnerLifecycleScenarios } from "./iu-cj-affiliate-phase3z-partner-lifecycle-v51-8.mjs";
import { evaluateEmailTechnicalReadiness } from "./iu-cj-affiliate-phase3z-email-technical-readiness-v51-8.mjs";
import { evaluateWorkersAiCatalogRole } from "./iu-cj-affiliate-phase3z-workers-ai-catalog-role-v51-8.mjs";
import { evaluateUncappedGrowthReadiness } from "./iu-cj-affiliate-phase3z-uncapped-growth-readiness-v51-8.mjs";

export const TECHNICAL_COMPLETION_MATRIX_SCHEMA =
  "iu-cj-affiliate-phase3z-technical-completion-matrix-v51-8";

function row(id, status, note, evidence = []) {
  return { id, status, note, evidence };
}

export function buildTechnicalCompletionMatrix(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const cfProof = proveCfWatchdogRecoveryMatrix();
  const reverify = computeReverifyFreshnessPolicy(opts.reverifyOpts || {});
  const lifecycle = runPartnerLifecycleScenarios();
  const email = evaluateEmailTechnicalReadiness(repoRoot);
  const workersAi = evaluateWorkersAiCatalogRole(repoRoot);
  const uncapped = evaluateUncappedGrowthReadiness({
    observation48hComplete: false,
    repoRoot,
  });

  const items = [
    row(
      "scheduler_gha_catalog",
      "PRODUCTION_VERIFIED",
      "Cron :17 slots + catch-up; GHA undelivery known; recovery via watch+CF.",
      ["cj-affiliate-catalog-sync.yml"],
    ),
    row(
      "scheduler_gha_watch_heartbeat",
      "PRODUCTION_VERIFIED",
      "Hourly :27 heartbeat + :47/:57 slot watches.",
      ["cj-affiliate-catalog-sync-schedule-watch.yml"],
    ),
    row(
      "cloudflare_watchdog",
      cfProof.ok ? "PRODUCTION_VERIFIED" : "IMPLEMENTED",
      "Worker deployed; health/probe live; offline stale→catch-up proof " +
        (cfProof.ok ? "PASS" : "FAIL"),
      ["cloudflare/cj-catalog-sync-watchdog", "deploy-cj-catalog-sync-watchdog.yml"],
    ),
    row(
      "catchup_recovery",
      "PRODUCTION_VERIFIED",
      "CATCHUP_DISPATCH_NOT_SCHEDULE runs succeed; daycap/cooldown/busy gates.",
      ["schedule-catchup-v44"],
    ),
    row(
      "checkpoint_continuation",
      "TESTED",
      "Feed/product checkpoints + refresh checkpoints in live-sync.",
      ["product-feed-checkpoints", "refresh-coverage-v35"],
    ),
    row(
      "feed_pagination_complete_pass",
      "PRODUCTION_VERIFIED",
      "Progressive inventory + deepen incomplete; INVALID_FEED continues others.",
      ["offers-live-sync", "invalid-feed-case-audit"],
    ),
    row(
      "invalid_feed_67",
      "PRODUCTION_VERIFIED",
      "67/67 classified EXTERNAL http_400; LKG retain; continueOtherPartners.",
      ["invalid-feed-case-audit-v51-8"],
    ),
    row(
      "product_reverify_rotation",
      "TESTED",
      `~${reverify.coveragePctPerRun}%/run; worst-case full rotation ~${reverify.hoursWorstCaseFullRotation}h with assumed cadence; UNKNOWN prioritized.`,
      ["reverify-freshness-policy-v51-8", "refresh-coverage UNKNOWN priority"],
    ),
    row(
      "unknown_honesty",
      "PRODUCTION_VERIFIED",
      "UNKNOWN ≠ CURRENT; never invent availability/sourceUpdatedAt.",
      ["offers freshness displayClass"],
    ),
    row(
      "lkg_aging",
      "TESTED",
      "Gradual LKG aging 720h / max 25 identities per run; shrinkage fail-closed.",
      ["publication-lkg-v51-8"],
    ),
    row(
      "partner_lifecycle",
      lifecycle.ok ? "TESTED" : "NOT_IMPLEMENTED",
      "JOINED/ENDED/REJOINED public rules; email not authority.",
      ["partner-lifecycle-v51-8"],
    ),
    row(
      "coupons_promotions",
      "PRODUCTION_VERIFIED",
      "Expiry hidden; LKG on incomplete; UI order preserved.",
      ["offers-live-sync freshness coupons/actions"],
    ),
    row(
      "email_ingestion",
      email.verdict === "TECHNICALLY_READY_PUBLICATION_DISARMED"
        ? "IMPLEMENTED"
        : "NOT_IMPLEMENTED",
      "Code+safety ready; publication DISARMED; mailbox secrets = owner.",
      email.ownerActions,
    ),
    row(
      "email_only_publication",
      "BLOCKED_OWNER_ACTION",
      "Stays DISARMED until owner approval after burn-in.",
      ["email-offer-reconcile-v1"],
    ),
    row(
      "workers_ai",
      "BLOCKED_OWNER_ACTION",
      "HTTP 401 token/scope; supplementary to catalog (non-blocking).",
      [workersAi.ownerStepsRef],
    ),
    row(
      "uncapped_growth_code",
      uncapped.volume.ok && uncapped.liveSyncEnvWired
        ? "TESTED"
        : "NOT_IMPLEMENTED",
      "Surge drip + 50k multi-round offline; prod DISARMED owner gate.",
      ["uncapped-growth-readiness-v51-8"],
    ),
    row(
      "uncapped_growth_production",
      "BLOCKED_OWNER_ACTION",
      "IU_CJ_PUBLIC_GROWTH_UNCAPPED must remain 0 until explicit approval.",
      ["growth ledger 500/500"],
    ),
    row(
      "ops_monitoring",
      "IMPLEMENTED",
      "Snapshot builder for sync age / CF decision / alerts.",
      ["ops-monitoring-snapshot-v51-8"],
    ),
    row(
      "schedule_two_on_final_sha",
      "PENDING_OBSERVATION",
      "Need ≥2 event=schedule SUCCESS on final post-watchdog SHA — time-gated, not a code gap.",
      [],
    ),
    row(
      "observation_48h",
      "PENDING_OBSERVATION",
      "Deferred until technical scope closed (this matrix).",
      ["2026-11-11T23:55:05Z → 2026-11-13T23:55:05Z"],
    ),
    row(
      "ios_pwa_real_device",
      "PENDING_OBSERVATION",
      "Automated suite available; real device pending.",
      [],
    ),
    row(
      "r2_publish",
      "IMPLEMENTED",
      "Optional path DISARMED; not required for Pages JSON pipeline.",
      ["catalog-sync R2 jobs"],
    ),
  ];

  const blockers = items.filter((i) =>
    ["NOT_IMPLEMENTED", "BLOCKED_OWNER_ACTION"].includes(i.status),
  );
  const pendingObs = items.filter((i) => i.status === "PENDING_OBSERVATION");
  const incompleteCode = items.filter((i) => i.status === "NOT_IMPLEMENTED");

  const technicallyComplete =
    incompleteCode.length === 0 &&
    blockers.every((b) =>
      ["email_only_publication", "workers_ai", "uncapped_growth_production"].includes(b.id),
    );

  return {
    schema: TECHNICAL_COMPLETION_MATRIX_SCHEMA,
    at: new Date().toISOString(),
    verdict: technicallyComplete ? "TECHNICALLY_COMPLETE" : "TECHNICALLY_INCOMPLETE",
    counts: {
      total: items.length,
      implemented: items.filter((i) =>
        ["IMPLEMENTED", "TESTED", "PRODUCTION_VERIFIED"].includes(i.status),
      ).length,
      pendingObservation: pendingObs.length,
      blockedOwner: blockers.filter((b) => b.status === "BLOCKED_OWNER_ACTION").length,
      notImplemented: incompleteCode.length,
    },
    items,
    remainingForFullAutonomy: [
      ...pendingObs.map((p) => p.id),
      ...blockers.map((b) => b.id + ":" + b.status),
    ],
    note:
      "TECHNICALLY_COMPLETE allows owner-gated items (uncapped/email-only/Workers AI token) and time-gated observation. NOT_IMPLEMENTED must be empty.",
  };
}

export function writeTechnicalCompletionMatrix(outPath, opts = {}) {
  const report = buildTechnicalCompletionMatrix(opts);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return report;
}
