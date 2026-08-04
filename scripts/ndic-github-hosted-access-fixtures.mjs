#!/usr/bin/env node
/**
 * Regression fixtures: GitHub-hosted must never gain NDIC network capability.
 * Synthetic YAML only — no secrets values, no network.
 */
import {
  analyzeWorkflowYaml,
  hasAllRequired,
  REQUIRED_LABELS,
} from "./ndic-self-hosted-runner-contract-guard.mjs";
import {
  assertNdicCzechEgressRunnerOrThrow,
  NDIC_EXPECTED_RUNNER_NAME,
} from "./ndic-datex-v1/runner-identity.mjs";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function hasIssue(analysis, id) {
  return analysis.issues.some((i) => i.id === id);
}

// 1) ubuntu-latest + NDIC secret → FAIL
{
  const a = analyzeWorkflowYaml(
    `
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
        env:
          IU_NDIC_PULL_URL: \${{ secrets.IU_NDIC_PULL_URL }}
`,
    "bad-secret.yml"
  );
  ok("ubuntu_secret_fail", hasIssue(a, "github_hosted_ndic_capability"), a.issues.map((i) => i.id).join(","));
}

// 2) ubuntu-latest + NDIC downloader → FAIL
{
  const a = analyzeWorkflowYaml(
    `
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/ndic-datex-v1-prod-sync.mjs
`,
    "bad-downloader.yml"
  );
  ok("ubuntu_downloader_fail", hasIssue(a, "github_hosted_ndic_capability"), a.issues.map((i) => i.id).join(","));
}

// 3) dynamic runs-on → FAIL
{
  const a = analyzeWorkflowYaml(
    `
jobs:
  sync:
    runs-on: \${{ inputs.runner }}
    steps:
      - run: node scripts/ndic-datex-v1-shadow-run.mjs
`,
    "bad-dyn.yml"
  );
  ok("dynamic_runs_on_fail", hasIssue(a, "dynamic_runs_on"), a.issues.map((i) => i.id).join(","));
}

// 4) self-hosted without custom label → FAIL
{
  const a = analyzeWorkflowYaml(
    `
jobs:
  sync:
    runs-on:
      - self-hosted
      - Linux
      - X64
    steps:
      - run: node scripts/ndic-datex-v1-prod-sync.mjs
        env:
          IU_NDIC_PULL_URL: \${{ secrets.IU_NDIC_PULL_URL }}
`,
    "foreign.yml"
  );
  ok(
    "self_hosted_missing_label_fail",
    hasIssue(a, "foreign_self_hosted") || hasIssue(a, "incomplete_ndic_labels"),
    a.issues.map((i) => i.id).join(",")
  );
}

// 5) correct four labels + preflight → PASS (no github_hosted issue)
{
  const a = analyzeWorkflowYaml(
    `
jobs:
  shadow-probe:
    runs-on:
      - self-hosted
      - Linux
      - X64
      - ndic-cz-egress
    steps:
      - name: Preflight runner identity (fail-closed)
        run: |
          if [ "\${RUNNER_ENVIRONMENT:-}" != "self-hosted" ]; then
            echo "REFUSING_GITHUB_HOSTED"
            exit 1
          fi
          EXPECTED_NAME="infouzel-ndic-cz-vps4204"
      - uses: actions/checkout@abc
      - run: node scripts/ndic-datex-v1-shadow-run.mjs
        env:
          IU_NDIC_PULL_URL: \${{ secrets.IU_NDIC_PULL_URL }}
`,
    "ndic-datex-v1-shadow-probe.yml"
  );
  ok("good_labels", hasAllRequired(a.jobs[0].labels), a.jobs[0].labels.join("+"));
  ok("good_no_gh_issue", !hasIssue(a, "github_hosted_ndic_capability"), a.issues.map((i) => i.id).join(","));
  ok("good_preflight_ok", !hasIssue(a, "missing_preflight") && !hasIssue(a, "preflight_after_secrets"), a.issues.map((i) => i.id).join(","));
}

// 6) offline fixture test on ubuntu without secrets / network path → PASS
{
  const a = analyzeWorkflowYaml(
    `
jobs:
  offline-guards:
    runs-on: ubuntu-latest
    steps:
      - run: npm run iu-ndic-datex-v1-guard
      - run: npm run iu-ndic-datex-v1-exposure-guard
`,
    "update-ndic-datex-v1.yml"
  );
  ok("offline_ubuntu_ok", a.jobs[0].isGithubHosted === true, a.jobs[0].labels.join("+"));
  ok("offline_no_caps", a.jobs[0].ndicCapabilities.length === 0, a.jobs[0].ndicCapabilities.join("|"));
  ok("offline_no_gh_ndic_issue", !hasIssue(a, "github_hosted_ndic_capability"), a.issues.map((i) => i.id).join(","));
}

// Runtime identity: github-hosted + secrets must throw (main bypass defense)
{
  let threw = false;
  let code = null;
  try {
    assertNdicCzechEgressRunnerOrThrow({
      IU_NDIC_DATEX_V1_MODE: "shadow",
      IU_NDIC_PULL_URL: "https://example.invalid/x",
      RUNNER_ENVIRONMENT: "github-hosted",
      RUNNER_NAME: "GitHub Actions",
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      GITHUB_WORKSPACE: "/home/runner/work/filtr/filtr",
    });
  } catch (e) {
    threw = true;
    code = e && e.code;
  }
  ok("runtime_refuse_github_hosted", threw && code === "REFUSING_GITHUB_HOSTED", String(code));
}

{
  let threw = false;
  try {
    assertNdicCzechEgressRunnerOrThrow({
      IU_NDIC_DATEX_V1_MODE: "shadow",
      IU_NDIC_PULL_URL: "https://example.invalid/x",
      RUNNER_ENVIRONMENT: "self-hosted",
      RUNNER_NAME: NDIC_EXPECTED_RUNNER_NAME,
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      GITHUB_WORKSPACE: "/home/runner/work/filtr/filtr",
    });
  } catch (e) {
    threw = e && e.code === "REFUSING_GITHUB_HOSTED_PATH";
  }
  ok("runtime_refuse_home_runner_path", threw, "path");
}

{
  const r = assertNdicCzechEgressRunnerOrThrow({
    IU_NDIC_DATEX_V1_MODE: "shadow",
    IU_NDIC_PULL_URL: "https://example.invalid/x",
    RUNNER_ENVIRONMENT: "self-hosted",
    RUNNER_NAME: NDIC_EXPECTED_RUNNER_NAME,
    RUNNER_OS: "Linux",
    RUNNER_ARCH: "X64",
    GITHUB_WORKSPACE: "/opt/actions-runner/_work/filtr/filtr",
  });
  ok("runtime_pass_czech", r.ok === true, JSON.stringify(r));
}

{
  const r = assertNdicCzechEgressRunnerOrThrow({
    IU_NDIC_DATEX_V1_MODE: "off",
  });
  ok("runtime_skip_offline", r.ok === true && r.skipped === true, JSON.stringify(r));
}

ok("required_labels_four", REQUIRED_LABELS.length === 4, String(REQUIRED_LABELS.length));

if (fails.length) {
  console.error("[ndic-github-hosted-access-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    REQUIRED_LABELS,
    NDIC_EXPECTED_RUNNER_NAME,
  })
);
console.log("[ndic-github-hosted-access-fixtures] PASS");
