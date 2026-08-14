/**
 * Authoritative named SMV (silnice pro motorová vozidla) registry.
 *
 * Scope: local / municipal motor-vehicle roads that are NOT state-numbered
 * class roads (those stay on ŘSD ULS Layer 5 via smv-uls-resolver).
 *
 * Matching: municipality + exact road-name alias (normalized).
 * Never activates on substring "spojka" alone.
 * Never overrides explicit DATEX motorVehicleRoadConfirmed=false.
 *
 * Presentation only: sets structured SMV confirmation + canonical display name.
 * Does not invent event type, validity, or situation text.
 */

export const SMV_NAMED_ROAD_REGISTRY_VERSION = "1.0.0";
export const SMV_NAMED_ROAD_REGISTRY_LAST_VERIFIED = "2026-08-14";

/** @typedef {{
 *  roadId: string,
 *  canonicalName: string,
 *  municipality: string,
 *  municipalityAliases: readonly string[],
 *  motorVehicleRoad: true,
 *  aliases: readonly string[],
 *  scope: string,
 *  sectionDependent: false,
 *  sources: readonly {label:string, url:string, asOf?:string}[],
 *  lastVerified: string,
 * }} SmvNamedRoadRegistryEntry */

/**
 * Praha — Jižní spojka (Městský okruh segment).
 * Local class-I motor road marked as silnice pro motorová vozidla (IP 15a / IZ 2a).
 * Not on ŘSD state ULS Layer 5 (municipal), hence named registry.
 */
/** @type {readonly SmvNamedRoadRegistryEntry[]} */
export const SMV_NAMED_ROAD_REGISTRY = Object.freeze([
  Object.freeze({
    roadId: "praha-jizni-spojka",
    canonicalName: "Jižní spojka",
    municipality: "Praha",
    municipalityAliases: Object.freeze([
      "praha",
      "hlavni mesto praha",
      "hlavní město praha",
      "praha hl.m.",
      "praha hl. m.",
    ]),
    motorVehicleRoad: true,
    aliases: Object.freeze([
      "jizni spojka",
      "jižní spojka",
      "ulice jizni spojka",
      "ulice jižní spojka",
      "ul. jizni spojka",
      "ul. jižní spojka",
    ]),
    scope:
      "Named street Jižní spojka in Praha (Barrandovský most – Štěrboholy / MO southern segment); whole named road is SMV-signed local motor road.",
    sectionDependent: false,
    sources: Object.freeze([
      {
        label:
          "České dálnice — Městský okruh (MO): místní rychlostní komunikace označované značkou Silnice pro motorová vozidla; Jižní spojka = MO úsek",
        url: "https://ceske-dalnice.webnode.cz/rychlostni-silnice/r-mo/",
        asOf: "2026-08-14",
      },
      {
        label:
          "Zákon č. 13/1997 Sb. § 6 odst. 3 — místní komunikace I. třídy může být označena jako silnice pro motorová vozidla",
        url: "https://www.zakonyprolidi.cz/cs/1997-13",
        asOf: "2021-01-01",
      },
      {
        label: "TSK Praha — správa / rekonstrukce Jižní spojky (městská kapacitní komunikace MO)",
        url: "https://www.tsk-praha.cz/",
        asOf: "2024",
      },
    ]),
    lastVerified: SMV_NAMED_ROAD_REGISTRY_LAST_VERIFIED,
  }),
]);

function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeSmvNamedRoadAliasKey(raw) {
  return stripDiacritics(String(raw || ""))
    .toLowerCase()
    .replace(/^ulice:?\s+/i, "")
    .replace(/^ul\.\s*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSmvNamedMunicipalityKey(raw) {
  return stripDiacritics(String(raw || ""))
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPrahaMunicipalityKey(key) {
  if (!key) return false;
  if (key === "praha") return true;
  if (key.startsWith("praha ") && /^(praha hl|praha hlavni)/.test(key)) return true;
  if (key === "hlavni mesto praha" || key.startsWith("hlavni mesto praha")) return true;
  return false;
}

const ALIAS_INDEX = (() => {
  /** @type {Map<string, SmvNamedRoadRegistryEntry[]>} */
  const map = new Map();
  for (const entry of SMV_NAMED_ROAD_REGISTRY) {
    const keys = new Set();
    keys.add(normalizeSmvNamedRoadAliasKey(entry.canonicalName));
    for (const a of entry.aliases) keys.add(normalizeSmvNamedRoadAliasKey(a));
    for (const k of keys) {
      if (!k) continue;
      const arr = map.get(k) || [];
      arr.push(entry);
      map.set(k, arr);
    }
  }
  return map;
})();

function municipalityMatchesEntry(municipalityRaw, entry) {
  const key = normalizeSmvNamedMunicipalityKey(municipalityRaw);
  if (!key) return false;
  for (const a of entry.municipalityAliases) {
    if (key === normalizeSmvNamedMunicipalityKey(a)) return true;
  }
  if (normalizeSmvNamedMunicipalityKey(entry.municipality) === key) return true;
  // Praha city-part tokens (Praha 4) still count as Praha for this registry.
  if (isPrahaMunicipalityKey(normalizeSmvNamedMunicipalityKey(entry.municipality))) {
    if (/^praha(\s+\d+)?$/.test(key) || isPrahaMunicipalityKey(key)) return true;
  }
  return false;
}

/**
 * Exact-alias + municipality match. Ambiguous / bare "spojka" → null.
 * @param {{
 *  municipality?: string|null,
 *  street?: string|null,
 *  roadName?: string|null,
 *  namedObject?: string|null,
 *  location?: string|null,
 *  impact?: string|null,
 *  impactFull?: string|null,
 *  summary?: string|null,
 *  summaryFull?: string|null,
 *  roadId?: string|null,
 * }} input
 * @returns {SmvNamedRoadRegistryEntry|null}
 */
export function matchSmvNamedRoadRegistry(input = {}) {
  const roadId = String(input.roadId || "").trim();
  if (roadId) {
    const byId = SMV_NAMED_ROAD_REGISTRY.find((e) => e.roadId === roadId);
    if (byId) {
      if (input.municipality && !municipalityMatchesEntry(input.municipality, byId)) return null;
      return byId;
    }
  }

  const muni = String(input.municipality || "").trim();
  if (!muni) return null;

  const nameHints = [input.street, input.roadName, input.namedObject, input.location].filter(Boolean);
  const blob = [input.impactFull, input.impact, input.summaryFull, input.summary]
    .filter(Boolean)
    .join(" | ");
  // Prefer leading clause (common NDIC: "Jižní spojka, Praha, …").
  const lead = String(blob).split(/[,;]/)[0] || "";
  if (lead) nameHints.push(lead.replace(/^ulice:?\s+/i, "").trim());

  /** @type {Map<string, SmvNamedRoadRegistryEntry>} */
  const hits = new Map();
  for (const hint of nameHints) {
    const key = normalizeSmvNamedRoadAliasKey(hint);
    if (!key) continue;
    // Hard ban: bare "spojka" must never activate SMV.
    if (key === "spojka") continue;
    const entries = ALIAS_INDEX.get(key);
    if (!entries || !entries.length) continue;
    if (entries.length > 1) return null;
    const entry = entries[0];
    if (!municipalityMatchesEntry(muni, entry)) continue;
    hits.set(entry.roadId, entry);
  }
  if (hits.size === 1) return [...hits.values()][0];
  return null;
}
