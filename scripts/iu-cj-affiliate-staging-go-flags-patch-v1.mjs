#!/usr/bin/env node
/**
 * Patch cloudflare/cj-email-ingest-d1-worker/wrangler.toml [env.staging.vars] GO flags.
 * Usage:
 *   node scripts/iu-cj-affiliate-staging-go-flags-patch-v1.mjs --mode disarm
 *   node scripts/iu-cj-affiliate-staging-go-flags-patch-v1.mjs --mode arm --lock-key link_search_coupon_v2
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEnvStagingVarsPatch,
  buildArmedStagingGoVars,
  ensureEnvStagingVarsTable,
  parseEnvStagingVars,
  resolveAllowedProbeLockKey,
  STAGING_GO_DISARMED_VARS,
} from "./iu-cj-affiliate-staging-go-flags-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TOML = path.join(REPO, "cloudflare/cj-email-ingest-d1-worker/wrangler.toml");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

function main() {
  const mode = String(argValue("--mode") || "").trim();
  const tomlPath = path.resolve(argValue("--toml") || DEFAULT_TOML);
  if (mode !== "arm" && mode !== "disarm") {
    console.log("CJ_GO_FLAGS_PATCH=FAIL");
    console.log("CJ_GO_FLAGS_PATCH_REASON=mode_must_be_arm_or_disarm");
    process.exit(1);
  }

  let text = fs.readFileSync(tomlPath, "utf8");
  text = ensureEnvStagingVarsTable(text);

  let patch;
  if (mode === "disarm") {
    patch = { ...STAGING_GO_DISARMED_VARS };
  } else {
    const lockRaw = argValue("--lock-key");
    const resolved = resolveAllowedProbeLockKey(lockRaw);
    if (!resolved.ok) {
      console.log("CJ_GO_FLAGS_PATCH=FAIL");
      console.log("CJ_GO_FLAGS_PATCH_REASON=" + resolved.reason);
      process.exit(1);
    }
    patch = buildArmedStagingGoVars(resolved.lockKey);
  }

  const next = applyEnvStagingVarsPatch(text, patch);
  fs.writeFileSync(tomlPath, next, "utf8");
  const parsed = parseEnvStagingVars(next);
  console.log("CJ_GO_FLAGS_PATCH=PASS");
  console.log("CJ_GO_FLAGS_MODE=" + mode);
  console.log("CJ_GO_FLAGS_APPROVED=" + (parsed.IU_CJ_STAGING_CJ_API_PROBE_APPROVED || ""));
  console.log("CJ_GO_FLAGS_HTTP_EXECUTE=" + (parsed.IU_CJ_CJ_API_HTTP_EXECUTE || ""));
  console.log("CJ_GO_FLAGS_PROBE_EXECUTE=" + (parsed.IU_CJ_STAGING_CJ_API_PROBE_EXECUTE || ""));
  console.log("CJ_GO_FLAGS_LOCK_KEY=" + (parsed.IU_CJ_STAGING_PROBE_LOCK_KEY || ""));
  console.log("CJ_GO_FLAGS_SOURCE=toml_env_staging_vars");
}

main();
