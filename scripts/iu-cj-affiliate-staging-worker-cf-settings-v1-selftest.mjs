#!/usr/bin/env node
import {
  STAGING_IDENTITY_VAR_NAMES,
  auditStagingWorkerIdentityFromCfSettings,
  bindingTypesIncludeSecrets,
  countBindingTypes,
  extractPlainTextBindingsFromCfSettingsPayload,
} from "./iu-cj-affiliate-staging-worker-cf-settings-lib.mjs";
import {
  PLACEHOLDER_D1_ID,
  STAGING_D1_NAME,
  patchWranglerStagingD1DatabaseId,
  readStagingBlockDatabaseId,
  resolveStagingD1IdFromList,
} from "./iu-cj-affiliate-staging-d1-resolve-v1.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = path.join(REPO, "cloudflare", "cj-email-ingest-d1-worker", "wrangler.toml");
const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const realId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const toml = fs.readFileSync(WRANGLER, "utf8");
const first = patchWranglerStagingD1DatabaseId(toml, realId);
expect("d1_first_patch", first.ok === true && first.changed === true);
const second = patchWranglerStagingD1DatabaseId(first.text, realId);
expect("d1_second_patch_idempotent", second.ok === true && second.reason === "already_patched" && second.changed === false);
const third = patchWranglerStagingD1DatabaseId(second.text, realId);
expect("d1_third_patch_idempotent", third.ok === true && third.reason === "already_patched");

const wrongId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const mismatch = patchWranglerStagingD1DatabaseId(first.text, wrongId);
expect("d1_wrong_id_rejected", mismatch.ok === false && mismatch.reason === "d1_id_mismatch");

expect("d1_read_staging_id", readStagingBlockDatabaseId(first.text).id === realId);

expect("d1_zero_matches", resolveStagingD1IdFromList([]).ok === false);
expect("d1_ambiguous", resolveStagingD1IdFromList([{ name: STAGING_D1_NAME, uuid: realId }, { name: STAGING_D1_NAME, uuid: realId }]).ok === false);

const cfOk = {
  success: true,
  result: {
    bindings: [
      { name: STAGING_IDENTITY_VAR_NAMES.publisherCid, type: "plain_text", text: "7667828" },
      { name: STAGING_IDENTITY_VAR_NAMES.websitePid, type: "plain_text", text: "101883843" },
      { name: "CJ_API_PAT", type: "secret_text" },
    ],
  },
};
expect("cf_parse_ok", extractPlainTextBindingsFromCfSettingsPayload(cfOk).ok === true);
expect(
  "cf_audit_pass",
  auditStagingWorkerIdentityFromCfSettings(cfOk, { publisherCid: "7667828", websitePid: "101883843" }).ok === true
);

const cfLegacyValueField = {
  success: true,
  result: {
    bindings: [{ name: STAGING_IDENTITY_VAR_NAMES.publisherCid, type: "PlainText", value: "7667828" }],
  },
};
expect("cf_legacy_value_field", extractPlainTextBindingsFromCfSettingsPayload(cfLegacyValueField).ok === true);

const cfMissingBindings = { success: true, result: { compatibility_date: "2024-01-01" } };
expect("cf_bindings_missing", extractPlainTextBindingsFromCfSettingsPayload(cfMissingBindings).ok === false);

const cfApiFail = { success: false, errors: [{ code: 10000, message: "auth" }] };
expect("cf_api_fail", auditStagingWorkerIdentityFromCfSettings(cfApiFail, {}).cjCfSettingsApi === "FAIL");

const cfMissingCid = {
  success: true,
  result: { bindings: [{ name: STAGING_IDENTITY_VAR_NAMES.websitePid, type: "plain_text", text: "101883843" }] },
};
const missCid = auditStagingWorkerIdentityFromCfSettings(cfMissingCid, { publisherCid: "7667828", websitePid: "101883843" });
expect("cf_missing_cid", missCid.publisherCid === "MISSING" && !missCid.ok);

const cfSwapped = {
  success: true,
  result: {
    bindings: [
      { name: STAGING_IDENTITY_VAR_NAMES.publisherCid, type: "plain_text", text: "101883843" },
      { name: STAGING_IDENTITY_VAR_NAMES.websitePid, type: "plain_text", text: "7667828" },
    ],
  },
};
expect("cf_swapped", auditStagingWorkerIdentityFromCfSettings(cfSwapped, { publisherCid: "7667828", websitePid: "101883843" }).swapped === true);

const cfWrongResultFallback = {
  success: true,
  result: { bindings: "not-array" },
};
expect("cf_bindings_not_array", extractPlainTextBindingsFromCfSettingsPayload(cfWrongResultFallback).reason === "bindings_not_array");

expect("cf_no_secret_dump", bindingTypesIncludeSecrets(cfOk) === true);
const summary = countBindingTypes(cfOk);
expect("cf_summary_safe", summary.parseOk === true && summary.plainTextCount === 2);

const wf = fs.readFileSync(
  path.join(REPO, ".github", "workflows", "cj-affiliate-staging-cj-api-probe-once.yml"),
  "utf8"
);
expect("wf_uses_cf_audit_script", wf.includes("iu-cj-affiliate-staging-worker-identity-cf-audit-v1.mjs"));

console.log(
  JSON.stringify({
    IU_CJ_STAGING_WORKER_CF_SETTINGS_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    CJ_D1_RESOLVER_IDEMPOTENT: failures.length ? "FAIL" : "PASS",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
