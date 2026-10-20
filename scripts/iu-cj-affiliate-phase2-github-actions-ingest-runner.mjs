#!/usr/bin/env node
/** Entry point for GitHub Actions (offline when IU_CJ_EMAIL_INGEST_OFFLINE=1). */
import { runGithubActionsIngestCycle, INGEST_RUN_MODE, resolveIngestRuntimeConfig } from "./iu-cj-affiliate-phase2-github-actions-ingest-lib.mjs";
import { resolveOfflineIngestFixture } from "./iu-cj-affiliate-phase2-offline-ingest-fixtures.mjs";

const mode = process.env.IU_CJ_EMAIL_INGEST_MODE || INGEST_RUN_MODE.periodic;
const config = resolveIngestRuntimeConfig();

if (!config.offlineForced && !config.liveImapAllowed) {
  console.log(
    JSON.stringify({
      IU_CJ_GITHUB_ACTIONS_INGEST_RUNNER: "BLOCKED",
      reason: "live_imap_not_approved_use_IU_CJ_EMAIL_INGEST_OFFLINE=1_for_ci",
      productionSigningEnabled: config.productionSigningEnabled,
    })
  );
  process.exit(0);
}

const cycleOptions = {
  mode,
  env: process.env,
};

if (config.offlineForced) {
  cycleOptions.mockFixture = resolveOfflineIngestFixture(process.env);
}

const result = await runGithubActionsIngestCycle(cycleOptions);

console.log(
  JSON.stringify({
    IU_CJ_GITHUB_ACTIONS_INGEST_RUNNER: result.ok ? "OK" : "FAIL",
    mode,
    offline: config.offlineForced,
    liveBlocked: !config.liveImapAllowed,
    d1Backend: config.d1Backend,
    fixtureMode: config.offlineForced ? process.env.IU_CJ_OFFLINE_FIXTURE || "default" : "none",
    resultSummary: {
      batchSize: result.fetchResult?.batchSize,
      publishable: result.publishable,
    },
  })
);
process.exit(result.ok ? 0 : 1);
