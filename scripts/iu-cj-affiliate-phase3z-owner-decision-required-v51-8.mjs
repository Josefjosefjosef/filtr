#!/usr/bin/env node
/**
 * V51.8 — owner decisions still required before activation (pure, no IO).
 *
 * buildOwnerDecisionRequired() returns a structured list of decisions that
 * remain OWNER_APPROVAL_REQUIRED. Technical prep may be done; activation is
 * forbidden until explicit owner approval.
 *
 * CLI selftest:
 *   node scripts/iu-cj-affiliate-phase3z-owner-decision-required-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const OWNER_DECISION_REQUIRED_SCHEMA =
  "iu-cj-affiliate-phase3z-owner-decision-required-v51-8";

export const OWNER_DECISION_IDS = Object.freeze([
  "UNCAPPED_GROWTH",
  "GROWTH_EXECUTE",
  "EMAIL_PUBLISH",
  "D1_NONCE_INFRA",
  "R2_MIGRATION",
  "FORPSI_IMAP_CONNECT",
]);

export const OWNER_DECISION_STATUS = Object.freeze({
  OWNER_APPROVAL_REQUIRED: "OWNER_APPROVAL_REQUIRED",
});

/**
 * @param {object} [opts]
 * @param {Record<string, boolean>} [opts.technicalPrepDoneById]
 * @returns {{ schema: string, at: string, decisions: Array<object>, count: number }}
 */
export function buildOwnerDecisionRequired(opts = {}) {
  const byId =
    opts.technicalPrepDoneById && typeof opts.technicalPrepDoneById === "object"
      ? opts.technicalPrepDoneById
      : {};

  const decisions = OWNER_DECISION_IDS.map((id) => ({
    id,
    status: OWNER_DECISION_STATUS.OWNER_APPROVAL_REQUIRED,
    technicalPrepDone: byId[id] === false ? false : true,
    activationForbiddenUntilApproval: true,
  }));

  return {
    schema: OWNER_DECISION_REQUIRED_SCHEMA,
    at: new Date().toISOString(),
    decisions,
    count: decisions.length,
    note: "All listed activations stay forbidden until explicit owner approval.",
  };
}

/** Selftest: all required ids present; activationForbiddenUntilApproval always true. */
export function runOwnerDecisionRequiredSelftest() {
  const checks = [];
  function check(name, cond, detail) {
    checks.push({ name, ok: cond === true, detail: detail ?? null });
  }

  const doc = buildOwnerDecisionRequired();
  const ids = (doc.decisions || []).map((d) => d.id);

  for (const id of OWNER_DECISION_IDS) {
    check(`id_present_${id}`, ids.includes(id), ids);
  }

  check("count_matches", doc.count === OWNER_DECISION_IDS.length, doc.count);
  check(
    "all_status_OWNER_APPROVAL_REQUIRED",
    (doc.decisions || []).every(
      (d) => d.status === OWNER_DECISION_STATUS.OWNER_APPROVAL_REQUIRED,
    ),
    (doc.decisions || []).map((d) => d.status),
  );
  check(
    "all_activationForbiddenUntilApproval_true",
    (doc.decisions || []).every((d) => d.activationForbiddenUntilApproval === true),
    (doc.decisions || []).map((d) => d.activationForbiddenUntilApproval),
  );
  check(
    "technicalPrepDone_is_boolean",
    (doc.decisions || []).every((d) => typeof d.technicalPrepDone === "boolean"),
    (doc.decisions || []).map((d) => d.technicalPrepDone),
  );

  const overridden = buildOwnerDecisionRequired({
    technicalPrepDoneById: { R2_MIGRATION: false },
  });
  const r2 = (overridden.decisions || []).find((d) => d.id === "R2_MIGRATION");
  check(
    "override_technicalPrepDone_false",
    r2?.technicalPrepDone === false && r2?.activationForbiddenUntilApproval === true,
    r2,
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: OWNER_DECISION_REQUIRED_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
    sample: {
      count: doc.count,
      ids,
    },
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runOwnerDecisionRequiredSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_OWNER_DECISION_REQUIRED_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
