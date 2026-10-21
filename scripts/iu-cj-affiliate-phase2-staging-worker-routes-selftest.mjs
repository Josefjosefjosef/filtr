#!/usr/bin/env node
/** Offline tests for staging worker routes (no Cloudflare network). */
import {
  buildHealthPayload,
  stagingSyntheticEnabled,
} from "../cloudflare/cj-email-ingest-d1-worker/src/staging-synthetic-routes.mjs";
import { verifyBearerToken } from "../cloudflare/cj-email-ingest-d1-worker/src/ingest-rpc-service.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

expect("staging_enabled", stagingSyntheticEnabled({ ENVIRONMENT: "staging", IU_CJ_STAGING_ONLY: "1" }));
expect("staging_disabled_prod", stagingSyntheticEnabled({ ENVIRONMENT: "production", IU_CJ_STAGING_ONLY: "1" }) === false);
expect("staging_disabled_missing_flag", stagingSyntheticEnabled({ ENVIRONMENT: "staging" }) === false);

const health = buildHealthPayload({
  ENVIRONMENT: "staging",
  IU_CJ_STAGING_ONLY: "1",
  CJ_STAGING_ARCHIVE_ONLY: "1",
  DB: {},
  BANNER_ASSETS: {},
  IU_CJ_D1_WORKER_INGEST_TOKEN: "test-token",
});
expect("health_staging_only", health.stagingOnly === true);
expect("health_publishable_false", health.publishable === false);
expect("health_bindings", health.d1Binding === "present" && health.r2Binding === "present");
expect("health_no_secret_leak", !JSON.stringify(health).includes("test-token"));
expect("health_cj_archive_default", health.cjArchiveOnly === true);
expect("health_cj_live_api_off", health.cjLiveApiRequestsAllowed === false);

const reqMissing = new Request("http://localhost/v1/ingest/rpc", { method: "POST" });
const miss = verifyBearerToken(reqMissing, "secret");
expect("auth_missing_bearer", miss.ok === false && miss.status === 401);

const reqBad = new Request("http://localhost/v1/ingest/rpc", {
  method: "POST",
  headers: { Authorization: "Bearer wrong" },
});
const bad = verifyBearerToken(reqBad, "secret");
expect("auth_bad_token", bad.ok === false && bad.status === 403);

console.log(
  JSON.stringify({
    IU_CJ_STAGING_WORKER_ROUTES_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
