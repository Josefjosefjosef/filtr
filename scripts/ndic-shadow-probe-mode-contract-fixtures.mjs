#!/usr/bin/env node
/**
 * Shadow-probe dual-mode contract fixtures (static, offline, no NDIC, no secrets).
 *
 * Proves:
 * - mode choice enum is shadow | format_inspection (default shadow)
 * - shadow and format_inspection jobs are mutually exclusive
 * - unknown mode fails closed (mode-validate; no network job if)
 * - main workflow bypass / code_ref-only cannot activate feature inspection
 * - inspection path is TMC-only (no DATEX pull URL / shadow-run / importer)
 * - existing shadow path preserved (labels, secrets, report, cleanup, Node 24)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  stripComments,
  analyzeWorkflowSource,
  hasAllRequired,
  REQUIRED_LABELS,
} from "./ndic-self-hosted-runner-contract-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF_PATH = path.join(ROOT, ".github", "workflows", "ndic-datex-v1-shadow-probe.yml");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

const raw = fs.readFileSync(WF_PATH, "utf8");
const src = stripComments(raw);
const analysis = analyzeWorkflowSource("ndic-datex-v1-shadow-probe.yml", raw);
const jobs = analysis.jobs;
const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));

// --- inputs / enum ---
{
  ok("wf_name", /^name:\s*NDIC DATEX v1 shadow probe\s*$/m.test(raw), "name");
  ok("dispatch_only", /workflow_dispatch\s*:/.test(src) && !/^\s*schedule\s*:/m.test(src), "trig");
  ok("no_pr_trigger", !/^\s*pull_request\s*:/m.test(src) && !/^\s*pull_request_target\s*:/m.test(src), "pr");
  ok("no_push_trigger", !/^\s*push\s*:/m.test(src), "push");
  ok("mode_choice", /mode:[\s\S]*?type:\s*choice/.test(src), "choice");
  const modeBlock = (src.match(/mode:[\s\S]*?code_ref:/) || [""])[0];
  ok("mode_has_shadow", /-\s*shadow\b/.test(modeBlock), "shadow");
  ok("mode_has_format_inspection", /-\s*format_inspection\b/.test(modeBlock), "insp");
  ok("mode_no_active", !/-\s*active\b/.test(modeBlock), "active");
  ok("mode_no_publish", !/-\s*publish\b/.test(modeBlock), "pub");
  ok("mode_no_import", !/-\s*import\b/.test(modeBlock), "imp");
  ok("mode_no_resolver", !/-\s*resolver\b/.test(modeBlock), "res");
  ok("mode_no_production", !/-\s*production\b/.test(modeBlock), "prod");
  ok("mode_default_shadow", /default:\s*shadow\b/.test(modeBlock), "def");
  ok("mode_default_not_inspection", !/default:\s*format_inspection\b/.test(modeBlock), "definsp");
  ok("code_ref_allowlist", /feat\/ndic-datex-v1-integration/.test(src), "ref");
  ok("concurrency_group", /group:\s*ndic-datex-v1-shadow-probe/.test(src), "conc");
  ok("cancel_false", /cancel-in-progress:\s*false/.test(src), "cancel");
  ok("contents_read", /contents:\s*read/.test(src), "perms");
  ok("no_contents_write", !/contents:\s*write/.test(src), "write");
}

// --- jobs present ---
{
  ok("job_mode_validate", Boolean(byName["mode-validate"]), "mv");
  ok("job_shadow", Boolean(byName["shadow-probe"]), "sh");
  ok("job_inspection", Boolean(byName["format-inspection"]), "fi");
}

// --- mode-validate: hosted, no secrets, fail-closed ---
{
  const mv = byName["mode-validate"];
  ok("mv_ubuntu", mv && mv.isGithubHosted && mv.labels.includes("ubuntu-latest"), mv ? mv.labels.join("+") : "missing");
  ok("mv_no_ndic_caps", mv && mv.ndicCapabilities.length === 0, mv ? mv.ndicCapabilities.join("|") : "missing");
  ok("mv_no_secrets", mv && !/secrets\.IU_NDIC_/.test(mv.body), "sec");
  ok("mv_unknown_refuse", mv && /REFUSING_UNKNOWN_MODE/.test(mv.body), "unk");
  ok("mv_case_allowlist", mv && /shadow\|format_inspection/.test(mv.body), "case");
}

// --- mutual exclusion if conditions ---
{
  const sh = byName["shadow-probe"];
  const fi = byName["format-inspection"];
  const shIf = (raw.match(/shadow-probe:[\s\S]*?if:\s*>\s*\n([\s\S]*?)runs-on:/) || ["", ""])[1];
  const fiIf = (raw.match(/format-inspection:[\s\S]*?if:\s*>\s*\n([\s\S]*?)runs-on:/) || ["", ""])[1];
  ok("shadow_if_mode_shadow", /inputs\.mode\s*==\s*'shadow'/.test(shIf), shIf.trim().slice(0, 80));
  ok("inspect_if_mode_inspection", /inputs\.mode\s*==\s*'format_inspection'/.test(fiIf), fiIf.trim().slice(0, 80));
  ok("inspect_if_feature_ref", /ref_name\s*==\s*'feat\/ndic-datex-v1-integration'/.test(fiIf), "ref");
  ok("shadow_if_not_inspection", !/format_inspection/.test(shIf), "sh-no-insp");
  ok("inspect_if_not_shadow_eq", !/mode\s*==\s*'shadow'/.test(fiIf), "fi-no-sh");
  // Static mutual exclusion: conditions cannot both be true for same input.mode
  const bothCanRun =
    /inputs\.mode\s*==\s*'shadow'/.test(shIf) &&
    /inputs\.mode\s*==\s*'format_inspection'/.test(fiIf) &&
    /inputs\.mode\s*==\s*'shadow'/.test(fiIf);
  ok("both_network_jobs_cannot_run", !bothCanRun, "mutex");
  ok("shadow_needs_validate", sh && /needs:\s*mode-validate/.test(sh.body), "need-sh");
  ok("inspect_needs_validate", fi && /needs:\s*mode-validate/.test(fi.body), "need-fi");
  // Unknown mode: no network job if matches unknown
  ok("unknown_no_shadow_if", !/mode\s*!=\s*'/.test(shIf) && /mode\s*==\s*'shadow'/.test(shIf), "unk-sh");
  ok("unknown_no_inspect_if", /mode\s*==\s*'format_inspection'/.test(fiIf), "unk-fi");
}

// --- shadow path regression ---
{
  const sh = byName["shadow-probe"];
  ok("shadow_self_hosted", sh && sh.isSelfHosted && hasAllRequired(sh.labels), sh ? sh.labels.join("+") : "missing");
  ok("shadow_labels_contract", sh && REQUIRED_LABELS.every((l) => sh.labels.includes(l)), "labels");
  ok("shadow_identity_first", sh && /Preflight runner identity[\s\S]*actions\/checkout@/.test(sh.body), "id");
  ok("shadow_identity_before_secrets", sh && sh.body.indexOf("Preflight runner identity") < sh.body.search(/secrets\.IU_NDIC_/), "id-sec");
  ok("shadow_has_datex_url", sh && /secrets\.IU_NDIC_PULL_URL/.test(sh.body), "datex");
  ok("shadow_has_tmc_url", sh && /secrets\.IU_NDIC_TMC_PULL_URL/.test(sh.body), "tmc");
  ok("shadow_has_subscriber", sh && /secrets\.IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID/.test(sh.body), "sub");
  ok("shadow_runs_shadow_run", sh && /ndic-datex-v1-shadow-run\.mjs/.test(sh.body), "run");
  ok("shadow_no_inspection_run", sh && !/ndic-datex-v1-tmc-format-inspection-run\.mjs/.test(sh.body), "no-insp-run");
  ok("shadow_mode_env", sh && /IU_NDIC_DATEX_V1_MODE:\s*shadow/.test(sh.body), "env");
  ok("shadow_reject_non_shadow", sh && /REFUSING_NON_SHADOW_MODE/.test(sh.body), "rej");
  ok("shadow_node_24", sh && /node-version:\s*["']?24["']?/.test(sh.body), "n24");
  ok("shadow_artifact_json", sh && /shadow-report\.json/.test(sh.body), "art");
  ok("shadow_retention_1", sh && /retention-days:\s*1/.test(sh.body), "ret");
  ok("shadow_wipe_always", sh && /Wipe temp workdir[\s\S]*if:\s*always\(\)|if:\s*always\(\)[\s\S]*Wipe temp/.test(raw), "wipe");
  ok("shadow_fixture_before_probe", sh && /Fixture guards[\s\S]*Real shadow probe/.test(sh.body), "fx");
  ok("shadow_disk_fx", sh && /iu-ndic-disk-preflight-fixtures/.test(sh.body), "disk");
  ok("shadow_tmc_arch_fx", sh && /iu-ndic-tmc-archive-stream-fixtures/.test(sh.body), "tmcfx");
  ok("shadow_refuse_hosted", sh && /REFUSING_GITHUB_HOSTED/.test(sh.body), "refuse");
  ok("shadow_runner_name", sh && /infouzel-ndic-cz-vps4204/.test(sh.body), "name");
  ok("shadow_persist_false", sh && /persist-credentials:\s*false/.test(sh.body), "persist");
}

// --- inspection path contract ---
{
  const fi = byName["format-inspection"];
  ok("inspect_self_hosted", fi && fi.isSelfHosted && hasAllRequired(fi.labels), fi ? fi.labels.join("+") : "missing");
  ok("inspect_identity_before_checkout", fi && /Preflight runner identity[\s\S]*actions\/checkout@/.test(fi.body), "id");
  ok("inspect_mode_before_checkout", fi && /Enforce allowlisted mode and ref \(before checkout\)[\s\S]*actions\/checkout@/.test(fi.body), "mode");
  ok("inspect_identity_before_secrets", fi && fi.body.indexOf("Preflight runner identity") < fi.body.search(/secrets\.IU_NDIC_/), "id-sec");
  ok("inspect_head_gate", fi && /REFUSING_UNEXPECTED_HEAD/.test(fi.body), "head");
  ok("inspect_no_datex_pull_url", fi && !/secrets\.IU_NDIC_PULL_URL/.test(fi.body), "no-datex");
  ok("inspect_has_tmc_url", fi && /secrets\.IU_NDIC_TMC_PULL_URL/.test(fi.body), "tmc");
  ok("inspect_no_subscriber", fi && !/secrets\.IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID/.test(fi.body), "nosub");
  ok("inspect_no_shadow_run", fi && !/ndic-datex-v1-shadow-run\.mjs/.test(fi.body), "noshadow");
  ok("inspect_no_prod_sync", fi && !/ndic-datex-v1-prod-sync\.mjs/.test(fi.body), "nosync");
  ok("inspect_entrypoint", fi && /ndic-datex-v1-tmc-format-inspection-run\.mjs/.test(fi.body), "entry");
  ok("inspect_offline_ready", fi && /--offline-ready/.test(fi.body), "ready");
  ok("inspect_mode_env", fi && /IU_NDIC_DATEX_V1_MODE:\s*format_inspection/.test(fi.body), "env");
  ok("inspect_phases_not_run", fi && /DATEX_PHASE=NOT_RUN/.test(fi.body) && /REGULAR_SHADOW_PROBE=NOT_RUN/.test(fi.body), "phases");
  ok("inspect_no_importer_echo", fi && /TMC_IMPORTER_PHASE=NOT_RUN/.test(fi.body), "imp");
  ok("inspect_no_resolver_echo", fi && /TMC_RESOLVER_PHASE=NOT_RUN/.test(fi.body), "res");
  ok("inspect_no_publish_echo", fi && /PUBLISH_PHASE=NOT_RUN/.test(fi.body), "pub");
  ok("inspect_no_prod_write_echo", fi && /PRODUCTION_WRITE=NO/.test(fi.body), "pw");
  ok("inspect_artifact_exact", fi && /path:\s*\$\{\{\s*runner\.temp\s*\}\}\/ndic-inspect-report\/inspection-report\.json/.test(fi.body), "art");
  ok("inspect_artifact_no_glob", fi && !/\*/.test((fi.body.split("Upload sanitised")[1] || "").split("retention-days")[0] || "x"), "glob");
  ok("inspect_artifact_fail_missing", fi && /if-no-files-found:\s*error/.test(fi.body), "miss");
  ok("inspect_artifact_success_only", /Upload sanitised[\s\S]*sanitized_report_ready/.test(fi.body), "succ");
  ok("inspect_no_cat_full_report", !/cat\s+"\$REPORT"/.test(fi.body), "nocat");
  ok("inspect_preserve_failure", /INSPECTION_STEP_FAILED_PRESERVED/.test(fi.body), "pres");
  ok("inspect_retention_1", fi && /retention-days:\s*1/.test(fi.body), "ret");
  ok("inspect_cleanup_fenced", fi && /ndic-datex-v1-tmc-inspection-cleanup-run/.test(fi.body), "wipe");
  ok("inspect_fixtures_before_live", fi && /Fixture guards[\s\S]*Live TMC format inspection/.test(fi.body), "fx");
  ok("inspect_node_24", fi && /node-version:\s*["']?24["']?/.test(fi.body), "n24");
  ok("inspect_refuse_hosted", fi && /REFUSING_GITHUB_HOSTED/.test(fi.body), "refuse");
  ok("inspect_size_gate", fi && /65536/.test(fi.body), "size");
}

// --- main bypass (static): feature inspection requires feature workflow ref ---
{
  ok(
    "main_bypass_inspect_requires_ref_name",
    /format-inspection:[\s\S]*ref_name\s*==\s*'feat\/ndic-datex-v1-integration'/.test(raw),
    "refname"
  );
  ok(
    "code_ref_alone_insufficient",
    /REFUSING_NON_FEATURE_WORKFLOW_REF/.test(raw),
    "coderef"
  );
  // Simulate: if mode were somehow format_inspection on a body without ref_name gate → fail our contract
  const syntheticMainLike = `
name: NDIC DATEX v1 shadow probe
on:
  workflow_dispatch:
    inputs:
      mode:
        type: choice
        options:
          - shadow
        default: shadow
jobs:
  shadow-probe:
    runs-on: ubuntu-latest
    steps:
      - run: echo shadow-only
`;
  const mainLike = analyzeWorkflowSource("ndic-datex-v1-shadow-probe.yml", syntheticMainLike);
  ok("main_like_no_inspection_job", !mainLike.jobs.some((j) => j.name === "format-inspection"), "mainjobs");
  ok("main_like_no_format_option", !/format_inspection/.test(syntheticMainLike), "mainopt");
}

// --- wrong SHA fail-closed present on inspection ---
{
  ok("wrong_sha_refuse", /REFUSING_UNEXPECTED_HEAD/.test(raw), "sha");
  ok(
    "checkout_uses_code_ref",
    /ref:\s*\$\{\{\s*github\.event\.inputs\.code_ref\s*\}\}/.test(src),
    "checkout"
  );
}

// --- network job count ---
{
  const netJobs = jobs.filter((j) => j.ndicCapabilities.length > 0);
  ok("exactly_two_network_jobs", netJobs.length === 2, String(netJobs.map((j) => j.name)));
  ok(
    "network_job_names",
    netJobs.every((j) => j.name === "shadow-probe" || j.name === "format-inspection"),
    netJobs.map((j) => j.name).join(",")
  );
}

if (fails.length) {
  console.error("[ndic-shadow-probe-mode-contract-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    modeOptions: ["shadow", "format_inspection"],
    defaultMode: "shadow",
    jobs: jobs.map((j) => j.name),
    mutuallyExclusive: true,
    node: process.version,
  })
);
