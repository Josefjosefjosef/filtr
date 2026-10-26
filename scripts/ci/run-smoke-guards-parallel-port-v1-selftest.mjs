#!/usr/bin/env node
/**
 * Phase 3L: parallel smoke port assignment must not overlap vault pickGuardPort bands.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runner = fs.readFileSync(path.join(REPO, "scripts/ci/run-smoke-guards-parallel-v1.mjs"), "utf8");
const lifecycle = fs.readFileSync(path.join(REPO, "scripts/guards/guard-playwright-lifecycle.mjs"), "utf8");

const fails = [];
function ok(id, cond) {
  if (!cond) fails.push(id);
}

ok("runner_high_port_base", /30000\s*\+\s*\(Number\.isFinite\(taskIndex\)/.test(runner));
ok("runner_no_legacy_8600_base", !/8600\s*\+\s*\(Number\.isFinite\(taskIndex\)/.test(runner));
ok(
  "lifecycle_honors_IU_GUARD_PORT",
  /envPort\s*=\s*parseInt\(process\.env\.IU_GUARD_PORT/.test(lifecycle) &&
    /basePort\s*=\s*envPort\s*>\s*0\s*\?\s*envPort\s*:\s*preferredPort/.test(lifecycle)
);

const out = {
  IU_SMOKE_PARALLEL_PORT_SELFTEST: fails.length ? "FAIL" : "PASS",
  fails,
};
console.log(JSON.stringify(out));
process.exit(fails.length ? 1 : 0);
