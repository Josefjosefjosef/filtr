#!/usr/bin/env node
/**
 * Structural + offline arm/disarm contract for staging CJ API probe workflow.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeStagingCjLinkSearchProbe } from "../cloudflare/cj-email-ingest-d1-worker/src/staging-cj-api-probe-execute.mjs";
import { resolveStagingCjArchiveGate } from "../cloudflare/cj-email-ingest-d1-worker/src/staging-cj-api-archive-gate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF = path.join(REPO, ".github/workflows/cj-affiliate-staging-cj-api-probe-once.yml");
const PATCH_SH = path.join(REPO, "scripts/ci/patch-staging-cj-d1-wrangler-v1.sh");
const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const wf = fs.readFileSync(WF, "utf8");
expect("workflow_exists", wf.length > 100);
expect("input_live_default_off", /execute_live_cj_probe[\s\S]*default:\s*["']0["']/.test(wf));
expect("disarm_separate_job", /disarm-failsafe:/.test(wf));
expect("disarm_needs_probe_job", /needs:\s*staging-cj-probe/.test(wf));
expect("disarm_if_always", /disarm-failsafe:[\s\S]*if:\s*always\(\)/.test(wf));
expect("patch_script_in_arm", /patch-staging-cj-d1-wrangler-v1\.sh/.test(wf));
expect("patch_script_in_disarm", (wf.match(/patch-staging-cj-d1-wrangler-v1\.sh/g) || []).length >= 2);
expect("no_wrangler_d1_create", !/d1 create/i.test(wf));
expect("no_cj_pat_secret_put", !/secret put (IU_CJ|CJ_API)/i.test(wf));
expect("ingest_github_secret_name", /IU_CJ_STAGING_D1_WORKER_INGEST_TOKEN/.test(wf));
expect("cf_identity_audit_script", wf.includes("iu-cj-affiliate-staging-worker-identity-cf-audit-v1.mjs"));
expect("no_inline_plain_text_filter", !wf.includes("filter(x=>x.type==='plain_text')"));
expect("concurrency_group", /cj-affiliate-staging-cj-api-probe-once/.test(wf));
expect("live_probe_gated", /execute_live_cj_probe == '1'/.test(wf));

expect("patch_sh_exists", fs.existsSync(PATCH_SH));
expect("patch_sh_uses_resolver", fs.readFileSync(PATCH_SH, "utf8").includes("iu-cj-affiliate-staging-d1-resolve-v1.mjs"));

// Offline: GO off blocks HTTP (mock).
const goOff = {
  ENVIRONMENT: "staging",
  IU_CJ_STAGING_ONLY: "1",
  CJ_STAGING_ARCHIVE_ONLY: "1",
  CJ_API_PAT: "cj0_" + "a".repeat(40),
  IU_CJ_PUBLISHER_CID: "7667828",
  IU_CJ_WEBSITE_PID: "101883843",
};
expect("go_off_blocks", resolveStagingCjArchiveGate(goOff).mayExecuteHttp === false);

const goOn = {
  ...goOff,
  IU_CJ_STAGING_CJ_API_PROBE_APPROVED: "1",
  IU_CJ_CJ_API_HTTP_EXECUTE: "1",
  IU_CJ_STAGING_CJ_API_PROBE_EXECUTE: "1",
  IU_CJ_CJ_API_MAX_REQUESTS_PER_PROBE: "1",
};
expect("go_on_allows", resolveStagingCjArchiveGate(goOn).mayExecuteHttp === true);

class MockD1Double {
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
              const row = self.locks.get(key);
              return row ? { lock_key: key, finished_at: row.finished_at } : null;
            }
            return null;
          },
          async run() {
            if (sql.includes("INSERT INTO staging_cj_api_probe_lock")) {
              const key = args[0];
              if (self.locks.has(key)) throw new Error("unique");
              self.locks.set(key, { started_at: args[1], finished_at: null });
              return { success: true };
            }
            if (sql.includes("UPDATE staging_cj_api_probe_lock")) {
              const key = args[4];
              const row = self.locks.get(key);
              if (row) row.finished_at = args[0];
              return { success: true };
            }
            return { success: true };
          },
        };
      },
    };
  }
}

async function runOfflineProbeMocks() {
  const db = new MockD1Double();
  const env = { ...goOn, DB: db };
  let fetchCalls = 0;
  const fetchMock = async () => {
    fetchCalls += 1;
    return {
      status: 200,
      text: async () => "<links><link><advertiser-id>1</advertiser-id></link></links>",
    };
  };
  const first = await executeStagingCjLinkSearchProbe(env, { fetch: fetchMock });
  expect("first_probe_http_1", first.httpRequestCount === 1);
  const second = await executeStagingCjLinkSearchProbe(env, { fetch: fetchMock });
  expect("second_probe_blocked", second.blocked === true && second.httpRequestCount === 0);
  expect("fetch_once_total", fetchCalls === 1);
}

await runOfflineProbeMocks();

console.log(
  JSON.stringify({
    IU_CJ_STAGING_CJ_API_PROBE_WORKFLOW_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    failures,
    CJ_ONE_SHOT_LOCK: failures.length ? "FAIL" : "PASS",
    CJ_DISARM_FAILSAFE: wf.includes("disarm-failsafe") ? "PASS" : "FAIL",
  })
);
process.exit(failures.length ? 1 : 0);
