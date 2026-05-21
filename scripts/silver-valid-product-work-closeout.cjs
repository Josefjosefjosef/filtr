#!/usr/bin/env node
/**
 * Silver — VALID PRODUCT WORK closeout V1 (orchestration/governance only).
 * Deterministic classifier for cluster-scoped scripts-only CAP work.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { resolveCapRuntimeHandoff } = require("./silver-audit-registry.cjs");
const { isGenericOrchestrationHandoff, CLUSTER_PRODUCT_TASK_SPEC } = require("./silver-next-action-planner-handoff.cjs");

const REPO = path.resolve(__dirname, "..");

/** Cluster → allowed scripts-only paths (regex on repo-relative path). */
const VALID_PRODUCT_WORK_CLUSTER_SCOPE = {
  self_correction_negation_flip: {
    allowedPathRes: [/^scripts\/silver-self-correction/i],
    forbiddenPathRes: [/^assets\//i, /^projects\/(?!data\/)/i, /^\.github\/workflows\//i],
    proofCommands: [
      "node scripts/silver-self-correction-audit.cjs",
      "node scripts/silver-self-correction-safety-diagnostic.cjs",
      "node scripts/silver-self-correction-negation-scope-selftest.cjs",
    ],
    branchPrefix: "fix/self-correction-negation-flip",
    prTitle: "fix: self-correction negation flip harness alignment",
  },
  self_correction_safety_note_readonly: {
    allowedPathRes: [/^scripts\/silver-self-correction/i],
    forbiddenPathRes: [/^assets\//i, /^projects\/(?!data\/)/i, /^\.github\/workflows\//i],
    proofCommands: [
      "node scripts/silver-self-correction-audit.cjs",
      "node scripts/silver-self-correction-safety-note-readonly-selftest.cjs",
    ],
    branchPrefix: "fix/self-correction-safety-note-readonly",
    prTitle: "fix: self-correction safety note readonly harness alignment",
  },
  rhc3_partial_cal_ref: {
    allowedPathRes: [/^scripts\/silver-rhc3/i, /^scripts\/silver-real-human-chaos/i],
    forbiddenPathRes: [/^assets\//i, /^projects\/(?!data\/)/i, /^\.github\/workflows\//i],
    proofCommands: ["node scripts/silver-rhc3-cluster-classifier-v1.cjs"],
    branchPrefix: "fix/rhc3-partial-cal-ref-harness",
    prTitle: "fix: RHC3 partial cal ref harness alignment",
  },
};

const FORBIDDEN_UI_BACKEND_RES = [
  /^projects\/(?!data\/)/i,
  /^ui\//i,
  /\.css$/i,
  /^backend\//i,
  /^server\//i,
];

const RUNTIME_TRANSIENT_REPORT_RES = [
  /^scripts\/silver-[a-z0-9][a-z0-9_-]*-(?:diagnostic-report|cluster-classifier-v\d+-report)\.json$/i,
  /^scripts\/silver-self-correction-audit-report\.json$/i,
];

function normalizeRepoRel(rel) {
  return String(rel || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .toLowerCase();
}

function pathMatchesAny(n, res) {
  return res.some((re) => re.test(n));
}

function isRuntimeTransientReport(n) {
  return RUNTIME_TRANSIENT_REPORT_RES.some((re) => re.test(n));
}

function pickSelectorCluster(repoRoot, explicit) {
  if (arguments.length >= 2 && explicit !== undefined && explicit !== null) {
    const c = String(explicit).trim();
    if (c === "(žádný)" || c === "(unknown)") return "";
    return c;
  }
  try {
    const handoff = resolveCapRuntimeHandoff(repoRoot || REPO, {});
    const cd = handoff && handoff.cluster_diag;
    if (cd && cd.cluster) return String(cd.cluster).trim();
  } catch {
    /* ignore */
  }
  return "";
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

/**
 * Classify dirty paths for valid cluster-scoped product work.
 * @param {object} opts
 * @returns {object}
 */
function classifyValidProductWork(opts) {
  const o = opts || {};
  const paths = (Array.isArray(o.dirtyPaths) ? o.dirtyPaths : [])
    .map((p) => normalizeRepoRel(p))
    .filter((n) => n && !/^\.silver-runtime(\/|$)/.test(n));
  const selectorCluster =
    o.selectorCluster !== undefined
      ? pickSelectorCluster(o.repoRoot, o.selectorCluster)
      : pickSelectorCluster(o.repoRoot);
  const trueEngineFail = String(o.trueEngineFail || "NO").toUpperCase() === "YES";
  const safety = parseSafetyCounters(o.safetyCounters);
  const scope = selectorCluster ? VALID_PRODUCT_WORK_CLUSTER_SCOPE[selectorCluster] : null;
  const spec = selectorCluster ? CLUSTER_PRODUCT_TASK_SPEC[selectorCluster] : null;

  if (paths.length === 0) {
    return {
      classification: "clean",
      closeout_kind: "clean",
      selector_cluster: selectorCluster,
      blocked_dirty_classification: "",
      product_scope_match: "N/A",
      proof_path_present: spec || scope ? "YES" : "NO",
    };
  }

  if (safetyCountersBlocked(safety)) {
    return {
      classification: "SAFE_BLOCKED",
      closeout_kind: "forbidden_product_dirty",
      selector_cluster: selectorCluster,
      blocked_dirty_classification: "safety_counters_nonzero",
      product_scope_match: "NO",
      proof_path_present: "NO",
      final_outcome: "SAFE_BLOCKED",
    };
  }

  const hasAssets = paths.some((n) => n === "assets/app.js");
  if (hasAssets && !trueEngineFail) {
    return {
      classification: "SAFE_BLOCKED",
      closeout_kind: "forbidden_product_dirty",
      selector_cluster: selectorCluster,
      blocked_dirty_classification: "assets/app.js",
      product_scope_match: "NO",
      proof_path_present: "NO",
      final_outcome: "SAFE_BLOCKED",
    };
  }

  if (hasAssets && trueEngineFail) {
    if (!scope) {
      return {
        classification: "FORBIDDEN_DIRTY",
        closeout_kind: "forbidden_dirty",
        selector_cluster: selectorCluster,
        blocked_dirty_classification: "assets/app.js_without_cluster_scope",
        product_scope_match: "NO",
        proof_path_present: "NO",
        final_outcome: "HARD_FAIL",
      };
    }
    return {
      classification: "VALID_PRODUCT_WORK",
      closeout_kind: "valid_product_work",
      selector_cluster: selectorCluster,
      blocked_dirty_classification: "assets/app.js",
      product_scope_match: "YES",
      proof_path_present: "YES",
      final_outcome: "PR_READY",
      true_engine_fail: "YES",
    };
  }

  if (pathMatchesAny(paths.join(";"), FORBIDDEN_UI_BACKEND_RES)) {
    return {
      classification: "FORBIDDEN_DIRTY",
      closeout_kind: "forbidden_dirty",
      selector_cluster: selectorCluster,
      blocked_dirty_classification: paths.filter((n) => pathMatchesAny(n, FORBIDDEN_UI_BACKEND_RES)).join(";"),
      product_scope_match: "NO",
      proof_path_present: "NO",
      final_outcome: "HARD_FAIL",
    };
  }

  if (!selectorCluster || !scope) {
    const nonRuntime = paths.filter((n) => !isRuntimeTransientReport(n));
    return {
      classification: "FORBIDDEN_DIRTY",
      closeout_kind: "forbidden_dirty",
      selector_cluster: selectorCluster || "(none)",
      blocked_dirty_classification: nonRuntime.join(";") || paths.join(";"),
      product_scope_match: "NO",
      proof_path_present: "NO",
      final_outcome: "HARD_FAIL",
    };
  }

  const productPaths = paths.filter((n) => !isRuntimeTransientReport(n));
  if (productPaths.length === 0) {
    return {
      classification: "RUNTIME_ONLY",
      closeout_kind: "runtime_artifact_restorable",
      selector_cluster: selectorCluster,
      blocked_dirty_classification: paths.join(";"),
      product_scope_match: "N/A",
      proof_path_present: scope ? "YES" : "NO",
      final_outcome: "NO_CHANGE",
    };
  }

  for (const n of productPaths) {
    if (pathMatchesAny(n, scope.forbiddenPathRes)) {
      return {
        classification: "FORBIDDEN_DIRTY",
        closeout_kind: "forbidden_dirty",
        selector_cluster: selectorCluster,
        blocked_dirty_classification: n,
        product_scope_match: "NO",
        proof_path_present: "YES",
        final_outcome: "HARD_FAIL",
      };
    }
  }

  const allInScope = productPaths.every((n) => pathMatchesAny(n, scope.allowedPathRes));
  if (!allInScope) {
    const outOfScope = productPaths.filter((n) => !pathMatchesAny(n, scope.allowedPathRes));
    return {
      classification: "FORBIDDEN_DIRTY",
      closeout_kind: "forbidden_dirty",
      selector_cluster: selectorCluster,
      blocked_dirty_classification: outOfScope.join(";"),
      product_scope_match: "NO",
      proof_path_present: "YES",
      final_outcome: "HARD_FAIL",
    };
  }

  const proofCommands =
    (spec && spec.harness_commands && spec.harness_commands.length
      ? spec.harness_commands
      : scope.proofCommands) || [];
  if (!proofCommands.length) {
    return {
      classification: "FORBIDDEN_DIRTY",
      closeout_kind: "forbidden_dirty",
      selector_cluster: selectorCluster,
      blocked_dirty_classification: "missing_proof_path",
      product_scope_match: "YES",
      proof_path_present: "NO",
      final_outcome: "HARD_FAIL",
    };
  }

  return {
    classification: "VALID_PRODUCT_WORK",
    closeout_kind: "valid_product_work",
    selector_cluster: selectorCluster,
    blocked_dirty_classification: productPaths.join(";"),
    product_scope_match: "YES",
    proof_path_present: "YES",
    proof_commands: proofCommands,
    branch_prefix: scope.branchPrefix,
    pr_title: scope.prTitle,
    final_outcome: "PR_READY",
    true_engine_fail: trueEngineFail ? "YES" : "NO",
  };
}

/**
 * Merge valid-product-work into CAP50 closeout classification (before forbidden_dirty).
 */
function classifyCap50CloseoutWithProductWork(paths, opts) {
  const o = opts || {};
  const list = (Array.isArray(paths) ? paths : [])
    .map((p) => String(p || "").trim().replace(/\\/g, "/"))
    .filter((n) => n && !/^\.silver-runtime(\/|$)/i.test(n));
  if (list.length === 0) {
    return { closeout_kind: "clean", blocked_dirty_classification: "", failure_class: "none" };
  }
  for (const n of list) {
    if (String(n).toLowerCase() === "assets/app.js") {
      const vpw = classifyValidProductWork({
        dirtyPaths: list,
        selectorCluster: o.selectorCluster,
        repoRoot: o.repoRoot,
        safetyCounters: o.safetyCounters,
        trueEngineFail: o.trueEngineFail,
      });
      if (vpw.classification === "VALID_PRODUCT_WORK" && vpw.true_engine_fail === "YES") {
        return {
          closeout_kind: "valid_product_work",
          blocked_dirty_classification: n,
          failure_class: "valid_product_work",
          valid_product_work: vpw,
        };
      }
      return {
        closeout_kind: "forbidden_product_dirty",
        blocked_dirty_classification: n,
        failure_class: "forbidden_product_dirty",
      };
    }
    if (/^(assets\/|projects\/(?!data\/)|\.github\/workflows\/)/i.test(n)) {
      return {
        closeout_kind: "forbidden_product_dirty",
        blocked_dirty_classification: n,
        failure_class: "forbidden_product_dirty",
      };
    }
  }
  const vpw = classifyValidProductWork({
    dirtyPaths: list,
    selectorCluster: o.selectorCluster,
    repoRoot: o.repoRoot,
    safetyCounters: o.safetyCounters,
    trueEngineFail: o.trueEngineFail,
  });
  if (vpw.classification === "VALID_PRODUCT_WORK") {
    return {
      closeout_kind: "valid_product_work",
      blocked_dirty_classification: vpw.blocked_dirty_classification || list.join(";"),
      failure_class: "valid_product_work",
      valid_product_work: vpw,
    };
  }
  if (vpw.classification === "SAFE_BLOCKED") {
    return {
      closeout_kind: "forbidden_product_dirty",
      blocked_dirty_classification: vpw.blocked_dirty_classification,
      failure_class: "forbidden_product_dirty",
      valid_product_work: vpw,
    };
  }
  if (vpw.classification === "RUNTIME_ONLY") {
    return {
      closeout_kind: "runtime_artifact_restorable",
      blocked_dirty_classification: list.join(";"),
      failure_class: "runtime_artifact_restorable",
    };
  }
  if (vpw.classification === "FORBIDDEN_DIRTY") {
    return {
      closeout_kind: "forbidden_dirty",
      blocked_dirty_classification: vpw.blocked_dirty_classification || list.join(";"),
      failure_class: "forbidden_dirty",
    };
  }
  return { closeout_kind: "clean", blocked_dirty_classification: "", failure_class: "none" };
}

function pathAllowedForFullAutoLoop(rel, selectorCluster, repoRoot) {
  const vpw = classifyValidProductWork({
    dirtyPaths: [rel],
    selectorCluster,
    repoRoot: repoRoot || REPO,
  });
  return vpw.classification === "VALID_PRODUCT_WORK";
}

function runProofCommand(repoRoot, cmdLine, dryRun) {
  if (dryRun) return { ok: true, code: 0, cmd: cmdLine };
  const parts = cmdLine.trim().split(/\s+/);
  const bin = parts[0];
  const args = parts.slice(1);
  const r = spawnSync(bin, args, {
    cwd: repoRoot || REPO,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ok: (r.status || 0) === 0, code: r.status || 0, cmd: cmdLine };
}

/**
 * Resolve closeout path A–D for valid/invalid product work.
 */
function resolveProductCloseoutPath(classification, opts) {
  const o = opts || {};
  const c = classification || {};
  const dryRun = Boolean(o.dryRun);
  const repoRoot = o.repoRoot || REPO;

  if (c.classification === "VALID_PRODUCT_WORK") {
    const cmds = c.proof_commands || [];
    const proofResults = [];
    let proofOk = true;
    for (const cmd of cmds) {
      const pr = runProofCommand(repoRoot, cmd, dryRun);
      proofResults.push(cmd + ":" + (pr.ok ? "PASS" : "FAIL"));
      if (!pr.ok) proofOk = false;
    }
    if (!proofOk && !dryRun) {
      return {
        final_outcome: "NO_SAFE_FIX",
        closeout_action: "revert_dirty",
        proof_results: proofResults.join(";"),
        PASS_FAIL: "PASS",
        product_fix_created: "NO",
        scripts_only_product_work: "NO",
      };
    }
    return {
      final_outcome: "PR_READY",
      closeout_action: "product_pr_ready",
      proof_results: proofResults.join(";") || "(dry_run)",
      PASS_FAIL: "PASS",
      product_fix_created: "YES",
      scripts_only_product_work: "YES",
      branch_prefix: c.branch_prefix || "fix/cluster-harness",
      pr_title: c.pr_title || "fix: cluster harness alignment",
      generic_handoff_blocked: "YES",
    };
  }

  if (c.classification === "SAFE_BLOCKED") {
    return {
      final_outcome: "SAFE_BLOCKED",
      closeout_action: "revert_dirty",
      PASS_FAIL: "PASS",
      product_fix_created: "NO",
    };
  }

  if (c.classification === "FORBIDDEN_DIRTY") {
    return {
      final_outcome: "HARD_FAIL",
      closeout_action: "blocked",
      PASS_FAIL: "FAIL",
      product_fix_created: "NO",
    };
  }

  return {
    final_outcome: "NO_CHANGE",
    closeout_action: "none",
    PASS_FAIL: "PASS",
    product_fix_created: "NO",
  };
}

function gitRestorePaths(repoRoot, relPaths) {
  const list = (relPaths || []).filter(Boolean);
  if (!list.length) return;
  try {
    execFileSync("git", ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...list], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch {
    /* best-effort */
  }
}

function printEvalBlock(classification, resolved) {
  console.log("=== SILVER_VALID_PRODUCT_WORK_CLOSEOUT_EVAL ===");
  console.log("classification=" + (classification.classification || ""));
  console.log("closeout_kind=" + (classification.closeout_kind || ""));
  console.log("selector_cluster=" + (classification.selector_cluster || ""));
  console.log("product_scope_match=" + (classification.product_scope_match || ""));
  console.log("proof_path_present=" + (classification.proof_path_present || ""));
  console.log("final_outcome=" + (resolved.final_outcome || ""));
  console.log("closeout_action=" + (resolved.closeout_action || ""));
  console.log("product_fix_created=" + (resolved.product_fix_created || "NO"));
  console.log("scripts_only_product_work=" + (resolved.scripts_only_product_work || "NO"));
  console.log("generic_handoff_blocked=YES");
  if (resolved.proof_results) console.log("proof_results=" + resolved.proof_results);
  if (resolved.branch_prefix) console.log("branch_prefix=" + resolved.branch_prefix);
  if (resolved.pr_title) console.log("pr_title=" + resolved.pr_title);
  console.log("PASS_FAIL=" + (resolved.PASS_FAIL || "FAIL"));
  console.log("=== END_SILVER_VALID_PRODUCT_WORK_CLOSEOUT_EVAL ===");
}

function cmdValidProductWorkCloseoutEval(argv) {
  const repoRoot = REPO;
  let selectorCluster = "";
  let trueEngineFail = "NO";
  let safetyCounters = "";
  let revertOnNoSafe = false;
  for (const a of argv || []) {
    if (a.startsWith("--selector-cluster=")) selectorCluster = a.slice("--selector-cluster=".length);
    else if (a.startsWith("--true-engine-fail=")) trueEngineFail = a.slice("--true-engine-fail=".length);
    else if (a.startsWith("--safety-counters=")) safetyCounters = a.slice("--safety-counters=".length);
    else if (a === "--revert-on-no-safe-fix") revertOnNoSafe = true;
  }
  const po = execFileSync("git", ["-c", "core.quotePath=false", "status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
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

  const classification = classifyValidProductWork({
    dirtyPaths,
    selectorCluster,
    repoRoot,
    safetyCounters,
    trueEngineFail,
  });
  const resolved = resolveProductCloseoutPath(classification, { repoRoot, dryRun: false });
  if (resolved.closeout_action === "revert_dirty" && revertOnNoSafe) {
    const productPaths = dirtyPaths.filter((n) => !isRuntimeTransientReport(normalizeRepoRel(n)));
    gitRestorePaths(repoRoot, productPaths);
  }
  printEvalBlock(classification, resolved);
  return resolved.PASS_FAIL === "PASS" ? 0 : 1;
}

function runValidProductWorkCloseoutSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const scPaths = [
    "scripts/silver-self-correction-audit.cjs",
    "scripts/silver-self-correction-query-clarification.cjs",
    "scripts/silver-self-correction-safety-diagnostic.cjs",
    "scripts/silver-self-correction-safety-note-readonly-selftest.cjs",
  ];
  const scClass = classifyValidProductWork({
    dirtyPaths: scPaths,
    selectorCluster: "self_correction_safety_note_readonly",
    safetyCounters: defaultSafetyCounters(),
  });
  assert(scClass.classification === "VALID_PRODUCT_WORK", "sc_readonly_valid_product_work");
  const scResolved = resolveProductCloseoutPath(scClass, { dryRun: true });
  assert(scResolved.final_outcome === "PR_READY", "sc_readonly_pr_ready");
  assert(scResolved.product_fix_created === "YES", "sc_readonly_product_fix");

  const harnessPaths = ["scripts/silver-self-correction-audit-report.json"];
  const harnessClass = classifyValidProductWork({
    dirtyPaths: harnessPaths,
    selectorCluster: "self_correction_safety_note_readonly",
  });
  assert(harnessClass.classification === "RUNTIME_ONLY", "harness_json_runtime_only");

  const negFlip = classifyValidProductWork({
    dirtyPaths: ["scripts/silver-self-correction-audit.cjs"],
    selectorCluster: "self_correction_negation_flip",
  });
  assert(negFlip.classification === "VALID_PRODUCT_WORK", "neg_flip_valid");
  const negResolved = resolveProductCloseoutPath(negFlip, { dryRun: true });
  assert(negResolved.final_outcome === "PR_READY", "neg_flip_pr_ready");

  const assetsNoTef = classifyValidProductWork({
    dirtyPaths: ["assets/app.js"],
    selectorCluster: "self_correction_safety_note_readonly",
    trueEngineFail: "NO",
  });
  assert(assetsNoTef.final_outcome === "SAFE_BLOCKED", "assets_without_tef_safe_blocked");

  const assetsTef = classifyValidProductWork({
    dirtyPaths: ["assets/app.js"],
    selectorCluster: "self_correction_safety_note_readonly",
    trueEngineFail: "YES",
  });
  assert(assetsTef.classification === "VALID_PRODUCT_WORK", "assets_with_tef_valid");
  const assetsTefRes = resolveProductCloseoutPath(assetsTef, { dryRun: true });
  assert(assetsTefRes.final_outcome === "PR_READY", "assets_tef_pr_ready");

  const unrelated = classifyValidProductWork({
    dirtyPaths: ["SILVER_CAP_VALID_PRODUCT_WORK_SELFTEST_BLOCK.txt"],
    selectorCluster: "self_correction_safety_note_readonly",
  });
  assert(unrelated.classification === "FORBIDDEN_DIRTY", "unrelated_forbidden_dirty");

  const cap50 = classifyCap50CloseoutWithProductWork(scPaths, {
    selectorCluster: "self_correction_safety_note_readonly",
  });
  assert(cap50.closeout_kind === "valid_product_work", "cap50_closeout_valid_product_work");

  const cap50Unknown = classifyCap50CloseoutWithProductWork(["SILVER_UNKNOWN_BLOCK.txt"], {
    selectorCluster: "self_correction_safety_note_readonly",
  });
  assert(cap50Unknown.closeout_kind === "forbidden_dirty", "cap50_unknown_forbidden");

  const generic =
    "git push -u origin chore/silver-audit-repo-state\ngh auth login\n";
  assert(isGenericOrchestrationHandoff(generic), "generic_handoff_blocked");

  const missingCluster = classifyValidProductWork({
    dirtyPaths: ["scripts/silver-self-correction-audit.cjs"],
    selectorCluster: "",
  });
  assert(missingCluster.classification === "FORBIDDEN_DIRTY", "missing_cluster_forbidden");

  const missingMetric = resolveProductCloseoutPath({ classification: "FORBIDDEN_DIRTY" }, {});
  assert(missingMetric.final_outcome === "HARD_FAIL", "missing_metric_delta_hard_fail");

  const missingDeterministic = classifyValidProductWork({
    dirtyPaths: ["scripts/silver-self-correction-audit.cjs"],
    selectorCluster: "nonexistent_cluster_xyz",
  });
  assert(missingDeterministic.classification === "FORBIDDEN_DIRTY", "missing_deterministic_outcome");

  const noSafe = resolveProductCloseoutPath(
    {
      classification: "VALID_PRODUCT_WORK",
      proof_commands: ["node scripts/silver-nonexistent-proof-selftest-404.cjs"],
    },
    { dryRun: false },
  );
  assert(noSafe.final_outcome === "NO_SAFE_FIX", "proof_fail_no_safe_fix");

  const hardMissing = resolveProductCloseoutPath({ classification: "FORBIDDEN_DIRTY" }, {});
  assert(hardMissing.final_outcome === "HARD_FAIL", "forbidden_hard_fail");
  assert(hardMissing.PASS_FAIL === "FAIL", "forbidden_pass_fail");

  const noSafeResolved = resolveProductCloseoutPath(
    {
      classification: "VALID_PRODUCT_WORK",
      proof_commands: ["node scripts/silver-nonexistent-proof-selftest-404.cjs"],
    },
    { dryRun: false },
  );
  assert(noSafeResolved.final_outcome === "NO_SAFE_FIX", "no_safe_fix_path");
  assert(noSafeResolved.PASS_FAIL === "PASS", "no_safe_fix_pass_fail");

  const pass = failures.length === 0;
  console.log("=== VALID_PRODUCT_WORK_CLOSEOUT_SELFTEST ===");
  console.log("VALID_PRODUCT_WORK_CLOSEOUT_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  if (!pass) {
    for (const f of failures) console.log("FAIL_DETAIL=" + f);
  }
  console.log("=== END_VALID_PRODUCT_WORK_CLOSEOUT_SELFTEST ===");
  return pass;
}

if (require.main === module) {
  const cmd = process.argv[2] || "";
  if (cmd === "--valid-product-work-closeout-selftest") {
    process.exit(runValidProductWorkCloseoutSelftest() ? 0 : 1);
  }
  if (cmd === "--valid-product-work-closeout-eval") {
    process.exit(cmdValidProductWorkCloseoutEval(process.argv.slice(3)));
  }
  console.log(
    "Usage: node scripts/silver-valid-product-work-closeout.cjs --valid-product-work-closeout-selftest | --valid-product-work-closeout-eval",
  );
  process.exit(1);
}

module.exports = {
  VALID_PRODUCT_WORK_CLUSTER_SCOPE,
  classifyValidProductWork,
  classifyCap50CloseoutWithProductWork,
  pathAllowedForFullAutoLoop,
  resolveProductCloseoutPath,
  runValidProductWorkCloseoutSelftest,
  cmdValidProductWorkCloseoutEval,
  printEvalBlock,
  pickSelectorCluster,
};
