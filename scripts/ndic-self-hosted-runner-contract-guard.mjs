#!/usr/bin/env node
/**
 * Guard: NDIC Czech self-hosted runner contract (static, no network, no secrets).
 *
 * FAIL if any GitHub-hosted job can:
 * - receive IU_NDIC_* secrets
 * - run NDIC downloader / prod-sync / shadow-run
 * - build Basic Auth for NDIC
 * - contact mobilitydata.rsd.cz / approved NDIC hosts
 *
 * Exit 0 = PASS, 1 = FAIL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WF_DIR = path.join(ROOT, ".github", "workflows");

export const REQUIRED_LABELS = ["self-hosted", "Linux", "X64", "ndic-cz-egress"];
export const EXPECTED_RUNNER_NAME = "infouzel-ndic-cz-vps4204";

/** Workflows allowed to host a real NDIC network job on the Czech labels. */
export const APPROVED_NDIC_NETWORK_WORKFLOWS = Object.freeze({
  "ndic-datex-v1-shadow-probe.yml": "shadow",
  "update-ndic-datex-v1.yml": "update",
});

/** Workflows allowed for TMC format inspection (self-hosted CZ; no importer/publish). */
export const APPROVED_NDIC_INSPECTION_WORKFLOWS = Object.freeze({
  "ndic-datex-v1-tmc-format-inspection.yml": "format_inspection",
});

const FORBIDDEN_TRIGGERS = ["pull_request:", "pull_request_target:", "workflow_run:"];

const NDIC_CAPABILITY_PATTERNS = [
  /secrets\.IU_NDIC_/,
  /IU_NDIC_PULL_URL\s*:/,
  /IU_NDIC_PULL_USER\s*:/,
  /IU_NDIC_PULL_PASS\s*:/,
  /IU_NDIC_TMC_PULL_URL\s*:/,
  /IU_NDIC_TMC_PULL_USER\s*:/,
  /IU_NDIC_TMC_PULL_PASS\s*:/,
  /IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID\s*:/,
  /ndic-datex-v1-prod-sync\.mjs/,
  /ndic-datex-v1-shadow-run\.mjs/,
  /ndic-datex-v1-shadow-probe\.mjs/,
  /ndic-datex-v1-tmc-format-inspection-run\.mjs/,
  // NDIC shared-write critical section must never land on GitHub-hosted.
  /info-events-shared-writer-critical\.mjs\s+ndic/,
  /mobilitydata\.rsd\.cz/,
  /Authorization:\s*`Basic/,
  /Authorization:\s*Basic/,
];

export function stripComments(src) {
  return String(src || "")
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf("#");
      if (idx < 0) return line;
      const before = line.slice(0, idx);
      if ((before.match(/"/g) || []).length % 2 === 1) return line;
      if ((before.match(/'/g) || []).length % 2 === 1) return line;
      return before;
    })
    .join("\n");
}

export function extractRunsOnFromChunk(chunk) {
  const lines = String(chunk || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)runs-on\s*:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const inline = String(m[2] || "").trim();
    if (inline && inline !== "|" && inline !== ">") {
      if (inline.startsWith("[")) {
        const inner = inline.replace(/^\[/, "").replace(/\]$/, "");
        return inner
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }
      return [inline.replace(/^['"]|['"]$/g, "")];
    }
    const labels = [];
    for (let j = i + 1; j < lines.length; j++) {
      const lm = lines[j].match(/^(\s*)-\s*(.+?)\s*$/);
      if (!lm) break;
      if (lm[1].length <= indent) break;
      labels.push(lm[2].replace(/^['"]|['"]$/g, "").trim());
    }
    return labels;
  }
  return [];
}

/**
 * Split workflow YAML into job name → body (best-effort static scan).
 * @param {string} src
 */
export function extractJobs(src) {
  const lines = String(src || "").split(/\r?\n/);
  let inJobs = false;
  const jobs = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inJobs) {
      if (/^jobs\s*:/.test(line)) inJobs = true;
      continue;
    }
    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+)\s*:\s*$/);
    if (jobMatch) {
      if (current) jobs.push(current);
      current = { name: jobMatch[1], startLine: i + 1, lines: [] };
      continue;
    }
    if (/^[A-Za-z]/.test(line) && !/^\s/.test(line)) {
      // top-level key after jobs — end
      break;
    }
    if (current) current.lines.push(line);
  }
  if (current) jobs.push(current);
  return jobs.map((j) => {
    const body = j.lines.join("\n");
    const labels = extractRunsOnFromChunk(body);
    return {
      name: j.name,
      startLine: j.startLine,
      body,
      labels,
      isSelfHosted: labels.some((l) => l === "self-hosted" || String(l).startsWith("self-hosted")),
      isGithubHosted:
        labels.includes("ubuntu-latest") ||
        labels.some((l) => /^ubuntu-/.test(l)) ||
        labels.some((l) => /^windows-/.test(l)) ||
        labels.some((l) => /^macos-/.test(l)),
      hasDynamicRunsOn: /runs-on\s*:[^\n]*\$\{\{/.test(body),
      ndicCapabilities: detectNdicCapabilities(body),
    };
  });
}

export function detectNdicCapabilities(body) {
  const hits = [];
  const text = String(body || "");
  for (const re of NDIC_CAPABILITY_PATTERNS) {
    if (re.test(text)) hits.push(String(re));
  }
  return hits;
}

export function hasAllRequired(labels) {
  return REQUIRED_LABELS.every((need) => (labels || []).includes(need));
}

export function analyzeWorkflowSource(fileName, raw) {
  const src = stripComments(raw);
  const jobs = extractJobs(src);
  const issues = [];
  const approvedNetworkKind = APPROVED_NDIC_NETWORK_WORKFLOWS[fileName] || null;
  const approvedInspectionKind = APPROVED_NDIC_INSPECTION_WORKFLOWS[fileName] || null;
  const approvedKind = approvedNetworkKind || approvedInspectionKind || null;

  for (const job of jobs) {
    if (job.hasDynamicRunsOn) {
      issues.push({
        id: "dynamic_runs_on",
        file: fileName,
        job: job.name,
        detail: "runs-on uses expression",
      });
    }

    const hasNdic = job.ndicCapabilities.length > 0;
    const hasNdicLabel = (job.labels || []).includes("ndic-cz-egress");

    if (hasNdic && (job.isGithubHosted || (!job.isSelfHosted && job.labels.length))) {
      issues.push({
        id: "github_hosted_ndic_capability",
        file: fileName,
        job: job.name,
        detail: job.ndicCapabilities.slice(0, 3).join("|"),
      });
    }

    if (job.isSelfHosted) {
      if (!approvedKind) {
        issues.push({
          id: "foreign_self_hosted",
          file: fileName,
          job: job.name,
          detail: (job.labels || []).join("+"),
        });
      } else if (!hasAllRequired(job.labels)) {
        issues.push({
          id: "incomplete_ndic_labels",
          file: fileName,
          job: job.name,
          detail: (job.labels || []).join("+"),
        });
      }
    }

    if (hasNdicLabel && !approvedKind) {
      issues.push({
        id: "foreign_ndic_label",
        file: fileName,
        job: job.name,
        detail: "ndic-cz-egress",
      });
    }

    // Network jobs with NDIC caps, and all approved inspection jobs, need identity preflight.
    const needsPreflight =
      (hasNdic && job.isSelfHosted && approvedNetworkKind) ||
      (job.isSelfHosted && approvedInspectionKind);
    if (needsPreflight) {
      if (!/Preflight runner identity/.test(job.body) && !/REFUSING_GITHUB_HOSTED/.test(job.body)) {
        issues.push({
          id: "missing_preflight",
          file: fileName,
          job: job.name,
          detail: "no identity preflight",
        });
      } else {
        const pre = job.body.indexOf("Preflight runner identity");
        const secrets = job.body.search(/secrets\.IU_NDIC_/);
        const checkout = job.body.indexOf("actions/checkout@");
        if (pre >= 0 && secrets >= 0 && !(pre < secrets)) {
          issues.push({
            id: "preflight_after_secrets",
            file: fileName,
            job: job.name,
            detail: "order",
          });
        }
        if (pre >= 0 && checkout >= 0 && !(pre < checkout)) {
          issues.push({
            id: "preflight_after_checkout",
            file: fileName,
            job: job.name,
            detail: "order",
          });
        }
        if (!new RegExp(EXPECTED_RUNNER_NAME).test(job.body)) {
          issues.push({
            id: "missing_expected_runner_name",
            file: fileName,
            job: job.name,
            detail: EXPECTED_RUNNER_NAME,
          });
        }
      }
    }
  }

  return {
    fileName,
    jobs,
    issues,
    approvedKind,
    approvedNetworkKind,
    approvedInspectionKind,
    src,
    raw,
  };
}

/**
 * Analyze synthetic workflow YAML (fixtures).
 * @param {string} yaml
 * @param {string} [fileName]
 */
export function analyzeWorkflowYaml(yaml, fileName = "fixture.yml") {
  return analyzeWorkflowSource(fileName, yaml);
}

function hasTrigger(src, key) {
  const re = new RegExp("(^|\\n)\\s*" + key.replace(":", "\\s*:"), "m");
  return re.test(src);
}

function main() {
  const fails = [];
  function ok(id, cond, detail) {
    if (!cond) fails.push(id + (detail ? ":" + detail : ""));
  }

  const files = fs.existsSync(WF_DIR)
    ? fs
        .readdirSync(WF_DIR)
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
        .sort()
    : [];
  ok("workflows_dir", files.length > 0, "empty");

  let ndicSelfHostedJobs = 0;
  let githubHostedNdicJobs = 0;

  for (const file of files) {
    const abs = path.join(WF_DIR, file);
    const raw = fs.readFileSync(abs, "utf8");
    const analysis = analyzeWorkflowSource(file, raw);
    for (const issue of analysis.issues) {
      ok(issue.id + "_" + issue.file + "_" + issue.job, false, issue.detail);
      if (issue.id === "github_hosted_ndic_capability") githubHostedNdicJobs += 1;
    }
    for (const job of analysis.jobs) {
      if (job.isSelfHosted && hasAllRequired(job.labels)) ndicSelfHostedJobs += 1;
    }

    if (file === "ndic-datex-v1-shadow-probe.yml") {
      const src = analysis.src;
      const shadowJob = analysis.jobs.find((j) => j.name === "shadow-probe");
      const inspectJob = analysis.jobs.find((j) => j.name === "format-inspection");
      const validateJob = analysis.jobs.find((j) => j.name === "mode-validate");
      ok("shadow_has_self_hosted", analysis.jobs.some((j) => j.isSelfHosted), "missing");
      for (const t of FORBIDDEN_TRIGGERS) {
        ok("shadow_no_trigger_" + t.replace(":", ""), !hasTrigger(src, t), "present");
      }
      ok("shadow_dispatch", /workflow_dispatch\s*:/.test(src), "missing");
      ok("shadow_contents_read", /contents\s*:\s*read/.test(src), "perms");
      ok("shadow_no_contents_write", !/contents\s*:\s*write/.test(src), "write");
      ok("shadow_persist_false", /persist-credentials\s*:\s*false/.test(src), "persist");
      ok(
        "shadow_choice_shadow_and_inspection",
        /-\s*shadow/.test(src) && /-\s*format_inspection/.test(src) && !/options:[\s\S]*?-\s*active/.test(src),
        "options"
      );
      ok("shadow_default_not_inspection", /default:\s*shadow\b/.test(src) && !/default:\s*format_inspection\b/.test(src), "def");
      // mode-validate may use ubuntu-latest (no secrets); network jobs must not.
      ok("shadow_validate_ubuntu", Boolean(validateJob) && validateJob.isGithubHosted, "validate");
      ok("shadow_validate_no_secrets", validateJob && !/secrets\.IU_NDIC_/.test(validateJob.body), "val-sec");
      ok("shadow_validate_unknown_fail", validateJob && /REFUSING_UNKNOWN_MODE/.test(validateJob.body), "unk");
      ok(
        "shadow_network_jobs_no_ubuntu",
        shadowJob && !/ubuntu-latest/.test(shadowJob.body) && inspectJob && !/ubuntu-latest/.test(inspectJob.body),
        "ubuntu"
      );
      ok(
        "shadow_two_network_jobs",
        analysis.jobs.filter((j) => j.ndicCapabilities.length).length === 2,
        "jobs"
      );
      ok("shadow_mutex_shadow_if", shadowJob && /inputs\.mode\s*==\s*'shadow'/.test(shadowJob.body), "if-sh");
      ok(
        "shadow_mutex_inspect_if",
        inspectJob && /inputs\.mode\s*==\s*'format_inspection'/.test(inspectJob.body),
        "if-fi"
      );
      ok(
        "shadow_inspect_requires_feature_ref",
        inspectJob && /ref_name\s*==\s*'feat\/ndic-datex-v1-integration'/.test(inspectJob.body),
        "refname"
      );
      ok("shadow_code_ref_allowlist", /feat\/ndic-datex-v1-integration/.test(src), "ref");
      // Main bypass: runs-on must be static on the workflow itself (not only after checkout).
      ok(
        "shadow_runs_on_not_from_code_ref",
        /runs-on:\s*\n\s*-\s*self-hosted\s*\n\s*-\s*Linux\s*\n\s*-\s*X64\s*\n\s*-\s*ndic-cz-egress/.test(src),
        "labels"
      );
      ok("shadow_refuse_github_hosted", /REFUSING_GITHUB_HOSTED/.test(raw), "refuse");
      ok("shadow_runner_name", /infouzel-ndic-cz-vps4204/.test(raw), "name");
      ok("shadow_node_24", /node-version:\s*["']?24["']?/.test(src), "node24");
      ok("shadow_no_node_20", !/node-version:\s*["']?20["']?/.test(src), "node20");
      ok("shadow_setup_node_v7", /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/.test(src), "setup");
      ok("shadow_upload_artifact_v7", /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/.test(src), "artifact");
      ok("shadow_no_unsecure_node_env", !/ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION/.test(raw), "unsecure");
      ok("shadow_fixture_disk_preflight", /iu-ndic-disk-preflight-fixtures/.test(src), "disk-fx");
      ok("shadow_fixture_tmc_archive", /iu-ndic-tmc-archive-stream-fixtures/.test(src), "tmc-fx");
      ok("shadow_fixture_sp08001", /iu-ndic-tmc-sp08001-contract-fixtures/.test(src), "sp08001-fx");
      ok("shadow_fixture_stream_peek", /iu-ndic-tmc-stream-peek-fixtures/.test(src), "peek-fx");
      ok("shadow_fixture_format_promotion", /iu-ndic-tmc-sp08001-format-promotion-fixtures/.test(src), "promo-fx");
      ok("shadow_fixture_inspection", /iu-ndic-tmc-format-inspection-fixtures/.test(src), "insp-fx");
      ok("shadow_fixture_mode_contract", /iu-ndic-shadow-probe-mode-contract-fixtures/.test(src), "mode-fx");
      ok("shadow_fixture_redaction", /iu-ndic-shadow-report-redaction-guard/.test(src), "redact-fx");
      ok("shadow_fixture_before_probe", /Fixture guards[\s\S]*iu-ndic-tmc-archive-stream-fixtures[\s\S]*Real shadow probe/.test(src), "order");
      ok(
        "shadow_sp08001_before_live",
        /iu-ndic-tmc-sp08001-contract-fixtures[\s\S]*Live TMC format inspection|iu-ndic-tmc-sp08001-contract-fixtures[\s\S]*Real shadow probe/.test(src),
        "sp-order"
      );
      ok("shadow_inspect_no_datex_url", inspectJob && !/secrets\.IU_NDIC_PULL_URL/.test(inspectJob.body), "no-datex");
      ok("shadow_inspect_tmc_only_run", inspectJob && /ndic-datex-v1-tmc-format-inspection-run\.mjs/.test(inspectJob.body), "insp-run");
      ok("shadow_inspect_no_shadow_run", inspectJob && !/ndic-datex-v1-shadow-run\.mjs/.test(inspectJob.body), "no-sh-run");
      ok("shadow_job_has_shadow_run", shadowJob && /ndic-datex-v1-shadow-run\.mjs/.test(shadowJob.body), "sh-run");
      ok("shadow_job_no_inspection_run", shadowJob && !/ndic-datex-v1-tmc-format-inspection-run\.mjs/.test(shadowJob.body), "sh-no-insp");
      ok("shadow_inspect_head_gate", inspectJob && /REFUSING_UNEXPECTED_HEAD/.test(inspectJob.body), "head");
      ok("shadow_inspect_mode_before_checkout", inspectJob && /before checkout[\s\S]*actions\/checkout@/.test(inspectJob.body), "mode-ord");
      ok(
        "shadow_inspect_artifact_exact",
        inspectJob &&
          /path:\s*\$\{\{\s*runner\.temp\s*\}\}\/ndic-inspect-report\/inspection-report\.json/.test(inspectJob.body),
        "art"
      );
    }

    if (file === "ndic-datex-v1-tmc-format-inspection.yml") {
      const src = analysis.src;
      ok("inspect_self_hosted", analysis.jobs.some((j) => j.isSelfHosted), "sh");
      ok("inspect_dispatch", /workflow_dispatch\s*:/.test(src), "dispatch");
      ok("inspect_mode_only", /format_inspection/.test(src) && !/options:[\s\S]*?-\s*active/.test(src), "mode");
      ok("inspect_no_ubuntu", !/ubuntu-latest/.test(src), "ubuntu");
      ok("inspect_has_tmc_secrets", /secrets\.IU_NDIC_TMC_PULL_URL/.test(src), "tmc-secrets");
      ok("inspect_no_datex_pull_url", !/secrets\.IU_NDIC_PULL_URL/.test(src), "no-datex-url");
      ok("inspect_no_importer_run", !/ndic-datex-v1-prod-sync|importerActivated:\s*true/.test(src), "imp");
      ok("inspect_node_24", /node-version:\s*["']?24["']?/.test(src), "node24");
      ok("inspect_fixture_inspection", /iu-ndic-tmc-format-inspection-fixtures/.test(src), "fx");
      ok("inspect_fixture_sp08001", /iu-ndic-tmc-sp08001-contract-fixtures/.test(src), "sp08001");
      ok("inspect_fixture_stream_peek", /iu-ndic-tmc-stream-peek-fixtures/.test(src), "peek");
      ok("inspect_fixture_format_promotion", /iu-ndic-tmc-sp08001-format-promotion-fixtures/.test(src), "promo");
      ok("inspect_fixture_archive", /iu-ndic-tmc-archive-stream-fixtures/.test(src), "arch");
      ok("inspect_fixture_disk", /iu-ndic-disk-preflight-fixtures/.test(src), "disk");
      ok("inspect_offline_ready", /--offline-ready/.test(src), "ready");
      ok(
        "inspect_live_run",
        /node scripts\/ndic-datex-v1-tmc-format-inspection-run\.mjs\s*$/m.test(src),
        "live"
      );
      ok("inspect_fixtures_before_live", /Fixture guards[\s\S]*Live TMC format inspection/.test(src), "order");
      ok("inspect_sp08001_before_live", /iu-ndic-tmc-sp08001-contract-fixtures[\s\S]*Live TMC format inspection/.test(src), "sp-ord");
      ok("inspect_mode_before_checkout", /Enforce allowlisted mode and ref \(before checkout\)[\s\S]*actions\/checkout@/.test(src), "mode-order");
      ok("inspect_identity_before_checkout", /Preflight runner identity[\s\S]*actions\/checkout@/.test(src), "id-order");
      ok("inspect_head_before_live", /REFUSING_UNEXPECTED_HEAD[\s\S]*Live TMC format inspection/.test(src), "head");
      ok("inspect_artifact_sanitised", /ndic-tmc-format-inspection-report/.test(src), "art");
      ok("inspect_artifact_exact_file", /path:\s*\$\{\{\s*runner\.temp\s*\}\}\/ndic-inspect-report\/inspection-report\.json/.test(src), "exact");
      ok("inspect_artifact_no_glob", !/path:[\s\S]*\*/.test(src.split("Upload sanitised")[1] || ""), "noglob");
      ok("inspect_artifact_fail_missing", /if-no-files-found:\s*error/.test(src), "missing");
      ok("inspect_artifact_success_only", /Upload sanitised[\s\S]*sanitized_report_ready/.test(src), "succ");
      ok("inspect_no_cat_full_report", !/cat\s+"\$REPORT"/.test(src), "nocat");
      ok("inspect_preserve_failure", /INSPECTION_STEP_FAILED_PRESERVED/.test(src), "pres");
      ok("inspect_report_size_gate", /65536/.test(src), "size");
      ok("inspect_wipe_fenced", /ndic-datex-v1-tmc-inspection-cleanup-run/.test(src), "wipe");
      ok("inspect_runs_on_labels", /runs-on:\s*\n\s*-\s*self-hosted\s*\n\s*-\s*Linux\s*\n\s*-\s*X64\s*\n\s*-\s*ndic-cz-egress/.test(src), "labels");
      ok("inspect_refuse_github_hosted", /REFUSING_GITHUB_HOSTED/.test(analysis.raw), "refuse");
      ok("inspect_runner_name", /infouzel-ndic-cz-vps4204/.test(analysis.raw), "name");
      ok("inspect_upload_artifact_v7", /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/.test(src), "artifact");
      ok("inspect_not_run_on_fixture_fail", /LIVE_FORMAT_INSPECTION=NOT_RUN/.test(src), "notrun");
      ok("inspect_no_schedule", !hasTrigger(src, "schedule:"), "sched");
      ok("inspect_no_push", !hasTrigger(src, "push:"), "push");
      ok("inspect_no_pr", !hasTrigger(src, "pull_request:"), "pr");
      ok("inspect_cancel_false", /cancel-in-progress:\s*false/.test(src), "cancel");
    }

    if (file === "update-ndic-datex-v1.yml") {
      const offline = analysis.jobs.find((j) => j.name === "offline-guards");
      const network = analysis.jobs.find((j) => j.name === "ndic-prep");
      const sharedWrite = analysis.jobs.find((j) => j.name === "ndic-shared-write");
      const scheduleGate = analysis.jobs.find((j) => j.name === "schedule-gate");
      const scheduledPreflight = analysis.jobs.find((j) => j.name === "scheduled-preflight");
      const reconcile = analysis.jobs.find((j) => j.name === "ndic-reconcile-data-pr");
      const postWrite = analysis.jobs.find((j) => j.name === "ndic-post-write");
      // Two-phase staging: GitHub-hosted guards live in ndic-datex-v1-staging-preflight.yml.
      // Network + shared-write / reconcile must NOT use ubuntu-latest (incident 31118898675 + writer isolation).
      // Allowed GitHub-hosted: schedule gate, inline preflight, and post-write (checks/auto-merge only).
      const githubHostedAllowed = new Set([
        "schedule-gate",
        "scheduled-preflight",
        "ndic-post-write",
      ]);
      ok("update_no_offline_guards_job", !offline, offline ? "present" : "ok");
      ok("update_has_network_job", Boolean(network), "missing");
      ok("update_has_shared_write_job", Boolean(sharedWrite), "missing");
      ok("update_has_reconcile_job", Boolean(reconcile), "missing");
      ok("update_has_post_write_job", Boolean(postWrite), "missing");
      ok("update_has_schedule_gate_job", Boolean(scheduleGate), "missing");
      ok("update_has_scheduled_preflight_job", Boolean(scheduledPreflight), "missing");
      ok(
        "update_ubuntu_only_on_schedule_jobs",
        analysis.jobs
          .filter((j) => j.isGithubHosted)
          .every((j) => githubHostedAllowed.has(j.name)),
        analysis.jobs
          .filter((j) => j.isGithubHosted)
          .map((j) => j.name)
          .join("+")
      );
      if (reconcile) {
        ok("update_reconcile_self_hosted", reconcile.isSelfHosted === true, "hosted");
        ok("update_reconcile_no_secrets", !/secrets\.IU_NDIC_/.test(reconcile.body), "secrets");
        ok("update_reconcile_no_sync", !/ndic-datex-v1-prod-sync/.test(reconcile.body), "sync");
      }
      if (postWrite) {
        ok("update_post_write_github_hosted", postWrite.isGithubHosted === true, "hosted");
        ok("update_post_write_no_secrets", !/secrets\.IU_NDIC_/.test(postWrite.body), "secrets");
        ok("update_post_write_no_sync", !/ndic-datex-v1-prod-sync/.test(postWrite.body), "sync");
        ok(
          "update_post_write_no_shared_lock",
          !/group:\s*info-events-data-writers/.test(postWrite.body),
          "lock"
        );
      }
      if (scheduleGate) {
        ok("update_schedule_gate_no_secrets", !/secrets\.IU_NDIC_/.test(scheduleGate.body), "secrets");
        ok("update_schedule_gate_arming", /vars\.NDIC_AUTOMATION_ENABLED/.test(scheduleGate.body), "arming");
        ok("update_schedule_gate_inflight", /ndic-schedule-arming\.mjs/.test(scheduleGate.body), "inflight");
      }
      if (scheduledPreflight) {
        ok(
          "update_scheduled_preflight_no_secrets",
          !/secrets\.IU_NDIC_/.test(scheduledPreflight.body),
          "secrets"
        );
        ok(
          "update_scheduled_preflight_no_sync",
          !/ndic-datex-v1-prod-sync/.test(scheduledPreflight.body),
          "sync"
        );
        ok(
          "update_scheduled_preflight_publishes",
          /ndic-publish-preflight-attestation\.mjs/.test(scheduledPreflight.body),
          "publish"
        );
      }
      ok("update_node_24", /node-version:\s*["']?24["']?/.test(analysis.src), "node24");
      ok("update_no_node_20", !/node-version:\s*["']?20["']?/.test(analysis.src), "node20");
      ok("update_setup_node_v7", /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/.test(analysis.src), "setup");
      ok("update_no_unsecure_node_env", !/ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION/.test(analysis.raw), "unsecure");
      ok(
        "update_requires_preflight_attestation",
        /ndic-verify-preflight-attestation\.mjs/.test(analysis.src),
        "verify"
      );
      if (network) {
        ok("update_network_self_hosted", network.isSelfHosted && hasAllRequired(network.labels), network.labels.join("+"));
        ok("update_network_has_secrets", /secrets\.IU_NDIC_PULL_URL/.test(network.body), "secrets");
        ok("update_network_has_sync", /ndic-datex-v1-prod-sync/.test(network.body), "sync");
        ok("update_network_preflight", /REFUSING_GITHUB_HOSTED/.test(network.body), "preflight");
        ok("update_network_if_not_off", /mode == 'shadow'|mode == \"shadow\"/.test(network.body) || /inputs\.mode == 'shadow'/.test(analysis.raw), "if");
        ok(
          "update_verify_before_secrets",
          /ndic-verify-preflight-attestation\.mjs[\s\S]*secrets\.IU_NDIC_PULL_URL/.test(network.body),
          "order"
        );
        ok("update_network_no_shared_lock", !/group:\s*info-events-data-writers/.test(network.body), "prep-lock");
      }
      if (sharedWrite) {
        ok(
          "update_shared_write_self_hosted",
          sharedWrite.isSelfHosted && hasAllRequired(sharedWrite.labels),
          sharedWrite.labels.join("+")
        );
        ok("update_shared_write_no_secrets", !/secrets\.IU_NDIC_/.test(sharedWrite.body), "secrets");
        ok("update_shared_write_no_sync", !/ndic-datex-v1-prod-sync/.test(sharedWrite.body), "sync");
        ok("update_shared_write_has_lock", /group:\s*info-events-data-writers/.test(sharedWrite.body), "lock");
        ok(
          "update_shared_write_reread",
          /info-events-shared-writer-critical\.mjs\s+ndic/.test(sharedWrite.body),
          "reread"
        );
        ok(
          "update_shared_write_two_source",
          /path:\s*ndic-orch\b/.test(sharedWrite.body) &&
            /path:\s*ndic-main-data\b/.test(sharedWrite.body) &&
            /ndic-orch\/scripts\/info-events-shared-writer-critical\.mjs\s+ndic/.test(
              sharedWrite.body
            ),
          "two-source"
        );
        ok("update_shared_write_preflight", /REFUSING_GITHUB_HOSTED/.test(sharedWrite.body), "preflight");
        ok("update_shared_write_not_github_hosted", !sharedWrite.isGithubHosted, "hosted");
      }
    }

    if (file === "ndic-datex-v1-staging-preflight.yml") {
      const src = analysis.src;
      ok("pf_dispatch_only", /workflow_dispatch\s*:/.test(src), "dispatch");
      ok("pf_ubuntu", /ubuntu-latest/.test(src), "ubuntu");
      ok("pf_no_ndic_secrets", !/secrets\.IU_NDIC_/.test(src), "secrets");
      ok("pf_no_prod_sync", !/ndic-datex-v1-prod-sync\.mjs/.test(src), "sync");
      ok("pf_publish_attestation", /ndic-publish-preflight-attestation\.mjs/.test(src), "publish");
      ok("pf_no_workflow_run", !hasTrigger(src, "workflow_run:"), "wfrun");
      ok("pf_no_schedule", !hasTrigger(src, "schedule:"), "sched");
      ok("pf_no_push", !hasTrigger(src, "push:"), "push");
      ok("pf_cancel_false", /cancel-in-progress:\s*false/.test(src), "cancel");
    }
  }

  // Runtime refuse must exist so main ubuntu + code_ref checkout cannot contact NDIC
  {
    const idPath = path.join(ROOT, "scripts", "ndic-datex-v1", "runner-identity.mjs");
    ok("runner_identity_module", fs.existsSync(idPath), "missing");
    if (fs.existsSync(idPath)) {
      const s = fs.readFileSync(idPath, "utf8");
      ok("runner_identity_refuse_hosted", /REFUSING_GITHUB_HOSTED/.test(s), "hosted");
      ok("runner_identity_name", /infouzel-ndic-cz-vps4204/.test(s), "name");
      ok("runner_identity_home_runner", /\/home\/runner/.test(s), "path");
    }
    const probe = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-shadow-probe.mjs"), "utf8");
    const run = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-shadow-run.mjs"), "utf8");
    const sync = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-prod-sync.mjs"), "utf8");
    ok("probe_calls_identity", /assertNdicCzechEgressRunnerOrThrow/.test(probe), "probe");
    ok("run_calls_identity", /assertNdicCzechEgressRunnerOrThrow/.test(run), "run");
    ok("sync_calls_identity", /assertNdicCzechEgressRunnerOrThrow/.test(sync), "sync");
  }

  {
    const al = path.join(ROOT, ".github", "actionlint.yaml");
    ok("actionlint_config_present", fs.existsSync(al), "missing");
    if (fs.existsSync(al)) {
      ok("actionlint_has_ndic_label", /ndic-cz-egress/.test(fs.readFileSync(al, "utf8")), "label");
    }
  }

  // Disk preflight module (shadow #9 root-cause fix)
  {
    const diskPath = path.join(ROOT, "scripts", "ndic-datex-v1", "disk-preflight.mjs");
    ok("disk_preflight_present", fs.existsSync(diskPath), "missing");
    if (fs.existsSync(diskPath)) {
      const d = fs.readFileSync(diskPath, "utf8");
      ok("disk_formula_v2", /tmc-disk-v2/.test(d), "ver");
      ok("disk_uses_bigint", /bigint:\s*true/.test(d) || /BigInt/.test(d), "bigint");
      ok("disk_prefers_frsize", /frsize/.test(d), "frsize");
      ok("disk_no_flat_2gib_only", !/free\s*<\s*lim\.minFreeDiskBytes/.test(d), "flat");
      ok("disk_task_owned", /IU_NDIC_SHADOW_WORK_DIR|RUNNER_TEMP/.test(d), "task");
      ok("disk_test_provider_api_only", /createTestDiskStatsProvider/.test(d), "provider");
      ok("disk_forbidden_test_env", /FORBIDDEN_TEST_DISK_ENV_KEYS/.test(d), "envkeys");
      ok("disk_refuse_provider_in_shadow", /refuseTestDiskProviderInShadow|REFUSING_TEST_DISK_PROVIDER_IN_SHADOW/.test(d), "refuse");
      ok("disk_reserves_index_64", /indexReserveBytes:\s*64\s*\*\s*1024\s*\*\s*1024/.test(d), "idx");
      ok("disk_reserves_os_512", /operatingSystemSafetyReserveBytes:\s*512\s*\*\s*1024\s*\*\s*1024/.test(d), "os");
    }
    const bounded = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "bounded-fetch.mjs"), "utf8");
    ok("bounded_prefers_runner_temp", /IU_NDIC_SHADOW_WORK_DIR/.test(bounded) && /RUNNER_TEMP/.test(bounded), "base");
    const probe = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-shadow-probe.mjs"), "utf8");
    const run = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-shadow-run.mjs"), "utf8");
    const sync = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-prod-sync.mjs"), "utf8");
    ok("probe_no_test_disk_provider_call", !/createTestDiskStatsProvider/.test(probe), "probe-provider");
    ok("run_no_test_disk_provider_call", !/createTestDiskStatsProvider/.test(run), "run-provider");
    ok("sync_no_test_disk_provider_call", !/createTestDiskStatsProvider/.test(sync), "sync-provider");
    ok("probe_asserts_no_test_disk_env", /assertNoTestDiskProviderEnv/.test(probe), "probe-env");
    ok("run_asserts_no_test_disk_env", /assertNoTestDiskProviderEnv/.test(run), "run-env");
    ok("sync_asserts_no_test_disk_env", /assertNoTestDiskProviderEnv/.test(sync), "sync-env");
    ok("probe_no_measureDeps_from_env", !/measureDeps:\s*process\.env|IU_NDIC_TEST_DISK/.test(probe), "measure-env");
    ok("probe_workdir_no_ostmp_fallback", /TMC_DISK_WORKDIR_REQUIRED/.test(probe) && !/ensureWorkDir[\s\S]{0,400}os\.tmpdir\(\)/.test(probe), "no-tmp");
  }

  ok("at_least_one_ndic_self_hosted", ndicSelfHostedJobs >= 1, String(ndicSelfHostedJobs));
  ok("zero_github_hosted_ndic_jobs", githubHostedNdicJobs === 0, String(githubHostedNdicJobs));

  // Reject Node 20/21/22/23 in NDIC network + inspection workflows
  const approvedWfFiles = [
    ...Object.keys(APPROVED_NDIC_NETWORK_WORKFLOWS),
    ...Object.keys(APPROVED_NDIC_INSPECTION_WORKFLOWS),
  ];
  for (const file of approvedWfFiles) {
    const abs = path.join(WF_DIR, file);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, "utf8");
    ok("ndic_wf_node24_" + file, /node-version:\s*["']?24["']?/.test(raw), "need24");
    for (const bad of ["20", "21", "22", "23"]) {
      ok(
        "ndic_wf_no_node_" + bad + "_" + file,
        !new RegExp("node-version:\\s*[\"']?" + bad + "[\"']?").test(raw),
        "bad"
      );
    }
    ok("wf_no_test_disk_input_" + file, !/test.?disk|fake.?disk|IU_NDIC_TEST_DISK/i.test(raw), "input");
  }

  const configSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "config.mjs"), "utf8");
  ok("config_mode_default_off", /mode = "off"/.test(configSrc) || /else mode = "off"/.test(configSrc), "default");
  ok("config_datex_secret_names", /IU_NDIC_PULL_URL/.test(configSrc), "datex");
  ok("config_tmc_secret_names", /IU_NDIC_TMC_PULL_URL/.test(configSrc), "tmc");

  if (fails.length) {
    console.error("[ndic-self-hosted-runner-contract-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[ndic-self-hosted-runner-contract-guard] OK");
  console.log(
    JSON.stringify({
      ndicSelfHostedJobs,
      githubHostedNdicJobs,
      requiredLabels: REQUIRED_LABELS,
      approvedNetworkWorkflows: Object.keys(APPROVED_NDIC_NETWORK_WORKFLOWS),
      approvedInspectionWorkflows: Object.keys(APPROVED_NDIC_INSPECTION_WORKFLOWS),
      expectedRunnerName: EXPECTED_RUNNER_NAME,
    })
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
