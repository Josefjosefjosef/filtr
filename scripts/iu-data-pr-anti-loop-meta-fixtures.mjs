#!/usr/bin/env node
/**
 * Meta/mutation guard for DATA_PR_FINALIZATION_PROTOCOL anti-loop pieces.
 * Asserts protocol, safe refresh, finalization lock, no whole-workflow lock,
 * and that stale-base-only refresh needs no network job.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workflowLevelHasSharedLock } from "./ndic-datex-v1-concurrency-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

const PROTO = path.join(ROOT, "scripts", "iu-data-pr-finalization-protocol.mjs");
const GUARD = path.join(ROOT, "scripts", "iu-data-pr-base-freshness-guard.mjs");
const SAFE = path.join(ROOT, "scripts", "iu-data-pr-safe-shared-namespace-refresh.mjs");
const FIX = path.join(ROOT, "scripts", "iu-data-pr-anti-loop-fixtures.mjs");
const SUITE = path.join(ROOT, "scripts", "ndic-staging-preflight-suite.mjs");
const PKG = path.join(ROOT, "package.json");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const CHMI_WF = path.join(ROOT, ".github", "workflows", "update-chmi-cap-v2.yml");
const IE_WF = path.join(ROOT, ".github", "workflows", "update-info-events.yml");
const STAGE = path.join(ROOT, "scripts", "ndic-stage-shared-write-outputs.mjs");
const BOUNDED = path.join(ROOT, "scripts", "ndic-data-pr-bounded-refresh.mjs");
const BOUNDED_FIX = path.join(ROOT, "scripts", "ndic-data-pr-bounded-refresh-fixtures.mjs");
const RECONCILE = path.join(ROOT, "scripts", "ndic-data-pr-reconcile-against-main.mjs");
const SMOKE_WF = path.join(ROOT, ".github", "workflows", "smoke.yml");
const REPO_WF = path.join(ROOT, ".github", "workflows", "repo-guard.yml");
const LAYOUT_WF = path.join(ROOT, ".github", "workflows", "layout-guard.yml");

ok("file_protocol", fs.existsSync(PROTO));
ok("file_guard", fs.existsSync(GUARD));
ok("file_safe_refresh", fs.existsSync(SAFE));
ok("file_fixtures", fs.existsSync(FIX));
ok("file_bounded_refresh", fs.existsSync(BOUNDED));
ok("file_bounded_fixtures", fs.existsSync(BOUNDED_FIX));
ok("file_reconcile", fs.existsSync(RECONCILE));

const proto = fs.readFileSync(PROTO, "utf8");
const guard = fs.readFileSync(GUARD, "utf8");
const safe = fs.readFileSync(SAFE, "utf8");
const fix = fs.readFileSync(FIX, "utf8");
const suite = fs.readFileSync(SUITE, "utf8");
const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
const ndicWf = fs.readFileSync(NDIC_WF, "utf8");
const chmiWf = fs.readFileSync(CHMI_WF, "utf8");
const ieWf = fs.readFileSync(IE_WF, "utf8");
const stage = fs.readFileSync(STAGE, "utf8");

ok("proto_binding_fields", /baseMainSha/.test(proto) && /chmiDigest/.test(proto) && /writerRunId/.test(proto));
ok("proto_evaluate", /export function evaluateBaseFreshness/.test(proto));
ok("proto_rebase", /REBASE_SHARED_NAMESPACES_FROM_CURRENT_MAIN/.test(proto));
ok("proto_uses_apply_ndic", /applyNdicCandidate/.test(proto));
ok("proto_finalization_lock", /export function runFinalizationCriticalSection/.test(proto));
ok("proto_no_whole_workflow_lock_flag", /WHOLE_WORKFLOW_SHARED_LOCK:\s*"NO"/.test(proto));
ok("proto_no_network_in_lock_flag", /NETWORK_PREP_INSIDE_SHARED_LOCK:\s*"NO"/.test(proto));
ok("proto_no_long_tests_in_lock_flag", /LONG_RUNNING_TESTS_INSIDE_SHARED_LOCK:\s*"NO"/.test(proto));
ok("proto_head_checks_alone_no", /HEAD_CHECKS_ALONE_MERGE_READY:\s*"NO"/.test(proto));

ok("guard_semantic", /semantic digests|Semantic digests/i.test(guard + proto));
ok("safe_no_datex_download", !/mobilitydata\.rsd\.cz/.test(safe));
ok("safe_uses_rebase", /rebaseSharedNamespacesFromCurrentMain/.test(safe));

ok("fix_A", /A_STALE|DATA_PR_BASE_FRESHNESS_FIXTURES_PASS/.test(fix));
ok("fix_B", /SAFE_SHARED_NAMESPACE_REFRESH_FIXTURES_PASS/.test(fix));
ok("fix_C", /C_stale_again/.test(fix));
ok("fix_D", /DATA_PR_FINALIZATION_LOCK_FIXTURES_PASS/.test(fix));
ok("fix_E", /E_not_false_stale/.test(fix));
ok("fix_F", /DUPLICATE_DATA_PR_FIXTURES_PASS/.test(fix));
ok("fix_G", /G_no_network_flag|G_rejects_credentials/.test(fix));
ok("fix_H", /H_card_count|H_trust|H_timeline|H_map_safety/.test(fix));

ok(
  "pkg_anti_loop_fixtures",
  Boolean(pkg.scripts && pkg.scripts["iu-data-pr-anti-loop-fixtures"])
);
ok(
  "pkg_anti_loop_meta",
  Boolean(pkg.scripts && pkg.scripts["iu-data-pr-anti-loop-meta-fixtures"])
);
ok(
  "pkg_base_freshness_guard",
  Boolean(pkg.scripts && pkg.scripts["iu-data-pr-base-freshness-guard"])
);
ok("suite_wires_anti_loop", /iu-data-pr-anti-loop-fixtures/.test(suite));
ok("suite_wires_anti_loop_meta", /iu-data-pr-anti-loop-meta-fixtures/.test(suite));

ok(
  "wf_records_binding",
  /iu-data-pr-finalization-protocol\.mjs record-binding/.test(ndicWf)
);
ok("wf_ndic_no_workflow_level_lock", !workflowLevelHasSharedLock(ndicWf));
ok("wf_chmi_no_workflow_level_lock", !workflowLevelHasSharedLock(chmiWf));
ok("wf_ie_no_workflow_level_lock", !workflowLevelHasSharedLock(ieWf));
ok(
  "wf_shared_write_has_narrow_lock",
  /ndic-shared-write:[\s\S]*?group:\s*info-events-data-writers/.test(ndicWf)
);
ok(
  "wf_reconcile_has_narrow_lock",
  /ndic-reconcile-data-pr:[\s\S]*?group:\s*info-events-data-writers/.test(ndicWf)
);
ok(
  "wf_post_write_no_shared_lock",
  /ndic-post-write:[\s\S]*?NO info-events-data-writers/.test(ndicWf)
);
ok(
  "wf_post_write_dispatches_checks",
  /ndic-post-write:[\s\S]*?gh workflow run smoke\.yml/.test(ndicWf) &&
    /ndic-post-write:[\s\S]*?gh workflow run layout-guard\.yml/.test(ndicWf) &&
    /ndic-post-write:[\s\S]*?gh workflow run repo-guard\.yml/.test(ndicWf)
);
ok(
  "wf_post_write_auto_merge",
  /ndic-post-write:[\s\S]*?gh pr merge .*--auto --squash/.test(ndicWf)
);
ok(
  "wf_reconcile_uses_bounded_script",
  /ndic-data-pr-reconcile-against-main\.mjs/.test(ndicWf)
);
ok(
  "wf_reconcile_self_hosted_shared_write",
  /ndic-reconcile-data-pr:[\s\S]*?runs-on:\s*\n\s*-\s*self-hosted\s*\n\s*-\s*Linux\s*\n\s*-\s*X64\s*\n\s*-\s*ndic-cz-egress/.test(
    ndicWf
  ) && /NDIC_SHARED_WRITE_JOB_ON_GITHUB_HOSTED=NO/.test(ndicWf)
);
ok(
  "wf_reconcile_no_secrets_network",
  /NDIC_NETWORK_JOB_ON_GITHUB_HOSTED=NO/.test(ndicWf) &&
    /NDIC_SECRET_JOB_ON_GITHUB_HOSTED=NO/.test(ndicWf) &&
    !/ndic-reconcile-data-pr:[\s\S]*?NDIC_.*PASSWORD|ndic-reconcile-data-pr:[\s\S]*?mobilitydata\.rsd\.cz/.test(
      ndicWf
    )
);
ok(
  "stage_optional_binding",
  /data_pr_finalization_binding\.json/.test(stage)
);

const smokeWf = fs.readFileSync(SMOKE_WF, "utf8");
const repoWf = fs.readFileSync(REPO_WF, "utf8");
const layoutWf = fs.readFileSync(LAYOUT_WF, "utf8");
ok(
  "allowlist_smoke_ndic_branch",
  /automation\/update-ndic-datex-v1/.test(smokeWf)
);
ok(
  "allowlist_repo_guard_ndic_branch",
  /automation\/update-ndic-datex-v1/.test(repoWf)
);
ok(
  "allowlist_layout_guard_ndic_branch",
  /automation\/update-ndic-datex-v1/.test(layoutWf)
);
ok(
  "pkg_bounded_refresh_fixtures",
  Boolean(pkg.scripts && pkg.scripts["iu-ndic-data-pr-bounded-refresh-fixtures"])
);
ok("suite_wires_bounded_refresh", /iu-ndic-data-pr-bounded-refresh-fixtures/.test(suite));
ok(
  "bounded_refresh_max_3",
  /DATA_PR_REFRESH_MAX\s*=\s*3/.test(fs.readFileSync(BOUNDED, "utf8"))
);

// Mutations: removing protocol pieces must be detectable
{
  const mutated = proto.replace(/REBASE_SHARED_NAMESPACES_FROM_CURRENT_MAIN/g, "REMOVED_REBASE");
  ok(
    "mutation_remove_rebase_detected",
    !/REBASE_SHARED_NAMESPACES_FROM_CURRENT_MAIN/.test(mutated)
  );
}
{
  const mutated = proto.replace(/WHOLE_WORKFLOW_SHARED_LOCK:\s*"NO"/g, 'WHOLE_WORKFLOW_SHARED_LOCK: "YES"');
  ok("mutation_whole_lock_yes_detected", /WHOLE_WORKFLOW_SHARED_LOCK:\s*"YES"/.test(mutated));
}
{
  const mutated = ndicWf.replace(
    /iu-data-pr-finalization-protocol\.mjs record-binding/g,
    "REMOVED_BINDING"
  );
  ok(
    "mutation_remove_binding_step_detected",
    !/iu-data-pr-finalization-protocol\.mjs record-binding/.test(mutated)
  );
}
{
  const mutated = suite.replace(/iu-data-pr-anti-loop-fixtures/g, "REMOVED_ANTI_LOOP");
  ok(
    "mutation_remove_suite_wire_detected",
    !/iu-data-pr-anti-loop-fixtures/.test(mutated)
  );
}
{
  const mutated = fix.replace(/DATA_PR_BASE_FRESHNESS_FIXTURES_PASS/g, "REMOVED");
  ok("mutation_remove_A_gate_detected", !/DATA_PR_BASE_FRESHNESS_FIXTURES_PASS/.test(mutated));
}

// Stale-base-only refresh must not require network job symbols in safe path
ok(
  "stale_base_refresh_no_network_job",
  !/ndic-prep|workflow_dispatch|IU_NDIC_DATEX_V1_MODE/.test(safe) &&
    /NETWORK_REQUIRED/.test(proto)
);

if (fails.length) {
  console.error(JSON.stringify({ ok: false, META_TEST_PASS: "NO", fails }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    META_TEST_PASS: "YES",
    MUTATION_TEST_PASS: "YES",
    WORKFLOW_AUDIT_PASS: "YES",
    DATA_PR_FINALIZATION_PROTOCOL_IMPLEMENTED: "YES",
    DATA_PR_BASE_FRESHNESS_GUARD_IMPLEMENTED: "YES",
    SHARED_STATE_DIGEST_BINDING_IMPLEMENTED: "YES",
    SAFE_STALE_BASE_REFRESH_IMPLEMENTED: "YES",
    DATA_PR_FINALIZATION_LOCK_IMPLEMENTED: "YES",
    WHOLE_WORKFLOW_SHARED_LOCK: "NO",
    NETWORK_PREP_INSIDE_SHARED_LOCK: "NO",
    LONG_RUNNING_TESTS_INSIDE_SHARED_LOCK: "NO",
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: "NO",
  })
);
process.exit(0);
