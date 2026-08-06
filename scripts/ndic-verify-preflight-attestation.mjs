#!/usr/bin/env node
/**
 * Verify HEAD-bound NDIC staging preflight attestation before network sync.
 * Fail-closed. Env: GITHUB_TOKEN/GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA
 * (or IU_NDIC_PREFLIGHT_EXPECTED_HEAD), optional IU_NDIC_PREFLIGHT_ATTESTATION_ID.
 */
import {
  PREFLIGHT_STATUS_CONTEXT,
  parseAttestationDescription,
  verifyAttestationStatus,
} from "./ndic-staging-preflight-attestation.mjs";

async function main() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const expected = String(
    process.env.IU_NDIC_PREFLIGHT_EXPECTED_HEAD || process.env.GITHUB_SHA || ""
  )
    .trim()
    .toLowerCase();
  const wantAid = String(process.env.IU_NDIC_PREFLIGHT_ATTESTATION_ID || "").trim();

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

  const url = `https://api.github.com/repos/${repo}/commits/${expected}/status`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "iu-ndic-staging-preflight-verify",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("STATUS_FETCH_FAILED", res.status, text.slice(0, 500));
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    console.error("STATUS_JSON_PARSE_FAILED");
    process.exit(1);
  }

  const statuses = Array.isArray(payload.statuses) ? payload.statuses : [];
  const candidates = statuses.filter((s) => s && s.context === PREFLIGHT_STATUS_CONTEXT);
  if (candidates.length === 0) {
    console.error("PREFLIGHT_MISSING");
    process.exit(1);
  }

  // Prefer newest success that verifies
  candidates.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
  let chosen = null;
  let last = null;
  for (const s of candidates) {
    const v = verifyAttestationStatus({
      context: s.context,
      state: s.state,
      description: s.description || "",
      expectedHeadSha: expected,
    });
    last = { s, v };
    if (!v.ok) continue;
    if (wantAid && v.parsed.aid !== wantAid) continue;
    chosen = { s, v };
    break;
  }

  if (!chosen) {
    const errs = (last && last.v && last.v.errors) || ["NO_VALID_PREFLIGHT"];
    if (wantAid) errs.push("ATTESTATION_ID_MISMATCH_OR_MISSING");
    console.error("PREFLIGHT_INVALID", errs.join(","));
    process.exit(1);
  }

  const parsed = chosen.v.parsed;
  // Optional: confirm the source workflow run concluded success
  const runUrl = `https://api.github.com/repos/${repo}/actions/runs/${parsed.run}`;
  const runRes = await fetch(runUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "iu-ndic-staging-preflight-verify",
    },
  });
  if (runRes.ok) {
    const run = await runRes.json();
    const name = String(run.name || "");
    const conclusion = String(run.conclusion || "");
    const head = String(run.head_sha || "").toLowerCase();
    if (name !== "NDIC staging preflight") {
      console.error("PREFLIGHT_WRONG_WORKFLOW", name);
      process.exit(1);
    }
    if (conclusion === "cancelled" || conclusion === "failure" || conclusion === "timed_out") {
      console.error("PREFLIGHT_RUN_CONCLUSION_BAD", conclusion);
      process.exit(1);
    }
    if (conclusion && conclusion !== "success") {
      console.error("PREFLIGHT_RUN_CONCLUSION_NOT_SUCCESS", conclusion);
      process.exit(1);
    }
    if (head && head !== expected) {
      console.error("PREFLIGHT_RUN_HEAD_MISMATCH");
      process.exit(1);
    }
  }

  console.log(
    JSON.stringify({
      PREFLIGHT_VERIFIED: "YES",
      PREFLIGHT_HEAD_SHA: parsed.head,
      PREFLIGHT_ATTESTATION_ID: parsed.aid,
      PREFLIGHT_EXPIRES_AT: parsed.exp,
      PREFLIGHT_RUN_ID: parsed.run,
    })
  );
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
