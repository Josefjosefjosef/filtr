#!/usr/bin/env node
/**
 * Durable 48h autonomous observation ledger (append-only).
 * Restores prior ledger, hydrates GitHub schedule evidence, evaluates window.
 * Does NOT flip growth gate. Owner EXECUTE remains separate.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const OBSERVATION_SCHEMA = "iu-cj-affiliate-phase3z-48h-observation-ledger-v51-8";
export const WINDOW_HOURS = 48;

/** Post-fix natural schedule after GH001/durable tip fix — observation restart anchor. */
export const OBSERVATION_RESTART_AFTER_CRITICAL_FIX = {
  startedAt: "2026-11-22T23:39:07.000Z",
  anchorSha: "243d0282572f741fdc563ccdd1d233c1e21c3c21",
  anchorRunId: "45084387230",
  anchorNote:
    "Restarted after critical schedule failures (tip-over-hard + GH001) were fixed; first post-fix natural SUCCESS 45084387230",
};

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
    runId: event.runId != null ? String(event.runId) : null,
    headSha: event.headSha || null,
    conclusion: event.conclusion || null,
    offersLiveSync: event.offersLiveSync || null,
    uniqueProducts: event.uniqueProducts ?? null,
    notes: event.notes || null,
    // Optional REFRESHED=0 residual classification (offline classifier output; never gates growth).
    residual: event.residual || null,
  };
  // Deduplicate by runId+eventName
  const exists = doc.events.some(
    (e) => String(e.runId) === String(ev.runId) && e.eventName === ev.eventName,
  );
  if (!exists) doc.events.push(ev);
  if (!doc.startedAt && ev.conclusion === "success" && ev.eventName === "schedule") {
    doc.startedAt = ev.at;
    doc.anchorSha = ev.headSha || doc.anchorSha;
  }
  if (doc.events.length > 400) doc.events = doc.events.slice(-400);
  doc.updatedAt = new Date().toISOString();
  doc.evaluation = evaluateObservationWindow(doc, { nowIso: ev.at });
  return doc;
}

/**
 * Apply critical-fix restart: drop pre-fix window if still anchored before fix.
 */
export function applyObservationRestartIfNeeded(ledger, restart = OBSERVATION_RESTART_AFTER_CRITICAL_FIX) {
  const doc = loadObservationLedger(ledger);
  const startMs = doc.startedAt ? Date.parse(doc.startedAt) : NaN;
  const restartMs = Date.parse(restart.startedAt);
  if (!Number.isFinite(restartMs)) return doc;
  if (!Number.isFinite(startMs) || startMs < restartMs) {
    doc.startedAt = restart.startedAt;
    doc.anchorSha = restart.anchorSha;
    doc.anchorNote = restart.anchorNote;
    doc.restart = {
      at: new Date().toISOString(),
      fromStartedAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
      reason: "CRITICAL_SCHEDULE_FAILURES_FIXED",
      anchorRunId: restart.anchorRunId,
    };
    // Keep events but evaluation only counts after new startedAt
  }
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
      catchupSuccessCount: 0,
      criticalFailuresAfterStart: [],
    };
  }
  const elapsedHours = Math.max(0, (nowMs - startMs) / 3600000);
  const after = (doc.events || []).filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t >= startMs;
  });
  const scheduleSuccess = after.filter(
    (e) => e.eventName === "schedule" && e.conclusion === "success",
  );
  const scheduleFailure = after.filter(
    (e) => e.eventName === "schedule" && e.conclusion === "failure",
  );
  const catchupSuccess = after.filter(
    (e) =>
      e.eventName === "workflow_dispatch" &&
      e.conclusion === "success" &&
      /catchup|CATCHUP/i.test(String(e.notes || "")),
  );
  const critical = after.filter(
    (e) =>
      e.conclusion === "failure" &&
      e.eventName === "schedule" &&
      (e.offersLiveSync === "failure" || e.kind === "catalog_sync"),
  );
  const complete =
    elapsedHours >= WINDOW_HOURS &&
    scheduleSuccess.length >= 2 &&
    critical.length === 0;
  const residualEvents = after.filter((e) => e.residual && e.residual.residualClass);
  const residualByClass = {};
  for (const e of residualEvents) {
    const c = String(e.residual.residualClass);
    residualByClass[c] = (residualByClass[c] || 0) + 1;
  }
  const lastResidual = residualEvents.length
    ? residualEvents[residualEvents.length - 1].residual
    : null;
  let consecutiveNonRefreshed = 0;
  for (let i = residualEvents.length - 1; i >= 0; i -= 1) {
    if (residualEvents[i].residual.refreshed === 0) consecutiveNonRefreshed += 1;
    else break;
  }
  return {
    refreshedZeroResidual: {
      observations: residualEvents.length,
      byClass: residualByClass,
      lastClass: lastResidual ? lastResidual.residualClass : null,
      consecutiveRefreshedZero: consecutiveNonRefreshed,
      lastBlocking: lastResidual ? lastResidual.blocking === true : null,
      informationalOnly: true,
    },
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
    catchupSuccessCount: catchupSuccess.length,
    criticalFailuresAfterStart: critical.slice(-10),
    startedAt: doc.startedAt,
    anchorSha: doc.anchorSha,
    endsAt: new Date(startMs + WINDOW_HOURS * 3600000).toISOString(),
    naturalScheduleOnly: true,
    note: "Catchup workflow_dispatch is recorded for ops but never counted as natural schedule success.",
  };
}

export function writeObservationLedger(absPath, ledger) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  return absPath;
}

/**
 * Hydrate schedule/catchup events from `gh run list` (optional; CI/local with gh).
 */
export function hydrateObservationFromGh(ledger, opts = {}) {
  let doc = loadObservationLedger(ledger);
  const limit = Math.max(20, Number(opts.limit) || 40);
  const repo = opts.repo || process.env.GITHUB_REPOSITORY || "Josefjosefjosef/filtr";
  const r = spawnSync(
    "gh",
    [
      "run",
      "list",
      "--repo",
      repo,
      "--workflow",
      "cj-affiliate-catalog-sync.yml",
      "--limit",
      String(limit),
      "--json",
      "databaseId,event,conclusion,status,createdAt,updatedAt,headSha,displayTitle",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    doc.hydrateError = String(r.stderr || r.stdout || "gh_run_list_failed").slice(0, 500);
    return doc;
  }
  let runs = [];
  try {
    runs = JSON.parse(r.stdout || "[]");
  } catch {
    doc.hydrateError = "gh_json_parse_failed";
    return doc;
  }
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const isCatchup = /CATCHUP/i.test(String(run.displayTitle || ""));
    doc = appendObservationEvent(doc, {
      at: run.createdAt,
      eventName: run.event,
      runId: run.databaseId,
      headSha: run.headSha,
      conclusion: run.conclusion,
      offersLiveSync: run.conclusion,
      notes: isCatchup ? "CATCHUP_DISPATCH_NOT_SCHEDULE" : null,
    });
  }
  doc.hydratedAt = new Date().toISOString();
  doc.evaluation = evaluateObservationWindow(doc);
  return doc;
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
        startedAt: process.env.IU_CJ_OBSERVATION_STARTED_AT || OBSERVATION_RESTART_AFTER_CRITICAL_FIX.startedAt,
        anchorSha: process.env.IU_CJ_OBSERVATION_ANCHOR_SHA || OBSERVATION_RESTART_AFTER_CRITICAL_FIX.anchorSha,
        anchorNote: OBSERVATION_RESTART_AFTER_CRITICAL_FIX.anchorNote,
      });
  doc = applyObservationRestartIfNeeded(doc);
  if (process.env.IU_CJ_OBSERVATION_HYDRATE_GH === "1") {
    doc = hydrateObservationFromGh(doc);
  }
  if (process.env.IU_CJ_OBSERVATION_APPEND === "1") {
    const jobStatus = String(process.env.IU_CJ_OBSERVATION_CONCLUSION || "").toLowerCase();
    const conclusion =
      jobStatus === "success" || jobStatus === "failure" || jobStatus === "cancelled"
        ? jobStatus
        : process.env.IU_CJ_OBSERVATION_CONCLUSION || null;
    const eventName = process.env.IU_CJ_OBSERVATION_EVENT_NAME || null;
    const notes =
      process.env.IU_CJ_OBSERVATION_NOTES ||
      (String(process.env.IU_CJ_CATCHUP_DISPATCH || "") === "1"
        ? "CATCHUP_DISPATCH_NOT_SCHEDULE"
        : null);
    doc = appendObservationEvent(doc, {
      eventName,
      runId: process.env.IU_CJ_OBSERVATION_RUN_ID || null,
      headSha: process.env.IU_CJ_OBSERVATION_HEAD_SHA || null,
      conclusion,
      offersLiveSync: process.env.IU_CJ_OBSERVATION_OFFERS_JOB || conclusion,
      uniqueProducts: process.env.IU_CJ_OBSERVATION_UNIQUE
        ? Number(process.env.IU_CJ_OBSERVATION_UNIQUE)
        : null,
      notes,
    });
  } else {
    doc.evaluation = evaluateObservationWindow(doc);
  }
  writeObservationLedger(p, doc);
  console.log(JSON.stringify({ ok: true, path: p, evaluation: doc.evaluation, restart: doc.restart || null }, null, 2));
}
