#!/usr/bin/env node
/**
 * Offline regression: link_search_coupon_v2 one-shot lock (mock fetch + mock D1, 0 live CJ HTTP).
 * Covers the 23 required scenarios from the v2 lock task.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireStagingCjProbeLock,
  executeStagingCjLinkSearchProbe,
  mapProbeConnectionState,
  resolveStagingCjProbeLockKey,
  STAGING_CJ_PROBE_LOCK_KEY,
  STAGING_CJ_PROBE_LOCK_KEY_V2,
  STAGING_CJ_PROBE_LOCK_KEYS_ALLOWED,
} from "../cloudflare/cj-email-ingest-d1-worker/src/staging-cj-api-probe-execute.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF = path.join(REPO, ".github/workflows/cj-affiliate-staging-cj-api-probe-once.yml");
const RUNBOOK = path.join(REPO, "docs/CJ-PHASE2-CLOUDFLARE-STAGING-RUNBOOK.md");

const failures = [];
const scenario = {};
function expect(name, cond) {
  if (!cond) failures.push(name);
}
function mark(id, cond) {
  scenario[`S${id}`] = cond ? "PASS" : "FAIL";
  expect(`scenario_${id}`, cond);
}

const GOOD_PAT = "cj0_test_" + "a".repeat(40);
const XML_OK = `<cj-api><links total-matched="1"><link><link-id>9</link-id><link-type>coupon</link-type></link></links></cj-api>`;
const XML_EMPTY = `<cj-api><links total-matched="0"></links></cj-api>`;

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
    ...extra,
  };
}

class MockD1 {
  constructor() {
    this.locks = new Map();
    this.insertFail = false;
    this.insertGate = null;
  }
  prepare(sql) {
    const self = this;
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes("SELECT lock_key")) {
              const key = args[0];
              return self.locks.has(key)
                ? { lock_key: key, finished_at: self.locks.get(key).finished_at }
                : null;
            }
            return null;
          },
          async run() {
            if (sql.includes("INSERT INTO staging_cj_api_probe_lock")) {
              if (self.insertFail) throw new Error("d1_insert_failed");
              if (self.insertGate) await self.insertGate();
              const key = args[0];
              if (self.locks.has(key)) throw new Error("constraint");
              self.locks.set(key, {
                started_at: args[1],
                connection_state: args[2],
                finished_at: null,
                http_status: null,
                record_count: null,
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

expect("allowlist_has_v1_v2", STAGING_CJ_PROBE_LOCK_KEYS_ALLOWED.includes(STAGING_CJ_PROBE_LOCK_KEY) && STAGING_CJ_PROBE_LOCK_KEYS_ALLOWED.includes(STAGING_CJ_PROBE_LOCK_KEY_V2));
expect("default_resolve_v1", resolveStagingCjProbeLockKey({}).lockKey === STAGING_CJ_PROBE_LOCK_KEY);

// --- S1: v1 consumed → no more HTTP ---
{
  const db = new MockD1();
  let fetches = 0;
  const fetchMock = async () => {
    fetches += 1;
    return { status: 200, ok: true, text: async () => XML_OK };
  };
  await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: db }, { fetch: fetchMock });
  const again = await executeStagingCjLinkSearchProbe({ ...makeGoEnv(), DB: db }, {
    fetch: async () => {
      fetches += 1;
      throw new Error("must_not_fetch");
    },
  });
  mark(1, again.blocked === true && again.httpRequestCount === 0 && fetches === 1 && db.locks.has(STAGING_CJ_PROBE_LOCK_KEY));
}

// --- S2: v2 configured only (no GO) → 0 HTTP, no lock ---
{
  const db = new MockD1();
  let fetches = 0;
  const res = await executeStagingCjLinkSearchProbe(
    {
      ...makeGoEnv({
        IU_CJ_CJ_API_HTTP_EXECUTE: "0",
        IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2,
      }),
      DB: db,
    },
    {
      fetch: async () => {
        fetches += 1;
        return { status: 200, ok: true, text: async () => XML_OK };
      },
    }
  );
  mark(2, res.blocked === true && fetches === 0 && !db.locks.has(STAGING_CJ_PROBE_LOCK_KEY_V2) && res.httpRequestCount === 0);
}

// --- S3: v2 + GO OFF → 0 HTTP ---
{
  const db = new MockD1();
  let fetches = 0;
  const res = await executeStagingCjLinkSearchProbe(
    {
      ...makeGoEnv({
        IU_CJ_STAGING_CJ_API_PROBE_APPROVED: "0",
        IU_CJ_CJ_API_HTTP_EXECUTE: "0",
        IU_CJ_STAGING_CJ_API_PROBE_EXECUTE: "0",
        IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2,
      }),
      DB: db,
    },
    {
      fetch: async () => {
        fetches += 1;
        return { status: 200, ok: true, text: async () => XML_OK };
      },
    }
  );
  mark(3, res.blocked === true && fetches === 0 && db.locks.size === 0);
}

// --- S4: v2 + invalid approval (partial GO) → 0 HTTP ---
{
  const db = new MockD1();
  let fetches = 0;
  const res = await executeStagingCjLinkSearchProbe(
    {
      ...makeGoEnv({
        IU_CJ_STAGING_CJ_API_PROBE_APPROVED: "1",
        IU_CJ_CJ_API_HTTP_EXECUTE: "1",
        IU_CJ_STAGING_CJ_API_PROBE_EXECUTE: "0",
        IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2,
      }),
      DB: db,
    },
    {
      fetch: async () => {
        fetches += 1;
        return { status: 200, ok: true, text: async () => XML_OK };
      },
    }
  );
  mark(4, res.blocked === true && res.reason === "probe_execute_not_armed" && fetches === 0 && !db.locks.has(STAGING_CJ_PROBE_LOCK_KEY_V2));
}

// --- S5: v2 + valid mock auth → max 1 simulated HTTP ---
{
  const db = new MockD1();
  let fetches = 0;
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    {
      fetch: async () => {
        fetches += 1;
        return { status: 200, ok: true, text: async () => XML_OK };
      },
    }
  );
  mark(5, res.ok === true && res.httpRequestCount === 1 && fetches === 1 && res.probeLockKey === STAGING_CJ_PROBE_LOCK_KEY_V2);
}

// --- S6: repeat v2 → 0 further HTTP ---
{
  const db = new MockD1();
  let fetches = 0;
  const fetchMock = async () => {
    fetches += 1;
    return { status: 200, ok: true, text: async () => XML_OK };
  };
  await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: fetchMock }
  );
  const second = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: fetchMock }
  );
  mark(6, second.blocked === true && second.httpRequestCount === 0 && fetches === 1);
}

// --- S7: concurrent v2 → single winner ---
{
  const db = new MockD1();
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  let insertors = 0;
  db.insertGate = async () => {
    insertors += 1;
    if (insertors === 1) await gate;
  };
  let fetches = 0;
  const fetchMock = async () => {
    fetches += 1;
    return { status: 200, ok: true, text: async () => XML_OK };
  };
  const env = { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db };
  const p1 = executeStagingCjLinkSearchProbe(env, { fetch: fetchMock });
  // Let first reach insert gate
  await new Promise((r) => setTimeout(r, 5));
  db.insertGate = null;
  const p2 = executeStagingCjLinkSearchProbe(env, { fetch: fetchMock });
  release();
  const [a, b] = await Promise.all([p1, p2]);
  const winners = [a, b].filter((x) => x.httpRequestCount === 1).length;
  const blocked = [a, b].filter((x) => x.blocked === true && x.httpRequestCount === 0).length;
  mark(7, winners === 1 && blocked === 1 && fetches === 1);
}

// --- S8: unknown lock key ---
{
  const db = new MockD1();
  let fetches = 0;
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: "link_search_coupon_v99" }), DB: db },
    {
      fetch: async () => {
        fetches += 1;
        return { status: 200, ok: true, text: async () => XML_OK };
      },
    }
  );
  mark(8, res.blocked === true && res.reason === "probe_lock_key_not_allowed" && fetches === 0 && db.locks.size === 0);
}

// --- S9: empty lock key ---
{
  const empty = resolveStagingCjProbeLockKey({ IU_CJ_STAGING_PROBE_LOCK_KEY: "" });
  const db = new MockD1();
  let fetches = 0;
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: "" }), DB: db },
    {
      fetch: async () => {
        fetches += 1;
        return { status: 200, ok: true, text: async () => XML_OK };
      },
    }
  );
  mark(9, empty.ok === false && empty.reason === "probe_lock_key_empty" && res.blocked === true && fetches === 0);
}

// --- S10: lock key change after start → in-flight keeps bound key; new resolve rejects ---
{
  const db = new MockD1();
  const env = { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db };
  const bound = resolveStagingCjProbeLockKey(env);
  env.IU_CJ_STAGING_PROBE_LOCK_KEY = "evil_key";
  const mid = resolveStagingCjProbeLockKey(env);
  let fetches = 0;
  const res = await executeStagingCjLinkSearchProbe(env, {
    lockKeyBound: bound.lockKey,
    fetch: async () => {
      fetches += 1;
      return { status: 200, ok: true, text: async () => XML_OK };
    },
  });
  mark(
    10,
    bound.ok === true &&
      mid.ok === false &&
      res.ok === true &&
      res.probeLockKey === STAGING_CJ_PROBE_LOCK_KEY_V2 &&
      db.locks.has(STAGING_CJ_PROBE_LOCK_KEY_V2) &&
      !db.locks.has("evil_key") &&
      fetches === 1
  );
}

// --- S11: D1 INSERT error → 0 HTTP ---
{
  const db = new MockD1();
  db.insertFail = true;
  let fetches = 0;
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    {
      fetch: async () => {
        fetches += 1;
        return { status: 200, ok: true, text: async () => XML_OK };
      },
    }
  );
  mark(11, res.blocked === true && res.reason === "probe_lock_conflict" && fetches === 0 && db.locks.size === 0);
}

// --- S12: HTTP 400 ---
{
  const db = new MockD1();
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: async () => ({ status: 400, ok: false, text: async () => "<error>bad</error>" }) }
  );
  mark(12, res.ok === false && res.connectionState === "HTTP_CLIENT_ERROR" && res.failureReason === "http_error" && db.locks.get(STAGING_CJ_PROBE_LOCK_KEY_V2)?.finished_at);
}

// --- S13: HTTP 401/403 auth FAIL ---
{
  const db401 = new MockD1();
  const r401 = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db401 },
    { fetch: async () => ({ status: 401, ok: false, text: async () => "not authenticated" }) }
  );
  const db403 = new MockD1();
  const r403 = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db403 },
    { fetch: async () => ({ status: 403, ok: false, text: async () => "not authorized" }) }
  );
  mark(
    13,
    r401.connectionState === "AUTHENTICATION_FAILED" &&
      r403.connectionState === "AUTHORIZATION_FAILED" &&
      r401.ok === false &&
      r403.ok === false
  );
}

// --- S14: HTTP 429 rate-limit ---
{
  const db = new MockD1();
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: async () => ({ status: 429, ok: false, text: async () => "slow down" }) }
  );
  expect(
    "map_429",
    mapProbeConnectionState({
      httpStatus: 429,
      auth: { authenticated: false, reason: "rate_limit" },
      recordCount: 0,
      networkError: false,
    }) === "RATE_LIMIT_FAILED"
  );
  mark(14, res.connectionState === "RATE_LIMIT_FAILED" && res.failureReason === "rate_limit" && res.ok === false);
}

// --- S15: HTTP 500 server FAIL ---
{
  const db = new MockD1();
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: async () => ({ status: 500, ok: false, text: async () => "boom" }) }
  );
  mark(15, res.connectionState === "HTTP_SERVER_ERROR" && res.failureReason === "http_server_error" && res.ok === false);
}

// --- S16: timeout ---
{
  const db = new MockD1();
  const res = await executeStagingCjLinkSearchProbe(
    {
      ...makeGoEnv({
        IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2,
        IU_CJ_FETCH_TIMEOUT_MS: "5",
      }),
      DB: db,
    },
    {
      fetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          );
        }),
    }
  );
  mark(16, res.connectionState === "NETWORK_FAILED" && res.failureReason === "timeout");
}

// --- S17: invalid XML/JSON shape ---
{
  const db = new MockD1();
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: async () => ({ status: 200, ok: true, text: async () => '{"not":"xml"}' }) }
  );
  mark(17, res.ok === false && res.connectionState === "RESPONSE_FORMAT_FAILED");
}

// --- S18: valid empty ---
{
  const db = new MockD1();
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: async () => ({ status: 200, ok: true, text: async () => XML_EMPTY }) }
  );
  mark(18, res.connectionState === "EMPTY_RESULT_VERIFIED" && res.ok === true);
}

// --- S19: valid non-empty PASS ---
{
  const db = new MockD1();
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: async () => ({ status: 200, ok: true, text: async () => XML_OK }) }
  );
  mark(19, res.ok === true && res.connectionState === "API_CONNECTED" && res.couponRecordCount === 1);
}

// --- S20: disarm failure → critical BLOCKED (contract) ---
{
  const wf = fs.readFileSync(WF, "utf8");
  const runbook = fs.readFileSync(RUNBOOK, "utf8");
  const hasDisarmAlways = /disarm-failsafe:[\s\S]*if:\s*always\(\)/.test(wf);
  const hasManualRecovery = /MANUAL_DISARM|ruční obnovení GO OFF|manual GO OFF recovery/i.test(runbook);
  const disarmFailIsBlocked = /CJ_DISARM_FAILSAFE=BLOCKED|DISARM_FAILSAFE_BLOCKED|kritický/.test(runbook);
  mark(20, hasDisarmAlways && hasManualRecovery && disarmFailIsBlocked);
}

// --- S21: no PAT leak ---
{
  const db = new MockD1();
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: async () => ({ status: 200, ok: true, text: async () => XML_OK }) }
  );
  const blob = JSON.stringify(res);
  mark(21, !blob.includes(GOOD_PAT) && !blob.includes("cj0_test_"));
}

// --- S22: no production catalog changes (workflow + response contract) ---
{
  const wf = fs.readFileSync(WF, "utf8");
  const db = new MockD1();
  const res = await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: async () => ({ status: 200, ok: true, text: async () => XML_OK }) }
  );
  mark(22, wf.includes("PRODUCTION_UNCHANGED=PASS") && res.publishable === false);
}

// --- S23: v1 lock untouched when consuming v2 ---
{
  const db = new MockD1();
  db.locks.set(STAGING_CJ_PROBE_LOCK_KEY, {
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: "2026-01-01T00:00:01.000Z",
    http_status: 400,
    record_count: 0,
    connection_state: "HTTP_CLIENT_ERROR",
  });
  const v1Before = JSON.stringify(db.locks.get(STAGING_CJ_PROBE_LOCK_KEY));
  await executeStagingCjLinkSearchProbe(
    { ...makeGoEnv({ IU_CJ_STAGING_PROBE_LOCK_KEY: STAGING_CJ_PROBE_LOCK_KEY_V2 }), DB: db },
    { fetch: async () => ({ status: 200, ok: true, text: async () => XML_OK }) }
  );
  const v1After = JSON.stringify(db.locks.get(STAGING_CJ_PROBE_LOCK_KEY));
  mark(23, v1Before === v1After && db.locks.has(STAGING_CJ_PROBE_LOCK_KEY_V2));
}

// Workflow allowlist input present
{
  const wf = fs.readFileSync(WF, "utf8");
  expect("workflow_probe_lock_key_input", /probe_lock_key:/.test(wf));
  expect("workflow_default_v1", /probe_lock_key:[\s\S]*default:\s*"link_search_coupon_v1"/.test(wf));
  expect("workflow_no_auto_v2", /execute_live_cj_probe[\s\S]*default:\s*"0"/.test(wf));
  expect("workflow_arm_sets_lock_via_patch", wf.includes('--mode arm --lock-key "${PROBE_LOCK_KEY}"'));
  expect("workflow_disarm_resets_v1", /go-flags-patch-v1\.mjs --mode disarm/.test(wf));
}

const failedScenarios = Object.entries(scenario)
  .filter(([, v]) => v !== "PASS")
  .map(([k]) => k);

console.log(
  JSON.stringify({
    IU_CJ_STAGING_CJ_API_PROBE_LOCK_V2_SELFTEST: failures.length ? "FAIL" : "OK",
    scenarios: scenario,
    failedScenarios,
    failures,
    CJ_LIVE_HTTP_CALLS: 0,
  })
);
process.exit(failures.length ? 1 : 0);
