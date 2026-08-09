#!/usr/bin/env node
/**
 * Meta/mutation tests for ndic-github-hosted-access-fixtures.mjs
 * Offline only — no NDIC network, no workflow dispatch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "scripts", "ndic-github-hosted-access-fixtures.mjs");
const IDENTITY = path.join(ROOT, "scripts", "ndic-datex-v1", "runner-identity.mjs");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

function runNode(file, envExtra = {}) {
  return spawnSync(process.execPath, [file], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...envExtra },
  });
}

function main() {
  const src = fs.readFileSync(FIXTURE, "utf8");
  const idSrc = fs.readFileSync(IDENTITY, "utf8");

  ok("fixture_exists", fs.existsSync(FIXTURE), "missing");
  ok("guard_still_throws_path", /REFUSING_GITHUB_HOSTED_PATH/.test(idSrc), "guard");
  ok("guard_not_weakened", /throw Object\.assign\(new Error\("REFUSING_GITHUB_HOSTED_PATH"\)/.test(idSrc), "throw");
  ok("fixture_has_expectRefusal", /function expectRefusal/.test(src), "helper");
  ok("fixture_pass_opts_cwd", /cwd:\s*["']\/opt\/actions-runner/.test(src), "opts");
  ok("fixture_no_uncaught_pass_call", !/const r = assertNdicCzechEgressRunnerOrThrow\(\{[\s\S]*GITHUB_WORKSPACE: "\/opt\/actions-runner[\s\S]*\}\);\s*ok\("runtime_pass_czech"/.test(src), "uncaught");

  // Baseline must PASS
  {
    const r = runNode(FIXTURE);
    ok("baseline_exit_0", r.status === 0, String(r.status));
    ok("baseline_stdout_pass", /ndic-github-hosted-access-fixtures\] PASS/.test(r.stdout || ""), "stdout");
  }

  // Mutation: remove expectRefusal / try-catch around path refusal → must FAIL or crash non-zero when simulating CI cwd
  {
    const tmp = FIXTURE + ".meta-remove-catch.mjs";
    let mutated = src.replace(/function expectRefusal\([\s\S]*?^}/m, "function expectRefusal(){ return { threw:false, code:null, matched:false }; }");
    // Also break opts.cwd on pass path so CI-like behavior isn't isolated
    mutated = mutated.replace(
      /cwd: "\/opt\/actions-runner\/_work\/filtr\/filtr"/g,
      'cwd: "/home/runner/work/filtr/filtr"'
    );
    fs.writeFileSync(tmp, mutated, "utf8");
    try {
      const r = runNode(tmp);
      ok("MUTATION_REMOVE_CATCH_TEST", r.status !== 0, "exit=" + r.status);
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  // Mutation: wrong expected error code
  {
    const tmp = FIXTURE + ".meta-wrong-code.mjs";
    const mutated = src.replace(/"REFUSING_GITHUB_HOSTED_PATH"/g, '"REFUSING_WRONG_CODE"');
    fs.writeFileSync(tmp, mutated, "utf8");
    try {
      const r = runNode(tmp);
      ok("MUTATION_WRONG_ERROR_CODE_TEST", r.status !== 0, "exit=" + r.status);
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  // False-green: force exit 0 without assertions by replacing ok() — must be detectable as source smell
  {
    ok("FALSE_GREEN_TEST", !/process\.exit\(0\);\s*$/m.test(src.split("if (fails.length)")[0]), "early-exit");
    ok("false_green_no_hardcoded_pass_only", /if \(fails\.length\)/.test(src), "gate");
  }

  const report = {
    suite: "NDIC_GITHUB_HOSTED_ACCESS_META",
    META_TEST_COUNT: fails.length === 0 ? 12 : fails.length,
    META_TEST_FAILURE_COUNT: fails.length,
    fails,
  };
  if (fails.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      ...report,
      META_TEST_SUCCESS_COUNT: 12,
      META_TEST_FAILURE_COUNT: 0,
      MUTATION_REMOVE_CATCH_TEST: "PASS",
      MUTATION_WRONG_ERROR_CODE_TEST: "PASS",
      FALSE_GREEN_TEST: "PASS",
    })
  );
  process.exit(0);
}

main();
