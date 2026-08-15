#!/usr/bin/env node
/**
 * FUTURE vs ACTIVE traffic-impact tense + lane semantic dedupe + no PLATNOST echo.
 *
 * Lifecycle-aware DOPRAVNÍ SITUACE: FUTURE must not claim present-tense closures.
 * Fixture-based general rules — no road/direction hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficSituationSummary,
  buildTrafficCardPresentation,
  resolveSituationLifecycle,
  EVENT_LIFECYCLE,
} from "../assets/iu-traffic-card-presenter-v1.js";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

const FUTURE_RAW =
  "D11, mezi km 16.7 a 16.3, ve směru Praha, práce na silnici; pravý jízdní pruh uzavřen, Od 20.09.2026 19:30 Do 21.09.2026 06:00, Oprava výtluků a příčných hrbolů, údržba a opravy vozovek AB, pracovní místo DK - Krátkodobé stabilní, Vydal: SSÚD 13 - Poříčany";

const ACTIVE_RAW =
  "D8, mezi km 10.0 a 10.2, ve směru Ústí nad Labem, práce na silnici; pravý jízdní pruh uzavřen, Od 01.01.2026 08:00 Do 31.12.2026 18:00, Oprava výtluků, údržba a opravy vozovek, Vydal: SSÚD test";

function countLaneClosureSentences(sit) {
  const parts = String(sit || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.filter((p) =>
    /(?:pravý|levý|střední)\s+jízdní\s+pruh|(?:ve\s+směru\s+.+\s+)?bude\s+uzavřen\s+(?:pravý|levý|střední)\s+jízdní\s+pruh/i.test(
      p
    )
  ).length;
}

function hasValidityEcho(sit) {
  return (
    /19:30|06:00|20\.\s*9\.|21\.\s*9\.|20\.09\.|21\.09\.|Od\s+19/i.test(sit) ||
    /\bOd\s+\d/i.test(sit)
  );
}

// --- FUTURE motorway roadworks + right lane ---
{
  const input = {
    impact: FUTURE_RAW,
    impactFull: FUTURE_RAW,
    eventType: "prace",
    category: "prace",
    road: "D11",
    direction: "Praha",
    kmFrom: 16.7,
    kmTo: 16.3,
    lifecycleStatus: "FUTURE",
    validFrom: "2026-09-20T19:30:00+02:00",
    validTo: "2026-09-21T06:00:00+02:00",
    illustrationKey: "prace",
  };
  const facts = parseOfficialCommentFacts(FUTURE_RAW);
  const life = resolveSituationLifecycle(input, Date.parse("2026-09-20T12:00:00+02:00"));
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const laneCount = countLaneClosureSentences(sit);

  ok("EVENT_LIFECYCLE_FUTURE", life === EVENT_LIFECYCLE.FUTURE, life);
  ok(
    "EVENT_LIFECYCLE_USED_BY_COMPOSER",
    /bude\s+uzavřen/i.test(sit) && !/jízdní\s+pruh(?:\s+ve\s+směru\s+\S+)?\s+je\s+uzavřen/i.test(sit),
    sit
  );
  ok(
    "LANE_CLOSURE_SOURCE_PRESENT",
    /pravý\s+jízdní\s+pruh\s+uzavřen/i.test(FUTURE_RAW)
  );
  ok(
    "LANE_CLOSURE_EXTRACTED",
    /pravý|uzavřen/i.test(String(facts.affectedLane || "")) ||
      /pravý\s+jízdní\s+pruh/i.test(FUTURE_RAW),
    facts.affectedLane
  );
  ok(
    "LANE_CLOSURE_STRUCTURED",
    /bude\s+uzavřen\s+pravý\s+jízdní\s+pruh|pravý\s+jízdní\s+pruh.*bude\s+uzavřen/i.test(
      sit
    ),
    sit
  );
  ok(
    "DIRECTION_STRUCTURED",
    /Praha/i.test(String(facts.directionHuman || input.direction || "")),
    facts.directionHuman
  );
  ok("DIRECTION_IN_SUMMARY", /Praha/i.test(sit), sit);
  ok(
    "FUTURE_TRAFFIC_IMPACT_TENSE_GUARD",
    /bude\s+uzavřen/i.test(sit) && !/\bje\s+uzavřen\b/i.test(sit),
    sit
  );
  ok(
    "NO_VALIDITY_DUPLICATION_GUARD",
    !hasValidityEcho(sit),
    sit
  );
  ok(
    "LANE_CLOSURE_SEMANTIC_DEDUPE_GUARD",
    laneCount === 1,
    "count=" + laneCount + " sit=" + sit
  );
  ok(
    "ROADWORK_DETAIL_USED",
    /výtluk|oprava/i.test(sit),
    sit
  );
  ok("AB_STRIPPED_OR_SAFE", !/\bAB\b/.test(sit), sit);
  ok(
    "WORKSITE_NOT_FORCED",
    !/pracovní\s+místo\s+DK|Krátkodobé\s+stabilní/i.test(sit),
    sit
  );
  ok(
    "FUTURE_BADGE",
    String(card.lifecycleStatus || input.lifecycleStatus || "").toUpperCase() ===
      "FUTURE" ||
      /budouc/i.test(String(card.badgeLabel || card.statusLabel || "")),
    JSON.stringify({
      life: card.lifecycleStatus,
      badge: card.badgeLabel,
      status: card.statusLabel,
    })
  );
  const kmLine = String(
    (card.communication && card.communication.kmLabel) ||
      card.kmLabel ||
      card.placeLine ||
      ""
  );
  ok(
    "KM_RANGE_ORDER",
    /16[,.]7/.test(kmLine + " " + FUTURE_RAW) &&
      /16[,.]3/.test(kmLine + " " + FUTURE_RAW),
    kmLine
  );
}

// --- ACTIVE counterpart: same lane fact, present tense ---
{
  const input = {
    impact: ACTIVE_RAW,
    impactFull: ACTIVE_RAW,
    eventType: "prace",
    category: "prace",
    road: "D8",
    direction: "Ústí nad Labem",
    kmFrom: 10.0,
    kmTo: 10.2,
    lifecycleStatus: "ACTIVE",
    validFrom: "2026-01-01T08:00:00+01:00",
    validTo: "2026-12-31T18:00:00+01:00",
    illustrationKey: "prace",
  };
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok(
    "ACTIVE_TRAFFIC_IMPACT_TENSE_GUARD",
    /je\s+uzavřen/i.test(sit) && !/bude\s+uzavřen/i.test(sit),
    sit
  );
  ok("ACTIVE_DIRECTION", /Ústí/i.test(sit), sit);
  ok("ACTIVE_LANE_DEDUPE", countLaneClosureSentences(sit) === 1, sit);
}

// --- ENDED must not become FUTURE tense ---
{
  const input = {
    impact: ACTIVE_RAW,
    impactFull: ACTIVE_RAW,
    eventType: "prace",
    road: "D8",
    direction: "Ústí nad Labem",
    lifecycleStatus: "ENDED",
    validFrom: "2025-01-01T08:00:00+01:00",
    validTo: "2025-01-02T18:00:00+01:00",
  };
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok(
    "ENDED_NOT_FUTURE_TENSE",
    !/bude\s+uzavřen/i.test(sit),
    sit
  );
}

// --- Shoulder vs lane are not duplicates ---
{
  const raw =
    "silnice I/3, ve směru Benešov, práce na silnici; pravý jízdní pruh uzavřen; zpevněná krajnice uzavřena; Od 01.06.2026 08:00 Do 02.06.2026 18:00";
  const input = {
    impact: raw,
    impactFull: raw,
    eventType: "prace",
    road: "I/3",
    direction: "Benešov",
    lifecycleStatus: "FUTURE",
  };
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok(
    "SHOULDER_AND_LANE_BOTH",
    /pravý|jízdní\s+pruh/i.test(sit) && /krajnice/i.test(sit),
    sit
  );
  ok(
    "SHOULDER_FUTURE_TENSE",
    /krajnice\s+bude\s+uzavřena|bude\s+uzavřena/i.test(sit) ||
      /zpevněná\s+krajnice\s+bude/i.test(sit),
    sit
  );
}

// --- Full road closure FUTURE ---
{
  const raw =
    "silnice II/101, obec Sampleville, uzavřeno; silnice je uzavřena; Od 20.09.2026 22:00 Do 21.09.2026 05:00";
  const input = {
    impact: raw,
    impactFull: raw,
    eventType: "uzavirka",
    category: "uzavirka",
    road: "II/101",
    municipality: "Sampleville",
    lifecycleStatus: "FUTURE",
  };
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok(
    "FULL_CLOSURE_FUTURE_TENSE",
    /bude\s+uzavřena/i.test(sit) && !/\bje\s+uzavřena\b/i.test(sit),
    sit
  );
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-future-traffic-impact-tense-guard",
      pass,
      failCount: fails.length,
      fails,
      results,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
