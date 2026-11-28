#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mintOwnerApprovalToken } from "./iu-cj-affiliate-phase3z-safe-autonomous-growth-v51-8.mjs";
import { runExecuteGrowthActivationCi } from "./iu-cj-affiliate-phase3z-execute-growth-activation-ci-v51-8.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-exec-ci-"));
const hmacSecret = "ci-bridge-selftest-hmac-secret!!";
const mainSha = "a9c6c536441f8fb8a690d5bf691713d8333d7e42";
const generationId = "2026-11-21T07:37:56.158Z";
const nonceSqlitePath = path.join(tmp, "nonces.sqlite");
const ghEnv = path.join(tmp, "github_env.txt");

const disabled = await runExecuteGrowthActivationCi({
  enabled: false,
  env: { IU_CJ_GROWTH_EXECUTE_ENABLED: "0" },
  outPath: path.join(tmp, "disabled.json"),
});
assert.equal(disabled.reason, "EXECUTE_DISABLED");
assert.equal(disabled.wroteProjectsData, false);
assert.equal(disabled.githubEnvWritten, false);

const tok = mintOwnerApprovalToken({ hmacSecret, generationId, mainSha, nonce: "ci-dry-" + Date.now() });
const dry = await runExecuteGrowthActivationCi({
  enabled: true,
  dryRun: true,
  ownerApprovalToken: tok.token,
  generationId,
  mainSha,
  allowInsecureLocal: true,
  nonceSqlitePath,
  env: {
    IU_CJ_GROWTH_OWNER_APPROVAL_HMAC: hmacSecret,
    IU_CJ_PUBLIC_GROWTH_UNCAPPED: "0",
    GITHUB_ENV: ghEnv,
  },
  outPath: path.join(tmp, "dry.json"),
});
assert.equal(dry.reason, "DRY_RUN_OK");
assert.equal(dry.wroteProjectsData, false);
assert.equal(dry.authConsumed, false);
assert.equal(dry.githubEnvWritten, false);
assert.equal(fs.existsSync(ghEnv), false);

/* Actions without durable URL must fail-closed on live consume */
const noDurableTok = mintOwnerApprovalToken({
  hmacSecret,
  generationId,
  mainSha,
  nonce: "ci-nodurable-" + Date.now(),
});
const readyChecks = {
  backupPlanReady: true,
  requiredCiPass: true,
  pagesPass: true,
  joinedRegistryPass: true,
  czEligibilityPass: true,
  paidPositionsPass: true,
  stopMechanismPass: true,
  rollbackReady: true,
};
const noDurable = await runExecuteGrowthActivationCi({
  enabled: true,
  dryRun: false,
  ownerApprovalToken: noDurableTok.token,
  generationId,
  mainSha,
  ...readyChecks,
  env: {
    GITHUB_ACTIONS: "true",
    IU_CJ_GROWTH_OWNER_APPROVAL_HMAC: hmacSecret,
    IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1",
    GITHUB_ENV: ghEnv,
  },
  outPath: path.join(tmp, "nodurable.json"),
});
assert.equal(noDurable.reason, "NONCE_STORE_UNAVAILABLE");
assert.equal(noDurable.executed, false);
assert.equal(noDurable.wroteProjectsData, false);
assert.equal(noDurable.githubEnvWritten, false);

const liveTok = mintOwnerApprovalToken({ hmacSecret, generationId, mainSha, nonce: "ci-live-" + Date.now() });
const live = await runExecuteGrowthActivationCi({
  enabled: true,
  dryRun: false,
  ownerApprovalToken: liveTok.token,
  generationId,
  mainSha,
  ...readyChecks,
  allowInsecureLocal: true,
  nonceSqlitePath,
  env: {
    IU_CJ_GROWTH_OWNER_APPROVAL_HMAC: hmacSecret,
    IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1",
    GITHUB_ENV: ghEnv,
  },
  armReceiptPath: path.join(tmp, "arm.json"),
  outPath: path.join(tmp, "live.json"),
});
assert.equal(live.reason, "ARMED_FOR_CATALOG_SYNC");
assert.equal(live.wroteProjectsData, false);
assert.equal(live.githubEnvWritten, true);
assert.equal(live.nonceStoreDurable, true);
const envTxt = fs.readFileSync(ghEnv, "utf8");
assert.ok(envTxt.includes("IU_CJ_GROWTH_ACTIVATION_ARMED=1"));
assert.ok(envTxt.includes("IU_CJ_GROWTH_FIRST_BATCH_MAX=25"));
assert.ok(!envTxt.includes(liveTok.token));

const omittedTok = mintOwnerApprovalToken({
  hmacSecret,
  generationId,
  mainSha,
  nonce: "ci-omitted-" + Date.now(),
});
const omittedEnv = path.join(tmp, "omitted_env.txt");
const omitted = await runExecuteGrowthActivationCi({
  enabled: true,
  dryRun: false,
  ownerApprovalToken: omittedTok.token,
  generationId,
  mainSha,
  allowInsecureLocal: true,
  nonceSqlitePath,
  env: {
    IU_CJ_GROWTH_OWNER_APPROVAL_HMAC: hmacSecret,
    IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1",
    GITHUB_ENV: omittedEnv,
  },
  outPath: path.join(tmp, "omitted.json"),
});
assert.equal(omitted.reason, "PRECHECK_FAILED");
assert.equal(omitted.executed, false);
assert.equal(omitted.wroteProjectsData, false);
assert.equal(omitted.githubEnvWritten, false);
assert.equal(fs.existsSync(omittedEnv), false);

console.log(
  JSON.stringify({
    IU_CJ_EXECUTE_GROWTH_ACTIVATION_CI_SELFTEST: "OK",
    disabled: disabled.reason,
    dry: dry.reason,
    noDurable: noDurable.reason,
    live: live.reason,
    omitted: omitted.reason,
    wroteProjectsData: false,
    githubEnvWrittenOnLiveOnly: true,
    durableRequiredOnActions: true,
  }),
);
