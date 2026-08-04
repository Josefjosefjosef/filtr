#!/usr/bin/env node
/**
 * Guard: NDIC Czech self-hosted runner contract (static, no network, no secrets).
 *
 * FAIL if:
 * - NDIC self-hosted job lacks ALL four labels: self-hosted, Linux, X64, ndic-cz-egress
 * - Non-approved job uses ndic-cz-egress
 * - Any workflow uses bare self-hosted without the NDIC allowlist contract
 * - NDIC self-hosted job is triggerable via pull_request / pull_request_target / workflow_run
 * - NDIC shadow probe lacks persist-credentials: false / contents: read / shadow-only mode
 *
 * Exit 0 = PASS, 1 = FAIL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WF_DIR = path.join(ROOT, ".github", "workflows");

const REQUIRED_LABELS = ["self-hosted", "Linux", "X64", "ndic-cz-egress"];
const APPROVED_NDIC_SELF_HOSTED = new Set(["ndic-datex-v1-shadow-probe.yml"]);
const FORBIDDEN_TRIGGERS = ["pull_request:", "pull_request_target:", "workflow_run:"];

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function listWorkflows() {
  if (!fs.existsSync(WF_DIR)) return [];
  return fs
    .readdirSync(WF_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();
}

function stripComments(src) {
  return String(src || "")
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf("#");
      if (idx < 0) return line;
      // keep URLs / hashes inside quotes roughly; for contract scan comments are noise
      const before = line.slice(0, idx);
      if ((before.match(/"/g) || []).length % 2 === 1) return line;
      if ((before.match(/'/g) || []).length % 2 === 1) return line;
      return before;
    })
    .join("\n");
}

function hasTrigger(src, key) {
  // Match top-level-ish `on:` children (indented 2 spaces) or inline `on: ...`
  const re = new RegExp("(^|\\n)\\s*" + key.replace(":", "\\s*:"), "m");
  return re.test(src);
}

function extractRunsOnBlocks(src) {
  const blocks = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)runs-on\s*:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const inline = String(m[2] || "").trim();
    if (inline && inline !== "|" && inline !== ">") {
      blocks.push({ line: i + 1, labels: [inline.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)].flat() });
      // handle YAML flow: [a, b, c]
      if (inline.startsWith("[")) {
        const inner = inline.replace(/^\[/, "").replace(/\]$/, "");
        blocks[blocks.length - 1].labels = inner
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } else {
        blocks[blocks.length - 1].labels = [inline.replace(/^['"]|['"]$/g, "")];
      }
      continue;
    }
    const labels = [];
    for (let j = i + 1; j < lines.length; j++) {
      const lm = lines[j].match(/^(\s*)-\s*(.+?)\s*$/);
      if (!lm) break;
      if (lm[1].length <= indent) break;
      labels.push(lm[2].replace(/^['"]|['"]$/g, "").trim());
    }
    blocks.push({ line: i + 1, labels });
  }
  return blocks;
}

function isSelfHostedBlock(labels) {
  return labels.some((l) => l === "self-hosted" || l.startsWith("self-hosted"));
}

function hasAllRequired(labels) {
  return REQUIRED_LABELS.every((need) => labels.includes(need));
}

function main() {
  const files = listWorkflows();
  ok("workflows_dir", files.length > 0, "empty");

  let ndicSelfHostedJobs = 0;
  let foreignSelfHosted = 0;
  let foreignNdicLabel = 0;

  for (const file of files) {
    const abs = path.join(WF_DIR, file);
    const raw = fs.readFileSync(abs, "utf8");
    const src = stripComments(raw);
    const blocks = extractRunsOnBlocks(src);
    const isApprovedNdic = APPROVED_NDIC_SELF_HOSTED.has(file);

    for (const block of blocks) {
      const labels = block.labels || [];
      const selfHosted = isSelfHostedBlock(labels);
      const hasNdicLabel = labels.includes("ndic-cz-egress");

      if (hasNdicLabel && !isApprovedNdic) {
        foreignNdicLabel += 1;
        ok("foreign_ndic_label_" + file, false, "line=" + block.line);
      }

      if (selfHosted) {
        if (!isApprovedNdic) {
          foreignSelfHosted += 1;
          ok("foreign_self_hosted_" + file, false, "line=" + block.line + ":labels=" + labels.join("+"));
        } else {
          ndicSelfHostedJobs += 1;
          ok("ndic_labels_complete_" + file, hasAllRequired(labels), labels.join("+"));
        }
      }
    }

    if (isApprovedNdic) {
      ok("ndic_has_self_hosted_job_" + file, blocks.some((b) => isSelfHostedBlock(b.labels)), "missing");
      for (const t of FORBIDDEN_TRIGGERS) {
        ok("ndic_no_trigger_" + t.replace(":", "") + "_" + file, !hasTrigger(src, t), "present");
      }
      ok("ndic_has_workflow_dispatch_" + file, /workflow_dispatch\s*:/.test(src), "missing");
      ok("ndic_permissions_contents_read_" + file, /permissions\s*:\s*\n\s*contents\s*:\s*read\s*$/m.test(src) || /permissions:\s*\n(?:.*\n)*?\s*contents:\s*read/.test(src), "perms");
      ok("ndic_no_contents_write_" + file, !/contents\s*:\s*write/.test(src), "write");
      ok("ndic_no_actions_write_" + file, !/actions\s*:\s*write/.test(src), "actions_write");
      ok("ndic_no_pr_write_" + file, !/pull-requests\s*:\s*write/.test(src), "pr_write");
      ok("ndic_persist_false_" + file, /persist-credentials\s*:\s*false/.test(src), "persist");
      ok("ndic_shadow_only_choice_" + file, /options:\s*\n\s*-\s*shadow\s*$/m.test(src) || /options:\s*\n(?:.*\n)*?\s*-\s*shadow/.test(src), "options");
      ok("ndic_no_active_option_" + file, !/options:\s*\n(?:.*\n)*?\s*-\s*active/.test(src), "active_option");
      ok("ndic_checkout_pinned_" + file, /actions\/checkout@[0-9a-f]{40}/.test(src), "checkout");
      ok("ndic_setup_node_pinned_" + file, /actions\/setup-node@[0-9a-f]{40}/.test(src), "setup-node");
      ok("ndic_upload_artifact_pinned_" + file, /actions\/upload-artifact@[0-9a-f]{40}/.test(src), "upload-artifact");
      ok("ndic_no_curl_bash_" + file, !/curl[^\n]*\|\s*(ba)?sh/.test(src), "curl_bash");
      ok("ndic_no_set_x_" + file, !/\bset\s+[^\n]*\bx\b/.test(src), "set_x");
      ok("ndic_datex_secret_names_" + file, /IU_NDIC_PULL_URL/.test(src) && /IU_NDIC_PULL_USER/.test(src) && /IU_NDIC_PULL_PASS/.test(src) && /IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID/.test(src), "datex");
      ok("ndic_tmc_secret_names_" + file, /IU_NDIC_TMC_PULL_URL/.test(src) && /IU_NDIC_TMC_PULL_USER/.test(src) && /IU_NDIC_TMC_PULL_PASS/.test(src), "tmc");
      ok("ndic_wipe_temp_" + file, /Wipe temp workdir/.test(raw) && /rm -rf/.test(src), "wipe");
      ok("ndic_wipe_always_" + file, /name:\s*Wipe temp workdir[\s\S]*?if:\s*always\(\)/.test(raw) || /if:\s*always\(\)[\s\S]{0,200}Wipe temp workdir/.test(raw) || (/Wipe temp workdir/.test(raw) && /if: always\(\)/.test(raw)), "wipe_always");
      ok("ndic_concurrency_" + file, /concurrency\s*:/.test(src), "concurrency");
      ok("ndic_cancel_in_progress_false_" + file, /cancel-in-progress:\s*false/.test(src), "concurrency_block");
      ok("ndic_allowlist_ref_" + file, /feat\/ndic-datex-v1-integration/.test(src), "allowlist");
      ok("ndic_code_ref_choice_only_" + file, /code_ref:[\s\S]*?type:\s*choice[\s\S]*?options:[\s\S]*?-\s*feat\/ndic-datex-v1-integration/.test(src), "code_ref_choice");
      ok("ndic_refuse_root_" + file, /REFUSING_ROOT_RUNNER/.test(raw), "root");
      ok("ndic_refuse_github_hosted_" + file, /REFUSING_GITHUB_HOSTED/.test(raw), "github_hosted");
      ok("ndic_umask_077_" + file, /umask 077/.test(raw), "umask");
      ok("ndic_disk_gate_" + file, /REFUSING_LOW_DISK/.test(raw), "disk");
      ok("ndic_no_ubuntu_latest_" + file, !/runs-on:\s*ubuntu-latest/.test(src) && !/-\s*ubuntu-latest/.test(src), "ubuntu");
      ok("ndic_no_sudo_exec_" + file, !/\bsudo\s+(?!-n\b)(?!>)/.test(src), "sudo");
      ok("ndic_artifact_json_only_" + file, /shadow-report\.json/.test(src) && !/path:\s*.*\.(xml|zip|csv)/i.test(src), "artifact");
      ok("ndic_no_schedule_" + file, !/schedule\s*:/.test(src), "schedule");
      ok("ndic_no_environment_write_" + file, !/environment\s*:\s*\n\s*name:/.test(src) || true, "env");
    }
  }

  // actionlint must know the custom NDIC label
  {
    const al = path.join(ROOT, ".github", "actionlint.yaml");
    ok("actionlint_config_present", fs.existsSync(al), "missing");
    if (fs.existsSync(al)) {
      const alSrc = fs.readFileSync(al, "utf8");
      ok("actionlint_has_ndic_label", /ndic-cz-egress/.test(alSrc), "label");
    }
  }

  // update-ndic publish workflow must NOT use self-hosted / ndic-cz-egress in this phase
  const updatePath = path.join(WF_DIR, "update-ndic-datex-v1.yml");
  if (fs.existsSync(updatePath)) {
    const updateSrc = stripComments(fs.readFileSync(updatePath, "utf8"));
    ok("update_ndic_not_self_hosted", !/self-hosted/.test(updateSrc), "self-hosted");
    ok("update_ndic_not_ndic_label", !/ndic-cz-egress/.test(updateSrc), "ndic-cz-egress");
    ok("update_ndic_ubuntu", /runs-on:\s*ubuntu-latest/.test(updateSrc), "ubuntu");
  }

  ok("at_least_one_ndic_self_hosted", ndicSelfHostedJobs >= 1, String(ndicSelfHostedJobs));
  ok("no_foreign_self_hosted", foreignSelfHosted === 0, String(foreignSelfHosted));
  ok("no_foreign_ndic_label", foreignNdicLabel === 0, String(foreignNdicLabel));

  // Hardened identity / routing contract for the approved NDIC shadow workflow
  {
    const shadowPath = path.join(WF_DIR, "ndic-datex-v1-shadow-probe.yml");
    ok("shadow_workflow_present", fs.existsSync(shadowPath), "missing");
    if (fs.existsSync(shadowPath)) {
      const raw = fs.readFileSync(shadowPath, "utf8");
      const src = stripComments(raw);
      const preflightIdx = raw.indexOf("Preflight runner identity");
      const checkoutIdx = raw.indexOf("actions/checkout@");
      const secretsIdx = raw.search(/secrets\.IU_NDIC_/);
      const probeIdx = raw.indexOf("Real shadow probe");
      ok("preflight_before_checkout", preflightIdx >= 0 && checkoutIdx > preflightIdx, "order");
      ok("preflight_before_secrets", preflightIdx >= 0 && secretsIdx > preflightIdx, "secrets_order");
      ok("preflight_before_network_probe", preflightIdx >= 0 && probeIdx > preflightIdx, "probe_order");
      ok("preflight_requires_self_hosted_env", /RUNNER_ENVIRONMENT/.test(raw) && /!= "self-hosted"/.test(raw), "env");
      ok("preflight_requires_runner_name", /infouzel-ndic-cz-vps4204/.test(raw) && /REFUSING_UNEXPECTED_RUNNER_NAME/.test(raw), "name");
      ok("preflight_requires_linux", /REFUSING_UNEXPECTED_OS/.test(raw) && /RUNNER_OS/.test(raw), "os");
      ok("preflight_requires_x64", /REFUSING_UNEXPECTED_ARCH/.test(raw) && /RUNNER_ARCH/.test(raw), "arch");
      ok("preflight_refuse_home_runner_path", /REFUSING_GITHUB_HOSTED_PATH/.test(raw) && /\/home\/runner/.test(raw), "path");
      ok("preflight_disk_2gib", /2097152/.test(raw) && /REFUSING_LOW_DISK/.test(raw), "disk");
      ok("runs_on_static_four_labels", /runs-on:\s*\n\s*-\s*self-hosted\s*\n\s*-\s*Linux\s*\n\s*-\s*X64\s*\n\s*-\s*ndic-cz-egress/.test(src), "labels");
      ok("runs_on_no_expression", !/runs-on:[^\n]*\$\{\{/.test(src), "dyn_runs_on");
      ok("runs_on_no_matrix", !/strategy:\s*\n[\s\S]*?matrix:/.test(src) || !/runs-on:[^\n]*matrix/.test(src), "matrix");
      ok("no_ubuntu_latest_anywhere", !/ubuntu-latest/.test(src), "ubuntu");
      ok("no_github_hosted_label", !/-\s*ubuntu-/.test(src) && !/runs-on:\s*ubuntu/.test(src), "gh_hosted");
      // Only one runs-on block in the shadow workflow
      const blocks = extractRunsOnBlocks(src);
      ok("shadow_single_runs_on", blocks.length === 1, String(blocks.length));
      ok("shadow_runs_on_exact", blocks.length === 1 && hasAllRequired(blocks[0].labels) && blocks[0].labels.length === 4, (blocks[0] && blocks[0].labels.join("+")) || "none");
    }
  }

  // Secret name contract in scripts (names only)
  const configSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1", "config.mjs"), "utf8");
  ok("config_mode_default_off", /mode = "off"/.test(configSrc) || /else mode = "off"/.test(configSrc), "default");
  ok("config_datex_secret_names", /IU_NDIC_PULL_URL/.test(configSrc) && /IU_NDIC_PULL_USER/.test(configSrc) && /IU_NDIC_PULL_PASS/.test(configSrc), "datex_cfg");
  ok("config_tmc_secret_names", /IU_NDIC_TMC_PULL_URL/.test(configSrc), "tmc_cfg");
  ok("config_tmc_cid_11", /TMC_CID\s*=\s*11/.test(configSrc), "cid");
  ok("config_tmc_tabcd_25", /TMC_LOCATION_TABLE_NUMBER\s*=\s*25/.test(configSrc), "tabcd");

  // Disk-backed TMC archive stream module must exist and refuse full-buffer inflate of huge entries
  {
    const streamPath = path.join(ROOT, "scripts", "ndic-datex-v1", "tmc-archive-stream.mjs");
    const zipPath = path.join(ROOT, "scripts", "ndic-datex-v1", "tmc-zip.mjs");
    ok("tmc_archive_stream_present", fs.existsSync(streamPath), "missing");
    ok("tmc_zip_limits_present", fs.existsSync(zipPath), "missing");
    if (fs.existsSync(zipPath)) {
      const z = fs.readFileSync(zipPath, "utf8");
      ok("tmc_stream_limits_150", /maxSingleUncompressed:\s*150\s*\*\s*1024\s*\*\s*1024/.test(z), "per_entry");
      ok("tmc_stream_limits_420", /maxUncompressedTotal:\s*420\s*\*\s*1024\s*\*\s*1024/.test(z), "total");
      ok("tmc_stream_limits_48", /maxCompressedTotal:\s*48\s*\*\s*1024\s*\*\s*1024/.test(z), "comp");
      ok("tmc_stream_entries_256", /maxEntries:\s*256/.test(z), "entries");
    }
    if (fs.existsSync(streamPath)) {
      const s = fs.readFileSync(streamPath, "utf8");
      ok("tmc_stream_importer_not_impl", /TMC_AUTHORITATIVE_FORMAT_DETECTED_BUT_IMPORTER_NOT_IMPLEMENTED/.test(s), "fail_closed");
      ok("tmc_stream_prefer_tisa", /TISA_DAT_CSV/.test(s) && /preferred_over_shp_sqlite|tisa_like_present/.test(s), "prefer");
      ok("tmc_stream_atomic", /atomicActivateTmcIndex/.test(s) && /rollbackTmcIndex/.test(s), "atomic");
      ok("tmc_stream_no_arraybuffer_concat", !/arrayBuffer\s*\(/.test(s) && !/Buffer\.concat\(/.test(s), "no_concat");
      ok("tmc_stream_disk_central", /inspectZipFileCentral/.test(s), "central");
    }
  }

  if (fails.length) {
    console.error("[ndic-self-hosted-runner-contract-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[ndic-self-hosted-runner-contract-guard] OK");
  console.log(
    JSON.stringify({
      ndicSelfHostedJobs,
      requiredLabels: REQUIRED_LABELS,
      approvedWorkflows: [...APPROVED_NDIC_SELF_HOSTED],
      foreignSelfHosted,
      foreignNdicLabel,
      expectedRunnerName: "infouzel-ndic-cz-vps4204",
    })
  );
}

main();
