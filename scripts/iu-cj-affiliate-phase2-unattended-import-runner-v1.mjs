#!/usr/bin/env node
/** GitHub Actions entry (offline until multi-gate live approval). */
import { runUnattendedImportCycle } from "./iu-cj-affiliate-phase2-unattended-import-cycle-lib-v1.mjs";

const env = { ...process.env };
env.IU_CJ_UNATTENDED_IMPORT_OFFLINE = env.IU_CJ_UNATTENDED_IMPORT_OFFLINE || "1";
env.IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST = env.IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST || "1";
env.PRODUCTION_SIGNING_ENABLED = env.PRODUCTION_SIGNING_ENABLED || "false";

const result = await runUnattendedImportCycle({
  env,
  mockProductFeedResponse:
    env.IU_CJ_UNATTENDED_MOCK_PRODUCT_FEED === "1"
      ? {
          status: Number(env.IU_CJ_UNATTENDED_MOCK_PRODUCT_STATUS || 200),
          total: Number(env.IU_CJ_UNATTENDED_MOCK_PRODUCT_TOTAL || 0),
        }
      : undefined,
});

console.log(
  JSON.stringify({
    IU_CJ_UNATTENDED_IMPORT_RUNNER_V1: result.ok ? "OK" : "FAIL",
    phase: result.phase,
    reason: result.reason || null,
    publishable: result.publishable === true,
    productionSigningEnabled: result.productionSigningEnabled === true,
    auditPath: result.auditPath || null,
  })
);
process.exit(result.ok ? 0 : 1);
