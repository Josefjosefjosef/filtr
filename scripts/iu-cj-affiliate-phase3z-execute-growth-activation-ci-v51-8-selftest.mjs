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
const nonceStorePath = path.join(tmp, "nonces.json");
const ghEnv = path.join(tmp, "github_env.txt");

const disabled = runExecuteGrowthActivationCi({
  enabled: false,
  env: { IU_CJ_GROWTH_EXECUTE_ENABLED: "0" },
  outPath: path.join(tmp, "disabled.json"),
});
assert.equal(disabled.reason, "EXECUTE_DISABLED");
assert.equal(disabled.wroteProjectsData, false);
assert.equal(disabled.githubEnvWritten, false);

const tok = mintOwnerApprovalToken({ hmacSecret, generationId, mainSha, nonce: "ci-dry-" + Date.now() });
const dry = runExecuteGrowthActivationCi({
  enabled: true,
  dryRun: true,
  ownerApprovalToken: tok.token,
  generationId,
  mainSha,
  env: {
    IU_CJ_GROWTH_OWNER_APPROVAL_HMAC: hmacSecret,
    IU_CJ_PUBLIC_GROWTH_UNCAPPED: "0",
    IU_CJ_GROWTH_APPROVAL_NONCE_STORE: nonceStorePath,
    GITHUB_ENV: ghEnv,
  },
  outPath: path.join(tmp, "dry.json"),
});
assert.equal(dry.reason, "DRY_RUN_OK");
assert.equal(dry.wroteProjectsData, false);
assert.equal(dry.authConsumed, false);
assert.equal(dry.githubEnvWritten, false);
assert.equal(fs.existsSync(ghEnv), false);

const liveTok = mintOwnerApprovalToken({ hmacSecret, generationId, mainSha, nonce: "ci-live-" + Date.now() });
const live = runExecuteGrowthActivationCi({
  enabled: true,
  dryRun: false,
  ownerApprovalToken: liveTok.token,
  generationId,
  mainSha,
  env: {
    IU_CJ_GROWTH_OWNER_APPROVAL_HMAC: hmacSecret,
    IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1",
    IU_CJ_GROWTH_APPROVAL_NONCE_STORE: nonceStorePath,
    GITHUB_ENV: ghEnv,
  },
  armReceiptPath: path.join(tmp, "arm.json"),
  outPath: path.join(tmp, "live.json"),
});
assert.equal(live.reason, "ARMED_FOR_CATALOG_SYNC");
assert.equal(live.wroteProjectsData, false);
assert.equal(live.githubEnvWritten, true);
const envTxt = fs.readFileSync(ghEnv, "utf8");
assert.ok(envTxt.includes("IU_CJ_GROWTH_ACTIVATION_ARMED=1"));
assert.ok(envTxt.includes("IU_CJ_GROWTH_FIRST_BATCH_MAX=25"));
assert.ok(!envTxt.includes(liveTok.token));

console.log(
  JSON.stringify({
    IU_CJ_EXECUTE_GROWTH_ACTIVATION_CI_SELFTEST: "OK",
    disabled: disabled.reason,
    dry: dry.reason,
    live: live.reason,
    wroteProjectsData: false,
    githubEnvWrittenOnLiveOnly: true,
  }),
);
