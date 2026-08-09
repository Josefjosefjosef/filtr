#!/usr/bin/env node
/**
 * Mutation meta-fixtures for Variant A shared-write job graph.
 * Re-introducing the broken candidate_ready eligibility gate MUST fail the contract.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jobChunk } from "./ndic-staging-preflight-architecture-fixtures.mjs";
import {
  assertSharedWriteJobGraphContract,
  sharedWriteIfRegion,
  usesCandidateReadyForJobEligibility,
  usesPrepResultForJobEligibility,
} from "./ndic-shared-write-job-graph.mjs";
import { assertAutomaticScheduleContract } from "./ndic-automatic-schedule-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");

const fails = [];
let pass = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else pass += 1;
}

const src = fs.readFileSync(WF, "utf8");
ok("baseline_contract", assertSharedWriteJobGraphContract(src).ok);

function mutateMustFailContract(id, mutateFn) {
  const mutated = mutateFn(src);
  const result = assertSharedWriteJobGraphContract(mutated);
  ok(id, result.ok === false, result.ok ? "FALSE_GREEN" : (result.fails || []).slice(0, 4).join("|"));
}

// OLD broken gate mutation: re-add candidate_ready to job-level if.
mutateMustFailContract("OLD_BROKEN_GATE_MUTATION_DETECTED", (s) => {
  const region = sharedWriteIfRegion(s);
  const injected = region.replace(
    /needs\.ndic-prep\.result == 'success'\n/,
    "needs.ndic-prep.result == 'success'\n      && needs.ndic-prep.outputs.candidate_ready == 'true'\n"
  );
  ok(
    "mutation_injected_candidate_ready",
    usesCandidateReadyForJobEligibility(s.replace(region, injected))
  );
  return s.replace(region, injected);
});

// Remove prep success gate.
mutateMustFailContract("PREP_SUCCESS_GATE_REMOVAL_DETECTED", (s) => {
  const region = sharedWriteIfRegion(s);
  const injected = region.replace(/\s*&& needs\.ndic-prep\.result == 'success'/, "");
  ok(
    "mutation_removed_prep_result",
    !usesPrepResultForJobEligibility(s.replace(region, injected))
  );
  return s.replace(region, injected);
});

// Remove in-job candidate validation.
mutateMustFailContract("CANDIDATE_VALIDATION_REMOVAL_DETECTED", (s) =>
  s.replace(/ndic-validate-shared-write-candidate\.mjs/g, "echo-skip-validate.mjs")
);

// Disarmed schedule bypass via schedule-gate arming variable.
{
  const mutated = src.replace(/vars\.NDIC_AUTOMATION_ENABLED/g, "'true'");
  const result = assertAutomaticScheduleContract(mutated);
  ok(
    "DISARMED_SCHEDULE_BYPASS_DETECTED",
    result.ok === false,
    result.ok ? "FALSE_GREEN" : (result.fails || []).slice(0, 3).join("|")
  );
}

// Scheduled ACTIVE without valid preflight (prep ignores scheduled-preflight success).
{
  const mutated = src.replace(/&& needs\.scheduled-preflight\.result == 'success'/, "");
  const result = assertAutomaticScheduleContract(mutated);
  ok(
    "SCHEDULE_PREFLIGHT_BYPASS_DETECTED",
    result.ok === false,
    result.ok ? "FALSE_GREEN" : (result.fails || []).slice(0, 3).join("|")
  );
}

// Manual ACTIVE without attestation verification.
{
  const mutated = src.replace(
    /ndic-verify-preflight-attestation\.mjs/g,
    "echo-skip-verify.mjs"
  );
  const prep = jobChunk(mutated, "ndic-prep");
  ok(
    "MANUAL_PREFLIGHT_BYPASS_DETECTED",
    !/ndic-verify-preflight-attestation\.mjs/.test(prep),
    "verify-still-present"
  );
  const result = assertAutomaticScheduleContract(mutated);
  ok(
    "MANUAL_PREFLIGHT_BYPASS_CONTRACT_FAILS",
    result.ok === false,
    result.ok ? "FALSE_GREEN" : (result.fails || []).slice(0, 3).join("|")
  );
}

const report = {
  suite: "NDIC_SHARED_WRITE_IF_META_FIXTURES",
  OLD_BROKEN_GATE_MUTATION_DETECTED: fails.some((f) =>
    f.startsWith("OLD_BROKEN_GATE_MUTATION_DETECTED")
  )
    ? "NO"
    : "YES",
  PREP_SUCCESS_GATE_REMOVAL_DETECTED: fails.some((f) =>
    f.startsWith("PREP_SUCCESS_GATE_REMOVAL_DETECTED")
  )
    ? "NO"
    : "YES",
  DISARMED_SCHEDULE_BYPASS_DETECTED: fails.some((f) =>
    f.startsWith("DISARMED_SCHEDULE_BYPASS_DETECTED")
  )
    ? "NO"
    : "YES",
  SCHEDULE_PREFLIGHT_BYPASS_DETECTED: fails.some((f) =>
    f.startsWith("SCHEDULE_PREFLIGHT_BYPASS_DETECTED")
  )
    ? "NO"
    : "YES",
  MANUAL_PREFLIGHT_BYPASS_DETECTED: fails.some(
    (f) =>
      f.startsWith("MANUAL_PREFLIGHT_BYPASS_DETECTED") ||
      f.startsWith("MANUAL_PREFLIGHT_BYPASS_CONTRACT_FAILS")
  )
    ? "NO"
    : "YES",
  MUTATION_TEST_PASS: fails.length === 0 ? "YES" : "NO",
  total: pass + fails.length,
  success: pass,
  failure: fails.length,
  fails,
};

if (fails.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
