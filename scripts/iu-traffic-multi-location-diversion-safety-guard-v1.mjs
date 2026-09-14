#!/usr/bin/env node
/**
 * Multi-location / diversion-boundary / safety-summary regression guard.
 * Extends post-#10601 localization coverage for:
 *   - diversion contamination of primary municipality/parts/roads
 *   - multi-katastr (Stvolínky–Úštěk, Bílý Kostel–Liberec)
 *   - mezi obcemi
 *   - oil hazard vs HZS summary
 *   - structured street range (Pod Chalupami – U Mlýna)
 * Plus do-not-break controls from #10601 family.
 */
import {
  parseOfficialCommentFacts,
  buildPlaceAndDirectionLine,
  buildTrafficSituationSummary,
  buildLocalityHeaderModel,
  clipOfficialCommentLocationScanText,
  extractBetweenMunicipalitiesSegment,
  extractAllKatastrMunicipalitiesFromOfficialComment,
  resolveConfirmedStreet,
  resolveMunicipalitySignName,
} from "../assets/iu-traffic-card-presenter-v1.js";
import { extractLocalityFromOfficialComment } from "../scripts/ndic-datex-v1/traffic-card-content-v1.mjs";

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
    publicEventId: "iu-te-" + "d".repeat(32),
    lifecycleStatus: "ACTIVE",
    preciseLocationVerified: true,
    source: "ŘSD/NDIC",
    ...extra,
  };
}

const KD_11547 =
  "silnice III/11547 (ulice Pivovarská), Králův Dvůr, část obce Popovice, okr. Beroun, , Od 16.09.2026 07:00, Do 23.09.2026 19:00, Uzavírka silnice č. III/11542 (km 1,030 - 1,120) v k.ú. Králův Dvůr a III/11547 (km 1,420 - 1,540) v k.ú. Popovice u Králova Dvora z důvodu opravy železničních přejezdů P279 a P280, Objížďka - bez rozlišení: silnice III/2363a (ulice Bohumila Hájka), část obce Popovice - silnice III/11546, část obce Křižatky, Králův Dvůr, okr. Beroun, přes: silnice III/11524 (ulice Tovární)";

const KD_11542 =
  "silnice III/11542 (ulice Tovární), část obce K Popovicům - část obce U Litavky II, Králův Dvůr, okr. Beroun, , Od 16.09.2026 07:00, Do 23.09.2026 19:00, Uzavírka silnice č. III/11542 (km 1,030 - 1,120) v k.ú. Králův Dvůr a III/11547 (km 1,420 - 1,540) v k.ú. Popovice u Králova Dvora z důvodu opravy železničních přejezdů P279 a P280, Objížďka - bez rozlišení: silnice III/2363a (ulice Bohumila Hájka), část obce Popovice - silnice III/11546, část obce Křižatky, Králův Dvůr, okr. Beroun, přes: silnice III/11524";

const STVOLINKY =
  "silnice I/15, v katastru obce Stvolínky, část obce Malý Bor, okr. Česká Lípa - v katastru obce Úštěk, část obce Lukov, okr. Litoměřice, Platnost od 14.9.2026 09:23 do 14.9.2026 11:23, Vydal: Silnice LK a.s.";

const BILY =
  "silnice I/35, v katastru obce Bílý Kostel nad Nisou - (ulice Londýnská), v katastru obce Liberec, část obce Machnín, okr. Liberec, pomalu jedoucí vozidlo údržby, pravý jízdní pruh uzavřen, Od 14.09.2026 10:00 Do 14.09.2026 12:30, sekání trávy a údržba travních porostů, pracovní místo CM – krátkodobé POHYBLIVÉ (mobilní), Vydal: EUROVIA CS, a.s. závod Liberec";

const HUNT =
  "Od 14.9.2026 09:20 do 11:20; na silnici 13 mezi obcemi Huntířov a Děčín , délka 3.6km; Pozor! Olej na vozovce; dopravu řídí policie; na místě HZS, zasahuje několik jednotek v průběhu 5km.";

const PLZEN =
  "ulice Pod Chalupami - ulice U Mlýna, Plzeň 2-Slovany, Plzeň, , Od 04.10.2026 00:00, Do 04.10.2026 23:59, Medový Jarmark - kulturní akce, Vydal: ÚMO Plzeň 02 Slovany";

const TREMOSNA =
  "ulice K Platince - ulice Luční, Třemošná, okr. Plzeň-sever";

const DREVES = "Stav vozovky: nebezpečí akvaplaningu, Dřeveš";

const BILOVICE =
  "silnice II/383 (ulice Havlíčkova), Bílovice nad Svitavou, okr. Brno-venkov, , Od 01.01.2026 08:00, Do 01.01.2026 16:00, práce na silnici u p.p.č. 123/4, k.ú. Bílovice nad Svitavou, Vydal: Test";

const BREHOV =
  "Od 1.1.2026 12:00 do 13:00; na silnici 145 u obce Břehov okres České Budějovice; práce na silnici.";

const KOJETIN =
  "Od 1.1.2026 10:00; na silnici 367 v ulici Padlých hrdinů v obci Kojetín okres Přerov; práce na silnici.";

const MOB =
  "D7, mezi km 65.5 a 78.1, ve směru Chomutov, pomalu jedoucí vozidlo údržby zpevněná krajnice (odstavný pruh) uzavřená, Od 14.09.2026 08:00 Do 14.09.2026 15:00, pracovní místo DM - Krátkodobé pohyblivé (mobilní), Vydal: Silverton s.r.o.";

const D8 =
  "D8, mezi km 16 a 13,1, ve směru Ústí nad Labem, práce na silnici, Od 14.09.2026 08:00 Do 14.09.2026 16:00";

// --- A KD 11547 diversion contamination ---
{
  const f = parseOfficialCommentFacts(KD_11547);
  const place = buildPlaceAndDirectionLine(base({ impact: KD_11547, impactFull: KD_11547 }));
  const scan = clipOfficialCommentLocationScanText(KD_11547);
  ok("KD47_CITY_KRALUV", /Králův\s+Dvůr/i.test(f.city || ""), f.city);
  ok("KD47_CITY_NOT_UZAVIRKA", !/uzavírk/i.test(f.city || ""), f.city);
  ok("KD47_CITYPART_NOT_UZAVIRKA", !/uzavírk/i.test(f.cityPart || ""), f.cityPart);
  ok("KD47_PARTS_HAS_POPOVICE", (f.municipalityParts || []).some((p) => /Popovice/i.test(p)));
  ok(
    "KD47_PARTS_NO_KRIZATKY",
    !(f.municipalityParts || []).some((p) => /Křižatky/i.test(p)),
    JSON.stringify(f.municipalityParts)
  );
  ok("KD47_ROADS_PRIMARY_ONLY", (f.roadNumbers || []).join(",") === "III/11547", JSON.stringify(f.roadNumbers));
  ok("KD47_NO_DETOUR_ROAD_11546", !(f.roadNumbers || []).some((r) => /11546|2363/i.test(r)));
  ok("KD47_SCAN_CUTS_DETOUR", !/Objížďk|Křižatky/i.test(scan), scan.slice(0, 160));
  ok("KD47_PLACE_NO_UZAVIRKA", !/uzavírk/i.test(place || ""), place);
  ok("KD47_SERVER_MUNI", /Králův\s+Dvůr/i.test(extractLocalityFromOfficialComment(KD_11547).municipality || ""));
}

// --- B KD 11542 primary parts vs diversion ---
{
  const f = parseOfficialCommentFacts(KD_11542);
  ok("KD42_CITY", /Králův\s+Dvůr/i.test(f.city || ""), f.city);
  ok(
    "KD42_PRIMARY_PARTS",
    (f.municipalityParts || []).includes("K Popovicům") &&
      (f.municipalityParts || []).includes("U Litavky II"),
    JSON.stringify(f.municipalityParts)
  );
  ok(
    "KD42_NO_DETOUR_PARTS",
    !(f.municipalityParts || []).some((p) => /Křižatky|^Popovice$/i.test(p)),
    JSON.stringify(f.municipalityParts)
  );
  ok("KD42_ROAD", (f.roadNumbers || [])[0] === "III/11542", JSON.stringify(f.roadNumbers));
}

// --- C Stvolínky multi-katastr ---
{
  const f = parseOfficialCommentFacts(STVOLINKY);
  const place = buildPlaceAndDirectionLine(base({ impact: STVOLINKY, impactFull: STVOLINKY, road: "I/15" }));
  const kats = extractAllKatastrMunicipalitiesFromOfficialComment(STVOLINKY);
  ok("STV_CITY", f.city === "Stvolínky", f.city);
  ok("STV_DISTRICT_CLEAN", f.district === "Česká Lípa", f.district);
  ok("STV_DISTRICT_NO_KATASTR", !/katastru|Úštěk/i.test(f.district || ""), f.district);
  ok("STV_EXTRA_USTEK", (f.additionalMunicipalities || []).some((m) => /Úštěk/i.test(m)));
  ok("STV_KATS", kats.length >= 2 && /Stvolínky/i.test(kats[0]) && /Úštěk/i.test(kats[1]));
  ok("STV_PLACE_HAS_BOTH", /Stvolínky/i.test(place) && /Úštěk/i.test(place), place);
  ok("STV_SERVER_DISTRICT", extractLocalityFromOfficialComment(STVOLINKY).district === "Česká Lípa");
}

// --- D Bílý Kostel / Liberec ---
{
  const f = parseOfficialCommentFacts(BILY);
  const place = buildPlaceAndDirectionLine(base({ impact: BILY, impactFull: BILY, road: "I/35" }));
  ok("BILY_CITY_NO_DASH", f.city === "Bílý Kostel nad Nisou", f.city);
  ok("BILY_HAS_LIBEREC", (f.additionalMunicipalities || []).some((m) => /^Liberec$/i.test(m)));
  ok("BILY_PART_MACHNIN", (f.municipalityParts || []).includes("Machnín"));
  ok("BILY_STREET", /Londýnská/i.test(f.street || ""), f.street);
  ok("BILY_PLACE_NO_ORPHAN_DASH", !/Nisou\s*-\s*·|Nisou\s*-\s*$/i.test(place || ""), place);
  ok("BILY_MOBILNI_NOT_STREET", !/^mobilní$/i.test(f.street || ""));
}

// --- E Huntířov mezi obcemi + oil ---
{
  const f = parseOfficialCommentFacts(HUNT);
  const sit = buildTrafficSituationSummary(base({ impact: HUNT, impactFull: HUNT, eventType: "prekazka" }));
  const place = buildPlaceAndDirectionLine(base({ impact: HUNT, impactFull: HUNT }));
  const between = extractBetweenMunicipalitiesSegment(HUNT);
  ok("HUNT_RELATION", f.municipalityRelation === "mezi_obcemi", f.municipalityRelation);
  ok("HUNT_BETWEEN", between && /Huntířov/i.test(between.fromMunicipality) && /Děčín/i.test(between.toMunicipality));
  ok("HUNT_NOT_U_OBCE", f.municipalityRelation !== "u_obce");
  ok("HUNT_PLACE_MEZI", /mezi\s+obcemi\s+Huntířov\s+a\s+Děčín/i.test(place || ""), place);
  ok("HUNT_OIL_FACT", f.oilOnRoad === true);
  ok("HUNT_SIT_OIL", /olej\s+na\s+vozovce/i.test(sit || ""), sit);
  ok("HUNT_SIT_HZS", /HZS/i.test(sit || ""), sit);
  ok("HUNT_SIT_NOT_HZS_ONLY", !/^Na místě je HZS\.?$/i.test(String(sit || "").trim()), sit);
}

// --- F Plzeň street range ---
{
  const f = parseOfficialCommentFacts(PLZEN);
  const place = buildPlaceAndDirectionLine(base({ impact: PLZEN, impactFull: PLZEN, municipality: "Plzeň" }));
  ok("PLZEN_RANGE", f.streetRange === true || (f.streets || []).length === 2, JSON.stringify(f.streets));
  ok("PLZEN_FROM", /Pod\s+Chalupami/i.test(f.streetFrom || (f.streets || [])[0] || ""), f.streetFrom);
  ok("PLZEN_TO", /U\s+Mlýna/i.test(f.streetTo || (f.streets || [])[1] || ""), f.streetTo);
  ok("PLZEN_PLACE_STREETS", /Pod\s+Chalupami/i.test(place) && /U\s+Mlýna/i.test(place), place);
  ok("PLZEN_CITY", /Plzeň/i.test(f.city || ""), f.city);
}

// --- F2 Třemošná street-range (municipality-before-okr must not enter street) ---
{
  const f = parseOfficialCommentFacts(TREMOSNA);
  const street = resolveConfirmedStreet(base({ impact: TREMOSNA, impactFull: TREMOSNA }), f);
  const place = buildPlaceAndDirectionLine(base({ impact: TREMOSNA, impactFull: TREMOSNA }));
  const sign = resolveMunicipalitySignName(base({ impact: TREMOSNA, impactFull: TREMOSNA }));
  const server = extractLocalityFromOfficialComment(TREMOSNA);
  ok("TRE_RANGE", f.streetRange === true, JSON.stringify({ from: f.streetFrom, to: f.streetTo }));
  ok("TRE_FROM", /K\s+Platince/i.test(f.streetFrom || ""), f.streetFrom);
  ok("TRE_TO", /Luční/i.test(f.streetTo || ""), f.streetTo);
  ok("TRE_STREET_HAS_BOTH", /K\s+Platince/i.test(street || "") && /Luční/i.test(street || ""), street);
  ok("TRE_STREET_NO_MUNI", !/Třemošná/i.test(street || "") && !(f.streets || []).some((s) => /Třemošná/i.test(s)), JSON.stringify(f.streets));
  ok("TRE_CITY", f.city === "Třemošná", f.city);
  ok("TRE_SIGN", sign === "Třemošná", sign);
  ok("TRE_DISTRICT", f.district === "Plzeň-sever", f.district);
  ok("TRE_NO_DISTRICT_IN_STREET", !/Plzeň-sever|okr\./i.test(street || ""), street);
  ok("TRE_PLACE_HAS_MUNI", /Třemošná/i.test(place || ""), place);
  ok("TRE_NO_SLASH_MUNI", !/Luční\s*\/\s*Třemošná/i.test(street || "") && !/Luční\s*\/\s*Třemošná/i.test(place || ""), place);
  ok("TRE_SERVER_MUNI", server.municipality === "Třemošná", server.municipality);
}

// --- G Dřeveš negative control ---
{
  const f = parseOfficialCommentFacts(DREVES);
  ok("DREVES_NO_CITY", !f.city, f.city);
  ok("DREVES_SERVER_NO_CITY", !extractLocalityFromOfficialComment(DREVES).municipality);
}

// --- G2 Bílovice parcel / k.ú. locality retained ---
{
  const f = parseOfficialCommentFacts(BILOVICE);
  const place = buildPlaceAndDirectionLine(
    base({ impact: BILOVICE, impactFull: BILOVICE, road: "II/383", municipality: "Bílovice nad Svitavou" })
  );
  ok("BIL_ROAD", (f.roadNumbers || []).some((r) => /II\/383/i.test(r)), JSON.stringify(f.roadNumbers));
  ok("BIL_STREET", /Havlíčkova/i.test(f.street || ""), f.street);
  ok("BIL_CITY", /Bílovice\s+nad\s+Svitavou/i.test(f.city || ""), f.city);
  ok("BIL_DISTRICT", /Brno-venkov/i.test(f.district || ""), f.district);
  ok("BIL_PLACE_HAS_CITY", /Bílovice/i.test(place || ""), place);
}

// --- H/I/J/K/L do-not-break ---
{
  const d8 = parseOfficialCommentFacts(D8);
  ok("D8_DESC_KM", /16/.test(String(d8.kilometerFrom || d8.kilometerLabel || "")) && /13/.test(String(d8.kilometerTo || d8.kilometerLabel || "")), JSON.stringify({ from: d8.kilometerFrom, to: d8.kilometerTo, label: d8.kilometerLabel }));
  const mob = parseOfficialCommentFacts(MOB);
  ok("MOB_NOT_STREET", !mob.street || !/^mobilní$/i.test(mob.street), mob.street);
  const br = parseOfficialCommentFacts(BREHOV);
  const brPlace = buildPlaceAndDirectionLine(base({ impact: BREHOV, impactFull: BREHOV, road: "II/145" }));
  ok("BREHOV_U_OBCE", br.municipalityRelation === "u_obce", br.municipalityRelation);
  ok("BREHOV_CITY", /Břehov/i.test(br.city || ""), br.city);
  ok("BREHOV_PLACE", /u\s+obce\s+Břehov/i.test(brPlace || ""), brPlace);
  const kj = parseOfficialCommentFacts(KOJETIN);
  ok("KOJETIN_CITY", /Kojetín/i.test(kj.city || ""), kj.city);
  ok("KOJETIN_STREET", /Padlých\s+hrdinů/i.test(kj.street || ""), kj.street);
  ok("KOJETIN_V_OBCE", kj.municipalityRelation === "v_obce", kj.municipalityRelation);
}

if (fails.length) {
  console.error("IU_TRAFFIC_MULTI_LOC_DIVERSION_FAIL=" + fails.join(","));
  process.exitCode = 1;
} else {
  console.log(
    "IU_TRAFFIC_MULTI_LOC_DIVERSION_PASS=true " +
      JSON.stringify({ checks: results.length, pass: results.filter((r) => r.pass).length })
  );
}
