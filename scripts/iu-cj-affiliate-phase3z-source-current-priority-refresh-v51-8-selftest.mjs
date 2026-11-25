#!/usr/bin/env node
/** Offline selftest — no CJ credentials, no network, no writes. */
import {
  REFRESH_TIER,
  auditSourceCurrentHonesty,
  classifySourceCurrentHonesty,
  planPriorityRefresh,
} from "./iu-cj-affiliate-phase3z-source-current-priority-refresh-v51-8.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

const now = Date.parse("2026-11-03T12:00:00Z");
const P = (productId, extra) => ({ advertiserId: "1", productId, currentPrice: 10, ...extra });

const doc = {
  sections: [
    {
      sectionKey: "aff-test",
      products: [
        // genuinely source-current
        P("fresh", {
          lastSuccessfulRefreshAt: "2026-11-03T11:00:00Z",
          sourceUpdatedAt: "2026-11-03T10:30:00Z",
          sourceUpdatedAtStatus: "PROVIDED",
          freshnessStatus: "SOURCE_FRESH",
        }),
        // fetch-recent, source age unknown, aging (>1.5h of 3h) — honest, P3
        P("unk-aging", {
          lastSuccessfulRefreshAt: "2026-11-03T09:30:00Z",
          sourceUpdatedAtStatus: "NOT_PROVIDED",
          freshnessStatus: "FETCH_RECENT_SOURCE_AGE_UNKNOWN",
        }),
        // fetch-recent, brand new — NOT_DUE
        P("unk-new", {
          lastSuccessfulRefreshAt: "2026-11-03T11:45:00Z",
          sourceUpdatedAtStatus: "NOT_PROVIDED",
        }),
        // claims FRESH but has no authoritative source — dishonest
        P("liar", {
          lastSuccessfulRefreshAt: "2026-11-03T11:00:00Z",
          sourceUpdatedAtStatus: "NOT_PROVIDED",
          freshnessStatus: "FRESH",
        }),
        // source ts invented from fetch clock (legacy)
        P("legacy", {
          lastCheckedAt: "2026-11-03T11:30:00Z",
          sourceUpdatedAt: "2026-11-03T11:30:00Z",
        }),
        // beyond target interval → STALE
        P("stale", { lastSuccessfulRefreshAt: "2026-11-03T06:00:00Z" }),
        // beyond 24h → HIDDEN_STALE
        P("hidden", { lastSuccessfulRefreshAt: "2026-10-01T00:00:00Z" }),
        // never refreshed → UNVERIFIED
        P("never", {}),
        // no identity — ignored by planner
        { currentPrice: 1 },
      ],
    },
  ],
};

// --- honesty audit ---
const hFresh = classifySourceCurrentHonesty(doc.sections[0].products[0], now);
expect("fresh_is_source_current", hFresh.sourceCurrent === true && hFresh.dishonest === false);
const hUnk = classifySourceCurrentHonesty(doc.sections[0].products[1], now);
expect("unknown_source_not_current", hUnk.sourceCurrent === false && hUnk.dishonest === false);
const hLiar = classifySourceCurrentHonesty(doc.sections[0].products[3], now);
expect(
  "claimed_fresh_without_source_flagged",
  hLiar.sourceCurrent === false &&
    hLiar.dishonest === true &&
    hLiar.reasons.includes("CLAIMED_CURRENT_WITHOUT_AUTHORITATIVE_SOURCE"),
);
const hLegacy = classifySourceCurrentHonesty(doc.sections[0].products[4], now);
expect(
  "legacy_fetch_as_source_flagged",
  hLegacy.sourceCurrent === false && hLegacy.reasons.includes("SOURCE_TIMESTAMP_EQUALS_FETCH_CLOCK"),
);

const audit = auditSourceCurrentHonesty(doc, { nowMs: now });
expect("audit_read_only", audit.readOnly === true);
expect("audit_total", audit.counts.products === 9);
expect("audit_source_current_only_one", audit.counts.sourceCurrent === 1 && audit.sourceCurrentProven === true);
expect("audit_dishonest_two", audit.counts.dishonest === 2 && audit.honest === false);
expect("audit_hidden_stale", audit.counts.hiddenStale === 1);
expect("audit_stale", audit.counts.stale === 1);
// "never" + the identity-less row (audit counts all cards; planner skips identity-less ones)
expect("audit_unverified", audit.counts.unverified === 2);
expect(
  "verified_recent_not_counted_current",
  audit.verifiedRecentNotCurrent >= 2 && audit.counts.sourceCurrent < audit.counts.products,
);
const cleanAudit = auditSourceCurrentHonesty({ sections: [{ products: [doc.sections[0].products[0]] }] }, { nowMs: now });
expect("clean_doc_honest", cleanAudit.honest === true && cleanAudit.counts.sourceCurrent === 1);

// SOURCE_CURRENT=0 with VERIFIED_RECENT>0 is PASS honesty (not a failure) — note asserted
const zeroCurrentAudit = auditSourceCurrentHonesty(
  { sections: [{ products: [doc.sections[0].products[1], doc.sections[0].products[2]] }] },
  { nowMs: now },
);
expect(
  "source_current_zero_verified_recent_is_honest",
  zeroCurrentAudit.counts.sourceCurrent === 0 &&
    zeroCurrentAudit.verifiedRecentNotCurrent > 0 &&
    zeroCurrentAudit.honest === true &&
    zeroCurrentAudit.counts.dishonest === 0 &&
    zeroCurrentAudit.sourceCurrentProven === false,
);
expect(
  "source_current_zero_honesty_note_asserted",
  /SOURCE_CURRENT=0 with VERIFIED_RECENT>0 is honest \(PASS\), not a failure/.test(zeroCurrentAudit.note),
);

// --- priority planner ---
const plan = planPriorityRefresh(doc, { nowMs: now, limit: 50 });
expect("plan_read_only", plan.readOnly === true && plan.writes === 0);
const tierOf = (id) => plan.planned.find((r) => r.productId === id)?.tier;
expect("tier_hidden_p0", tierOf("hidden") === REFRESH_TIER.P0_HIDDEN_OR_DISHONEST);
expect("tier_liar_p0", tierOf("liar") === REFRESH_TIER.P0_HIDDEN_OR_DISHONEST);
expect("tier_legacy_p0", tierOf("legacy") === REFRESH_TIER.P0_HIDDEN_OR_DISHONEST);
expect("tier_stale_p1", tierOf("stale") === REFRESH_TIER.P1_STALE);
expect("tier_never_p2", tierOf("never") === REFRESH_TIER.P2_UNVERIFIED);
expect("tier_unk_aging_p3", tierOf("unk-aging") === REFRESH_TIER.P3_SOURCE_AGE_UNKNOWN_AGING);
expect("fresh_not_planned", tierOf("fresh") === undefined);
expect("new_fetch_not_planned", tierOf("unk-new") === undefined);
expect("no_identity_skipped", plan.candidates === 6);
const order = plan.planned.map((r) => r.tier);
const tierRank = (t) => ({ P0_HIDDEN_OR_DISHONEST: 0, P1_STALE: 1, P1_QUEUE_DUE: 1, P2_UNVERIFIED: 2, P3_SOURCE_AGE_UNKNOWN_AGING: 3 })[t];
expect(
  "plan_ordered_by_tier",
  order.every((t, i) => i === 0 || tierRank(order[i - 1]) <= tierRank(t)),
);
expect("plan_rank_sequence", plan.planned.every((r, i) => r.rank === i + 1));

const limited = planPriorityRefresh(doc, { nowMs: now, limit: 2 });
expect("limit_applied", limited.planned.length === 2 && limited.truncatedByLimit === plan.totalRanked - 2);

// --- dueFromQueue / backoff ---
const queue = {
  items: {
    "1|stale": {
      advertiserId: "1",
      productId: "stale",
      status: "RETRY_SCHEDULED",
      nextAttemptAt: "2026-11-03T20:00:00Z", // future → deferred
    },
    "1|qdue": {
      advertiserId: "1",
      productId: "qdue",
      status: "RETRY_SCHEDULED",
      nextAttemptAt: "2026-11-03T08:00:00Z", // past → due, not in doc
    },
    "1|done": { advertiserId: "1", productId: "done", status: "REFRESHED", closed: true },
  },
};
const planQ = planPriorityRefresh(doc, { nowMs: now, queue, limit: 50 });
expect("queue_due_counted", planQ.dueFromQueue === 1);
expect("queue_backoff_deferred", planQ.deferredNotDue === 1);
expect("deferred_not_planned", !planQ.planned.some((r) => r.productId === "stale"));
const qRow = planQ.planned.find((r) => r.productId === "qdue");
expect("queue_only_item_planned", qRow?.tier === REFRESH_TIER.P1_QUEUE_DUE && qRow.fromQueue === true);
expect("closed_not_planned", !planQ.planned.some((r) => r.productId === "done"));

// determinism
const again = planPriorityRefresh(doc, { nowMs: now, queue, limit: 50 });
expect("deterministic", JSON.stringify(again.planned) === JSON.stringify(planQ.planned));

console.log(
  JSON.stringify({
    IU_CJ_SOURCE_CURRENT_PRIORITY_REFRESH_V51_8_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    credentialsRequired: false,
    failures,
  }),
);
process.exitCode = failures.length === 0 ? 0 : 1;
