#!/usr/bin/env node
/**
 * Isolated D1 fail-closed proof for growth approval nonce Worker.
 * Does NOT touch production D1 / bindings / catalog.
 * Uses in-process Worker handler with stub DB that throws / is missing.
 */
import worker from "../cloudflare/cj-growth-approval-nonce/src/index.js";

const TOKEN = "isolated-fail-closed-test-token-32chars";

function failingDb() {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          throw new Error("D1_SIMULATED_UNAVAILABLE");
        },
        async first() {
          throw new Error("D1_SIMULATED_UNAVAILABLE");
        },
      };
    },
  };
}

async function call(env, path, body) {
  const req = new Request("https://isolated-test.example" + path, {
    method: "POST",
    headers: {
      authorization: "Bearer " + TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

export async function runIsolatedD1FailClosed() {
  const cases = [];
  const body = {
    reservationKey: "a".repeat(64),
    nonceHash: "b".repeat(64),
    repository: "Josefjosefjosef/filtr",
    mainSha: "c".repeat(40),
    generationId: "isolated-fail-closed",
    scope: "EXECUTE_GROWTH_ACTIVATION",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    runId: "isolated",
    operationId: "op-isolated-fail-closed",
    nowIso: new Date().toISOString(),
  };

  // Missing DB binding
  {
    const r = await call({ IU_CJ_GROWTH_NONCE_STORE_TOKEN: TOKEN, DB: null }, "/v1/reserve", body);
    cases.push({
      id: "missing_db_binding",
      pass: r.status === 503 && r.json.reason === "NONCE_STORE_UNAVAILABLE",
      status: r.status,
      reason: r.json.reason || null,
    });
  }

  // DB throws on insert
  {
    const r = await call(
      { IU_CJ_GROWTH_NONCE_STORE_TOKEN: TOKEN, DB: failingDb() },
      "/v1/reserve",
      body,
    );
    cases.push({
      id: "db_insert_throws",
      pass: r.status === 503 && r.json.reason === "NONCE_STORE_UNAVAILABLE",
      status: r.status,
      reason: r.json.reason || null,
      detail: r.json.detail || null,
    });
  }

  // No auth → never reaches DB (still fail-closed for unauthorized)
  {
    const req = new Request("https://isolated-test.example/v1/reserve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await worker.fetch(req, {
      IU_CJ_GROWTH_NONCE_STORE_TOKEN: TOKEN,
      DB: failingDb(),
    });
    const json = await res.json().catch(() => ({}));
    cases.push({
      id: "unauth_before_db",
      pass: res.status === 401 && json.reason === "UNAUTHORIZED",
      status: res.status,
      reason: json.reason || null,
    });
  }

  // Prove no RUNNER_TEMP / memory fallback path exists in Worker source
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "cloudflare/cj-growth-approval-nonce/src/index.js"),
      "utf8",
    );
    const bad =
      /RUNNER_TEMP|Map\(\)|globalThis\.__nonce|memoryStore|localStorage|fs\.writeFile/.test(src);
    cases.push({
      id: "no_local_fallback_in_worker",
      pass: bad === false && /NONCE_STORE_UNAVAILABLE/.test(src),
      status: null,
      reason: bad ? "LOCAL_FALLBACK_DETECTED" : "NO_LOCAL_FALLBACK",
    });
  }

  // Durable store resolver refuses RUNNER_TEMP when requireDurable=1 and URL missing
  {
    const { resolveGrowthApprovalNonceStore } = await import(
      "./iu-cj-affiliate-phase3z-growth-approval-nonce-store-v51-8.mjs"
    );
    let reason = null;
    let kind = null;
    try {
      const store = resolveGrowthApprovalNonceStore({
        env: {
          IU_CJ_GROWTH_NONCE_REQUIRE_DURABLE: "1",
          IU_CJ_GROWTH_NONCE_STORE_URL: "",
          IU_CJ_GROWTH_NONCE_STORE_TOKEN: "",
        },
        requireDurable: true,
        allowInsecureLocal: false,
      });
      kind = store?.kind || null;
      const reserved = await store.reserve({
        reservationKey: "d".repeat(64),
        nonceHash: "e".repeat(64),
        repository: "Josefjosefjosef/filtr",
        mainSha: "c".repeat(40),
        generationId: "g",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        nowIso: new Date().toISOString(),
      });
      reason = reserved?.reason || (reserved?.ok ? "UNEXPECTED_OK" : "UNKNOWN");
    } catch (e) {
      reason = String(e?.message || e);
    }
    cases.push({
      id: "execute_refuses_without_durable_store",
      pass:
        kind !== "runner_temp" &&
        /NONCE_STORE|DURABLE|UNAVAILABLE|MISSING|REQUIRED/i.test(String(reason || "")),
      status: null,
      reason,
      kind,
    });
  }

  const pass = cases.every((c) => c.pass === true);
  return {
    schema: "iu-cj-affiliate-phase3z-d1-fail-closed-isolated-v51-8",
    at: new Date().toISOString(),
    productionD1Touched: false,
    productionWorkerTouched: false,
    runnerTempFallback: false,
    ok: pass,
    cases,
  };
}

const isDirect = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith(
  "iu-cj-affiliate-phase3z-d1-fail-closed-isolated-v51-8.mjs",
);
if (isDirect) {
  const doc = await runIsolatedD1FailClosed();
  console.log(JSON.stringify(doc, null, 2));
  if (!doc.ok) process.exit(2);
}
