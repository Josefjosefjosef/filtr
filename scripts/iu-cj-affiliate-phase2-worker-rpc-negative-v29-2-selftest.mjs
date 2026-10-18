#!/usr/bin/env node
/** Production Worker must reject isolated test RPC ops (v29.2). */
import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createD1SqlIngestApi } from "../cloudflare/cj-email-ingest-d1-worker/src/ingest-d1-sql-api.mjs";
import { executeIngestRpc } from "../cloudflare/cj-email-ingest-d1-worker/src/ingest-rpc-service.mjs";
import { D1_WORKER_RPC_OPS } from "../cloudflare/cj-email-ingest-d1-worker/src/ingest-rpc-ops.mjs";
import { createNodeSqliteD1Shim } from "./iu-cj-affiliate-phase2-cj-email-d1-sqlite-shim.mjs";
import { migrateCentralOfferRegistryD1 } from "./iu-cj-affiliate-phase2-central-offer-d1-v29.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(repoRoot, "cloudflare", "cj-email-ingest-d1-worker");
const token = "test-ingest-token-32chars-minimum-length-v17";
const TEST_OPS = ["registryTestSetClaimGen", "registryTestDbSnapshot", "registryResetForTest"];

const attempts = [];

function record(name, pass, detail) {
  attempts.push({ name, pass, detail });
}

const indexSrc = fs.readFileSync(path.join(workerDir, "src", "index.js"), "utf8");
const opsSrc = fs.readFileSync(path.join(workerDir, "src", "ingest-rpc-ops.mjs"), "utf8");
record(
  "static_production_ops_exclude_test_rpc",
  TEST_OPS.every((op) => !opsSrc.includes(`"${op}"`)),
  { testOpsInProductionList: TEST_OPS.filter((op) => opsSrc.includes(`"${op}"`)) }
);
record(
  "static_production_index_no_local_test_import",
  !indexSrc.includes("index.local-test") && !indexSrc.includes("ingest-d1-sql-api-local-test"),
  {}
);
record(
  "static_production_index_hardcodes_no_test_hooks",
  indexSrc.includes("allowRegistryTestHooks: false"),
  {}
);

const shim = await createNodeSqliteD1Shim(path.join(repoRoot, "tmp-rpc-neg-" + Date.now() + ".sqlite"));
await migrateCentralOfferRegistryD1(shim.db);
const prodApi = await createD1SqlIngestApi(shim.db, { allowRegistryTestHooks: true });
for (const op of TEST_OPS) {
  const out = await executeIngestRpc(prodApi, op, {}, D1_WORKER_RPC_OPS);
  record("direct_api_" + op, out.reason === "unknown_rpc_op" && typeof prodApi[op] !== "function", { out });
}

let bundleHasTestRpc = false;
try {
  const out = execSync("npx wrangler deploy --dry-run", { cwd: workerDir, encoding: "utf8", stdio: "pipe" });
  bundleHasTestRpc = TEST_OPS.some((op) => out.includes(op));
  record("production_wrangler_dry_run_bundle_no_test_rpc_names", !bundleHasTestRpc, { found: bundleHasTestRpc });
} catch (e) {
  const msg = String(e.stdout || e.stderr || e.message || e);
  bundleHasTestRpc = TEST_OPS.some((op) => msg.includes(op));
  record("production_wrangler_dry_run_bundle_no_test_rpc_names", !bundleHasTestRpc, {
    detail: msg.slice(0, 120),
    found: bundleHasTestRpc,
  });
}

let child = null;
let port = 0;
let ready = false;
if (process.env.IU_CJ_EXTRACT_SELFTEST === "1") {
  record("extract_skip_wrangler_d1_and_dev", true, { reason: "offline_extract_bundle_rpc_static_only" });
} else {
  fs.writeFileSync(
    path.join(workerDir, ".dev.vars"),
    "IU_CJ_D1_WORKER_INGEST_TOKEN=" + token + "\nREGISTRY_V21_ALLOW_TEST_HOOKS=1\n",
    "utf8"
  );
  execSync("npx wrangler d1 migrations apply DB --local --config wrangler.toml", { cwd: workerDir, stdio: "pipe" });

  port = 27800 + Math.floor(Math.random() * 2000);
  child = spawn(
    "npx",
    ["wrangler", "dev", "--local", "--config", "wrangler.toml", "--port", String(port), "--ip", "127.0.0.1"],
    { cwd: workerDir, stdio: "pipe", shell: true }
  );

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const h = await fetch("http://127.0.0.1:" + port + "/health");
      const j = await h.json();
      if (j?.d1Binding === "present" && j?.workerEntry !== "local-test") {
        ready = true;
        break;
      }
    } catch {
      /* retry */
    }
  }
}

if (process.env.IU_CJ_EXTRACT_SELFTEST !== "1" && ready) {
  async function rpc(op, auth) {
    const headers = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = "Bearer " + token;
    const res = await fetch("http://127.0.0.1:" + port + "/v1/ingest/rpc", {
      method: "POST",
      headers,
      body: JSON.stringify({ op, args: { source: "API", sourceRecordId: "x", confirmedGen: 9 } }),
    });
    return { status: res.status, body: await res.json() };
  }
  for (const op of TEST_OPS) {
    const noAuth = await rpc(op, false);
    record("http_prod_" + op + "_no_auth", noAuth.status === 401, { noAuth });
    const badAuth = await rpc(op, true);
    record(
      "http_prod_" + op + "_with_auth_hooks_env",
      badAuth.body?.reason === "unknown_rpc_op" || badAuth.body?.result?.reason === "unknown_rpc_op",
      { badAuth }
    );
  }
  const countsBefore = await rpc("registrySqlCounts", true);
  await rpc("registryResetForTest", true);
  const countsAfter = await rpc("registrySqlCounts", true);
  record(
    "http_prod_reset_does_not_run",
    JSON.stringify(countsBefore.body) === JSON.stringify(countsAfter.body),
    { countsBefore: countsBefore.body, countsAfter: countsAfter.body }
  );
} else if (process.env.IU_CJ_EXTRACT_SELFTEST !== "1") {
  record("http_production_worker_ready", false, { reason: "wrangler_dev_not_ready" });
}

if (child) {
  child.kill("SIGTERM");
}
try {
  shim.db.close?.();
} catch {
  /* ignore */
}

const ok = attempts.every((a) => a.pass);
const outDir = path.join(process.env.TEMP || "C:\\Temp", "iu-cj-affiliate", "v29-2");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "RPC-NEGATIVE-TESTS-V29-2.json");
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), outPath, attempts }, null, 2));

console.log(JSON.stringify({ IU_CJ_WORKER_RPC_NEGATIVE_V29_2_SELFTEST: ok ? "OK" : "FAIL", attempts }));
process.exit(ok ? 0 : 1);
