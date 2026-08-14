#!/usr/bin/env node
/**
 * EXIT / sjezd / nájezd tokenization + relation guard (general rules).
 * - Glued D5EXIT34 variants must share meaning with spaced forms.
 * - on vs near must not be upgraded.
 * - entrance vs exit must not be confused with mainline-only place.
 * Pure local, no network.
 */
import {
  normalizeTrafficTextForParsing,
  extractExitAndRampFacts,
  parseOfficialCommentFacts,
  buildPlaceAndDirectionLine,
  buildTrafficCardPresentation,
  resolvePresentationRoadNumber,
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

function rowMap(card) {
  return Object.fromEntries(((card.expanded && card.expanded.rows) || []).map((r) => [r.key, r.value]));
}

// --- EXIT_TOKENIZATION_GUARD ---
{
  const variants = ["D5EXIT34 směr Německo", "D5EXIT 34 směr Německo", "D5 EXIT34 směr Německo", "D5 EXIT 34 směr Německo"];
  const norms = variants.map((v) => normalizeTrafficTextForParsing(v));
  ok(
    "EXIT_TOKENIZATION_norm_consistent",
    norms.every((n) => /D5\s+EXIT\s+34/i.test(n)),
    norms.join(" | ")
  );
  const factsList = variants.map((v) => parseOfficialCommentFacts(v));
  for (let i = 0; i < factsList.length; i++) {
    const f = factsList[i];
    ok("EXIT_TOKENIZATION_exitNumber_" + i, f.exitNumber === "34", f.exitNumber);
    ok("EXIT_TOKENIZATION_exitRoad_" + i, f.exitRoad === "D5" || f.roadNumber === "D5", f.exitRoad + "/" + f.roadNumber);
    ok("EXIT_TOKENIZATION_rampType_exit_" + i, f.rampType === "exit", f.rampType);
  }
  const places = variants.map((v) =>
    buildPlaceAndDirectionLine({ impactFull: v, direction: "Německo" })
  );
  for (let i = 0; i < places.length; i++) {
    ok("EXIT_LOCATION_place_has_D5_" + i, /\bD5\b/.test(places[i]), places[i]);
    ok("EXIT_LOCATION_place_has_exit34_" + i, /exit\s+34/i.test(places[i]), places[i]);
    ok("EXIT_LOCATION_place_has_dir_" + i, /směr\s+Německo/i.test(places[i]), places[i]);
  }
  // Raw source must remain ungutted when stored as impactFull on expanded card.
  {
    const raw = "D5EXIT34 směr Německo";
    const card = buildTrafficCardPresentation({ impactFull: raw, road: "D5", direction: "Německo" });
    const src = (card.expanded && card.expanded.sourceFull) || "";
    ok("RAW_SOURCE_PRESERVATION_glued_exit", /D5EXIT34/.test(src), src);
  }
}

// --- ON vs NEAR exit ramp ---
{
  const on = extractExitAndRampFacts("na sjezdu z D1 ve směru Ostrava");
  ok("ON_EXIT_RAMP_type", on.rampType === "exit", on.rampType);
  ok("ON_EXIT_RAMP_relation", on.rampRelation === "on", on.rampRelation);
  ok("ON_EXIT_RAMP_sourceRoad", on.rampSourceRoad === "D1", on.rampSourceRoad);
  ok("ON_EXIT_RAMP_label", /na sjezdu/i.test(on.labelCs || ""), on.labelCs);

  const near = extractExitAndRampFacts("u sjezdu z D1 ve směru Ostrava");
  ok("NEAR_EXIT_RAMP_type", near.rampType === "exit", near.rampType);
  ok("NEAR_EXIT_RAMP_relation", near.rampRelation === "near", near.rampRelation);
  ok("NEAR_EXIT_RAMP_sourceRoad", near.rampSourceRoad === "D1", near.rampSourceRoad);
  ok("NEAR_EXIT_RAMP_not_on", near.rampRelation !== "on", near.rampRelation);
  ok("NEAR_EXIT_RAMP_label", /u sjezdu/i.test(near.labelCs || ""), near.labelCs);

  const placeOn = buildPlaceAndDirectionLine({
    impactFull: "na sjezdu z D1 ve směru Ostrava",
    road: "D1",
    direction: "Ostrava",
  });
  ok("ON_EXIT_place", /na sjezdu/i.test(placeOn), placeOn);
  ok("ON_EXIT_place_no_near", !/u sjezdu/i.test(placeOn), placeOn);

  const placeNear = buildPlaceAndDirectionLine({
    impactFull: "u sjezdu z D1 ve směru Ostrava",
    road: "D1",
    direction: "Ostrava",
  });
  ok("NEAR_EXIT_place", /u sjezdu/i.test(placeNear), placeNear);
  ok("NEAR_EXIT_place_no_on", !/na sjezdu/i.test(placeNear), placeNear);
}

// --- Entrance ramp ---
{
  const on = extractExitAndRampFacts("na nájezdu na D1 směr Praha");
  ok("ON_ENTRANCE_type", on.rampType === "entrance", on.rampType);
  ok("ON_ENTRANCE_relation", on.rampRelation === "on", on.rampRelation);
  ok("ON_ENTRANCE_targetRoad", on.rampTargetRoad === "D1", on.rampTargetRoad);

  const near = extractExitAndRampFacts("u nájezdu na D1");
  ok("NEAR_ENTRANCE_type", near.rampType === "entrance", near.rampType);
  ok("NEAR_ENTRANCE_relation", near.rampRelation === "near", near.rampRelation);
  ok("NEAR_ENTRANCE_not_on", near.rampRelation !== "on", near.rampRelation);

  const placeNear = buildPlaceAndDirectionLine({
    impactFull: "u nájezdu na D1",
    road: "D1",
  });
  ok("NEAR_ENTRANCE_place_u", /u nájezdu/i.test(placeNear), placeNear);
  ok("NEAR_ENTRANCE_place_not_na", !/na nájezdu/i.test(placeNear), placeNear);
}

// --- EXIT vs RAMP / mainline confusion ---
{
  const f = parseOfficialCommentFacts("D5 EXIT 34 směr Německo");
  ok("EXIT_VS_RAMP_not_municipality", f.city == null || f.city === "", f.city);
  ok("EXIT_VS_RAMP_exitNumber", f.exitNumber === "34", f.exitNumber);
  const road = resolvePresentationRoadNumber({ impactFull: "D5EXIT34 směr Německo" }, f);
  ok("RAMP_MAINLINE_CONFUSION_road_D5", road === "D5", road);
  ok("RAMP_MAINLINE_CONFUSION_not_exit_as_road", road !== "34" && road !== "EXIT34", road);
}

// --- Direction preservation ---
{
  const place = buildPlaceAndDirectionLine({
    impactFull: "D5 EXIT 34",
    road: "D5",
    direction: "Německo",
  });
  ok("RAMP_DIRECTION_PRESERVATION", /směr\s+Německo/i.test(place), place);
}

// --- Expanded consistency ---
{
  const card = buildTrafficCardPresentation({
    impactFull: "D5EXIT34 směr Německo, nehoda",
    road: "D5",
    direction: "Německo",
    eventType: "nehoda",
  });
  const rows = rowMap(card);
  ok("COLLAPSED_has_exit", /exit\s+34/i.test(card.placeLine || ""), card.placeLine);
  ok("EXPANDED_exit_row", rows.exitNumber === "34", rows.exitNumber);
  ok("IDEMPOTENCE_parse", (() => {
    const a = JSON.stringify(parseOfficialCommentFacts("D5EXIT34 směr Německo"));
    const b = JSON.stringify(parseOfficialCommentFacts("D5EXIT34 směr Německo"));
    return a === b;
  })());
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-exit-ramp-tokenize",
      pass,
      EXIT_TOKENIZATION_PASS: results.filter((r) => r.id.startsWith("EXIT_TOKENIZATION") && r.pass).length > 0 &&
        !fails.some((f) => f.startsWith("EXIT_TOKENIZATION")),
      EXIT_LOCATION_PASS: !fails.some((f) => f.startsWith("EXIT_LOCATION")),
      ON_EXIT_RAMP_VS_NEAR_EXIT_RAMP_PASS: !fails.some((f) => /ON_EXIT|NEAR_EXIT/.test(f)),
      ON_ENTRANCE_RAMP_VS_NEAR_ENTRANCE_RAMP_PASS: !fails.some((f) => /ON_ENTRANCE|NEAR_ENTRANCE/.test(f)),
      RAMP_MAINLINE_CONFUSION_PASS: !fails.some((f) => f.startsWith("RAMP_MAINLINE")),
      RAMP_DIRECTION_PRESERVATION_PASS: !fails.some((f) => f.startsWith("RAMP_DIRECTION")),
      failCount: fails.length,
      fails,
    },
    null,
    2
  )
);
if (!pass) process.exit(1);
console.log("IU_TRAFFIC_EXIT_RAMP_TOKENIZE_GUARD_PASS");
