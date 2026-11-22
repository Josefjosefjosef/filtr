#!/usr/bin/env node
/**
 * Durable 48h autonomous observation ledger (append-only).
 * Evaluates whether post-fix production observation window is complete.
 * Does NOT flip growth gate. Owner EXECUTE remains separate.
 */
import fs from "node:fs";
import path from "node:path";

export const OBSERVATION_SCHEMA = "iu-cj-affiliate-phase3z-48h-observation-ledger-v51-8";
export const WINDOW_HOURS = 48;

export function emptyObservationLedger(opts = {}) {
  return {
    schema: OBSERVATION_SCHEMA,
    windowHours: WINDOW_HOURS,
    startedAt: opts.startedAt || null,
    anchorSha: opts.anchorSha || null,
    anchorNote: opts.anchorNote || null,
    updatedAt: new Date().toISOString(),
    events: [],
    evaluation: null,
  };
}

export function loadObservationLedger(raw) {
  if (!raw || typeof raw !== "object") return emptyObservationLedger();
  return {
    ...emptyObservationLedger(),
    ...raw,
    events: Array.isArray(raw.events) ? raw.events : [],
  };
}

export function appendObservationEvent(ledger, event) {
  const doc = loadObservationLedger(ledger);
  const ev = {
    at: event.at || new Date().toISOString(),
    kind: event.kind || "catalog_sync",
    eventName: event.eventName || null,
    runId: event.runId || null,
    headSha: event.headSha || null,
    conclusion: event.conclusion || null,
    offersLiveSync: event.offersLiveSync || null,
    uniqueProducts: event.uniqueProducts ?? null,
    notes: event.notes || null,
  };
  if (!doc.startedAt && ev.conclusion === "success" && ev.eventName === "schedule") {
    doc.startedAt = ev.at;
    doc.anchorSha = ev.headSha || doc.anchorSha;
  }
  doc.events.push(ev);
  // Keep last 200 events
  if (doc.events.length > 200) doc.events = doc.events.slice(-200);
  doc.updatedAt = new Date().toISOString();
  doc.evaluation = evaluateObservationWindow(doc, { nowIso: ev.at });
  return doc;
}

export function evaluateObservationWindow(ledger, opts = {}) {
  const doc = loadObservationLedger(ledger);
  const nowMs = Date.parse(opts.nowIso || new Date().toISOString());
  const startMs = doc.startedAt ? Date.parse(doc.startedAt) : NaN;
  if (!Number.isFinite(startMs)) {
    return {
      complete: false,
      reason: "WINDOW_NOT_STARTED",
      elapsedHours: 0,
      requiredHours: WINDOW_HOURS,
      scheduleSuccessCount: 0,
      scheduleFailureCount: 0,
      criticalFailuresAfterStart: [],
    };
  }
  const elapsedHours = Math.max(0, (nowMs - startMs) / 3600000);
  const after = (doc.events || []).filter((e) => Date.parse(e.at) >= startMs);
  const scheduleSuccess = after.filter(
    (e) => e.eventName === "schedule" && e.conclusion === "success",
  );
  const scheduleFailure = after.filter(
    (e) => e.eventName === "schedule" && e.conclusion === "failure",
  );
  const critical = after.filter(
    (e) =>
      e.conclusion === "failure" &&
      (e.offersLiveSync === "failure" || e.kind === "catalog_sync") &&
      e.eventName === "schedule",
  );
  const complete =
    elapsedHours >= WINDOW_HOURS &&
    scheduleSuccess.length >= 2 &&
    critical.length === 0;
  return {
    complete,
    reason: complete
      ? "OBSERVATION_48H_CLEAN"
      : elapsedHours < WINDOW_HOURS
        ? "PENDING_48H_ELAPSED"
        : critical.length
          ? "CRITICAL_SCHEDULE_FAILURES_IN_WINDOW"
          : "INSUFFICIENT_SCHEDULE_SUCCESSES",
    elapsedHours: Number(elapsedHours.toFixed(3)),
    requiredHours: WINDOW_HOURS,
    scheduleSuccessCount: scheduleSuccess.length,
    scheduleFailureCount: scheduleFailure.length,
    criticalFailuresAfterStart: critical.slice(-10),
    startedAt: doc.startedAt,
    anchorSha: doc.anchorSha,
  };
}

export function writeObservationLedger(absPath, ledger) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  return absPath;
}

const isDirect =
  process.argv[1] &&
  process.argv[1]
    .replace(/\\/g, "/")
    .endsWith("iu-cj-affiliate-phase3z-48h-observation-ledger-v51-8.mjs");
if (isDirect) {
  const p =
    process.env.IU_CJ_OBSERVATION_LEDGER_PATH ||
    path.join(process.env.TEMP || "/tmp", "iu-48h-observation-ledger.json");
  let doc = fs.existsSync(p)
    ? loadObservationLedger(JSON.parse(fs.readFileSync(p, "utf8")))
    : emptyObservationLedger({
        startedAt: process.env.IU_CJ_OBSERVATION_STARTED_AT || null,
        anchorSha: process.env.IU_CJ_OBSERVATION_ANCHOR_SHA || null,
        anchorNote: "Seeded from first post-merge successful schedule 44961819737",
      });
  if (!doc.startedAt && process.env.IU_CJ_OBSERVATION_STARTED_AT) {
    doc.startedAt = process.env.IU_CJ_OBSERVATION_STARTED_AT;
    doc.anchorSha = process.env.IU_CJ_OBSERVATION_ANCHOR_SHA || doc.anchorSha;
  }
  if (process.env.IU_CJ_OBSERVATION_APPEND === "1") {
    // Map GitHub job.status (success/failure) onto conclusion.
    const jobStatus = String(process.env.IU_CJ_OBSERVATION_CONCLUSION || "").toLowerCase();
    const conclusion =
      jobStatus === "success" || jobStatus === "failure" || jobStatus === "cancelled"
        ? jobStatus
        : process.env.IU_CJ_OBSERVATION_CONCLUSION || null;
    doc = appendObservationEvent(doc, {
      eventName: process.env.IU_CJ_OBSERVATION_EVENT_NAME || null,
      runId: process.env.IU_CJ_OBSERVATION_RUN_ID || null,
      headSha: process.env.IU_CJ_OBSERVATION_HEAD_SHA || null,
      conclusion,
      offersLiveSync: process.env.IU_CJ_OBSERVATION_OFFERS_JOB || conclusion,
      uniqueProducts: process.env.IU_CJ_OBSERVATION_UNIQUE
        ? Number(process.env.IU_CJ_OBSERVATION_UNIQUE)
        : null,
    });
  } else {
    doc.evaluation = evaluateObservationWindow(doc);
  }
  writeObservationLedger(p, doc);
  console.log(JSON.stringify({ ok: true, path: p, evaluation: doc.evaluation }, null, 2));
}
