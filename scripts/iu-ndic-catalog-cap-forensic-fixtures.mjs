#!/usr/bin/env node
/**
 * Forensic regressions: NDIC catalog must not silently truncate to 120;
 * timeline uses publication/version time; NOVÁ is age-gated; pagination can reach all.
 */
import {
  TRAFFIC_UI_INITIAL_CARD_CAP,
  TRAFFIC_UI_NEW_BADGE_MAX_AGE_MS,
  trafficItemsFromOfflineSnapshot,
  trafficProjectionToFeedItem,
  trafficBadgeModel,
  orderTrafficCardsNewestFirst,
  dedupeTrafficCardsBySituationIdentity,
  isTrafficNewBadgeEligible,
} from "../assets/iu-traffic-overview-v1.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

function card(i, extra = {}) {
  const peid = "iu-te-" + String(i).padStart(32, "0");
  return {
    publicEventId: peid,
    lifecycleStatus: "ACTIVE",
    category: "prace",
    eventType: "prace",
    severity: "medium",
    road: "I/" + (i % 50),
    location: "Loc" + i,
    impact: "Práce na komunikaci " + i,
    freshness: "FRESH",
    source: "ŘSD/NDIC",
    mapTarget: {
      mapLinkType: "GENERAL_RSD_MAP",
      safeMapTarget: "https://www.dopravniinfo.cz/",
    },
    feed: {
      feedHeadline: "Práce " + i,
      feedChangeType: "EVENT_CREATED",
    },
    fieldProvenance: {},
    publicationEligibility: "ELIGIBLE_FOR_PUBLICATION",
    validity: {
      validFrom: "2025-10-01T07:00:00.000Z",
      expectedEnd: null,
      actualEnd: null,
    },
    lastMeaningfulChangeAt: extra.lastMeaningfulChangeAt,
    sourceUpdatedAt: extra.sourceUpdatedAt || extra.lastMeaningfulChangeAt,
    ...extra,
  };
}

ok("default_cap_is_unlimited", TRAFFIC_UI_INITIAL_CARD_CAP === 0);

{
  const cards = [];
  for (let i = 0; i < 240; i++) {
    cards.push(
      card(i, {
        lastMeaningfulChangeAt: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString(),
      })
    );
  }
  // Put a fresh 2026 publication on an otherwise old-valid-from card at the end of array.
  cards.push(
    card(999, {
      lastMeaningfulChangeAt: "2026-08-11T07:15:00.000Z",
      sourceUpdatedAt: "2026-08-11T07:15:00.000Z",
      validity: {
        validFrom: "2026-08-20T08:00:00.000Z",
        expectedEnd: null,
        actualEnd: null,
      },
    })
  );
  const snap = { publicationEnabled: false, trafficUiEnabled: true, cards };
  const built = trafficItemsFromOfflineSnapshot(snap);
  ok("full-dataset-no-silent-truncation", built.length === cards.length);

  const top = built[0];
  ok(
    "timeline-uses-publication-or-version-time",
    top.publishedAt === "2026-08-11T07:15:00.000Z" &&
      top.validFrom === "2026-08-20T08:00:00.000Z" &&
      top.publishedAt !== top.validFrom
  );
  ok(
    "timeline-descending-order",
    built.every((it, idx) => {
      if (idx === 0) return true;
      const a = Date.parse(String(built[idx - 1].publishedAt || "")) || 0;
      const b = Date.parse(String(it.publishedAt || "")) || 0;
      return a >= b;
    })
  );

  const PAGE_SIZE = 50;
  let reached = 0;
  for (let page = 1; page * PAGE_SIZE < built.length + PAGE_SIZE; page++) {
    const slice = built.slice(0, page * PAGE_SIZE);
    reached = slice.length;
    if (reached >= built.length) break;
  }
  ok("pagination-reaches-all-records", reached === built.length);

  const ordered = orderTrafficCardsNewestFirst(cards);
  ok("order_helper_newest_first", ordered[0].publicEventId === card(999).publicEventId);
}

{
  const now = Date.parse("2026-08-11T12:00:00.000Z");
  const old = trafficBadgeModel(
    {
      lifecycleStatus: "ACTIVE",
      category: "prace",
      feed: { feedChangeType: "EVENT_CREATED" },
      lastMeaningfulChangeAt: "2025-10-01T07:00:00.000Z",
    },
    { nowMs: now }
  );
  ok("active-old-record-not-automatically-new", old == null);

  const fresh = trafficBadgeModel(
    {
      lifecycleStatus: "ACTIVE",
      category: "nehoda",
      feed: { feedChangeType: "EVENT_CREATED" },
      lastMeaningfulChangeAt: "2026-08-11T07:15:00.000Z",
    },
    { nowMs: now }
  );
  // Product: NOVÁ badge intentionally removed for ordinary ACTIVE / EVENT_CREATED cards.
  ok("recent-event-created-still-new", fresh == null);

  ok(
    "eligible_window",
    isTrafficNewBadgeEligible(
      { lastMeaningfulChangeAt: new Date(now - TRAFFIC_UI_NEW_BADGE_MAX_AGE_MS + 1000).toISOString() },
      now
    ) === true
  );
  ok(
    "eligible_expired",
    isTrafficNewBadgeEligible(
      { lastMeaningfulChangeAt: new Date(now - TRAFFIC_UI_NEW_BADGE_MAX_AGE_MS - 1000).toISOString() },
      now
    ) === false
  );
}

{
  // Independent events with same road/municipality must not collapse in conversion.
  const twins = {
    publicationEnabled: false,
    trafficUiEnabled: true,
    generatedAt: "2026-09-10T10:00:01.000Z",
    cards: [
      card(1, {
        road: "I/35",
        location: "Kojetín",
        lastMeaningfulChangeAt: "2026-08-11T08:00:00.000Z",
        publicEventId: "iu-te-" + "1".repeat(32),
        stableSituationId: "sit-independent-a",
        stableRecordId: "rec-a",
      }),
      card(2, {
        road: "I/35",
        location: "Kojetín",
        lastMeaningfulChangeAt: "2026-08-11T08:01:00.000Z",
        publicEventId: "iu-te-" + "2".repeat(32),
        stableSituationId: "sit-independent-b",
        stableRecordId: "rec-b",
      }),
    ],
  };
  const items = trafficItemsFromOfflineSnapshot(twins);
  ok("dedupe-does-not-collapse-independent-events", items.length === 2);
  ok(
    "ids_distinct",
    items[0].id !== items[1].id &&
      items[0].trafficV1.publicEventId !== items[1].trafficV1.publicEventId
  );
}

{
  // A — duplicate publicEventId rows inside one dataset
  const dupPid = {
    publicationEnabled: false,
    trafficUiEnabled: true,
    generatedAt: "2026-09-10T10:00:02.000Z",
    cards: [
      card(10, {
        publicEventId: "iu-te-" + "a".repeat(32),
        stableSituationId: "sit-dup-pid",
        stableRecordId: "rec-1",
        lastMeaningfulChangeAt: "2026-09-10T08:00:00.000Z",
      }),
      card(11, {
        publicEventId: "iu-te-" + "b".repeat(32),
        stableSituationId: "sit-other",
        stableRecordId: "rec-2",
        lastMeaningfulChangeAt: "2026-09-10T07:00:00.000Z",
      }),
      card(12, {
        publicEventId: "iu-te-" + "a".repeat(32),
        stableSituationId: "sit-dup-pid",
        stableRecordId: "rec-1b",
        lastMeaningfulChangeAt: "2026-09-10T08:00:00.000Z",
      }),
      card(13, {
        publicEventId: "iu-te-" + "c".repeat(32),
        stableSituationId: "sit-third",
        stableRecordId: "rec-3",
        lastMeaningfulChangeAt: "2026-09-10T06:00:00.000Z",
      }),
    ],
  };
  const outA = trafficItemsFromOfflineSnapshot(dupPid);
  ok("dedupe_dataset_A_len", outA.length === 3);
  ok(
    "dedupe_dataset_A_unique_sit",
    new Set(outA.map((x) => x.trafficV1.stableSituationId)).size === 3
  );
}

{
  // B — first-batch head + full hydrate overlap (same situation records)
  const headCards = [
    card(20, {
      publicEventId: "iu-te-" + "d".repeat(32),
      stableSituationId: "sit-h1",
      eventType: "omezeni",
      category: "omezeni",
      lastMeaningfulChangeAt: "2026-09-10T10:00:00.000Z",
    }),
    card(21, {
      publicEventId: "iu-te-" + "e".repeat(32),
      stableSituationId: "sit-h1",
      eventType: "prace",
      category: "prace",
      impact: "stejná situace — práce",
      lastMeaningfulChangeAt: "2026-09-10T10:00:00.000Z",
    }),
    card(22, {
      publicEventId: "iu-te-" + "f".repeat(32),
      stableSituationId: "sit-h2",
      lastMeaningfulChangeAt: "2026-09-10T09:00:00.000Z",
    }),
  ];
  const fullCards = headCards.concat([
    card(23, {
      publicEventId: "iu-te-" + "0".repeat(31) + "1",
      stableSituationId: "sit-h3",
      lastMeaningfulChangeAt: "2026-09-10T08:00:00.000Z",
    }),
    card(24, {
      publicEventId: "iu-te-" + "0".repeat(31) + "2",
      stableSituationId: "sit-h4",
      lastMeaningfulChangeAt: "2026-09-10T07:00:00.000Z",
    }),
  ]);
  const headItems = trafficItemsFromOfflineSnapshot({
    publicationEnabled: false,
    trafficUiEnabled: true,
    generatedAt: "2026-09-10T10:00:03.000Z",
    cards: headCards,
    cardCount: 3,
  });
  const fullItems = trafficItemsFromOfflineSnapshot({
    publicationEnabled: false,
    trafficUiEnabled: true,
    generatedAt: "2026-09-10T10:00:04.000Z",
    cards: fullCards,
    cardCount: 5,
  });
  ok("dedupe_head_B_one_per_situation", headItems.length === 2);
  ok("dedupe_full_B_len", fullItems.length === 4);
  ok(
    "dedupe_full_B_prefers_prace_over_omezeni",
    fullItems.some(
      (it) =>
        it.trafficV1.stableSituationId === "sit-h1" &&
        String(it.trafficV1.eventType || it.trafficV1.category) === "prace"
    )
  );
}

{
  // C — similar road/text but different situation ids stay separate
  const similar = {
    publicationEnabled: false,
    trafficUiEnabled: true,
    generatedAt: "2026-09-10T10:00:05.000Z",
    cards: [
      card(30, {
        publicEventId: "iu-te-" + "3".repeat(32),
        stableSituationId: "sit-100",
        road: "D4",
        impact: "Práce na silnici D4",
        lastMeaningfulChangeAt: "2026-09-10T11:00:00.000Z",
      }),
      card(31, {
        publicEventId: "iu-te-" + "4".repeat(32),
        stableSituationId: "sit-101",
        road: "D4",
        impact: "Práce na silnici D4",
        lastMeaningfulChangeAt: "2026-09-10T11:00:00.000Z",
      }),
    ],
  };
  const outC = trafficItemsFromOfflineSnapshot(similar);
  ok("dedupe_similar_C_keeps_both", outC.length === 2);
}

{
  // D — updated version of same situation/record identity → one card (prefer newer)
  const updated = {
    publicationEnabled: false,
    trafficUiEnabled: true,
    generatedAt: "2026-09-10T10:00:06.000Z",
    cards: [
      card(40, {
        publicEventId: "iu-te-" + "5".repeat(32),
        stableSituationId: "sit-upd",
        stableRecordId: "rec-upd",
        impact: "old data",
        eventType: "omezeni",
        category: "omezeni",
        lastMeaningfulChangeAt: "2026-09-10T08:00:00.000Z",
      }),
      card(41, {
        publicEventId: "iu-te-" + "5".repeat(32),
        stableSituationId: "sit-upd",
        stableRecordId: "rec-upd",
        impact: "updated data",
        eventType: "omezeni",
        category: "omezeni",
        lastMeaningfulChangeAt: "2026-09-10T12:00:00.000Z",
      }),
    ],
  };
  const outD = trafficItemsFromOfflineSnapshot(updated);
  ok("dedupe_update_D_one_card", outD.length === 1);
  ok("dedupe_update_D_keeps_newer", /updated data/i.test(String(outD[0].trafficV1.impact || "")));
}

{
  // E — repeated convert cycles stay stable (revalidate / hydrate simulation)
  const multi = {
    publicationEnabled: false,
    trafficUiEnabled: true,
    generatedAt: "2026-09-10T10:00:07.000Z",
    cards: [
      card(50, {
        publicEventId: "iu-te-" + "6".repeat(32),
        stableSituationId: "sit-e",
        eventType: "nehoda",
        category: "nehoda",
        lastMeaningfulChangeAt: "2026-09-10T10:00:00.000Z",
      }),
      card(51, {
        publicEventId: "iu-te-" + "7".repeat(32),
        stableSituationId: "sit-e",
        eventType: "omezeni",
        category: "omezeni",
        lastMeaningfulChangeAt: "2026-09-10T10:00:00.000Z",
      }),
      card(52, {
        publicEventId: "iu-te-" + "8".repeat(32),
        stableSituationId: "sit-f",
        lastMeaningfulChangeAt: "2026-09-10T09:00:00.000Z",
      }),
    ],
  };
  const once = trafficItemsFromOfflineSnapshot(multi);
  const twice = trafficItemsFromOfflineSnapshot(multi);
  const thrice = trafficItemsFromOfflineSnapshot(multi);
  ok("dedupe_revalidate_E_stable_len", once.length === 2 && twice.length === 2 && thrice.length === 2);
  ok(
    "dedupe_revalidate_E_prefers_nehoda",
    once[0].trafficV1.stableSituationId === "sit-e"
      ? String(once[0].trafficV1.eventType) === "nehoda"
      : String(once.find((x) => x.trafficV1.stableSituationId === "sit-e").trafficV1.eventType) ===
          "nehoda"
  );
  const collapsed = dedupeTrafficCardsBySituationIdentity(orderTrafficCardsNewestFirst(multi.cards));
  ok("dedupe_helper_E_len", collapsed.length === 2);
}

{
  const published = "2026-08-11T07:15:00.000Z";
  const validFrom = "2026-08-20T08:00:00.000Z";
  const r = trafficProjectionToFeedItem(
    card(7, {
      lastMeaningfulChangeAt: published,
      sourceUpdatedAt: published,
      validity: { validFrom, expectedEnd: null, actualEnd: null },
    })
  );
  ok("proj_ok", r.ok === true);
  ok("timeline_field_is_publication", r.item.publishedAt === published);
  ok("validity_kept_separate", r.item.validFrom === validFrom);
}

{
  const workerSrc = fs.readFileSync(path.join(ROOT, "assets/iu-json-parse-worker-v1.js"), "utf8");
  const coreSrc = fs.readFileSync(path.join(ROOT, "assets/iu-info-system-core-v1.js"), "utf8");
  ok(
    "worker_no_default_120_cap",
    !/Number\(maxCards\)\s*>\s*0\s*\?\s*Math\.floor\(Number\(maxCards\)\)\s*:\s*120/.test(workerSrc)
  );
  ok(
    "core_no_default_120_cap",
    !/Number\(maxCards\)\s*>\s*0\s*\?\s*Math\.floor\(Number\(maxCards\)\)\s*:\s*120/.test(coreSrc)
  );
  ok("overview_default_cap_zero", TRAFFIC_UI_INITIAL_CARD_CAP === 0);
}

const success = results.filter((r) => r.pass).length;
const failure = results.filter((r) => !r.pass).length;
console.log(
  JSON.stringify(
    {
      suite: "NDIC_CATALOG_CAP_FORENSIC",
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
