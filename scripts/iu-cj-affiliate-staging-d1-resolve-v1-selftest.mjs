#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLACEHOLDER_D1_ID,
  STAGING_D1_NAME,
  patchWranglerStagingD1DatabaseId,
  resolveStagingD1IdFromList,
} from "./iu-cj-affiliate-staging-d1-resolve-v1.mjs";
import { parseWranglerStagingConfig } from "./iu-cj-affiliate-phase2-staging-env-guard-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = path.join(REPO, "cloudflare", "cj-email-ingest-d1-worker", "wrangler.toml");
const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const realId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
expect("zero_matches", resolveStagingD1IdFromList([]).ok === false);
expect("ambiguous", resolveStagingD1IdFromList([{ name: STAGING_D1_NAME, uuid: realId }, { name: STAGING_D1_NAME, uuid: realId }]).reason === "d1_ambiguous");
expect("one_match", resolveStagingD1IdFromList([{ name: STAGING_D1_NAME, uuid: realId }]).id === realId);
expect("reject_placeholder", resolveStagingD1IdFromList([{ name: STAGING_D1_NAME, uuid: PLACEHOLDER_D1_ID }]).ok === false);

const toml = fs.readFileSync(WRANGLER, "utf8");
expect("repo_placeholder_staging_block", toml.includes(PLACEHOLDER_D1_ID));
const patched = patchWranglerStagingD1DatabaseId(toml, realId);
expect("patch_ok", patched.ok === true && patched.changed === true);
expect("patch_only_staging_env", (patched.text.match(/database_id = "/g) || []).length === 2);
expect("top_level_still_placeholder", patched.text.includes(`database_id = "${PLACEHOLDER_D1_ID}"`));
expect("staging_block_has_real_id", patched.text.includes(`database_id = "${realId}"`));
const repatch = patchWranglerStagingD1DatabaseId(patched.text, realId);
expect("patch_idempotent", repatch.ok === true && repatch.reason === "already_patched" && repatch.changed === false);
const badRepatch = patchWranglerStagingD1DatabaseId(patched.text, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
expect("patch_reject_mismatch", badRepatch.ok === false && badRepatch.reason === "d1_id_mismatch");

const cfg = parseWranglerStagingConfig(toml);
expect("guard_allows_placeholder_in_repo", cfg.d1DatabaseId === PLACEHOLDER_D1_ID);

const wf = fs.readFileSync(
  path.join(REPO, ".github", "workflows", "cj-affiliate-staging-worker-deploy.yml"),
  "utf8"
);
expect("deploy_wf_resolves_d1", /Resolve staging D1 database_id/.test(wf));
expect("deploy_wf_no_secret_put", !/secret put (IU_CJ|CJ_API)/i.test(wf));
expect("deploy_wf_uses_d1_list", /d1 list --json/.test(wf));
expect("deploy_wf_no_d1_create", !/d1 create/i.test(wf));

const probeWf = fs.readFileSync(
  path.join(REPO, ".github", "workflows", "cj-affiliate-staging-cj-api-probe-once.yml"),
  "utf8"
);
expect("probe_wf_disarm_job", /disarm-failsafe:/.test(probeWf));
expect("probe_wf_patch_before_arm", /Patch staging D1 id \(arm deploy\)/.test(probeWf));
expect("probe_wf_patch_before_disarm", /Patch staging D1 id \(disarm deploy\)/.test(probeWf));
expect("probe_wf_live_default_off", /execute_live_cj_probe[\s\S]*default:\s*["']0["']/.test(probeWf));
expect("probe_wf_no_d1_create", !/d1 create/i.test(probeWf));

console.log(
  JSON.stringify({
    IU_CJ_STAGING_D1_RESOLVE_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
