#!/usr/bin/env node
import { auditStagingWranglerConfig } from "./iu-cj-affiliate-phase2-staging-env-guard-lib.mjs";
import {
  assertStagingWorkerBindings,
  createMockStagingWorkerEnv,
} from "./iu-cj-affiliate-phase2-staging-worker-bindings-lib.mjs";
import { auditCjIngestSchedulerContract } from "./iu-cj-affiliate-phase2-staging-scheduler-contract-lib.mjs";
import { ingestBannerAssetToStagingR2, createInMemoryBannerR2Store } from "./iu-cj-affiliate-phase2-banner-staging-r2-lib.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const wranglerAudit = auditStagingWranglerConfig();
expect("wrangler_staging_ok", wranglerAudit.ok === true);
expect("wrangler_publishable_false", wranglerAudit.publishable === false);

const scheduler = auditCjIngestSchedulerContract();
expect("no_cron_on_cj_workflows", scheduler.ok === true && scheduler.cronArmed === false);

const mockEnv = createMockStagingWorkerEnv();
const bindingAudit = assertStagingWorkerBindings(mockEnv);
expect("worker_bindings_contract", bindingAudit.ok === true);

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const store = createInMemoryBannerR2Store();
const banner = await ingestBannerAssetToStagingR2({
  store,
  sourceUrl: "https://images.example.com/banner.png",
  skipUrlDnsCheck: true,
  buffer: tinyPng,
  creative: {
    creativeId: "cr-staging-1",
    affiliateClickUrl: "https://www.dpbolvw.net/click-101883843-15037573",
    affiliateClickVerified: true,
    publicationReady: false,
  },
});
expect("banner_r2_archived", banner.ok === true && banner.publishable === false);
expect("banner_object_key_staging", String(banner.objectKey || "").startsWith("staging/banners/"));

console.log(
  JSON.stringify({
    IU_CJ_STAGING_ISOLATION_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    wrangler: wranglerAudit.config,
  })
);
process.exit(failures.length ? 1 : 0);
