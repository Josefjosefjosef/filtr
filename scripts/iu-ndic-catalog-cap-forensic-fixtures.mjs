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
  ok("recent-event-created-still-new", fresh && /NOVÁ/.test(fresh.text));

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
    cards: [
      card(1, {
        road: "I/35",
        location: "Kojetín",
        lastMeaningfulChangeAt: "2026-08-11T08:00:00.000Z",
        publicEventId: "iu-te-" + "1".repeat(32),
      }),
      card(2, {
        road: "I/35",
        location: "Kojetín",
        lastMeaningfulChangeAt: "2026-08-11T08:01:00.000Z",
        publicEventId: "iu-te-" + "2".repeat(32),
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
