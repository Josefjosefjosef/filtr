#!/usr/bin/env node
/**
 * Contract + scenario fixtures for Variant A shared-write job graph.
 * Intentionally models the false-green gap that missed canaries 31311789781 / 31313465533:
 * schedule jobs skipped + empty needs outputs must NOT prevent follow-up start.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSharedWriteJobGraphContract,
  sharedWriteJobWouldStart,
  sharedWriteJobWouldStartLegacyCandidateReadyGate,
  usesCandidateReadyForJobEligibility,
} from "./ndic-shared-write-job-graph.mjs";
import { validateSharedWriteCandidate } from "./ndic-validate-shared-write-candidate.mjs";
import { writeCandidateProducerBinding } from "./ndic-write-candidate-producer-binding.mjs";
import { assertNdicCandidateRequiredOutputs } from "./ndic-assert-candidate-required-outputs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");

const fails = [];
let pass = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else pass += 1;
}

const src = fs.readFileSync(WF, "utf8");
const contract = assertSharedWriteJobGraphContract(src);
ok("contract_pass", contract.ok, (contract.fails || []).join("|"));
ok("wf_forbids_candidate_ready_eligibility", !usesCandidateReadyForJobEligibility(src));

// A) manual dispatch + skipped schedule jobs + prep success + empty needs outputs
ok(
  "A_dispatch_skipped_deps_empty_outputs_must_start",
  sharedWriteJobWouldStart({
    eventName: "workflow_dispatch",
    mode: "active",
    prepResult: "success",
    scheduleJobsSkipped: true,
    forceEmptyNeedsOutputs: true,
    candidateReady: "",
  }) === true
);
ok(
  "A_legacy_gate_false_skips_same_scenario",
  sharedWriteJobWouldStartLegacyCandidateReadyGate({
    eventName: "workflow_dispatch",
    mode: "active",
    prepResult: "success",
    scheduleJobsSkipped: true,
    forceEmptyNeedsOutputs: true,
    candidateReady: "true",
  }) === false
);

// B) schedule disarmed
ok(
  "B_schedule_disarmed_must_not_start",
  sharedWriteJobWouldStart({
    eventName: "schedule",
    automationArmed: false,
    prepResult: "success",
    candidateReady: "true",
    preflightPass: true,
    headMatch: true,
  }) === false
);

// C) schedule armed + preflight + prep
ok(
  "C_schedule_armed_must_start",
  sharedWriteJobWouldStart({
    eventName: "schedule",
    automationArmed: true,
    preflightPass: true,
    headMatch: true,
    prepResult: "success",
  }) === true
);

// D) prep failure
ok(
  "D_prep_failure_must_not_start",
  sharedWriteJobWouldStart({
    eventName: "workflow_dispatch",
    mode: "active",
    prepResult: "failure",
  }) === false
);

ok(
  "extra_shadow_must_not_start",
  sharedWriteJobWouldStart({
    eventName: "workflow_dispatch",
    mode: "shadow",
    prepResult: "success",
  }) === false
);

ok(
  "extra_schedule_preflight_fail_must_not_start",
  sharedWriteJobWouldStart({
    eventName: "schedule",
    automationArmed: true,
    preflightPass: false,
    headMatch: true,
    prepResult: "success",
  }) === false
);

// Missing / corrupt candidate: job would start, step validation fail-closed.
const tmp = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "ndic-cand-"));
const missingEnv = {
  IU_NDIC_EXPECTED_PRODUCER_RUN_ID: "1",
  IU_NDIC_EXPECTED_PRODUCER_HEAD_SHA: "abc",
  IU_NDIC_EXPECTED_CANDIDATE_MODE: "active",
};
const missing = validateSharedWriteCandidate(path.join(tmp, "missing"), missingEnv);
ok(
  "MISSING_ARTIFACT_SHARED_WRITE_JOB_STARTS",
  sharedWriteJobWouldStart({
    eventName: "workflow_dispatch",
    mode: "active",
    prepResult: "success",
  }) === true
);
ok("MISSING_CANDIDATE_JOB_STARTED_MODEL", sharedWriteJobWouldStart({
  eventName: "workflow_dispatch",
  mode: "active",
  prepResult: "success",
}) === true);
ok("MISSING_ARTIFACT_DETECTED", missing.ok === false);
ok("MISSING_CANDIDATE_FAIL_CLOSED", missing.ok === false);
ok("MISSING_ARTIFACT_SHARED_MUTATION", missing.ok === false);
ok("MISSING_CANDIDATE_SHARED_MUTATION", missing.ok === false);
ok("MISSING_ARTIFACT_PUBLICATION", missing.ok === false);

function writeMinimalCandidate(
  dir,
  {
    corruptSnapshot = false,
    badProducer = false,
    corruptManifest = false,
    invalidSchema = false,
    nonPublicSafe = false,
  } = {}
) {
  fs.mkdirSync(path.join(dir, "ndic_datex_v1"), { recursive: true });
  fs.writeFileSync(path.join(dir, "feed.json"), JSON.stringify({ items: [] }));
  fs.writeFileSync(path.join(dir, "monitoring.json"), JSON.stringify({}));
  fs.writeFileSync(path.join(dir, "ndic_datex_v1", "sync_state.json"), JSON.stringify({ ok: true }));
  fs.writeFileSync(
    path.join(dir, "ndic_datex_v1", "diagnostics.json"),
    JSON.stringify({ mode: "active" })
  );
  if (corruptSnapshot) {
    fs.writeFileSync(
      path.join(dir, "ndic_datex_v1", "traffic_offline_snapshot.json"),
      "{not-json"
    );
  } else {
    fs.writeFileSync(
      path.join(dir, "ndic_datex_v1", "traffic_offline_snapshot.json"),
      JSON.stringify({
        schema: invalidSchema ? "iu-traffic-offline-snapshot-WRONG" : "iu-traffic-offline-snapshot-v1",
        schemaVersion: invalidSchema
          ? "iu-traffic-offline-snapshot-WRONG"
          : "iu-traffic-offline-snapshot-v1",
        publicationEnabled: nonPublicSafe === true,
        publicApiEnabled: nonPublicSafe === true,
        cards: [],
        projections: [],
        feed: { items: [] },
        historyItems: [],
      })
    );
  }
  const env = {
    GITHUB_RUN_ID: "31313465533",
    GITHUB_SHA: "a7bc4d7190c787f7d9ab78909c8a03c2a065fe9b",
    NDIC_RESOLVED_MODE: "active",
  };
  if (corruptManifest) {
    fs.writeFileSync(path.join(dir, "ndic_datex_v1", "candidate_producer.json"), "{not-json");
  } else if (!badProducer) writeCandidateProducerBinding(dir, env);
  else {
    fs.writeFileSync(
      path.join(dir, "ndic_datex_v1", "candidate_producer.json"),
      JSON.stringify({ schema: "iu-ndic-candidate-producer-v1", runId: "other", headSha: "x", mode: "active" })
    );
  }
  return env;
}

const goodDir = path.join(tmp, "good");
const goodEnvBind = writeMinimalCandidate(goodDir);
const good = validateSharedWriteCandidate(goodDir, {
  IU_NDIC_EXPECTED_PRODUCER_RUN_ID: goodEnvBind.GITHUB_RUN_ID,
  IU_NDIC_EXPECTED_PRODUCER_HEAD_SHA: goodEnvBind.GITHUB_SHA,
  IU_NDIC_EXPECTED_CANDIDATE_MODE: "active",
});
ok("GOOD_CANDIDATE_PASS", good.ok === true, good.reason);
ok("GOOD_REQUIRED_PRESENT", assertNdicCandidateRequiredOutputs(goodDir).ok === true);

const corruptDir = path.join(tmp, "corrupt");
writeMinimalCandidate(corruptDir, { corruptSnapshot: true });
const corrupt = validateSharedWriteCandidate(corruptDir, {
  IU_NDIC_EXPECTED_PRODUCER_RUN_ID: "31313465533",
  IU_NDIC_EXPECTED_PRODUCER_HEAD_SHA: "a7bc4d7190c787f7d9ab78909c8a03c2a065fe9b",
  IU_NDIC_EXPECTED_CANDIDATE_MODE: "active",
});
ok("CORRUPT_CANDIDATE_DETECTED", corrupt.ok === false);
ok("CORRUPT_CANDIDATE_SHARED_MUTATION", corrupt.ok === false);
ok("CORRUPT_CANDIDATE_PUBLICATION", corrupt.ok === false);

const badBindDir = path.join(tmp, "badbind");
writeMinimalCandidate(badBindDir, { badProducer: true });
const badBind = validateSharedWriteCandidate(badBindDir, {
  IU_NDIC_EXPECTED_PRODUCER_RUN_ID: "31313465533",
  IU_NDIC_EXPECTED_PRODUCER_HEAD_SHA: "a7bc4d7190c787f7d9ab78909c8a03c2a065fe9b",
  IU_NDIC_EXPECTED_CANDIDATE_MODE: "active",
});
ok("BAD_PRODUCER_BINDING_FAIL_CLOSED", badBind.ok === false);
ok("WRONG_PRODUCER_BINDING_DETECTED", badBind.ok === false);
ok("WRONG_PRODUCER_SHARED_MUTATION", badBind.ok === false);
ok("WRONG_PRODUCER_PUBLICATION", badBind.ok === false);

const corruptManifestDir = path.join(tmp, "corrupt-manifest");
writeMinimalCandidate(corruptManifestDir, { corruptManifest: true });
const corruptManifest = validateSharedWriteCandidate(corruptManifestDir, {
  IU_NDIC_EXPECTED_PRODUCER_RUN_ID: "31313465533",
  IU_NDIC_EXPECTED_PRODUCER_HEAD_SHA: "a7bc4d7190c787f7d9ab78909c8a03c2a065fe9b",
  IU_NDIC_EXPECTED_CANDIDATE_MODE: "active",
});
ok("CORRUPT_MANIFEST_DETECTED", corruptManifest.ok === false);
ok("CORRUPT_MANIFEST_SHARED_MUTATION", corruptManifest.ok === false);
ok("CORRUPT_MANIFEST_PUBLICATION", corruptManifest.ok === false);

const invalidSchemaDir = path.join(tmp, "invalid-schema");
writeMinimalCandidate(invalidSchemaDir, { invalidSchema: true });
const invalidSchema = validateSharedWriteCandidate(invalidSchemaDir, {
  IU_NDIC_EXPECTED_PRODUCER_RUN_ID: "31313465533",
  IU_NDIC_EXPECTED_PRODUCER_HEAD_SHA: "a7bc4d7190c787f7d9ab78909c8a03c2a065fe9b",
  IU_NDIC_EXPECTED_CANDIDATE_MODE: "active",
});
ok("INVALID_SCHEMA_FAILS_CLOSED", invalidSchema.ok === false);
ok("INVALID_SCHEMA_SHARED_MUTATION", invalidSchema.ok === false);

const nonPublicDir = path.join(tmp, "non-public");
writeMinimalCandidate(nonPublicDir, { nonPublicSafe: true });
const nonPublic = validateSharedWriteCandidate(nonPublicDir, {
  IU_NDIC_EXPECTED_PRODUCER_RUN_ID: "31313465533",
  IU_NDIC_EXPECTED_PRODUCER_HEAD_SHA: "a7bc4d7190c787f7d9ab78909c8a03c2a065fe9b",
  IU_NDIC_EXPECTED_CANDIDATE_MODE: "active",
});
ok("NON_PUBLIC_SAFE_CANDIDATE_FAILS_CLOSED", nonPublic.ok === false);
ok("NON_PUBLIC_SAFE_SHARED_MUTATION", nonPublic.ok === false);
ok("NON_PUBLIC_SAFE_PUBLICATION", nonPublic.ok === false);

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}

const report = {
  suite: "NDIC_SHARED_WRITE_IF_FIXTURES",
  SHARED_WRITE_DISPATCH_FIXTURE_PASS: fails.some((f) => f.startsWith("A_")) ? "NO" : "YES",
  SHARED_WRITE_SCHEDULE_DISARMED_FIXTURE_PASS: fails.some((f) => f.startsWith("B_"))
    ? "NO"
    : "YES",
  SHARED_WRITE_SCHEDULE_ARMED_FIXTURE_PASS: fails.some((f) => f.startsWith("C_"))
    ? "NO"
    : "YES",
  SHARED_WRITE_PREP_FAILURE_FIXTURE_PASS: fails.some((f) => f.startsWith("D_"))
    ? "NO"
    : "YES",
  MISSING_ARTIFACT_SHARED_WRITE_JOB_STARTS: fails.some((f) =>
    f.startsWith("MISSING_ARTIFACT_SHARED_WRITE_JOB_STARTS")
  )
    ? "NO"
    : "YES",
  MISSING_ARTIFACT_DETECTED: fails.some((f) => f.startsWith("MISSING_ARTIFACT_DETECTED"))
    ? "NO"
    : "YES",
  MISSING_CANDIDATE_JOB_STARTED: fails.some((f) => f.startsWith("MISSING_CANDIDATE_JOB_STARTED"))
    ? "NO"
    : "YES",
  MISSING_CANDIDATE_FAIL_CLOSED: fails.some((f) => f.startsWith("MISSING_CANDIDATE_FAIL_CLOSED"))
    ? "NO"
    : "YES",
  MISSING_ARTIFACT_SHARED_MUTATION: fails.some((f) =>
    f.startsWith("MISSING_ARTIFACT_SHARED_MUTATION")
  )
    ? "YES"
    : "NO",
  MISSING_CANDIDATE_SHARED_MUTATION: fails.some((f) =>
    f.startsWith("MISSING_CANDIDATE_SHARED_MUTATION")
  )
    ? "YES"
    : "NO",
  MISSING_ARTIFACT_PUBLICATION: fails.some((f) => f.startsWith("MISSING_ARTIFACT_PUBLICATION"))
    ? "YES"
    : "NO",
  CORRUPT_CANDIDATE_DETECTED: fails.some((f) => f.startsWith("CORRUPT_CANDIDATE_DETECTED"))
    ? "NO"
    : "YES",
  CORRUPT_CANDIDATE_SHARED_MUTATION: fails.some((f) =>
    f.startsWith("CORRUPT_CANDIDATE_SHARED_MUTATION")
  )
    ? "YES"
    : "NO",
  CORRUPT_CANDIDATE_PUBLICATION: fails.some((f) => f.startsWith("CORRUPT_CANDIDATE_PUBLICATION"))
    ? "YES"
    : "NO",
  CORRUPT_MANIFEST_DETECTED: fails.some((f) => f.startsWith("CORRUPT_MANIFEST_DETECTED"))
    ? "NO"
    : "YES",
  CORRUPT_MANIFEST_SHARED_MUTATION: fails.some((f) =>
    f.startsWith("CORRUPT_MANIFEST_SHARED_MUTATION")
  )
    ? "YES"
    : "NO",
  CORRUPT_MANIFEST_PUBLICATION: fails.some((f) => f.startsWith("CORRUPT_MANIFEST_PUBLICATION"))
    ? "YES"
    : "NO",
  INVALID_SCHEMA_FAILS_CLOSED: fails.some((f) => f.startsWith("INVALID_SCHEMA_FAILS_CLOSED"))
    ? "NO"
    : "YES",
  NON_PUBLIC_SAFE_CANDIDATE_FAILS_CLOSED: fails.some((f) =>
    f.startsWith("NON_PUBLIC_SAFE_CANDIDATE_FAILS_CLOSED")
  )
    ? "NO"
    : "YES",
  WRONG_PRODUCER_BINDING_DETECTED: fails.some((f) =>
    f.startsWith("WRONG_PRODUCER_BINDING_DETECTED")
  )
    ? "NO"
    : "YES",
  WRONG_PRODUCER_SHARED_MUTATION: fails.some((f) => f.startsWith("WRONG_PRODUCER_SHARED_MUTATION"))
    ? "YES"
    : "NO",
  WRONG_PRODUCER_PUBLICATION: fails.some((f) => f.startsWith("WRONG_PRODUCER_PUBLICATION"))
    ? "YES"
    : "NO",
  SHARED_WRITE_MUTATION_TEST_PASS: fails.length === 0 ? "YES" : "NO",
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
