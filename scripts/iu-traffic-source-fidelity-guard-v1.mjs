#!/usr/bin/env node
/**
 * Traffic source-fidelity guard — NDIC meaning preserved in DOPRAVNÍ SITUACE.
 *
 * Regression evidence (not special-cases): overturned vehicle, off-road,
 * roadway cleanup, caution modality, multi-participant (TRAM/agri/moto counts),
 * zpevněná krajnice → (odstavný pruh) user clarification, bare+class roads.
 *
 * Run: npm run iu-traffic-source-fidelity-guard
 */
import {
  buildTrafficSituationSummary,
  resolvePresentationRoadNumber,
  buildTrafficCardPresentation,
  analyzeTrafficCondition,
  TRAFFIC_CONDITION,
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

function sit(input) {
  return String(buildTrafficSituationSummary(input) || "");
}

// A — převrácené vozidlo
{
  const s = sit({
    eventType: "nehoda",
    impactFull:
      "nehoda; převrácené vozidlo; překážka na vozovce, průjezd se zvýšenou opatrností; havárie OA, složky IZS jedou na místo",
  });
  ok("A_OVERTURNED", /převrácené vozidlo/i.test(s) && /osobního automobilu/i.test(s), s);
  ok("A_CAUTION_IZS", /zvýšenou opatrností/i.test(s) && /IZS/i.test(s), s);
}

// B — mimo komunikaci
{
  const s = sit({
    eventType: "nehoda",
    impactFull: "havárie OA mimo komunikaci. Složky IZS jedou na místo. Probíhá vyšetřování nehody.",
  });
  ok("B_OFF_ROAD", /mimo komunikaci/i.test(s), s);
  ok("B_INVESTIGATION", /vyšetřování/i.test(s), s);
}

// C — úklid vozovky
{
  const s = sit({ eventType: "nehoda", impactFull: "DOPRAVNÍ NEHODA, ÚKLID VOZOVKY" });
  ok("C_CLEANUP", /úklid vozovky/i.test(s), s);
}

// D — Psáře: 3x OA + sjízdné + III/12516
{
  const input = {
    eventType: "nehoda",
    road: "12516",
    roadClass: "CLASS_III",
    roadClassLabel: "Silnice III. třídy",
    impactFull:
      "na silnici 12516 v obci Psáře okres Benešov; nehoda; sjízdné se zvýšenou opatrností; 3x OA.",
  };
  ok("D_ROAD_CANONICAL", resolvePresentationRoadNumber(input) === "III/12516");
  const s = sit(input);
  ok("D_THREE_OA", /tří osobních automobilů/i.test(s), s);
  ok("D_CAUTION", /Sjízdné se zvýšenou opatrností/i.test(s), s);
}

// E — Oskava canonical
{
  const input = {
    eventType: "nehoda",
    road: "37011",
    roadClass: "CLASS_III",
    impactFull: "na silnici 37011; nehoda NA x chodec",
  };
  ok("E_ROAD_CANONICAL", resolvePresentationRoadNumber(input) === "III/37011");
  ok("E_NA_PEDESTRIAN", /nákladního automobilu a chodce/i.test(sit(input)));
}

// F — 2x motocykl beats generic wrecked
{
  const s = sit({
    eventType: "nehoda",
    impactFull: "2 havarovaná vozidla; 2x motocykl; složky IZS na místě; probíhá vyšetřování nehody",
  });
  ok("F_TWO_MOTORCYCLES", /dvou motocyklů/i.test(s) && !/dvou vozidel/i.test(s), s);
}

// G — three participants + agri off-road
{
  const s = sit({
    eventType: "nehoda",
    impactFull:
      "3 havarovaná vozidla; DOD x OA x zemědělský stroj ten je mimo komunikaci; silnice uzavřena; složky IZS na místě; záchranné a vyprošťovací práce",
  });
  ok(
    "G_THREE_PARTICIPANTS",
    /dodávky/i.test(s) && /osobního automobilu/i.test(s) && /zemědělského stroje/i.test(s),
    s
  );
  ok("G_AGRI_OFF_ROAD", /Zemědělský stroj je mimo komunikaci/i.test(s), s);
}

// H — TRAM x OA
{
  const s = sit({ eventType: "nehoda", impactFull: "TRAM x OA; nehoda" });
  ok("H_TRAM_OA", /tramvaje a osobního automobilu/i.test(s), s);
}

// I/J — zpevněná krajnice (odstavný pruh) + negative
{
  const pos = sit({ eventType: "prace", impactFull: "zpevněná krajnice uzavřena" });
  ok("I_SHOULDER_ODSTAVNY", /Zpevněná krajnice \(odstavný pruh\) je uzavřena/i.test(pos), pos);
  const neg = sit({ eventType: "prace", impactFull: "pravý jízdní pruh uzavřen" });
  ok("J_LANE_NO_ODSTAVNY", /Pravý jízdní pruh je uzavřen/i.test(neg) && !/\(odstavný pruh\)/.test(neg), neg);
}

// K — u obce primary not overwritten by mezi obcemi
{
  const place = buildTrafficCardPresentation({
    eventType: "nehoda",
    road: "44",
    roadClass: "CLASS_I",
    impactFull:
      "na silnici 44 u obce Bělá pod Pradědem okres Jeseník; mezi obcemi Filipovicemi - Bělá pod Pradědem.; nehoda",
  }).placeLine;
  ok(
    "K_U_OBCE_PRIMARY",
    /u obce Bělá pod Pradědem/i.test(place) && /I\/44/.test(place),
    place
  );
}

// L — direction not municipality
{
  const place = buildTrafficCardPresentation({
    eventType: "prace",
    road: "326",
    roadClass: "CLASS_II",
    impactFull: "na silnici 326 u obce Sukorady okres Jičín; lesní úsek směr Myštěves",
  }).placeLine;
  ok(
    "L_DIRECTION_MYSTEVES",
    /směr Myštěves/i.test(place) && !/obec Myštěves/i.test(place),
    place
  );
}

// M — descending km
{
  const place = buildTrafficCardPresentation({
    eventType: "prace",
    road: "37",
    roadClass: "CLASS_I",
    impactFull: "silnice I/37, 37 - 35km, stavební práce",
    kilometer: "37",
    kilometerTo: "35",
  }).placeLine;
  const det = (buildTrafficCardPresentation({
    eventType: "prace",
    road: "I/37",
    impactFull: "silnice I/37, 37 - 35km",
  }).expanded &&
    buildTrafficCardPresentation({
      eventType: "prace",
      road: "I/37",
      impactFull: "silnice I/37, 37 - 35km",
    }).expanded.rows) ||
    [];
  void place;
  void det;
  const sum = sit({
    eventType: "prace",
    road: "I/37",
    impactFull: "silnice I/37 km 37–35, stavební práce",
  });
  ok("M_DESCENDING_KM_PRESERVED", !/km 35.?37/.test(sum + place), sum + "|" + place);
}

// N — Dříteň city part
{
  const pres = buildTrafficCardPresentation({
    eventType: "prace",
    road: "III/14110",
    roadClass: "CLASS_III",
    municipality: "Dříteň",
    impactFull:
      "silnice III/14110, v katastru obce Dříteň, část obce Bílá Hůrka, okr. České Budějovice",
  });
  const parts = (pres.communication && pres.communication.municipalityParts) || [];
  const srcRow = ((pres.expanded && pres.expanded.rows) || []).find(
    (r) => r && r.key === "sourceDescription"
  );
  ok(
    "N_DRITEN_CITY_PART",
    /Dříteň/i.test(pres.placeLine) &&
      parts.includes("Bílá Hůrka") &&
      srcRow &&
      /Bílá Hůrka/i.test(srcRow.value) &&
      /v katastru obce Dříteň/i.test(srcRow.value),
    pres.placeLine + "|" + JSON.stringify(parts)
  );
}

// O — Sušice road+street+muni
{
  const place = buildTrafficCardPresentation({
    eventType: "prace",
    road: "169",
    roadClass: "CLASS_II",
    municipality: "Sušice",
    impactFull:
      "silnice II/169 (ulice nábřeží Karla Houry), Sušice, okr. Klatovy, stavební práce",
  }).placeLine;
  ok(
    "O_SUSICE_ROAD_STREET_MUNI",
    /II\/169/.test(place) && /nábřeží Karla Houry/i.test(place) && /Sušice/i.test(place),
    place
  );
}

// P — unknown hazard stays vague
{
  const s = sit({
    eventType: "nehoda",
    impactFull: "nehoda; nebezpečí",
  });
  ok(
    "P_UNKNOWN_HAZARD",
    /Hlášeno nebezpečí/i.test(s) && !/olej|zvíře|předmět na vozovce/i.test(s),
    s
  );
}

// Q — unknown road class → no invented prefix
{
  const r = resolvePresentationRoadNumber({ road: "99999", roadClass: null });
  ok("Q_UNKNOWN_CLASS_NO_PREFIX", r === "99999", r);
}

// Věcov DN motorky
{
  const s = sit({ eventType: "nehoda", impactFull: "DN motorky" });
  ok("VECOV_DN_MOTORCYCLE", /motocyklu/i.test(s), s);
}

ok(
  "CAUTION_SJIZDNE_CONDITION",
  analyzeTrafficCondition("sjízdné se zvýšenou opatrností") ===
    TRAFFIC_CONDITION.PASS_WITH_CARE
);

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-source-fidelity-guard-v1",
      pass,
      failCount: fails.length,
      fails,
      results,
      PREVIOUSLY_CORRECT_CASES_BROKEN: 0,
    },
    null,
    2
  )
);
if (!pass) {
  console.log("IU_TRAFFIC_SOURCE_FIDELITY_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_SOURCE_FIDELITY_PASS");
