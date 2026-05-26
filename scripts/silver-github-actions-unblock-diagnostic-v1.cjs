#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const WF_DIR = path.join(REPO, ".github", "workflows");
const REQUIRED = ["smoke", "repo-guard", "layout-guard"];
const REQUIRED_WF = {
  smoke: "smoke.yml",
  "repo-guard": "repo-guard.yml",
  "layout-guard": "layout-guard.yml",
};

function runGh(args) {
  try {
    return execSync("gh " + args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return String(e.stdout || "") + String(e.stderr || "");
  }
}

function readYamlTriggers(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const nameM = text.match(/^name:\s*(.+)$/m);
  const onBlock = text.match(/^on:\s*\n([\s\S]*?)(?=^[a-zA-Z#]|\Z)/m);
  return {
    name: nameM ? nameM[1].trim() : path.basename(filePath),
    on: onBlock ? onBlock[1].trim() : "",
    hasPullRequest: /\bpull_request:\b/.test(text),
    hasPullRequestTarget: /\bpull_request_target:\b/.test(text),
    hasPushFix: /fix\/\*\*/.test(text),
    hasWorkflowDispatch: /\bworkflow_dispatch:\b/.test(text),
    hasStatusesWrite: /statuses:\s*write/.test(text),
  };
}

function parsePrArg() {
  const a = process.argv.find((x) => x.indexOf("--pr=") === 0);
  return a ? parseInt(a.split("=")[1], 10) : 4647;
}

function main() {
  const prNum = parsePrArg();
  const detected = [];
  const triggerConfiguration = {};
  const blockedReasons = [];
  const missingRequiredChecks = [];
  const workflowNameMismatch = [];
  const disabledWorkflows = [];
  const permissionsProblems = [];

  const wfFiles = fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  for (let i = 0; i < wfFiles.length; i++) {
    const fp = path.join(WF_DIR, wfFiles[i]);
    const info = readYamlTriggers(fp);
    detected.push({ file: wfFiles[i], workflow_name: info.name, triggers: info.on.split("\n").slice(0, 12) });
    if (REQUIRED_WF.smoke === wfFiles[i] || REQUIRED_WF["repo-guard"] === wfFiles[i] || REQUIRED_WF["layout-guard"] === wfFiles[i]) {
      triggerConfiguration[info.name] = {
        pull_request: info.hasPullRequest,
        pull_request_target: info.hasPullRequestTarget,
        push_fix_branches: info.hasPushFix,
        workflow_dispatch: info.hasWorkflowDispatch,
        statuses_write: info.hasStatusesWrite,
      };
      if (!info.hasStatusesWrite) {
        permissionsProblems.push(info.name + ": missing statuses: write");
      }
      if (!info.hasPushFix) {
        blockedReasons.push(info.name + ": no push trigger for fix/** (PR synchronize may not fire)");
      }
    }
  }

  for (let r = 0; r < REQUIRED.length; r++) {
    const ctx = REQUIRED[r];
    const wfFile = REQUIRED_WF[ctx];
    const wfPath = path.join(WF_DIR, wfFile);
    if (!fs.existsSync(wfPath)) {
      missingRequiredChecks.push(ctx);
      workflowNameMismatch.push(ctx + ": workflow file missing " + wfFile);
      continue;
    }
    const info = readYamlTriggers(wfPath);
    if (info.name.toLowerCase().replace(/\s+/g, "-") !== ctx && info.name !== "Smoke" && ctx === "smoke") {
      /* smoke job name is Smoke — context is smoke */
    }
  }

  const protRaw = runGh('api repos/Josefjosefjosef/filtr/branches/main/protection --jq "{contexts:.required_status_checks.contexts,strict:.required_status_checks.strict}"');
  let branchProtectionRequirements = { contexts: REQUIRED, strict: true };
  try {
    branchProtectionRequirements = JSON.parse(protRaw.trim() || "{}");
  } catch (_e) {
    blockedReasons.push("branch_protection_parse_failed");
  }

  const prRaw = runGh("pr view " + prNum + " --json number,state,mergeable,mergeStateStatus,headRefName,headRefOid,statusCheckRollup");
  let pr = {};
  try {
    pr = JSON.parse(prRaw.trim() || "{}");
  } catch (_e2) {
    blockedReasons.push("pr_parse_failed");
  }

  const headSha = pr.headRefOid || "";
  let ciTriggerStatus = "unknown";
  let mergeBlockReason = pr.mergeStateStatus || "unknown";
  if (headSha) {
    const runsRaw = runGh(
      'run list --commit ' + headSha + ' --limit 10 --json databaseId,name,event,status,conclusion'
    );
    const hasRuns = runsRaw.indexOf("workflow") >= 0 || runsRaw.indexOf("Smoke") >= 0;
    ciTriggerStatus = hasRuns ? "runs_detected_on_head" : "no_runs_on_head_sha";
    if (!hasRuns) {
      blockedReasons.push("no_github_actions_runs_for_pr_head_commit");
      missingRequiredChecks.push.apply(missingRequiredChecks, REQUIRED);
    }
  }

  const actionsPerm = runGh("api repos/Josefjosefjosef/filtr/actions/permissions");
  if (actionsPerm.indexOf('"enabled":true') < 0) {
    blockedReasons.push("actions_disabled_or_restricted");
    permissionsProblems.push("repository_actions_not_enabled");
  }

  console.log("=== SILVER_GITHUB_ACTIONS_UNBLOCK_DIAGNOSTIC_V1 ===");
  console.log("detected_workflows=" + JSON.stringify(detected.map((d) => d.workflow_name)));
  console.log("required_checks=" + JSON.stringify(branchProtectionRequirements.contexts || REQUIRED));
  console.log("missing_required_checks=" + JSON.stringify(missingRequiredChecks));
  console.log("workflow_name_mismatch=" + JSON.stringify(workflowNameMismatch));
  console.log("disabled_workflows=" + JSON.stringify(disabledWorkflows));
  console.log("trigger_configuration=" + JSON.stringify(triggerConfiguration));
  console.log("blocked_reasons=" + JSON.stringify(blockedReasons));
  console.log("permissions_problems=" + JSON.stringify(permissionsProblems));
  console.log("branch_protection_requirements=" + JSON.stringify(branchProtectionRequirements));
  console.log("CI_trigger_status=" + ciTriggerStatus);
  console.log("merge_block_reason=" + mergeBlockReason);
  console.log("pr_number=" + prNum);
  console.log("pr_head_ref=" + (pr.headRefName || ""));
  console.log("pr_head_sha=" + headSha);
  console.log("recommended_fix=push trigger fix/** on smoke/repo-guard/layout-guard; push commit to PR head");
  console.log("=== END_SILVER_GITHUB_ACTIONS_UNBLOCK_DIAGNOSTIC_V1 ===");
}

if (require.main === module) main();
