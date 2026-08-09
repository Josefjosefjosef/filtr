#!/usr/bin/env node
/**
 * Fail-closed candidate validation for ndic-shared-write (step-level).
 * Job eligibility must NOT depend on needs.ndic-prep.outputs.candidate_ready.
 *
 * Env:
 *   IU_NDIC_EXPECTED_PRODUCER_RUN_ID
 *   IU_NDIC_EXPECTED_PRODUCER_HEAD_SHA
 *   IU_NDIC_EXPECTED_CANDIDATE_MODE (default active)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNdicCandidateRequiredOutputs } from "./ndic-assert-candidate-required-outputs.mjs";
import { CANDIDATE_PRODUCER_REL } from "./ndic-write-candidate-producer-binding.mjs";
import { validateTrafficUiSnapshotBeforeCommit } from "./ndic-datex-v1/traffic-ui-snapshot-persist.mjs";
import { scanPublicationCanaries } from "./ndic-datex-v1/traffic-publication-projection.mjs";

export function validateSharedWriteCandidate(candidateDir, env = process.env) {
  const required = assertNdicCandidateRequiredOutputs(candidateDir);
  if (!required.ok) {
    return {
      ok: false,
      reason: "CANDIDATE_REQUIRED_OUTPUT_MISSING",
      missing: required.missing,
    };
  }

  const producerPath = path.join(required.root, CANDIDATE_PRODUCER_REL);
  if (!fs.existsSync(producerPath)) {
    return { ok: false, reason: "CANDIDATE_PRODUCER_BINDING_MISSING" };
  }
  let producer;
  try {
    producer = JSON.parse(fs.readFileSync(producerPath, "utf8"));
  } catch {
    return { ok: false, reason: "CANDIDATE_PRODUCER_BINDING_CORRUPT" };
  }
  const expectedRun = String(env.IU_NDIC_EXPECTED_PRODUCER_RUN_ID || "").trim();
  const expectedHead = String(env.IU_NDIC_EXPECTED_PRODUCER_HEAD_SHA || "").trim();
  const expectedMode = String(env.IU_NDIC_EXPECTED_CANDIDATE_MODE || "active").trim();
  if (!expectedRun || !expectedHead) {
    return { ok: false, reason: "CANDIDATE_PRODUCER_EXPECTATIONS_MISSING" };
  }
  if (producer.schema !== "iu-ndic-candidate-producer-v1") {
    return { ok: false, reason: "CANDIDATE_PRODUCER_SCHEMA_MISMATCH" };
  }
  if (String(producer.runId) !== expectedRun) {
    return {
      ok: false,
      reason: "CANDIDATE_PRODUCER_RUN_MISMATCH",
      expectedRun,
      actualRun: producer.runId,
    };
  }
  if (String(producer.headSha) !== expectedHead) {
    return {
      ok: false,
      reason: "CANDIDATE_PRODUCER_HEAD_MISMATCH",
      expectedHead,
      actualHead: producer.headSha,
    };
  }
  if (String(producer.mode) !== expectedMode) {
    return {
      ok: false,
      reason: "CANDIDATE_PRODUCER_MODE_MISMATCH",
      expectedMode,
      actualMode: producer.mode,
    };
  }

  const diagPath = path.join(required.root, "ndic_datex_v1", "diagnostics.json");
  let diagnostics;
  try {
    diagnostics = JSON.parse(fs.readFileSync(diagPath, "utf8"));
  } catch {
    return { ok: false, reason: "CANDIDATE_DIAGNOSTICS_CORRUPT" };
  }
  if (diagnostics && diagnostics.mode != null && String(diagnostics.mode) !== expectedMode) {
    return {
      ok: false,
      reason: "CANDIDATE_DIAGNOSTICS_MODE_MISMATCH",
      expectedMode,
      actualMode: diagnostics.mode,
    };
  }

  const snapPath = path.join(required.root, "ndic_datex_v1", "traffic_offline_snapshot.json");
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  } catch {
    return { ok: false, reason: "CANDIDATE_SNAPSHOT_CORRUPT" };
  }
  const schema = validateTrafficUiSnapshotBeforeCommit(snapshot);
  if (!schema.ok) {
    return {
      ok: false,
      reason: "CANDIDATE_SNAPSHOT_SCHEMA_FAIL",
      rejectCode: schema.rejectCode,
    };
  }
  const canary = scanPublicationCanaries(snapshot);
  if (!canary.ok) {
    return {
      ok: false,
      reason: "CANDIDATE_PUBLIC_SAFE_FAIL",
      hits: canary.hits,
    };
  }

  return {
    ok: true,
    reason: "CANDIDATE_VALIDATION_PASS",
    producer,
    cardCount: Array.isArray(snapshot.cards) ? snapshot.cards.length : 0,
  };
}

function main() {
  const candidateDir = process.argv[2];
  if (!candidateDir) {
    console.error("Usage: node ndic-validate-shared-write-candidate.mjs <candidateDir>");
    process.exit(1);
  }
  const out = validateSharedWriteCandidate(candidateDir);
  console.log(JSON.stringify(out));
  if (!out.ok) {
    console.error("CANDIDATE_VALIDATION_FAIL:" + out.reason);
    process.exit(2);
  }
  console.log("CANDIDATE_VALIDATION_PASS");
}

const isDirect =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isDirect) main();
