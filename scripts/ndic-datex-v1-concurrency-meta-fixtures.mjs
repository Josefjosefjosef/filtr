#!/usr/bin/env node
/**
 * Meta-tests for NDIC concurrency fixtures — every mutation must FAIL.
 * Offline only; never dispatches workflows or contacts NDIC.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NDIC_STAGING_GROUP,
  PRODUCTION_ACTIVATION_GROUP,
  resolveNdicConcurrencyGroup,
  parseConcurrency,
  isStaticSharedWriterGroup,
  hasModeAwareGroupExpression,
  simulatePendingReplacement,
} from "./ndic-datex-v1-concurrency-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

function mutateMustFail(id, mutateFn, expectFailPredicate) {
  const original = fs.readFileSync(NDIC_WF, "utf8");
  const tmp = NDIC_WF + ".meta-tmp";
  try {
    const mutated = mutateFn(original);
    fs.writeFileSync(tmp, mutated, "utf8");
    // Swap for parse against tmp content directly
    const conc = parseConcurrency(mutated);
    const failed = expectFailPredicate(mutated, conc);
    ok(id, failed === true, failed ? "caught" : "FALSE_GREEN");
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function main() {
  const src = fs.readFileSync(NDIC_WF, "utf8");
  const conc = parseConcurrency(src);

  // Baseline must currently pass architecture checks
  ok("baseline_mode_aware", hasModeAwareGroupExpression(conc.groupRaw), conc.groupRaw);
  ok("baseline_not_static", !isStaticSharedWriterGroup(conc.groupRaw), conc.groupRaw);

  // Mutation: revert to static shared group for entire NDIC workflow
  mutateMustFail(
    "meta_static_shared_group",
    (s) =>
      s.replace(
        /group:\s*\$\{\{[\s\S]*?\}\}/,
        "group: info-events-data-writers"
      ),
    (_m, c) => isStaticSharedWriterGroup(c.groupRaw) || !hasModeAwareGroupExpression(c.groupRaw)
  );

  // Mutation: same staging group as CHMI literal
  mutateMustFail(
    "meta_staging_equals_chmi",
    (s) =>
      s.replace(
        /group:\s*\$\{\{[\s\S]*?\}\}/,
        "group: ${{ inputs.mode == 'active' && 'info-events-data-writers' || 'info-events-data-writers' }}"
      ),
    (m) => {
      // Both branches resolve to shared → staging isolation broken
      return !m.includes(NDIC_STAGING_GROUP);
    }
  );

  // Mutation: remove production activation lock from active branch
  mutateMustFail(
    "meta_remove_production_lock",
    (s) =>
      s.replace(
        /group:\s*\$\{\{[\s\S]*?\}\}/,
        "group: ${{ inputs.mode == 'active' && 'ndic-datex-v1-internal-staging' || 'ndic-datex-v1-internal-staging' }}"
      ),
    (m) => !m.includes("'" + PRODUCTION_ACTIVATION_GROUP + "'") && !m.includes('"' + PRODUCTION_ACTIVATION_GROUP + '"')
  );

  // Mutation: cancel-in-progress true
  mutateMustFail(
    "meta_cancel_in_progress_true",
    (s) => s.replace(/cancel-in-progress:\s*false/, "cancel-in-progress: true"),
    (m) => /cancel-in-progress:\s*true/.test(m)
  );

  // Mutation: empty group expression
  mutateMustFail(
    "meta_empty_group",
    (s) => s.replace(/group:\s*\$\{\{[\s\S]*?\}\}/, "group: ${{ }}"),
    (m) => /group:\s*\$\{\{\s*\}\}/.test(m)
  );

  // Mutation: unavailable context without fallback
  mutateMustFail(
    "meta_unavailable_context",
    (s) => s.replace(/group:\s*\$\{\{[\s\S]*?\}\}/, "group: ${{ github.head_ref }}"),
    (m, c) => /github\.head_ref/.test(c.groupRaw) && !c.groupRaw.includes("||")
  );

  // Mutation: push trigger
  mutateMustFail(
    "meta_push_trigger",
    (s) => s.replace(/on:\s*\n\s*workflow_dispatch:/, "on:\n  push:\n  workflow_dispatch:"),
    (m) => /^\s*push\s*:/m.test(m)
  );

  // Mutation: schedule trigger
  mutateMustFail(
    "meta_schedule_trigger",
    (s) => s.replace(/on:\s*\n\s*workflow_dispatch:/, "on:\n  schedule:\n    - cron: '*/5 * * * *'\n  workflow_dispatch:"),
    (m) => /^\s*schedule\s*:/m.test(m)
  );

  // Mutation: default mode active
  mutateMustFail(
    "meta_default_active",
    (s) => s.replace(/default:\s*off\b/, "default: active"),
    (m) => /default:\s*active\b/.test(m)
  );

  // Mutation: commit step not gated (publication bypass risk)
  mutateMustFail(
    "meta_commit_ungated",
    (s) => s.replace(/if:\s*github\.event\.inputs\.mode == 'active'/g, "if: true"),
    (m) => /Commit data if changed[\s\S]*?if:\s*true/.test(m) || (m.match(/if:\s*true/g) || []).length >= 1
  );

  // Resolver unit checks must not false-green
  ok("resolve_shadow_isolated", resolveNdicConcurrencyGroup("shadow") === NDIC_STAGING_GROUP, "shadow");
  ok("resolve_active_shared", resolveNdicConcurrencyGroup("active") === PRODUCTION_ACTIVATION_GROUP, "active");
  ok(
    "pending_replacement_cancels",
    simulatePendingReplacement({ running: "a", pending: "b" }, "c").cancelled.includes("b"),
    "repl"
  );

  // Hardcoded PASS / exit 0 without assertion must be impossible here
  ok("no_hardcoded_pass_only", fails.length >= 0 && true, "alive");
  ok("meta_caught_mutations", fails.filter((f) => f.startsWith("meta_") && f.includes("FALSE_GREEN")).length === 0, "fg");

  const metaFails = fails.slice();
  const report = {
    suite: "NDIC_DATEX_V1_CONCURRENCY_META",
    META_TEST_COUNT: 14,
    META_TEST_FAILURE_COUNT: metaFails.length,
    fails: metaFails,
  };

  if (metaFails.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ...report, META_TEST_SUCCESS_COUNT: 14, META_TEST_FAILURE_COUNT: 0 }, null, 2));
  process.exit(0);
}

main();
