#!/usr/bin/env node
/**
 * Publish NDIC staging preflight commit status (GitHub API).
 * Env: GITHUB_TOKEN/GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA,
 *      GITHUB_RUN_ID, GITHUB_JOB (optional), IU_NDIC_PREFLIGHT_TTL_SECONDS,
 *      IU_NDIC_PREFLIGHT_EXPECTED_HEAD (optional override)
 */
import {
  PREFLIGHT_STATUS_CONTEXT,
  DEFAULT_TTL_SECONDS,
  buildAttestationDescription,
  buildAttestationId,
  computeExpiresAtIso,
} from "./ndic-staging-preflight-attestation.mjs";

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const runId = process.env.GITHUB_RUN_ID || "";
  const jobId = process.env.GITHUB_JOB || process.env.GITHUB_JOB_NAME || "preflight";
  const ttl = Number(process.env.IU_NDIC_PREFLIGHT_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  const expected =
    String(process.env.IU_NDIC_PREFLIGHT_EXPECTED_HEAD || process.env.GITHUB_SHA || "")
      .trim()
      .toLowerCase();

  if (!token) {
    console.error("MISSING_GITHUB_TOKEN");
    process.exit(1);
  }
  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    console.error("INVALID_GITHUB_REPOSITORY");
    process.exit(1);
  }
  if (!/^[0-9a-f]{40}$/.test(expected)) {
    console.error("INVALID_HEAD_SHA");
    process.exit(1);
  }
  if (!/^\d+$/.test(String(runId))) {
    console.error("INVALID_RUN_ID");
    process.exit(1);
  }

  const now = Date.now();
  const expiresAtIso = computeExpiresAtIso(now, ttl);
  const attestationId = buildAttestationId(runId, jobId);
  const description = buildAttestationDescription({
    headSha: expected,
    runId,
    expiresAtIso,
    attestationId,
  });

  const url = `https://api.github.com/repos/${repo}/statuses/${expected}`;
  const body = {
    state: "success",
    context: PREFLIGHT_STATUS_CONTEXT,
    description,
    target_url: `https://github.com/${repo}/actions/runs/${runId}`,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "iu-ndic-staging-preflight",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("STATUS_PUBLISH_FAILED", res.status, text.slice(0, 500));
    process.exit(1);
  }

  const out = {
    PREFLIGHT_PASS: "YES",
    PREFLIGHT_HEAD_SHA: expected,
    PREFLIGHT_ATTESTATION_ID: attestationId,
    PREFLIGHT_EXPIRES_AT: expiresAtIso,
    PREFLIGHT_RUN_ID: String(runId),
    PREFLIGHT_CONTEXT: PREFLIGHT_STATUS_CONTEXT,
  };
  console.log(JSON.stringify(out));
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(out).map(([k, v]) => `${k}=${v}`);
    await import("node:fs").then((fs) =>
      fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n")
    );
  }
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
