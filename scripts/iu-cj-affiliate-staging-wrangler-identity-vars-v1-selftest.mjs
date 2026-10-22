#!/usr/bin/env node
/**
 * Offline: staging wrangler.toml must declare publisher CID + website PID (non-secret).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = path.join(REPO, "cloudflare", "cj-email-ingest-d1-worker", "wrangler.toml");
const EXPECT_CID = "7667828";
const EXPECT_PID = "101883843";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const toml = fs.readFileSync(WRANGLER, "utf8");
expect("has_staging_env", toml.includes("[env.staging]"));
expect("has_publisher_cid_key", /IU_CJ_PUBLISHER_CID\s*=\s*"/.test(toml));
expect("has_website_pid_key", /IU_CJ_WEBSITE_PID\s*=\s*"/.test(toml));
expect("cid_value", toml.includes(`IU_CJ_PUBLISHER_CID = "${EXPECT_CID}"`));
expect("pid_value", toml.includes(`IU_CJ_WEBSITE_PID = "${EXPECT_PID}"`));
expect("cid_not_pid", !toml.includes(`IU_CJ_PUBLISHER_CID = "${EXPECT_PID}"`));
expect("pid_not_cid", !toml.includes(`IU_CJ_WEBSITE_PID = "${EXPECT_CID}"`));
expect("no_pat_in_vars", !/CJ_API_PAT\s*=/.test(toml));
expect("no_ingest_token_in_vars", !/IU_CJ_D1_WORKER_INGEST_TOKEN\s*=/.test(toml));

const stagingBlock = toml.split("[env.staging]")[1]?.split("[[env.staging.d1_databases]]")[0] || "";
expect("vars_in_staging_block", stagingBlock.includes("IU_CJ_PUBLISHER_CID") && stagingBlock.includes("IU_CJ_WEBSITE_PID"));

const deployWf = fs.readFileSync(
  path.join(REPO, ".github", "workflows", "cj-affiliate-staging-worker-deploy.yml"),
  "utf8"
);
expect("deploy_wf_checks_cid", deployWf.includes("IU_CJ_PUBLISHER_CID"));

console.log(
  JSON.stringify({
    IU_CJ_STAGING_WRANGLER_IDENTITY_VARS_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    CJ_PUBLISHER_CID_CONFIG: failures.length ? "FAIL" : "PASS",
    CJ_WEBSITE_PID_CONFIG: failures.length ? "FAIL" : "PASS",
  })
);
process.exit(failures.length ? 1 : 0);
