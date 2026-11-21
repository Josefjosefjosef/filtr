#!/usr/bin/env node
/**
 * Lifecycle + COMPLETED evidence selftests (sqlite atomic). No production deploy.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canTransitionNonceState,
  evaluateCompletedPublicationEvidence,
  evaluateNonceTransition,
  TERMINAL_NONCE_STATES,
} from "./iu-cj-affiliate-phase3z-growth-approval-nonce-lifecycle-v51-8.mjs";
import { createSqliteNonceStore, buildReservationKey, hashNonce } from "./iu-cj-affiliate-phase3z-growth-approval-nonce-store-v51-8.mjs";
import {
  completeGrowthApprovalPublication,
} from "./iu-cj-affiliate-phase3z-growth-approval-complete-v51-8.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-nonce-life-"));
const dbPath = path.join(tmp, "life.sqlite");
const store = createSqliteNonceStore({ dbPath });
const mainSha = "ddb3a03ad62d1bea159ab5fb449835c2479ee56f";
const generationId = "2026-11-21T07:37:56.158Z";
const repository = "Josefjosefjosef/filtr";
const cases = [];

function rec(id, pass, detail = {}) {
  cases.push({ id, pass, ...detail });
  assert.equal(pass, true, id + " " + JSON.stringify(detail));
}

/* Pure rules */
rec("deny_reserved_to_completed_rule", canTransitionNonceState("RESERVED", "COMPLETED") === false);
rec("allow_reserved_to_armed_rule", canTransitionNonceState("RESERVED", "ARMED") === true);
rec("deny_completed_to_armed_rule", canTransitionNonceState("COMPLETED", "ARMED") === false);
for (const t of TERMINAL_NONCE_STATES) {
  rec("terminal_" + t, evaluateNonceTransition({ from: t, to: "ARMED" }).ok === false);
}

async function seed(nonceSuffix, operationId) {
  const nonce = "life-" + nonceSuffix;
  const reservationKey = buildReservationKey({ nonce, repository, mainSha, generationId });
  const r = await store.reserve({
    reservationKey,
    nonceHash: hashNonce(nonce),
    repository,
    mainSha,
    generationId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    operationId,
    runId: "selftest",
  });
  assert.equal(r.ok, true);
  return { reservationKey, operationId };
}

{
  const { reservationKey, operationId } = await seed("ok", "op-ok-1");
  const a = await store.transition({
    reservationKey,
    state: "ARMED",
    expectedMainSha: mainSha,
    expectedGenerationId: generationId,
    expectedOperationId: operationId,
  });
  rec("reserved_to_armed", a.ok === true && a.state === "ARMED", { reason: a.reason });

  const badComplete = await completeGrowthApprovalPublication({
    reservationKey,
    operationId,
    mainSha,
    generationId,
    allowInsecureLocal: true,
    requireDurable: false,
    nonceSqlitePath: dbPath,
    requiredCiPass: false,
    dataPrMerged: false,
    pagesDeployPass: false,
    publishedProductsVerified: false,
  });
  rec(
    "completed_without_evidence_deny",
    badComplete.completed === false && badComplete.reason === "COMPLETED_EVIDENCE_INSUFFICIENT",
    { reason: badComplete.reason, fails: badComplete.evidenceFails },
  );

  const good = await completeGrowthApprovalPublication({
    reservationKey,
    operationId,
    mainSha,
    generationId,
    allowInsecureLocal: true,
    requireDurable: false,
    nonceSqlitePath: dbPath,
    requiredCiPass: true,
    dataPrMerged: true,
    pagesDeployPass: true,
    productionGenerationId: generationId,
    contentSha: "a".repeat(40),
    expectedContentSha: "a".repeat(40),
    publishedProductsVerified: true,
  });
  rec("armed_to_completed_with_evidence", good.completed === true, { reason: good.reason });

  const reArm = await store.transition({ reservationKey, state: "ARMED" });
  rec("completed_to_armed_deny", reArm.ok === false && reArm.reason === "NONCE_STATE_TERMINAL", {
    reason: reArm.reason,
  });
}

{
  const { reservationKey } = await seed("skip", "op-skip");
  const skip = await store.transition({ reservationKey, state: "COMPLETED" });
  rec("reserved_to_completed_deny", skip.ok === false && skip.reason === "NONCE_TRANSITION_DENIED", {
    reason: skip.reason,
  });
}

{
  const { reservationKey } = await seed("fail", "op-fail");
  await store.transition({ reservationKey, state: "ARMED" });
  await store.transition({ reservationKey, state: "FAILED", failReason: "sync_failed" });
  const re = await store.transition({ reservationKey, state: "ARMED" });
  rec("failed_to_armed_deny", re.ok === false, { reason: re.reason });
}

{
  const { reservationKey } = await seed("stop", "op-stop");
  await store.transition({ reservationKey, state: "STOPPED", failReason: "owner_stop" });
  const re = await store.transition({ reservationKey, state: "ARMED" });
  rec("stopped_to_armed_deny", re.ok === false, { reason: re.reason });
}

{
  const { reservationKey } = await seed("rev", "op-rev");
  await store.transition({ reservationKey, state: "REVOKED", failReason: "revoked" });
  const re = await store.transition({ reservationKey, state: "ARMED" });
  rec("revoked_to_armed_deny", re.ok === false, { reason: re.reason });
}

{
  const { reservationKey } = await seed("exp", "op-exp");
  await store.transition({ reservationKey, state: "EXPIRED", failReason: "expired" });
  const re = await store.transition({ reservationKey, state: "ARMED" });
  rec("expired_to_armed_deny", re.ok === false, { reason: re.reason });
}

{
  const { reservationKey, operationId } = await seed("ctx", "op-ctx");
  await store.transition({ reservationKey, state: "ARMED", expectedOperationId: operationId });
  const badSha = await store.transition({
    reservationKey,
    state: "COMPLETED",
    expectedMainSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGenerationId: generationId,
    expectedOperationId: operationId,
  });
  rec("wrong_main_sha_deny", badSha.ok === false && badSha.reason === "NONCE_MAIN_SHA_MISMATCH", {
    reason: badSha.reason,
  });
  const badGen = await store.transition({
    reservationKey,
    state: "COMPLETED",
    expectedMainSha: mainSha,
    expectedGenerationId: "1999-01-01T00:00:00.000Z",
    expectedOperationId: operationId,
  });
  rec("wrong_generation_deny", badGen.ok === false && badGen.reason === "NONCE_GENERATION_MISMATCH", {
    reason: badGen.reason,
  });
  const badOp = await store.transition({
    reservationKey,
    state: "COMPLETED",
    expectedMainSha: mainSha,
    expectedGenerationId: generationId,
    expectedOperationId: "wrong-op",
  });
  rec("wrong_operation_id_deny", badOp.ok === false && badOp.reason === "NONCE_OPERATION_ID_MISMATCH", {
    reason: badOp.reason,
  });
}

{
  const ev = evaluateCompletedPublicationEvidence({
    reservationKey: "x",
    operationId: "y",
    mainSha,
    generationId,
    requiredCiPass: true,
    dataPrMerged: true,
    pagesDeployPass: false,
    productionGenerationId: generationId,
    contentSha: "b".repeat(40),
    publishedProductsVerified: true,
  });
  rec("pages_not_verified_blocks_completed", ev.ok === false && ev.fails.includes("pages_deploy_not_verified"));
}

{
  const { reservationKey, operationId } = await seed("race", "op-race");
  await store.transition({ reservationKey, state: "ARMED", expectedOperationId: operationId });
  const p1 = store.transition({
    reservationKey,
    state: "COMPLETED",
    expectedMainSha: mainSha,
    expectedGenerationId: generationId,
    expectedOperationId: operationId,
  });
  const p2 = store.transition({
    reservationKey,
    state: "FAILED",
    failReason: "race",
    expectedOperationId: operationId,
  });
  const [r1, r2] = await Promise.all([p1, p2]);
  const oks = [r1, r2].filter((r) => r.ok);
  rec("concurrent_conflict_one_accept", oks.length === 1, {
    r1: r1.reason,
    r2: r2.reason,
    oks: oks.length,
  });
}

store.close();

const out = {
  schema: "iu-cj-growth-approval-nonce-lifecycle-selftest-v1",
  at: new Date().toISOString(),
  ok: cases.every((c) => c.pass),
  passCount: cases.filter((c) => c.pass).length,
  caseCount: cases.length,
  cases,
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exitCode = 2;
