#!/usr/bin/env node
/**
 * Behavioral guard: anonymous CHMI /probe must not mutate (dispatch/cancel),
 * even when stale + non-busy. Runs cloudflare/chmi-cap-watchdog unit tests.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WD = path.join(REPO, "cloudflare/chmi-cap-watchdog");
const fails = [];

function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const index = fs.readFileSync(path.join(WD, "src/index.ts"), "utf8");
const indexTest = fs.readFileSync(path.join(WD, "src/index.test.ts"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(WD, "package.json"), "utf8"));

ok("index_allow_mutations_gate", /allowMutations/.test(index) && /observeOnly/.test(index));
ok("index_probe_passes_allowMutations_doDispatch", /allowMutations:\s*doDispatch/.test(index));
ok(
  "index_test_covers_anonymous_stale_no_dispatch",
  /anonymous GET \/probe is observe-only/.test(indexTest) &&
    /dispatchCount\(\), 0/.test(indexTest) &&
    /stale \+ non-busy/.test(indexTest),
);
ok(
  "index_test_covers_dispatch1_401",
  /probe\?dispatch=1 without Authorization returns 401/.test(indexTest),
);
ok(
  "index_test_covers_authorized_dispatch",
  /probe\?dispatch=1 with valid Bearer performs force dispatch/.test(indexTest),
);
ok(
  "index_test_covers_scheduled_dispatch",
  /scheduled\(\) stale recovery still dispatches/.test(indexTest),
);
ok("package_runs_index_test", /index\.test\.ts/.test(String(pkg.scripts && pkg.scripts.test)));

const run = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", "src/decision.test.ts", "src/index.test.ts"],
  {
    cwd: WD,
    encoding: "utf8",
    env: process.env,
  },
);
const out = String(run.stdout || "") + String(run.stderr || "");
ok("unit_tests_exit_0", run.status === 0, "status=" + String(run.status));
ok("unit_tests_pass_marker", /pass/.test(out) && !/\n.*fail [1-9]/.test(out), out.slice(0, 800));
ok(
  "unit_tests_include_observe_only_case",
  /anonymous GET \/probe is observe-only/.test(out) || /# Subtest: anonymous GET \/probe/.test(out),
  "missing observe-only subtest in output",
);

if (fails.length) {
  console.error("IU_CHMI_PROBE_READONLY_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  if (out) {
    console.error("--- npm test output (truncated) ---");
    console.error(out.slice(0, 4000));
  }
  process.exit(1);
}
console.log("IU_CHMI_PROBE_READONLY_GUARD=PASS");
