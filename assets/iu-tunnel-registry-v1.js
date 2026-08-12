/**
 * Verified static tunnel registry (v1).
 *
 * Two logical layers in one module (shared normalize/match helpers):
 *  - TUNNEL_REGISTRY — urban / city tunnels → [MĚSTO] + name
 *  - OUTSIDE_CITY_TUNNEL_REGISTRY — tunnels outside cities → icon + name + road
 *
 * Scope: enrichment only (identity / stable object presentation).
 * Never overrides live NDIC event type, validity, lane/tube facts, or situation text.
 *
 * Matching is exact-alias only (after normalization). Ambiguous / bare place names → no match.
 * Outside-city list is sourced from ŘSD “Tunely na dálnicích a silnicích I. třídy”
 * (tunely v provozu). Urban I-class tunnels in Brno/Liberec/Jihlava are intentionally
 * omitted from the outside-city layer (city mode stays separate).
 */

export const TUNNEL_REGISTRY_VERSION = "1.1.0";
export const TUNNEL_REGISTRY_LAST_VERIFIED = "2026-08-13";

/** Official ŘSD map used for outside-city tunnel identity + road numbers. */
export const OUTSIDE_CITY_TUNNEL_SOURCE = Object.freeze({
  label: "ŘSD — Tunely na dálnicích a silnicích I. třídy (tunely v provozu, stav k 01/2026)",
  url: "https://kraje.rsd.cz/MAPY/infografika/tunely.pdf",
  mapPageUrl: "https://www.rsd.cz/mapy-ke-stazeni",
});

/** @typedef {{
 *  tunnelId: string,
 *  canonicalName: string,
 *  municipality: string,
 *  cityParts: readonly string[]|null,
 *  type: "tunnel",
 *  urban: true,
 *  aliases: readonly string[],
 *  sources: readonly {label:string, url:string}[],
 *  lastVerified: string,
 * }} TunnelRegistryEntry */

/** @typedef {{
 *  tunnelId: string,
 *  canonicalName: string,
 *  roadNumber: string|null,
 *  roadClassHint: "MOTORWAY"|"CLASS_I"|null,
 *  type: "tunnel",
 *  urban: false,
 *  aliases: readonly string[],
 *  sources: readonly {label:string, url:string}[],
 *  lastVerified: string,
 * }} OutsideCityTunnelRegistryEntry */

/** @type {readonly TunnelRegistryEntry[]} */
export const TUNNEL_REGISTRY = Object.freeze([
  Object.freeze({
    tunnelId: "praha-tunnel-bubenec",
    canonicalName: "Bubenečský tunel",
    municipality: "Praha",
    // Blanka section spans multiple Prague districts — do not auto-pick one.
    cityParts: null,
    type: "tunnel",
    urban: true,
    aliases: Object.freeze([
      "tunel bubenec",
      "bubenecsky tunel",
      "tunel bubenecsky",
    ]),
    sources: Object.freeze([
      {
        label: "Hl. m. Praha (MHMP) — Tunelový komplex Blanka (Bubenečský / Dejvický / Brusnický)",
        url: "https://praha.eu/w/nejen-dopravni-tepna-ale-i-dejiste-neuveritelnych-pribehu-tunelovy-komplex-blanka-slavi-deset-let",
      },
      {
        label: "TSK Praha — správa tunelů na území Prahy",
        url: "https://www.tsk-praha.cz/nase-cinnosti/tunely/",
      },
    ]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "praha-tunnel-dejvicky",
    canonicalName: "Dejvický tunel",
    municipality: "Praha",
    cityParts: null,
    type: "tunnel",
    urban: true,
    aliases: Object.freeze(["tunel dejvice", "tunel dejvicky", "dejvicky tunel"]),
    sources: Object.freeze([
      {
        label: "Hl. m. Praha (MHMP) — Tunelový komplex Blanka",
        url: "https://praha.eu/w/nejen-dopravni-tepna-ale-i-dejiste-neuveritelnych-pribehu-tunelovy-komplex-blanka-slavi-deset-let",
      },
    ]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "praha-tunnel-brusnicky",
    canonicalName: "Brusnický tunel",
    municipality: "Praha",
    cityParts: null,
    type: "tunnel",
    urban: true,
    aliases: Object.freeze(["tunel brusnice", "tunel brusnicky", "brusnicky tunel"]),
    sources: Object.freeze([
      {
        label: "Hl. m. Praha (MHMP) — Tunelový komplex Blanka",
        url: "https://praha.eu/w/nejen-dopravni-tepna-ale-i-dejiste-neuveritelnych-pribehu-tunelovy-komplex-blanka-slavi-deset-let",
      },
      {
        label: "Hl. m. Praha (MHMP) — dopravní opatření v tunelech (TSK)",
        url: "https://praha.eu/w/informace_o_dopravnich_opatrenich_v_88_2326778",
      },
    ]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "praha-tunnel-mrazovka",
    canonicalName: "Tunel Mrázovka",
    municipality: "Praha",
    cityParts: null,
    type: "tunnel",
    urban: true,
    aliases: Object.freeze(["tunel mrazovka", "mrazovka tunel"]),
    sources: Object.freeze([
      {
        label: "Hl. m. Praha (MHMP) — Dopravní opatření v tunelu Mrázovka (autor TSK)",
        url: "https://praha.eu/w/dopravni_opatreni_v_tunelu_mrazovka_40_3581671",
      },
      {
        label: "TSK Praha — správa tunelů na území Prahy",
        url: "https://www.tsk-praha.cz/nase-cinnosti/tunely/",
      },
    ]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "praha-tunnel-strahovsky",
    canonicalName: "Strahovský tunel",
    municipality: "Praha",
    cityParts: null,
    type: "tunnel",
    urban: true,
    aliases: Object.freeze(["tunel strahov", "tunel strahovsky", "strahovsky tunel"]),
    sources: Object.freeze([
      {
        label: "Hl. m. Praha (MHMP) — dopravní opatření v tunelech (odkaz na Strahovský tunel)",
        url: "https://praha.eu/w/informace_o_dopravnich_opatrenich_v_88_2326778",
      },
      {
        label: "TSK Praha — správa tunelů na území Prahy",
        url: "https://www.tsk-praha.cz/nase-cinnosti/tunely/",
      },
    ]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
]);

/**
 * Outside-city / motorway & I-class tunnels (not municipal urban tunnels).
 * Road numbers taken from ŘSD operational list; null only when not reliable.
 * Excludes Brno/Liberec/Jihlava urban I-class tunnels (city presentation stays separate).
 *
 * @type {readonly OutsideCityTunnelRegistryEntry[]}
 */
export const OUTSIDE_CITY_TUNNEL_REGISTRY = Object.freeze([
  Object.freeze({
    tunnelId: "cz-tunnel-panenska",
    canonicalName: "Tunel Panenská",
    roadNumber: "D8",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel panenska", "panenska tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-libouchec",
    canonicalName: "Tunel Libouchec",
    roadNumber: "D8",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel libouchec", "libouchec tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-radejcin",
    canonicalName: "Tunel Radejčín",
    roadNumber: "D8",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel radejcin", "radejcin tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-prackovice",
    canonicalName: "Tunel Prackovice",
    roadNumber: "D8",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel prackovice", "prackovice tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-klimkovice",
    canonicalName: "Tunel Klimkovice",
    roadNumber: "D1",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel klimkovice", "klimkovice tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-valik",
    canonicalName: "Tunel Valík",
    roadNumber: "D5",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel valik", "valik tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-pohurka",
    canonicalName: "Tunel Pohůrka",
    roadNumber: "D3",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel pohurka", "pohurka tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-lysuvky",
    canonicalName: "Tunel Lysůvky",
    roadNumber: "D48",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel lysuvky", "lysuvky tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-dolni-ujezd",
    canonicalName: "Tunel Dolní Újezd",
    roadNumber: "D35",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel dolni ujezd", "dolni ujezd tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-lochkov",
    canonicalName: "Tunel Lochkov",
    roadNumber: "D0",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze([
      "tunel lochkov",
      "lochkov tunel",
      "lochkovsky tunel",
      "tunel lochkovsky",
    ]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-cholupice",
    canonicalName: "Tunel Cholupice",
    roadNumber: "D0",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze([
      "tunel cholupice",
      "cholupice tunel",
      "komoransky tunel",
      "tunel komoransky",
    ]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-sabatka",
    canonicalName: "Tunel Šabatka",
    roadNumber: "D0",
    roadClassHint: "MOTORWAY",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel sabatka", "sabatka tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-hrebec",
    canonicalName: "Tunel Hřebeč",
    roadNumber: "I/35",
    roadClassHint: "CLASS_I",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel hrebec", "hrebec tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
  Object.freeze({
    tunnelId: "cz-tunnel-prchalov",
    canonicalName: "Tunel Prchalov",
    roadNumber: "I/58",
    roadClassHint: "CLASS_I",
    type: "tunnel",
    urban: false,
    aliases: Object.freeze(["tunel prchalov", "prchalov tunel"]),
    sources: Object.freeze([OUTSIDE_CITY_TUNNEL_SOURCE]),
    lastVerified: TUNNEL_REGISTRY_LAST_VERIFIED,
  }),
]);

const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * Normalize tunnel name/alias for exact matching only.
 * @param {string|null|undefined} raw
 */
export function normalizeTunnelAliasKey(raw) {
  let s = String(raw || "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/^ulice:?\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/**
 * Bare place names that must never alone identify a tunnel (false-positive guard).
 * @param {string|null|undefined} name
 */
export function isAmbiguousTunnelName(name) {
  const key = normalizeTunnelAliasKey(name);
  if (!key) return true;
  // District / area names without "tunel" — never match.
  if (key === "bubenec" || key === "dejvice" || key === "brusnice" || key === "strahov") {
    return true;
  }
  // Bare "mrazovka" is registered as an intentional alias of the tunnel facility;
  // keep it matchable via alias index, but reject empty/too-short tokens here.
  if (key.length < 4) return true;
  return false;
}

/** Bare place / municipality tokens — never alone identify an outside-city tunnel. */
const OUTSIDE_CITY_BARE_PLACE = new Set([
  "panenska",
  "libouchec",
  "radejcin",
  "prackovice",
  "klimkovice",
  "valik",
  "pohurka",
  "lysuvky",
  "dolni ujezd",
  "lochkov",
  "cholupice",
  "sabatka",
  "hrebec",
  "prchalov",
  "komorany",
]);

/**
 * @param {string|null|undefined} name
 */
export function isAmbiguousOutsideCityTunnelName(name) {
  const key = normalizeTunnelAliasKey(name);
  if (!key) return true;
  if (OUTSIDE_CITY_BARE_PLACE.has(key)) return true;
  if (key.length < 4) return true;
  return false;
}

/** Outside-city index keys must contain "tunel" (no bare-place identity). */
function isIndexableOutsideCityAliasKey(key) {
  if (!key || isAmbiguousOutsideCityTunnelName(key)) return false;
  return /\btunel\b/.test(key);
}

function aliasCandidatesFromName(name) {
  const key = normalizeTunnelAliasKey(name);
  if (!key || isAmbiguousTunnelName(key)) return [];
  const out = new Set([key]);
  // Only strip a leading "tunel " token — never invent "tunel X" from a bare place name.
  if (key.startsWith("tunel ")) {
    const rest = key.slice(6).trim();
    if (rest) out.add(rest);
  }
  return [...out].filter((k) => k && !isAmbiguousTunnelName(k));
}

const ALIAS_INDEX = (() => {
  /** @type {Map<string, TunnelRegistryEntry[]>} */
  const map = new Map();
  for (const entry of TUNNEL_REGISTRY) {
    const keys = new Set();
    keys.add(normalizeTunnelAliasKey(entry.canonicalName));
    for (const a of entry.aliases) keys.add(normalizeTunnelAliasKey(a));
    for (const k of keys) {
      if (!k || isAmbiguousTunnelName(k)) continue;
      const arr = map.get(k) || [];
      arr.push(entry);
      map.set(k, arr);
    }
  }
  return map;
})();

/**
 * Exact-alias registry match. Ambiguous → null.
 * @param {{
 *  namedObject?: string|null,
 *  tunnelName?: string|null,
 *  location?: string|null,
 *  impact?: string|null,
 *  impactFull?: string|null,
 *  summary?: string|null,
 *  summaryFull?: string|null,
 *  tunnelId?: string|null,
 * }} input
 * @returns {TunnelRegistryEntry|null}
 */
export function matchTunnelRegistry(input = {}) {
  const tunnelId = String(input.tunnelId || "").trim();
  if (tunnelId) {
    const byId = TUNNEL_REGISTRY.find((e) => e.tunnelId === tunnelId);
    if (byId) return byId;
  }

  const nameHints = [input.namedObject, input.tunnelName, input.location].filter(Boolean);

  const blob = [input.impactFull, input.impact, input.summaryFull, input.summary]
    .filter(Boolean)
    .join(" | ");
  // Leading tunnel clause before municipality / tube list.
  const lead = String(blob).split(/[,;]/)[0] || "";
  if (/tunel/i.test(lead)) nameHints.push(lead.replace(/^ulice:?\s+/i, "").trim());
  const tunelPhrase =
    String(blob).match(/\b([A-ZÁ-Ž][\p{L}\-]*(?:\s+[A-ZÁ-Ž][\p{L}\-]*){0,3}\s+[Tt]unel)\b/u) ||
    String(blob).match(/\b([Tt]unel\s+[A-ZÁ-Ž][\p{L}0-9\-]+)\b/u);
  if (tunelPhrase) nameHints.push(String(tunelPhrase[1]).trim());

  /** @type {Map<string, TunnelRegistryEntry>} */
  const hits = new Map();
  for (const hint of nameHints) {
    if (isAmbiguousTunnelName(hint)) continue;
    for (const cand of aliasCandidatesFromName(hint)) {
      const entries = ALIAS_INDEX.get(cand);
      if (!entries || !entries.length) continue;
      if (entries.length > 1) return null;
      hits.set(entries[0].tunnelId, entries[0]);
    }
  }
  if (hits.size === 1) return [...hits.values()][0];
  return null;
}

const OUTSIDE_CITY_ALIAS_INDEX = (() => {
  /** @type {Map<string, OutsideCityTunnelRegistryEntry[]>} */
  const map = new Map();
  for (const entry of OUTSIDE_CITY_TUNNEL_REGISTRY) {
    const keys = new Set();
    keys.add(normalizeTunnelAliasKey(entry.canonicalName));
    for (const a of entry.aliases) keys.add(normalizeTunnelAliasKey(a));
    for (const k of keys) {
      if (!isIndexableOutsideCityAliasKey(k)) continue;
      const arr = map.get(k) || [];
      arr.push(entry);
      map.set(k, arr);
    }
  }
  return map;
})();

function outsideCityAliasCandidatesFromName(name) {
  const key = normalizeTunnelAliasKey(name);
  if (!key || isAmbiguousOutsideCityTunnelName(key)) return [];
  const out = new Set();
  if (isIndexableOutsideCityAliasKey(key)) out.add(key);
  if (key.startsWith("tunel ")) {
    const rest = key.slice(6).trim();
    const flipped = rest ? rest + " tunel" : "";
    if (isIndexableOutsideCityAliasKey(key)) out.add(key);
    if (flipped && isIndexableOutsideCityAliasKey(flipped)) out.add(flipped);
  } else if (key.endsWith(" tunel")) {
    const rest = key.slice(0, -6).trim();
    const flipped = rest ? "tunel " + rest : "";
    if (isIndexableOutsideCityAliasKey(key)) out.add(key);
    if (flipped && isIndexableOutsideCityAliasKey(flipped)) out.add(flipped);
  }
  return [...out];
}

/**
 * Exact-alias outside-city registry match. Ambiguous → null.
 * Does not match urban registry entries.
 * @param {{
 *  namedObject?: string|null,
 *  tunnelName?: string|null,
 *  location?: string|null,
 *  impact?: string|null,
 *  impactFull?: string|null,
 *  summary?: string|null,
 *  summaryFull?: string|null,
 *  tunnelId?: string|null,
 * }} input
 * @returns {OutsideCityTunnelRegistryEntry|null}
 */
export function matchOutsideCityTunnelRegistry(input = {}) {
  const tunnelId = String(input.tunnelId || "").trim();
  if (tunnelId) {
    const byId = OUTSIDE_CITY_TUNNEL_REGISTRY.find((e) => e.tunnelId === tunnelId);
    if (byId) return byId;
  }

  const nameHints = [input.namedObject, input.tunnelName, input.location].filter(Boolean);

  const blob = [input.impactFull, input.impact, input.summaryFull, input.summary]
    .filter(Boolean)
    .join(" | ");
  const lead = String(blob).split(/[,;]/)[0] || "";
  if (/tunel/i.test(lead)) nameHints.push(lead.replace(/^ulice:?\s+/i, "").trim());
  const tunelPhrase =
    String(blob).match(/\b([A-ZÁ-Ž][\p{L}\-]*(?:\s+[A-ZÁ-Ž][\p{L}\-]*){0,3}\s+[Tt]unel)\b/u) ||
    String(blob).match(/\b([Tt]unel\s+[A-ZÁ-Ž][\p{L}0-9\-]+(?:\s+[A-ZÁ-Ž][\p{L}0-9\-]+)?)\b/u);
  if (tunelPhrase) nameHints.push(String(tunelPhrase[1]).trim());

  /** @type {Map<string, OutsideCityTunnelRegistryEntry>} */
  const hits = new Map();
  for (const hint of nameHints) {
    if (isAmbiguousOutsideCityTunnelName(hint)) continue;
    for (const cand of outsideCityAliasCandidatesFromName(hint)) {
      const entries = OUTSIDE_CITY_ALIAS_INDEX.get(cand);
      if (!entries || !entries.length) continue;
      if (entries.length > 1) return null;
      hits.set(entries[0].tunnelId, entries[0]);
    }
  }
  if (hits.size === 1) return [...hits.values()][0];
  return null;
}

/**
 * Prefer the source spelling when it is a verified alias of the matched entry.
 * @param {TunnelRegistryEntry|OutsideCityTunnelRegistryEntry} entry
 * @param {string|null|undefined} sourceName
 */
export function resolveTunnelDisplayName(entry, sourceName) {
  if (!entry) return null;
  const src = String(sourceName || "")
    .replace(/^ulice:?\s+/i, "")
    .trim();
  if (!src) return entry.canonicalName;
  const srcKey = normalizeTunnelAliasKey(src);
  if (!srcKey || isAmbiguousTunnelName(srcKey)) return entry.canonicalName;
  if (srcKey === normalizeTunnelAliasKey(entry.canonicalName)) return entry.canonicalName;
  for (const a of entry.aliases) {
    if (normalizeTunnelAliasKey(a) === srcKey) return src;
  }
  // Also accept "tunel X" vs "X tunel" surface forms of the same key.
  for (const cand of aliasCandidatesFromName(src)) {
    if (cand === normalizeTunnelAliasKey(entry.canonicalName)) return src;
    for (const a of entry.aliases) {
      if (cand === normalizeTunnelAliasKey(a)) return src;
    }
  }
  return entry.canonicalName;
}
