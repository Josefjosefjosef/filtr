#!/usr/bin/env node
/**
 * Silver — PRODUCT_ARTIFACT_CLASSIFIER V1 (orchestration/governance only).
 * Deterministic narrow classification: safe scripts-only CAP product artifacts vs forbidden dirty.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { pickSelectorCluster } = require("./silver-valid-product-work-closeout.cjs");

const REPO = path.resolve(__dirname, "..");

const FORBIDDEN_ZONE_RES = [
  /^assets\/app\.js$/i,
  /^assets\//i,
  /^src\//i,
  /^backend\//i,
  /^server\//i,
  /^package\.json$/i,
  /^package-lock\.json$/i,
  /-lock\.json$/i,
  /^yarn\.lock$/i,
  /^pnpm-lock\.yaml$/i,
  /^\.github\/workflows\//i,
  /^\.env/i,
  /^\.env\./i,
  /credentials/i,
  /secret/i,
  /^projects\/(?!data\/)/i,
  /^ui\//i,
  /\.css$/i,
];

const SAFE_SCRIPT_PATH_RES = [/^scripts\/[^/]+\.cjs$/i, /^scripts\/[^/]+-report\.json$/i];

const SAFE_SCRIPT_NAME_RES = [
  /^silver-/i,
  /^audit-/i,
  /-diagnostic/i,
  /-selftest/i,
  /-report\.json$/i,
];

const RUNTIME_HANDOFF_RES = [
  /^SILVER_NEXT_ACTION\.md$/i,
  /^SILVER_CURSOR_OUTPUT\.md$/i,
  /^SILVER_RUN_REPORT\.md$/i,
  /^SILVER_PROGRESS_LOG\.md$/i,
];

function normalizeRepoRel(rel) {
  return String(rel || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .toLowerCase();
}

function basenameOf(n) {
  const parts = String(n || "").split("/");
  return parts[parts.length - 1] || "";
}

function pathMatchesAny(n, res) {
  return res.some((re) => re.test(n));
}

function isRuntimeHandoffPath(n) {
  return RUNTIME_HANDOFF_RES.some((re) => re.test(n));
}

function isForbiddenProductArtifactZone(n) {
  return pathMatchesAny(n, FORBIDDEN_ZONE_RES);
}

function isSafeProductScriptPathShape(n) {
  if (!n) return false;
  if (!pathMatchesAny(n, SAFE_SCRIPT_PATH_RES)) return false;
  const base = basenameOf(n);
  return SAFE_SCRIPT_NAME_RES.some((re) => re.test(base));
}

function defaultSafetyCounters() {
  return {
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
  };
}

function parseSafetyCounters(raw) {
  const base = defaultSafetyCounters();
  if (!raw) return base;
  if (typeof raw === "object") {
    for (const k of Object.keys(base)) {
      if (raw[k] != null) base[k] = Number(raw[k]) || 0;
    }
    return base;
  }
  for (const part of String(raw).split(";")) {
    const kv = part.split("=");
    if (kv.length < 2) continue;
    const key = kv[0].trim();
    if (key in base) base[key] = parseInt(kv.slice(1).join("=").trim(), 10) || 0;
  }
  return base;
}

function safetyCountersBlocked(counters) {
  const c = counters || defaultSafetyCounters();
  return (
    c.dangerous_write_count > 0 ||
    c.false_write_count > 0 ||
    c.query_created_write_count > 0 ||
    c.write_when_negated_count > 0
  );
}

function yn(v) {
  return String(v || "NO").trim().toUpperCase() === "YES" ? "YES" : "NO";
}

function readTextSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function lineValue(text, key) {
  const prefix = key + "=";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = String(raw || "").trim();
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return "";
}

function resolveExpectedOutcomeFromTexts(nextActionText, runReportText, cursorOutputText) {
  const sources = [nextActionText, runReportText, cursorOutputText];
  for (const t of sources) {
    const v = lineValue(t, "expected_outcome");
    if (v) return v;
    const m = String(t || "").match(/expected_outcome=([^\s\r\n;]+)/i);
    if (m) return m[1].trim();
  }
  return "";
}

/**
 * Resolve governance context from repo surfaces when not passed explicitly.
 */
function resolveProductArtifactContextFromRepo(repoRoot, overrides) {
  const root = repoRoot || REPO;
  const o = overrides || {};
  const nextText = o.nextActionText != null ? o.nextActionText : readTextSafe(path.join(root, "SILVER_NEXT_ACTION.md"));
  const reportText = o.runReportText != null ? o.runReportText : readTextSafe(path.join(root, "SILVER_RUN_REPORT.md"));
  const cursorText =
    o.cursorOutputText != null ? o.cursorOutputText : readTextSafe(path.join(root, "SILVER_CURSOR_OUTPUT.md"));

  const selectorCluster =
    o.selectorCluster !== undefined
      ? String(o.selectorCluster || "").trim()
      : pickSelectorCluster(root, o.authoritativeCluster || "");

  const expectedOutcome =
    o.expectedOutcome !== undefined
      ? String(o.expectedOutcome || "").trim()
      : resolveExpectedOutcomeFromTexts(nextText, reportText, cursorText);

  const autonomousMode =
    o.autonomousMode !== undefined
      ? yn(o.autonomousMode) === "YES"
      : Boolean(
          String(process.env.SILVER_AUTONOMOUS_CYCLE || "").trim() ||
            String(process.env.SILVER_AUTONOMOUS_RUN_ID || "").trim() ||
            yn(process.env.SILVER_AUTONOMOUS_MODE) === "YES",
        );

  const capRuntime =
    o.capRuntime !== undefined
      ? yn(o.capRuntime) === "YES"
      : Boolean(
          String(process.env.SILVER_CAP_RUNTIME_LABEL || "").trim() ||
            /CAP\d+/i.test(reportText) ||
            /ControlledCapProfile=/i.test(reportText),
        );

  const productHandoffContinuation =
    o.productHandoffContinuation !== undefined
      ? yn(o.productHandoffContinuation) === "YES"
      : Boolean(
          selectorCluster &&
            expectedOutcome &&
            (/PRODUCT_HANDOFF_CONTRACT/i.test(nextText) ||
              /cap_diagnostic_product_handoff/i.test(nextText) ||
              /HARNESS_ALIGNMENT_TASK_READY/i.test(expectedOutcome)),
        );

  const engineChanged =
    o.engineChanged !== undefined
      ? yn(o.engineChanged)
      : yn(lineValue(reportText, "engine_changed") || lineValue(nextText, "engine_changed"));

  const assetsAppChanged =
    o.assetsAppChanged !== undefined
      ? yn(o.assetsAppChanged)
      : yn(lineValue(reportText, "assets_app_changed") || lineValue(nextText, "assets_app_changed"));

  const safetyCounters =
    o.safetyCounters !== undefined ? parseSafetyCounters(o.safetyCounters) : parseSafetyCounters(lineValue(reportText, "safety_counters"));

  return {
    selectorCluster,
    expectedOutcome,
    autonomousMode,
    capRuntime,
    productHandoffContinuation,
    engineChanged,
    assetsAppChanged,
    safetyCounters,
  };
}

function contextGateReason(ctx) {
  if (!ctx.autonomousMode) return "autonomous_mode_required";
  if (!ctx.capRuntime) return "cap_runtime_required";
  if (!ctx.productHandoffContinuation) return "product_handoff_continuation_required";
  if (!ctx.selectorCluster) return "selector_cluster_required";
  if (!ctx.expectedOutcome) return "expected_outcome_required";
  if (ctx.engineChanged === "YES") return "engine_changed_forbidden";
  if (ctx.assetsAppChanged === "YES") return "assets_app_changed_forbidden";
  if (safetyCountersBlocked(ctx.safetyCounters)) return "safety_counters_nonzero";
  return "";
}

/**
 * Classify dirty paths for autonomous product artifact governance.
 * @returns {object}
 */
function classifyProductArtifactGovernance(opts) {
  const o = opts || {};
  const paths = (Array.isArray(o.dirtyPaths) ? o.dirtyPaths : [])
    .map((p) => normalizeRepoRel(p))
    .filter((n) => n && !/^\.silver-runtime(\/|$)/.test(n));

  const ctx = resolveProductArtifactContextFromRepo(o.repoRoot || REPO, o);
  const gate = contextGateReason(ctx);

  if (paths.length === 0) {
    return {
      classification: "CLEAN",
      closeout_kind: "clean",
      git_status_clean: "YES",
      safe_to_continue: "YES",
      fake_clean_repo: "NO",
      selector_cluster: ctx.selectorCluster,
      expected_outcome: ctx.expectedOutcome,
      blocked_dirty_classification: "",
      product_artifact_paths: "",
      context_gate: gate || "none",
    };
  }

  const productPaths = paths.filter((n) => !isRuntimeHandoffPath(n));
  const forbiddenPaths = [];
  const unknownPaths = [];
  const safePaths = [];

  for (const n of productPaths) {
    if (isForbiddenProductArtifactZone(n)) {
      forbiddenPaths.push(n);
      continue;
    }
    if (isSafeProductScriptPathShape(n)) {
      safePaths.push(n);
    } else {
      unknownPaths.push(n);
    }
  }

  const base = {
    selector_cluster: ctx.selectorCluster,
    expected_outcome: ctx.expectedOutcome,
    context_gate: gate || "none",
    product_artifact_paths: safePaths.join(";"),
    forbidden_paths: forbiddenPaths.join(";"),
    unknown_paths: unknownPaths.join(";"),
    git_status_clean: "NO",
    fake_clean_repo: "NO",
  };

  if (forbiddenPaths.length > 0 || unknownPaths.length > 0) {
    return Object.assign(base, {
      classification: "UNKNOWN_FORBIDDEN_DIRTY",
      closeout_kind: "forbidden_dirty",
      safe_to_continue: "NO",
      blocked_dirty_classification: forbiddenPaths.concat(unknownPaths).join(";"),
    });
  }

  if (safePaths.length === 0) {
    return Object.assign(base, {
      classification: "RUNTIME_HANDOFF_ONLY",
      closeout_kind: "runtime_artifact_restorable",
      safe_to_continue: gate ? "NO" : "YES",
      git_status_clean: gate ? "NO" : "YES",
      blocked_dirty_classification: paths.join(";"),
    });
  }

  if (gate) {
    return Object.assign(base, {
      classification: "UNKNOWN_FORBIDDEN_DIRTY",
      closeout_kind: "forbidden_dirty",
      safe_to_continue: "NO",
      blocked_dirty_classification: gate + (safePaths.length ? ":" + safePaths.join(";") : ""),
    });
  }

  return Object.assign(base, {
    classification: "SAFE_PRODUCT_SCRIPT_ONLY",
    closeout_kind: "product_artifact_runtime_pending",
    safe_to_continue: "YES",
    blocked_dirty_classification: safePaths.join(";"),
  });
}

/**
 * Merge product-artifact classification into CAP50 closeout (after valid-product-work).
 */
function classifyCap50CloseoutWithProductArtifacts(paths, opts) {
  const list = (Array.isArray(paths) ? paths : [])
    .map((p) => normalizeRepoRel(p))
    .filter((n) => n && !/^\.silver-runtime(\/|$)/.test(n));
  if (!list.length) {
    return { closeout_kind: "clean", blocked_dirty_classification: "", failure_class: "none" };
  }
  const pac = classifyProductArtifactGovernance(Object.assign({}, opts || {}, { dirtyPaths: list }));
  if (pac.classification === "SAFE_PRODUCT_SCRIPT_ONLY") {
    return {
      closeout_kind: "product_artifact_runtime_pending",
      blocked_dirty_classification: pac.blocked_dirty_classification || list.join(";"),
      failure_class: "product_artifact_runtime_pending",
      product_artifact: pac,
      git_status_clean: "NO",
      safe_to_continue: "YES",
    };
  }
  if (pac.classification === "RUNTIME_HANDOFF_ONLY") {
    return {
      closeout_kind: "runtime_artifact_restorable",
      blocked_dirty_classification: list.join(";"),
      failure_class: "runtime_artifact_restorable",
    };
  }
  if (pac.classification === "UNKNOWN_FORBIDDEN_DIRTY") {
    return {
      closeout_kind: "forbidden_dirty",
      blocked_dirty_classification: pac.blocked_dirty_classification || list.join(";"),
      failure_class: "forbidden_dirty",
    };
  }
  return { closeout_kind: "clean", blocked_dirty_classification: "", failure_class: "none" };
}

function pathAllowedAsAutonomousProductArtifact(rel, opts) {
  const n = normalizeRepoRel(rel);
  if (!n) return false;
  const pac = classifyProductArtifactGovernance(
    Object.assign({}, opts || {}, { dirtyPaths: [n], repoRoot: (opts && opts.repoRoot) || REPO }),
  );
  return pac.classification === "SAFE_PRODUCT_SCRIPT_ONLY";
}

function printEvalBlock(result) {
  console.log("=== SILVER_PRODUCT_ARTIFACT_CLASSIFIER_EVAL ===");
  console.log("classification=" + (result.classification || ""));
  console.log("closeout_kind=" + (result.closeout_kind || ""));
  console.log("selector_cluster=" + (result.selector_cluster || ""));
  console.log("expected_outcome=" + (result.expected_outcome || ""));
  console.log("git_status_clean=" + (result.git_status_clean || "NO"));
  console.log("safe_to_continue=" + (result.safe_to_continue || "NO"));
  console.log("fake_clean_repo=" + (result.fake_clean_repo || "NO"));
  console.log("context_gate=" + (result.context_gate || ""));
  if (result.product_artifact_paths) console.log("product_artifact_paths=" + result.product_artifact_paths);
  if (result.blocked_dirty_classification) {
    console.log("blocked_dirty_classification=" + result.blocked_dirty_classification);
  }
  console.log("PASS_FAIL=" + (result.safe_to_continue === "YES" ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_PRODUCT_ARTIFACT_CLASSIFIER_EVAL ===");
}

function cmdProductArtifactClassifierEval(argv) {
  let selectorCluster = "";
  let expectedOutcome = "";
  let safetyCounters = "";
  let autonomousMode = "";
  let capRuntime = "";
  let productHandoffContinuation = "";
  let engineChanged = "";
  let assetsAppChanged = "";
  for (const a of argv || []) {
    if (a.startsWith("--selector-cluster=")) selectorCluster = a.slice("--selector-cluster=".length);
    else if (a.startsWith("--expected-outcome=")) expectedOutcome = a.slice("--expected-outcome=".length);
    else if (a.startsWith("--safety-counters=")) safetyCounters = a.slice("--safety-counters=".length);
    else if (a.startsWith("--autonomous-mode=")) autonomousMode = a.slice("--autonomous-mode=".length);
    else if (a.startsWith("--cap-runtime=")) capRuntime = a.slice("--cap-runtime=".length);
    else if (a.startsWith("--product-handoff-continuation="))
      productHandoffContinuation = a.slice("--product-handoff-continuation=".length);
    else if (a.startsWith("--engine-changed=")) engineChanged = a.slice("--engine-changed=".length);
    else if (a.startsWith("--assets-app-changed=")) assetsAppChanged = a.slice("--assets-app-changed=".length);
  }
  const po = require("child_process")
    .execFileSync("git", ["-c", "core.quotePath=false", "status", "--porcelain"], {
      cwd: REPO,
      encoding: "utf8",
    })
    .trim();
  const dirtyPaths = po
    .split(/\r?\n/)
    .map((line) => {
      const l = String(line || "").replace(/\r$/, "").trim();
      if (!l) return "";
      let extracted = "";
      if (l.length >= 3 && l.charAt(2) === " ") extracted = l.slice(3).trim();
      else {
        const parts = l.trim().split(/\s+/);
        if (parts.length >= 2) extracted = parts.slice(1).join(" ").trim();
        else extracted = l;
      }
      const arrow = " -> ";
      const ai = extracted.lastIndexOf(arrow);
      if (ai >= 0) extracted = extracted.slice(ai + arrow.length).trim();
      return extracted.replace(/\\/g, "/");
    })
    .filter(Boolean);

  const result = classifyProductArtifactGovernance({
    dirtyPaths,
    repoRoot: REPO,
    selectorCluster,
    expectedOutcome,
    safetyCounters,
    autonomousMode: autonomousMode || "YES",
    capRuntime: capRuntime || "YES",
    productHandoffContinuation: productHandoffContinuation || "YES",
    engineChanged,
    assetsAppChanged,
  });
  printEvalBlock(result);
  return result.safe_to_continue === "YES" ? 0 : 1;
}

function runSelftestCase(name, fn) {
  try {
    fn();
    return { name, pass: true };
  } catch (e) {
    return { name, pass: false, error: String(e.message || e) };
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function baseCtx(overrides) {
  return Object.assign(
    {
      autonomousMode: "YES",
      capRuntime: "YES",
      productHandoffContinuation: "YES",
      selectorCluster: "self_correction_update_note",
      expectedOutcome: "HARNESS_ALIGNMENT_TASK_READY",
      engineChanged: "NO",
      assetsAppChanged: "NO",
      safetyCounters: defaultSafetyCounters(),
    },
    overrides || {},
  );
}

function runProductArtifactClassifierSelftest() {
  const cases = [];

  const cycle2Paths = [
    "scripts/silver-product-handoff-continuation.cjs",
    "scripts/silver-self-correction-audit.cjs",
    "scripts/silver-self-correction-negation-scope.cjs",
    "scripts/silver-self-correction-query-clarification.cjs",
    "scripts/silver-self-correction-safety-diagnostic.cjs",
    "scripts/silver-self-correction-update-note-selftest.cjs",
  ];

  cases.push(
    runSelftestCase("safe_scripts_only_diagnostic_pass_continue", () => {
      const r = classifyProductArtifactGovernance(Object.assign({}, baseCtx(), { dirtyPaths: cycle2Paths }));
      assert(r.classification === "SAFE_PRODUCT_SCRIPT_ONLY", "classification");
      assert(r.closeout_kind === "product_artifact_runtime_pending", "closeout_kind");
      assert(r.safe_to_continue === "YES", "safe_to_continue");
      assert(r.git_status_clean === "NO", "git_not_clean");
      assert(r.fake_clean_repo === "NO", "no_fake_clean");
    }),
  );

  cases.push(
    runSelftestCase("scripts_plus_assets_app_js_hard_fail", () => {
      const r = classifyProductArtifactGovernance(
        Object.assign({}, baseCtx(), { dirtyPaths: cycle2Paths.concat(["assets/app.js"]) }),
      );
      assert(r.classification === "UNKNOWN_FORBIDDEN_DIRTY", "classification");
      assert(r.closeout_kind === "forbidden_dirty", "closeout");
      assert(r.safe_to_continue === "NO", "safe");
    }),
  );

  cases.push(
    runSelftestCase("scripts_plus_safety_counter_nonzero_hard_fail", () => {
      const r = classifyProductArtifactGovernance(
        Object.assign({}, baseCtx(), {
          dirtyPaths: cycle2Paths,
          safetyCounters: {
            dangerous_write_count: 1,
            false_write_count: 0,
            query_created_write_count: 0,
            write_when_negated_count: 0,
          },
        }),
      );
      assert(r.safe_to_continue === "NO", "safe");
      assert(r.closeout_kind === "forbidden_dirty", "closeout");
    }),
  );

  cases.push(
    runSelftestCase("unknown_root_file_hard_fail", () => {
      const r = classifyProductArtifactGovernance(
        Object.assign({}, baseCtx(), { dirtyPaths: ["SILVER_UNKNOWN_ROOT_BLOCK.txt"] }),
      );
      assert(r.closeout_kind === "forbidden_dirty", "closeout");
      assert(r.safe_to_continue === "NO", "safe");
    }),
  );

  cases.push(
    runSelftestCase("package_lock_dirty_hard_fail", () => {
      const r = classifyProductArtifactGovernance(
        Object.assign({}, baseCtx(), { dirtyPaths: ["package-lock.json"] }),
      );
      assert(r.closeout_kind === "forbidden_dirty", "closeout");
    }),
  );

  cases.push(
    runSelftestCase("workflow_dirty_hard_fail", () => {
      const r = classifyProductArtifactGovernance(
        Object.assign({}, baseCtx(), { dirtyPaths: [".github/workflows/ci.yml"] }),
      );
      assert(r.closeout_kind === "forbidden_dirty", "closeout");
    }),
  );

  cases.push(
    runSelftestCase("scripts_only_outside_autonomous_mode_hard_fail", () => {
      const r = classifyProductArtifactGovernance(
        Object.assign({}, baseCtx({ autonomousMode: "NO" }), { dirtyPaths: cycle2Paths }),
      );
      assert(r.closeout_kind === "forbidden_dirty", "closeout");
      assert(r.safe_to_continue === "NO", "safe");
    }),
  );

  cases.push(
    runSelftestCase("scripts_only_without_selector_cluster_hard_fail", () => {
      const r = classifyProductArtifactGovernance(
        Object.assign({}, baseCtx({ selectorCluster: "" }), { dirtyPaths: cycle2Paths }),
      );
      assert(r.closeout_kind === "forbidden_dirty", "closeout");
    }),
  );

  cases.push(
    runSelftestCase("scripts_only_without_expected_outcome_hard_fail", () => {
      const r = classifyProductArtifactGovernance(
        Object.assign({}, baseCtx({ expectedOutcome: "" }), { dirtyPaths: cycle2Paths }),
      );
      assert(r.closeout_kind === "forbidden_dirty", "closeout");
    }),
  );

  cases.push(
    runSelftestCase("mixed_runtime_and_safe_product_artifacts_pass", () => {
      const r = classifyProductArtifactGovernance(
        Object.assign({}, baseCtx(), {
          dirtyPaths: cycle2Paths.concat([
            "SILVER_NEXT_ACTION.md",
            "SILVER_CURSOR_OUTPUT.md",
            "scripts/silver-self-correction-audit-report.json",
          ]),
        }),
      );
      assert(r.classification === "SAFE_PRODUCT_SCRIPT_ONLY", "classification");
      assert(r.safe_to_continue === "YES", "safe");
    }),
  );

  cases.push(
    runSelftestCase("safe_never_marks_repo_clean", () => {
      const r = classifyProductArtifactGovernance(Object.assign({}, baseCtx(), { dirtyPaths: cycle2Paths }));
      assert(r.git_status_clean === "NO", "git_status_clean");
    }),
  );

  cases.push(
    runSelftestCase("cap50_merge_not_forbidden_dirty", () => {
      const cap = classifyCap50CloseoutWithProductArtifacts(cycle2Paths, baseCtx());
      assert(cap.closeout_kind === "product_artifact_runtime_pending", "cap50_closeout");
      assert(cap.closeout_kind !== "forbidden_dirty", "not_forbidden");
    }),
  );

  cases.push(
    runSelftestCase("path_shape_rejects_non_matching_name", () => {
      assert(!isSafeProductScriptPathShape("scripts/random-helper.cjs"), "random_name");
      assert(isSafeProductScriptPathShape("scripts/silver-foo.cjs"), "silver_name");
    }),
  );

  const failed = cases.filter((c) => !c.pass);
  const pass = failed.length === 0;
  console.log("=== PRODUCT_ARTIFACT_CLASSIFIER_SELFTEST ===");
  console.log("PRODUCT_ARTIFACT_CLASSIFIER_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("cases_total=" + cases.length);
  console.log("cases_failed=" + failed.length);
  if (failed.length) {
    for (const f of failed) console.log("FAIL_DETAIL=" + f.name + ":" + (f.error || ""));
  }
  console.log("=== END_PRODUCT_ARTIFACT_CLASSIFIER_SELFTEST ===");
  return pass;
}

if (require.main === module) {
  const cmd = process.argv[2] || "";
  if (cmd === "--product-artifact-classifier-selftest") {
    process.exit(runProductArtifactClassifierSelftest() ? 0 : 1);
  }
  if (cmd === "--product-artifact-classifier-eval") {
    process.exit(cmdProductArtifactClassifierEval(process.argv.slice(3)));
  }
  console.log(
    "Usage: node scripts/silver-product-artifact-classifier.cjs --product-artifact-classifier-selftest | --product-artifact-classifier-eval",
  );
  process.exit(1);
}

module.exports = {
  classifyProductArtifactGovernance,
  classifyCap50CloseoutWithProductArtifacts,
  pathAllowedAsAutonomousProductArtifact,
  resolveProductArtifactContextFromRepo,
  isSafeProductScriptPathShape,
  isForbiddenProductArtifactZone,
  runProductArtifactClassifierSelftest,
  cmdProductArtifactClassifierEval,
  printEvalBlock,
};
