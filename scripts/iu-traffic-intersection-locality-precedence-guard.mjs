#!/usr/bin/env node
/**
 * EXPLICIT_INTERSECTION_PRECEDENCE + municipality enrichment guards.
 *
 * Source intersection "StreetA x StreetB" must not be overwritten by weaker
 * TMC/locality segment labels ("NameA – NameB"). Municipality must not be
 * invented from street morphology alone.
 */
import {
  parseOfficialCommentFacts,
  extractStreetIntersectionFromOfficialComment,
  parseTmcStyleLocationRange,
  buildLocalityHeaderModel,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  ACCIDENT_PARTICIPANT,
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

const IMPACT =
  "Kolbenova x Poštovská, , Od 19.08.2026 00:00, Do 19.08.2026 23:59, , zábor pravého/parkovacího pruhu ve směru z centra, zpětné osazení 6 ks Z4d";

const TMC_LOC = "Na černé strouze – Freyova";

// --- Explicit intersection extraction ---
{
  const ix = extractStreetIntersectionFromOfficialComment(IMPACT);
  ok("INTERSECTION_EXTRACTED", !!(ix && ix.street1 === "Kolbenova" && ix.street2 === "Poštovská"), JSON.stringify(ix));
  const facts = parseOfficialCommentFacts(IMPACT);
  ok("INTERSECTION_STRUCTURED", facts.streetIntersection === true, String(facts.streetIntersection));
  ok("INTERSECTION_STREETS", facts.intersectionStreet1 === "Kolbenova" && facts.intersectionStreet2 === "Poštovská");
  ok("LOCATION_KIND_INTERSECTION", facts.locationKind === "INTERSECTION", facts.locationKind);
}

// --- TMC range detection (secondary, not primary header) ---
{
  const range = parseTmcStyleLocationRange(TMC_LOC);
  ok("LOCATION_RANGE_DETECTED", !!(range && range.locationFrom && range.locationTo), JSON.stringify(range));
  ok("LOCATION_FROM", range && range.locationFrom === "Na černé strouze", range && range.locationFrom);
  ok("LOCATION_TO", range && range.locationTo === "Freyova", range && range.locationTo);
}

// --- Precedence: intersection beats TMC locality ---
{
  const input = {
    impact: IMPACT,
    impactFull: IMPACT,
    eventType: "omezeni",
    lifecycleStatus: "FUTURE",
    location: TMC_LOC,
    municipality: null,
  };
  const hdr = buildLocalityHeaderModel(input);
  const card = buildTrafficCardPresentation(input);
  const place = String(card.placeLine || "");
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok(
    "EXPLICIT_INTERSECTION_PRECEDENCE_GUARD",
    hdr.besideLocality === "Kolbenova × Poštovská" &&
      !/černé\s+strouze/i.test(String(hdr.besideLocality || "")) &&
      /Kolbenova\s*×\s*Poštovská/i.test(place) &&
      !/černé\s+strouze/i.test(place),
    JSON.stringify({ beside: hdr.besideLocality, place })
  );
  ok("DIRECTION_AFTER", /z\s+centra/i.test(place) || hdr.besideLocality != null);
  ok(
    "EMPTY_COMMA_SANITIZED",
    !/,\s*,/.test(sit) && /zábor/i.test(sit),
    sit
  );
  ok("FUTURE_ZABOR_TENSE", /Bude\s+zábor/i.test(sit), sit);
  ok("NO_INVENTED_PRAHA", hdr.municipalitySignLabel == null, hdr.municipalitySignLabel);
}

// --- Municipality enrichment when structured Praha present ---
{
  const input = {
    impact: IMPACT,
    impactFull: IMPACT,
    eventType: "omezeni",
    lifecycleStatus: "FUTURE",
    location: TMC_LOC,
    municipality: "Praha",
  };
  const hdr = buildLocalityHeaderModel(input);
  ok(
    "MUNICIPALITY_ENRICHMENT_GUARD_POSITIVE",
    hdr.municipalitySignLabel === "PRAHA" &&
      hdr.besideLocality === "Kolbenova × Poštovská",
    JSON.stringify({ sign: hdr.municipalitySignLabel, beside: hdr.besideLocality })
  );
}

// --- Negative: streets alone must not invent Praha ---
{
  const input = {
    impact: "Sampleova x Otherovská, zábor pravého pruhu",
    impactFull: "Sampleova x Otherovská, zábor pravého pruhu",
    eventType: "omezeni",
    location: "Alpha – Beta",
    municipality: null,
  };
  const hdr = buildLocalityHeaderModel(input);
  ok(
    "MUNICIPALITY_ENRICHMENT_GUARD_NEGATIVE",
    hdr.municipalitySignLabel == null &&
      /Sampleova\s*×\s*Otherovská/i.test(String(hdr.besideLocality || "")),
    JSON.stringify(hdr)
  );
}

// --- Vehicle pair must NOT become street intersection ---
{
  const ix = extractStreetIntersectionFromOfficialComment(
    "nehoda; OA x MOTO; probíhá vyšetřování nehody"
  );
  ok("NO_VEHICLE_PAIR_AS_INTERSECTION", ix == null, JSON.stringify(ix));
  const facts = parseOfficialCommentFacts(
    "nehoda; OA x MOTO; probíhá vyšetřování nehody"
  );
  ok(
    "VEHICLE_PAIR_STILL_PARTICIPANTS",
    (facts.accidentParticipants || []).includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR) &&
      (facts.accidentParticipants || []).includes(ACCIDENT_PARTICIPANT.MOTORCYCLE),
    JSON.stringify(facts.accidentParticipants)
  );
}

// --- Praha + ordinary street still uses ulice: ---
{
  const input = {
    impact: "ulice Jandova, Praha, uzavírka",
    impactFull: "ulice Jandova, Praha, uzavírka",
    eventType: "uzavirka",
    street: "Jandova",
    municipality: "Praha",
  };
  const hdr = buildLocalityHeaderModel(input);
  ok("JANDOVA_PRAHA_SIGN", hdr.municipalitySignLabel === "PRAHA");
  ok(
    "JANDOVA_ULICE_PREFIX",
    /^ulice:\s*Jandova$/i.test(String(hdr.besideLocality || "")),
    hdr.besideLocality
  );
}

// --- Jižní spojka SMV ---
{
  const input = {
    street: "Jižní spojka",
    municipality: "Praha",
    impact:
      "ulice Jižní spojka, Praha, Od 14.08.2026 15:00, Pozor! Olej na vozovce; sjízdné se zvýšenou opatrností",
    impactFull:
      "ulice Jižní spojka, Praha, Od 14.08.2026 15:00, Pozor! Olej na vozovce; sjízdné se zvýšenou opatrností",
  };
  const hdr = buildLocalityHeaderModel(input);
  ok("SMV_BESIDE_PLAIN", hdr.besideLocality === "Jižní spojka", hdr.besideLocality);
  ok("SMV_PRAHA_SIGN", hdr.municipalitySignLabel === "PRAHA");
}

// --- u obce relation ---
{
  const near =
    "Od 14.8.2026 18:00 do 19:00; na silnici 263 u obce Horní Police okres Česká Lípa; nehoda; probíhá vyšetřování nehody; havárie OA.";
  const facts = parseOfficialCommentFacts(near);
  const hdr = buildLocalityHeaderModel({
    impact: near,
    impactFull: near,
    eventType: "nehoda",
    road: "II/263",
    municipality: "Horní Police",
    district: "Česká Lípa",
  });
  ok("U_OBCE_RELATION", facts.municipalityRelation === "u_obce", facts.municipalityRelation);
  ok("U_OBCE_PREFIX", hdr.nearMunicipalityPrefix === "u obce", hdr.nearMunicipalityPrefix);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-intersection-locality-precedence-guard",
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
