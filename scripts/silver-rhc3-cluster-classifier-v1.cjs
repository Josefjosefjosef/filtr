/**
 * RHC3 Cluster Classifier V1 — scripts-only metadata for autopilot / harness lanes.
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-rhc3-cluster-classifier-v1-report.json");
const RHC3_REPORT = path.join(__dirname, "silver-real-human-chaos-v3-report.json");
const AMBIGUITY_DIAG_REPORT = path.join(__dirname, "silver-rhc3-ambiguity-cal-conflict-diagnostic-report.json");

const CLUSTER_RULES = {
  rhc3_ambiguity_cal_conflict: {
    classification: "AMBIGUOUS_USER_INPUT",
    safe_to_autopilot: "YES",
    engine_fix_allowed: "NO",
    harness_alignment_allowed: "YES",
    human_review_required: "NO",
    ambiguity_expected: "YES",
    safe_clarification_ok: "YES",
    harness_only: "YES"
  },
  rhc3_ascii_task: {
    classification: "AMBIGUOUS_USER_INPUT",
    safe_to_autopilot: "YES",
    engine_fix_allowed: "NO",
    harness_alignment_allowed: "YES",
    human_review_required: "NO",
    ambiguity_expected: "YES",
    safe_clarification_ok: "YES",
    harness_only: "YES"
  },
  rhc3_task_create_do_ukolu: {
    classification: "AMBIGUOUS_USER_INPUT",
    safe_to_autopilot: "YES",
    engine_fix_allowed: "NO",
    harness_alignment_allowed: "YES",
    human_review_required: "NO",
    ambiguity_expected: "YES",
    safe_clarification_ok: "YES",
    harness_only: "YES"
  },
  rhc3_negation_cal_readonly: {
    classification: "NEGATION_READ_ONLY",
    safe_to_autopilot: "YES",
    engine_fix_allowed: "NO",
    harness_alignment_allowed: "YES",
    human_review_required: "NO",
    ambiguity_expected: "NO",
    safe_clarification_ok: "YES",
    harness_only: "YES"
  }
};

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function parseTopClusterLine(line) {
  const m = String(line || "").match(/^([^:]+):(\d+)\/(\d+)$/);
  if (!m) return null;
  return { cluster: m[1], fail: parseInt(m[2], 10), total: parseInt(m[3], 10) };
}

function classifyCluster(cluster, rhc3Report, ambiguityDiag) {
  const base = CLUSTER_RULES[cluster];
  if (!base) {
    return {
      cluster,
      classification: "UNCLASSIFIED",
      safe_to_autopilot: "NO",
      engine_fix_allowed: "UNKNOWN",
      harness_alignment_allowed: "NO",
      human_review_required: "YES",
      ambiguity_expected: "UNKNOWN",
      safe_clarification_ok: "UNKNOWN",
      harness_only: "NO",
      cluster_fail_count: null,
      cluster_total: null,
      notes: "no_v1_rule"
    };
  }

  const out = Object.assign({ cluster }, base);
  const top = (rhc3Report && rhc3Report.top_clusters) || [];
  for (let i = 0; i < top.length; i++) {
    const parsed = parseTopClusterLine(top[i]);
    if (parsed && parsed.cluster === cluster) {
      out.cluster_fail_count = parsed.fail;
      out.cluster_total = parsed.total;
      break;
    }
  }

  if (cluster === "rhc3_ambiguity_cal_conflict" && ambiguityDiag) {
    out.diagnostic_cluster_fail_count = ambiguityDiag.cluster_fail_count;
    out.diagnostic_true_engine_fail_count = ambiguityDiag.true_engine_fail_count;
    out.diagnostic_engine_fix_recommended = ambiguityDiag.engine_fix_recommended;
    if (ambiguityDiag.cluster_fail_count === 0 && ambiguityDiag.true_engine_fail_count === 0) {
      out.harness_only = "YES";
      out.safe_to_autopilot = "YES";
      out.engine_fix_allowed = "NO";
    }
  }

  return out;
}

function main() {
  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    mainCommit = "UNKNOWN";
  }

  const rhc3Report = readJsonSafe(RHC3_REPORT);
  const ambiguityDiag = readJsonSafe(AMBIGUITY_DIAG_REPORT);

  const clusterKeys = Object.keys(CLUSTER_RULES);
  const classifications = [];
  for (let i = 0; i < clusterKeys.length; i++) {
    classifications.push(classifyCluster(clusterKeys[i], rhc3Report, ambiguityDiag));
  }

  const target = classifyCluster("rhc3_ambiguity_cal_conflict", rhc3Report, ambiguityDiag);

  const textBlock = [
    "=== SILVER_RHC3_CLUSTER_CLASSIFIER_V1_RESULT ===",
    "main_commit=" + mainCommit,
    "target_cluster=rhc3_ambiguity_cal_conflict",
    "classification=" + target.classification,
    "safe_to_autopilot=" + target.safe_to_autopilot,
    "engine_fix_allowed=" + target.engine_fix_allowed,
    "harness_alignment_allowed=" + target.harness_alignment_allowed,
    "human_review_required=" + target.human_review_required,
    "ambiguity_expected=" + target.ambiguity_expected,
    "safe_clarification_ok=" + target.safe_clarification_ok,
    "harness_only=" + target.harness_only,
    "cluster_fail_count=" + String(target.cluster_fail_count != null ? target.cluster_fail_count : "n/a"),
    "=== END_SILVER_RHC3_CLUSTER_CLASSIFIER_V1_RESULT ==="
  ].join("\n");

  console.log("\n" + textBlock + "\n");

  const reportObj = {
    generated_at: new Date().toISOString(),
    main_commit: mainCommit,
    classifier_version: "v1",
    classifications,
    target_cluster: target,
    text_block: textBlock
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
  console.log("report_json=" + REPORT_JSON);
}

main();
