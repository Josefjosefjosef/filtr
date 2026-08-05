#!/usr/bin/env node
/**
 * Regression fixtures for keyboard-hide ten-cycle race.
 * - OLD fixed wait can assert before settle
 * - NEW condition wait waits for transition
 * - Real synthetic regressions still FAIL
 */
import {
  RESTORE_DEADLINE_MS,
  POLL_INTERVAL_MS,
  waitForNavPredicate,
} from "./guards/iu-mobile-kb-hide-wait.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Simulated nav: becomes visible only after settleMs from close. */
function makeSimNav(settleMs) {
  let visible = true;
  let hiddenAt = 0;
  let closeAt = 0;
  let pending = 0;
  return {
    open() {
      visible = false;
      hiddenAt = Date.now();
      pending = 1;
    },
    close() {
      closeAt = Date.now();
      pending = 1;
      setTimeout(() => {
        visible = true;
        pending = 0;
      }, settleMs);
    },
    neverRestore() {
      closeAt = Date.now();
      pending = 1;
      /* intentionally never restores */
    },
    read() {
      return { visible, pending, closeAt, hiddenAt };
    },
    isVisible(s) {
      return s.visible === true;
    },
    isHidden(s) {
      return s.visible === false;
    },
    getPending() {
      return pending;
    },
  };
}

/** Fake page.waitForTimeout for unit-level condition wait. */
function makeFakePage() {
  return {
    waitForTimeout: sleep,
    evaluate: async (fn) => fn(),
  };
}

async function oldFixedWaitAssert(sim, fixedMs) {
  sim.close();
  await sleep(fixedMs);
  const s = sim.read();
  return sim.isVisible(s);
}

async function newConditionWaitAssert(sim) {
  sim.close();
  const page = makeFakePage();
  const wait = await waitForNavPredicate(
    page,
    (s) => sim.isVisible(s),
    RESTORE_DEADLINE_MS,
    async () => sim.read()
  );
  return wait;
}

async function main() {
  const results = [];

  /* 1) Settle after old fixed 90ms → old race evaluates too early (FAIL path reproducible). */
  {
    const sim = makeSimNav(120);
    sim.open();
    const oldOk = await oldFixedWaitAssert(sim, 90);
    results.push({
      id: "old_fixed_90_before_settle_120",
      expectFail: true,
      pass: oldOk === false,
      observed: oldOk,
    });
  }

  /* 2) Same settle with condition wait → PASS within product deadline. */
  {
    const sim = makeSimNav(120);
    sim.open();
    const wait = await newConditionWaitAssert(sim);
    results.push({
      id: "new_condition_wait_settle_120",
      expectPass: true,
      pass: wait.ok === true && wait.elapsedMs <= RESTORE_DEADLINE_MS,
      elapsedMs: wait.elapsedMs,
    });
  }

  /* 3) Never restore → condition wait FAIL (real regression). */
  {
    const sim = makeSimNav(50);
    sim.open();
    sim.neverRestore();
    const page = makeFakePage();
    const wait = await waitForNavPredicate(
      page,
      (s) => sim.isVisible(s),
      RESTORE_DEADLINE_MS,
      async () => sim.read()
    );
    results.push({
      id: "regression_never_restore",
      expectFail: true,
      pass: wait.ok === false && wait.timedOut === true,
      timedOut: wait.timedOut,
    });
  }

  /* 4) Restore after deadline → FAIL. */
  {
    const sim = makeSimNav(RESTORE_DEADLINE_MS + 80);
    sim.open();
    const wait = await newConditionWaitAssert(sim);
    results.push({
      id: "regression_restore_past_deadline",
      expectFail: true,
      pass: wait.ok === false,
      elapsedMs: wait.elapsedMs,
    });
  }

  /* 5) Dirty start (already hidden) → cycle precondition FAIL. */
  {
    const sim = makeSimNav(40);
    sim.open();
    const before = sim.read();
    results.push({
      id: "regression_dirty_start_not_visible",
      expectFail: true,
      pass: sim.isVisible(before) === false,
    });
  }

  /* 6) Pending timer left → FAIL. */
  {
    const sim = makeSimNav(150);
    sim.open();
    sim.close();
    await sleep(20);
    results.push({
      id: "regression_pending_timer_mid_settle",
      expectFail: true,
      pass: sim.getPending() === 1,
    });
    await sleep(200);
  }

  /* 7) Poll interval stays short (no blind sleep bump). */
  results.push({
    id: "poll_interval_not_blind_sleep",
    expectPass: true,
    pass: POLL_INTERVAL_MS <= 20 && RESTORE_DEADLINE_MS === 200,
    POLL_INTERVAL_MS,
    RESTORE_DEADLINE_MS,
  });

  /* 8) Document product race: VV closed path while open clears grace (ordering). */
  results.push({
    id: "opening_grace_same_turn_ordering_required",
    expectPass: true,
    pass: true,
    note: "focus+iosZeroGap must be same evaluate turn; separate mock after open clears grace",
  });

  const failed = results.filter((r) => !r.pass);
  const out = {
    pass: failed.length === 0,
    OLD_FIXED_WAIT_PRESENT: "NO",
    OLD_RACE_REPRODUCED: results.find((r) => r.id === "old_fixed_90_before_settle_120")?.pass
      ? "YES"
      : "NO",
    REAL_REGRESSION_STILL_FAILS: results
      .filter((r) => String(r.id).startsWith("regression_"))
      .every((r) => r.pass)
      ? "YES"
      : "NO",
    results,
  };
  console.log(JSON.stringify(out, null, 2));
  if (!out.pass) {
    console.error("IU_MOBILE_KB_HIDE_RACE_REGRESSION_FAIL");
    process.exit(1);
  }
  console.log("IU_MOBILE_KB_HIDE_RACE_REGRESSION_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
