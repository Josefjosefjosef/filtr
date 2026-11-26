#!/usr/bin/env node
/**
 * Offline selftest — MISSING_REFRESH attempt classification + selection (no PAT).
 */
import {
  ATTEMPT_STATUS,
  classifyAttemptStatus,
  selectMissingRefreshTargets,
  attemptMissingRefreshBatch,
  applyMissingRefreshAttemptsToDoc,
  emptyRetryQueue,
  mergeTargetsWithRetryQueue,
  updateRetryQueueFromAttempts,
} from "./iu-cj-affiliate-phase3z-lkg-missing-refresh-attempt-v51-8.mjs";
import { LKG_CAUSE } from "./iu-cj-affiliate-phase3z-lkg-rootcause-audit-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  classifyAttemptStatus({ recovered: true }) === ATTEMPT_STATUS.REFRESHED,
  "recovered → REFRESHED",
);
assert(
  classifyAttemptStatus({ recovered: false, apiResult: "scoped_productIds_miss" }) ===
    ATTEMPT_STATUS.PRODUCT_NOT_FOUND,
  "miss → PRODUCT_NOT_FOUND",
);
assert(
  classifyAttemptStatus(
    { recovered: false, apiResult: "scoped_productIds_miss" },
    { emptyApiPartner: true },
  ) === ATTEMPT_STATUS.SOURCE_UNAVAILABLE,
  "empty API partner → SOURCE_UNAVAILABLE",
);
assert(
  classifyAttemptStatus(
    { recovered: false, apiResult: "scoped_productIds_miss" },
    { partnershipStatus: "ENDED" },
  ) === ATTEMPT_STATUS.PARTNERSHIP_ENDED,
  "ended partnership",
);
assert(
  classifyAttemptStatus({ recovered: false, apiResult: "scoped_error" }) ===
    ATTEMPT_STATUS.TECHNICAL_FAILURE,
  "scoped_error",
);
assert(
  classifyAttemptStatus({ recovered: false, apiResult: "skipped_no_credentials_or_empty" }) ===
    ATTEMPT_STATUS.RETRY_SCHEDULED,
  "no credentials → RETRY",
);
assert(
  classifyAttemptStatus(
    { recovered: false, apiResult: "omitPartner_productId_collision_hold" },
  ) === ATTEMPT_STATUS.INVALID_DATA,
  "collision → INVALID_DATA",
);

const staleIso = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
const doc = {
  sections: [
    {
      sectionKey: "aff-test",
      advertiserId: "ADV1",
      partnerName: "Test",
      products: [
        {
          advertiserId: "ADV1",
          productId: "P_STALE",
          title: "stale",
          lkgCarried: true,
          lastSuccessfulRefreshAt: staleIso,
          affiliateUrl: "https://www.anrdoezrs.net/click",
        },
        {
          advertiserId: "ADV1",
          productId: "P_OK",
          title: "fresh",
          lkgCarried: false,
          lastSuccessfulRefreshAt: new Date().toISOString(),
          affiliateUrl: "https://www.anrdoezrs.net/click",
        },
        {
          advertiserId: "ADV2",
          productId: "P_HOLD",
          title: "hold",
          lkgPublicHold: true,
          availability: false,
          affiliateUrl: "https://www.anrdoezrs.net/click",
        },
      ],
    },
  ],
};

const selected = selectMissingRefreshTargets(doc, { nowMs: Date.now() });
assert(selected.targets.length >= 1, "at least one MISSING_REFRESH target");
assert(
  selected.targets.every((t) => t.causeCode === LKG_CAUSE.MISSING_REFRESH),
  "only MISSING_REFRESH selected by default",
);
assert(
  selected.targets.some((t) => t.productId === "P_STALE"),
  "stale LKG carried selected",
);
assert(
  !selected.targets.some((t) => t.productId === "P_OK"),
  "fresh non-LKG not selected",
);

const dry = await attemptMissingRefreshBatch({
  targets: selected.targets,
  gqlEnv: null,
  nowIso: "2026-11-23T12:00:00.000Z",
});
assert(dry.ledger.targetCount === selected.targets.length, "ledger targetCount");
assert(
  dry.ledger.byStatus[ATTEMPT_STATUS.RETRY_SCHEDULED] === selected.targets.length,
  "no credentials → all RETRY_SCHEDULED",
);
assert(Array.isArray(dry.ledger.attempts) && dry.ledger.attempts.length > 0, "attempts listed");

const fakeRefreshed = new Map([
  [
    "ADV1|P_STALE",
    {
      productId: "P_STALE",
      advertiserId: "ADV1",
      currentPrice: 10,
      currency: "CZK",
      availability: true,
      affiliateUrl: "https://www.anrdoezrs.net/click",
      lastSuccessfulRefreshAt: "2026-11-23T12:00:00.000Z",
      fetchedAt: "2026-11-23T12:00:00.000Z",
    },
  ],
]);
const applied = applyMissingRefreshAttemptsToDoc(
  doc,
  { refreshedByKey: fakeRefreshed, ledger: dry.ledger },
  "2026-11-23T12:00:00.000Z",
);
const cleared = applied.doc.sections[0].products.find((p) => p.productId === "P_STALE");
assert(cleared.lkgCarried === false, "REFRESHED clears lkgCarried");
assert(cleared.refreshReason === "missing_refresh_attempt_v51_8", "attempt reason stamped");

// Durable retry queue: RETRY survives and is due next run; not-due deferred.
let q = emptyRetryQueue("2026-11-23T12:00:00.000Z");
q = updateRetryQueueFromAttempts(
  q,
  [
    {
      key: "ADV1|P_RETRY",
      advertiserId: "ADV1",
      productId: "P_RETRY",
      status: ATTEMPT_STATUS.RETRY_SCHEDULED,
      attemptedAt: "2026-11-23T12:00:00.000Z",
      apiResult: "omitPartner_productIds_miss",
    },
    {
      key: "ADV1|P_BAD",
      advertiserId: "ADV1",
      productId: "P_BAD",
      status: ATTEMPT_STATUS.INVALID_DATA,
      attemptedAt: "2026-11-23T12:00:00.000Z",
      apiResult: "omitPartner_productId_collision_hold",
    },
  ],
  { nowIso: "2026-11-23T12:00:00.000Z", retryHours: 3 },
);
assert(q.items["ADV1|P_RETRY"].closed !== true, "retry open");
assert(q.items["ADV1|P_RETRY"].nextAttemptAt, "nextAttemptAt set");
assert(q.items["ADV1|P_BAD"].closed !== true, "collision stays reopenable");
assert(q.items["ADV1|P_BAD"].queueClass === "IDENTITY_COLLISION_HOLD", "collision class");
assert(q.items["ADV1|P_BAD"].advertiserId === "ADV1", "collision keeps advertiser");
assert(q.items["ADV1|P_BAD"].productId === "P_BAD", "collision keeps product");
const early = mergeTargetsWithRetryQueue([], q, {
  nowMs: Date.parse("2026-11-23T13:00:00.000Z"),
});
assert(early.targets.length === 0, "not due yet");
assert(early.deferredNotDue === 2, "retry and collision deferred");
// Overlap: selected MISSING_REFRESH must NOT burn a not-due queue item (catchup/schedule race).
const overlapEarly = mergeTargetsWithRetryQueue(
  [
    {
      key: "ADV1|P_RETRY",
      advertiserId: "ADV1",
      productId: "P_RETRY",
      causeCode: LKG_CAUSE.MISSING_REFRESH,
    },
    {
      key: "ADV1|P_OTHER",
      advertiserId: "ADV1",
      productId: "P_OTHER",
      causeCode: LKG_CAUSE.MISSING_REFRESH,
    },
  ],
  q,
  { nowMs: Date.parse("2026-11-23T13:00:00.000Z") },
);
assert(overlapEarly.targets.length === 1, "not-due queue key removed from selectedOnly");
assert(overlapEarly.targets[0].productId === "P_OTHER", "unrelated selected kept");
assert(overlapEarly.deferredNotDue === 2, "deferred counted with overlap");
const due = mergeTargetsWithRetryQueue([], q, {
  nowMs: Date.parse("2026-11-23T16:00:00.000Z"),
});
assert(due.targets.length === 1 && due.targets[0].productId === "P_RETRY", "due from queue");
assert(due.dueFromQueue === 1, "dueFromQueue");
const overlapDue = mergeTargetsWithRetryQueue(
  [
    {
      key: "ADV1|P_RETRY",
      advertiserId: "ADV1",
      productId: "P_RETRY",
      causeCode: LKG_CAUSE.MISSING_REFRESH,
    },
  ],
  q,
  { nowMs: Date.parse("2026-11-23T16:00:00.000Z") },
);
assert(overlapDue.targets.length === 1, "due overlap kept");
assert(overlapDue.dueFromQueue === 1, "dueFromQueue counts overlap");
assert(overlapDue.targets[0].fromQueue === true, "overlap marked fromQueue");

let exhaustedQueue = emptyRetryQueue("2026-11-23T12:00:00.000Z");
for (let n = 0; n < 12; n += 1) {
  exhaustedQueue = updateRetryQueueFromAttempts(
    exhaustedQueue,
    [
      {
        key: "ADV9|P_OLD",
        advertiserId: "ADV9",
        productId: "P_OLD",
        status: ATTEMPT_STATUS.RETRY_SCHEDULED,
        attemptedAt: "2026-11-23T12:00:00.000Z",
        apiResult: "omitPartner_productIds_miss",
      },
    ],
    { nowIso: "2026-11-23T12:00:00.000Z", retryHours: 3, maxAttempts: 12 },
  );
}
const parked = exhaustedQueue.items["ADV9|P_OLD"];
assert(parked.status === ATTEMPT_STATUS.RETRY_SCHEDULED, "exhausted is not product-not-found");
assert(parked.queueClass === "LONG_TERM_RECHECK", "long recheck class");
assert(parked.closed !== true, "exhausted stays in the ledger");
assert(parked.holdReason === "RETRY_EXHAUSTED", "exhaustion is a hold reason");
const beforeLong = mergeTargetsWithRetryQueue([], exhaustedQueue, {
  nowMs: Date.parse("2026-11-24T12:00:00.000Z"),
});
assert(beforeLong.targets.length === 0, "not retried the next day");
const afterLong = mergeTargetsWithRetryQueue([], exhaustedQueue, {
  nowMs: Date.parse("2026-12-01T12:00:00.000Z"),
});
assert(afterLong.targets.length === 1, "rechecked after the long interval");
assert(afterLong.targets[0].advertiserId === "ADV9" && afterLong.targets[0].productId === "P_OLD", "same identity");

console.log(
  JSON.stringify({
    ok: true,
    selected: selected.targets.length,
    byStatus: dry.ledger.byStatus,
    appliedMerged: applied.stats.merged,
    retryQueueOpen: q.counts.open,
    dueFromQueue: due.dueFromQueue,
  }),
);
