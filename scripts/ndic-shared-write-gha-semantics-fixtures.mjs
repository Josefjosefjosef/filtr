#!/usr/bin/env node
/**
 * Static contract for the no-secret GHA semantics proof workflow.
 * Does not dispatch; proves the diagnostic workflow encodes the skipped-deps graph.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./ndic-staging-preflight-architecture-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF_DEDICATED = path.join(
  ROOT,
  ".github",
  "workflows",
  "ndic-shared-write-gha-semantics-proof.yml"
);
const WF_HOST = path.join(ROOT, ".github", "workflows", "ci-workflow-lint.yml");

const fails = [];
let pass = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else pass += 1;
}

function assertProofGraph(idPrefix, raw) {
  const src = stripComments(raw);
  ok(idPrefix + "no_ndic_secrets", !/secrets\.IU_NDIC_/.test(src));
  ok(idPrefix + "no_live_ndic_env", !/IU_NDIC_PULL_URL|IU_NDIC_TMC_PULL/.test(src));
  ok(idPrefix + "no_shared_writer_lock", !/info-events-data-writers/.test(src));
  ok(idPrefix + "no_data_pr_helper", !/ndic-open-or-refresh-data-pr/.test(src));
  ok(idPrefix + "has_schedule_like_gate", /schedule-like-gate:/.test(src));
  ok(idPrefix + "has_schedule_like_preflight", /schedule-like-preflight:/.test(src));
  ok(idPrefix + "has_prep_like", /prep-like:/.test(src));
  ok(idPrefix + "has_followup_fixed", /followup-fixed:/.test(src));
  ok(idPrefix + "has_followup_legacy", /followup-legacy-candidate-ready-gate:/.test(src));
  ok(
    idPrefix + "schedule_like_skipped_on_dispatch",
    /schedule-like-gate:[\s\S]*?github\.event_name == 'schedule'/.test(src)
  );
  ok(idPrefix + "prep_uses_cancelled_guard", /prep-like:[\s\S]*?!cancelled\(\)/.test(src));
  ok(
    idPrefix + "prep_needs_skipped_jobs",
    /prep-like:[\s\S]*?schedule-like-gate/.test(src) &&
      /prep-like:[\s\S]*?schedule-like-preflight/.test(src)
  );
  const beforeLegacy = src.split("followup-legacy-candidate-ready-gate:")[0] || src;
  ok(
    idPrefix + "fixed_uses_prep_result_not_outputs",
    /followup-fixed:[\s\S]*?needs\.prep-like\.result == 'success'/.test(src) &&
      !/followup-fixed:[\s\S]*?needs\.prep-like\.outputs\.candidate_ready/.test(beforeLegacy)
  );
  ok(
    idPrefix + "legacy_still_uses_candidate_ready_output",
    /followup-legacy-candidate-ready-gate:[\s\S]*?needs\.prep-like\.outputs\.candidate_ready == 'true'/.test(
      src
    )
  );
  ok(idPrefix + "fixed_downloads_artifact", /followup-fixed:[\s\S]*?download-artifact/.test(src));
  ok(
    idPrefix + "ubuntu_only_proof_runners",
    /ubuntu-latest/.test(src) && !/ndic-cz-egress/.test(src)
  );
}

ok("dedicated_proof_workflow_exists", fs.existsSync(WF_DEDICATED));
ok("host_proof_workflow_exists", fs.existsSync(WF_HOST));
assertProofGraph("dedicated_", fs.existsSync(WF_DEDICATED) ? fs.readFileSync(WF_DEDICATED, "utf8") : "");
assertProofGraph("host_", fs.existsSync(WF_HOST) ? fs.readFileSync(WF_HOST, "utf8") : "");
ok(
  "host_has_dispatch_input",
  /ndic_gha_semantics_proof:/.test(
    fs.existsSync(WF_HOST) ? fs.readFileSync(WF_HOST, "utf8") : ""
  )
);

const report = {
  suite: "NDIC_SHARED_WRITE_GHA_SEMANTICS_FIXTURES",
  total: pass + fails.length,
  success: pass,
  failure: fails.length,
  fails,
};

if (fails.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
