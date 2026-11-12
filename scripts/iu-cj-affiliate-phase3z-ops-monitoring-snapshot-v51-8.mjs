/**
 * V51.8 — ops monitoring snapshot builder (no secrets).
 * Aggregates schedule/watch/CF probe/catalog freshness into one audit object.
 */
import fs from "node:fs";
import path from "node:path";

export const OPS_MONITORING_SNAPSHOT_SCHEMA =
  "iu-cj-affiliate-phase3z-ops-monitoring-snapshot-v51-8";

export function buildOpsMonitoringSnapshot(input = {}) {
  const catalogRuns = Array.isArray(input.catalogRuns) ? input.catalogRuns : [];
  const watchRuns = Array.isArray(input.watchRuns) ? input.watchRuns : [];
  const nowMs = input.nowMs != null ? Number(input.nowMs) : Date.now();

  const latestSchedule = catalogRuns.find((r) => String(r.event) === "schedule") || null;
  const latestCatchup =
    catalogRuns.find(
      (r) =>
        String(r.event) === "workflow_dispatch" &&
        String(r.displayTitle || r.display_title || "").includes("CATCHUP"),
    ) || null;
  const latestSuccess = catalogRuns.find((r) => String(r.conclusion) === "success") || null;

  const ageHours = (iso) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return Math.round(((nowMs - t) / 3600000) * 100) / 100;
  };

  const cf = input.cfProbe || {};
  const alerts = [];
  const successAge = ageHours(latestSuccess?.createdAt || latestSuccess?.created_at);
  if (successAge != null && successAge >= 4) {
    alerts.push({ level: "WARN", code: "CATALOG_SYNC_AGE_GE_4H", ageHours: successAge });
  }
  if (successAge != null && successAge >= 8) {
    alerts.push({ level: "CRIT", code: "CATALOG_SYNC_AGE_GE_8H", ageHours: successAge });
  }
  if (cf?.decision?.action === "dispatch") {
    alerts.push({ level: "WARN", code: "CF_WATCHDOG_WANTS_DISPATCH", decision: cf.decision });
  }

  return {
    schema: OPS_MONITORING_SNAPSHOT_SCHEMA,
    at: new Date(nowMs).toISOString(),
    catalog: {
      latestScheduleId: latestSchedule?.databaseId || latestSchedule?.id || null,
      latestScheduleAt: latestSchedule?.createdAt || latestSchedule?.created_at || null,
      latestCatchupId: latestCatchup?.databaseId || latestCatchup?.id || null,
      latestSuccessAt: latestSuccess?.createdAt || latestSuccess?.created_at || null,
      latestSuccessAgeHours: successAge,
    },
    watch: {
      latestId: watchRuns[0]?.databaseId || watchRuns[0]?.id || null,
      latestAt: watchRuns[0]?.createdAt || watchRuns[0]?.created_at || null,
      latestConclusion: watchRuns[0]?.conclusion || null,
    },
    cloudflareWatchdog: {
      healthOk: input.cfHealth?.ok === true,
      observeOnly: cf.observeOnly === true,
      decision: cf.decision || null,
      generatedAt: cf.generatedAt || null,
      catchupsToday: cf.catchupsToday ?? null,
    },
    catalogStats: input.catalogStats || null,
    growth: input.growth || null,
    invalidFeed: input.invalidFeed || null,
    alerts,
    recoveryPath:
      "GHA schedule-watch catch-up OR CF cron/watchdog catch-up (workflow_dispatch CATCHUP_DISPATCH_NOT_SCHEDULE); same concurrency group; daycap 4; cooldown 1–2h.",
  };
}

export function writeOpsMonitoringSnapshot(outPath, input = {}) {
  const snap = buildOpsMonitoringSnapshot(input);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snap, null, 2) + "\n", "utf8");
  return snap;
}
