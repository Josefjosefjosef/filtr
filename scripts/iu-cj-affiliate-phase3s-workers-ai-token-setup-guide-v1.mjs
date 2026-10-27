#!/usr/bin/env node
/**
 * Phase 3S — operator guide for Workers AI token (never prints secret values).
 * Run: node scripts/iu-cj-affiliate-phase3s-workers-ai-token-setup-guide-v1.mjs
 */
import { resolveCloudflareAiApiToken, WORKERS_AI_MODEL_CZECH_CANDIDATE } from "./iu-cj-affiliate-phase2-workers-ai-adapter.mjs";

const meta = resolveCloudflareAiApiToken(process.env);

const guide = {
  schema: "iu-cj-affiliate-phase3s-workers-ai-token-setup-guide-v1",
  preferredModel: WORKERS_AI_MODEL_CZECH_CANDIDATE,
  preferredSecretName: "IU_CJ_WORKERS_AI_API_TOKEN",
  fallbackSecretNamesTriedInOrder: [
    "IU_CJ_WORKERS_AI_API_TOKEN",
    "CLOUDFLARE_CJ_STAGING_API_TOKEN",
    "CLOUDFLARE_ADS_API_TOKEN",
    "CLOUDFLARE_API_TOKEN",
  ],
  currentlyResolvedSecretName: meta.name,
  currentlyHasSomeToken: meta.present === true,
  knownBlocker: "Live probe returned HTTP 401 — existing tokens lack Workers AI permission or wrong account",
  accountIdInWorkflow: "577868e9aac9c289e9323100f68fad16",
  endpoint:
    "POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/meta/llama-3.1-8b-instruct",
  freeTierNote: "Workers AI free allocation 10,000 Neurons/day; no new paid plan required for capped runs",
  createTokenSteps: [
    "1) Cloudflare Dashboard → My Profile → API Tokens → Create Token",
    "2) Use template 'Edit Cloudflare Workers' OR custom token",
    "3) Minimum permissions: Account → Workers AI → Edit (or Read if only inference)",
    "4) Account Resources: include account 577868e9aac9c289e9323100f68fad16 only",
    "5) Copy token once — never paste into chat/logs/commits",
    "6) GitHub repo Settings → Secrets → Actions → New secret name IU_CJ_WORKERS_AI_API_TOKEN",
    "7) Re-run workflow cj-affiliate-email-ingest.yml; expect WORKERS_AI_PROBE=OK and AI_LIVE_SUCCESS>0",
  ],
  verifyWithoutLeaking: [
    "Probe JSON must show hasApiToken=true, probe=OK, httpStatus null/absent",
    "Pipeline summary aiClaimedAsLiveAi=true and aiLiveSuccessCount>0",
    "aiAuthFailedCount must be 0 after fix",
  ],
  doNot: [
    "Do not put token in repo, workflow YAML literal, or artifacts",
    "Do not widen token to All accounts / All zones unless required",
    "Do not upgrade to Workers Paid solely for this — stay within free Neurons with IU_CJ_AI_MAX_CALLS_PER_RUN",
  ],
  liveEnabled: false,
  publishArmed: false,
};

console.log(JSON.stringify(guide, null, 2));
