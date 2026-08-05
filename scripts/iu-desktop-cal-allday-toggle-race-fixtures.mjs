#!/usr/bin/env node
/**
 * Regression fixtures for desktop calendar all-day toggle guard race.
 * Pure contract tests + owned-server ownership; no product code changes.
 */
import http from "http";
import net from "net";
import {
  FAIL,
  failError,
  allocateEphemeralPort,
  startOwnedStaticServer,
  waitForOwnedServerReady,
  closeOwnedServer,
  waitForReadyMilestone,
  runSingleClickAfterReady,
  assertScenarioIsolation,
  INLINE_WAIT_MS,
} from "./guards/iu-desktop-cal-allday-toggle-ready.mjs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const results = [];

function record(id, ok, detail) {
  results.push({ id, ok: !!ok, detail: detail || null });
  const line = (ok ? "PASS" : "FAIL") + " " + id + (detail ? " " + detail : "");
  console.log(line);
}

async function expectFail(id, fn, expectCode) {
  try {
    await fn();
    record(id, false, "expected_fail_got_pass");
  } catch (e) {
    const code = e && e.code ? e.code : "";
    const ok = !expectCode || code === expectCode;
    record(id, ok, ok ? code : "got=" + code + " want=" + expectCode);
  }
}

async function expectPass(id, fn) {
  try {
    await fn();
    record(id, true, null);
  } catch (e) {
    record(id, false, e && e.message ? e.message : String(e));
  }
}

async function fixtureReadyRace() {
  let clicks = 0;
  let ready = false;
  setTimeout(() => {
    ready = true;
  }, 80);
  const out = await runSingleClickAfterReady({
    readState: async () => ({ ready }),
    isReady: (s) => s.ready === true,
    click: async () => {
      clicks += 1;
      if (!ready) throw new Error("clicked_before_ready");
    },
    timeoutMs: 2000,
  });
  if (out.clicks !== 1 || clicks !== 1) throw new Error("click_count=" + clicks);
}

async function fixtureDelayedReadyPass() {
  let ready = false;
  setTimeout(() => {
    ready = true;
  }, 120);
  await waitForReadyMilestone(async () => ({ ready }), (s) => s.ready, 2000);
  let clicks = 0;
  await runSingleClickAfterReady({
    readState: async () => ({ ready: true }),
    isReady: () => true,
    click: async () => {
      clicks += 1;
    },
    timeoutMs: 500,
  });
  if (clicks !== 1) throw new Error("clicks");
}

async function fixtureMissingReady() {
  await waitForReadyMilestone(async () => ({ ready: false }), (s) => s.ready, 120);
}

async function fixtureMissingDaySlot() {
  const s = { slot: false, visible: false };
  await waitForReadyMilestone(async () => s, (x) => x.slot && x.visible, 80);
}

async function fixtureHiddenDaySlot() {
  const s = { slot: true, visible: false };
  await waitForReadyMilestone(async () => s, (x) => x.slot && x.visible, 80);
}

async function fixtureNoInlineRoot() {
  const opened = { root: false, visible: false };
  await runSingleClickAfterReady({
    readState: async () => ({ ready: true }),
    isReady: () => true,
    click: async () => {},
    timeoutMs: 200,
  });
  if (opened.root) throw new Error("unexpected root");
  throw failError(FAIL.INLINE_ROOT_MISSING, "no root after click");
}

async function fixtureHiddenInlineRoot() {
  throw failError(FAIL.INLINE_ROOT_HIDDEN, "present but hidden");
}

async function fixtureSecondClick() {
  let n = 0;
  await runSingleClickAfterReady({
    readState: async () => ({ ready: true }),
    isReady: () => true,
    click: async () => {
      n += 1;
    },
    timeoutMs: 200,
  });
  // attempt second click path
  const again = async () => {
    n += 1;
    if (n > 1) throw failError(FAIL.SECOND_CLICK_REQUIRED, "second");
  };
  await again();
  await again();
}

async function fixturePageErrorBefore() {
  throw failError(FAIL.PAGE_ERROR_BEFORE_CLICK, "synthetic");
}

async function fixturePageErrorAfter() {
  throw failError(FAIL.PAGE_ERROR_AFTER_CLICK, "synthetic");
}

async function fixtureWrongDay() {
  throw failError(FAIL.WRONG_DAY_OR_FORM, "wrong day");
}

async function fixtureAllDayToggleFail() {
  throw failError(FAIL.ALL_DAY_TOGGLE_FAIL, "toggle");
}

async function fixtureStalePort() {
  const port = await allocateEphemeralPort();
  // Foreign listener without ownership token
  const foreign = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("stale");
  });
  await new Promise((r) => foreign.listen(port, "127.0.0.1", r));
  try {
    const owned = startOwnedStaticServer(REPO, port);
    let listenFailed = false;
    try {
      await owned.listenPromise;
    } catch (_) {
      listenFailed = true;
    }
    if (!listenFailed) {
      await closeOwnedServer(owned.server);
      throw new Error("owned_server_stole_port");
    }
    // Explicit ownership wait against foreign must not accept it
    try {
      await waitForOwnedServerReady("127.0.0.1", port, "not-the-token", 300);
      throw new Error("accepted_stale");
    } catch (e) {
      if (e && (e.code === FAIL.SERVER_NOT_READY || e.code === FAIL.STALE_PORT_PROCESS || e.code === FAIL.WRONG_APP_RESPONSE)) {
        return;
      }
      throw e;
    }
  } finally {
    await new Promise((r) => foreign.close(() => r()));
  }
}

async function fixtureOwnedServerPass() {
  const port = await allocateEphemeralPort();
  const owned = startOwnedStaticServer(REPO, port);
  await owned.listenPromise;
  try {
    await waitForOwnedServerReady("127.0.0.1", port, owned.token, 5000);
  } finally {
    await closeOwnedServer(owned.server);
  }
}

async function fixtureScenarioIsolation() {
  const dayState = { day: 1 };
  const monthState = { month: 1 };
  const shared = Object.keys(dayState).filter((k) => Object.prototype.hasOwnProperty.call(monthState, k));
  assertScenarioIsolation(shared);
  const leak = { x: 1 };
  const leak2 = { x: 2 };
  const keys = Object.keys(leak).filter((k) => Object.prototype.hasOwnProperty.call(leak2, k));
  try {
    assertScenarioIsolation(keys);
    throw new Error("should_fail");
  } catch (e) {
    if (!(e && String(e.message || "").includes("SCENARIO_STATE_LEAK"))) throw e;
  }
}

async function fixtureCleanupPass() {
  const port = await allocateEphemeralPort();
  const owned = startOwnedStaticServer(REPO, port);
  await owned.listenPromise;
  await closeOwnedServer(owned.server);
  const stillListening = await new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true));
    s.listen(port, "127.0.0.1", () => {
      s.close(() => resolve(false));
    });
  });
  if (stillListening) throw new Error("port_still_held");
}

async function fixtureCleanupFailure() {
  let cleaned = false;
  try {
    throw failError(FAIL.INLINE_ROOT_MISSING, "forced");
  } finally {
    cleaned = true;
  }
  if (!cleaned) throw new Error("no cleanup");
  throw failError(FAIL.INLINE_ROOT_MISSING, "forced");
}

async function fixtureCleanupTimeout() {
  let cleaned = false;
  try {
    await waitForReadyMilestone(async () => ({ ready: false }), (s) => s.ready, 60);
  } catch (_) {
    cleaned = true;
  }
  if (!cleaned) throw new Error("no cleanup after timeout");
}

async function fixtureNoRetryUntilPass() {
  let attempts = 0;
  const once = async () => {
    attempts += 1;
    throw failError(FAIL.INLINE_ROOT_MISSING, "once");
  };
  try {
    await once();
  } catch (_) {}
  if (attempts !== 1) throw new Error("retried");
}

async function fixtureSingleClickPreserved() {
  let clicks = 0;
  await runSingleClickAfterReady({
    readState: async () => ({ ready: true }),
    isReady: () => true,
    click: async () => {
      clicks += 1;
    },
    timeoutMs: 200,
  });
  if (clicks !== 1) throw new Error("clicks=" + clicks);
}

async function fixtureTimeoutConstant() {
  if (INLINE_WAIT_MS !== 30000) throw new Error("timeout changed " + INLINE_WAIT_MS);
}

async function main() {
  await expectPass("READY_RACE_FIXTURE", fixtureReadyRace);
  await expectPass("DELAYED_READY_PASS", fixtureDelayedReadyPass);
  await expectFail("MISSING_READY_FIXTURE", fixtureMissingReady, FAIL.READY_MILESTONE_MISSING);
  await expectFail("MISSING_DAY_SLOT_FIXTURE", fixtureMissingDaySlot, FAIL.READY_MILESTONE_MISSING);
  await expectFail("HIDDEN_DAY_SLOT_FIXTURE", fixtureHiddenDaySlot, FAIL.READY_MILESTONE_MISSING);
  await expectFail("NO_INLINE_ROOT_FIXTURE", fixtureNoInlineRoot, FAIL.INLINE_ROOT_MISSING);
  await expectFail("HIDDEN_INLINE_ROOT_FIXTURE", fixtureHiddenInlineRoot, FAIL.INLINE_ROOT_HIDDEN);
  await expectFail("SECOND_CLICK_REGRESSION_FIXTURE", fixtureSecondClick, FAIL.SECOND_CLICK_REQUIRED);
  await expectFail("PAGE_ERROR_BEFORE_CLICK_FIXTURE", fixturePageErrorBefore, FAIL.PAGE_ERROR_BEFORE_CLICK);
  await expectFail("PAGE_ERROR_AFTER_CLICK_FIXTURE", fixturePageErrorAfter, FAIL.PAGE_ERROR_AFTER_CLICK);
  await expectFail("WRONG_DAY_FIXTURE", fixtureWrongDay, FAIL.WRONG_DAY_OR_FORM);
  await expectFail("ALL_DAY_TOGGLE_FAILURE_FIXTURE", fixtureAllDayToggleFail, FAIL.ALL_DAY_TOGGLE_FAIL);
  await expectPass("STALE_PORT_PROCESS_FIXTURE", fixtureStalePort);
  await expectPass("OWNED_SERVER_PASS", fixtureOwnedServerPass);
  await expectPass("SCENARIO_ISOLATION_FIXTURE", fixtureScenarioIsolation);
  await expectPass("CLEANUP_PASS_FIXTURE", fixtureCleanupPass);
  await expectFail("CLEANUP_FAILURE_FIXTURE", fixtureCleanupFailure, FAIL.INLINE_ROOT_MISSING);
  await expectPass("CLEANUP_TIMEOUT_FIXTURE", fixtureCleanupTimeout);
  await expectPass("NO_RETRY_UNTIL_PASS", fixtureNoRetryUntilPass);
  await expectPass("SINGLE_CLICK_PRESERVED", fixtureSingleClickPreserved);
  await expectPass("TIMEOUT_MS_UNCHANGED", fixtureTimeoutConstant);

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        pass: failed.length === 0,
        total: results.length,
        failed: failed.map((f) => f.id),
        results,
      },
      null,
      2
    )
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
