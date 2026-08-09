#!/usr/bin/env node
/**
 * Write producer binding into an ACTIVE NDIC candidate before artifact upload.
 * Consumed by ndic-validate-shared-write-candidate.mjs (fail-closed).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CANDIDATE_PRODUCER_REL = "ndic_datex_v1/candidate_producer.json";

export function writeCandidateProducerBinding(candidateDir, env = process.env) {
  const root = path.resolve(candidateDir);
  const runId = String(env.GITHUB_RUN_ID || "").trim();
  const headSha = String(env.GITHUB_SHA || "").trim();
  const mode = String(env.NDIC_RESOLVED_MODE || env.IU_NDIC_DATEX_V1_MODE || "").trim();
  if (!runId || !headSha) {
    return { ok: false, reason: "MISSING_GITHUB_RUN_OR_SHA", runId, headSha, mode };
  }
  if (mode !== "active") {
    return { ok: false, reason: "REFUSING_NON_ACTIVE_MODE", mode };
  }
  const abs = path.join(root, CANDIDATE_PRODUCER_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const payload = {
    schema: "iu-ndic-candidate-producer-v1",
    runId,
    headSha,
    mode,
    producedAt: new Date().toISOString(),
  };
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return { ok: true, path: abs, payload };
}

function main() {
  const candidateDir = process.argv[2];
  if (!candidateDir) {
    console.error("Usage: node ndic-write-candidate-producer-binding.mjs <candidateDir>");
    process.exit(1);
  }
  const out = writeCandidateProducerBinding(candidateDir);
  console.log(JSON.stringify(out));
  if (!out.ok) process.exit(2);
  console.log("CANDIDATE_PRODUCER_BINDING_WRITTEN");
}

const isDirect =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isDirect) main();
