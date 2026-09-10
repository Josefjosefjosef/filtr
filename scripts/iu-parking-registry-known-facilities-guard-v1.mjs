#!/usr/bin/env node
/**
 * Known parking facilities must keep matching PARKING_REGISTRY for municipality signs.
 * Does not require unknown parkings to have a city. Pure local, no network.
 */
import {
  PARKING_REGISTRY,
  matchParkingRegistry,
} from "../assets/iu-parking-registry-v1.js";
import {
  buildTrafficCardPresentation,
} from "../assets/iu-traffic-card-presenter-v1.js";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

/** Known NDIC / OKAS labels → expected municipalitySignLabel */
const KNOWN = [
  { impact: "Smetanovo náměstí, 55% obsazeno", sign: "OSTRAVA", id: "ostrava-smetanovo-namesti" },
  { impact: "Garáže Dubina, 40% obsazeno", sign: "OSTRAVA", id: "ostrava-garaze-dubina" },
  { impact: "Patrové garáže Dubina, 40% obsazeno", sign: "OSTRAVA", id: "ostrava-garaze-dubina" },
  { impact: "Prokešovo náměstí, 50% obsazeno", sign: "OSTRAVA", id: "ostrava-prokesovo-namesti" },
  { impact: "Parkovací dům DK POKLAD I., 40% obsazeno", sign: "OSTRAVA", id: "ostrava-dk-poklad-1" },
  { impact: "Parkovací dům DK POKLAD II., 40% obsazeno", sign: "OSTRAVA", id: "ostrava-dk-poklad-2" },
  { impact: "Janáčkova, 30% obsazeno", sign: "OSTRAVA", id: "ostrava-janackova" },
  { impact: "Seidlerovo nábřeží, 30% obsazeno", sign: "OSTRAVA", id: "ostrava-seidlerovo-nabrezi" },
  { impact: "P+R Hlučínská, 20% obsazeno", sign: "OSTRAVA", id: "ostrava-pr-hlucinska" },
  { impact: "P+R Hranečník, 20% obsazeno", sign: "OSTRAVA", id: "ostrava-pr-hranecnik" },
  { impact: "Parkovací dům u MNOF, 25% obsazeno", sign: "OSTRAVA", id: "ostrava-parkovaci-dum-u-mnof" },
  { impact: "P+R Skalka II, 60% obsazeno", sign: "PRAHA", id: "praha-pr-skalka-2" },
  { impact: "P+R Roztyly, 55% obsazeno", sign: "PRAHA", id: "praha-pr-roztyly" },
  { impact: "P+R Nové Butovice, 45% obsazeno", sign: "PRAHA", id: "praha-pr-nove-butovice" },
];

ok("REGISTRY_NONEMPTY", PARKING_REGISTRY.length >= 30, String(PARKING_REGISTRY.length));

for (const row of KNOWN) {
  const reg = matchParkingRegistry({ impact: row.impact });
  ok(
    "MATCH_" + row.id,
    !!reg && reg.parkingId === row.id,
    reg ? reg.parkingId : "null"
  );
  const vm = buildTrafficCardPresentation({ eventType: "doprava", impact: row.impact });
  ok(
    "SIGN_" + row.id,
    vm.communication.municipalitySignLabel === row.sign,
    String(vm.communication.municipalitySignLabel)
  );
}

const unknown = buildTrafficCardPresentation({
  eventType: "doprava",
  impact: "Nové parkoviště XYZ, 40% obsazeno",
});
ok("UNKNOWN_NO_SIGN", unknown.communication.municipalitySign == null);

if (fails.length) {
  console.error("FAIL", fails.join(" | "));
  process.exit(1);
}
console.log("PASS iu-parking-registry-known-facilities-guard-v1 count=" + KNOWN.length);
