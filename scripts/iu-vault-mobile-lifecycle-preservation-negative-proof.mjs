#!/usr/bin/env node
/**
 * Negative proof wrapper for mobile lifecycle guard.
 * Forces empty-before-hydrate clobber path → must FAIL, then PASS without env.
 * Each child run is fail-closed with timeout (no infinite CI hang).
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(REPO, "scripts", "iu-vault-mobile-lifecycle-preservation-guard-v1.mjs");
const lifecycleUrl = pathToFileURL(path.join(REPO, "scripts/guards/guard-playwright-lifecycle.mjs")).href;
const { runGuardChildScript } = await import(lifecycleUrl);

const CHILD_TIMEOUT_MS = 180000;

async function run(envExtra) {
  const result = await runGuardChildScript(script, [], {
    env: envExtra,
    timeoutMs: CHILD_TIMEOUT_MS,
    captureOutput: true,
  });
  const out = `${result.stdout || ""}\n${result.stderr || ""}`;
  return {
    status: result.timedOut ? 124 : result.status,
    timedOut: !!result.timedOut,
    out,
  };
}

function expectFail(label, result) {
  if (result.timedOut) {
    console.error(`${label}_HUNG_TIMEOUT_${CHILD_TIMEOUT_MS}ms`);
    console.error(result.out.slice(-2000));
    process.exit(1);
  }
  if (result.status === 0 || !/IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_GUARD_FAIL/.test(result.out)) {
    console.error(`${label}_EXPECTED_FAIL_BUT_PASSED`);
    console.error(result.out);
    process.exit(1);
  }
  console.log(`${label}_FAIL_OK`);
}

const neg = await run({ IU_NEG_EMPTY_BEFORE_HYDRATE: "1" });
expectFail("IU_MOBILE_LIFECYCLE_NEGATIVE_EMPTY_WRITE", neg);

const neg2 = await run({ IU_NEG_SKIP_PAGESHOW_HYDRATE: "1" });
expectFail("IU_MOBILE_LIFECYCLE_NEGATIVE_SKIP_HYDRATE", neg2);

const neg3 = await run({ IU_NEG_SKIP_FLUSH: "1" });
expectFail("IU_MOBILE_LIFECYCLE_NEGATIVE_SKIP_FLUSH", neg3);

const neg4 = await run({ IU_NEG_ALLOW_HYDRATION_EMPTY: "1" });
expectFail("IU_MOBILE_LIFECYCLE_NEGATIVE_HYDRATION_EMPTY", neg4);

const pos = await run({});
if (pos.timedOut) {
  console.error(`POSITIVE_HUNG_TIMEOUT_${CHILD_TIMEOUT_MS}ms`);
  console.error(pos.out.slice(-2000));
  process.exit(1);
}
if (pos.status !== 0 || !/IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_GUARD_PASS/.test(pos.out)) {
  console.error("POSITIVE_EXPECTED_PASS_BUT_FAILED");
  console.error(pos.out);
  process.exit(1);
}
console.log("IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_NEGATIVE_PROOF_PASS");
process.exit(0);
