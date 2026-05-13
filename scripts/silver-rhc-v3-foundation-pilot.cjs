/**
 * SILVER_RHC_V3_FOUNDATION_PILOT — scripts-only orchestrator for Real Human Chaos V3 family.
 * - Runs a smaller deterministic RHC_V3 corpus via silver-real-human-chaos-v3.cjs (no engine edits).
 * - Enriches JSON with V3 roadmap axes, priority-cluster rollup, safety-all-zero gate, next diagnostic hint.
 * - Optional --proof: smoke, calendar regressions, 20k, quality v2, realistic/mobile; assets/app.js hash guard; git clean.
 *
 * Usage:
 *   node scripts/silver-rhc-v3-foundation-pilot.cjs
 *   node scripts/silver-rhc-v3-foundation-pilot.cjs --proof
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { spawnSync, execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const APP_JS = path.join(REPO, "assets", "app.js");
const CHAOS = path.join(__dirname, "silver-real-human-chaos-v3.cjs");
const REPORT_JSON = path.join(__dirname, "silver-rhc-v3-foundation-pilot-report.json");

const DEFAULT_PILOT_CASES = 6800;

const V3_PRIORITY_AXES = [
  "mobile_voice_chaos_v3",
  "retrieval_chaos_v3",
  "long_memory_chaos",
  "multi_intent_orchestration",
  "negation_warfare",
  "real_human_conversation_flows",
  "general_rhc3"
];

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function clusterToV3Axis(cluster) {
  const c = String(cluster || "");
  if (/^rhc3_mobile_voice/i.test(c)) return "mobile_voice_chaos_v3";
  if (/^rhc3_retrieval|^rhc3_filler_note|^rhc3_note_query|^rhc3_cal_query_topic/i.test(c)) return "retrieval_chaos_v3";
  if (/^rhc3_partial/i.test(c)) return "long_memory_chaos";
  if (/^rhc3_multi/i.test(c)) return "multi_intent_orchestration";
  if (/^rhc3_negation/i.test(c)) return "negation_warfare";
  if (/^rhc3_self_correction|^rhc3_ambiguity|^rhc3_module_switch|^rhc3_nonsense/i.test(c)) {
    return "real_human_conversation_flows";
  }
  return "general_rhc3";
}

function parseClusterFailEntry(entry) {
  const s = String(entry || "");
  const i = s.lastIndexOf(":");
  if (i <= 0) return { cluster: s, fails: 0, total: 0 };
  const cluster = s.slice(0, i);
  const rest = s.slice(i + 1);
  const mPair = /^(\d+)\/(\d+)$/.exec(rest);
  if (mPair) {
    return { cluster, fails: parseInt(mPair[1], 10) || 0, total: parseInt(mPair[2], 10) || 0 };
  }
  const mSingle = /^(\d+)$/.exec(rest);
  if (mSingle) return { cluster, fails: parseInt(mSingle[1], 10) || 0, total: 0 };
  return { cluster, fails: 0, total: 0 };
}

function rollupTopClustersByAxis(topFailClusters) {
  const byAxis = {};
  for (const ax of V3_PRIORITY_AXES) byAxis[ax] = { axis: ax, clusters: [], fail_sum: 0 };
  const list = Array.isArray(topFailClusters) ? topFailClusters : [];
  for (const line of list) {
    const { cluster, fails } = parseClusterFailEntry(line);
    const axis = clusterToV3Axis(cluster);
    byAxis[axis].clusters.push({ cluster, fails });
    byAxis[axis].fail_sum += fails;
  }
  return V3_PRIORITY_AXES.map((ax) => byAxis[ax]).sort((a, b) => b.fail_sum - a.fail_sum);
}

function recommendNarrowDiagnostic(rollup, topFailClusters) {
  const top = Array.isArray(topFailClusters) && topFailClusters.length ? parseClusterFailEntry(topFailClusters[0]) : null;
  if (!top || !top.cluster) {
    return "No failing cluster in pilot window; scale pilot cases or run full silver-real-human-chaos-v3.cjs for 120k baseline.";
  }
  const axis = clusterToV3Axis(top.cluster);
  const hints = {
    mobile_voice_chaos_v3:
      "Run scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic.cjs and compare rhc3_mobile_voice_cal slice against RCZ2 mobile_voice_chaos.",
    retrieval_chaos_v3:
      "Run scripts/silver-rhc3-top-cluster-diagnostic.cjs focused on note/calendar query retrieval; optionally silver-retrieval-stress-300k-foundation-diagnostic.cjs for fuzzy-read stress.",
    long_memory_chaos:
      "Run scripts/silver-rhc3-partial-cal-ref-diagnostic.cjs (or remaining-385 diagnostic) on partial calendar references.",
    multi_intent_orchestration:
      "Run scripts/silver-rhc3-note-create-response-contract-remaining-diagnostic.cjs or multi-intent light harness alignment in silver-real-human-chaos-v3.cjs exports.",
    negation_warfare:
      "Run scripts/silver-rhc3-negation-cal-readonly-diagnostic.cjs on rhc3_negation_cal_readonly gold vs engine.",
    real_human_conversation_flows:
      "Run scripts/silver-real-czech-public-ux-corpus-v2.cjs for broader Czech surface; cross-check module_switching clarity counts in foundation report.",
    general_rhc3:
      "Run scripts/silver-rhc3-top-cluster-diagnostic.cjs for generic top-cluster triage."
  };
  return hints[axis] || hints.general_rhc3;
}

function runNode(scriptRel, extraEnv) {
  const script = path.join(REPO, scriptRel);
  const env = Object.assign({}, process.env, extraEnv || {});
  const r = spawnSync(process.execPath, [script], { cwd: REPO, env, encoding: "utf8" });
  return { status: r.status === 0 ? 0 : r.status || 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function runNpm(scriptName) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npmCmd, ["run", scriptName, "--silent"], { cwd: REPO, encoding: "utf8" });
  return { status: r.status === 0 ? 0 : r.status || 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function enrichReport(base) {
  const safety = base.safety || {};
  const safetyAllZero =
    (safety.dangerous_write_count || 0) === 0 &&
    (safety.false_write_count || 0) === 0 &&
    (safety.query_created_write_count || 0) === 0 &&
    (safety.write_when_negated_count || 0) === 0 &&
    (safety.p0_safety_expected_no_write_but_draft || 0) === 0;

  const rollup = rollupTopClustersByAxis(base.top_fail_clusters || []);

  return Object.assign({}, base, {
    harness_id: "silver_rhc_v3_foundation_pilot_v1",
    upstream_harness_id: "silver_real_human_chaos_v3_foundation",
    pilot_mode: true,
    v3_roadmap: {
      priority_axes_ordered: V3_PRIORITY_AXES,
      axis_rollup_top_fail_clusters: rollup,
      cluster_axis_examples: {
        rhc3_mobile_voice_cal: "mobile_voice_chaos_v3",
        rhc3_retrieval_fuzzy_note_read: "retrieval_chaos_v3",
        rhc3_partial_cal_ref: "long_memory_chaos",
        rhc3_multi_cal_note_light: "multi_intent_orchestration",
        rhc3_negation_cal_readonly: "negation_warfare",
        rhc3_self_correction_cal: "real_human_conversation_flows"
      }
    },
    safety_all_zero: safetyAllZero,
    safety_counters_must_be_zero_contract: {
      dangerous_write_count: safety.dangerous_write_count || 0,
      false_write_count: safety.false_write_count || 0,
      query_created_write_count: safety.query_created_write_count || 0,
      write_when_negated_count: safety.write_when_negated_count || 0,
      p0_safety_expected_no_write_but_draft: safety.p0_safety_expected_no_write_but_draft || 0,
      contract_ok: safetyAllZero
    },
    recommended_next_narrow_diagnostic_step: recommendNarrowDiagnostic(rollup, base.top_fail_clusters || [])
  });
}

function main() {
  const wantProof = process.argv.includes("--proof");
  const pilotCases = (() => {
    const raw = process.env.RHC_V3_PILOT_CASES || String(DEFAULT_PILOT_CASES);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PILOT_CASES;
  })();

  if (!fs.existsSync(APP_JS)) throw new Error("missing assets/app.js");
  if (!fs.existsSync(CHAOS)) throw new Error("missing silver-real-human-chaos-v3.cjs");

  const hashBefore = sha256File(APP_JS);

  const chaosRawReport = path.join(os.tmpdir(), "silver_rhc_v3_foundation_pilot_chaos_raw.json");

  const env = Object.assign({}, process.env, {
    RHC_V3_TOTAL_CASES: String(pilotCases),
    RHC_V3_REPORT_JSON: chaosRawReport
  });

  console.log("[rhc_v3_foundation_pilot] cases=" + pilotCases + " chaos_raw=" + chaosRawReport + " report=" + REPORT_JSON);
  const chaosRun = spawnSync(process.execPath, [CHAOS], { cwd: REPO, env, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
  const chaosOut = (chaosRun.stdout || "") + (chaosRun.stderr || "");
  if (chaosOut) process.stdout.write(chaosOut);

  let report = {};
  try {
    report = JSON.parse(fs.readFileSync(chaosRawReport, "utf8"));
  } catch (e) {
    console.error("[rhc_v3_foundation_pilot] failed to read chaos raw report JSON:", e.message);
    process.exit(1);
  }

  const hashAfter = sha256File(APP_JS);
  const appJsUnchanged = hashBefore === hashAfter;

  report = enrichReport(report);
  report.pilot_total_cases = pilotCases;
  report.assets_app_js_sha256_before = hashBefore;
  report.assets_app_js_sha256_after = hashAfter;
  report.assets_app_js_unchanged = appJsUnchanged ? "YES" : "NO";
  report.chaos_child_exit_code = chaosRun.status === 0 ? 0 : chaosRun.status || 1;

  const proof = {
    requested: wantProof ? "YES" : "NO",
    smoke: "SKIPPED",
    silver_calendar_create_regression: "SKIPPED",
    silver_calendar_read_regression: "SKIPPED",
    audit_silver_20000_routing_stable: "SKIPPED",
    audit_silver_quality_v2: "SKIPPED",
    audit_silver_realistic_mobile_corpus: "SKIPPED"
  };

  if (wantProof) {
    let gitShort = "";
    try {
      gitShort = execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      gitShort = "ERR";
    }
    if (gitShort !== "") {
      console.error("[rhc_v3_foundation_pilot] proof aborted: git working tree not clean");
      report.proof_bundle = Object.assign({ git_clean: "NO", git_status_short: gitShort }, proof);
      fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
      process.exit(1);
    }

    const s1 = runNpm("smoke");
    proof.smoke = s1.status === 0 ? "PASS" : "FAIL";

    const s2 = runNpm("silver-regression");
    proof.silver_calendar_create_regression = s2.status === 0 ? "PASS" : "FAIL";

    const s3 = runNpm("silver-read-regression");
    proof.silver_calendar_read_regression = s3.status === 0 ? "PASS" : "FAIL";

    const s4 = runNode("scripts/audit_silver_20000_routing_stable.cjs");
    proof.audit_silver_20000_routing_stable = s4.status === 0 ? "PASS" : "FAIL";

    const s5 = runNode("scripts/audit_silver_quality_v2.cjs");
    proof.audit_silver_quality_v2 = s5.status === 0 ? "PASS" : "FAIL";

    const s6 = runNode("scripts/audit_silver_realistic_mobile_corpus.cjs");
    proof.audit_silver_realistic_mobile_corpus = s6.status === 0 ? "PASS" : "FAIL";

    const hashFinal = sha256File(APP_JS);
    report.assets_app_js_sha256_after = hashFinal;
    report.assets_app_js_unchanged = hashBefore === hashFinal ? "YES" : "NO";

    const gatesPass =
      proof.smoke === "PASS" &&
      proof.silver_calendar_create_regression === "PASS" &&
      proof.silver_calendar_read_regression === "PASS" &&
      proof.audit_silver_20000_routing_stable === "PASS" &&
      proof.audit_silver_quality_v2 === "PASS" &&
      proof.audit_silver_realistic_mobile_corpus === "PASS" &&
      report.assets_app_js_unchanged === "YES" &&
      report.safety_all_zero === true;

    if (gatesPass) {
      try {
        execSync("git checkout -- scripts/silver-quality-v2-report.json scripts/silver-realistic-mobile-corpus-report.json", {
          cwd: REPO,
          encoding: "utf8"
        });
      } catch {
        /* non-fatal */
      }
    }

    let gitShortAfterAudits = "";
    try {
      gitShortAfterAudits = execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      gitShortAfterAudits = "ERR";
    }

    report.proof_bundle = Object.assign(
      {
        gates_pass: gatesPass ? "YES" : "NO",
        git_status_after_audit_restore: gitShortAfterAudits,
        git_clean: "PENDING_WRITE",
        git_status_short: "",
        overall: "PENDING_WRITE"
      },
      proof
    );
  } else {
    let gitShort = "";
    try {
      gitShort = execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      gitShort = "ERR";
    }
    report.proof_bundle = {
      requested: "NO",
      note: "Re-run with --proof after committing; requires clean git tree and Playwright smoke (local server).",
      git_clean: gitShort === "" ? "YES" : "NO"
    };
  }

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  console.log("[rhc_v3_foundation_pilot] wrote " + REPORT_JSON);

  if (wantProof && report.proof_bundle) {
    let gs = "";
    try {
      gs = execSync("git status --short", { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      gs = "ERR";
    }
    const lines = gs ? gs.split(/\r?\n/).filter(Boolean) : [];
    const onlyPilot =
      lines.length === 1 && /silver-rhc-v3-foundation-pilot-report\.json\s*$/i.test(lines[0].trim().replace(/\\/g, "/"));
    const gc = lines.length === 0 || onlyPilot;
    const gp = report.proof_bundle.gates_pass === "YES";
    report.proof_bundle.git_status_short = gs;
    report.proof_bundle.git_clean = gc ? "YES" : "NO";
    report.proof_bundle.overall = gp && gc ? "PASS" : "FAIL";
    delete report.proof_bundle.git_status_after_audit_restore;
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  }

  const chaosFailed = chaosRun.status !== 0 && chaosRun.status != null;
  const ok =
    report.safety_all_zero === true &&
    appJsUnchanged &&
    !chaosFailed &&
    (!wantProof || (report.proof_bundle && report.proof_bundle.overall === "PASS"));

  if (ok) {
    process.stdout.write("\u0007");
  }

  if (!ok) process.exit(1);
}

main();
