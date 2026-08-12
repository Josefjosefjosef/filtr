/**
 * Verified static P+R / parking facility registry (v1).
 *
 * Scope: enrichment only (municipality, address, P+R type). Never overrides live NDIC occupancy.
 * Provenance must be authoritative operator / city pages — not web-search guesses.
 *
 * Matching is exact-alias only (after normalization). Ambiguous names → no match.
 */

export const PARKING_REGISTRY_VERSION = "1.0.0";
export const PARKING_REGISTRY_LAST_VERIFIED = "2026-08-12";

export const PARK_AND_RIDE_EXPLANATION_CS =
  "P+R (Park and Ride). Záchytné parkoviště určené pro řidiče, kteří zde zaparkují a dále pokračují veřejnou dopravou.";

/** @typedef {{
 *  parkingId: string,
 *  canonicalName: string,
 *  municipality: string,
 *  cityPart: string|null,
 *  street: string|null,
 *  addressLine: string|null,
 *  postalCode: string|null,
 *  coordinates: {lat:number, lon:number}|null,
 *  parkingType: "P+R"|"P+G"|"PARKING_HOUSE"|"PUBLIC_PARKING"|"PARKING",
 *  parkAndRide: boolean,
 *  shortExplanation: string|null,
 *  aliases: string[],
 *  sources: {label:string, url:string}[],
 *  lastVerified: string,
 * }} ParkingRegistryEntry */

/** @type {readonly ParkingRegistryEntry[]} */
export const PARKING_REGISTRY = Object.freeze([
  Object.freeze({
    parkingId: "praha-pr-holesovice",
    canonicalName: "P+R Holešovice",
    municipality: "Praha",
    cityPart: null,
    street: "Plynární",
    addressLine: "Plynární, Praha",
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    aliases: Object.freeze(["p+r holesovice", "pr holesovice", "holesovice"]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Holešovice (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/holesovice/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-kotlarka",
    canonicalName: "P+R Kotlářka",
    municipality: "Praha",
    cityPart: null,
    street: "Plzeňská",
    addressLine: "Plzeňská, Praha",
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    aliases: Object.freeze(["p+r kotlarka", "pr kotlarka", "kotlarka"]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Kotlářka (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/kotlarka/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-rajska-zahrada",
    canonicalName: "P+R Rajská zahrada",
    municipality: "Praha",
    cityPart: null,
    street: "Cíglerova",
    addressLine: "Cíglerova, Praha",
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    aliases: Object.freeze([
      "p+r rajska zahrada",
      "pr rajska zahrada",
      "rajska zahrada",
      "p+r rajska zahrada",
    ]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Rajská Zahrada (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/rajska-zahrada/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-cerny-most-2",
    canonicalName: "P+R Černý Most 2",
    municipality: "Praha",
    cityPart: null,
    street: "Chlumecká",
    addressLine: "Chlumecká, Praha",
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    aliases: Object.freeze([
      "p+r cerny most 2",
      "p+r cerny most ii",
      "pr cerny most 2",
      "pr cerny most ii",
      "cerny most 2",
      "cerny most ii",
    ]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Černý Most 2 (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/cerny-most-2/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-garaze-cerny-most",
    canonicalName: "P+R Garáže Černý Most",
    municipality: "Praha",
    cityPart: null,
    street: "Chlumecká",
    addressLine: "Chlumecká, Praha",
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    aliases: Object.freeze([
      "p+r garaze cerny most",
      "pr garaze cerny most",
      "garaze cerny most",
      "p+r cerny most garaze",
    ]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Garáže Černý Most (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/cerny-most/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-opatov",
    canonicalName: "P+R Opatov",
    municipality: "Praha",
    cityPart: null,
    street: "Chilská",
    addressLine: "Chilská, Praha",
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    aliases: Object.freeze(["p+r opatov", "pr opatov", "opatov"]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Opatov (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/opatov/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-chodov",
    canonicalName: "P+R Chodov",
    municipality: "Praha",
    cityPart: null,
    street: "Roztylská",
    addressLine: "Roztylská, Praha",
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    aliases: Object.freeze(["p+r chodov", "pr chodov", "chodov"]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Chodov (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/chodov/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-zlicin-1",
    canonicalName: "P+R Zličín 1",
    municipality: "Praha",
    cityPart: null,
    street: "Řevnická",
    addressLine: "Řevnická, Praha",
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    aliases: Object.freeze(["p+r zlicin 1", "pr zlicin 1", "zlicin 1"]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Zličín 1 (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/zlicin-1/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-zlicin-2",
    canonicalName: "P+R Zličín 2",
    municipality: "Praha",
    cityPart: null,
    street: "Ringhofferova",
    addressLine: "Ringhofferova, Praha",
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    shortExplanation: null,
    aliases: Object.freeze(["p+r zlicin 2", "pr zlicin 2", "zlicin 2"]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Zličín 2 (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/zlicin-2/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  // NDIC often emits bare "P+R Zličín" (not 1/2). Municipality is safe; address is not —
  // fail-closed: no street/address until NDIC distinguishes the lot.
  Object.freeze({
    parkingId: "praha-pr-zlicin",
    canonicalName: "P+R Zličín",
    municipality: "Praha",
    cityPart: null,
    street: null,
    addressLine: null,
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    shortExplanation: null,
    aliases: Object.freeze(["p+r zlicin", "pr zlicin", "zlicin"]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Zličín 1 (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/zlicin-1/",
      },
      {
        label: "Parking.praha.eu — P+R Zličín 2 (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/zlicin-2/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-skalka-1",
    canonicalName: "P+R Skalka",
    municipality: "Praha",
    cityPart: null,
    street: null,
    addressLine: null,
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    shortExplanation: null,
    // NDIC "P+R Skalka" ↔ parking.praha.eu Skalka 1 (distinct from Skalka II / Skalka 2).
    aliases: Object.freeze(["p+r skalka", "pr skalka", "skalka", "p+r skalka 1", "skalka 1"]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Skalka 1 (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/skalka-1/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "praha-pr-skalka-2",
    canonicalName: "P+R Skalka II",
    municipality: "Praha",
    cityPart: null,
    street: null,
    addressLine: null,
    postalCode: null,
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    shortExplanation: null,
    aliases: Object.freeze([
      "p+r skalka 2",
      "p+r skalka ii",
      "pr skalka 2",
      "pr skalka ii",
      "skalka 2",
      "skalka ii",
    ]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Skalka 2 (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/skalka-2/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  // Not listed on parking.praha.eu P+R table — operator Kongresové centrum Praha, a.s. (TSK as manager).
  Object.freeze({
    parkingId: "praha-pr-kongresove-centrum",
    canonicalName: "P+R Kongresové centrum",
    municipality: "Praha",
    cityPart: "Praha 4",
    street: "5. května",
    addressLine: "5. května 1640/65, Praha 4",
    postalCode: "140 21",
    coordinates: null,
    parkingType: "P+R",
    parkAndRide: true,
    shortExplanation: null,
    aliases: Object.freeze([
      "p+r kongresove centrum",
      "p+r kongresove centrum praha",
      "pr kongresove centrum",
      "kongresove centrum",
      "kongresove centrum praha",
    ]),
    sources: Object.freeze([
      {
        label: "Kongresové centrum Praha, a.s. — Parkování P+R",
        url: "https://www.praguecc.cz/cs/parkovani-pr",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  // --- Ostrava (Ostravské komunikace, a.s. / SMO operated list) ---
  Object.freeze({
    parkingId: "ostrava-smetanovo-namesti",
    canonicalName: "Smetanovo náměstí",
    municipality: "Ostrava",
    cityPart: null,
    street: null,
    addressLine: null,
    postalCode: null,
    coordinates: null,
    parkingType: "PUBLIC_PARKING",
    parkAndRide: false,
    shortExplanation: null,
    aliases: Object.freeze(["smetanovo namesti"]),
    sources: Object.freeze([
      {
        label: "Ostravské komunikace, a.s. — Provozovaná parkoviště",
        url: "https://www.okas.cz/hlavni-cinnosti/parkovani.html",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "ostrava-podebradova",
    canonicalName: "Poděbradova",
    municipality: "Ostrava",
    cityPart: null,
    street: "Poděbradova",
    addressLine: null,
    postalCode: null,
    coordinates: null,
    parkingType: "PUBLIC_PARKING",
    parkAndRide: false,
    shortExplanation: null,
    aliases: Object.freeze(["podebradova"]),
    sources: Object.freeze([
      {
        label: "Ostravské komunikace, a.s. — Provozovaná parkoviště",
        url: "https://www.okas.cz/hlavni-cinnosti/parkovani.html",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "ostrava-nam-msgre-sramka",
    canonicalName: "Nám. Msgre Šrámka",
    municipality: "Ostrava",
    cityPart: null,
    street: null,
    addressLine: null,
    postalCode: null,
    coordinates: null,
    parkingType: "PUBLIC_PARKING",
    parkAndRide: false,
    shortExplanation: null,
    aliases: Object.freeze([
      "nam msgre sramka",
      "namesti msgre sramka",
      "msgre sramka",
    ]),
    sources: Object.freeze([
      {
        label: "Ostravské komunikace, a.s. — Provozovaná parkoviště",
        url: "https://www.okas.cz/hlavni-cinnosti/parkovani.html",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "ostrava-pod-ostravskou-univerzitou",
    canonicalName: "pod Ostravskou univerzitou",
    municipality: "Ostrava",
    cityPart: null,
    street: null,
    addressLine: null,
    postalCode: null,
    coordinates: null,
    parkingType: "PUBLIC_PARKING",
    parkAndRide: false,
    shortExplanation: null,
    aliases: Object.freeze([
      "pod ostravskou univerzitou",
    ]),
    sources: Object.freeze([
      {
        label: "Ostravské komunikace, a.s. — Provozovaná parkoviště",
        url: "https://www.okas.cz/hlavni-cinnosti/parkovani.html",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "ostrava-dk-poklad-1",
    canonicalName: "Parkovací dům DK POKLAD I.",
    municipality: "Ostrava",
    cityPart: "Poruba",
    street: "Matěje Kopeckého",
    addressLine: "Matěje Kopeckého × Komenského, Ostrava-Poruba",
    postalCode: null,
    coordinates: null,
    parkingType: "PARKING_HOUSE",
    parkAndRide: false,
    shortExplanation: null,
    aliases: Object.freeze([
      "parkovaci dum dk poklad i",
      "parkovaci dum dk poklad 1",
      "dk poklad i",
      "dk poklad 1",
      "poklad i",
    ]),
    sources: Object.freeze([
      {
        label: "Ostravské komunikace, a.s. — Provozovaná parkoviště",
        url: "https://www.okas.cz/hlavni-cinnosti/parkovani.html",
      },
      {
        label: "DK Poklad Ostrava — Parkování u Pokladu",
        url: "https://dkpoklad.cz/novinky/parkovani-u-pokladu/",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "ostrava-prokesovo-namesti",
    canonicalName: "Prokešovo náměstí",
    municipality: "Ostrava",
    cityPart: null,
    street: null,
    addressLine: null,
    postalCode: null,
    coordinates: null,
    parkingType: "PUBLIC_PARKING",
    parkAndRide: false,
    shortExplanation: null,
    aliases: Object.freeze(["prokesovo namesti"]),
    sources: Object.freeze([
      {
        label: "Garáže Ostrava, a.s. — Prokešovo náměstí",
        url: "http://www.garaze-ostrava.cz/?page_id=5",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    parkingId: "ostrava-cerna-louka-pg",
    canonicalName: "Černá Louka P+G",
    municipality: "Ostrava",
    cityPart: null,
    street: null,
    addressLine: null,
    postalCode: null,
    coordinates: null,
    parkingType: "P+G",
    parkAndRide: false,
    shortExplanation: null,
    aliases: Object.freeze([
      "cerna louka p+g",
      "p+g cerna louka",
    ]),
    sources: Object.freeze([
      {
        label: "Statutární město Ostrava — Výstaviště Černá louka",
        url: "https://ostrava.cz/cs/turista/sluzby/incentiva-konference/vystaviste-cerna-louka",
      },
    ]),
    lastVerified: PARKING_REGISTRY_LAST_VERIFIED,
  }),
]);

const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * Normalize parking name/alias for exact matching only.
 * @param {string|null|undefined} raw
 */
export function normalizeParkingAliasKey(raw) {
  let s = String(raw || "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/park\s*&\s*ride/g, "p+r")
    .replace(/\bp\s*\+\s*r\b/g, "p+r")
    .replace(/\bp\s+r\b/g, "p+r")
    .replace(/\bii\b/g, "2")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^p\+r\s+/, "p+r ");
  return s;
}

function aliasCandidatesFromName(name) {
  const key = normalizeParkingAliasKey(name);
  if (!key) return [];
  const out = new Set([key]);
  if (key.startsWith("p+r ")) {
    out.add(key.slice(4));
    out.add("pr " + key.slice(4));
  } else {
    out.add("p+r " + key);
  }
  return [...out];
}

const ALIAS_INDEX = (() => {
  /** @type {Map<string, ParkingRegistryEntry[]>} */
  const map = new Map();
  for (const entry of PARKING_REGISTRY) {
    const keys = new Set();
    keys.add(normalizeParkingAliasKey(entry.canonicalName));
    for (const a of entry.aliases) keys.add(normalizeParkingAliasKey(a));
    for (const k of keys) {
      if (!k) continue;
      const arr = map.get(k) || [];
      arr.push(entry);
      map.set(k, arr);
    }
  }
  return map;
})();

/**
 * Exact-alias registry match. Ambiguous → null.
 * @param {{ parkingName?: string|null, parkingId?: string|null, impact?: string|null, impactFull?: string|null, location?: string|null }} input
 * @returns {ParkingRegistryEntry|null}
 */
export function matchParkingRegistry(input = {}) {
  const parkingId = String(input.parkingId || input.facilityId || "").trim();
  if (parkingId) {
    const byId = PARKING_REGISTRY.find((e) => e.parkingId === parkingId);
    if (byId) return byId;
  }

  const nameHints = [
    input.parkingName,
    input.canonicalParkingName,
    input.location,
  ].filter(Boolean);

  // Pull P+R phrase from trusted NDIC comment when structured name missing.
  const blob = [input.impactFull, input.impact, input.summaryFull, input.summary]
    .filter(Boolean)
    .join(" | ");
  const pr = String(blob).match(/\bP\s*\+\s*R\s+([^,;.]{2,80})/i);
  if (pr) nameHints.push("P+R " + String(pr[1]).trim());

  /** @type {Map<string, ParkingRegistryEntry>} */
  const hits = new Map();
  for (const hint of nameHints) {
    for (const cand of aliasCandidatesFromName(hint)) {
      const entries = ALIAS_INDEX.get(cand);
      if (!entries || !entries.length) continue;
      if (entries.length > 1) return null; // ambiguous alias key
      hits.set(entries[0].parkingId, entries[0]);
    }
  }
  if (hits.size === 1) return [...hits.values()][0];
  return null; // none or conflicting facilities
}

/**
 * @param {string|null|undefined} name
 */
export function isAmbiguousParkingName(name) {
  const key = normalizeParkingAliasKey(name);
  if (!key) return false;
  // Bare "Černý Most" collides across Garáže Černý Most vs Černý Most 2 — no municipality-only row.
  if (key === "cerny most" || key === "p+r cerny most" || key === "pr cerny most") return true;
  return false;
}

/**
 * True when registry match is municipality-safe but facility address is intentionally withheld
 * (e.g. NDIC "P+R Zličín" without distinguishing lot 1 vs 2).
 */
export function isMunicipalityOnlyParkingMatch(entry) {
  return !!(entry && entry.addressLine == null && entry.parkingId === "praha-pr-zlicin");
}
