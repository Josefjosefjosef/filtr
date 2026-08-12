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
 *  parkingType: "P+R"|"PARKING",
 *  parkAndRide: boolean,
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
    aliases: Object.freeze(["p+r zlicin 2", "pr zlicin 2", "zlicin 2"]),
    sources: Object.freeze([
      {
        label: "Parking.praha.eu — P+R Zličín 2 (TSK / hl. m. Praha)",
        url: "https://parking.praha.eu/cs/moznosti-parkovani-v-praze/pr-park-ride/zlicin-2/",
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
  // Bare "zlicin" / "cerny most" collide across multiple registry rows.
  if (key === "zlicin" || key === "p+r zlicin" || key === "pr zlicin") return true;
  if (key === "cerny most" || key === "p+r cerny most" || key === "pr cerny most") return true;
  return false;
}
