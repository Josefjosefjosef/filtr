#!/usr/bin/env node
/** Dedicated 45-scenario regression matrix with DB before/after evidence (v29.1). */
import { execSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createNodeSqliteD1Shim } from "./iu-cj-affiliate-phase2-cj-email-d1-sqlite-shim.mjs";
import {
  createCentralOfferRegistryStore,
  migrateCentralOfferRegistryD1 as migV29,
} from "./iu-cj-affiliate-phase2-central-offer-d1-v29.mjs";
import { migrateCentralOfferRegistryD1 as migV28 } from "./iu-cj-affiliate-phase2-central-offer-d1-v28.mjs";
import { OFFER_SOURCE } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import {
  captureRegistryDbState,
  freshV29Store,
  monotonicClaim,
  etagClaim,
  timeClaim,
  MATRIX_BASE_FIELDS,
} from "./iu-cj-affiliate-phase2-central-offer-registry-test-snapshot-v29-1.mjs";
import { deliveryIdempotencyKey } from "./iu-cj-affiliate-phase2-central-offer-delivery-v29.mjs";
import { claimContentFingerprint } from "./iu-cj-affiliate-phase2-central-offer-claim-fingerprint-v25.mjs";

const CMD = "node scripts/iu-cj-affiliate-phase2-central-offer-regression-matrix-v29-1-selftest.mjs";
const scenarios = [];

function pushScenario(row) {
  scenarios.push({
    command: CMD,
    evidenceRef: "regression-matrix-v29-1-selftest.mjs#" + row.id,
    ...row,
  });
}

async function withFresh(fn) {
  const ctx = await freshV29Store();
  try {
    return await fn(ctx);
  } finally {
    ctx.cleanup();
  }
}

function statusFromPass(pass, blockedReason) {
  if (blockedReason) return "NOT VERIFIED";
  return pass ? "PASS" : "FAIL";
}

// 1 R2_to_R10
await withFresh(async ({ store, db }) => {
  const sk = "s01";
  await store.registerSourceClaim(monotonicClaim(sk, 2, "2026-11-10"));
  await store.registerSourceClaim(monotonicClaim(sk, 10, "2026-11-20"));
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.confirmed_rev_num === 10 && after.claims[0]?.claim_validTo === "2026-11-20";
  pushScenario({ id: 1, name: "R2_to_R10", status: statusFromPass(pass), expected: "rev 10 confirmed", actual: after.claims[0], dbAfter: after.counts });
});

// 2 R10_stale_R2
await withFresh(async ({ store, db }) => {
  const sk = "s02";
  await store.registerSourceClaim(monotonicClaim(sk, 10, "2026-11-25"));
  const mid = await captureRegistryDbState(db);
  const reg = await store.registerSourceClaim(monotonicClaim(sk, 2, "2026-11-05"));
  const after = await captureRegistryDbState(db);
  const pass =
    mid.claims[0]?.confirmed_rev_num === 10 &&
    after.claims[0]?.confirmed_rev_num === 10 &&
    after.claims[0]?.claim_validTo === "2026-11-25";
  pushScenario({
    id: 2,
    name: "R10_stale_R2",
    status: statusFromPass(pass),
    expected: "stay R10",
    actual: { regOk: reg.ok, rev: after.claims[0]?.confirmed_rev_num, validTo: after.claims[0]?.claim_validTo },
    dbBefore: mid.counts,
    dbAfter: after.counts,
  });
});

// 3 R9_R10_stale_R9
await withFresh(async ({ store, db }) => {
  const sk = "s03";
  await store.registerSourceClaim(monotonicClaim(sk, 9, "2026-11-09"));
  await store.registerSourceClaim(monotonicClaim(sk, 10, "2026-11-10"));
  await store.registerSourceClaim(monotonicClaim(sk, 9, "2026-11-08"));
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.confirmed_rev_num === 10 && after.claims[0]?.claim_validTo === "2026-11-10";
  pushScenario({ id: 3, name: "R9_R10_stale_R9", status: statusFromPass(pass), actual: after.claims[0], dbAfter: after.counts });
});

// 4 R99_R100
await withFresh(async ({ store, db }) => {
  const sk = "s04";
  await store.registerSourceClaim(monotonicClaim(sk, 99, "2026-11-09"));
  await store.registerSourceClaim(monotonicClaim(sk, 100, "2026-11-10"));
  const after = await captureRegistryDbState(db);
  pushScenario({
    id: 4,
    name: "R99_R100",
    status: statusFromPass(after.claims[0]?.confirmed_rev_num === 100),
    actual: after.claims[0],
    dbAfter: after.counts,
  });
});

// 5 large_revision_numbers
await withFresh(async ({ store, db }) => {
  const sk = "s05";
  const big = 9007199254740990;
  await store.registerSourceClaim(monotonicClaim(sk, big - 1, "2026-11-09"));
  await store.registerSourceClaim(monotonicClaim(sk, big, "2026-11-10"));
  const after = await captureRegistryDbState(db);
  pushScenario({
    id: 5,
    name: "large_revision_numbers",
    status: statusFromPass(Number(after.claims[0]?.confirmed_rev_num) === big),
    actual: { rev: after.claims[0]?.confirmed_rev_num },
    dbAfter: after.counts,
  });
});

// 6 same_revision_same_content
await withFresh(async ({ store, db }) => {
  const sk = "s06";
  const c = monotonicClaim(sk, 5, "2026-11-15");
  await store.registerSourceClaim(c);
  const mid = await captureRegistryDbState(db);
  const reg = await store.registerSourceClaim({ ...c, observedAt: "2026-11-02T10:00:00Z" });
  const after = await captureRegistryDbState(db);
  const pass = reg.ok && mid.counts.events === after.counts.events && after.claims[0]?.confirmed_rev_num === 5;
  pushScenario({ id: 6, name: "same_revision_same_content", status: statusFromPass(pass), actual: { reg, counts: after.counts }, dbBefore: mid.counts, dbAfter: after.counts });
});

// 7 same_revision_diff_content
await withFresh(async ({ store, db }) => {
  const sk = "s07";
  await store.registerSourceClaim(monotonicClaim(sk, 5, "2026-11-15"));
  const before = await captureRegistryDbState(db);
  const reg = await store.registerSourceClaim(monotonicClaim(sk, 5, "2026-11-16"));
  const after = await captureRegistryDbState(db);
  const pass = !reg.ok || reg.reason === "source_revision_content_conflict" || after.claims[0]?.claim_validTo === "2026-11-15";
  pushScenario({ id: 7, name: "same_revision_diff_content", status: statusFromPass(pass), actual: { reg, validTo: after.claims[0]?.claim_validTo }, dbBefore: before.counts, dbAfter: after.counts });
});

// 8 time_999_1000
await withFresh(async ({ store, db }) => {
  const sk = "s08";
  await store.registerSourceClaim(timeClaim(sk, "2026-01-01T00:00:00.999Z", "2026-11-10"));
  await store.registerSourceClaim(timeClaim(sk, "2026-01-01T00:00:01.000Z", "2026-11-15"));
  const after = await captureRegistryDbState(db);
  const ms = Date.parse("2026-01-01T00:00:01.000Z");
  pushScenario({
    id: 8,
    name: "time_999_1000",
    status: statusFromPass(Number(after.claims[0]?.confirmed_rev_ms) === ms),
    actual: after.claims[0],
    dbAfter: after.counts,
  });
});

// 9 time_1000_stale_999
await withFresh(async ({ store, db }) => {
  const sk = "s09";
  await store.registerSourceClaim(timeClaim(sk, "2026-01-01T00:00:01.000Z", "2026-11-15"));
  await store.registerSourceClaim(timeClaim(sk, "2026-01-01T00:00:00.999Z", "2026-11-10"));
  const after = await captureRegistryDbState(db);
  pushScenario({
    id: 9,
    name: "time_1000_stale_999",
    status: statusFromPass(after.claims[0]?.claim_validTo === "2026-11-15"),
    actual: after.claims[0],
    dbAfter: after.counts,
  });
});

// 10 invalid_time
await withFresh(async ({ store, db }) => {
  const sk = "s10";
  await store.registerSourceClaim({ ...timeClaim(sk, "not-a-date", "2026-11-10"), sourceUpdatedAt: "not-a-date" });
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.confirmed_rev_schema == null || after.claims[0]?.legacy_rev_unverified === 1;
  pushScenario({ id: 10, name: "invalid_time", status: statusFromPass(pass), actual: after.claims[0], dbAfter: after.counts });
});

// 11 future_time (referenceTime before observed — still stores if schema typed)
await withFresh(async ({ store, db }) => {
  const sk = "s11";
  const reg = await store.registerSourceClaim({
    ...timeClaim(sk, "2099-01-01T00:00:00.000Z", "2026-11-30"),
    referenceTime: "2026-06-01T00:00:00Z",
  });
  const after = await captureRegistryDbState(db);
  const pass = reg.ok && after.claims[0]?.confirmed_rev_ms === Date.parse("2099-01-01T00:00:00.000Z");
  pushScenario({ id: 11, name: "future_time", status: statusFromPass(pass), actual: { regOk: reg.ok, claim: after.claims[0] }, dbAfter: after.counts });
});

// 12 numeric_vs_time
await withFresh(async ({ store, db }) => {
  const sk = "s12";
  await store.registerSourceClaim(monotonicClaim(sk, 5, "2026-11-10"));
  const reg = await store.registerSourceClaim(timeClaim(sk, "2026-01-01T00:00:01.000Z", "2026-11-20"));
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.confirmed_rev_num === 5 && (reg.revisionOutcome === "revision_order_ambiguous" || !reg.materialChange);
  pushScenario({ id: 12, name: "numeric_vs_time", status: statusFromPass(pass), actual: { reg, claim: after.claims[0] }, dbAfter: after.counts });
});

// 13 time_vs_numeric
await withFresh(async ({ store, db }) => {
  const sk = "s13";
  await store.registerSourceClaim(timeClaim(sk, "2026-01-01T00:00:01.000Z", "2026-11-10"));
  const reg = await store.registerSourceClaim(monotonicClaim(sk, 99, "2026-11-20"));
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.confirmed_rev_ms != null && after.claims[0]?.confirmed_rev_num == null;
  pushScenario({ id: 13, name: "time_vs_numeric", status: statusFromPass(pass), actual: { reg, claim: after.claims[0] }, dbAfter: after.counts });
});

// 14 different_etag
await withFresh(async ({ store, db }) => {
  const sk = "s14";
  await store.registerSourceClaim(etagClaim(sk, "etag-a", "2026-11-10"));
  await store.registerSourceClaim(etagClaim(sk, "etag-b", "2026-11-20"));
  const after = await captureRegistryDbState(db);
  pushScenario({
    id: 14,
    name: "different_etag",
    status: statusFromPass(after.claims[0]?.claim_validTo === "2026-11-10"),
    expected: "etag_change_no_order keeps first",
    actual: after.claims[0],
    dbAfter: after.counts,
  });
});

// 15 same_etag_diff_content
await withFresh(async ({ store, db }) => {
  const sk = "s15";
  await store.registerSourceClaim(etagClaim(sk, "etag-same", "2026-11-10"));
  const reg = await store.registerSourceClaim(etagClaim(sk, "etag-same", "2026-11-99"));
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.claim_validTo === "2026-11-10" || reg.reason === "source_revision_content_conflict";
  pushScenario({ id: 15, name: "same_etag_diff_content", status: statusFromPass(pass), actual: { reg, claim: after.claims[0] }, dbAfter: after.counts });
});

// 16 missing_revision_metadata
await withFresh(async ({ store, db }) => {
  const reg = await store.registerSourceClaim({
    source: OFFER_SOURCE.API,
    sourceRecordId: "s16",
    observedAt: "2026-11-01T10:00:00Z",
    fields: MATRIX_BASE_FIELDS,
    evidence: {},
  });
  const after = await captureRegistryDbState(db);
  const pass = reg.ok && reg.publishable === false && after.claims[0]?.confirmed_rev_schema == null;
  pushScenario({ id: 16, name: "missing_revision_metadata", status: statusFromPass(pass), actual: { reg, claim: after.claims[0] }, dbAfter: after.counts });
});

// 17 legacy_untyped_revision — first row blocked from accept until typed
await withFresh(async ({ store, db }) => {
  await store.registerSourceClaim({
    source: OFFER_SOURCE.API,
    sourceRecordId: "s17",
    observedAt: "2026-11-01T10:00:00Z",
    fields: MATRIX_BASE_FIELDS,
    evidence: {},
  });
  const reg = await store.registerSourceClaim(monotonicClaim("s17", 2, "2026-12-01"));
  const after = await captureRegistryDbState(db);
  const pass =
    after.claims[0]?.confirmed_rev_schema == null &&
    after.claims[0]?.claim_accept === 0 &&
    reg.publishable === false;
  pushScenario({ id: 17, name: "legacy_untyped_revision", status: statusFromPass(pass), actual: after.claims[0], dbAfter: after.counts });
});

// 18 legacy_conflicting_revision
await withFresh(async ({ store, db }) => {
  await store.registerSourceClaim({
    source: OFFER_SOURCE.API,
    sourceRecordId: "s18",
    observedAt: "2026-11-01T10:00:00Z",
    fields: MATRIX_BASE_FIELDS,
    evidence: { x: 1 },
  });
  const reg = await store.registerSourceClaim({
    source: OFFER_SOURCE.API,
    sourceRecordId: "s18",
    observedAt: "2026-11-02T10:00:00Z",
    fields: { ...MATRIX_BASE_FIELDS, customerDiscountValue: 99 },
    evidence: { x: 2 },
  });
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.legacy_rev_unverified === 1 || after.claims[0]?.confirmed_rev_schema == null;
  pushScenario({ id: 18, name: "legacy_conflicting_revision", status: statusFromPass(pass), actual: { reg, claim: after.claims[0] }, dbAfter: after.counts });
});

// 19 legacy_invalid_revision
await withFresh(async ({ store, db }) => {
  const reg = await store.registerSourceClaim({
    source: OFFER_SOURCE.API,
    sourceRecordId: "s19",
    observedAt: "2026-11-01T10:00:00Z",
    meta: { sourceRevision: { revisionNumber: "NaN" } },
    fields: MATRIX_BASE_FIELDS,
    evidence: {},
  });
  const after = await captureRegistryDbState(db);
  pushScenario({ id: 19, name: "legacy_invalid_revision", status: statusFromPass(reg.ok && after.claims[0]?.confirmed_rev_schema == null), actual: { reg, claim: after.claims[0] }, dbAfter: after.counts });
});

// 20 concurrent_R2_R10
await withFresh(async ({ store, db }) => {
  const sk = "s20";
  await store.registerSourceClaim(monotonicClaim(sk, 2, "2026-11-10"));
  const [a, b] = await Promise.all([
    store.registerSourceClaim(monotonicClaim(sk, 10, "2026-11-20", { observedAt: "2026-11-02T10:00:00Z" })),
    store.registerSourceClaim(monotonicClaim(sk, 9, "2026-11-19", { observedAt: "2026-11-02T10:00:01Z" })),
  ]);
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.confirmed_rev_num === 10 && after.claims[0]?.claim_validTo === "2026-11-20";
  pushScenario({ id: 20, name: "concurrent_R2_R10", status: statusFromPass(pass), actual: { a: a.ok, b: b.ok, claim: after.claims[0] }, dbAfter: after.counts });
});

// 21 concurrent_R99_R100
await withFresh(async ({ store, db }) => {
  const sk = "s21";
  await store.registerSourceClaim(monotonicClaim(sk, 99, "2026-11-10"));
  await Promise.all([
    store.registerSourceClaim(monotonicClaim(sk, 100, "2026-11-20", { observedAt: "2026-11-02T10:00:00Z" })),
    store.registerSourceClaim(monotonicClaim(sk, 98, "2026-11-18", { observedAt: "2026-11-02T10:00:01Z" })),
  ]);
  const after = await captureRegistryDbState(db);
  pushScenario({ id: 21, name: "concurrent_R99_R100", status: statusFromPass(after.claims[0]?.confirmed_rev_num === 100), actual: after.claims[0], dbAfter: after.counts });
});

// 22 concurrent_etag_conflict
await withFresh(async ({ store, db }) => {
  const sk = "s22";
  await store.registerSourceClaim(etagClaim(sk, "e1", "2026-11-10"));
  await Promise.all([
    store.registerSourceClaim(etagClaim(sk, "e2", "2026-11-20", { observedAt: "2026-11-02T10:00:00Z" })),
    store.registerSourceClaim(etagClaim(sk, "e3", "2026-11-21", { observedAt: "2026-11-02T10:00:01Z" })),
  ]);
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.claim_validTo === "2026-11-10";
  pushScenario({ id: 22, name: "concurrent_etag_conflict", status: statusFromPass(pass), expected: "incomparable etag keeps first", actual: after.claims[0], dbAfter: after.counts });
});

// 23 valid_move_A_B
await withFresh(async ({ store, db }) => {
  const sk = "s23";
  const a = await store.registerSourceClaim({ ...monotonicClaim(sk, 1, "2026-11-10"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "MV-A" } });
  const b = await store.registerSourceClaim({ ...monotonicClaim(sk, 2, "2026-11-20"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "MV-B" } });
  const after = await captureRegistryDbState(db);
  const pass = a.offerId !== b.offerId && b.oldOfferId === a.offerId;
  pushScenario({ id: 23, name: "valid_move_A_B", status: statusFromPass(pass), actual: { a: a.offerId, b: b.offerId, old: b.oldOfferId }, dbAfter: after.counts });
});

// 24 stale_move_A_B
await withFresh(async ({ store, db }) => {
  const sk = "s24";
  const a = await store.registerSourceClaim({ ...monotonicClaim(sk, 10, "2026-11-10"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "ST-A" } });
  const b = await store.registerSourceClaim({ ...monotonicClaim(sk, 2, "2026-11-20"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "ST-B" } });
  const pass = a.offerId === b.offerId && b.offerId === a.offerId;
  pushScenario({ id: 24, name: "stale_move_A_B", status: statusFromPass(pass), actual: { offerA: a.offerId, offerB: b.offerId }, dbAfter: (await captureRegistryDbState(db)).counts });
});

// 25 ambiguous_move_A_B — identity ambiguous blocks canonical publish
await withFresh(async ({ store, db }) => {
  const sk = "s25";
  await store.registerSourceClaim({ ...monotonicClaim(sk, 1, "2026-11-10"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "AM-A", campaignId: null } });
  const reg = await store.registerSourceClaim({ ...monotonicClaim(sk, 2, "2026-11-20"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "AM-B", campaignId: null } });
  const pass = reg.identityAmbiguous === true || reg.blockReason === "identity_ambiguous";
  pushScenario({ id: 25, name: "ambiguous_move_A_B", status: statusFromPass(pass), actual: { reg }, dbAfter: (await captureRegistryDbState(db)).counts });
});

// 26 concurrent_move_A_B
await withFresh(async ({ store, db }) => {
  const sk = "s26";
  await store.registerSourceClaim({ ...monotonicClaim(sk, 1, "2026-11-10"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "CM-A" } });
  const [a, b] = await Promise.all([
    store.registerSourceClaim({ ...monotonicClaim(sk, 3, "2026-11-30"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "CM-B" } }),
    store.registerSourceClaim({ ...monotonicClaim(sk, 2, "2026-11-20"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "CM-C" } }),
  ]);
  const after = await captureRegistryDbState(db);
  const pass = after.counts.claims === 1 && after.counts.offers === 2 && (a.ok || b.ok);
  pushScenario({ id: 26, name: "concurrent_move_A_B", status: statusFromPass(pass), actual: { aOk: a.ok, bOk: b.ok, a: a.offerId, b: b.offerId, counts: after.counts }, dbAfter: after.counts });
});

// 27 move_A_B_A
await withFresh(async ({ store, db }) => {
  const sk = "s27";
  const oa = await store.registerSourceClaim({ ...monotonicClaim(sk, 1, "2026-11-10"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "ABA-A" } });
  const ob = await store.registerSourceClaim({ ...monotonicClaim(sk, 2, "2026-11-20"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "ABA-B" } });
  const oc = await store.registerSourceClaim({ ...monotonicClaim(sk, 3, "2026-11-25"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "ABA-A" } });
  const pass = oc.offerId === oa.offerId && ob.offerId !== oa.offerId;
  pushScenario({ id: 27, name: "move_A_B_A", status: statusFromPass(pass), actual: { oa: oa.offerId, ob: ob.offerId, oc: oc.offerId }, dbAfter: (await captureRegistryDbState(db)).counts });
});

// 28 evidence_change_no_offer_move
await withFresh(async ({ store, db }) => {
  const sk = "s28";
  const r1 = await store.registerSourceClaim({ ...monotonicClaim(sk, 1, "2026-11-10"), evidence: { a: 1 } });
  const r2 = await store.registerSourceClaim({ ...monotonicClaim(sk, 2, "2026-11-15"), evidence: { a: 2 } });
  const pass = r1.offerId === r2.offerId && r2.materialChange;
  pushScenario({ id: 28, name: "evidence_change_no_offer_move", status: statusFromPass(pass), actual: { r1: r1.offerId, r2: r2.offerId }, dbAfter: (await captureRegistryDbState(db)).counts });
});

// 29 legacy_event_collision — delegated check
{
  let pass = false;
  try {
    const out = execSync("node " + JSON.stringify(path.join(path.dirname(fileURLToPath(import.meta.url)), "iu-cj-affiliate-phase2-central-offer-conflict-v19-selftest.mjs")), {
      encoding: "utf8",
    });
    pass = out.includes("IU_CJ_CENTRAL_OFFER_CONFLICT_V19_SELFTEST") && out.includes("OK");
  } catch {
    pass = false;
  }
  pushScenario({ id: 29, name: "legacy_event_collision", status: statusFromPass(pass), actual: { subprocessOk: pass }, command: "iu-cj-affiliate-phase2-central-offer-conflict-v19-selftest.mjs" });
}

// 30 rollback_on_history_failure
await withFresh(async ({ store, db }) => {
  await store.registerSourceClaim(monotonicClaim("s30", 1, "2026-11-10"));
  const before = await captureRegistryDbState(db);
  const fail = await store.registerSourceClaim({ ...monotonicClaim("s30b", 1, "2026-11-10"), __registryTestHook: "abortBeforeMandatoryEventInBatch" });
  const after = await captureRegistryDbState(db);
  const pass = !fail.ok && before.counts.claims === after.counts.claims;
  pushScenario({ id: 30, name: "rollback_on_history_failure", status: statusFromPass(pass), actual: { fail, before: before.counts, after: after.counts }, dbBefore: before.counts, dbAfter: after.counts });
});

// 31 retry_after_interrupt
await withFresh(async ({ store, db }) => {
  const c = monotonicClaim("s31", 1, "2026-11-10");
  const fail = await store.registerSourceClaim({ ...c, __registryTestHook: "abortAfterClaimInBatch" });
  const retry = await store.registerSourceClaim(c);
  const after = await captureRegistryDbState(db);
  const pass = !fail.ok && retry.ok && after.counts.claims === 1 && after.counts.deliveries >= 1;
  pushScenario({ id: 31, name: "retry_after_interrupt", status: statusFromPass(pass), actual: { fail, retry, counts: after.counts }, dbAfter: after.counts });
});

// 32 migration_v19_v29
{
  let pass = false;
  let detail = {};
  try {
    const out = execSync("node " + JSON.stringify(path.join(path.dirname(fileURLToPath(import.meta.url)), "iu-cj-affiliate-phase2-cj-email-d1-sql-selftest.mjs")), { encoding: "utf8" });
    pass = out.includes("IU_CJ_CJ_EMAIL_D1_SQL_SELFTEST") && out.includes("OK");
    detail.subprocess = "d1-sql-selftest";
  } catch (e) {
    detail.error = String(e.message || e);
  }
  const shim = await createNodeSqliteD1Shim(path.join(os.tmpdir(), "tmp-m291-" + Date.now() + ".sqlite"));
  await migV29(shim.db);
  const row = await shim.db.prepare("SELECT name FROM sqlite_master WHERE name='d1_claim_cas_invariant_abort'").bind().first();
  pass = pass && !!row?.name;
  detail.casTable = row?.name ?? null;
  pushScenario({ id: 32, name: "migration_v19_v29", status: statusFromPass(pass), actual: detail });
}

// 33 migration_v28_v29
await withFresh(async ({ store, db, shim }) => {
  await store.registerSourceClaim(monotonicClaim("s33", 1, "2026-11-10"));
  const before = await captureRegistryDbState(db);
  await migV29(shim.db);
  const after = await captureRegistryDbState(db);
  const pass = before.counts.claims === after.counts.claims && after.counts.claims === 1;
  pushScenario({ id: 33, name: "migration_v28_v29", status: statusFromPass(pass), dbBefore: before.counts, dbAfter: after.counts });
});

// 34 publication_gate_v15
{
  const pass = PRODUCTION_SIGNING_ENABLED === false;
  pushScenario({ id: 34, name: "publication_gate_v15", status: statusFromPass(pass), actual: { PRODUCTION_SIGNING_ENABLED } });
}

// 35 pipeline_parity_full
{
  let pass = false;
  let exitCode = 1;
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "iu-cj-affiliate-phase2-pipeline-parity-full-v29-2-selftest.mjs");
  try {
    const out = execSync("node " + JSON.stringify(script), { encoding: "utf8" });
    exitCode = 0;
    pass = out.trim().split("\n").some((l) => l.includes("IU_CJ_PIPELINE_PARITY_FULL_V29_2_SELFTEST") && l.includes("OK"));
  } catch (e) {
    exitCode = e.status ?? 1;
    pass = false;
  }
  pushScenario({
    id: 35,
    name: "pipeline_parity_full",
    status: statusFromPass(pass),
    command: "node scripts/iu-cj-affiliate-phase2-pipeline-parity-full-v29-2-selftest.mjs",
    exitCode,
  });
}

// 36 CAS_fail_after_concurrent_gen
await withFresh(async ({ store, db }) => {
  const sk = "s36";
  await store.registerSourceClaim(monotonicClaim(sk, 1, "2026-11-10"));
  await store.registerSourceClaim(monotonicClaim(sk, 2, "2026-12-01"));
  await db.prepare("UPDATE central_offer_source_claims SET confirmed_gen = 9 WHERE source_record_id = ?").bind(sk).run();
  const before = await captureRegistryDbState(db);
  const reg = await store.registerSourceClaim({ ...monotonicClaim(sk, 3, "2026-12-31"), __forcePriorGenForCas: 2 });
  const after = await captureRegistryDbState(db);
  const pass =
    !reg.ok &&
    before.offers[0]?.revision === after.offers[0]?.revision &&
    before.claims[0]?.confirmed_gen === after.claims[0]?.confirmed_gen &&
    JSON.stringify(before.counts) === JSON.stringify(after.counts);
  pushScenario({ id: 36, name: "CAS_fail_after_concurrent_gen", status: statusFromPass(pass), actual: { reg, before: before.counts, after: after.counts }, dbBefore: before.counts, dbAfter: after.counts });
});

// 37 CAS_fail_during_claim_move
await withFresh(async ({ store, db }) => {
  const sk = "s37";
  await store.registerSourceClaim({ ...monotonicClaim(sk, 1, "2026-11-10"), fields: { ...MATRIX_BASE_FIELDS, couponCode: "C37-A" } });
  await db.prepare("UPDATE central_offer_source_claims SET confirmed_gen = 99 WHERE source_record_id = ?").bind(sk).run();
  const reg = await store.registerSourceClaim({ ...monotonicClaim(sk, 2, "2026-11-20", { __forcePriorGenForCas: 1 }), fields: { ...MATRIX_BASE_FIELDS, couponCode: "C37-B" } });
  const after = await captureRegistryDbState(db);
  const pass = !reg.ok && after.offers.length === 1;
  pushScenario({ id: 37, name: "CAS_fail_during_claim_move", status: statusFromPass(pass), actual: { reg, offers: after.offers.length }, dbAfter: after.counts });
});

// 38 CAS_fail_canonical_update
await withFresh(async ({ store, db }) => {
  const sk = "s38";
  const r1 = await store.registerSourceClaim(monotonicClaim(sk, 1, "2026-11-10"));
  await store.registerSourceClaim(monotonicClaim(sk, 2, "2026-12-01"));
  const before = await captureRegistryDbState(db);
  await db.prepare("UPDATE central_offer_source_claims SET confirmed_gen = 50 WHERE source_record_id = ?").bind(sk).run();
  await store.registerSourceClaim({ ...monotonicClaim(sk, 3, "2026-12-31"), __forcePriorGenForCas: 2 });
  const after = await captureRegistryDbState(db);
  const pass = before.offers[0]?.canonical_validTo === after.offers[0]?.canonical_validTo && before.offers[0]?.revision === after.offers[0]?.revision;
  pushScenario({ id: 38, name: "CAS_fail_canonical_update", status: statusFromPass(pass), actual: { before: before.offers[0], after: after.offers[0] }, dbBefore: before.counts, dbAfter: after.counts, offerId: r1.offerId });
});

// 39 CAS_fail_confirmed_event
await withFresh(async ({ store, db }) => {
  await store.registerSourceClaim(monotonicClaim("s39", 1, "2026-11-10"));
  const before = await captureRegistryDbState(db);
  await db.prepare("UPDATE central_offer_source_claims SET confirmed_gen = 7 WHERE source_record_id = 's39'").run();
  await store.registerSourceClaim({ ...monotonicClaim("s39", 2, "2026-11-20"), __forcePriorGenForCas: 1 });
  const after = await captureRegistryDbState(db);
  const pass = before.counts.events === after.counts.events;
  pushScenario({ id: 39, name: "CAS_fail_confirmed_event", status: statusFromPass(pass), actual: { eventsBefore: before.counts.events, eventsAfter: after.counts.events }, dbBefore: before.counts, dbAfter: after.counts });
});

// 40 CAS_fail_publish_state
await withFresh(async ({ store, db }) => {
  await store.registerSourceClaim(monotonicClaim("s40", 1, "2026-11-10"));
  const before = await captureRegistryDbState(db);
  await db.prepare("UPDATE central_offer_source_claims SET confirmed_gen = 7 WHERE source_record_id = 's40'").run();
  await store.registerSourceClaim({ ...monotonicClaim("s40", 2, "2026-11-20"), __forcePriorGenForCas: 1 });
  const after = await captureRegistryDbState(db);
  const pass =
    before.offers[0]?.publishability_state === after.offers[0]?.publishability_state &&
    before.offers[0]?.block_reason === after.offers[0]?.block_reason;
  pushScenario({ id: 40, name: "CAS_fail_publish_state", status: statusFromPass(pass), actual: { before: before.offers[0], after: after.offers[0] }, dbBefore: before.counts, dbAfter: after.counts });
});

// 41 two_workers_same_gen
await withFresh(async ({ store, db }) => {
  const sk = "s41";
  await store.registerSourceClaim(monotonicClaim(sk, 5, "2026-11-10"));
  const genRow = await db.prepare("SELECT confirmed_gen FROM central_offer_source_claims WHERE source_record_id = ?").bind(sk).first();
  const g = Number(genRow?.confirmed_gen ?? 0);
  const [a, b] = await Promise.all([
    store.registerSourceClaim(monotonicClaim(sk, 6, "2026-11-20", { observedAt: "2026-11-03T10:00:00Z" })),
    store.registerSourceClaim(monotonicClaim(sk, 7, "2026-11-21", { observedAt: "2026-11-03T10:00:01Z" })),
  ]);
  const after = await captureRegistryDbState(db);
  const pass = after.claims[0]?.confirmed_gen >= g + 1 && (a.ok || b.ok);
  pushScenario({ id: 41, name: "two_workers_same_gen", status: statusFromPass(pass), actual: { startGen: g, a, b, afterGen: after.claims[0]?.confirmed_gen }, dbAfter: after.counts });
});

// 42 retry_after_CAS_conflict
await withFresh(async ({ store, db }) => {
  const sk = "s42";
  await store.registerSourceClaim(monotonicClaim(sk, 1, "2026-11-10"));
  await db.prepare("UPDATE central_offer_source_claims SET confirmed_gen = 5 WHERE source_record_id = ?").bind(sk).run();
  await store.registerSourceClaim({ ...monotonicClaim(sk, 2, "2026-11-15"), __forcePriorGenForCas: 1 });
  const retry = await store.registerSourceClaim(monotonicClaim(sk, 2, "2026-11-15"));
  const after = await captureRegistryDbState(db);
  const pass = retry.ok && after.claims[0]?.confirmed_rev_num === 2;
  pushScenario({ id: 42, name: "retry_after_CAS_conflict", status: statusFromPass(pass), actual: { retry, claim: after.claims[0] }, dbAfter: after.counts });
});

// 43 delivery_id_collision
await withFresh(async ({ store, db }) => {
  const sk = "s43";
  const first = monotonicClaim(sk, 1, "2026-11-10");
  await store.registerSourceClaim(first);
  const claimRow = await db.prepare("SELECT claim_id, confirmed_revision_key FROM central_offer_source_claims LIMIT 1").bind().first();
  const next = monotonicClaim(sk, 2, "2026-11-12");
  const contentFp = claimContentFingerprint(next);
  const revKey2 = "monotonic:2";
  const idemKey = deliveryIdempotencyKey(next.source, sk, contentFp, revKey2, "accepted");
  await db
    .prepare(
      `INSERT INTO central_offer_claim_deliveries (delivery_id, claim_id, source, source_record_id, observed_at, delivery_outcome, reject_reason, delivered_rev_key, delivered_content_fp, delivery_json, event_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, '{}', NULL, ?, ?)`
    )
    .bind("dlv:fake43", claimRow.claim_id, next.source, sk, next.observedAt, "accepted", revKey2, "tampered-fp", idemKey, new Date().toISOString())
    .run();
  const reg = await store.registerSourceClaim(next);
  const pass = reg.reason === "delivery_idempotency_collision";
  pushScenario({ id: 43, name: "delivery_id_collision", status: statusFromPass(pass), actual: { reg, idemKey }, dbAfter: (await captureRegistryDbState(db)).counts });
});

// 44 rollback_last_sql_in_batch
await withFresh(async ({ store, db }) => {
  const before = await captureRegistryDbState(db);
  const fail = await store.registerSourceClaim({ ...monotonicClaim("s44", 1, "2026-11-10"), __registryTestHook: "abortAfterClaimInBatch" });
  const after = await captureRegistryDbState(db);
  const pass = !fail.ok && JSON.stringify(before.counts) === JSON.stringify(after.counts);
  pushScenario({ id: 44, name: "rollback_last_sql_in_batch", status: statusFromPass(pass), actual: { fail, before: before.counts, after: after.counts }, dbBefore: before.counts, dbAfter: after.counts });
});

// 45 table_consistency_after_rejected_CAS
await withFresh(async ({ store, db }) => {
  await store.registerSourceClaim(monotonicClaim("s45", 1, "2026-11-10"));
  await store.registerSourceClaim(monotonicClaim("s45", 2, "2026-12-01"));
  const before = await captureRegistryDbState(db);
  await db.prepare("UPDATE central_offer_source_claims SET confirmed_gen = 20 WHERE source_record_id = 's45'").run();
  await store.registerSourceClaim({ ...monotonicClaim("s45", 3, "2026-12-31"), __forcePriorGenForCas: 2 });
  const after = await captureRegistryDbState(db);
  const pass =
    before.counts.offers === after.counts.offers &&
    before.counts.claims === after.counts.claims &&
    before.counts.events === after.counts.events &&
    before.counts.deliveries === after.counts.deliveries &&
    before.offers[0]?.revision === after.offers[0]?.revision;
  pushScenario({ id: 45, name: "table_consistency_after_rejected_CAS", status: statusFromPass(pass), actual: { before: before.counts, after: after.counts }, dbBefore: before.counts, dbAfter: after.counts });
});

const passN = scenarios.filter((s) => s.status === "PASS").length;
const failN = scenarios.filter((s) => s.status === "FAIL").length;
const nvN = scenarios.filter((s) => s.status === "NOT VERIFIED").length;
const ok = failN === 0 && scenarios.length === 45;

console.log(
  JSON.stringify({
    IU_CJ_CENTRAL_OFFER_REGRESSION_MATRIX_V29_1_SELFTEST: ok ? "OK" : "FAIL",
    pass: passN,
    fail: failN,
    notVerified: nvN,
    scenarios,
  })
);
process.exit(ok ? 0 : 1);
