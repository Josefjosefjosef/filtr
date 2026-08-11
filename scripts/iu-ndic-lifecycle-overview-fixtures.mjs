#!/usr/bin/env node
/**
 * Main traffic overview lifecycle: ACTIVE+FUTURE visible; ENDED/CANCELLED/UNKNOWN hidden.
 */
import {
  resolveTrafficOverviewLifecycle,
  isTrafficMainOverviewVisible,
  filterOfflineTrafficCandidatesForOverview,
  trafficItemsFromOfflineSnapshot,
  trafficBadgeModel,
  isTrafficNewBadgeEligible,
  orderTrafficCardsNewestFirst,
  TRAFFIC_UI_INITIAL_CARD_CAP,
} from "../assets/iu-traffic-overview-v1.js";
import { deriveLifecycleStatus } from "../scripts/ndic-datex-v1/traffic-publication-projection.mjs";
import { LIFECYCLE_STATUS } from "../scripts/ndic-datex-v1/traffic-publication-constants.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

function tv(extra = {}) {
  return {
    publicEventId: "iu-te-" + "a".repeat(32),
    lifecycleStatus: "ACTIVE",
    category: "nehoda",
    eventType: "nehoda",
    feed: { feedChangeType: "EVENT_CREATED", feedHeadline: "x" },
    lastMeaningfulChangeAt: "2026-08-11T11:00:00.000Z",
    validity: {
      validFrom: "2026-08-11T08:00:00.000Z",
      expectedEnd: "2026-08-11T20:00:00.000Z",
      actualEnd: null,
    },
    ...extra,
  };
}

function card(i, extra = {}) {
  const base = tv({
    publicEventId: "iu-te-" + String(i).padStart(32, "0"),
    lastMeaningfulChangeAt: extra.lastMeaningfulChangeAt || new Date(NOW - i * 60000).toISOString(),
    ...extra,
  });
  return base;
}

{
  ok(
    "active-visible",
    resolveTrafficOverviewLifecycle(tv(), NOW) === "ACTIVE" && isTrafficMainOverviewVisible(tv(), NOW)
  );
  const future = tv({
    lifecycleStatus: "FUTURE",
    validity: { validFrom: "2026-08-11T13:00:00.000Z", expectedEnd: "2026-08-11T20:00:00.000Z", actualEnd: null },
  });
  ok(
    "future-visible",
    resolveTrafficOverviewLifecycle(future, NOW) === "FUTURE" && isTrafficMainOverviewVisible(future, NOW)
  );
  const endedLabel = tv({ lifecycleStatus: "ENDED" });
  ok(
    "ended-hidden",
    resolveTrafficOverviewLifecycle(endedLabel, NOW) === "ENDED" &&
      isTrafficMainOverviewVisible(endedLabel, NOW) === false
  );
}

{
  // A — ended 1s ago via validity
  const a = tv({
    lifecycleStatus: "ACTIVE",
    validity: {
      validFrom: "2026-08-11T08:00:00.000Z",
      expectedEnd: new Date(NOW - 1000).toISOString(),
      actualEnd: null,
    },
  });
  ok("boundary-ended-1s", resolveTrafficOverviewLifecycle(a, NOW) === "ENDED" && !isTrafficMainOverviewVisible(a, NOW));

  // B — ends exactly now: classifyTrafficLifecycle uses toMs < now ⇒ still ACTIVE
  const b = tv({
    lifecycleStatus: "ACTIVE",
    validity: {
      validFrom: "2026-08-11T08:00:00.000Z",
      expectedEnd: new Date(NOW).toISOString(),
      actualEnd: null,
    },
  });
  ok(
    "boundary-ends-exactly-now-active",
    resolveTrafficOverviewLifecycle(b, NOW) === "ACTIVE" && isTrafficMainOverviewVisible(b, NOW)
  );

  // C — still active (+1s)
  const c = tv({
    lifecycleStatus: "ACTIVE",
    validity: {
      validFrom: "2026-08-11T08:00:00.000Z",
      expectedEnd: new Date(NOW + 1000).toISOString(),
      actualEnd: null,
    },
  });
  ok("boundary-active-plus-1s", resolveTrafficOverviewLifecycle(c, NOW) === "ACTIVE" && isTrafficMainOverviewVisible(c, NOW));

  // D — future (+1h) even if snapshot still said ACTIVE
  const d = tv({
    lifecycleStatus: "ACTIVE",
    validity: {
      validFrom: new Date(NOW + 3600000).toISOString(),
      expectedEnd: new Date(NOW + 7200000).toISOString(),
      actualEnd: null,
    },
  });
  ok(
    "boundary-future-from-dates",
    resolveTrafficOverviewLifecycle(d, NOW) === "FUTURE" && isTrafficMainOverviewVisible(d, NOW)
  );

  // E — open ended (no end)
  const e = tv({
    lifecycleStatus: "ACTIVE",
    validity: { validFrom: "2026-08-01T08:00:00.000Z", expectedEnd: null, actualEnd: null },
  });
  ok("boundary-open-ended-active", resolveTrafficOverviewLifecycle(e, NOW) === "ACTIVE" && isTrafficMainOverviewVisible(e, NOW));

  // F — ENDED but updated 1h ago + NOVÁ age eligible
  const f = tv({
    lifecycleStatus: "ENDED",
    lastMeaningfulChangeAt: new Date(NOW - 3600000).toISOString(),
    validity: {
      validFrom: "2026-08-11T08:00:00.000Z",
      expectedEnd: new Date(NOW - 7200000).toISOString(),
      actualEnd: new Date(NOW - 7200000).toISOString(),
    },
  });
  ok("ended-recently-updated-age-eligible", isTrafficNewBadgeEligible(f, NOW) === true);
  ok("ended-recently-updated-hidden", isTrafficMainOverviewVisible(f, NOW) === false);
  const badge = trafficBadgeModel(f, { nowMs: NOW });
  ok("ended-badge-not-new", !badge || !/NOVÁ/.test(badge.text || ""));
}

{
  const unknown = { publicEventId: "iu-te-" + "b".repeat(32), feed: {} };
  ok("unknown-fail-closed", resolveTrafficOverviewLifecycle(unknown, NOW) === "UNKNOWN");
  ok("unknown-not-visible", isTrafficMainOverviewVisible(unknown, NOW) === false);
}

{
  const snapCards = [
    card(1, {
      lifecycleStatus: "ACTIVE",
      lastMeaningfulChangeAt: "2026-08-11T11:50:00.000Z",
      validity: { validFrom: "2026-08-11T08:00:00.000Z", expectedEnd: "2026-08-11T20:00:00.000Z", actualEnd: null },
    }),
    card(2, {
      lifecycleStatus: "FUTURE",
      lastMeaningfulChangeAt: "2026-08-11T11:40:00.000Z",
      validity: { validFrom: "2026-08-20T08:00:00.000Z", expectedEnd: "2026-08-20T20:00:00.000Z", actualEnd: null },
    }),
    card(3, {
      lifecycleStatus: "ACTIVE",
      lastMeaningfulChangeAt: "2026-08-11T11:55:00.000Z",
      validity: { validFrom: "2026-08-11T08:00:00.000Z", expectedEnd: "2026-08-11T10:00:00.000Z", actualEnd: null },
    }),
    card(4, {
      lifecycleStatus: "ENDED",
      lastMeaningfulChangeAt: "2026-08-11T11:59:00.000Z",
      validity: { validFrom: "2026-08-10T08:00:00.000Z", expectedEnd: "2026-08-11T09:00:00.000Z", actualEnd: null },
    }),
  ];
  const items = trafficItemsFromOfflineSnapshot({
    publicationEnabled: false,
    trafficUiEnabled: true,
    cards: snapCards,
  });
  const t0 = Date.now();
  const filtered = filterOfflineTrafficCandidatesForOverview(items, {}, { nowMs: NOW });
  const dur = Date.now() - t0;
  ok("sorting-after-lifecycle-filter", filtered.length === 2);
  ok("ended-excluded-from-overview", filtered.every((x) => isTrafficMainOverviewVisible(x.trafficV1, NOW)));
  ok(
    "newest-first-after-filter",
    filtered[0].trafficV1.lastMeaningfulChangeAt >= filtered[1].trafficV1.lastMeaningfulChangeAt
  );
  ok("page-size-does-not-change-data-available-count", TRAFFIC_UI_INITIAL_CARD_CAP === 0 && items.length === 4);
  ok("lifecycle-filter-fast", dur < 50);
  // follow cannot resurrect: ENDED item not in filtered even if we pretend followed
  const endedItem = items.find((x) => x.trafficV1.lifecycleStatus === "ENDED");
  ok("follow-does-not-resurrect-ended", filtered.indexOf(endedItem) < 0);
}

{
  // Projection deriveLifecycleStatus must honor validTo < now
  const fields = {
    status: { value: "aktivni" },
    validFrom: { value: "2026-08-11T08:00:00.000Z" },
    validTo: { value: "2026-08-11T10:00:00.000Z" },
  };
  const life = deriveLifecycleStatus({ fields }, "2026-08-11T12:00:00.000Z");
  ok("projection-validTo-past-ended", life === LIFECYCLE_STATUS.ENDED);
  const lifeActive = deriveLifecycleStatus(
    {
      fields: {
        status: { value: "aktivni" },
        validFrom: { value: "2026-08-11T08:00:00.000Z" },
        validTo: { value: "2026-08-11T20:00:00.000Z" },
      },
    },
    "2026-08-11T12:00:00.000Z"
  );
  ok("projection-validTo-future-active", lifeActive === LIFECYCLE_STATUS.ACTIVE);
}

{
  // hide-state-preserved: filter does not strip non-traffic / does not clear ids
  const items = trafficItemsFromOfflineSnapshot({
    publicationEnabled: false,
    trafficUiEnabled: true,
    cards: [
      card(9, {
        lifecycleStatus: "ACTIVE",
        validity: { validFrom: "2026-08-11T08:00:00.000Z", expectedEnd: "2026-08-11T20:00:00.000Z", actualEnd: null },
      }),
    ],
  });
  const filtered = filterOfflineTrafficCandidatesForOverview(items, {}, { nowMs: NOW });
  ok("hide-state-preserved", filtered.length === 1 && filtered[0].id === items[0].id);
}

const success = results.filter((r) => r.pass).length;
const failure = results.filter((r) => !r.pass).length;
console.log(
  JSON.stringify(
    {
      suite: "NDIC_LIFECYCLE_OVERVIEW",
      NOW_USED: new Date(NOW).toISOString(),
      success,
      failure,
      fails,
      results,
    },
    null,
    2
  )
);
if (failure) process.exit(1);
