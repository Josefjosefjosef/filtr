#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyProductFeedHttpStatus,
  evaluateZeroProductResult,
  runUnattendedImportCycle,
} from "./iu-cj-affiliate-phase2-unattended-import-cycle-lib-v1.mjs";

const baseDir = path.join(os.tmpdir(), "iu-cj-unattended-selftest-" + process.pid);
fs.mkdirSync(baseDir, { recursive: true });

const failures = [];

function fail(id, detail) {
  failures.push({ id, detail });
}

function offlineEnv(extra = {}) {
  return {
    IU_CJ_EMAIL_INGEST_OFFLINE: "1",
    IU_CJ_GITHUB_INGEST_DRY_RUN: "1",
    IU_CJ_D1_BACKEND: "mock",
    IU_CJ_D1_MOCK_PATH: path.join(baseDir, "d1-" + Date.now() + ".json"),
    PRODUCTION_SIGNING_ENABLED: "false",
    IU_CJ_UNATTENDED_STATE_DIR: path.join(baseDir, "state-" + Date.now()),
    ...extra,
  };
}

const auth401 = classifyProductFeedHttpStatus(401);
if (auth401.ok !== false || auth401.reason !== "cj_api_unauthorized") fail("http_401", auth401);

const auth403 = classifyProductFeedHttpStatus(403);
if (auth403.ok !== false || auth403.reason !== "cj_api_forbidden") fail("http_403", auth403);

const zero = evaluateZeroProductResult(0);
if (!zero.ok || zero.emptyFeed !== true) fail("zero_products", zero);

const negTotal = evaluateZeroProductResult(-1);
if (negTotal.ok !== false) fail("invalid_product_total", negTotal);

const stateA = path.join(baseDir, "run-a");
const envA = offlineEnv({ IU_CJ_UNATTENDED_STATE_DIR: stateA });
const okRun = await runUnattendedImportCycle({
  env: { ...envA, IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST: "1" },
  stateDir: stateA,
  mockProductFeedResponse: { status: 200, total: 3 },
});
if (!okRun.ok || okRun.publishable !== false) fail("offline_cycle_ok", okRun);

const state401 = path.join(baseDir, "run-401");
const run401 = await runUnattendedImportCycle({
  env: offlineEnv({ IU_CJ_UNATTENDED_STATE_DIR: state401, IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST: "1" }),
  stateDir: state401,
  mockProductFeedResponse: { status: 401, total: 0 },
});
if (run401.ok !== false || run401.reason !== "cj_api_unauthorized") fail("cycle_401", run401);

const state403 = path.join(baseDir, "run-403");
const run403 = await runUnattendedImportCycle({
  env: offlineEnv({ IU_CJ_UNATTENDED_STATE_DIR: state403, IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST: "1" }),
  stateDir: state403,
  mockProductFeedResponse: { status: 403, total: 0 },
});
if (run403.ok !== false || run403.reason !== "cj_api_forbidden") fail("cycle_403", run403);

const stateZero = path.join(baseDir, "run-zero");
const runZero = await runUnattendedImportCycle({
  env: offlineEnv({ IU_CJ_UNATTENDED_STATE_DIR: stateZero, IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST: "1" }),
  stateDir: stateZero,
  mockProductFeedResponse: { status: 200, total: 0 },
});
if (!runZero.ok || runZero.publishable !== false) fail("cycle_zero_products", runZero);

const stateLock = path.join(baseDir, "run-lock");
const lockPath = path.join(stateLock, "unattended-import.lock");
fs.mkdirSync(stateLock, { recursive: true });
fs.writeFileSync(
  lockPath,
  JSON.stringify({ ownerId: "other-holder", acquiredAt: Date.now() }),
  "utf8"
);
const runLock = await runUnattendedImportCycle({
  env: offlineEnv({ IU_CJ_UNATTENDED_STATE_DIR: stateLock }),
  stateDir: stateLock,
  mockProductFeedResponse: { status: 200, total: 1 },
});
if (runLock.ok !== false || runLock.reason !== "sync_lock_held") fail("concurrent_lock", runLock);

const stateLive = path.join(baseDir, "run-live-block");
const runLive = await runUnattendedImportCycle({
  env: offlineEnv({
    IU_CJ_UNATTENDED_STATE_DIR: stateLive,
    IU_CJ_LIVE_UNATTENDED_IMPORT: "1",
    IU_CJ_EMAIL_INGEST_OFFLINE: "0",
    IU_CJ_GITHUB_INGEST_DRY_RUN: "0",
    IU_CJ_UNATTENDED_SKIP_EMAIL_INGEST: "1",
  }),
  stateDir: stateLive,
  mockProductFeedResponse: { status: 200, total: 1 },
});
if (runLive.ok !== false || runLive.reason !== "live_unattended_not_allowed") fail("live_gate_block", runLive);

console.log(
  JSON.stringify({
    IU_CJ_UNATTENDED_IMPORT_CYCLE_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    fail: failures.length,
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
