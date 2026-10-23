#!/usr/bin/env node
/**
 * Offline regression: dual-source GO flags failure mode + toml-authoritative arm/disarm patch.
 * No live CJ HTTP. No D1 writes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEnvStagingVarsPatch,
  buildArmedStagingGoVars,
  diagnoseGoFlagsSourceOfTruth,
  ensureEnvStagingVarsTable,
  parseEnvStagingVars,
  resolveAllowedProbeLockKey,
  STAGING_GO_DISARMED_VARS,
} from "./iu-cj-affiliate-staging-go-flags-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF_PROBE = path.join(REPO, ".github/workflows/cj-affiliate-staging-cj-api-probe-once.yml");
const WF_CODE = path.join(REPO, ".github/workflows/cj-affiliate-staging-worker-code-deploy-keep-vars.yml");
const WF_DEPLOY = path.join(REPO, ".github/workflows/cj-affiliate-staging-worker-deploy.yml");
const TOML = path.join(REPO, "cloudflare/cj-email-ingest-d1-worker/wrangler.toml");

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const legacyInline = `# test
[env.staging]
name = "iu-cj-email-ingest-d1-staging"
account_id = "577868e9aac9c289e9323100f68fad16"
vars = { ENVIRONMENT = "staging", IU_CJ_STAGING_ONLY = "1", CJ_STAGING_ARCHIVE_ONLY = "1", IU_CJ_PUBLISHER_CID = "7667828", IU_CJ_WEBSITE_PID = "101883843" }

[[env.staging.d1_databases]]
binding = "DB"
database_name = "iu-cj-email-ingest-staging"
database_id = "00000000-0000-0000-0000-000000000000"
`;

const converted = ensureEnvStagingVarsTable(legacyInline);
expect("converts_inline_to_table", /\[env\.staging\.vars\]/.test(converted));
expect("no_inline_vars_left", !/vars\s*=\s*\{/.test(converted));

const legacyVars = parseEnvStagingVars(converted);
const diagLegacy = diagnoseGoFlagsSourceOfTruth(legacyVars, {
  usedKeepVarsCli: true,
  usedVarCliForGo: true,
});
expect("repro_dual_source_detected", diagLegacy.dualSource === true);
expect("repro_missing_go_in_toml", diagLegacy.missingInToml.length === 3);

const disarmedToml = applyEnvStagingVarsPatch(converted, STAGING_GO_DISARMED_VARS);
const disarmedVars = parseEnvStagingVars(disarmedToml);
expect("disarm_approved_0", disarmedVars.IU_CJ_STAGING_CJ_API_PROBE_APPROVED === "0");
expect("disarm_http_0", disarmedVars.IU_CJ_CJ_API_HTTP_EXECUTE === "0");
expect("disarm_exec_0", disarmedVars.IU_CJ_STAGING_CJ_API_PROBE_EXECUTE === "0");
expect("disarm_lock_v1", disarmedVars.IU_CJ_STAGING_PROBE_LOCK_KEY === "link_search_coupon_v1");

const armedToml = applyEnvStagingVarsPatch(disarmedToml, buildArmedStagingGoVars("link_search_coupon_v2"));
const armedVars = parseEnvStagingVars(armedToml);
expect("arm_approved_1", armedVars.IU_CJ_STAGING_CJ_API_PROBE_APPROVED === "1");
expect("arm_http_1", armedVars.IU_CJ_CJ_API_HTTP_EXECUTE === "1");
expect("arm_exec_1", armedVars.IU_CJ_STAGING_CJ_API_PROBE_EXECUTE === "1");
expect("arm_lock_v2", armedVars.IU_CJ_STAGING_PROBE_LOCK_KEY === "link_search_coupon_v2");
expect("arm_preserves_cid", armedVars.IU_CJ_PUBLISHER_CID === "7667828");

const diagArmed = diagnoseGoFlagsSourceOfTruth(armedVars, {
  usedKeepVarsCli: false,
  usedVarCliForGo: false,
});
expect("toml_authoritative_when_complete", diagArmed.dualSource === false);

expect("reject_empty_lock", resolveAllowedProbeLockKey("").ok === false);
expect("reject_unknown_lock", resolveAllowedProbeLockKey("link_search_coupon_v3").ok === false);
expect("allow_v2", resolveAllowedProbeLockKey("link_search_coupon_v2").ok === true);

// Concurrent arm/disarm simulation: last writer wins; disarm must clear GO.
const raced = applyEnvStagingVarsPatch(
  applyEnvStagingVarsPatch(disarmedToml, buildArmedStagingGoVars("link_search_coupon_v2")),
  STAGING_GO_DISARMED_VARS
);
const racedVars = parseEnvStagingVars(raced);
expect("race_disarm_wins_go_off", racedVars.IU_CJ_STAGING_CJ_API_PROBE_APPROVED === "0");
expect("race_disarm_wins_lock_v1", racedVars.IU_CJ_STAGING_PROBE_LOCK_KEY === "link_search_coupon_v1");

// Regression: [[array.table]] headers must bound vars body (else D1/R2 become plain env vars).
const withArrayTables = `${disarmedToml}
[[env.staging.d1_databases]]
binding = "DB"
database_name = "iu-cj-email-ingest-staging"
database_id = "888be87f-3ef1-43c4-9f4c-d21e306d0465"
migrations_dir = "migrations"

[[env.staging.r2_buckets]]
binding = "BANNER_ASSETS"
bucket_name = "iu-cj-banner-assets-staging"
preview_bucket_name = "iu-cj-banner-assets-staging-preview"
`;
const patchedKeepBindings = applyEnvStagingVarsPatch(
  withArrayTables,
  buildArmedStagingGoVars("link_search_coupon_v2")
);
expect("preserves_d1_array_header", /\[\[env\.staging\.d1_databases\]\]/.test(patchedKeepBindings));
expect("preserves_r2_array_header", /\[\[env\.staging\.r2_buckets\]\]/.test(patchedKeepBindings));
const patchedVarsOnly = parseEnvStagingVars(patchedKeepBindings);
expect("does_not_promote_binding_to_vars", patchedVarsOnly.binding === undefined);
expect("does_not_promote_database_id_to_vars", patchedVarsOnly.database_id === undefined);
expect("does_not_promote_bucket_name_to_vars", patchedVarsOnly.bucket_name === undefined);
expect("arm_still_sets_lock_with_bindings", patchedVarsOnly.IU_CJ_STAGING_PROBE_LOCK_KEY === "link_search_coupon_v2");
// Legacy single-bracket-only next-header would swallow [[...]] — prove detection works.
expect(
  "array_header_regex_matches",
  /^\[{1,2}[^\[\]]+\]{1,2}\s*$/m.test("[[env.staging.d1_databases]]")
);
expect(
  "legacy_single_bracket_misses_array",
  !/^\[[^\]]+\]\s*$/m.test("[[env.staging.d1_databases]]")
);

// Repo wrangler.toml must already be table + disarmed defaults.
const repoToml = fs.readFileSync(TOML, "utf8");
expect("repo_has_staging_vars_table", /\[env\.staging\.vars\]/.test(repoToml));
const repoVars = parseEnvStagingVars(repoToml);
expect("repo_go_approved_0", repoVars.IU_CJ_STAGING_CJ_API_PROBE_APPROVED === "0");
expect("repo_go_http_0", repoVars.IU_CJ_CJ_API_HTTP_EXECUTE === "0");
expect("repo_go_exec_0", repoVars.IU_CJ_STAGING_CJ_API_PROBE_EXECUTE === "0");
expect("repo_lock_default_v1", repoVars.IU_CJ_STAGING_PROBE_LOCK_KEY === "link_search_coupon_v1");
expect("repo_has_d1_array", /\[\[env\.staging\.d1_databases\]\]/.test(repoToml));
expect("repo_has_r2_array", /\[\[env\.staging\.r2_buckets\]\]/.test(repoToml));
const repoDisarmed = applyEnvStagingVarsPatch(repoToml, STAGING_GO_DISARMED_VARS);
expect("repo_disarm_keeps_d1", /\[\[env\.staging\.d1_databases\]\]/.test(repoDisarmed));
expect("repo_disarm_keeps_r2", /\[\[env\.staging\.r2_buckets\]\]/.test(repoDisarmed));
expect("repo_disarm_vars_no_binding", parseEnvStagingVars(repoDisarmed).binding === undefined);

const probeWf = fs.readFileSync(WF_PROBE, "utf8");
const codeWf = fs.readFileSync(WF_CODE, "utf8");
const deployWf = fs.readFileSync(WF_DEPLOY, "utf8");
expect("probe_uses_shared_concurrency", /group:\s*cj-affiliate-staging-worker-mutate/.test(probeWf));
expect("code_uses_shared_concurrency", /group:\s*cj-affiliate-staging-worker-mutate/.test(codeWf));
expect("deploy_uses_shared_concurrency", /group:\s*cj-affiliate-staging-worker-mutate/.test(deployWf));
expect("probe_arm_uses_toml_patch", probeWf.includes("iu-cj-affiliate-staging-go-flags-patch-v1.mjs"));
expect("probe_arm_no_keep_vars_go", !/deploy --env staging --keep-vars[\s\S]*IU_CJ_STAGING_CJ_API_PROBE_APPROVED:1/.test(probeWf));
expect("probe_disarm_uses_toml_patch", /go-flags-patch-v1\.mjs --mode disarm/.test(probeWf));
expect("code_deploy_no_keep_vars", !/wrangler@4 deploy --env staging --keep-vars/.test(codeWf));

// Temp file round-trip via patcher CLI
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-go-flags-"));
const tmpToml = path.join(tmp, "wrangler.toml");
fs.writeFileSync(tmpToml, legacyInline, "utf8");
const { spawnSync } = await import("node:child_process");
const arm = spawnSync(
  process.execPath,
  [
    path.join(REPO, "scripts/iu-cj-affiliate-staging-go-flags-patch-v1.mjs"),
    "--mode",
    "arm",
    "--lock-key",
    "link_search_coupon_v2",
    "--toml",
    tmpToml,
  ],
  { encoding: "utf8" }
);
expect("cli_arm_exit_0", arm.status === 0);
expect("cli_arm_pass", /CJ_GO_FLAGS_PATCH=PASS/.test(arm.stdout || ""));
const afterArm = parseEnvStagingVars(fs.readFileSync(tmpToml, "utf8"));
expect("cli_arm_lock_v2", afterArm.IU_CJ_STAGING_PROBE_LOCK_KEY === "link_search_coupon_v2");
const disarm = spawnSync(
  process.execPath,
  [path.join(REPO, "scripts/iu-cj-affiliate-staging-go-flags-patch-v1.mjs"), "--mode", "disarm", "--toml", tmpToml],
  { encoding: "utf8" }
);
expect("cli_disarm_exit_0", disarm.status === 0);
const afterDisarm = parseEnvStagingVars(fs.readFileSync(tmpToml, "utf8"));
expect("cli_disarm_go_off", afterDisarm.IU_CJ_STAGING_CJ_API_PROBE_APPROVED === "0");

console.log(
  JSON.stringify({
    IU_CJ_STAGING_GO_FLAGS_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    dualSourceRepro: diagLegacy.dualSource,
    CJ_LIVE_HTTP_CALLS: 0,
  })
);
process.exit(failures.length ? 1 : 0);
