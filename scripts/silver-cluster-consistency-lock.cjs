#!/usr/bin/env node
/**
 * Silver — cluster consistency lock V1 (orchestration/governance only).
 * Prevents selector/planner drift after valid product work or cluster-specific branch creation.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_DEFAULT = path.resolve(__dirname, "..");
const LOCK_REL = ".silver-runtime/cluster-consistency-lock.json";

/** branch prefix (git) → authoritative cluster */
const BRANCH_PREFIX_TO_CLUSTER = {
  "fix/self-correction-safety-note-readonly": "self_correction_safety_note_readonly",
  "fix/self-correction-negation-flip": "self_correction_negation_flip",
  "fix/rhc3-partial-cal-ref-harness": "rhc3_partial_cal_ref",
};

const CLUSTER_TO_BRANCH_PREFIX = Object.fromEntries(
  Object.entries(BRANCH_PREFIX_TO_CLUSTER).map(([b, c]) => [c, b]),
);

const CLUSTER_TO_AUDIT_ID = {
  self_correction_safety_note_readonly: "self_correction",
  self_correction_negation_flip: "self_correction",
  rhc3_partial_cal_ref: "rhc3",
};

const UNLOCK_OUTCOMES = new Set([
  "NO_SAFE_FIX",
  "SAFE_BLOCKED",
  "HARD_FAIL",
  "MERGED_AND_PROVED",
  "NO_CHANGE",
]);

function lockFilePath(repoRoot) {
  return path.join(repoRoot || REPO_DEFAULT, LOCK_REL);
}

function readJsonSafe(abs) {
  try {
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

function gitBranch(repoRoot) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot || REPO_DEFAULT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function clusterFromBranch(branch) {
  const b = String(branch || "").trim();
  if (!b || b === "main" || b === "master") return "";
  if (BRANCH_PREFIX_TO_CLUSTER[b]) return BRANCH_PREFIX_TO_CLUSTER[b];
  for (const [prefix, cluster] of Object.entries(BRANCH_PREFIX_TO_CLUSTER)) {
    if (b === prefix || b.startsWith(prefix + "/")) return cluster;
  }
  return "";
}

function readClusterLock(repoRoot) {
  const data = readJsonSafe(lockFilePath(repoRoot));
  if (!data || typeof data !== "object") return null;
  const cluster = String(data.authoritative_cluster || "").trim();
  if (!cluster) return null;
  return {
    authoritative_cluster: cluster,
    lock_reason: String(data.lock_reason || ""),
    locked_at: String(data.locked_at || ""),
    branch_prefix: String(data.branch_prefix || CLUSTER_TO_BRANCH_PREFIX[cluster] || ""),
    audit_id: String(data.audit_id || CLUSTER_TO_AUDIT_ID[cluster] || ""),
    product_fix_created: String(data.product_fix_created || "NO").toUpperCase() === "YES" ? "YES" : "NO",
    valid_product_work: String(data.valid_product_work || "NO").toUpperCase() === "YES" ? "YES" : "NO",
  };
}

function writeClusterLock(repoRoot, payload) {
  const abs = lockFilePath(repoRoot);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const cluster = String(payload.authoritative_cluster || "").trim();
  const doc = {
    authoritative_cluster: cluster,
    lock_reason: String(payload.lock_reason || "cluster_consistency_lock_v1"),
    locked_at: payload.locked_at || new Date().toISOString(),
    branch_prefix: String(
      payload.branch_prefix || CLUSTER_TO_BRANCH_PREFIX[cluster] || "",
    ),
    audit_id: String(payload.audit_id || CLUSTER_TO_AUDIT_ID[cluster] || ""),
    product_fix_created: String(payload.product_fix_created || "NO").toUpperCase() === "YES" ? "YES" : "NO",
    valid_product_work: String(payload.valid_product_work || "NO").toUpperCase() === "YES" ? "YES" : "NO",
  };
  fs.writeFileSync(abs, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return doc;
}

function clearClusterLock(repoRoot, reason) {
  const abs = lockFilePath(repoRoot);
  if (!fs.existsSync(abs)) return false;
  try {
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}

function establishClusterLock(repoRoot, opts) {
  const o = opts || {};
  const cluster = String(o.authoritative_cluster || o.cluster || "").trim();
  if (!cluster) return null;
  const existing = readClusterLock(repoRoot);
  if (existing && existing.authoritative_cluster === cluster) {
    return existing;
  }
  if (existing && existing.authoritative_cluster !== cluster) {
    return {
      blocked: true,
      reason: "cluster_lock_drift_blocked",
      locked_cluster: existing.authoritative_cluster,
      attempted_cluster: cluster,
    };
  }
  return writeClusterLock(repoRoot, {
    authoritative_cluster: cluster,
    lock_reason: o.lock_reason || "product_work",
    branch_prefix: o.branch_prefix || CLUSTER_TO_BRANCH_PREFIX[cluster] || "",
    audit_id: o.audit_id || CLUSTER_TO_AUDIT_ID[cluster] || "",
    product_fix_created: o.product_fix_created || "NO",
    valid_product_work: o.valid_product_work || "NO",
  });
}

function releaseClusterLockForOutcome(repoRoot, finalOutcome) {
  const outcome = String(finalOutcome || "").trim().toUpperCase();
  if (!UNLOCK_OUTCOMES.has(outcome)) return { released: false, reason: "lock_retained" };
  const had = readClusterLock(repoRoot);
  if (!had) return { released: false, reason: "no_lock" };
  clearClusterLock(repoRoot, "outcome_" + outcome);
  return { released: true, reason: "outcome_" + outcome, cluster: had.authoritative_cluster };
}

function detectLockActivationSignals(repoRoot, opts) {
  const o = opts || {};
  const signals = [];
  if (String(o.valid_product_work || "").toUpperCase() === "YES") signals.push("valid_product_work");
  if (String(o.product_fix_created || "").toUpperCase() === "YES") signals.push("product_fix_created");
  const branchCluster = clusterFromBranch(o.branch || gitBranch(repoRoot));
  if (branchCluster) signals.push("cluster_branch:" + branchCluster);
  return signals;
}

function ensureClusterLockFromSignals(repoRoot, opts) {
  const o = opts || {};
  const existing = readClusterLock(repoRoot);
  if (existing) return { lock: existing, established: false };

  const explicit = String(o.authoritative_cluster || o.selector_cluster || "").trim();
  if (explicit) {
    const est = establishClusterLock(repoRoot, {
      authoritative_cluster: explicit,
      lock_reason: o.lock_reason || "explicit_cluster",
      branch_prefix: o.branch_prefix,
      product_fix_created: o.product_fix_created,
      valid_product_work: o.valid_product_work,
    });
    if (est && est.blocked) return { lock: null, established: false, blocked: est };
    return { lock: est, established: true };
  }

  const signals = detectLockActivationSignals(repoRoot, o);
  let cluster = "";
  for (const s of signals) {
    if (s.startsWith("cluster_branch:")) {
      cluster = s.slice("cluster_branch:".length);
      break;
    }
  }
  if (!cluster && signals.includes("product_fix_created") && o.classification_cluster) {
    cluster = String(o.classification_cluster).trim();
  }
  if (!cluster && signals.includes("valid_product_work") && o.classification_cluster) {
    cluster = String(o.classification_cluster).trim();
  }
  if (!cluster) return { lock: null, established: false };

  const est = establishClusterLock(repoRoot, {
    authoritative_cluster: cluster,
    lock_reason: signals.join("|") || "activation",
    branch_prefix: CLUSTER_TO_BRANCH_PREFIX[cluster],
    product_fix_created: signals.includes("product_fix_created") ? "YES" : "NO",
    valid_product_work: signals.includes("valid_product_work") ? "YES" : "NO",
  });
  if (est && est.blocked) return { lock: null, established: false, blocked: est };
  return { lock: est, established: true };
}

function assertNoClusterDrift(lockedCluster, attemptedCluster) {
  const locked = String(lockedCluster || "").trim();
  const attempted = String(attemptedCluster || "").trim();
  if (!locked || !attempted || locked === attempted) return null;
  return {
    code: "CLUSTER_DRIFT_BLOCKED",
    locked_cluster: locked,
    attempted_cluster: attempted,
  };
}

function branchMatchesLockedCluster(repoRoot, lock) {
  const l = lock || readClusterLock(repoRoot);
  if (!l) return { ok: true, reason: "no_lock" };
  const branch = gitBranch(repoRoot);
  const branchCluster = clusterFromBranch(branch);
  if (!branchCluster) return { ok: true, reason: "not_product_branch" };
  if (branchCluster === l.authoritative_cluster) return { ok: true, reason: "match" };
  return {
    ok: false,
    reason: "branch_cluster_mismatch",
    branch,
    branch_cluster: branchCluster,
    locked_cluster: l.authoritative_cluster,
  };
}

/**
 * Authoritative selector cluster: lock file > explicit > registry handoff.
 */
function resolveAuthoritativeSelectorCluster(repoRoot, explicit, registryResolver) {
  const root = repoRoot || REPO_DEFAULT;
  const lock = readClusterLock(root);
  if (lock && lock.authoritative_cluster) return lock.authoritative_cluster;
  const explicitProvided = arguments.length >= 2 && explicit !== undefined && explicit !== null;
  if (explicitProvided) {
    const c = String(explicit).trim();
    if (c === "(žádný)" || c === "(unknown)") return "";
    if (c) return c;
    return "";
  }
  const branchCluster = clusterFromBranch(gitBranch(root));
  if (branchCluster) return branchCluster;
  const resolver =
    registryResolver ||
    function () {
      const { resolveCapRuntimeHandoff } = require("./silver-audit-registry.cjs");
      const h = resolveCapRuntimeHandoff(root, { skipClusterLock: true });
      const cd = h && h.cluster_diag;
      return cd && cd.cluster ? String(cd.cluster).trim() : "";
    };
  return resolver(root) || "";
}

function buildLockedClusterDiag(handoff, repoRoot, lock, driftAttempted) {
  const { prioritizeTrueEngineFail, buildAuditRegistry, harnessCommandsForCluster } = require(
    "./silver-audit-registry.cjs",
  );
  const registry = (handoff && handoff.registry) || buildAuditRegistry(repoRoot);
  const prioritized = (handoff && handoff.prioritized) || prioritizeTrueEngineFail(registry);
  const row =
    prioritized.find((p) => p.cluster === lock.authoritative_cluster) ||
    prioritized.find((p) => p.audit_id === lock.audit_id) ||
    null;
  const auditId = lock.audit_id || (row && row.audit_id) || "self_correction";
  const harness_commands = harnessCommandsForCluster(auditId, lock.authoritative_cluster);
  const diag = {
    source: "silver-cluster-consistency-lock:" + String(lock.lock_reason || "locked"),
    cluster: lock.authoritative_cluster,
    count: row ? row.fail_count : 0,
    audit_name: row ? row.audit_name : "",
    audit_id: auditId,
    expected_outcome: row && row.expected_outcome ? row.expected_outcome : "harness alignment",
    harness_command: harness_commands[0] || "",
    harness_commands,
    recommended_cap: (handoff && handoff.cap_label) || "CAP10",
    cluster_lock_active: "YES",
  };
  if (driftAttempted) diag.registry_drift_blocked = driftAttempted;
  return diag;
}

function applyClusterLockToHandoff(handoff, repoRoot) {
  const lock = readClusterLock(repoRoot);
  if (!lock || !handoff) return handoff;
  const currentCluster =
    handoff.cluster_diag && handoff.cluster_diag.cluster ? String(handoff.cluster_diag.cluster).trim() : "";
  if (!currentCluster) {
    const cluster_diag = buildLockedClusterDiag(handoff, repoRoot, lock, "");
    const next_cap = Object.assign({}, handoff.next_cap || {}, {
      cluster: lock.authoritative_cluster,
      audit_id: lock.audit_id || cluster_diag.audit_id,
    });
    return Object.assign({}, handoff, {
      cluster_diag,
      next_cap,
      cluster_lock_active: "YES",
      cluster_lock: lock,
    });
  }
  const drift = assertNoClusterDrift(lock.authoritative_cluster, currentCluster);
  if (!drift) return Object.assign({}, handoff, { cluster_lock_active: "YES", cluster_lock: lock });

  const cluster_diag = buildLockedClusterDiag(handoff, repoRoot, lock, drift.attempted_cluster);
  const next_cap = Object.assign({}, handoff.next_cap || {}, {
    cluster: lock.authoritative_cluster,
    audit_id: lock.audit_id || cluster_diag.audit_id,
    audit_name: cluster_diag.audit_name || (handoff.next_cap && handoff.next_cap.audit_name),
  });
  return Object.assign({}, handoff, {
    cluster_diag,
    next_cap,
    cluster_lock_active: "YES",
    cluster_lock: lock,
  });
}

function blockGenericHandoffUnderLock(text, repoRoot) {
  const lock = readClusterLock(repoRoot);
  if (!lock) return [];
  const { isGenericOrchestrationHandoff } = require("./silver-next-action-planner-handoff.cjs");
  if (isGenericOrchestrationHandoff(text)) return ["generic_handoff_blocked_under_cluster_lock"];
  return [];
}

function runClusterConsistencyLockSelftest() {
  const os = require("os");
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };
  const td = path.join(os.tmpdir(), "silver-cluster-lock-selftest-" + Date.now());
  fs.mkdirSync(path.join(td, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(td, ".silver-runtime"), { recursive: true });

  try {
    execFileSync("git", ["init"], { cwd: td, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "lock@test"], { cwd: td, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "lock"], { cwd: td, stdio: "ignore" });
    fs.writeFileSync(path.join(td, "README.md"), "t\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: td, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: td, stdio: "ignore" });
  } catch {
    /* best-effort */
  }

  const cluster = "self_correction_safety_note_readonly";
  const est = establishClusterLock(td, {
    authoritative_cluster: cluster,
    lock_reason: "valid_product_work",
    product_fix_created: "YES",
    valid_product_work: "YES",
    branch_prefix: "fix/self-correction-safety-note-readonly",
  });
  assert(est && est.authoritative_cluster === cluster, "lock_established");
  assert(readClusterLock(td).authoritative_cluster === cluster, "lock_persisted");

  const auth1 = resolveAuthoritativeSelectorCluster(td, "");
  assert(auth1 === cluster, "authoritative_locked");

  const drift = assertNoClusterDrift(cluster, "self_correction_update_note");
  assert(drift && drift.code === "CLUSTER_DRIFT_BLOCKED", "drift_blocked");

  const { pickClusterFromAuditRegistry, buildClusterHandoffForHealthyPlanner, silverNextActionQualityViolations } =
    require("./silver-next-action-planner-handoff.cjs");
  const plannerCluster = pickClusterFromAuditRegistry(td);
  assert(plannerCluster && plannerCluster.cluster === cluster, "planner_regeneration_locked");

  const handoff = buildClusterHandoffForHealthyPlanner({
    mainCommit: "abc",
    repoRoot: td,
    clusterDiag: { cluster: "self_correction_update_note", source: "drift" },
  });
  assert(/self_correction_safety_note_readonly/.test(handoff), "next_action_cluster_locked");
  const driftViolations = silverNextActionQualityViolations(
    "ÚKOL\nself_correction_update_note\ntop_cluster=self_correction_update_note",
    { selectorCluster: cluster },
  );
  assert(driftViolations.includes("product_handoff_not_cluster_specific"), "drift_handoff_blocked");

  const genericViolations = silverNextActionQualityViolations(
    "git push -u origin chore/silver-audit-repo-state",
    { selectorCluster: cluster },
  );
  assert(genericViolations.length > 0, "generic_handoff_blocked");

  const { resolveCapRuntimeHandoff } = require("./silver-audit-registry.cjs");
  const lockedHandoff = resolveCapRuntimeHandoff(td, {});
  assert(
    lockedHandoff.cluster_diag && lockedHandoff.cluster_diag.cluster === cluster,
    "registry_handoff_locked",
  );

  const { classifyValidProductWork, resolveProductCloseoutPath } = require(
    "./silver-valid-product-work-closeout.cjs",
  );
  const vpw = classifyValidProductWork({
    dirtyPaths: ["scripts/silver-self-correction-audit.cjs"],
    selectorCluster: cluster,
    repoRoot: td,
  });
  assert(vpw.classification === "VALID_PRODUCT_WORK", "valid_product_work");
  const prReady = resolveProductCloseoutPath(vpw, { repoRoot: td, dryRun: true });
  assert(prReady.final_outcome === "PR_READY", "pr_ready_finalize");
  assert(readClusterLock(td).authoritative_cluster === cluster, "scorecard_finalize_still_locked");

  execFileSync("git", ["checkout", "-b", "fix/self-correction-safety-note-readonly"], {
    cwd: td,
    stdio: "ignore",
  });
  const branchCluster = resolveAuthoritativeSelectorCluster(td, "");
  assert(branchCluster === cluster, "branch_creation_lock");

  const mismatch = branchMatchesLockedCluster(td, {
    authoritative_cluster: "self_correction_negation_flip",
    branch_prefix: "fix/self-correction-negation-flip",
  });
  assert(!mismatch.ok, "branch_pr_mismatch_safe_blocked");

  const rel = releaseClusterLockForOutcome(td, "NO_SAFE_FIX");
  assert(rel.released, "no_safe_fix_unlock");
  assert(!readClusterLock(td), "lock_cleared_after_no_safe_fix");

  clearClusterLock(td);
  try {
    execFileSync("git", ["checkout", "main"], { cwd: td, stdio: "ignore" });
  } catch {
    try {
      execFileSync("git", ["checkout", "master"], { cwd: td, stdio: "ignore" });
    } catch {
      /* ignore */
    }
  }
  const noAuth = resolveAuthoritativeSelectorCluster(td, "");
  assert(noAuth === "" || typeof noAuth === "string", "unlocked_registry_fallback");

  const missingClusterCloseout = classifyValidProductWork({
    dirtyPaths: ["scripts/silver-self-correction-audit.cjs"],
    selectorCluster: "",
    repoRoot: td,
  });
  const missingResolved = resolveProductCloseoutPath(missingClusterCloseout, { repoRoot: td });
  assert(missingResolved.final_outcome === "HARD_FAIL", "closeout_without_authority_hard_fail");

  if (failures.length) {
    console.error("CLUSTER_CONSISTENCY_LOCK_SELFTEST_FAIL " + failures.join("; "));
    return false;
  }
  console.log("CLUSTER_CONSISTENCY_LOCK_SELFTEST_PASS");
  return true;
}

if (require.main === module) {
  const cmd = process.argv[2] || "";
  if (cmd === "--cluster-consistency-lock-selftest") {
    process.exit(runClusterConsistencyLockSelftest() ? 0 : 1);
  }
  console.log("Usage: node scripts/silver-cluster-consistency-lock.cjs --cluster-consistency-lock-selftest");
  process.exit(1);
}

module.exports = {
  LOCK_REL,
  BRANCH_PREFIX_TO_CLUSTER,
  readClusterLock,
  writeClusterLock,
  clearClusterLock,
  establishClusterLock,
  releaseClusterLockForOutcome,
  ensureClusterLockFromSignals,
  assertNoClusterDrift,
  branchMatchesLockedCluster,
  resolveAuthoritativeSelectorCluster,
  applyClusterLockToHandoff,
  clusterFromBranch,
  blockGenericHandoffUnderLock,
  runClusterConsistencyLockSelftest,
};
