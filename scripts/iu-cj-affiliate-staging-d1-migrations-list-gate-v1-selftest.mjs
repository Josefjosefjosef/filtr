#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateWranglerD1MigrationsListGate } from "./iu-cj-affiliate-staging-d1-migrations-list-gate-v1.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF = path.join(REPO, ".github", "workflows", "cj-affiliate-staging-worker-deploy.yml");
const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

function gate(exitCode, stdout) {
  return evaluateWranglerD1MigrationsListGate({ exitCode, stdout, stderr: "" });
}

expect("zero_pending_pass", gate(0, "✅ No migrations to apply!").status === "PASS");
expect("zero_pending_count", gate(0, "✅ No migrations to apply!").pendingCount === 0);

expect("one_pending_blocked", gate(0, "0017_new_feature.sql").status === "BLOCKED");
expect("one_pending_count", gate(0, "0017_new_feature.sql").pendingCount === 1);

expect(
  "multi_pending_blocked",
  gate(0, "0017_a.sql\n0018_b.sql").status === "BLOCKED" && gate(0, "0017_a.sql\n0018_b.sql").pendingCount === 2
);

expect("wrangler_fail_blocked", gate(1, "Error: not authorized").status === "BLOCKED");
expect("wrangler_fail_reason", gate(1, "").reason === "wrangler_exit_nonzero");

expect("ambiguous_blocked", gate(0, "Wrangler finished successfully").status === "BLOCKED");
expect("empty_blocked", gate(0, "   \n").status === "BLOCKED");

const wf = fs.readFileSync(WF, "utf8");
expect(
  "wf_no_or_true_on_list",
  !wf.split("\n").some((line) => /migrations list/.test(line) && /\|\| true/.test(line))
);
expect("wf_uses_gate_script", wf.includes("iu-cj-affiliate-staging-d1-migrations-list-gate-v1.mjs"));
expect("wf_blocker_pending", wf.includes("CJ_STAGING_D1_MIGRATIONS_GATE"));
expect("wf_apply_after_gate", /Gate staging D1 migrations[\s\S]*Apply staging D1 migrations/.test(wf));

console.log(
  JSON.stringify({
    IU_CJ_STAGING_D1_MIGRATIONS_LIST_GATE_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    CJ_LIVE_HTTP_CALLS: 0,
  })
);
process.exit(failures.length ? 1 : 0);
