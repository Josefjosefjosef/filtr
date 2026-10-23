#!/usr/bin/env node
/**
 * Offline regression for post-deploy health assertion retry (no live CJ HTTP).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attemptStagingPostDeployHealth,
  evaluateStagingPostDeployHealth,
  parseHealthJsonSafe,
  runStagingPostDeployHealthRetry,
} from "./iu-cj-affiliate-staging-postdeploy-health-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF_CODE = path.join(
  REPO,
  ".github/workflows/cj-affiliate-staging-worker-code-deploy-keep-vars.yml"
);
const WF_DEPLOY = path.join(REPO, ".github/workflows/cj-affiliate-staging-worker-deploy.yml");

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const good = {
  ok: true,
  environment: "staging",
  stagingOnly: true,
  cjArchiveOnly: true,
  cjLiveApiRequestsAllowed: false,
  publishable: false,
  d1Binding: "present",
  r2Binding: "present",
  cjPatConfigured: true,
};

const staleBroken = {
  ...good,
  ok: false,
  d1Binding: "missing",
  r2Binding: "missing",
};

expect("good_pass", evaluateStagingPostDeployHealth(good).ok === true);
expect(
  "stale_broken_fail",
  evaluateStagingPostDeployHealth(staleBroken).ok === false &&
    evaluateStagingPostDeployHealth(staleBroken).reasons.includes("ok_not_true") &&
    evaluateStagingPostDeployHealth(staleBroken).reasons.includes("d1Binding_not_present")
);

expect(
  "http200_wrong_values",
  evaluateStagingPostDeployHealth({ ...good, environment: "production" }).reasons.includes(
    "environment_not_staging"
  )
);
expect(
  "go_on_fail",
  evaluateStagingPostDeployHealth({ ...good, cjLiveApiRequestsAllowed: true }).reasons.includes(
    "cjLiveApiRequestsAllowed_not_false"
  )
);
expect(
  "publishable_true_fail",
  evaluateStagingPostDeployHealth({ ...good, publishable: true }).reasons.includes(
    "publishable_not_false"
  )
);
expect(
  "missing_d1",
  evaluateStagingPostDeployHealth({ ...good, d1Binding: "missing" }).reasons.includes(
    "d1Binding_not_present"
  )
);
expect(
  "missing_r2",
  evaluateStagingPostDeployHealth({ ...good, r2Binding: "missing" }).reasons.includes(
    "r2Binding_not_present"
  )
);
expect(
  "wrong_env",
  evaluateStagingPostDeployHealth({ ...good, stagingOnly: false }).reasons.includes(
    "stagingOnly_not_true"
  )
);
expect("null_payload", evaluateStagingPostDeployHealth(null).ok === false);
expect("array_payload", evaluateStagingPostDeployHealth([]).ok === false);
expect("missing_field_ok", evaluateStagingPostDeployHealth({ environment: "staging" }).ok === false);

expect("parse_invalid", parseHealthJsonSafe("{nope").ok === false);
expect("parse_empty", parseHealthJsonSafe("").ok === false);
expect("parse_good", parseHealthJsonSafe(JSON.stringify(good)).ok === true);

{
  const withVer = { ...good, versionId: "f7e2cab0-8aa7-411a-b10a-8ccbd9f40732" };
  const mismatch = evaluateStagingPostDeployHealth(withVer, {
    expectedVersionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  });
  expect("version_mismatch", mismatch.ok === false && mismatch.versionCheck === "mismatch");
  const match = evaluateStagingPostDeployHealth(withVer, {
    expectedVersionId: "f7e2cab0-8aa7-411a-b10a-8ccbd9f40732",
  });
  expect("version_match", match.ok === true && match.versionCheck === "match");
  const notExposed = evaluateStagingPostDeployHealth(good, {
    expectedVersionId: "f7e2cab0-8aa7-411a-b10a-8ccbd9f40732",
  });
  expect(
    "version_not_exposed_still_pass",
    notExposed.ok === true && notExposed.versionCheck === "not_exposed"
  );
}

// Retry: stale then good (reproduces run 39939786347 race).
{
  let n = 0;
  const seq = [staleBroken, staleBroken, good];
  const out = await runStagingPostDeployHealthRetry({
    maxAttempts: 5,
    sleepMs: 0,
    fetchHealth: async () => {
      const body = seq[Math.min(n, seq.length - 1)];
      n += 1;
      return { status: 200, body: JSON.stringify(body) };
    },
  });
  expect("retry_eventual_pass", out.ok === true && out.passedOnAttempt === 3);
  expect("retry_saw_stale_first", out.attempts[0].ok === false);
}

// Exhausted retries on persistent stale.
{
  const out = await runStagingPostDeployHealthRetry({
    maxAttempts: 3,
    sleepMs: 0,
    fetchHealth: async () => ({ status: 200, body: JSON.stringify(staleBroken) }),
  });
  expect("retry_exhausted", out.ok === false && out.reason === "retry_exhausted");
  expect("retry_exhausted_count", out.attempts.length === 3);
}

// HTTP 500
{
  const a = await attemptStagingPostDeployHealth({
    fetchHealth: async () => ({ status: 500, body: "err" }),
  });
  expect("http_500", a.ok === false && a.reasons.includes("http_not_2xx"));
}

// Timeout / fetch error
{
  const a = await attemptStagingPostDeployHealth({
    fetchHealth: async () => ({ status: 0, body: "", error: "AbortError: timeout" }),
  });
  expect("timeout", a.ok === false && a.reasons.includes("fetch_error"));
}

// Success after failures then version mismatch (exposed)
{
  let n = 0;
  const out = await runStagingPostDeployHealthRetry({
    maxAttempts: 4,
    sleepMs: 0,
    expectedVersionId: "want-v",
    fetchHealth: async () => {
      n += 1;
      if (n < 3) return { status: 200, body: JSON.stringify(staleBroken) };
      return {
        status: 200,
        body: JSON.stringify({ ...good, versionId: "other-v" }),
      };
    },
  });
  expect("wrong_version_after_heal", out.ok === false);
  expect(
    "wrong_version_reason",
    out.last.reasons.includes("version_mismatch")
  );
}

// Workflow wiring
const codeWf = fs.readFileSync(WF_CODE, "utf8");
const deployWf = fs.readFileSync(WF_DEPLOY, "utf8");
expect(
  "code_wf_uses_postdeploy_script",
  codeWf.includes("iu-cj-affiliate-staging-postdeploy-health-v1.mjs")
);
expect(
  "deploy_wf_uses_postdeploy_script",
  deployWf.includes("iu-cj-affiliate-staging-postdeploy-health-v1.mjs")
);
expect(
  "code_wf_no_curl_only_break",
  !/if curl -fsS "\$\{WORKER_URL\}\/health" > \/tmp\/health\.json; then break; fi/.test(codeWf)
);
expect("code_wf_passes_version", codeWf.includes("--expected-version-id"));

console.log(
  JSON.stringify({
    IU_CJ_STAGING_POSTDEPLOY_HEALTH_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    CJ_LIVE_HTTP_CALLS: 0,
    repro_stale_then_good: "covered",
  })
);
process.exit(failures.length ? 1 : 0);
