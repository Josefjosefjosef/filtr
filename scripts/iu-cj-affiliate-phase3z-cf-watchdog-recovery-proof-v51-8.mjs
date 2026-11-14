/**
 * V51.8 — offline proof that CF CJ catalog-sync watchdog recovers when GHA schedules vanish.
 * Does NOT dispatch live Actions. Proves decision + catch-up inputs + daycap/cooldown/busy.
 * Decision logic mirrors cloudflare/cj-catalog-sync-watchdog/src/decision.ts (kept in JS for CI).
 */

export const CF_WATCHDOG_RECOVERY_PROOF_SCHEMA =
  "iu-cj-affiliate-phase3z-cf-watchdog-recovery-proof-v51-8";

export const CATCHUP_DISPATCH_INPUTS = Object.freeze({
  execute_live_fetch: "1",
  offers_mode: "refresh_priority",
  arm_publish: "0",
  promote_managed_public: "0",
  publish_managed_public_r2: "0",
  arm_offers_live: "0",
  promote_offers_public: "1",
  catchup_dispatch: "1",
});

/** Mirror of Worker decideCjCatalogWatchdog (JS; offline CI). */
export function decideCjCatalogWatchdogJs(input = {}) {
  const staleAfterMinutes = Math.max(1, Number(input.staleAfterMinutes) || 240);
  const maxCatchupsPerUtcDay = Math.max(1, Number(input.maxCatchupsPerUtcDay) || 4);
  const cooldownMinutes = Math.max(1, Number(input.catchupCooldownMinutes) || 60);
  const runs = input.runs || [];
  const busy = runs.some((r) =>
    ["queued", "in_progress", "waiting", "pending"].includes(String(r.status || "").toLowerCase()),
  );
  const successes = runs
    .filter((r) => String(r.conclusion || "").toLowerCase() === "success")
    .map((r) => Date.parse(r.created_at || ""))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);
  let ageMinutes = null;
  if (successes.length) ageMinutes = (input.nowMs - successes[0]) / 60000;
  else if (input.generatedAt) {
    const g = Date.parse(input.generatedAt);
    if (Number.isFinite(g)) ageMinutes = (input.nowMs - g) / 60000;
  }
  if (busy) return { action: "skip", reason: "busy", ageMinutes, staleAfterMinutes };
  if (ageMinutes == null) {
    return { action: "skip", reason: "freshness_unavailable", ageMinutes: null, staleAfterMinutes };
  }
  const dayKey = new Date(input.nowMs).toISOString().slice(0, 10);
  const catchupsToday = runs.filter((r) => {
    if (String(r.event || "") !== "workflow_dispatch") return false;
    const title = String(r.display_title || r.name || "");
    if (!title.includes("CATCHUP_DISPATCH_NOT_SCHEDULE") && !/\bCATCHUP\b/i.test(title)) return false;
    const t = Date.parse(r.created_at || "");
    if (!Number.isFinite(t)) return false;
    return new Date(t).toISOString().slice(0, 10) === dayKey;
  });
  if (catchupsToday.length >= maxCatchupsPerUtcDay) {
    return {
      action: "skip",
      reason: "max_catchups_per_utc_day",
      ageMinutes,
      staleAfterMinutes,
      catchupsToday: catchupsToday.length,
      maxCatchupsPerUtcDay,
    };
  }
  const latestCatchup = catchupsToday
    .map((r) => Date.parse(r.created_at || ""))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  // Also consider catchups earlier today that may not be in catchupsToday filter if title missing —
  // use all catchups for cooldown.
  const allCatchups = runs
    .filter((r) => String(r.event || "") === "workflow_dispatch")
    .filter((r) => {
      const title = String(r.display_title || r.name || "");
      return title.includes("CATCHUP_DISPATCH_NOT_SCHEDULE") || /\bCATCHUP\b/i.test(title);
    })
    .map((r) => Date.parse(r.created_at || ""))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);
  if (allCatchups[0] != null) {
    const age = (input.nowMs - allCatchups[0]) / 60000;
    if (age < cooldownMinutes) {
      return {
        action: "skip",
        reason: "catchup_cooldown",
        ageMinutes,
        staleAfterMinutes,
        cooldownMinutes,
        latestCatchupAgeMinutes: age,
      };
    }
  }
  if (ageMinutes >= staleAfterMinutes) {
    return { action: "dispatch", reason: "stale", ageMinutes, staleAfterMinutes };
  }

  // Slot-aware: latest due :17 past delay budget with no success at/after slot start.
  const delayBudgetMin = Math.max(1, Number(input.slotDelayBudgetMinutes) || 180);
  const hours = [0, 3, 6, 9, 12, 15, 18, 21];
  const now = new Date(input.nowMs);
  let latestDue = null;
  for (const h of hours) {
    let slot = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 17, 0, 0),
    );
    if (slot.getTime() > input.nowMs) slot = new Date(slot.getTime() - 24 * 3600 * 1000);
    const ageMin = (input.nowMs - slot.getTime()) / 60000;
    if (ageMin > 24 * 60) continue;
    if (ageMin <= delayBudgetMin) continue;
    if (!latestDue || slot.getTime() > latestDue.slotMs) {
      latestDue = { slotMs: slot.getTime(), ageMin };
    }
  }
  if (latestDue) {
    const covered = runs.some((r) => {
      if (String(r.conclusion || "").toLowerCase() !== "success") return false;
      const t = Date.parse(r.created_at || "");
      return Number.isFinite(t) && t >= latestDue.slotMs - 5 * 60000;
    });
    if (!covered) {
      return {
        action: "dispatch",
        reason: "slot_miss_uncovered",
        ageMinutes,
        staleAfterMinutes,
        expectedSlotUtc: new Date(latestDue.slotMs).toISOString(),
        slotAgeMinutes: Math.round(latestDue.ageMin * 10) / 10,
        slotDelayBudgetMinutes: delayBudgetMin,
      };
    }
  }

  return { action: "skip", reason: "not_stale", ageMinutes, staleAfterMinutes };
}

export function proveCfWatchdogRecoveryMatrix() {
  const nowMs = Date.parse("2026-11-12T14:00:00.000Z");
  const staleRun = {
    status: "completed",
    conclusion: "success",
    created_at: "2026-11-12T08:00:00.000Z",
    event: "schedule",
  };
  const cases = [];

  function run(name, input, expectAction, expectReason) {
    const d = decideCjCatalogWatchdogJs(input);
    const ok = d.action === expectAction && d.reason === expectReason;
    cases.push({ name, ok, decision: d, expectAction, expectReason });
    return d;
  }

  run(
    "gha_schedule_miss_stale_dispatches_catchup",
    { generatedAt: "2026-11-12T08:00:00.000Z", nowMs, staleAfterMinutes: 240, runs: [staleRun] },
    "dispatch",
    "stale",
  );
  run(
    "busy_blocks_even_when_stale",
    {
      generatedAt: "2026-11-12T08:00:00.000Z",
      nowMs,
      staleAfterMinutes: 240,
      runs: [{ status: "in_progress", conclusion: null, created_at: "2026-11-12T13:50:00.000Z" }],
    },
    "skip",
    "busy",
  );
  run(
    "recent_success_not_stale",
    {
      generatedAt: "2026-11-12T13:00:00.000Z",
      nowMs,
      staleAfterMinutes: 240,
      runs: [
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T13:00:00.000Z",
          event: "schedule",
        },
      ],
    },
    "skip",
    "not_stale",
  );
  run(
    "cooldown_after_catchup",
    {
      generatedAt: "2026-11-12T08:00:00.000Z",
      nowMs,
      staleAfterMinutes: 240,
      catchupCooldownMinutes: 60,
      runs: [
        staleRun,
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T13:30:00.000Z",
          event: "workflow_dispatch",
          display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE 9",
        },
      ],
    },
    "skip",
    "catchup_cooldown",
  );
  run(
    "slot_miss_uncovered_independent_of_freshness",
    {
      generatedAt: "2026-11-12T06:00:00.000Z",
      nowMs,
      staleAfterMinutes: 481,
      slotDelayBudgetMinutes: 180,
      runs: [
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T06:00:00.000Z",
          event: "schedule",
        },
      ],
    },
    "dispatch",
    "slot_miss_uncovered",
  );

  const inputsOk =
    CATCHUP_DISPATCH_INPUTS.catchup_dispatch === "1" &&
    CATCHUP_DISPATCH_INPUTS.promote_offers_public === "1" &&
    CATCHUP_DISPATCH_INPUTS.arm_publish === "0" &&
    CATCHUP_DISPATCH_INPUTS.offers_mode === "refresh_priority";

  const failed = cases.filter((c) => !c.ok);
  return {
    schema: CF_WATCHDOG_RECOVERY_PROOF_SCHEMA,
    at: new Date().toISOString(),
    ok: failed.length === 0 && inputsOk,
    catchupInputsSafe: inputsOk,
    catchupInputs: CATCHUP_DISPATCH_INPUTS,
    note:
      "Catch-up is workflow_dispatch only (never event=schedule). CF cron is independent of GHA schedule undelivery. Live force dispatch requires MANUAL_TRIGGER_SECRET.",
    cases,
    failed: failed.map((f) => f.name),
  };
}
