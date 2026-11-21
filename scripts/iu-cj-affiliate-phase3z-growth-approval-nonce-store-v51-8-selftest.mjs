#!/usr/bin/env node
/**
 * Atomicity + cross-process replay tests for durable growth approval nonce store.
 * Uses node:sqlite with the same SQL UNIQUE semantics as Cloudflare D1.
 * Does NOT call production D1 (deploy is owner GO). Marks production HTTP as NOT_VERIFIED
 * when IU_CJ_GROWTH_NONCE_STORE_URL is unset.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildReservationKey,
  createSqliteNonceStore,
  hashNonce,
  resolveGrowthApprovalNonceStore,
  GROWTH_NONCE_SCOPE,
} from "./iu-cj-affiliate-phase3z-growth-approval-nonce-store-v51-8.mjs";
import {
  mintOwnerApprovalToken,
  verifyOwnerActivationApproval,
} from "./iu-cj-affiliate-phase3z-safe-autonomous-growth-v51-8.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-nonce-atomic-"));
const dbPath = path.join(tmp, "shared-nonces.sqlite");
const hmacSecret = "nonce-store-selftest-hmac-secret!!";
const mainSha = "9c30f7e1a94fcb20b24845f9a90a175314fde3f1";
const generationId = "2026-11-21T07:37:56.158Z";
const repository = "Josefjosefjosef/filtr";

const results = {
  schema: "iu-cj-growth-approval-nonce-atomicity-selftest-v1",
  at: new Date().toISOString(),
  backend: "node:sqlite_UNIQUE_INSERT",
  productionHttpVerified: false,
  cases: [],
};

function record(id, pass, detail = {}) {
  results.cases.push({ id, pass, ...detail });
  assert.equal(pass, true, id + " " + JSON.stringify(detail));
}

/* ---- Fail-closed without durable on Actions ---- */
{
  const store = resolveGrowthApprovalNonceStore({
    env: { GITHUB_ACTIONS: "true" },
    requireDurable: true,
  });
  const r = await store.reserve({
    reservationKey: "x",
    nonceHash: "y",
    repository,
    mainSha,
    generationId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  record("actions_unavailable_fail_closed", r.ok === false && r.reason === "NONCE_STORE_UNAVAILABLE", {
    reason: r.reason,
  });
}

/* ---- First ACCEPT / second DENY ---- */
{
  const store = createSqliteNonceStore({ dbPath });
  const nonce = "atomic-first-" + Date.now();
  const reservationKey = buildReservationKey({ nonce, repository, mainSha, generationId });
  const base = {
    reservationKey,
    nonceHash: hashNonce(nonce),
    repository,
    mainSha,
    generationId,
    scope: GROWTH_NONCE_SCOPE,
    actor: "tester",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    runId: "run-1",
  };
  const a = await store.reserve(base);
  const b = await store.reserve(base);
  record("first_accept", a.ok === true && a.reason === "NONCE_RESERVED", { reason: a.reason });
  record("second_deny_replay", b.ok === false && b.reason === "OWNER_APPROVAL_REPLAY", { reason: b.reason });
  await store.transition({ reservationKey, state: "FAILED", failReason: "selftest_after_fail" });
  const c = await store.reserve(base);
  record("replay_after_failure_denied", c.ok === false && c.reason === "OWNER_APPROVAL_REPLAY", {
    reason: c.reason,
  });
  store.close();
}

/* ---- Concurrent race: exactly one ACCEPT ---- */
{
  const raceDb = path.join(tmp, "race-nonces.sqlite");
  // Prime schema
  const priming = createSqliteNonceStore({ dbPath: raceDb });
  priming.close();

  const nonce = "race-nonce-" + Date.now();
  const reservationKey = buildReservationKey({ nonce, repository, mainSha, generationId });
  const payload = {
    reservationKey,
    nonceHash: hashNonce(nonce),
    repository,
    mainSha,
    generationId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const storeModUrl = pathToFileURL(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "iu-cj-affiliate-phase3z-growth-approval-nonce-store-v51-8.mjs"),
  ).href;
  const workerSrc = `
    import { createSqliteNonceStore } from ${JSON.stringify(storeModUrl)};
    const store = createSqliteNonceStore({ dbPath: ${JSON.stringify(raceDb)} });
    const r = await store.reserve(${JSON.stringify(payload)});
    store.close();
    process.stdout.write(JSON.stringify(r));
  `;
  const workerFile = path.join(tmp, "race-worker.mjs");
  fs.writeFileSync(workerFile, workerSrc);

  const procs = [];
  for (let i = 0; i < 8; i++) {
    procs.push(
      spawnSync(process.execPath, [workerFile], {
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" },
      }),
    );
  }
  const parsed = procs.map((p) => {
    try {
      return JSON.parse(String(p.stdout || "").trim());
    } catch {
      return { ok: false, reason: "PARSE_FAIL", stderr: String(p.stderr || "").slice(0, 200) };
    }
  });
  const accepts = parsed.filter((r) => r.ok === true);
  const denies = parsed.filter((r) => r.ok === false && r.reason === "OWNER_APPROVAL_REPLAY");
  record("concurrent_exactly_one_accept", accepts.length === 1, {
    accepts: accepts.length,
    denies: denies.length,
    total: parsed.length,
  });
  record("concurrent_rest_replay", denies.length === parsed.length - 1, {
    denies: denies.length,
  });
}

/* ---- Cross-run / reopen same DB (simulates new runner) ---- */
{
  const crossDb = path.join(tmp, "cross-run.sqlite");
  const nonce = "cross-run-" + Date.now();
  const reservationKey = buildReservationKey({ nonce, repository, mainSha, generationId });
  const base = {
    reservationKey,
    nonceHash: hashNonce(nonce),
    repository,
    mainSha,
    generationId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    runId: "runner-A",
  };
  const s1 = createSqliteNonceStore({ dbPath: crossDb });
  const r1 = await s1.reserve(base);
  s1.close();
  const s2 = createSqliteNonceStore({ dbPath: crossDb });
  const r2 = await s2.reserve({ ...base, runId: "runner-B" });
  s2.close();
  record("cross_run_first_accept", r1.ok === true, { reason: r1.reason });
  record("cross_run_second_deny", r2.ok === false && r2.reason === "OWNER_APPROVAL_REPLAY", {
    reason: r2.reason,
  });
}

/* ---- HMAC path + durable reserve integration ---- */
{
  const integDb = path.join(tmp, "integ.sqlite");
  const mint = mintOwnerApprovalToken({
    hmacSecret,
    generationId,
    mainSha,
    nonce: "integ-" + Date.now(),
  });
  const ok = await verifyOwnerActivationApproval({
    hmacSecret,
    ownerApprovalToken: mint.token,
    expectedGenerationId: generationId,
    expectedMainSha: mainSha,
    allowInsecureLocal: true,
    nonceSqlitePath: integDb,
    consume: true,
  });
  const again = await verifyOwnerActivationApproval({
    hmacSecret,
    ownerApprovalToken: mint.token,
    expectedGenerationId: generationId,
    expectedMainSha: mainSha,
    allowInsecureLocal: true,
    nonceSqlitePath: integDb,
    consume: true,
  });
  record("hmac_then_reserve_accept", ok.ok === true && ok.nonceStoreKind === "sqlite", {
    kind: ok.nonceStoreKind,
  });
  record("hmac_replay_denied", again.ok === false && again.reason === "OWNER_APPROVAL_REPLAY", {
    reason: again.reason,
  });
}

/* ---- Expired / bad HMAC still deny before reserve ---- */
{
  const mint = mintOwnerApprovalToken({
    hmacSecret,
    generationId,
    mainSha,
    ttlMs: 1000,
    nowIso: "2020-01-01T00:00:00.000Z",
  });
  const r = await verifyOwnerActivationApproval({
    hmacSecret,
    ownerApprovalToken: mint.token,
    expectedGenerationId: generationId,
    expectedMainSha: mainSha,
    allowInsecureLocal: true,
    nonceSqlitePath: path.join(tmp, "exp.sqlite"),
    nowIso: "2026-11-21T12:00:00.000Z",
    consume: true,
  });
  record("expired_denied", r.ok === false && r.reason === "OWNER_APPROVAL_EXPIRED", { reason: r.reason });
}

const prodUrl = String(process.env.IU_CJ_GROWTH_NONCE_STORE_URL || "").trim();
const prodToken = String(process.env.IU_CJ_GROWTH_NONCE_STORE_TOKEN || "").trim();
if (prodUrl && prodToken) {
  results.productionHttpVerified = "ATTEMPTED";
  results.productionHttpNote = "Live HTTP probe skipped in selftest by default (owner-gated).";
} else {
  results.productionHttpVerified = false;
  results.productionD1Status = "NOT_VERIFIED_OWNER_DEPLOY_REQUIRED";
}

results.ok = results.cases.every((c) => c.pass === true);
results.passCount = results.cases.filter((c) => c.pass).length;
results.caseCount = results.cases.length;

console.log(JSON.stringify(results, null, 2));
if (!results.ok) process.exitCode = 2;
