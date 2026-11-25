#!/usr/bin/env node
/**
 * V51.8 — ops monitoring snapshot (pure, no secrets, no IO).
 *
 * Aggregates catalog/ops counters and detects anomalies:
 *   MISSING_SCHEDULE, HOLD_SURGE, GROWTH_GATE_FLIP,
 *   UNAUTHORIZED_UNCAPPED, EMAIL_ARMED_UNEXPECTED
 *
 * CLI selftest: node scripts/iu-cj-affiliate-phase3z-ops-monitoring-snapshot-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import { classifyScheduleSlots } from "./iu-cj-affiliate-phase3z-schedule-slot-watch-v42.mjs";

export const OPS_MONITORING_SNAPSHOT_SCHEMA =
  "iu-cj-affiliate-phase3z-ops-monitoring-snapshot-v51-8";

export const OPS_INCIDENT_LEDGER_SCHEMA =
  "iu-cj-affiliate-phase3z-ops-incident-ledger-v51-8";

export const OPS_ANOMALY = Object.freeze({
  MISSING_SCHEDULE: "MISSING_SCHEDULE",
  MISSING_SCHEDULE_SLOT: "MISSING_SCHEDULE_SLOT",
  HOLD_SURGE: "HOLD_SURGE",
  GROWTH_GATE_FLIP: "GROWTH_GATE_FLIP",
  UNAUTHORIZED_UNCAPPED: "UNAUTHORIZED_UNCAPPED",
  EMAIL_ARMED_UNEXPECTED: "EMAIL_ARMED_UNEXPECTED",
});

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v, fallback = false) {
  if (v === true || v === false) return v;
  return fallback;
}

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/**
 * Normalize hold input: number | { count|current|hold, prior|baseline|holdPrior }.
 */
function normalizeHold(hold) {
  if (hold == null) return { current: 0, prior: null };
  if (typeof hold === "number") return { current: Math.max(0, Math.trunc(num(hold))), prior: null };
  const o = asObj(hold);
  const current = Math.max(
    0,
    Math.trunc(num(o.count ?? o.current ?? o.hold ?? 0)),
  );
  const priorRaw = o.prior ?? o.baseline ?? o.holdPrior;
  const prior =
    priorRaw == null || priorRaw === ""
      ? null
      : Math.max(0, Math.trunc(num(priorRaw)));
  return { current, prior };
}

/**
 * Normalize growth: { gate|enabled|open, priorGate|previousGate|wasEnabled, ownerApproved|authorized }.
 */
function normalizeGrowth(growth) {
  const o = asObj(growth);
  const gate =
    o.gate === true ||
    o.enabled === true ||
    o.open === true ||
    o.growthGate === true;
  const priorRaw = o.priorGate ?? o.previousGate ?? o.wasEnabled ?? o.prior;
  let priorGate = null;
  if (priorRaw === true || priorRaw === false) priorGate = priorRaw;
  else if (priorRaw != null && priorRaw !== "") priorGate = Boolean(priorRaw);
  const ownerApproved =
    o.ownerApproved === true ||
    o.authorized === true ||
    o.ownerGateOk === true;
  return { gate, priorGate, ownerApproved, raw: o };
}

/**
 * Build ops monitoring snapshot + anomaly list.
 *
 * @param {object} input
 * @param {string} [input.mainSha]
 * @param {object|string|null} [input.lastScheduleRun]
 * @param {object|string|null} [input.lastPromote]
 * @param {number} [input.uniqueProducts]
 * @param {number|object} [input.hold]
 * @param {number|object} [input.coupons]
 * @param {number|object} [input.actions]
 * @param {number|object} [input.partners]
 * @param {object} [input.growth]
 * @param {number|boolean} [input.retryQueueOpen]
 * @param {boolean} [input.emailPublishingArmed]
 * @param {boolean} [input.uncappedMode]
 */
export function buildOpsMonitoringSnapshot({
  mainSha,
  lastScheduleRun,
  lastPromote,
  uniqueProducts,
  hold,
  coupons,
  actions,
  partners,
  growth,
  retryQueueOpen,
  emailPublishingArmed,
  uncappedMode,
  scheduleRuns,
  now,
} = {}) {
  const nowDate = now instanceof Date ? now : now ? new Date(now) : new Date();
  const holdN = normalizeHold(hold);
  const growthN = normalizeGrowth(growth);
  const unique = Math.max(0, Math.trunc(num(uniqueProducts)));
  const couponsN =
    typeof coupons === "number"
      ? Math.max(0, Math.trunc(num(coupons)))
      : Math.max(0, Math.trunc(num(asObj(coupons).count ?? asObj(coupons).total ?? 0)));
  const actionsN =
    typeof actions === "number"
      ? Math.max(0, Math.trunc(num(actions)))
      : Math.max(0, Math.trunc(num(asObj(actions).count ?? asObj(actions).total ?? 0)));
  const partnersN =
    typeof partners === "number"
      ? Math.max(0, Math.trunc(num(partners)))
      : Math.max(
          0,
          Math.trunc(
            num(
              asObj(partners).count ??
                asObj(partners).joined ??
                asObj(partners).total ??
                0,
            ),
          ),
        );
  const retryOpen =
    typeof retryQueueOpen === "boolean"
      ? retryQueueOpen
      : Math.max(0, Math.trunc(num(retryQueueOpen))) > 0;
  const retryCount =
    typeof retryQueueOpen === "boolean"
      ? retryQueueOpen
        ? 1
        : 0
      : Math.max(0, Math.trunc(num(retryQueueOpen)));
  const emailArmed = bool(emailPublishingArmed, false);
  const uncapped = bool(uncappedMode, false);
  const scheduleMissing =
    lastScheduleRun == null ||
    lastScheduleRun === "" ||
    (typeof lastScheduleRun === "object" &&
      !lastScheduleRun.id &&
      !lastScheduleRun.databaseId &&
      !lastScheduleRun.at &&
      !lastScheduleRun.createdAt &&
      !lastScheduleRun.created_at &&
      !lastScheduleRun.status);

  const anomalies = [];

  if (scheduleMissing) {
    anomalies.push({
      code: OPS_ANOMALY.MISSING_SCHEDULE,
      level: "CRIT",
      detail: "lastScheduleRun missing or empty",
    });
  }

  // Natural schedule slot coverage (24h window). Only evaluated when the caller
  // supplies scheduleRuns (natural `schedule` event runs; never workflow_dispatch).
  let scheduleSlots = null;
  if (Array.isArray(scheduleRuns)) {
    const report = classifyScheduleSlots(scheduleRuns, nowDate);
    const missed = report.slots.filter((s) => s.classification === "SLOT_MISS");
    scheduleSlots = {
      watchResult: report.watchResult,
      burninStatus: report.burninStatus,
      counts: report.counts,
      missedSlots: missed.map((s) => ({ hour: s.hour, expectedUtc: s.expectedUtc })),
    };
    for (const s of missed) {
      anomalies.push({
        code: OPS_ANOMALY.MISSING_SCHEDULE_SLOT,
        level: missed.length >= 2 ? "CRIT" : "WARN",
        detail: `natural schedule slot ${String(s.hour).padStart(2, "0")}:17 UTC missing (expected ${s.expectedUtc})`,
        hour: s.hour,
        expectedUtc: s.expectedUtc,
      });
    }
  }

  if (
    holdN.prior != null &&
    holdN.prior > 0 &&
    holdN.current > holdN.prior * 2
  ) {
    anomalies.push({
      code: OPS_ANOMALY.HOLD_SURGE,
      level: "WARN",
      detail: `hold ${holdN.current} > 2x prior ${holdN.prior}`,
      current: holdN.current,
      prior: holdN.prior,
      ratio: Math.round((holdN.current / holdN.prior) * 100) / 100,
    });
  }

  if (growthN.priorGate != null && growthN.gate !== growthN.priorGate) {
    anomalies.push({
      code: OPS_ANOMALY.GROWTH_GATE_FLIP,
      level: "WARN",
      detail: `growth gate ${growthN.priorGate} → ${growthN.gate}`,
      priorGate: growthN.priorGate,
      gate: growthN.gate,
    });
  }

  if (uncapped === true && growthN.ownerApproved !== true) {
    anomalies.push({
      code: OPS_ANOMALY.UNAUTHORIZED_UNCAPPED,
      level: "CRIT",
      detail: "uncappedMode===true without owner approval",
    });
  }

  if (emailArmed === true) {
    anomalies.push({
      code: OPS_ANOMALY.EMAIL_ARMED_UNEXPECTED,
      level: "CRIT",
      detail: "emailPublishingArmed===true (expected DISARMED)",
    });
  }

  const ok = anomalies.length === 0;

  return {
    schema: OPS_MONITORING_SNAPSHOT_SCHEMA,
    at: nowDate.toISOString(),
    mainSha: mainSha != null ? String(mainSha) : null,
    scheduleSlots,
    lastScheduleRun: lastScheduleRun ?? null,
    lastPromote: lastPromote ?? null,
    metrics: {
      uniqueProducts: unique,
      hold: holdN.current,
      holdPrior: holdN.prior,
      coupons: couponsN,
      actions: actionsN,
      partners: partnersN,
      retryQueueOpen: retryOpen,
      retryQueueCount: retryCount,
      emailPublishingArmed: emailArmed,
      uncappedMode: uncapped,
      growthGate: growthN.gate,
      growthPriorGate: growthN.priorGate,
      growthOwnerApproved: growthN.ownerApproved,
    },
    growth: growthN.raw,
    anomalies,
    anomalyCodes: anomalies.map((a) => a.code),
    ok,
    notes: [
      "Pure snapshot — no secrets, no network, no source rewrites.",
      "HOLD_SURGE fires when current hold > 2× prior (prior>0).",
      "UNAUTHORIZED_UNCAPPED requires ownerApproved on growth.",
      "EMAIL_ARMED_UNEXPECTED whenever emailPublishingArmed is true.",
    ],
  };
}

export const OPS_INCIDENT_LEDGER_ENTRY_KEYS = Object.freeze([
  "incidentId",
  "code",
  "level",
  "status",
  "detectedAt",
  "detail",
  "slotExpectedUtc",
  "evidenceClass",
  "recommendedAction",
]);

const RECOMMENDED_ACTION = Object.freeze({
  [OPS_ANOMALY.MISSING_SCHEDULE]: "SCHEDULE_CATCHUP_IF_SLOT_MISS",
  [OPS_ANOMALY.MISSING_SCHEDULE_SLOT]: "SCHEDULE_CATCHUP_BOUNDED_DISPATCH",
  [OPS_ANOMALY.HOLD_SURGE]: "RECORD_INCIDENT_REVIEW_HOLD",
  [OPS_ANOMALY.GROWTH_GATE_FLIP]: "RECORD_INCIDENT_OWNER_REVIEW",
  [OPS_ANOMALY.UNAUTHORIZED_UNCAPPED]: "RECORD_INCIDENT_OWNER_REVIEW",
  [OPS_ANOMALY.EMAIL_ARMED_UNEXPECTED]: "RECORD_INCIDENT_OWNER_REVIEW",
});

/**
 * Pure incident ledger from a snapshot (deterministic ids; no IO, no secrets).
 * Never arms growth / email; recommendedAction is advisory text only.
 */
export function buildOpsIncidentLedger(snapshot) {
  const snap = asObj(snapshot);
  const anomalies = Array.isArray(snap.anomalies) ? snap.anomalies : [];
  const detectedAt = snap.at ?? new Date().toISOString();
  const entries = anomalies.map((a) => {
    const slotExpectedUtc = a.expectedUtc ?? null;
    const idSeed = [a.code, slotExpectedUtc ?? "", snap.mainSha ?? ""].join("|");
    return {
      incidentId:
        "inc-" + crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 16),
      code: a.code,
      level: a.level ?? "WARN",
      status: "OPEN",
      detectedAt,
      detail: a.detail ?? null,
      slotExpectedUtc,
      evidenceClass: "OFFLINE_SNAPSHOT",
      recommendedAction: RECOMMENDED_ACTION[a.code] ?? "RECORD_INCIDENT",
    };
  });
  const byLevel = { CRIT: 0, WARN: 0 };
  for (const e of entries) byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
  const m = asObj(snap.metrics);
  return {
    schema: OPS_INCIDENT_LEDGER_SCHEMA,
    generatedAt: detectedAt,
    mainSha: snap.mainSha ?? null,
    entries,
    counts: { total: entries.length, ...byLevel },
    gates: {
      growthGate: m.growthGate === true,
      uncappedMode: m.uncappedMode === true,
      emailPublishingArmed: m.emailPublishingArmed === true,
    },
    autoArmed: { growth: false, email: false },
    ok: entries.length === 0,
  };
}

/** Fixture selftest covering each anomaly + clean PASS path. */
export function runOpsMonitoringSnapshotSelftest() {
  const checks = [];
  function check(name, ok, detail) {
    checks.push({ name, ok: ok === true, detail: detail ?? null });
  }

  const clean = buildOpsMonitoringSnapshot({
    mainSha: "a".repeat(40),
    lastScheduleRun: { id: "run-1", at: "2026-11-25T00:00:00Z" },
    lastPromote: { id: "promo-1" },
    uniqueProducts: 2624,
    hold: { current: 100, prior: 90 },
    coupons: 12,
    actions: 3,
    partners: 40,
    growth: { gate: false, priorGate: false, ownerApproved: false },
    retryQueueOpen: 0,
    emailPublishingArmed: false,
    uncappedMode: false,
  });
  check("clean_ok", clean.ok === true, clean.anomalyCodes);
  check("clean_no_anomalies", clean.anomalies.length === 0, clean.anomalies);

  const missing = buildOpsMonitoringSnapshot({
    mainSha: "b".repeat(40),
    lastScheduleRun: null,
    uniqueProducts: 10,
    hold: { current: 1, prior: 1 },
    growth: { gate: false, priorGate: false },
    emailPublishingArmed: false,
    uncappedMode: false,
  });
  check(
    "missing_schedule",
    missing.anomalyCodes.includes(OPS_ANOMALY.MISSING_SCHEDULE),
    missing.anomalyCodes,
  );

  const surge = buildOpsMonitoringSnapshot({
    mainSha: "c".repeat(40),
    lastScheduleRun: { id: "ok" },
    hold: { current: 250, prior: 100 },
    growth: { gate: false, priorGate: false },
    emailPublishingArmed: false,
    uncappedMode: false,
  });
  check(
    "hold_surge_gt_2x",
    surge.anomalyCodes.includes(OPS_ANOMALY.HOLD_SURGE),
    surge.anomalyCodes,
  );

  const noSurge = buildOpsMonitoringSnapshot({
    mainSha: "d".repeat(40),
    lastScheduleRun: { id: "ok" },
    hold: { current: 180, prior: 100 },
    growth: { gate: false, priorGate: false },
    emailPublishingArmed: false,
    uncappedMode: false,
  });
  check(
    "hold_no_surge_at_1_8x",
    !noSurge.anomalyCodes.includes(OPS_ANOMALY.HOLD_SURGE),
    noSurge.anomalyCodes,
  );

  const flip = buildOpsMonitoringSnapshot({
    mainSha: "e".repeat(40),
    lastScheduleRun: { id: "ok" },
    hold: { current: 10, prior: 10 },
    growth: { gate: true, priorGate: false, ownerApproved: true },
    emailPublishingArmed: false,
    uncappedMode: false,
  });
  check(
    "growth_gate_flip",
    flip.anomalyCodes.includes(OPS_ANOMALY.GROWTH_GATE_FLIP),
    flip.anomalyCodes,
  );

  const uncappedBad = buildOpsMonitoringSnapshot({
    mainSha: "f".repeat(40),
    lastScheduleRun: { id: "ok" },
    hold: { current: 10, prior: 10 },
    growth: { gate: false, priorGate: false, ownerApproved: false },
    emailPublishingArmed: false,
    uncappedMode: true,
  });
  check(
    "unauthorized_uncapped",
    uncappedBad.anomalyCodes.includes(OPS_ANOMALY.UNAUTHORIZED_UNCAPPED),
    uncappedBad.anomalyCodes,
  );

  const uncappedOk = buildOpsMonitoringSnapshot({
    mainSha: "g".repeat(40),
    lastScheduleRun: { id: "ok" },
    hold: { current: 10, prior: 10 },
    growth: { gate: true, priorGate: true, ownerApproved: true },
    emailPublishingArmed: false,
    uncappedMode: true,
  });
  check(
    "authorized_uncapped_no_flag",
    !uncappedOk.anomalyCodes.includes(OPS_ANOMALY.UNAUTHORIZED_UNCAPPED),
    uncappedOk.anomalyCodes,
  );

  const emailArmed = buildOpsMonitoringSnapshot({
    mainSha: "h".repeat(40),
    lastScheduleRun: { id: "ok" },
    hold: { current: 10, prior: 10 },
    growth: { gate: false, priorGate: false },
    emailPublishingArmed: true,
    uncappedMode: false,
  });
  check(
    "email_armed_unexpected",
    emailArmed.anomalyCodes.includes(OPS_ANOMALY.EMAIL_ARMED_UNEXPECTED),
    emailArmed.anomalyCodes,
  );

  // --- Natural schedule slot coverage (offline fixtures, fixed clock) ---
  const NOW = new Date("2026-11-25T10:00:00.000Z");
  const slotRun = (hour, dayOffset, delayMin = 5) => {
    const base = Date.UTC(2026, 10, 25 + dayOffset, hour, 17, 0, 0);
    return {
      id: `r-${dayOffset}-${hour}`,
      created_at: new Date(base + delayMin * 60000).toISOString(),
      conclusion: "success",
      head_sha: "a".repeat(40),
    };
  };
  // 09:17 today is still PENDING_OBSERVATION (age 43m); 00..06 today + 12..21 yesterday are due.
  const allRuns = [
    slotRun(0, 0), slotRun(3, 0), slotRun(6, 0), slotRun(9, 0),
    slotRun(12, -1), slotRun(15, -1), slotRun(18, -1), slotRun(21, -1),
  ];
  const withoutHours = (hours) =>
    allRuns.filter((r) => !hours.some((h) => r.id.endsWith(`-${h}`) && r.id.startsWith("r-0")));
  const slotInput = (runs) => ({
    mainSha: "1".repeat(40),
    now: NOW,
    scheduleRuns: runs,
    lastScheduleRun: { id: "x", at: "2026-11-25T09:22:00Z" },
    hold: { current: 10, prior: 10 },
    growth: { gate: false, priorGate: false },
    emailPublishingArmed: false,
    uncappedMode: false,
  });

  const slotsOk = buildOpsMonitoringSnapshot(slotInput(allRuns));
  check(
    "slots_all_present_no_miss",
    !slotsOk.anomalyCodes.includes(OPS_ANOMALY.MISSING_SCHEDULE_SLOT) &&
      slotsOk.scheduleSlots?.counts?.miss === 0,
    slotsOk.scheduleSlots,
  );
  check("slots_all_present_ok", slotsOk.ok === true, slotsOk.anomalyCodes);

  const slotsPending = buildOpsMonitoringSnapshot(
    slotInput(allRuns.filter((r) => r.id !== "r-0-9")),
  );
  check(
    "slot_pending_not_missing",
    !slotsPending.anomalyCodes.includes(OPS_ANOMALY.MISSING_SCHEDULE_SLOT) &&
      slotsPending.scheduleSlots?.counts?.pending >= 1,
    slotsPending.scheduleSlots,
  );

  const slotsOneMiss = buildOpsMonitoringSnapshot(slotInput(withoutHours([6])));
  const oneMissAnoms = slotsOneMiss.anomalies.filter(
    (a) => a.code === OPS_ANOMALY.MISSING_SCHEDULE_SLOT,
  );
  check(
    "slot_one_miss_warn",
    oneMissAnoms.length === 1 &&
      oneMissAnoms[0].level === "WARN" &&
      oneMissAnoms[0].hour === 6 &&
      slotsOneMiss.ok === false,
    oneMissAnoms,
  );

  const slotsTwoMiss = buildOpsMonitoringSnapshot(slotInput(withoutHours([3, 6])));
  const twoMissAnoms = slotsTwoMiss.anomalies.filter(
    (a) => a.code === OPS_ANOMALY.MISSING_SCHEDULE_SLOT,
  );
  check(
    "slot_two_miss_crit",
    twoMissAnoms.length === 2 && twoMissAnoms.every((a) => a.level === "CRIT"),
    twoMissAnoms,
  );

  // --- Incident ledger schema ---
  const ledgerClean = buildOpsIncidentLedger(slotsOk);
  check(
    "ledger_clean_schema",
    ledgerClean.schema === OPS_INCIDENT_LEDGER_SCHEMA &&
      ledgerClean.ok === true &&
      ledgerClean.entries.length === 0 &&
      ledgerClean.counts.total === 0,
    ledgerClean,
  );

  const ledger = buildOpsIncidentLedger(slotsTwoMiss);
  check(
    "ledger_schema_name",
    ledger.schema === OPS_INCIDENT_LEDGER_SCHEMA,
    ledger.schema,
  );
  check(
    "ledger_entries_for_missing_slots",
    ledger.entries.length === 2 &&
      ledger.entries.every((e) => e.code === OPS_ANOMALY.MISSING_SCHEDULE_SLOT),
    ledger.entries,
  );
  check(
    "ledger_entry_keys_complete",
    ledger.entries.every((e) =>
      OPS_INCIDENT_LEDGER_ENTRY_KEYS.every((k) => Object.prototype.hasOwnProperty.call(e, k)),
    ),
    ledger.entries[0],
  );
  check(
    "ledger_entry_status_open_and_slot_set",
    ledger.entries.every(
      (e) => e.status === "OPEN" && /^\d{4}-\d{2}-\d{2}T/.test(String(e.slotExpectedUtc)),
    ),
    ledger.entries,
  );
  const ledgerAgain = buildOpsIncidentLedger(slotsTwoMiss);
  check(
    "ledger_ids_deterministic_and_unique",
    JSON.stringify(ledger.entries.map((e) => e.incidentId)) ===
      JSON.stringify(ledgerAgain.entries.map((e) => e.incidentId)) &&
      new Set(ledger.entries.map((e) => e.incidentId)).size === ledger.entries.length,
    ledger.entries.map((e) => e.incidentId),
  );
  check(
    "ledger_counts_match",
    ledger.counts.total === 2 && ledger.counts.CRIT === 2 && ledger.ok === false,
    ledger.counts,
  );
  check(
    "ledger_gates_disarmed_no_autoarm",
    ledger.gates.growthGate === false &&
      ledger.gates.uncappedMode === false &&
      ledger.gates.emailPublishingArmed === false &&
      ledger.autoArmed.growth === false &&
      ledger.autoArmed.email === false,
    { gates: ledger.gates, autoArmed: ledger.autoArmed },
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: OPS_MONITORING_SNAPSHOT_SCHEMA + "-selftest",
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
  const result = runOpsMonitoringSnapshotSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_OPS_MONITORING_SNAPSHOT_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
