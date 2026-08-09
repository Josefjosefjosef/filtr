#!/usr/bin/env node
/**
 * Regression fixtures: GitHub-hosted must never gain NDIC network capability.
 * Synthetic YAML + runtime identity only — no secrets values, no network.
 *
 * Incident 31118112545: runtime_pass_czech crashed on ubuntu-latest because
 * assertNdicCzechEgressRunnerOrThrow also inspects process.cwd(); CI cwd is
 * /home/runner/work/... → REFUSING_GITHUB_HOSTED_PATH must be expected/caught
 * or overridden via opts.cwd for the synthetic Czech-pass case.
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
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
  else passCount += 1;
}

function hasIssue(analysis, id) {
  return analysis.issues.some((i) => i.id === id);
}

/** Capture expected refusal without crashing the fixture process. */
function expectRefusal(env, opts, expectedCode) {
  let threw = false;
  let code = null;
  let message = null;
  try {
    assertNdicCzechEgressRunnerOrThrow(env, opts);
  } catch (e) {
    threw = true;
    code = e && e.code;
    message = e && e.message;
  }
  return { threw, code, message, expectedCode, matched: threw && code === expectedCode };
}

/** Synthetic Czech egress env (no real secrets; example.invalid only). */
function czechEnv(workspace) {
  return {
    IU_NDIC_DATEX_V1_MODE: "shadow",
    IU_NDIC_PULL_URL: "https://example.invalid/x",
    RUNNER_ENVIRONMENT: "self-hosted",
    RUNNER_NAME: NDIC_EXPECTED_RUNNER_NAME,
    RUNNER_OS: "Linux",
    RUNNER_ARCH: "X64",
    GITHUB_WORKSPACE: workspace,
  };
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
  const r = expectRefusal(
    {
      IU_NDIC_DATEX_V1_MODE: "shadow",
      IU_NDIC_PULL_URL: "https://example.invalid/x",
      RUNNER_ENVIRONMENT: "github-hosted",
      RUNNER_NAME: "GitHub Actions",
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      GITHUB_WORKSPACE: "/home/runner/work/filtr/filtr",
    },
    {},
    "REFUSING_GITHUB_HOSTED"
  );
  ok("runtime_refuse_github_hosted", r.matched, String(r.code));
  ok("runtime_refuse_github_hosted_nonzero_throw", r.threw === true, "no-throw");
}

// Workspace path under /home/runner → REFUSING_GITHUB_HOSTED_PATH (caught)
{
  const r = expectRefusal(
    czechEnv("/home/runner/work/filtr/filtr"),
    { cwd: "/opt/actions-runner/_work/filtr/filtr" },
    "REFUSING_GITHUB_HOSTED_PATH"
  );
  ok("runtime_refuse_home_runner_path", r.matched, String(r.code));
  ok("runtime_refuse_path_message", r.message === "REFUSING_GITHUB_HOSTED_PATH", String(r.message));
}

// Synthetic Czech pass: must isolate both workspace AND cwd from CI /home/runner
{
  let okPass = false;
  let code = null;
  try {
    const out = assertNdicCzechEgressRunnerOrThrow(czechEnv("/opt/actions-runner/_work/filtr/filtr"), {
      cwd: "/opt/actions-runner/_work/filtr/filtr",
    });
    okPass = out && out.ok === true;
  } catch (e) {
    code = e && e.code;
  }
  ok("runtime_pass_czech", okPass === true && code == null, String(code));
  // Document: CI-like cwd under /home/runner still refuses even with Czech workspace
  const ciCwd = expectRefusal(
    czechEnv("/opt/actions-runner/_work/filtr/filtr"),
    { cwd: "/home/runner/work/filtr/filtr" },
    "REFUSING_GITHUB_HOSTED_PATH"
  );
  ok("runtime_ci_cwd_refuse_caught", ciCwd.matched, String(ciCwd.code));
}

{
  const out = assertNdicCzechEgressRunnerOrThrow({
    IU_NDIC_DATEX_V1_MODE: "off",
  });
  ok("runtime_skip_offline", out.ok === true && out.skipped === true, JSON.stringify(out));
}

ok("required_labels_four", REQUIRED_LABELS.length === 4, String(REQUIRED_LABELS.length));

// Safety: this fixture source must not call real NDIC hosts / fetch APIs
{
  const fs = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const selfSrc = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  ok("fixture_no_fetch_call", !/\bfetch\s*\(/.test(selfSrc), "fetch");
  ok("fixture_no_rsd_host", !/mobilitydata\.rsd\.cz/.test(selfSrc), "rsd");
  ok("fixture_example_invalid_only", /example\.invalid/.test(selfSrc), "ex");
  ok("fixture_catches_path_refusal", /expectRefusal|REFUSING_GITHUB_HOSTED_PATH/.test(selfSrc), "catch");
  ok("fixture_pass_uses_opts_cwd", /cwd:\s*["']\/opt\/actions-runner/.test(selfSrc), "opts-cwd");
}

if (fails.length) {
  console.error(
    JSON.stringify({
      suite: "NDIC_GITHUB_HOSTED_ACCESS_FIXTURES",
      total: passCount + fails.length,
      success: passCount,
      failure: fails.length,
      skipped: 0,
      fails,
    })
  );
  process.exit(1);
}
console.log(
  JSON.stringify({
    suite: "NDIC_GITHUB_HOSTED_ACCESS_FIXTURES",
    ok: true,
    total: passCount,
    success: passCount,
    failure: 0,
    skipped: 0,
    EXPECTED_REFUSAL_CAUGHT: true,
    REFUSING_GITHUB_HOSTED_PATH_STILL_ENFORCED: true,
    REQUIRED_LABELS,
    NDIC_EXPECTED_RUNNER_NAME,
  })
);
console.log("[ndic-github-hosted-access-fixtures] PASS");
