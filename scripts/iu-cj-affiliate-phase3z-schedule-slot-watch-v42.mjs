#!/usr/bin/env node
/**
 * V42: classify catalog-sync schedule slots vs declared cadence.
 * Never treats workflow_dispatch as schedule. Never invents missing runs.
 *
 * Delay budget: GitHub cron may lag; hits within [-5, DELAY_BUDGET_MIN] minutes
 * of expected :17 UTC count as SLOT_HIT / SLOT_DELAYED. Beyond that → SLOT_MISS.
 */
import fs from "node:fs";

export const EXPECTED_HOURS_UTC = Object.freeze([0, 3, 6, 9, 12, 15, 18, 21]);
export const DELAY_BUDGET_MIN = 180;

/**
 * @param {Array<{created_at?: string, id?: number|string, conclusion?: string|null, head_sha?: string|null}>} runs
 * @param {Date} now
 * @param {{ delayBudgetMin?: number, windowHours?: number }} [opts]
 */
export function classifyScheduleSlots(runs, now = new Date(), opts = {}) {
  const delayBudgetMin = opts.delayBudgetMin ?? DELAY_BUDGET_MIN;
  const windowHours = opts.windowHours ?? 24;
  const observed = [];
  for (const r of runs || []) {
    const ts = r?.created_at;
    if (!ts) continue;
    const t = new Date(ts);
    if (Number.isNaN(t.getTime())) continue;
    observed.push({
      t,
      id: r.id,
      conclusion: r.conclusion ?? null,
      headSha: r.head_sha ?? null,
    });
  }
  observed.sort((a, b) => b.t - a.t);

  const slots = [];
  for (const h of EXPECTED_HOURS_UTC) {
    let slot = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 17, 0, 0)
    );
    if (slot.getTime() > now.getTime()) {
      slot = new Date(slot.getTime() - 24 * 3600 * 1000);
    }
    const ageH = (now.getTime() - slot.getTime()) / 3600000;
    if (ageH > windowHours) continue;

    let hit = null;
    for (const o of observed) {
      const deltaMin = (o.t.getTime() - slot.getTime()) / 60000;
      if (deltaMin >= -5 && deltaMin <= delayBudgetMin) {
        hit = { ...o, delayMin: deltaMin };
        break;
      }
    }

    if (hit) {
      const kind = hit.delayMin <= 30 ? "SLOT_HIT" : "SLOT_DELAYED";
      slots.push({
        hour: h,
        expectedUtc: slot.toISOString(),
        classification: kind,
        runId: String(hit.id),
        conclusion: hit.conclusion,
        headSha: hit.headSha,
        delayMin: Math.round(hit.delayMin * 10) / 10,
      });
    } else {
      const ageMin = (now.getTime() - slot.getTime()) / 60000;
      const classification =
        ageMin <= delayBudgetMin ? "PENDING_OBSERVATION" : "SLOT_MISS";
      slots.push({
        hour: h,
        expectedUtc: slot.toISOString(),
        classification,
        runId: null,
        conclusion: null,
        headSha: null,
        delayMin: null,
        ageMin: Math.round(ageMin * 10) / 10,
      });
    }
  }

  const missCount = slots.filter((s) => s.classification === "SLOT_MISS").length;
  const pendingCount = slots.filter((s) => s.classification === "PENDING_OBSERVATION").length;
  const hitCount = slots.filter(
    (s) => s.classification === "SLOT_HIT" || s.classification === "SLOT_DELAYED"
  ).length;
  const latest = observed[0] || null;
  const latestAgeHours = latest
    ? (now.getTime() - latest.t.getTime()) / 3600000
    : null;

  let burninStatus = "OK_CADENCE";
  let watchResult = "PASS";
  if (missCount >= 2) {
    burninStatus = "CADENCE_DEGRADED_MULTIPLE_SLOT_MISS";
    watchResult = "FAIL";
  } else if (missCount === 1) {
    burninStatus = "CADENCE_WARNING_SINGLE_SLOT_MISS";
    watchResult = "PASS";
  } else if (pendingCount > 0 && hitCount === 0 && !latest) {
    burninStatus = "NO_SCHEDULE_RUNS_YET";
    watchResult = "PENDING";
  } else if (
    latestAgeHours != null &&
    latestAgeHours > 6 &&
    missCount === 0 &&
    pendingCount > 0
  ) {
    burninStatus = "LATEST_OLDER_THAN_6H_WITH_PENDING_SLOTS";
    watchResult = "PENDING";
  }

  return {
    schema: "iu-cj-affiliate-phase3z-schedule-slot-watch-v42",
    nowUtc: now.toISOString(),
    delayBudgetMin,
    windowHours,
    observedScheduleCount: observed.length,
    latestSchedule: latest
      ? {
          runId: String(latest.id),
          at: latest.t.toISOString(),
          conclusion: latest.conclusion,
          headSha: latest.headSha,
          ageHours: Math.round(latestAgeHours * 100) / 100,
        }
      : null,
    slots,
    counts: { hitOrDelayed: hitCount, miss: missCount, pending: pendingCount },
    burninStatus,
    watchResult,
    note:
      "GitHub Actions cron is not minute-precise; SLOT_DELAYED within delay budget is expected. workflow_dispatch must never be passed into runs[].",
  };
}

export function printSlotWatchReport(report) {
  for (const s of report.slots) {
    if (s.classification === "SLOT_HIT" || s.classification === "SLOT_DELAYED") {
      console.log(
        `${s.classification} hour=${String(s.hour).padStart(2, "0")} run=${s.runId} conclusion=${s.conclusion} delay_min=${s.delayMin} sha=${(s.headSha || "").slice(0, 12)}`
      );
    } else {
      console.log(
        `${s.classification} hour=${String(s.hour).padStart(2, "0")} expected_utc=${s.expectedUtc}`
      );
    }
  }
  console.log(`SLOT_MISS_COUNT_24H=${report.counts.miss}`);
  console.log(`WATCH_RESULT=${report.watchResult}`);
  console.log(`BURNIN_STATUS=${report.burninStatus}`);
}

const isDirect =
  process.argv[1] &&
  String(process.argv[1]).replace(/\\/g, "/").endsWith("iu-cj-affiliate-phase3z-schedule-slot-watch-v42.mjs");

if (isDirect) {
  const rawPath = process.argv[2];
  if (!rawPath) {
    console.error(
      "Usage: node iu-cj-affiliate-phase3z-schedule-slot-watch-v42.mjs <schedule-runs.json>"
    );
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const runs = Array.isArray(raw) ? raw : raw.workflow_runs || [];
  const report = classifyScheduleSlots(runs, new Date());
  console.log(JSON.stringify(report, null, 2));
  printSlotWatchReport(report);
  if (report.watchResult === "FAIL") process.exit(1);
}
