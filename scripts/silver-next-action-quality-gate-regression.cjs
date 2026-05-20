#!/usr/bin/env node
/**
 * Regression probe: SILVER_NEXT_ACTION.md pre-cycle quality gate + sanitize handoff.
 * Scripts-only; no engine / assets changes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const NEXT_ACTION = path.join(REPO, "SILVER_NEXT_ACTION.md");
const LOOP_PS1 = path.join(__dirname, "silver-autopilot-loop.ps1");
const AUTOPILOT = path.join(__dirname, "silver-autopilot.cjs");

const {
  silverNextActionQualityViolations,
  buildClusterHandoffForHealthyPlanner,
} = require("./silver-next-action-planner-handoff.cjs");

const {
  nextActionInnerQualityViolations,
  sanitizeBareSilverAutopilotInText,
  cmdSanitizeNextActionMd,
} = require("./silver-autopilot.cjs");

function fail(msg) {
  console.error("SILVER_NEXT_ACTION_QUALITY_GATE_REGRESSION_FAIL " + msg);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

function readUtf8(p) {
  return fs.readFileSync(p, "utf8");
}

function writeUtf8(p, text) {
  fs.writeFileSync(p, text, { encoding: "utf8" });
}

function runPwshGateSelftest() {
  const out = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      LOOP_PS1,
      "-NextActionQualityGateRegressionSelfTest",
    ],
    { cwd: REPO, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (!/SILVER_NEXT_ACTION_QUALITY_GATE_REGRESSION_SELFTEST=PASS/.test(out)) {
    fail("powershell_selftest_missing_pass\n" + out);
  }
}

function main() {
  const badBare =
    "<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->\n\n```\nnode scripts/silver-autopilot.cjs\n```\n";
  const bareViolations = nextActionInnerQualityViolations(badBare);
  assert(
    bareViolations.some((v) => v === "bare_silver_autopilot_node_use_status_subcommand"),
    "A_bare_autopilot_must_be_rejected",
  );

  const sanitizedBare = sanitizeBareSilverAutopilotInText(badBare);
  assert(
    !nextActionInnerQualityViolations(sanitizedBare).includes(
      "bare_silver_autopilot_node_use_status_subcommand",
    ),
    "A_sanitize_must_remove_bare_autopilot",
  );

  const badCat =
    "### Steps\n\n```powershell\ncat C:\\projects\\filtr\\SILVER_NEXT_ACTION.md\n```\n";
  const catViolations = nextActionInnerQualityViolations(badCat);
  assert(catViolations.includes("cat_windows_path"), "B_cat_windows_must_be_rejected");

  const clusterHandoff = buildClusterHandoffForHealthyPlanner({
    mainCommit: "8c89babfa8b2dd317a30b4f52818e67926ed3a35",
    clusterDiag: {
      source: "silver-audit-registry:rhc3",
      cluster: "rhc3_negation_cal_readonly",
      count: 9,
      harness_command: "node scripts/silver-real-human-chaos-v3.cjs",
      recommended_cap: "CAP10",
      top_preview: "rhc3_negation_cal_readonly:9",
    },
  });
  assert(
    /rhc3_negation_cal_readonly/.test(clusterHandoff),
    "C_cluster_handoff_must_name_rhc3_negation_cal_readonly",
  );
  assert(
    silverNextActionQualityViolations(clusterHandoff).length === 0,
    "C_planner_violations_must_be_empty_for_cluster_handoff",
  );

  const archived = path.join(
    REPO,
    ".silver-runtime",
    "cycles",
    "20260520-044929Z-c1",
    "SILVER_NEXT_ACTION.md",
  );
  const clusterProbeText = fs.existsSync(archived) ? readUtf8(archived) : clusterHandoff;
  assert(
    nextActionInnerQualityViolations(clusterProbeText).length === 0,
    "C_inner_violations_must_be_empty_for_valid_cluster_handoff",
  );

  let backup = null;
  if (fs.existsSync(NEXT_ACTION)) backup = readUtf8(NEXT_ACTION);
  try {
    const badInfra = [
      "<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->",
      "",
      "ÚKOL PRO CURSOR",
      "",
      "```powershell",
      "git push -u origin chore/silver-audit-repo-state",
      "gh auth login",
      "node scripts/silver-autopilot.cjs",
      "```",
    ].join("\n");
    writeUtf8(NEXT_ACTION, badInfra);
    const sanitizeExit = cmdSanitizeNextActionMd("--silver-next-action-quality-gate-regression");
    assert(sanitizeExit === 0, "D_sanitize_exit_must_be_zero");
    const after = readUtf8(NEXT_ACTION);
    assert(
      !nextActionInnerQualityViolations(after).includes(
        "bare_silver_autopilot_node_use_status_subcommand",
      ),
      "D_after_sanitize_no_bare_autopilot",
    );
    assert(
      nextActionInnerQualityViolations(after).length === 0,
      "D_after_sanitize_must_pass_inner_quality",
    );
    assert(!/git\s+push\s+-u\s+origin/i.test(after), "D_after_sanitize_no_generic_git_push");
    assert(!/\bgh\s+auth\s+login\b/i.test(after), "D_after_sanitize_no_generic_gh_auth");
    assert(!/^\s*cat\s+C:\\/im.test(after), "D_after_sanitize_no_cat_windows");
    assert(!/Ă|â€|Ĺ™ejdÄ/.test(after), "D_after_sanitize_no_mojibake_markers");
  } finally {
    if (backup != null) writeUtf8(NEXT_ACTION, backup);
    else {
      try {
        fs.unlinkSync(NEXT_ACTION);
      } catch {
        /* ignore */
      }
    }
  }

  runPwshGateSelftest();
  execFileSync(process.execPath, [AUTOPILOT, "--cli-planner-cluster-preference-selftest"], {
    cwd: REPO,
    stdio: "inherit",
  });

  console.log("SILVER_NEXT_ACTION_QUALITY_GATE_REGRESSION_PASS");
}

main();
