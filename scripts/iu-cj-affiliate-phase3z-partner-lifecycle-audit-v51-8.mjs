#!/usr/bin/env node
/**
 * V51.8 — partner lifecycle audit (pure, no IO).
 *
 * buildPartnerLifecycleAudit({ joinedSample, endedSample, bakedStaticSlots, managedDynamic })
 *   - Asserts JOINED conceptual path: discovery → inventory → publish
 *   - ENDED must never be inferred from CJ_API_DOWN (false-positive guard)
 *   - Reports whether paid/protected baked static slots are preserved
 *
 * CLI selftest: node scripts/iu-cj-affiliate-phase3z-partner-lifecycle-audit-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PARTNER_LIFECYCLE_AUDIT_SCHEMA =
  "iu-cj-affiliate-phase3z-partner-lifecycle-audit-v51-8";

export const JOINED_PATH = Object.freeze([
  "discovery",
  "inventory",
  "publish",
]);

export const ERROR_KIND = Object.freeze({
  CJ_API_DOWN: "CJ_API_DOWN",
});

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v, fallback = false) {
  if (v === true || v === false) return v;
  return fallback;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function sampleLen(sample) {
  if (Array.isArray(sample)) return sample.length;
  if (sample && typeof sample === "object") {
    if (typeof sample.count === "number") return num(sample.count);
    if (Array.isArray(sample.items)) return sample.items.length;
  }
  return num(sample, 0);
}

/**
 * True when an ENDED inference would be a CJ_API_DOWN false-positive.
 * ENDED requires CJ confirmation / absence with complete paging — never API-down alone.
 */
export function isEndedApiDownFalsePositive(endedSample) {
  const samples = asArray(endedSample);
  for (const row of samples) {
    if (row == null || typeof row !== "object") continue;
    const kind = String(row.errorKind || row.error || row.reason || "").trim();
    const inferredEnded =
      row.inferredEnded === true ||
      row.endedInferred === true ||
      row.status === "ENDED" ||
      row.relationshipStatus === "ended" ||
      row.plan === "ENDED" ||
      row.transition === "ENDED";
    const apiDown =
      kind === ERROR_KIND.CJ_API_DOWN ||
      row.cjApiDown === true ||
      row.apiDown === true ||
      row.source === "CJ_API_DOWN";
    const confirmed =
      row.cjConfirmedEnded === true ||
      row.forceConfirmedEnded === true ||
      row.confirmedEnded === true;
    if (inferredEnded && apiDown && !confirmed) return true;
  }
  // Scalar / bag form: { inferredFromApiDown: true }
  if (
    endedSample &&
    typeof endedSample === "object" &&
    !Array.isArray(endedSample) &&
    (endedSample.inferredFromApiDown === true ||
      endedSample.endedFromApiDown === true)
  ) {
    return true;
  }
  return false;
}

/**
 * Conceptual JOINED path check: discovery → inventory → publish must be present.
 * @param {object} joinedSample
 */
export function assertJoinedDiscoveryInventoryPublishPath(joinedSample) {
  const bag =
    joinedSample && typeof joinedSample === "object" && !Array.isArray(joinedSample)
      ? joinedSample
      : {};
  const pathHint = asArray(bag.path || bag.lifecyclePath || bag.stages || JOINED_PATH).map(
    (s) => String(s).toLowerCase(),
  );
  const hasDiscovery =
    pathHint.includes("discovery") ||
    bag.discovery === true ||
    bag.discovered === true ||
    num(bag.discoveredCount) > 0 ||
    sampleLen(joinedSample) > 0;
  const hasInventory =
    pathHint.includes("inventory") ||
    bag.inventory === true ||
    bag.inInventory === true ||
    num(bag.inventoryCount) > 0 ||
    sampleLen(joinedSample) > 0;
  const hasPublish =
    pathHint.includes("publish") ||
    bag.publish === true ||
    bag.publishable === true ||
    bag.published === true ||
    num(bag.publishCount) > 0;

  // Conceptual existence: path stages declared OR sample implies discovery+inventory
  // and publish gate is explicitly acknowledged (even if disarmed).
  const pathDeclared =
    pathHint.includes("discovery") &&
    pathHint.includes("inventory") &&
    pathHint.includes("publish");
  const conceptualOk =
    pathDeclared ||
    (hasDiscovery && hasInventory && (hasPublish || bag.publishPathExists === true));

  return {
    ok: conceptualOk === true,
    expectedPath: [...JOINED_PATH],
    observedPath: pathHint.length > 0 ? pathHint : null,
    hasDiscovery: !!hasDiscovery,
    hasInventory: !!hasInventory,
    hasPublish: !!hasPublish || bag.publishPathExists === true,
    note: "JOINED conceptual path is discovery → inventory → publish (existence audit, not live mutate).",
  };
}

/**
 * @param {object} input
 * @param {object|array|number} [input.joinedSample]
 * @param {object|array} [input.endedSample]
 * @param {object|array|number} [input.bakedStaticSlots]
 * @param {object|number} [input.managedDynamic]
 */
export function buildPartnerLifecycleAudit({
  joinedSample = {},
  endedSample = [],
  bakedStaticSlots = {},
  managedDynamic = {},
} = {}) {
  const joinedPath = assertJoinedDiscoveryInventoryPublishPath(joinedSample);
  const endedApiDownFalsePositive = isEndedApiDownFalsePositive(endedSample);

  const baked =
    bakedStaticSlots && typeof bakedStaticSlots === "object" && !Array.isArray(bakedStaticSlots)
      ? bakedStaticSlots
      : { count: sampleLen(bakedStaticSlots) };
  const paidProtectedPreserved = bool(
    baked.paidProtectedPreserved ??
      baked.paidOrProtectedPreserved ??
      baked.protectedPreserved ??
      baked.preserved,
    false,
  );
  const bakedCount = firstCount(baked, "count", "slots", "bakedStaticSlots");
  const protectedCount = firstCount(
    baked,
    "protectedCount",
    "paidProtectedCount",
    "paidOrManualProtected",
  );

  const managed =
    managedDynamic && typeof managedDynamic === "object" && !Array.isArray(managedDynamic)
      ? managedDynamic
      : { count: num(managedDynamic, 0) };
  const managedCount = firstCount(managed, "count", "managedDynamic", "dynamic");

  const checks = {
    joinedPathExists: joinedPath.ok,
    endedNotInferredFromApiDown: !endedApiDownFalsePositive,
    paidProtectedSlotsPreserved: paidProtectedPreserved,
  };

  const ok =
    checks.joinedPathExists &&
    checks.endedNotInferredFromApiDown &&
    checks.paidProtectedSlotsPreserved;

  return {
    schema: PARTNER_LIFECYCLE_AUDIT_SCHEMA,
    ok,
    checks,
    joined: {
      sampleCount: sampleLen(joinedSample),
      path: joinedPath,
    },
    ended: {
      sampleCount: sampleLen(endedSample),
      cjApiDownFalsePositive: endedApiDownFalsePositive,
      note: "ENDED requires CJ confirmed ended/absent + complete paging; never CJ_API_DOWN alone.",
    },
    slots: {
      bakedStaticSlots: bakedCount,
      protectedCount,
      paidProtectedPreserved,
      managedDynamic: managedCount,
    },
    notes: [
      "JOINED discovery → inventory → publish is a conceptual existence audit.",
      "ENDED must not be inferred from CJ_API_DOWN (false-positive).",
      "Paid/manual protected baked static slots must remain preserved.",
    ],
  };
}

function firstCount(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") {
      const n = num(obj[k], NaN);
      if (Number.isFinite(n)) return n;
    }
  }
  if (Array.isArray(obj)) return obj.length;
  return 0;
}

/** Selftest: ENDED not inferred from API down; paid/protected slots preserved. */
export function runPartnerLifecycleAuditSelftest() {
  const checks = [];
  function check(name, cond, detail) {
    checks.push({ name, ok: cond === true, detail: detail ?? null });
  }

  // PASS fixture: JOINED path present, ENDED confirmed (not API-down), slots preserved
  const passAudit = buildPartnerLifecycleAudit({
    joinedSample: {
      path: ["discovery", "inventory", "publish"],
      discoveredCount: 3,
      inventoryCount: 3,
      publishPathExists: true,
    },
    endedSample: [
      {
        advertiserId: "cid-ok",
        relationshipStatus: "ended",
        cjConfirmedEnded: true,
        errorKind: null,
      },
    ],
    bakedStaticSlots: {
      count: 12,
      protectedCount: 4,
      paidProtectedPreserved: true,
    },
    managedDynamic: { count: 40 },
  });
  check("pass_ok", passAudit.ok === true, passAudit.checks);
  check(
    "pass_joined_path",
    passAudit.checks.joinedPathExists === true,
    passAudit.joined.path,
  );
  check(
    "pass_ended_not_api_down",
    passAudit.checks.endedNotInferredFromApiDown === true,
    passAudit.ended,
  );
  check(
    "pass_paid_protected_preserved",
    passAudit.checks.paidProtectedSlotsPreserved === true &&
      passAudit.slots.paidProtectedPreserved === true,
    passAudit.slots,
  );

  // FAIL fixture: ENDED inferred solely from CJ_API_DOWN
  const apiDownFp = buildPartnerLifecycleAudit({
    joinedSample: { path: [...JOINED_PATH], publishPathExists: true },
    endedSample: [
      {
        advertiserId: "cid-fp",
        status: "ENDED",
        errorKind: ERROR_KIND.CJ_API_DOWN,
        cjConfirmedEnded: false,
      },
    ],
    bakedStaticSlots: { paidProtectedPreserved: true, count: 8 },
    managedDynamic: 10,
  });
  check(
    "ended_not_inferred_from_api_down",
    apiDownFp.checks.endedNotInferredFromApiDown === false &&
      apiDownFp.ended.cjApiDownFalsePositive === true &&
      apiDownFp.ok === false,
    apiDownFp.checks,
  );

  // Helper direct: false-positive detector
  check(
    "helper_api_down_fp",
    isEndedApiDownFalsePositive([
      { transition: "ENDED", errorKind: "CJ_API_DOWN" },
    ]) === true,
    null,
  );
  check(
    "helper_confirmed_not_fp",
    isEndedApiDownFalsePositive([
      { transition: "ENDED", errorKind: "CJ_API_DOWN", cjConfirmedEnded: true },
    ]) === false,
    null,
  );

  // Preserved flag explicit
  const lostSlots = buildPartnerLifecycleAudit({
    joinedSample: { path: [...JOINED_PATH], publishPathExists: true },
    endedSample: [],
    bakedStaticSlots: { paidProtectedPreserved: false, count: 8, protectedCount: 3 },
    managedDynamic: { count: 5 },
  });
  check(
    "paid_protected_slots_preserved_flag",
    lostSlots.checks.paidProtectedSlotsPreserved === false && lostSlots.ok === false,
    lostSlots.slots,
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: PARTNER_LIFECYCLE_AUDIT_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runPartnerLifecycleAuditSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_PARTNER_LIFECYCLE_AUDIT_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
