#!/usr/bin/env node
/** Offline tests for staging CJ API probe (mock fetch + mock D1, no live CJ). */
import { buildCjLinkSearchProbePage1QueryString } from "./iu-cj-affiliate-cj-link-search-query-v1.mjs";
import {
  acquireStagingCjProbeLock,
  buildSafeProbeResponse,
  classifyCjXmlAuth,
  countCouponLinkBlocks,
  executeStagingCjLinkSearchProbe,
  mapProbeConnectionState,
  readCjPatFromWorkerEnv,
  STAGING_CJ_PROBE_LOCK_KEY,
  validatePatFormat,
} from "../cloudflare/cj-email-ingest-d1-worker/src/staging-cj-api-probe-execute.mjs";
import { handleStagingSyntheticRequest } from "../cloudflare/cj-email-ingest-d1-worker/src/staging-synthetic-routes.mjs";
import { resolveStagingCjArchiveGate } from "./iu-cj-affiliate-phase2-staging-archive-only-gate.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const GOOD_PAT = "cj0_test_" + "a".repeat(40);

function makeGoEnv(extra = {}) {
  return {
    ENVIRONMENT: "staging",
    IU_CJ_STAGING_ONLY: "1",
    CJ_STAGING_ARCHIVE_ONLY: "1",
    CJ_API_PAT: GOOD_PAT,
    IU_CJ_PUBLISHER_CID: "7667828",
    IU_CJ_WEBSITE_PID: "101883843",
    IU_CJ_STAGING_CJ_API_PROBE_APPROVED: "1",
    IU_CJ_CJ_API_HTTP_EXECUTE: "1",
    IU_CJ_STAGING_CJ_API_PROBE_EXECUTE: "1",
    IU_CJ_CJ_API_MAX_REQUESTS_PER_PROBE: "1",
    IU_CJ_D1_WORKER_INGEST_TOKEN: "ingest-token-test-32chars-minimum-len",
    ...extra,
  };
}

class MockD1 {
  constructor() {
    this.locks = new Map();
  }
  prepare(sql) {
    const self = this;
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes("SELECT lock_key")) {
              const key = args[0];
              return self.locks.has(key) ? { lock_key: key, finished_at: self.locks.get(key).finished_at } : null;
            }
            return null;
          },
          async run() {
            if (sql.includes("INSERT INTO staging_cj_api_probe_lock")) {
              const key = args[0];
              if (self.locks.has(key)) throw new Error("constraint");
              self.locks.set(key, {
                started_at: args[1],
                connection_state: args[2],
                finished_at: null,
              });
              return { success: true };
            }
            if (sql.includes("UPDATE staging_cj_api_probe_lock")) {
              const key = args[4];
              const row = self.locks.get(key);
              if (row) {
                row.finished_at = args[0];
                row.http_status = args[1];
                row.record_count = args[2];
                row.connection_state = args[3];
              }
              return { success: true };
            }
            return { success: true };
          },
        };
      },
    };
  }
}

expect("pat_missing", readCjPatFromWorkerEnv({}) === "");
expect("pat_read", readCjPatFromWorkerEnv({ CJ_API_PAT: GOOD_PAT }) === GOOD_PAT);
expect("pat_format_ok", validatePatFormat(GOOD_PAT).ok === true);
expect("pat_format_bad", validatePatFormat("bad space").ok === false);

expect("auth_401", classifyCjXmlAuth("<error>not authenticated</error>", 401).authenticated === false);
expect("auth_403", classifyCjXmlAuth("not authorized", 403).authenticated === false);
expect("auth_xml_ok", classifyCjXmlAuth("<links><link><link-id>1</link-id></link></links>", 200).authenticated === true);
expect(
  "count_links",
  countCouponLinkBlocks("<links><link><link-id>1</link-id></link><link><link-id>2</link-id></link></links>") === 2
);

expect(
  "map_401",
  mapProbeConnectionState({ httpStatus: 401, auth: { authenticated: false }, recordCount: 0, networkError: false }) ===
    "AUTHENTICATION_FAILED"
);
expect(
  "map_network",
  mapProbeConnectionState({ httpStatus: 0, auth: {}, recordCount: 0, networkError: true }) === "NETWORK_FAILED"
);
expect(
  "map_400_client_error",
  mapProbeConnectionState({
    httpStatus: 400,
    auth: { authenticated: false, reason: "http_error" },
    recordCount: 0,
    networkError: false,
  }) === "HTTP_CLIENT_ERROR"
);
expect(
  "map_unknown_shape_parse_fail",
  mapProbeConnectionState({
    httpStatus: 200,
    auth: { authenticated: false, reason: "unknown_shape" },
    recordCount: 0,
    networkError: false,
  }) === "RESPONSE_FORMAT_FAILED"
);

const probeQuery = buildCjLinkSearchProbePage1QueryString("101883843");
expect("query_promotion_type", probeQuery.includes("promotion-type=coupon"));
expect("query_no_bad_link_type", !probeQuery.includes("link-type=coupon"));

const gateOff = resolveStagingCjArchiveGate(makeGoEnv({ IU_CJ_CJ_API_HTTP_EXECUTE: "0" }));
expect("go_flags_off", gateOff.mayExecuteHttp === false);

const gateNoPat = resolveStagingCjArchiveGate(makeGoEnv({ CJ_API_PAT: "" }));
expect("missing_pat_gate", gateNoPat.mayExecuteHttp === false && gateNoPat.blockReason === "cj_pat_secret_missing");

const gateBadId = resolveStagingCjArchiveGate(makeGoEnv({ IU_CJ_PUBLISHER_CID: "123", IU_CJ_WEBSITE_PID: "123" }));
expect("bad_identity_gate", gateBadId.mayExecuteHttp === false);

const mockDb = new MockD1();
const xmlOk = `<cj-api><links total-matched="1"><link><link-id>9</link-id><link-type>coupon</link-type></link></links></cj-api>`;

let capturedUrl = "";
const resOk2 = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: mockDb }, {
  fetch: async (url) => {
    capturedUrl = String(url);
    return { status: 200, ok: true, text: async () => xmlOk };
  },
});
expect("fetch_url_promotion_type", capturedUrl.includes("promotion-type=coupon"));
expect("fetch_url_no_link_type_coupon", !capturedUrl.includes("link-type=coupon"));
expect("live_http_mock_connected", resOk2.ok === true && resOk2.connectionState === "API_CONNECTED");
expect("live_http_one_request", resOk2.httpRequestCount === 1);
expect("coupon_count", resOk2.couponRecordCount === 1);
expect("no_pat_leak", !JSON.stringify(resOk2).includes(GOOD_PAT));

const db401 = new MockD1();
const res401 = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: db401 }, {
  fetch: async () => ({ status: 401, ok: false, text: async () => "<error>not authenticated</error>" }),
});
expect("http_401_fail", res401.ok === false && res401.connectionState === "AUTHENTICATION_FAILED");
expect("http_401_not_zero_success", !(res401.ok === true && res401.couponRecordCount === 0));

const db403 = new MockD1();
const res403 = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: db403 }, {
  fetch: async () => ({ status: 403, ok: false, text: async () => "not authorized" }),
});
expect("http_403_fail", res403.connectionState === "AUTHORIZATION_FAILED");

const db400 = new MockD1();
const res400 = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: db400 }, {
  fetch: async () => ({ status: 400, ok: false, text: async () => "<error>bad request</error>" }),
});
expect("http_400_client_error", res400.ok === false && res400.connectionState === "HTTP_CLIENT_ERROR");
expect("http_400_failure_reason", res400.failureReason === "http_error");

expect(
  "auth_unknown_shape_reason",
  classifyCjXmlAuth("not-xml-garbage-body-without-cj-tags", 200).reason === "unknown_shape"
);

const dbBadXml = new MockD1();
const resBadXml = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: dbBadXml }, {
  fetch: async () => ({
    status: 200,
    ok: true,
    text: async () => "incorrect resource url in cj error payload",
  }),
});
expect("bad_cj_shape_not_client_error", resBadXml.connectionState === "RESPONSE_FORMAT_FAILED");

const dbNet = new MockD1();
const resNet = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: dbNet }, {
  fetch: async () => {
    throw new Error("network down");
  },
});
expect("network_fail", resNet.connectionState === "NETWORK_FAILED");

const dbTimeout = new MockD1();
const resTimeout = await executeStagingCjLinkSearchProbe(
  { ...makeGoEnv(), DB: dbTimeout, IU_CJ_FETCH_TIMEOUT_MS: "5" },
  {
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
  }
);
expect("timeout_fail", resTimeout.connectionState === "NETWORK_FAILED");

const dbEmpty = new MockD1();
const resEmpty = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: dbEmpty }, {
  fetch: async () => ({
    status: 200,
    ok: true,
    text: async () =>
      "<cj-api><links total-matched=\"0\"></links></cj-api>",
  }),
});
expect("empty_verified", resEmpty.connectionState === "EMPTY_RESULT_VERIFIED");

const dbSusp = new MockD1();
const resSusp = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: dbSusp }, {
  fetch: async () => ({ status: 200, ok: true, text: async () => "<links/>" }),
});
expect("empty_suspicious", resSusp.connectionState === "EMPTY_RESULT_SUSPICIOUS");

const dbRedirect = new MockD1();
const resRedir = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: dbRedirect }, {
  fetch: async () => ({ status: 302, ok: false, text: async () => "" }),
});
expect("redirect_blocked", resRedir.connectionState === "RESPONSE_FORMAT_FAILED");

const dbBlocked = new MockD1();
const blocked = await executeStagingCjLinkSearchProbe(
  { ...makeGoEnv({ IU_CJ_CJ_API_HTTP_EXECUTE: "0" }), DB: dbBlocked },
  { fetch: async () => ({ status: 200, ok: true, text: async () => xmlOk }) }
);
expect("go_off_no_fetch", blocked.blocked === true && blocked.httpRequestCount === 0);

const dbTwice = new MockD1();
await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: dbTwice }, {
  fetch: async () => ({ status: 200, ok: true, text: async () => xmlOk }),
});
const second = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: dbTwice }, {
  fetch: async () => {
    throw new Error("must not fetch");
  },
});
expect("single_execution_guard", second.blocked === true && second.reason === "probe_already_executed");

const lock1 = await acquireStagingCjProbeLock(dbTwice, STAGING_CJ_PROBE_LOCK_KEY);
expect("lock_conflict", lock1.ok === false);

const safe = buildSafeProbeResponse({
  connectionState: "API_CONNECTED",
  httpStatus: 200,
  recordCount: 2,
  responseParsing: "PASS",
  authOk: true,
  httpRequestCount: 1,
  identityOk: true,
});
expect("publishable_false", safe.publishable === false);

const reqNoAuth = new Request("http://localhost/v1/staging/cj-api/probe", { method: "POST" });
const noAuth = await handleStagingSyntheticRequest(reqNoAuth, makeGoEnv({ DB: mockDb }));
expect("route_auth_required", noAuth.status === 401);

const reqProbe = new Request("http://localhost/v1/staging/cj-api/probe", {
  method: "POST",
  headers: { Authorization: "Bearer ingest-token-test-32chars-minimum-len" },
});
const gated = await handleStagingSyntheticRequest(
  reqProbe,
  makeGoEnv({ DB: new MockD1(), IU_CJ_CJ_API_HTTP_EXECUTE: "0" })
);
const gatedJson = await gated.json();
expect("route_gate_blocks", gated.status === 403 && gatedJson.blocked === true);

console.log(
  JSON.stringify({
    IU_CJ_STAGING_CJ_API_PROBE_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    CJ_LIVE_HTTP_CALLS: 0,
  })
);
process.exit(failures.length ? 1 : 0);
