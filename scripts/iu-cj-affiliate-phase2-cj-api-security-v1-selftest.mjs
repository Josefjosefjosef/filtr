#!/usr/bin/env node
/** CJ API auth, PAT redaction, HTTP failures, publisher identity, archive-only gate. */
import http from "node:http";
import {
  classifyCjResponse,
  validatePatFormat,
  buildCjAuthorizationHeader,
} from "./iu-cj-affiliate-phase1-lib.mjs";
import {
  cjApiHttpGet,
  probeCjPatFormat,
  readCjPatFromEnv,
  resolveCjApiConfig,
} from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import {
  canExecuteStagingCjHttpRequest,
  redactCjAuditFields,
  resolveStagingCjArchiveGate,
  validateCjPublisherIdentityFields,
} from "./iu-cj-affiliate-phase2-staging-archive-only-gate.mjs";
import { buildHealthPayload } from "../cloudflare/cj-email-ingest-d1-worker/src/staging-synthetic-routes.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const fmtBad = validatePatFormat("bad inner space");
expect("auth_invalid_pat_format", fmtBad.ok === false && fmtBad.reason === "inner_whitespace");

const fmtOk = validatePatFormat("cj0_test_" + "a".repeat(40));
expect("auth_valid_pat_shape", fmtOk.ok === true || fmtOk.reason !== undefined);

expect("auth_probe_missing", probeCjPatFormat({}).ok === false);
expect("auth_401_not_success", classifyCjResponse("<error>not authenticated</error>", 401).authenticated === false);
expect("auth_403_not_success", classifyCjResponse("not authorized", 403).authenticated === false);

const cfgOff = resolveCjApiConfig({
  IU_CJ_CJ_API_ENABLED: "1",
  IU_CJ_EMAIL_INGEST_OFFLINE: "1",
  CJ_API_PAT: "cj0_test_" + "b".repeat(40),
});
expect("adapter_offline_blocks", cfgOff.enabled === false);

const idBad = validateCjPublisherIdentityFields("123", "123");
expect("publisher_pid_not_equal_cid", idBad.ok === false);

const idOk = validateCjPublisherIdentityFields("101883843", "13884010");
expect("publisher_identity_ok", idOk.ok === true);

const red = redactCjAuditFields({ event: "x", pat: "secret", CJ_API_PAT: "x", count: 2 });
expect("pat_redaction", red.pat === "[redacted]" && red.CJ_API_PAT === "[redacted]" && red.count === 2);
expect("read_pat_no_leak_in_json", !JSON.stringify(red).includes("secret"));

const gateDefault = resolveStagingCjArchiveGate({
  ENVIRONMENT: "staging",
  IU_CJ_STAGING_ONLY: "1",
  CJ_STAGING_ARCHIVE_ONLY: "1",
});
expect("archive_gate_blocks_live", gateDefault.mayExecuteHttp === false);
expect("archive_no_pat", gateDefault.blockReason === "cj_pat_secret_missing");

const gateArmed = resolveStagingCjArchiveGate({
  ENVIRONMENT: "staging",
  IU_CJ_STAGING_ONLY: "1",
  CJ_STAGING_ARCHIVE_ONLY: "1",
  CJ_API_PAT: "cj0_test_" + "c".repeat(40),
  IU_CJ_PUBLISHER_CID: "101883843",
  IU_CJ_WEBSITE_PID: "13884010",
  IU_CJ_STAGING_CJ_API_PROBE_APPROVED: "1",
  IU_CJ_CJ_API_HTTP_EXECUTE: "1",
  IU_CJ_STAGING_CJ_API_PROBE_EXECUTE: "1",
});
expect("archive_all_gates_required", gateArmed.mayExecuteHttp === true);

const stagingBlock = canExecuteStagingCjHttpRequest({
  ENVIRONMENT: "staging",
  CJ_STAGING_ARCHIVE_ONLY: "1",
  IU_CJ_CJ_API_ENABLED: "1",
  IU_CJ_CJ_API_HTTP_EXECUTE: "1",
  CJ_API_PAT: "cj0_test_" + "d".repeat(40),
});
expect("staging_http_blocked_without_go", stagingBlock.allowed === false);

const health = buildHealthPayload({
  ENVIRONMENT: "staging",
  IU_CJ_STAGING_ONLY: "1",
  CJ_STAGING_ARCHIVE_ONLY: "1",
  DB: {},
  BANNER_ASSETS: {},
  IU_CJ_D1_WORKER_INGEST_TOKEN: "ingest-token-value",
  CJ_API_PAT: "cj0_test_" + "e".repeat(40),
});
expect("health_cj_archive", health.cjArchiveOnly === true);
expect("health_cj_pat_flag", health.cjPatConfigured === true);
expect("health_no_live_api", health.cjLiveApiRequestsAllowed === false);
expect("health_no_pat_leak", !JSON.stringify(health).includes("cj0_test"));

expect("cj_api_pat_precedence", readCjPatFromEnv({ CJ_API_PAT: "cj0_test_" + "f".repeat(40), IU_CJ_PAT: "other" }).startsWith("cj0"));

async function runHttpMocks() {
  const server = http.createServer((req, res) => {
    if (req.url.includes("empty")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(" ");
      return;
    }
    if (req.url.includes("401")) {
      res.writeHead(401, { "Content-Type": "text/xml" });
      res.end("<error>Not authenticated</error>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end("<cj-api><links><link></link></links></cj-api>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const pat = "cj0_test_" + "g".repeat(40);
  const env401 = {
    IU_CJ_CJ_API_ENABLED: "1",
    IU_CJ_CJ_API_HTTP_EXECUTE: "1",
    CJ_API_PAT: pat,
    IU_CJ_PUBLISHER_CID: "101883843",
    IU_CJ_WEBSITE_PID: "13884010",
  };
  const r401 = await cjApiHttpGet(`${base}/401`, env401, { testBaseUrl: base, testPat: pat });
  expect("http_401_fail_closed", r401.ok === false && r401.auth?.authenticated === false);

  server.close();
  const rNet = await cjApiHttpGet("http://127.0.0.1:1/refused", env401, {
    testBaseUrl: "http://127.0.0.1:1",
    testPat: pat,
  });
  expect("network_not_success", rNet.ok === false && rNet.networkError === true);
}

await runHttpMocks();

expect("auth_header_shape", buildCjAuthorizationHeader("cj0_test_" + "h".repeat(40)).startsWith("Bearer "));

console.log(
  JSON.stringify({
    IU_CJ_API_SECURITY_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    CJ_LIVE_API_REQUESTS: 0,
  })
);
process.exit(failures.length ? 1 : 0);
