#!/usr/bin/env node
/**
 * Traffic fact-preservation guard — direction sanity, no truncated fragments,
 * locality dedup, road class, km, railway crossing, collapsed information value,
 * RAW source preservation. Semantic facts over hard-coded sentence style.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  buildLocalityHeaderModel,
  normalizeDirectionHuman,
  looksLikeTruncatedFragment,
  preferClassedRoadNumber,
  resolvePresentationRoadNumber,
  buildTrafficSituationSummary,
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
  const rows = (card.expanded && card.expanded.rows) || [];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const MOS_RAW =
  "ulice Moskevská, mezi křižovatkami ulic K topírně a Svahová, Praha 10, Praha, stavební práce, kyvadlový provoz, od 17.8.2026 00:00 do 31.8.2026 23:59, částečná uzavírka ul. Moskevská (etapa 2): od zastávky MHD Vršovický hřbitov – směr Bohdalec až ke křižovatce s ul. K Topírně uzavřen západní jízdní pruh ul. Moskevská; od zastávky MHD Vršovický hřbitov – směr Koh-i-noor až ke křižovatce s ul. K Topírně veden provoz ve směru na Bohdalec východním jízdním pruhem vozovky a provoz ve směru na Koh-i-noor veden parkovacím pruhem před objekty Moskevská č. 1523/63 a č. 1543/65a - zachován obousměrný provoz., Vydal: ÚMČ Praha 10";

// --- TRAFFIC_DIRECTION_SANITY_GUARD ---
{
  const good = [
    ["směr Brno", "Brno"],
    ["směr Ostrava", "Ostrava"],
    ["směr Frýdek-Místek", "Frýdek-Místek"],
    ["směr Ruzyně - D7", "Ruzyně - D7"],
    ["směr Bohdalec", "Bohdalec"],
    ["směr Koh-i-noor", "Koh-i-noor"],
    ["ve směru do centra", "do centra"],
    ["směr vlevo", "vlevo"],
  ];
  for (const [raw, want] of good) {
    ok("DIR_OK_" + want, normalizeDirectionHuman(raw) === want, normalizeDirectionHuman(raw));
  }
  const overflow =
    "na Bohdalec východním jízdním pruhem vozovky a provoz ve smě";
  ok("DIR_OVERFLOW_NULL", normalizeDirectionHuman(overflow) == null, normalizeDirectionHuman(overflow));
  ok("DIR_TRUNC_VE_SME", looksLikeTruncatedFragment("provoz ve smě") === true);
  ok("DIR_TRUNC_RAMC", looksLikeTruncatedFragment("prací v rámc") === true);

  const mosFacts = parseOfficialCommentFacts(MOS_RAW);
  ok("MOS_DIR_NULL", mosFacts.directionHuman == null, mosFacts.directionHuman);
  const mosCard = buildTrafficCardPresentation({
    impact: MOS_RAW,
    impactFull: MOS_RAW,
    location: "Moskevská",
    municipality: "Praha 10",
    eventType: "prace",
  });
  ok("MOS_CARD_DIR_NULL", mosCard.communication.direction == null, mosCard.communication.direction);
  ok(
    "MOS_NO_OVERFLOW_IN_UI",
    !/východním jízdním pruhem|provoz ve smě/i.test(
      String(mosCard.communication.direction || "") + String(mosCard.placeLine || "")
    )
  );
}

// --- TRAFFIC_NO_TRUNCATED_STRUCTURED_FIELDS_GUARD ---
{
  const samples = [
    "ve smě",
    "v rámc",
    "na sil",
    "Rokycanská)",
    "na Bohdalec východním jízdním pruhem vozovky a provoz ve smě",
  ];
  for (const s of samples) {
    const n = normalizeDirectionHuman(s);
    ok(
      "NO_TRUNC_DIR_" + s.slice(0, 12),
      n == null || (!looksLikeTruncatedFragment(n) && !/\)$/.test(n)),
      n
    );
  }
}

// --- TRAFFIC_LOCATION_DEDUP_GUARD ---
{
  const card = buildTrafficCardPresentation({
    impact: MOS_RAW,
    impactFull: MOS_RAW,
    location: "Moskevská",
    municipality: "Praha 10",
    eventType: "prace",
  });
  const rows = rowMap(card);
  ok("DEDUP_STREET", rows.street === "Moskevská", rows.street);
  ok("DEDUP_MUNI", rows.municipality === "Praha", rows.municipality);
  ok("DEDUP_PART", rows.cityPart === "Praha 10", rows.cityPart);
  ok("DEDUP_NO_LOCALITY_ECHO", rows.location == null, rows.location);

  const distinct = buildTrafficCardPresentation({
    impact: "ulice Moskevská, Vršovice, Praha",
    impactFull: "ulice Moskevská, Vršovice, Praha, stavební práce",
    location: "Vršovice",
    municipality: "Praha",
    eventType: "prace",
  });
  const drows = rowMap(distinct);
  ok(
    "DEDUP_KEEP_DISTINCT_LOCALITY",
    drows.location === "Vršovice" || drows.street === "Moskevská",
    JSON.stringify({ loc: drows.location, street: drows.street })
  );
}

// --- TRAFFIC_ROAD_CLASS_PRESERVATION_GUARD ---
{
  ok("ROAD_NO_BARE_I26", preferClassedRoadNumber("26", "I/26") === "I/26");
  ok("ROAD_NO_BARE_I38", preferClassedRoadNumber("38", "I/38") === "I/38");
  ok("ROAD_NO_BARE_II171", preferClassedRoadNumber("171", "II/171") === "II/171");
  ok("ROAD_NO_BARE_II387", preferClassedRoadNumber("387", "II/387") === "II/387");
  const cases = [
    { road: "D1", impact: "D1, km 12, směr Brno, práce na silnici", want: /^D1$/ },
    { road: "D0", impact: "D0, km 1, směr Brno, práce na silnici", want: /^D0$/ },
    { road: "26", impact: "silnice I/26, km 12, práce na silnici", want: /^I\/26$/ },
    { road: "171", impact: "silnice II/171, km 3, práce na silnici", want: /^II\/171$/ },
    { road: "387", impact: "silnice II/387, km 3, práce na silnici", want: /^II\/387$/ },
  ];
  for (const c of cases) {
    const card = buildTrafficCardPresentation({
      impact: c.impact,
      impactFull: c.impact,
      road: c.road,
      eventType: "prace",
    });
    const shown = card.communication.roadPresentation.road;
    ok("ROAD_SHOWN_" + c.road, c.want.test(String(shown || "")), shown);
  }
}

// --- TRAFFIC_KM_PRESERVATION_GUARD (spot) ---
{
  const card = buildTrafficCardPresentation({
    impact: "D1, km 98,3–99, směr Brno, nehoda",
    impactFull: "D1, km 98,3–99, směr Brno, nehoda dvou osobních automobilů",
    road: "D1",
    eventType: "nehoda",
  });
  ok("KM_IN_PLACE", /km\s*98/i.test(card.placeLine || ""), card.placeLine);
  ok("KM_DIR", /Brno/i.test(card.placeLine || "") || card.communication.direction === "Brno", card.placeLine);
}

// --- TRAFFIC_RAILWAY_CROSSING_FACT_PRESERVATION_GUARD ---
{
  const raw =
    "ulice Havlíčkova, Frýdlant nad Ostravicí, okr. Frýdek-Místek, úplná uzavírka železničního přejezdu P7454 na místní komunikaci";
  const sum = buildTrafficSituationSummary({
    impact: raw,
    impactFull: raw,
    eventType: "uzavirka",
  });
  ok("RX_SUMMARY", /železničního přejezdu P7454/i.test(sum), sum);
  ok("RX_NOT_GENERIC", !/^Úplná\s+uzavírka\s+komunikace\.?$/i.test(sum), sum);
}

// --- TRAFFIC_EVENT_FACT_PRESERVATION_GUARD / COLLAPSED_INFORMATION_VALUE ---
{
  // A) accident two cars
  {
    const raw = "nehoda; 2 havarovaná vozidla; 2 osobní automobily; pravý jízdní pruh uzavřen";
    const sum = buildTrafficSituationSummary({ impact: raw, impactFull: raw, eventType: "nehoda" });
    ok("ACC_TWO_CARS", /osobní|automobil/i.test(sum), sum);
  }
  // B) broken truck + hard shoulder
  {
    const raw =
      "porucha NA, nákladní vozidlo, zpevněná krajnice je neprůjezdná, průjezd se zvýšenou opatrností";
    const sum = buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "porucha",
    });
    ok("BROKEN_TRUCK", /nákladní/i.test(sum), sum);
    ok("HARD_SHOULDER", /krajnice|odstavn/i.test(sum), sum);
  }
  // C) obstacle + spilled + slippery + slow
  {
    const raw =
      "překážka na vozovce, rozsypaný náklad – obilí, vozovka je kluzká, pomalý provoz";
    const sum = buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prekazka",
    });
    ok("OBS_NOT_ONLY_QUEUE", !/^Kolona\.?$/i.test(sum.trim()), sum);
    ok("OBS_SPILL_OR_SLIP", /rozsypan|kluzk|překážk/i.test(sum), sum);
  }
  // E) Moskevská information value
  {
    const sum = String(
      buildTrafficCardPresentation({
        impact: MOS_RAW,
        impactFull: MOS_RAW,
        location: "Moskevská",
        municipality: "Praha 10",
        eventType: "prace",
      }).situationSummary || ""
    );
    ok("MOS_NOT_SHORT_ONLY", !/^Stavební práce\.\s*Kyvadlový provoz\.?$/i.test(sum.trim()), sum);
    ok("MOS_HAS_PARTIAL", /částečn/i.test(sum), sum);
    ok("MOS_HAS_WEST_LANE", /západní/i.test(sum), sum);
    ok("MOS_HAS_BOHDALEC_ROUTE", /Bohdalec/i.test(sum), sum);
    ok("MOS_HAS_KOH_ROUTE", /Koh-i-noor/i.test(sum), sum);
    ok("MOS_HAS_BIDIR", /obousměrný/i.test(sum), sum);
    ok("MOS_COMPLETE_SENTENCES", /[.!?]\s*$/.test(sum.trim()), sum);
    ok("MOS_NO_VYDAL", !/Vydal:/i.test(sum), sum);
  }
  // F) concrete work type
  {
    const raw = "práce na silnici, výsprava tryskovou metodou, pravý jízdní pruh uzavřen";
    const sum = buildTrafficSituationSummary({ impact: raw, impactFull: raw, eventType: "prace" });
    ok("WORK_TYPE_JET", /výsprava|tryskov/i.test(sum), sum);
    ok("WORK_NOT_ONLY_GENERIC", !/^Práce na silnici\.?$/i.test(sum.trim()), sum);
  }
  // G) tunnel + maintenance reason
  {
    const raw = "Tunel je uzavřen. Pravidelná údržba.";
    const sum = buildTrafficSituationSummary({ impact: raw, impactFull: raw, eventType: "uzavirka" });
    ok("TUNNEL_CLOSED", /tunel/i.test(sum), sum);
    ok("TUNNEL_MAINT", /údržba|pravideln/i.test(sum), sum);
  }
}

// --- TRAFFIC_RAW_SOURCE_PRESERVATION_GUARD ---
{
  const card = buildTrafficCardPresentation({
    impact: MOS_RAW,
    impactFull: MOS_RAW,
    location: "Moskevská",
    municipality: "Praha 10",
    eventType: "prace",
  });
  const rows = rowMap(card);
  ok("RAW_PRESENT", /Vydal:\s*ÚMČ Praha 10/i.test(rows.sourceDescription || ""), rows.sourceDescription);
  ok("RAW_UNCHANGED_STREET", /ulice Moskevská/i.test(rows.sourceDescription || ""));
}

// --- Header municipality sign ---
{
  const hdr = buildLocalityHeaderModel({
    impact: MOS_RAW,
    impactFull: MOS_RAW,
    municipality: "Praha 10",
  });
  ok("MOS_MUNI_SIGN", hdr.municipalitySignLabel === "PRAHA", hdr.municipalitySignLabel);
  ok("MOS_STREET_HEADER", hdr.street === "Moskevská", hdr.street);
}

const pass = fails.length === 0;
const out = {
  pass,
  failed: fails,
  counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
  TRAFFIC_DIRECTION_SANITY_GUARD: results.filter((r) => r.id.startsWith("DIR_") || r.id.startsWith("MOS_DIR")).every((r) => r.pass),
  TRAFFIC_NO_TRUNCATED_STRUCTURED_FIELDS_GUARD: results.filter((r) => r.id.startsWith("NO_TRUNC")).every((r) => r.pass),
  TRAFFIC_LOCATION_DEDUP_GUARD: results.filter((r) => r.id.startsWith("DEDUP")).every((r) => r.pass),
  TRAFFIC_ROAD_CLASS_PRESERVATION_GUARD: results.filter((r) => r.id.startsWith("ROAD_")).every((r) => r.pass),
  TRAFFIC_KM_PRESERVATION_GUARD: results.filter((r) => r.id.startsWith("KM_")).every((r) => r.pass),
  TRAFFIC_RAILWAY_CROSSING_FACT_PRESERVATION_GUARD: results.filter((r) => r.id.startsWith("RX_")).every((r) => r.pass),
  TRAFFIC_EVENT_FACT_PRESERVATION_GUARD: results.filter((r) => /^(ACC_|BROKEN_|OBS_|WORK_|TUNNEL_|MOS_HAS|MOS_NOT)/.test(r.id)).every((r) => r.pass),
  TRAFFIC_COLLAPSED_INFORMATION_VALUE_GUARD: results.filter((r) => r.id.startsWith("MOS_")).every((r) => r.pass),
  TRAFFIC_RAW_SOURCE_PRESERVATION_GUARD: results.filter((r) => r.id.startsWith("RAW_")).every((r) => r.pass),
};
console.log(JSON.stringify(out, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_FACT_PRESERVATION_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_FACT_PRESERVATION_GUARD_PASS");
