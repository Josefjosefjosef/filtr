#!/usr/bin/env node
/**
 * Server compact snapshot situation-dedupe must match client
 * dedupeTrafficCardsBySituationIdentity (identity-set equivalence).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compactTrafficUiSnapshotPayload,
  buildOfflinePublicationSnapshot,
} from "./ndic-datex-v1/traffic-publication-snapshot.mjs";
import {
  dedupeTrafficCardsBySituationIdentity,
  orderTrafficCardsNewestFirst,
  trafficItemsFromOfflineSnapshot,
} from "../assets/iu-traffic-overview-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

function pidSet(cards) {
  const s = new Set();
  for (const c of cards || []) {
    const id = String((c && c.publicEventId) || "").trim();
    if (id) s.add(id);
  }
  return s;
}

function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function sampleMultiSituationCards() {
  const sitA = "sit-audit-accident-bundle";
  const sitB = "sit-audit-works-bundle";
  const sitC = "sit-audit-unique";
  const base = (peid, sit, rec, type, ms) => ({
    schema: "iu-traffic-card-projection-v1",
    publicEventId: peid,
    stableSituationId: sit,
    stableRecordId: rec,
    eventType: type,
    category: type,
    lifecycleStatus: "ACTIVE",
    location: "Test",
    municipality: "Testov",
    impact: type + " impact",
    freshness: "FRESH",
    source: "ŘSD/NDIC",
    lastMeaningfulChangeAt: new Date(ms).toISOString(),
    sourceUpdatedAt: new Date(ms).toISOString(),
    mapTarget: {
      mapLinkType: "GENERAL_RSD_MAP",
      safeMapTarget: "https://www.dopravniinfo.cz/",
    },
    feed: { feedHeadline: type, feedChangeType: "EVENT_CREATED" },
    fieldProvenance: { x: 1 },
    publicationEligibility: "ELIGIBLE_FOR_PUBLICATION",
    validity: { validFrom: new Date(ms).toISOString(), expectedEnd: null, actualEnd: null },
  });
  return [
    base("iu-te-a-omezeni", sitA, sitA + "_Lane", "omezeni", 1_700_000_000_000),
    base("iu-te-a-nehoda", sitA, sitA + "_Accident", "nehoda", 1_700_000_000_000),
    base("iu-te-a-prekazka", sitA, sitA + "_Obs", "prekazka", 1_700_000_000_000),
    base("iu-te-b-prace", sitB, sitB + "_Works", "prace", 1_700_000_100_000),
    base("iu-te-b-omezeni", sitB, sitB + "_Lane", "omezeni", 1_700_000_100_000),
    base("iu-te-c-unique", sitC, sitC + "_Only", "kolona", 1_700_000_200_000),
    // Parking-like unique situations must not collapse together
    base("iu-te-p1", "park-roztyly", "park-roztyly_1", "omezeni", 1_700_000_300_000),
    base("iu-te-p2", "park-butovice", "park-butovice_1", "omezeni", 1_700_000_300_100),
  ];
}

{
  const rawCards = sampleMultiSituationCards();
  const clientOut = dedupeTrafficCardsBySituationIdentity(orderTrafficCardsNewestFirst(rawCards));
  const compact = compactTrafficUiSnapshotPayload({
    cards: rawCards,
    projections: rawCards.map((c) => ({ publicEventId: c.publicEventId })),
    sourceFreshness: "FRESH",
  });
  ok("synthetic_raw_gt_deduped", rawCards.length > clientOut.length, "raw=" + rawCards.length);
  ok("synthetic_server_count_eq_client", compact.cards.length === clientOut.length);
  ok(
    "synthetic_identity_equivalence",
    setEq(pidSet(compact.cards), pidSet(clientOut)),
    "server=" + compact.cards.length + " client=" + clientOut.length
  );
  ok(
    "synthetic_prefers_nehoda_over_omezeni",
    clientOut.some((c) => c.publicEventId === "iu-te-a-nehoda") &&
      !clientOut.some((c) => c.publicEventId === "iu-te-a-omezeni")
  );
  ok(
    "synthetic_parking_not_merged",
    clientOut.some((c) => c.publicEventId === "iu-te-p1") &&
      clientOut.some((c) => c.publicEventId === "iu-te-p2")
  );
  ok(
    "synthetic_before_count_meta",
    compact.cardCountBeforeSituationDedupe === rawCards.length
  );

  const built = buildOfflinePublicationSnapshot(compact, {
    uiCompact: false,
    nowIso: "2026-09-10T12:00:00.000Z",
  });
  // When calling build with already-compacted payload, pass uiCompact true via wrapping:
  const built2 = buildOfflinePublicationSnapshot(
    {
      cards: rawCards,
      projections: rawCards.map((c) => ({ publicEventId: c.publicEventId })),
      sourceFreshness: "FRESH",
    },
    { uiCompact: true, nowIso: "2026-09-10T12:00:00.000Z" }
  );
  ok("build_compact_ok", built2.ok === true);
  ok(
    "build_compact_cardCount",
    built2.ok && built2.snapshot.cardCount === clientOut.length,
    "cardCount=" + (built2.snapshot && built2.snapshot.cardCount)
  );
  ok(
    "build_compact_eventCount_matches_cards",
    built2.ok && built2.snapshot.eventCount === built2.snapshot.cardCount
  );
  // Client defensive dedupe on already-deduped snapshot is no-op (card identity)
  const defensive = dedupeTrafficCardsBySituationIdentity(
    orderTrafficCardsNewestFirst(built2.snapshot.cards)
  );
  ok(
    "client_defensive_noop_on_server_deduped",
    defensive.length === built2.snapshot.cards.length
  );
  ok("client_defensive_same_pids", setEq(pidSet(defensive), pidSet(built2.snapshot.cards)));
  // Feed conversion may drop incomplete cards; length must not exceed unique cards
  const again = trafficItemsFromOfflineSnapshot(built2.snapshot);
  ok("feed_items_lte_unique_cards", again.length <= built2.snapshot.cards.length);
  void built;
}

// Optional: live prod RAW snap from %TEMP% if present
{
  const livePath = path.join(process.env.TEMP || "/tmp", "iu_traffic_full_snap.json");
  if (fs.existsSync(livePath)) {
    const raw = JSON.parse(fs.readFileSync(livePath, "utf8"));
    const rawCards = Array.isArray(raw.cards) ? raw.cards : [];
    const clientOut = dedupeTrafficCardsBySituationIdentity(orderTrafficCardsNewestFirst(rawCards));
    const compact = compactTrafficUiSnapshotPayload({
      cards: rawCards,
      projections: [],
      sourceFreshness: raw.sourceFreshness || "UNKNOWN",
      generatedAt: raw.generatedAt,
    });
    ok("live_raw_gt_0", rawCards.length > 1000, "n=" + rawCards.length);
    ok(
      "live_identity_equivalence",
      setEq(pidSet(compact.cards), pidSet(clientOut)),
      "raw=" + rawCards.length + " after=" + compact.cards.length
    );
    ok(
      "live_reduction_substantial",
      compact.cards.length < rawCards.length * 0.8,
      "after=" + compact.cards.length + " raw=" + rawCards.length
    );
    // Skip-flag preserves RAW for forensics
    const skipped = compactTrafficUiSnapshotPayload(
      { cards: rawCards, projections: [] },
      { skipSituationDedupe: true }
    );
    ok("live_skip_flag_preserves_raw", skipped.cards.length === rawCards.length);
  } else {
    ok("live_snap_optional_skipped", true);
  }
}

if (fails.length) {
  console.log(JSON.stringify({ ok: false, fails, results }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      passCount: results.length,
      ids: results.map((r) => r.id),
    },
    null,
    2
  )
);
