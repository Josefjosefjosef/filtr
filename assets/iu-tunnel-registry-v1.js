/**
 * Verified static urban tunnel registry (v1).
 *
 * Scope: enrichment only (municipality + canonical/alias identity).
 * Never overrides live NDIC event type, validity, lane/tube facts, or situation text.
 *
 * Matching is exact-alias only (after normalization). Ambiguous / bare place names → no match.
 * cityParts may be listed for documentation; presenter must not invent a single city-part.
 */

export const TUNNEL_REGISTRY_VERSION = "1.0.0";
export const TUNNEL_REGISTRY_LAST_VERIFIED = "2026-08-13";

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

/**
 * Prefer the source spelling when it is a verified alias of the matched entry.
 * @param {TunnelRegistryEntry} entry
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
