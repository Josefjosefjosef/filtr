#!/usr/bin/env node
/**
 * Localization edge-card regression guard — Moravany relations, mobilní street,
 * Tábor/OBJECT, weather I/42+I/35, D11 control, katastr, descending km.
 * Fixture-based, pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  buildLocalityHeaderModel,
  buildTrafficCardPresentation,
  buildPlaceAndDirectionLine,
  extractNamedTransportObject,
  extractParentheticalStreetNamesFromOfficialComment,
  extractBareClassedRoadNumbersFromOfficialComment,
  looksLikeStreetName,
  looksLikeWorksiteOrOperationalStreetNoise,
  LOCATION_KIND,
} from "../assets/iu-traffic-card-presenter-v1.js";
import { extractLocalityFromOfficialComment } from "../scripts/ndic-datex-v1/traffic-card-content-v1.mjs";
import { extractRoadNumberFromNdicComment } from "../scripts/ndic-datex-v1/official-comment-road.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

function base(extra) {
  return {
    publicEventId: "iu-te-" + "c".repeat(32),
    lifecycleStatus: "ACTIVE",
    preciseLocationVerified: true,
    source: "ŘSD/NDIC",
    ...extra,
  };
}

// --- A/B/C/D Moravany + katastr ---
{
  const U =
    "Od 1.1.2026 12:00 do 13:00; na silnici III/43230 u obce Moravany okres Hodonín; práce na silnici.";
  const V =
    "Od 1.1.2026 12:00 do 13:00; na silnici III/43230 v obci Moravany okres Hodonín; práce na silnici.";
  const K =
    "silnice III/1234, v katastru obce Nová Ves, okr. Sample, práce na silnici";

  const uFacts = parseOfficialCommentFacts(U);
  const vFacts = parseOfficialCommentFacts(V);
  const kFacts = parseOfficialCommentFacts(K);
  const uHdr = buildLocalityHeaderModel(base({ impact: U, impactFull: U, road: "III/43230", municipality: "Moravany", district: "Hodonín", eventType: "prace" }));
  const vHdr = buildLocalityHeaderModel(base({ impact: V, impactFull: V, road: "III/43230", municipality: "Moravany", district: "Hodonín", eventType: "prace" }));
  const kHdr = buildLocalityHeaderModel(base({ impact: K, impactFull: K, road: "III/1234", municipality: "Nová Ves", eventType: "prace" }));
  const uPlace = buildPlaceAndDirectionLine(base({ impact: U, impactFull: U, road: "III/43230", municipality: "Moravany", district: "Hodonín", eventType: "prace" }));
  const kPlace = buildPlaceAndDirectionLine(base({ impact: K, impactFull: K, road: "III/1234", municipality: "Nová Ves", eventType: "prace" }));

  ok("U_OBCE_RELATION", uFacts.municipalityRelation === "u_obce", uFacts.municipalityRelation);
  ok("V_OBCE_RELATION", vFacts.municipalityRelation === "v_obce", vFacts.municipalityRelation);
  ok("KATASTR_RELATION", kFacts.municipalityRelation === "v_katastru_obce", kFacts.municipalityRelation);
  ok("U_OBCE_PREFIX", uHdr.nearMunicipalityPrefix === "u obce", uHdr.nearMunicipalityPrefix);
  ok("V_OBCE_NO_PREFIX", vHdr.nearMunicipalityPrefix == null, String(vHdr.nearMunicipalityPrefix));
  ok("KATASTR_NO_U_OBCE", kHdr.nearMunicipalityPrefix == null && kFacts.municipalityRelation === "v_katastru_obce");
  ok("U_OBCE_PLACE", /u\s+obce\s+Moravany/i.test(uPlace) && !/\bv\s+obci\b/i.test(uPlace), uPlace);
  ok("KATASTR_NOT_U_OBCE_PLACE", !/u\s+obce/i.test(kPlace), kPlace);
  ok("V_OBCE_SIGN", /moravany/i.test(vHdr.municipalitySign || ""), vHdr.municipalitySign);
  ok("KATASTR_SIGN", /nová\s+ves/i.test(kHdr.municipalitySign || ""), kHdr.municipalitySign);
  ok("MORAVANY_NOT_MERGED", uFacts.municipalityRelation !== vFacts.municipalityRelation);
}

// --- F mobilní ---
{
  const MOB =
    "D7, mezi km 65.5 a 78.1, ve směru Chomutov, pomalu jedoucí vozidlo údržby zpevněná krajnice (odstavný pruh) uzavřená, Od 14.09.2026 08:00 Do 14.09.2026 15:00, pracovní místo DM - Krátkodobé pohyblivé (mobilní), Vydal: Silverton s.r.o.";
  const facts = parseOfficialCommentFacts(MOB);
  const hdr = buildLocalityHeaderModel(base({ impact: MOB, impactFull: MOB, road: "D7", location: "D7", eventType: "prace", illustrationKey: "prace" }));
  const place = buildPlaceAndDirectionLine(base({ impact: MOB, impactFull: MOB, road: "D7", location: "D7", eventType: "prace" }));
  const paren = extractParentheticalStreetNamesFromOfficialComment(MOB);
  ok("MOBILNI_NOT_STREET_NAME", looksLikeStreetName("mobilní") === false);
  ok("MOBILNI_WORKSITE_NOISE", looksLikeWorksiteOrOperationalStreetNoise("mobilní") === true);
  ok("MOBILNI_PAREN_REJECTED", !paren.some((p) => /^mobilní$/i.test(p)), JSON.stringify(paren));
  ok("MOBILNI_FACTS_STREET_EMPTY", !facts.street || !/^mobilní$/i.test(facts.street), facts.street);
  ok("MOBILNI_HEADER_NO_ULICE", !/ulice:\s*mobilní/i.test(hdr.besideLocality || ""), hdr.besideLocality);
  ok("MOBILNI_PLACE_NO_ULICE", !/ulice\s+mobilní/i.test(place || ""), place);
}

// --- I/J Tábor + OBJECT ---
{
  const TABOR =
    "ulice U Bechyňské dráhy - místní komunikace, Tábor,, okr. Tábor, uzavřeno, stavební práce, Od 07.09.2026 00:00 Do 16.10.2026 00:00, , železniční přejezd a přechod P 6293 a P8482, Vydal: Městský úřad Tábor";
  const serverLoc = extractLocalityFromOfficialComment(TABOR);
  const facts = parseOfficialCommentFacts(TABOR);
  const input = base({
    impact: TABOR,
    impactFull: TABOR,
    road: "",
    municipality: "",
    location: "okres Tábor",
    district: "Tábor",
    eventType: "prace",
    illustrationKey: "prace",
  });
  const hdr = buildLocalityHeaderModel(input);
  const place = buildPlaceAndDirectionLine(input);
  const card = buildTrafficCardPresentation(input);
  ok("TABOR_SERVER_MUNICIPALITY", /tábor/i.test(serverLoc.municipality || ""), JSON.stringify(serverLoc));
  ok("TABOR_FACTS_CITY", /tábor/i.test(facts.city || ""), facts.city);
  ok("TABOR_NOT_FROM_DISTRICT_ONLY", facts.city !== null);
  ok("TABOR_STREET", /Bechyňské\s+dráhy/i.test(facts.street || ""), facts.street);
  ok("TABOR_NAMED_OBJECT", /přejezd/i.test(facts.namedObject || ""), facts.namedObject);
  ok("TABOR_SIGN", /tábor/i.test(hdr.municipalitySign || ""), hdr.municipalitySign);
  ok("TABOR_PLACE_NOT_OBJECT_ONLY", !/^železniční\s+přejezd$/i.test(place || ""), place);
  ok("TABOR_PLACE_HAS_STREET_OR_MUNI", /Bechyňské|Tábor/i.test(place || ""), place);
  ok("TABOR_OBJECT_KIND", facts.namedObjectKind === LOCATION_KIND.RAILWAY_CROSSING, facts.namedObjectKind);
  ok("TABOR_DISTRICT_NOT_SIGN", !/^okres\s+tábor$/i.test(hdr.municipalitySign || ""));
}

// --- K/L/T weather I/42 + I/35 ---
{
  const I42 = "Srážky: přeháňky, I/42 MUK Hlinky (SOS hláska)";
  const I35 = "Srážky: přeháňky, I/35 Valašské Meziříčí";
  const i42Facts = parseOfficialCommentFacts(I42);
  const i35Facts = parseOfficialCommentFacts(I35);
  const i42Road = extractBareClassedRoadNumbersFromOfficialComment(I42);
  const i35ServerRoad = extractRoadNumberFromNdicComment(I35);
  const named = extractNamedTransportObject(I42);
  const i42Card = buildTrafficCardPresentation(
    base({ impact: I42, impactFull: I42, eventType: "sjizdnost", illustrationKey: "prekazka" })
  );
  const i35Card = buildTrafficCardPresentation(
    base({ impact: I35, impactFull: I35, eventType: "sjizdnost", illustrationKey: "prekazka" })
  );
  ok("I42_BARE_ROAD", i42Road.includes("I/42"), JSON.stringify(i42Road));
  ok("I42_FACTS_ROAD", i42Facts.roadNumber === "I/42", i42Facts.roadNumber);
  ok("I42_MUK", /MÚK\s+Hlinky/i.test(named && named.name ? named.name : ""), JSON.stringify(named));
  ok("I42_NOT_PREKAZKA_TITLE", !/PŘEKÁŽKA/i.test(i42Card.event?.titleCs || ""), i42Card.event?.titleCs);
  ok("I42_HAS_LOCALITY", /I\/42|Hlinky/i.test(String(i42Card.placeLine || "") + String(i42Card.communication || "")), JSON.stringify({ place: i42Card.placeLine, comm: i42Card.communication }));
  ok("I35_SERVER_ROAD", i35ServerRoad === "I/35", i35ServerRoad);
  ok("I35_FACTS_ROAD", i35Facts.roadNumber === "I/35", i35Facts.roadNumber);
  ok("I35_CITY", /Valašské\s+Meziříčí/i.test(i35Facts.city || "") && !/[|]/.test(i35Facts.city || ""), i35Facts.city);
  ok("I35_SIGN_CLEAN", !/[|]/.test(i35Card.communication?.municipalitySign || "") && !/Srážky/i.test(i35Card.communication?.municipalitySign || ""), i35Card.communication?.municipalitySign);
  ok("I35_NOT_PREKAZKA_TITLE", !/PŘEKÁŽKA/i.test(i35Card.event?.titleCs || ""), i35Card.event?.titleCs);
  ok("I35_HAS_LOCALITY", /I\/35|Valašské/i.test(String(i35Card.placeLine || "") + String(i35Card.communication || "")), JSON.stringify({ place: i35Card.placeLine, comm: i35Card.communication }));
}

// --- M D11 control fixture ---
{
  const D11 =
    "D11, mezi km 37 a 37.1, ve směru Hradec Králové, práce na silnici, zúžení vozovky na dva jízdní pruhy, Od 10.08.2026 05:01 Do 14.10.2026 22:00";
  const input = base({
    impact: D11,
    impactFull: D11,
    road: "D11",
    location: "D11",
    kilometer: "37–37,1",
    direction: "Hradec Králové",
    eventType: "prace",
    illustrationKey: "prace",
  });
  const card = buildTrafficCardPresentation(input);
  const place = String(card.placeLine || "");
  ok("D11_ROAD", /D11/.test(place), place);
  ok("D11_KM", /km\s*37/i.test(place), place);
  ok("D11_DIR", /Hradec\s+Králové/i.test(place), place);
  ok("D11_NO_MOBILNI", !/mobilní/i.test(place));
  ok("D11_NO_FALSE_MUNI", !card.expanded?.rows?.some((r) => r && r.key === "municipality" && /Hradec/i.test(r.value || "")));
}

// --- O descending km must not flip ---
{
  const DESC =
    "I/19, mezi km 142.3 a 118.8, ve směru Praha, práce na silnici";
  const place = buildPlaceAndDirectionLine(
    base({ impact: DESC, impactFull: DESC, road: "I/19", eventType: "prace" })
  );
  ok("DESC_KM_ORDER", /142/.test(place) && /118/.test(place), place);
  const idx142 = place.indexOf("142");
  const idx118 = place.indexOf("118");
  ok("DESC_KM_NOT_FLIPPED", idx142 >= 0 && idx118 > idx142, place);
}

// --- G část obce not municipality sign ---
{
  const PART =
    "silnice I/35, Moravská Třebová, část obce Žipotín, okr. Svitavy, práce údržby";
  const facts = parseOfficialCommentFacts(PART);
  const hdr = buildLocalityHeaderModel(
    base({
      impact: PART,
      impactFull: PART,
      road: "35",
      municipality: "část obce Žipotín",
      location: "část obce Žipotín",
      district: "Svitavy",
      eventType: "prace",
    })
  );
  ok("CAST_OBCE_NOT_SIGN", !/^část\s+obce/i.test(hdr.municipalitySign || ""), hdr.municipalitySign);
  ok("CAST_OBCE_PARTS", (facts.municipalityParts || []).some((p) => /Žipotín/i.test(p)), JSON.stringify(facts.municipalityParts));
}

// --- NOČNÍ worksite tag is not a street (same family as mobilní) ---
{
  const NOC =
    "D5, mezi km 10 a 12, ve směru Praha, práce na silnici, Od 14.09.2026 20:00 Do 15.09.2026 05:00, pracovní místo DN - Noční stabilní (NOČNÍ), Vydal: Test s.r.o.";
  const facts = parseOfficialCommentFacts(NOC);
  const paren = extractParentheticalStreetNamesFromOfficialComment(NOC);
  const hdr = buildLocalityHeaderModel(
    base({ impact: NOC, impactFull: NOC, road: "D5", eventType: "prace", illustrationKey: "prace" })
  );
  const place = buildPlaceAndDirectionLine(
    base({ impact: NOC, impactFull: NOC, road: "D5", eventType: "prace" })
  );
  ok("NOCNI_WORKSITE_NOISE", looksLikeWorksiteOrOperationalStreetNoise("NOČNÍ") === true);
  ok("NOCNI_PAREN_REJECTED", !paren.some((p) => /^NOČNÍ$/i.test(p)), JSON.stringify(paren));
  ok("NOCNI_FACTS_STREET_EMPTY", !facts.street || !/^NOČNÍ$/i.test(facts.street), facts.street);
  ok("NOCNI_HEADER_NO_ULICE", !/ulice:\s*NOČNÍ/i.test(hdr.besideLocality || ""), hdr.besideLocality);
  ok("NOCNI_PLACE_NO_ULICE", !/ulice\s+NOČNÍ/i.test(place || ""), place);
  ok("MOBILNI_STILL_NOISE", looksLikeWorksiteOrOperationalStreetNoise("mobilní") === true);
}

// --- Canonical bare road + class ---
{
  const I38 =
    "silnice I/38, v katastru obce Nové Dvory, okr. Kutná Hora, stavební práce";
  const III =
    "silnice III/29810, v katastru obce Sample, okr. Sample, stavební práce";
  const card38 = buildTrafficCardPresentation(
    base({
      impact: I38,
      impactFull: I38,
      road: "38",
      roadClass: "CLASS_I",
      roadClassLabel: "Silnice I. třídy",
      municipality: "Nové Dvory",
      eventType: "prace",
    })
  );
  const card29810 = buildTrafficCardPresentation(
    base({
      impact: III,
      impactFull: III,
      road: "29810",
      roadClass: "CLASS_III",
      roadClassLabel: "Silnice III. třídy",
      eventType: "prace",
    })
  );
  const cardII = buildTrafficCardPresentation(
    base({
      impact: "silnice II/486, u obce Kopřivnice, okr. Sample",
      impactFull: "silnice II/486, u obce Kopřivnice, okr. Sample",
      road: "II/486",
      roadClass: "CLASS_II",
      eventType: "prace",
    })
  );
  const r38 = card38.communication?.roadPresentations?.[0]?.road || card38.roadPresentation?.road;
  const r29810 =
    card29810.communication?.roadPresentations?.[0]?.road || card29810.roadPresentation?.road;
  const rII = cardII.communication?.roadPresentations?.[0]?.road || cardII.roadPresentation?.road;
  ok("CANON_38_TO_I38", r38 === "I/38", r38);
  ok("CANON_29810_TO_III", r29810 === "III/29810", r29810);
  ok("CANON_II486_STABLE", rII === "II/486", rII);
  ok("CANON_III_STABLE", r29810 === "III/29810");
}

// --- Road number must not become Lokalita ---
{
  const S = "silnice I/20, v katastru obce Pištín, okr. České Budějovice, omezení";
  const card = buildTrafficCardPresentation(
    base({
      impact: S,
      impactFull: S,
      road: "20",
      roadClass: "CLASS_I",
      roadClassLabel: "Silnice I. třídy",
      location: "20",
      municipality: "Pištín",
      eventType: "omezeni",
    })
  );
  const locRow = (card.expanded?.rows || []).find((r) => r.key === "location");
  ok("LOC_NOT_ROAD_DIGITS", !locRow || locRow.value !== "20", JSON.stringify(locRow));
}

// --- Liberec) parenthesis artefact ---
{
  const KS =
    "V obci Krásná Studánka(okres Liberec) ulice: Dětřichovská, silnice: místní komunikace, Od 14.09.2026 00:00, Do 22.09.2026 23:59, Vydal: Magistrát města Liberec";
  const facts = parseOfficialCommentFacts(KS);
  const card = buildTrafficCardPresentation(
    base({
      impact: KS,
      impactFull: KS,
      road: "",
      location: "okres Liberec)",
      district: "Liberec)",
      eventType: "omezeni",
    })
  );
  const distRow = (card.expanded?.rows || []).find((r) => r.key === "district");
  ok("KS_CITY", /Krásná\s+Studánka/i.test(facts.city || ""), facts.city);
  ok("KS_DISTRICT_NO_PAREN", facts.district === "Liberec", facts.district);
  ok("KS_DISTRICT_ROW_CLEAN", !distRow || distRow.value === "Liberec", JSON.stringify(distRow));
  ok("KS_PLACE_NO_PAREN", !/Liberec\)/i.test(card.placeLine || ""), card.placeLine);
  ok("KS_SERVER_DISTRICT", (extractLocalityFromOfficialComment(KS).district || "") === "Liberec");
}

// --- Klatovy / Točník keeps Místo (katastr + část obce) ---
{
  const KT =
    "místní komunikace, v katastru obce Klatovy, část obce Točník, okr. Klatovy, uzavřeno, stavební práce, Od 14.09.2026 00:01 Do 14.11.2026 23:59, Vydal: Městský úřad Klatovy";
  const facts = parseOfficialCommentFacts(KT);
  const hdr = buildLocalityHeaderModel(
    base({
      impact: KT,
      impactFull: KT,
      road: "",
      municipality: "Klatovy",
      district: "Klatovy",
      eventType: "prace",
    })
  );
  const card = buildTrafficCardPresentation(
    base({
      impact: KT,
      impactFull: KT,
      road: "",
      municipality: "Klatovy",
      district: "Klatovy",
      eventType: "prace",
    })
  );
  ok("KT_RELATION_KATASTR", facts.municipalityRelation === "v_katastru_obce", facts.municipalityRelation);
  ok("KT_PART_TOCNIK", (facts.municipalityParts || []).some((p) => /Točník/i.test(p)), JSON.stringify(facts.municipalityParts));
  ok("KT_SIGN_OBEC", /Klatovy/i.test(hdr.municipalitySign || ""), hdr.municipalitySign);
  ok("KT_PLACE_HAS_PART", /Točník/i.test(card.placeLine || ""), card.placeLine);
  ok("KT_PLACE_NOT_EMPTY", !!(card.placeLine && String(card.placeLine).trim()), card.placeLine);
}

const passN = results.filter((r) => r.pass).length;
const failN = results.length - passN;
const out = {
  guard: "iu-traffic-localization-edge-cards-guard",
  total: results.length,
  pass: passN,
  fail: failN,
  fails,
};
console.log(JSON.stringify(out, null, 2));
if (failN) {
  console.log("IU_TRAFFIC_LOCALIZATION_EDGE_CARDS_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_LOCALIZATION_EDGE_CARDS_PASS");
