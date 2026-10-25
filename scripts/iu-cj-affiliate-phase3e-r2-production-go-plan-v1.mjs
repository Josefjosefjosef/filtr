#!/usr/bin/env node
/**
 * Phase 3E — exact R2 production setup plan (offline checklist).
 * Documents GO-gated operations. Never creates buckets or sets secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditCjManagedPublicR2Readiness } from "./iu-cj-affiliate-phase3d-r2-infra-readiness-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function buildCjR2ProductionGoPlan(opts = {}) {
  const audit = auditCjManagedPublicR2Readiness({
    root: opts.root || ROOT,
    secretsPresence: opts.secretsPresence || {
      IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: "MISSING",
      IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: "MISSING",
    },
  });

  const steps = [
    {
      id: "create_r2_bucket",
      title: "Create R2 bucket iu-cj-managed-public-live",
      requiresGo: true,
      executeWithoutGo: false,
      where: "Cloudflare dashboard / wrangler (manual GO)",
    },
    {
      id: "uncomment_binding",
      title: "Uncomment CJ_MANAGED_PUBLIC [[r2_buckets]] in wrangler.toml",
      requiresGo: true,
      executeWithoutGo: false,
      where: "cloudflare/iu-site-redirects/wrangler.toml",
    },
    {
      id: "set_worker_publish_token",
      title: "Set worker secret CJ_MANAGED_PUBLIC_PUBLISH_TOKEN",
      requiresGo: true,
      executeWithoutGo: false,
      where: "wrangler secret put (never commit)",
    },
    {
      id: "set_github_secrets",
      title: "Set GH secrets IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL + TOKEN",
      requiresGo: true,
      executeWithoutGo: false,
      where: "GitHub repo secrets",
    },
    {
      id: "deploy_worker_live_flag_false",
      title: "Deploy worker with CJ_MANAGED_PUBLIC_LIVE_ENABLED still false",
      requiresGo: true,
      executeWithoutGo: false,
      where: "Cloudflare worker deploy",
    },
    {
      id: "staging_burn_in",
      title: "Staging burn-in publish to staging key; verify LKG/atomic/rollback",
      requiresGo: true,
      executeWithoutGo: false,
      where: "workflow publish_managed_public_r2 after infra GO",
    },
    {
      id: "arm_live_flag",
      title: "Arm LIVE_ENABLED / public serve only after staging burn-in PASS",
      requiresGo: true,
      executeWithoutGo: false,
      where: "separate final GO — not part of Phase 3E",
    },
  ];

  return {
    schema: "iu-cj-phase3e-r2-production-go-plan-v1",
    at: new Date().toISOString(),
    productionActionsArmed: false,
    liveEnabled: false,
    publishArmed: false,
    bucketName: "iu-cj-managed-public-live",
    bindingName: "CJ_MANAGED_PUBLIC",
    publishPath: "/projects/data/iu-affiliate-cj-managed-public/__iu_live_publish",
    publicPath: "/projects/data/iu-affiliate-cj-managed-public-v1.json",
    lkg: "Worker keeps previous current as LKG on successful atomic publish",
    concurrency: "Workflow concurrency group cj-affiliate-catalog-sync; cancel-in-progress=false",
    disarmedDefaults: {
      workflow_publish_managed_public_r2: "0",
      CJ_MANAGED_PUBLIC_LIVE_ENABLED: "false",
      R2_PUBLISH_ARMED: "requires explicit 1",
    },
    auditSummary: {
      codeReady: audit.codeReady,
      infraPending: audit.infraPending,
      secretsReady: audit.secretsReady,
      productionPublishAllowed: audit.productionPublishAllowed,
    },
    steps,
    note: "Repo-only plan. Phase 3E does not create bucket, mutate Cloudflare, or arm publishing.",
  };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const plan = buildCjR2ProductionGoPlan();
  console.log(
    JSON.stringify({
      IU_CJ_PHASE3E_R2_GO_PLAN: "OK",
      productionActionsArmed: plan.productionActionsArmed,
      steps: plan.steps.length,
      infraPending: plan.auditSummary.infraPending,
      liveEnabled: plan.liveEnabled,
    })
  );
  process.exit(0);
}
