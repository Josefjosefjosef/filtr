/**
 * Unified ŘSD/NDIC traffic card presentation (deterministic, no invented facts).
 * Layers: RAW source fields → normalized trafficV1 → CARD SUMMARY → EXPANDED DETAIL.
 *
 * Official NDIC publicComment often carries km/směr/ulice/P+R while structured
 * card fields are null — parse only substrings present in that trusted text.
 *
 * Parking static context (municipality/address/P+R type) may be enriched from the
 * verified parking registry — never overrides live NDIC occupancy/status.
 */

import {
  matchParkingRegistry,
  PARK_AND_RIDE_EXPLANATION_CS,
} from "./iu-parking-registry-v1.js?v=ndic-parking-hl-nadrazi-muni-v1-20260812";

export {
  matchParkingRegistry,
  PARK_AND_RIDE_EXPLANATION_CS,
  PARKING_REGISTRY,
  PARKING_REGISTRY_VERSION,
  normalizeParkingAliasKey,
  isAmbiguousParkingName,
} from "./iu-parking-registry-v1.js?v=ndic-parking-hl-nadrazi-muni-v1-20260812";

export const TRAFFIC_SIGN_ASSET = Object.freeze({
  MOTORWAY: "/assets/images/traffic-road-motorway.png",
  MOTOR_VEHICLES: "/assets/images/traffic-road-motor-vehicles.png",
  TRAFFIC_JAM: "/assets/images/traffic-event-traffic-jam.png",
  ACCIDENT: "/assets/images/traffic-event-accident.png",
  ROADWORKS: "/assets/images/traffic-event-roadworks.png",
  CLOSURE: "/assets/images/traffic-event-closure.png",
  WARNING: "/assets/images/traffic-event-warning.png",
  PARKING: "/assets/images/traffic-parking.png",
});

export const TRAFFIC_MAP_DOT_CSS_VAR = "--iu-pd-dot";

export const ROAD_NUMBER_BADGE = Object.freeze({
  MOTORWAY: "motorway",
  ROAD: "road",
  E_ROAD: "e-road",
  LOCAL: "local",
  UNKNOWN: "unknown",
});

/** Explicit location typing — never silently coerce between kinds. */
export const LOCATION_KIND = Object.freeze({
  STREET: "STREET",
  TUNNEL: "TUNNEL",
  BRIDGE: "BRIDGE",
  INTERSECTION: "INTERSECTION",
  SQUARE: "SQUARE",
  STATION: "STATION",
  PARKING: "PARKING",
  ROAD: "ROAD",
  ROAD_SECTION: "ROAD_SECTION",
  LANDMARK: "LANDMARK",
  MUNICIPALITY: "MUNICIPALITY",
  CITY_PART: "CITY_PART",
  GENERIC_LOCALITY: "GENERIC_LOCALITY",
  UNKNOWN: "UNKNOWN",
});

export const EVENT_KIND = Object.freeze({
  ACCIDENT: "accident",
  QUEUE: "queue",
  HEAVY_TRAFFIC: "heavy_traffic",
  ROADWORKS: "roadworks",
  CLOSURE: "closure",
  OBSTACLE: "obstacle",
  PARKING: "parking",
  WARNING: "warning",
});

/** Restriction / closure scope — independent of primary cause. */
export const RESTRICTION_SCOPE = Object.freeze({
  FULL_ROAD_CLOSED: "FULL_ROAD_CLOSED",
  DIRECTION_CLOSED: "DIRECTION_CLOSED",
  ALL_LANES_CLOSED: "ALL_LANES_CLOSED",
  SINGLE_LANE_CLOSED: "SINGLE_LANE_CLOSED",
  MULTIPLE_BUT_NOT_ALL_LANES_CLOSED: "MULTIPLE_BUT_NOT_ALL_LANES_CLOSED",
  SHOULDER_CLOSED: "SHOULDER_CLOSED",
  HARD_SHOULDER_CLOSED: "HARD_SHOULDER_CLOSED",
  VERGE_CLOSED: "VERGE_CLOSED",
  UNKNOWN: "UNKNOWN_RESTRICTION_SCOPE",
  NONE: "NONE",
});

/** Primary cause of the situation (what happened). */
export const PRIMARY_CAUSE = Object.freeze({
  ACCIDENT: "ACCIDENT",
  BROKEN_VEHICLE: "BROKEN_VEHICLE",
  OBSTACLE: "OBSTACLE",
  ROADWORKS: "ROADWORKS",
  FULL_CLOSURE: "FULL_CLOSURE",
  QUEUE: "QUEUE",
  HEAVY_TRAFFIC: "HEAVY_TRAFFIC",
  OTHER: "OTHER",
});

/** Traffic-flow condition (secondary to cause). */
export const TRAFFIC_CONDITION = Object.freeze({
  QUEUE: "QUEUE",
  HEAVY_TRAFFIC: "HEAVY_TRAFFIC",
  DELAY: "DELAY",
  PASS_WITH_CARE: "PASS_WITH_CARE",
  NONE: "NONE",
});

const EVENT_KIND_META = Object.freeze({
  [EVENT_KIND.ACCIDENT]: {
    titleCs: "NEHODA",
    asset: TRAFFIC_SIGN_ASSET.ACCIDENT,
    illustrationKey: "nehoda",
  },
  [EVENT_KIND.QUEUE]: {
    titleCs: "KOLONA",
    asset: TRAFFIC_SIGN_ASSET.TRAFFIC_JAM,
    illustrationKey: "kolona",
  },
  [EVENT_KIND.HEAVY_TRAFFIC]: {
    titleCs: "SILNÝ PROVOZ",
    asset: TRAFFIC_SIGN_ASSET.TRAFFIC_JAM,
    illustrationKey: "kolona",
  },
  [EVENT_KIND.ROADWORKS]: {
    titleCs: "PRÁCE NA SILNICI",
    asset: TRAFFIC_SIGN_ASSET.ROADWORKS,
    illustrationKey: "prace",
  },
  [EVENT_KIND.CLOSURE]: {
    titleCs: "UZAVÍRKA",
    asset: TRAFFIC_SIGN_ASSET.CLOSURE,
    illustrationKey: "uzavirka",
  },
  [EVENT_KIND.OBSTACLE]: {
    titleCs: "PŘEKÁŽKA NA VOZOVCE",
    asset: TRAFFIC_SIGN_ASSET.WARNING,
    illustrationKey: "prekazka",
  },
  [EVENT_KIND.PARKING]: {
    titleCs: "PARKOVIŠTĚ",
    asset: TRAFFIC_SIGN_ASSET.PARKING,
    illustrationKey: "neutral",
  },
  [EVENT_KIND.WARNING]: {
    titleCs: "DOPRAVNÍ OMEZENÍ",
    asset: TRAFFIC_SIGN_ASSET.WARNING,
    illustrationKey: "omezeni",
  },
});

const EMPTY_IMPACT_RE =
  /^(dopravní událost je evidována\.?|dopravní informace\.?|evidováno\.?)$/i;

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function czechPlural(n, one, few, many) {
  const x = Math.abs(Number(n));
  if (!Number.isFinite(x)) return many;
  if (x === 1) return one;
  if (x >= 2 && x <= 4) return few;
  return many;
}

function formatKmToken(raw) {
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) return clean(raw).replace(".", ",");
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(Math.round(n * 10) / 10).replace(".", ",");
}

/**
 * Czech local datetime for UI (never raw ISO/UTC).
 */
export function formatCsDateTime(isoOrDate) {
  const ms = isoOrDate instanceof Date ? isoOrDate.getTime() : Date.parse(String(isoOrDate || ""));
  if (!Number.isFinite(ms)) return "";
  const day = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(ms);
  const time = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
  return day + " v " + time;
}

export function expandTrafficAbbreviationsCs(text) {
  let s = clean(text);
  if (!s) return "";
  s = s.replace(/\b(\d+)\s*[×xX]\s*OA\b/g, (_, n) => {
    const num = Number(n);
    return num + " " + czechPlural(num, "osobní automobil", "osobní automobily", "osobních automobilů");
  });
  s = s.replace(/\b(\d+)\s+OA\b/g, (_, n) => {
    const num = Number(n);
    return num + " " + czechPlural(num, "osobní automobil", "osobní automobily", "osobních automobilů");
  });
  s = s.replace(/\bpro\s+OA\b/gi, "pro osobní automobily");
  s = s.replace(/\bOA\b/g, "osobní automobil");
  s = s.replace(/\b(\d+)\s*[×xX]\s*NA\b/g, (_, n) => {
    const num = Number(n);
    return num + " " + czechPlural(num, "nákladní automobil", "nákladní automobily", "nákladních automobilů");
  });
  s = s.replace(/\bpro\s+NA\b/gi, "pro nákladní automobily");
  s = s.replace(/\bNA\b/g, "nákladní automobil");
  return s;
}

function streetBareName(raw) {
  return clean(raw)
    .replace(/^ulice:?\s+/i, "")
    .replace(/^v\s+ulici\s+/i, "");
}

/**
 * Morphology heuristic for rejecting municipality-board candidates.
 * NEVER alone sufficient to invent a street ("ulice: …").
 */
export function looksLikeStreetName(raw) {
  const t = clean(raw);
  if (!t) return false;
  // Squares / embankments are named places — not streets.
  if (/náměstí|nábřeží/i.test(t)) return false;
  if (/tunel|\bmost\b|MÚK\b|křižovatka|nádraží|terminál|parkovišt|parkovací\s+dům/i.test(t)) {
    return false;
  }
  if (/\btřída\b/i.test(t)) return true;
  if (/^praha\s+\d/i.test(t)) return false;
  if (/\s/.test(t)) {
    if (/\ba\b/i.test(t)) return false;
    return /(ská|cká|ovská)(?:\s|$)/i.test(t);
  }
  return /(ská|cká|ovská|ová|ova|ná|ní)$/i.test(t);
}

/** True when a token must not become the white municipality entrance board. */
export function looksLikeNonMunicipalityPlace(raw) {
  const t = clean(raw);
  if (!t) return false;
  if (/náměstí|nábřeží|tunel|\bmost\b|MÚK\b|křižovatka|nádraží|terminál|parkovišt|parkovací\s+dům/i.test(t)) {
    return true;
  }
  return looksLikeStreetName(t);
}

/**
 * Sanitize municipality name captured after "v obci" / "v katastru obce".
 * Keeps full multi-word official names; strips leaked traffic clauses.
 */
export function normalizeExtractedMunicipalityName(raw) {
  let city = clean(raw);
  if (!city) return null;
  if (
    /^(?:nehoda|uzavř|práce|silný|kolona|porouchan|mimořádn|havarovan|překážk|průjezd|stavební|omezen|zúžení|provoz|Od\s+\d|Do\s+\d)/i.test(
      city
    )
  ) {
    return null;
  }
  city = city.replace(
    /\s+(?:nehoda|uzavř|práce|silný|kolona|porouchan|mimořádn|havarovan|překážk|průjezd|stavební|omezen|zúžení|provoz|Od\s+\d|Do\s+\d).*$/i,
    ""
  );
  city = clean(city);
  if (!city) return null;
  if (!/^[A-ZÁ-Ž]/u.test(city)) return null;
  if (looksLikeRoadNumberToken(city)) return null;
  if (/^p\s*\+\s*r\b/i.test(city)) return null;
  if (/^ulice\b|\btřída\b/i.test(city)) return null;
  if (/^okres\b|^okr\./i.test(city)) return null;
  if (looksLikeNonMunicipalityPlace(city)) return null;
  return city;
}

/**
 * Prefer the fuller official multi-word municipality when structured field was
 * truncated to the first token (e.g. "České" vs "České Budějovice").
 */
export function preferFullerMunicipalityName(structured, fromComment) {
  const a = clean(structured);
  const b = clean(fromComment);
  if (!a) return b || null;
  if (!b) return a;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return a;
  if (bl.startsWith(al + " ") || bl.startsWith(al + "-")) return b;
  if (al.startsWith(bl + " ") || al.startsWith(bl + "-")) return a;
  return a;
}

export function classifyLocationKindFromName(name) {
  const t = clean(name);
  if (!t) return LOCATION_KIND.UNKNOWN;
  if (/parkovací\s+dům|parkovišt|\bP\s*\+\s*[RG]\b/i.test(t)) return LOCATION_KIND.PARKING;
  if (/tunel/i.test(t)) return LOCATION_KIND.TUNNEL;
  if (/\bmost\b/i.test(t)) return LOCATION_KIND.BRIDGE;
  if (/MÚK\b|křižovatka/i.test(t)) return LOCATION_KIND.INTERSECTION;
  if (/náměstí/i.test(t)) return LOCATION_KIND.SQUARE;
  if (/nádraží|terminál/i.test(t)) return LOCATION_KIND.STATION;
  if (/^ulice\b|\btřída\b/i.test(t)) return LOCATION_KIND.STREET;
  if (looksLikeRoadNumberToken(t)) return LOCATION_KIND.ROAD;
  if (/^praha\s+\d/i.test(t)) return LOCATION_KIND.CITY_PART;
  if (looksLikeStreetName(t)) return LOCATION_KIND.GENERIC_LOCALITY;
  return LOCATION_KIND.LANDMARK;
}

/**
 * Named transport / place object from trusted NDIC text.
 * Never treats "směr X" as the primary object. Never invents a street.
 */
export function extractNamedTransportObject(rawText) {
  const text = clean(rawText);
  if (!text) return null;

  // Prefer the leading clause before municipality / city-part list.
  const lead = clean(text.split(/[,;]/)[0] || "");
  if (
    lead &&
    !looksLikeRoadNumberToken(lead) &&
    !/^praha\s+\d/i.test(lead) &&
    !/^od\s+\d/i.test(lead) &&
    /tunel|\bmost\b|MÚK\b|křižovatka|nádraží|terminál|náměstí|parkovací\s+dům/i.test(lead)
  ) {
    return { name: lead, kind: classifyLocationKindFromName(lead) };
  }

  // Full-text scan with direction clauses removed (avoid "směr Barrandovský most").
  const scan = text.replace(/\bsměr(?:em)?\s+[^,;.]{2,80}/gi, " ");
  const tunnel =
    scan.match(/\b([A-ZÁ-Ž][\p{L}\-]*(?:\s+[A-ZÁ-Ž][\p{L}\-]*){0,3}\s+[Tt]unel)\b/u) ||
    scan.match(/\b([Tt]unel\s+[A-ZÁ-Ž][\p{L}0-9\-]+)\b/u);
  if (tunnel) {
    const name = clean(tunnel[1]);
    return { name, kind: LOCATION_KIND.TUNNEL };
  }
  const bridge = scan.match(
    /\b((?:[A-ZÁ-Ž][\p{L}\-]+(?:ský|cký|ický)?\s+)?[Mm]ost(?:\s+[A-ZÁ-Ž][\p{L}0-9\-]+)?)\b/u
  );
  if (bridge) {
    const name = clean(bridge[1]);
    // Reject bare "most" (e.g. "most ev. č. D0-202") — need a proper bridge name.
    if (!/^most$/i.test(name) && name.length >= 4) {
      return { name, kind: LOCATION_KIND.BRIDGE };
    }
  }
  const muk = scan.match(/\b(MÚK\s+[^,;.]{2,60})/i);
  if (muk) return { name: clean(muk[1]), kind: LOCATION_KIND.INTERSECTION };
  const square = scan.match(/\b([A-ZÁ-Ž][\p{L}\-]*(?:\s+[A-ZÁ-Ž][\p{L}\-]*){0,3}\s+náměstí)\b/u);
  if (square) return { name: clean(square[1]), kind: LOCATION_KIND.SQUARE };

  return null;
}

/**
 * Street only with evidence: explicit "ulice:" / "v ulici" in comment, or structured street
 * that is not merely a copy of generic locationLabel / TMC area name.
 */
export function resolveConfirmedStreet(input = {}, factsIn = null) {
  const facts = factsIn || parseOfficialCommentFacts(sourceBlob(input));
  if (facts.street) return streetBareName(facts.street);
  if (facts.streetMulti) return null;

  const structured = streetBareName(input.streetHint || input.street);
  if (!structured) return null;
  const location = clean(input.location);
  // Never treat generic locationLabel / TMC area as street.
  if (location && samePlaceName(structured, location)) return null;
  const named = facts.namedObject || extractNamedTransportObject(sourceBlob(input));
  if (named && samePlaceName(structured, named.name)) return null;
  if (looksLikeNonMunicipalityPlace(structured) && !/\btřída\b/i.test(structured)) {
    // Structured value that is clearly a named non-street object.
    const kind = classifyLocationKindFromName(structured);
    if (
      kind === LOCATION_KIND.TUNNEL ||
      kind === LOCATION_KIND.BRIDGE ||
      kind === LOCATION_KIND.SQUARE ||
      kind === LOCATION_KIND.INTERSECTION ||
      kind === LOCATION_KIND.STATION ||
      kind === LOCATION_KIND.PARKING
    ) {
      return null;
    }
  }
  // Accept structured street only when comment contains street evidence markers,
  // or when structured is distinct from location and has street morphology + no named object.
  const blob = sourceBlob(input);
  if (/\bulice:?\s+/i.test(blob) || /\bv\s+ulici\s+/i.test(blob)) return structured;
  return null;
}

function looksLikeRoadNumberToken(raw) {
  const t = clean(raw);
  if (!t) return false;
  return /^(?:[DIE]\s*)?\d+[A-Za-z]?$/i.test(t) || /^(?:I{1,3}|D|E|R)\/\d+/i.test(t);
}

/** User-facing road aliases (presentation only — never rewrite raw NDIC text). */
export const ROAD_DISPLAY_NAME_BY_ROAD = Object.freeze({
  D0: "Pražský okruh",
});

/**
 * Stable display name for a road number (e.g. D0 → Pražský okruh).
 * Returns null when no verified alias exists.
 */
export function resolveRoadDisplayName(road) {
  const r = clean(road)
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!r) return null;
  return ROAD_DISPLAY_NAME_BY_ROAD[r] || null;
}

function splitStreetList(raw) {
  return String(raw || "")
    .split(/\s*,\s*/)
    .map(streetBareName)
    .filter(Boolean);
}

function formatParkingStatusLabel(facts) {
  if (!facts) return null;
  if (facts.parkingFullyOccupied) return "PLNĚ OBSAZENO";
  if (facts.parkingOccupancyPercent != null && Number.isFinite(facts.parkingOccupancyPercent)) {
    return String(facts.parkingOccupancyPercent) + " % OBSAZENO";
  }
  return null;
}

function structuredParkingFullyOccupied(input = {}) {
  const occ = input.parkingOccupancy;
  if (occ == null) return false;
  if (typeof occ === "string") {
    const s = clean(occ);
    if (/^(full|fully[_\s-]?occupied|pln[eě]\s*obsazeno|occupied)$/i.test(s)) return true;
  }
  if (Number(occ) === 100 && Number.isFinite(Number(occ))) return true;
  const free =
    input.parkingAvailableSpaces != null
      ? Number(input.parkingAvailableSpaces)
      : input.freeSpaces != null
        ? Number(input.freeSpaces)
        : null;
  if (Number(occ) === 100 && free === 0) return true;
  return false;
}

/**
 * Single occupancy resolver for collapsed + expanded parking UI.
 * Priority: percent(+free bound) → few spaces left → explicit fully occupied → structured free → fallback.
 * Never invents occupancy. Never appends datetime into status text.
 */
export function resolveParkingLiveStatus(input = {}, factsIn = null) {
  const facts = factsIn || parseOfficialCommentFacts(sourceBlob(input));
  const fully =
    facts.parkingFullyOccupied === true || structuredParkingFullyOccupied(input) === true;

  if (facts.parkingOccupancyPercent != null && Number.isFinite(facts.parkingOccupancyPercent)) {
    const bits = [facts.parkingOccupancyPercent + " % obsazeno"];
    if (facts.parkingFreeUpperBound != null) {
      bits.push("Méně než " + facts.parkingFreeUpperBound + " volných parkovacích míst");
    } else if (facts.parkingFewSpacesLeft) {
      bits.push("Posledních pár volných parkovacích míst");
    }
    return {
      collapsedText: finalizeSentences(bits),
      statusLabel: formatParkingStatusLabel({
        ...facts,
        parkingFullyOccupied: false,
        parkingOccupancyPercent: facts.parkingOccupancyPercent,
      }),
      freeUpperBound: facts.parkingFreeUpperBound,
      kind: "percent",
      known: true,
    };
  }

  if (facts.parkingFewSpacesLeft) {
    return {
      collapsedText: "Posledních pár volných parkovacích míst.",
      statusLabel: null,
      freeUpperBound: facts.parkingFreeUpperBound,
      kind: "few_left",
      known: true,
    };
  }

  if (fully) {
    return {
      collapsedText: "PLNĚ OBSAZENO",
      statusLabel: "PLNĚ OBSAZENO",
      freeUpperBound: facts.parkingFreeUpperBound,
      kind: "full",
      known: true,
    };
  }

  if (facts.parkingFreeUpperBound != null) {
    const text =
      "Méně než " + facts.parkingFreeUpperBound + " volných parkovacích míst.";
    return {
      collapsedText: text,
      statusLabel: null,
      freeUpperBound: facts.parkingFreeUpperBound,
      kind: "free_bound",
      known: true,
    };
  }

  const freeRaw =
    input.parkingAvailableSpaces != null
      ? input.parkingAvailableSpaces
      : input.freeSpaces != null
        ? input.freeSpaces
        : null;
  if (freeRaw != null && Number.isFinite(Number(freeRaw))) {
    return {
      collapsedText: "Volných míst: " + String(Number(freeRaw)),
      statusLabel: null,
      freeUpperBound: null,
      kind: "free_count",
      known: true,
    };
  }

  return {
    collapsedText: "Informace o obsazenosti parkoviště.",
    statusLabel: null,
    freeUpperBound: null,
    kind: "unknown",
    known: false,
  };
}

const PARKING_CITY_SUFFIX_RE =
  /\s+(Praha|Brno|Ostrava|Plzeň|Olomouc|Liberec|Pardubice|Zlín|Kladno|Havířov|Opava|Frýdek-Místek|České Budějovice|Hradec Králové|Ústí nad Labem)$/i;

const PARKING_OCCUPANCY_CLAUSE_RE =
  /(?:\d{1,3}\s*%\s*obsazeno|pln[eě]\s+obsazeno|méně než\s+\d+\s+volných|posledních\s+pár\s+volných)/i;

/** Trailing NDIC clock / validity stamp often glued into publicComment. */
const TRAILING_NDIC_DATETIME_RE =
  /(?:,?\s*)?(?:\d{1,2}\.\s*)?(?:\d{1,2}\.\s*)?\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/;

/**
 * Collapse consecutive exact duplicate comma/segment phrases in presentation text.
 * Does not rewrite authoritative raw source storage — presentation only.
 */
export function dedupePresentationPhrases(raw) {
  const text = clean(raw);
  if (!text) return "";
  const parts = text
    .split(/\s*,\s*/)
    .map((p) => clean(p))
    .filter(Boolean);
  const out = [];
  let prevKey = "";
  for (const p of parts) {
    const key = p.toLowerCase().replace(/\s+/g, " ");
    if (key && key === prevKey) continue;
    out.push(p);
    prevKey = key;
  }
  return out.join(", ");
}

export function stripTrailingNdicDateTime(raw) {
  let s = clean(raw);
  if (!s) return "";
  s = s.replace(TRAILING_NDIC_DATETIME_RE, "");
  return clean(s.replace(/[,\s]+$/g, ""));
}

function stripOccupancyAndMetaTail(nameRaw) {
  let n = clean(nameRaw);
  if (!n) return "";
  n = stripTrailingNdicDateTime(n);
  n = n.replace(/\s*[,–—-]\s*$/g, "");
  n = n.replace(
    /\s*[,–—-]?\s*(?:\d{1,3}\s*%\s*obsazeno|pln[eě]\s+obsazeno|méně než\s+\d+\s+volných(?:\s+parkovacích\s+míst)?|posledních\s+pár\s+volných(?:\s+parkovacích\s+míst)?)\s*$/i,
    ""
  );
  return clean(n);
}

/**
 * True when text is primarily a road/restriction event that merely mentions parking.
 */
export function isParkingFalsePositiveRoadEvent(rawText, input = {}) {
  const text = clean(rawText);
  if (!text) return false;
  const type = clean(input.eventType || input.category).toLowerCase();
  const hasOccClause = PARKING_OCCUPANCY_CLAUSE_RE.test(text);
  if (type === "nehoda" || type === "prace" || type === "uzavirka" || type === "kolona") {
    // Strong typed road events win unless the blob is clearly occupancy-only.
    if (!hasOccClause && !/\bP\s*\+\s*[RG]\b/i.test(text)) return true;
  }
  if (/\bparkovací(?:ho)?\s+pruhu?\b/i.test(text)) return true;
  // Closure / works near a parking facility (name alone is not occupancy status).
  if (
    !hasOccClause &&
    /\bparkovac/i.test(text) &&
    /\b(uzavřen[íýáo]|uzavírk|neprůjezdn|objížďk|stavební práce|práce na silnici|oprava povrchu)\b/i.test(text)
  ) {
    return true;
  }
  if (/\b(uzavřen[íýáo]|uzavírk).{0,40}parkovac/i.test(text) && !hasOccClause) return true;
  if (
    /\b(stavební práce|práce na silnici|oprava povrchu|práce na inženýrských).{0,60}parkovišt/i.test(text) &&
    !hasOccClause
  ) {
    return true;
  }
  if (/\bparkovišt.{0,40}(uzavřen|neprůjezdn|objížďk)/i.test(text) && !hasOccClause) return true;
  if (/\bnehoda\b/i.test(text) && !hasOccClause) return true;
  if (/\búpln[áa]\s+uzavírk/i.test(text) && !hasOccClause) return true;
  return false;
}

/**
 * Deterministic parking-occupancy situation detector (not keyword-only).
 */
export function isParkingOccupancySituation(input = {}, factsIn = null) {
  const blob = sourceBlob(input);
  const facts = factsIn || parseOfficialCommentFacts(blob);
  if (isParkingFalsePositiveRoadEvent(blob, input)) return false;

  const type = clean(input.eventType || input.category).toLowerCase();
  const illustrationKey = clean(input.illustrationKey).toLowerCase();
  if (type === "parkoviste" || type === "parking" || illustrationKey === "parking") return true;

  if (
    input.parkingAvailableSpaces != null ||
    input.parkingCapacity != null ||
    input.freeSpaces != null ||
    input.parkingOccupancy != null
  ) {
    return true;
  }

  const hasOcc =
    facts.parkingOccupancyPercent != null ||
    facts.parkingFullyOccupied === true ||
    facts.parkingFreeUpperBound != null ||
    facts.parkingFewSpacesLeft === true ||
    PARKING_OCCUPANCY_CLAUSE_RE.test(blob);

  // P+R / P+G facility status from NDIC (often occupancy-bearing; type marker is authoritative).
  if (/\bP\s*\+\s*[RG]\b/i.test(blob) || facts.parkingType === "P+R" || facts.parkingType === "P+G") {
    return true;
  }
  // Named facility / parking house only with occupancy (or structured parking fields above).
  // Bare "Parkovací dům … uzavírka" must stay a road event — see false-positive guard.
  if (facts.parkingName && hasOcc) return true;
  if (/\bparkovací\s+dům\b/i.test(blob) && hasOcc) return true;
  if (/\bparkovišt/i.test(blob) && hasOcc) return true;
  // Named place + occupancy clause (e.g. "Prokešovo náměstí, 60% obsazeno") without road event language.
  if (hasOcc && !/\b(silnice|dálnice|km\s+\d|ve směru|uzavírk|kolona|nehoda|objížďk)\b/i.test(blob)) {
    return true;
  }
  return false;
}

/**
 * Extract only facts that appear in trusted NDIC publicComment / impact text.
 */
export function parseOfficialCommentFacts(rawText) {
  const text = clean(rawText);
  const out = {
    kilometerFrom: null,
    kilometerTo: null,
    kilometerLabel: null,
    directionHuman: null,
    street: null,
    streetMulti: false,
    city: null,
    cityPart: null,
    district: null,
    parkingName: null,
    parkingCity: null,
    parkingType: null,
    parkingOccupancyPercent: null,
    parkingFullyOccupied: false,
    parkingFreeUpperBound: null,
    parkingFewSpacesLeft: false,
    queueLengthKm: null,
    heavyTrafficLengthKm: null,
    situationPhrases: [],
    isEmptyTemplate: false,
    namedObject: null,
    namedObjectKind: null,
    locationKind: LOCATION_KIND.UNKNOWN,
  };
  if (!text) return out;
  if (EMPTY_IMPACT_RE.test(text)) {
    out.isEmptyTemplate = true;
    return out;
  }

  const named = extractNamedTransportObject(text);
  if (named) {
    out.namedObject = named.name;
    out.namedObjectKind = named.kind;
    out.locationKind = named.kind;
  }

  const kmRange =
    text.match(/\bkm\s+(\d+(?:[.,]\d+)?)\s*(?:až|–|-|—)\s*(\d+(?:[.,]\d+)?)/i) ||
    text.match(/\bmezi\s+km\s+(\d+(?:[.,]\d+)?)\s+a\s+(\d+(?:[.,]\d+)?)/i);
  if (kmRange) {
    // Preserve source order (e.g. km 277,5–276,9) — never Math.min/max sort.
    out.kilometerFrom = formatKmToken(kmRange[1]);
    out.kilometerTo = formatKmToken(kmRange[2]);
    out.kilometerLabel = "km " + out.kilometerFrom + "–" + out.kilometerTo;
  } else {
    const kmOne = text.match(/\bkm\s+(\d+(?:[.,]\d+)?)\b/i);
    if (kmOne) {
      out.kilometerFrom = formatKmToken(kmOne[1]);
      out.kilometerLabel = "km " + out.kilometerFrom;
    }
  }

  const dir = text.match(/\bve směru\s+([^,;.]{2,60})/i);
  if (dir) {
    const d = clean(dir[1]).replace(/\s+/g, " ");
    if (d && !/^(kladný|záporný)\s+směr$/i.test(d)) out.directionHuman = d;
  }

  const mObci = text.match(
    /\b(?:[Vv]\s+katastru\s+obce|[Vv]\s+obci|\bobec)\s+([^,;]{2,80}?)(?=\s*(?:okres\b|okr\.|kraj\b|ulice\b|v\s+ulici\b|[,;]|$))/u
  );
  if (mObci) {
    const city = normalizeExtractedMunicipalityName(mObci[1]);
    if (city) out.city = city;
  }

  const streetIn =
    text.match(/\bv\s+ulici\s+([^,;]{2,80})/i) || text.match(/\bulice:?\s+([^,;]{2,80})/i);
  if (streetIn) {
    let sn = streetBareName(streetIn[1]);
    sn = clean(sn.split(/\s+v\s+obci\b/i)[0]);
    sn = clean(sn.split(/\s+okres\b/i)[0]);
    if (sn) out.street = sn;
  }

  const okr = text.match(/\bokr\.\s*([^,;]{2,60})/i) || text.match(/\bokres\s+([^,;]{2,60})/i);
  if (okr) out.district = clean(okr[1]);

  // Multi-street lists: never pick one street as the whole-event locality.
  const multiStreetBlob = text.match(/\bulice:?\s+((?:[^,;]+,\s*){2,}[^,;.]+)/i);
  if (multiStreetBlob) {
    const parts = splitStreetList(multiStreetBlob[1]);
    const streetish = parts.filter((p) => looksLikeStreetName(p) || /náměstí/i.test(p));
    if (streetish.length >= 2 && streetish.length >= Math.ceil(parts.length * 0.6)) {
      out.streetMulti = true;
      out.street = null;
    }
  }

  // "ulice X, CityPart, City," pattern (Hornopolní) — only when City is a real municipality.
  const locTrip = text.match(
    /\bulice:?\s+([^,;]+),\s*([^,;]+),\s*([^,;]+?)(?=\s*,|\s*$)/u
  );
  if (locTrip && !out.streetMulti) {
    const s0 = streetBareName(locTrip[1]);
    const s1 = clean(locTrip[2]);
    const s2 = normalizeExtractedMunicipalityName(locTrip[3]);
    const cityOk = !!s2;
    const midOk = s1 && (!looksLikeStreetName(s1) || /\s/.test(s1));
    if (cityOk && midOk) {
      out.street = s0;
      out.cityPart = s1;
      if (!out.city) out.city = s2;
    }
  }

  if (!out.city) {
    const cityHint = text.match(/,\s*([^,;]+?)\s*,\s*okr\./u);
    if (cityHint) {
      const hint = normalizeExtractedMunicipalityName(cityHint[1]);
      if (hint) out.city = hint;
    }
  }

  // "Praha 4, Praha" / "Praha 13, Praha"
  const prahaPart = text.match(/\b(Praha\s+\d+[a-zA-Z]?)\s*,\s*Praha\b/u);
  if (prahaPart) {
    out.cityPart = clean(prahaPart[1]);
    if (!out.city) out.city = "Praha";
  }

  // --- Parking facility + occupancy (P+R / P+G / house / named place) ---
  const pr = text.match(/\bP\s*\+\s*R\s+([^,;]{2,80})/i);
  if (pr) {
    let prName = stripOccupancyAndMetaTail(pr[1]);
    const citySuffix = prName.match(PARKING_CITY_SUFFIX_RE);
    if (citySuffix) {
      out.parkingCity = clean(citySuffix[1]);
      prName = clean(prName.slice(0, citySuffix.index));
    }
    if (prName) {
      out.parkingName = "P+R " + prName;
      out.parkingType = "P+R";
    }
  }

  if (!out.parkingName) {
    // Prefer "Name, P+G" — avoid \\b before Czech letters (JS \\b is ASCII-word only).
    const pgBefore =
      text.match(/([A-ZÁ-Ž0-9][^,;]{1,58}?)\s*,\s*P\s*\+\s*G\b/iu) ||
      text.match(/([A-ZÁ-Ž0-9][^,;]{1,58}?)\s+P\s*\+\s*G\b/iu);
    const pgAfter = text.match(/\bP\s*\+\s*G\s+([0-9A-ZÁ-Ž][^,;–—-]{1,80})/iu);
    if (pgBefore) {
      let n = stripOccupancyAndMetaTail(pgBefore[1]);
      if (n && !/^p\s*\+\s*[rg]$/i.test(n)) {
        out.parkingName = n + " P+G";
        out.parkingType = "P+G";
      }
    } else if (pgAfter) {
      let n = stripOccupancyAndMetaTail(pgAfter[1]);
      const citySuffix = n.match(PARKING_CITY_SUFFIX_RE);
      if (citySuffix) {
        out.parkingCity = clean(citySuffix[1]);
        n = clean(n.slice(0, citySuffix.index));
      }
      if (n) {
        out.parkingName = n + " P+G";
        out.parkingType = "P+G";
      }
    }
  }

  if (!out.parkingName) {
    const house = text.match(/\bParkovací\s+dům\s+([^,;]{2,80})/i);
    if (house) {
      let n = stripOccupancyAndMetaTail(house[1]);
      if (n) {
        out.parkingName = "Parkovací dům " + n;
        out.parkingType = "PARKING_HOUSE";
      }
    }
  }

  if (/\bplně\s+obsazeno\b/i.test(text)) out.parkingFullyOccupied = true;
  const occ = text.match(/(\d{1,3})\s*%\s*obsazeno/i);
  if (occ) out.parkingOccupancyPercent = Number(occ[1]);
  const freeBound = text.match(/méně než\s+(\d+)\s+volných/i);
  if (freeBound) out.parkingFreeUpperBound = Number(freeBound[1]);
  if (/posledních\s+pár\s+volných/i.test(text)) out.parkingFewSpacesLeft = true;

  if (!out.parkingName && PARKING_OCCUPANCY_CLAUSE_RE.test(text)) {
    // "Prokešovo náměstí, 60% obsazeno" / "Smetanovo náměstí – posledních pár…"
    const named = text.match(
      /^(.{2,80}?)(?:\s*[,–—-]\s*|\s+)(?=\d{1,3}\s*%\s*obsazeno|pln[eě]\s+obsazeno|méně než\s+\d+\s+volných|posledních\s+pár\s+volných)/i
    );
    if (named) {
      let n = stripOccupancyAndMetaTail(named[1]);
      n = n.replace(/\s*,\s*P\s*\+\s*[RG]\s*$/i, "");
      if (
        n &&
        n.length >= 2 &&
        !/^(od|do|vydal|aktualizováno)$/i.test(n) &&
        !looksLikeRoadNumberToken(n) &&
        !/^km\b/i.test(n)
      ) {
        out.parkingName = n;
        if (!out.parkingType) out.parkingType = "NAMED_PARKING";
      }
    }
  }

  const q = text.match(/\bkolona\s+(\d+(?:[.,]\d+)?)\s*km\b/i);
  if (q) out.queueLengthKm = Number(String(q[1]).replace(",", "."));
  const heavyLen =
    text.match(/silný\s+provoz(?:\s+v\s+délce)?\s+(\d+(?:[.,]\d+)?)\s*km\b/i) ||
    text.match(/(\d+(?:[.,]\d+)?)\s*km\s+siln(?:ý|ého)\s+provoz/i);
  if (heavyLen) out.heavyTrafficLengthKm = Number(String(heavyLen[1]).replace(",", "."));

  const phraseRes = [
    /práce na inženýrských sítích/i,
    /provoz převeden do protisměru/i,
    /zúžení vozovky na [^,;]{3,40}/i,
    /neprůjezdn[ýáé]\s+[^,;]{3,40}/i,
    /silný provoz/i,
    /pozor!\s*tvoří se kolona[^,;]{0,40}/i,
    /tvoří se kolona[^,;]{0,40}/i,
    /kolona\s+\d+(?:[.,]\d+)?\s*km/i,
    /úplná uzavírka(?:\s+ul\.)?[^,;]{0,60}/i,
    /uzavřen[ýáo]\s+[^,;]{3,40}/i,
    /oprava povrchu[^,;]{0,40}/i,
    /stavební práce/i,
    /práce na silnici/i,
    /havárie[^,;]{0,40}/i,
    /porouchané vozidlo/i,
    /průjezd se zvýšenou opatrností/i,
  ];
  for (const re of phraseRes) {
    const m = text.match(re);
    if (m) out.situationPhrases.push(clean(m[0]));
  }

  return out;
}

function sourceBlob(input) {
  return clean(
    [input.impactFull, input.summaryFull, input.impact, input.summary].filter(Boolean).join(" | ")
  );
}

export function classifyRoadPresentation(roadNumber, opts = {}) {
  const road = clean(roadNumber);
  const motorVehicleConfirmed =
    opts.motorVehicleRoadConfirmed === true ||
    opts.isMotorVehicleRoad === true ||
    String(opts.motorVehicleRoadStatus || "").toLowerCase() === "true" ||
    String(opts.roadFacilityType || "").toUpperCase() === "MOTOR_VEHICLE_ROAD";

  if (!road) {
    return {
      road: "",
      roadClass: "UNKNOWN",
      roadDisplayName: null,
      numberBadge: ROAD_NUMBER_BADGE.UNKNOWN,
      roadTypeIcon: null,
      roadTypeIconAlt: "",
      showMotorwayIcon: false,
      showMotorVehiclesIcon: false,
    };
  }
  const roadDisplayName = resolveRoadDisplayName(road);
  if (/^E\d+[A-Za-z]?$/i.test(road) || /^E\s*\d+/i.test(road)) {
    return {
      road,
      roadClass: "E_ROAD",
      roadDisplayName,
      numberBadge: ROAD_NUMBER_BADGE.E_ROAD,
      roadTypeIcon: null,
      roadTypeIconAlt: "",
      showMotorwayIcon: false,
      showMotorVehiclesIcon: false,
    };
  }
  if (/^D\d+[A-Za-z]?$/i.test(road) || /^R\d+/i.test(road) || /^Dálnice\s*D?\d+/i.test(road)) {
    return {
      road,
      roadClass: "MOTORWAY",
      roadDisplayName,
      numberBadge: ROAD_NUMBER_BADGE.MOTORWAY,
      roadTypeIcon: TRAFFIC_SIGN_ASSET.MOTORWAY,
      roadTypeIconAlt: "Dálnice",
      showMotorwayIcon: true,
      showMotorVehiclesIcon: false,
    };
  }
  let roadClass = "LOCAL";
  if (/^III\/\d+/i.test(road)) roadClass = "CLASS_III";
  else if (/^II\/\d+/i.test(road)) roadClass = "CLASS_II";
  else if (/^I\/\d+/i.test(road)) roadClass = "CLASS_I";
  else if (/^\d{1,3}[A-Za-z]?$/i.test(road)) roadClass = "CLASS_I";

  if (roadClass === "LOCAL") {
    return {
      road,
      roadClass,
      roadDisplayName,
      numberBadge: ROAD_NUMBER_BADGE.LOCAL,
      roadTypeIcon: null,
      roadTypeIconAlt: "",
      showMotorwayIcon: false,
      showMotorVehiclesIcon: false,
    };
  }
  return {
    road,
    roadClass,
    roadDisplayName,
    numberBadge: ROAD_NUMBER_BADGE.ROAD,
    roadTypeIcon: motorVehicleConfirmed ? TRAFFIC_SIGN_ASSET.MOTOR_VEHICLES : null,
    roadTypeIconAlt: motorVehicleConfirmed ? "Silnice pro motorová vozidla" : "",
    showMotorwayIcon: false,
    showMotorVehiclesIcon: motorVehicleConfirmed,
  };
}

/**
 * Explicit queue / convoy language only — never silný provoz / zdržení alone.
 */
export function hasExplicitQueueSource(rawText) {
  const text = clean(rawText);
  if (!text) return false;
  if (/tvoří se kolona|stojící kolona|kolonový provoz/i.test(text)) return true;
  if (/\bkolona\s+\d+(?:[.,]\d+)?\s*km\b/i.test(text)) return true;
  // Bare "kolona" as a clause token, not inside unrelated words.
  if (/(?:^|[,;.\s])kolona(?:[,;.\s]|$)/i.test(text)) return true;
  return false;
}

/**
 * Hard/soft shoulder or verge closure — not a full carriageway closure.
 */
export function isShoulderOrVergeRestriction(rawText) {
  const text = clean(rawText);
  if (!text) return false;
  const closedNear =
    /(?:uzavřen[áaýéo]|uzavřená|neprůjezdn[áaýéo]|neprůjezdná)/i;
  if (
    /zpevněn[áa]\s+krajnice|odstavn[ýáé]\s+pruh|hard\s+shoulder/i.test(text) &&
    closedNear.test(text)
  ) {
    return true;
  }
  if (/\bkrajnice\b/i.test(text) && closedNear.test(text) && !/\bjízdní\s+pruh/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Single (or named) lane closed/blocked — not whole road/direction.
 */
export function isSingleLaneRestriction(rawText) {
  const text = clean(rawText);
  if (!text) return false;
  if (
    /(?:levý|pravý|střední|jeden)\s+jízdní\s+pruh.{0,40}(?:uzavřen|neprůjezdn)/i.test(text) ||
    /(?:uzavřen|neprůjezdn).{0,40}(?:levý|pravý|střední|jeden)\s+jízdní\s+pruh/i.test(text) ||
    /neprůjezdn[ýáé]\s+(?:levý|pravý|střední)\s+jízdní\s+pruh/i.test(text)
  ) {
    return true;
  }
  return false;
}

/**
 * True full-scope closure of road / direction / all lanes.
 */
export function isFullScopeClosure(rawText) {
  const text = clean(rawText);
  if (!text) return false;
  if (isShoulderOrVergeRestriction(text) && !/úpln[áa]\s+uzavírk/i.test(text)) {
    // Shoulder-only text is never full scope unless also explicit full closure.
    if (!/(komunikace|silnice|dálnice|most).{0,30}(?:zcela\s+)?uzavřen/i.test(text)) {
      return false;
    }
  }
  if (isSingleLaneRestriction(text) && !/úpln[áa]\s+uzavírk/i.test(text)) {
    if (
      !/(komunikace|silnice|dálnice).{0,30}(?:zcela\s+)?uzavřen/i.test(text) &&
      !/oba\s+směry.{0,20}uzavř/i.test(text) &&
      !/všechny\s+jízdní\s+pruhy.{0,20}uzavř/i.test(text)
    ) {
      return false;
    }
  }
  // Avoid \\b with Czech diacritics (JS \\w is ASCII-only).
  if (/úpln[áa]\s+uzavírk/i.test(text)) return true;
  if (/komunikace\s+(?:je\s+)?(?:zcela\s+)?uzavřen/i.test(text)) return true;
  if (/(?:silnice|dálnice|most)\s+(?:je\s+)?(?:zcela\s+)?uzavřen/i.test(text)) return true;
  if (/uzavřen[áao]\s+pro\s+veškerou\s+dopravu/i.test(text)) return true;
  if (/oba\s+směry.{0,30}uzavř/i.test(text)) return true;
  if (/všechny\s+jízdní\s+pruhy.{0,30}(?:uzavř|neprůjezdn)/i.test(text)) return true;
  if (/neprůjezdn[áaý]\s+(?:komunikace|silnice|dálnice|úsek)\b/i.test(text)) return true;
  return false;
}

export function analyzeRestrictionScope(rawText) {
  const text = clean(rawText);
  if (!text) return RESTRICTION_SCOPE.NONE;

  if (
    /zpevněn[áa]\s+krajnice|odstavn[ýáé]\s+pruh/i.test(text) &&
    /(?:uzavřen|neprůjezdn)/i.test(text)
  ) {
    return RESTRICTION_SCOPE.HARD_SHOULDER_CLOSED;
  }
  if (/\bkrajnice\b/i.test(text) && /(?:uzavřen|neprůjezdn)/i.test(text) && !/\bjízdní\s+pruh/i.test(text)) {
    return RESTRICTION_SCOPE.SHOULDER_CLOSED;
  }
  if (/\btravn|sekání|zatravněn/i.test(text) && /\bkrajnice\b/i.test(text) && /uzavřen/i.test(text)) {
    return RESTRICTION_SCOPE.VERGE_CLOSED;
  }
  if (isFullScopeClosure(text)) {
    if (/oba\s+směry/i.test(text) || /uzavřen.{0,40}ve směru|ve směru.{0,40}uzavřen/i.test(text)) {
      if (/oba\s+směry/i.test(text)) return RESTRICTION_SCOPE.FULL_ROAD_CLOSED;
      // Direction closed only when not merely a single lane in that direction.
      if (!isSingleLaneRestriction(text)) return RESTRICTION_SCOPE.DIRECTION_CLOSED;
    }
    if (/všechny\s+jízdní\s+pruhy/i.test(text)) return RESTRICTION_SCOPE.ALL_LANES_CLOSED;
    return RESTRICTION_SCOPE.FULL_ROAD_CLOSED;
  }
  if (isSingleLaneRestriction(text)) return RESTRICTION_SCOPE.SINGLE_LANE_CLOSED;
  if (/\bdva\s+jízdní\s+pruhy.{0,20}(?:uzavř|neprůjezdn)/i.test(text)) {
    return RESTRICTION_SCOPE.MULTIPLE_BUT_NOT_ALL_LANES_CLOSED;
  }
  if (/(?:uzavřen|neprůjezdn|uzavírk)/i.test(text)) return RESTRICTION_SCOPE.UNKNOWN;
  return RESTRICTION_SCOPE.NONE;
}

export function analyzeTrafficCondition(rawText) {
  const text = clean(rawText);
  if (!text) return TRAFFIC_CONDITION.NONE;
  if (hasExplicitQueueSource(text)) return TRAFFIC_CONDITION.QUEUE;
  if (/silný provoz|hustý provoz/i.test(text)) return TRAFFIC_CONDITION.HEAVY_TRAFFIC;
  if (/průjezd se zvýšenou opatrností/i.test(text)) return TRAFFIC_CONDITION.PASS_WITH_CARE;
  if (/zdržení/i.test(text)) return TRAFFIC_CONDITION.DELAY;
  return TRAFFIC_CONDITION.NONE;
}

export function analyzePrimaryCause(rawText, input = {}) {
  const text = clean(rawText);
  const type = clean(input.eventType || input.category).toLowerCase();
  const illustrationKey = clean(input.illustrationKey).toLowerCase();

  if (
    type === "nehoda" ||
    illustrationKey === "nehoda" ||
    /\baccident\b/.test(type) ||
    /\bnehoda\b/i.test(text) ||
    /\bhavarovan/i.test(text)
  ) {
    return PRIMARY_CAUSE.ACCIDENT;
  }
  if (
    /porouchan(?:é|ý|á)?\s+vozidlo|porucha\s+NA|\bdefekt\b/i.test(text) ||
    (/porouchan/i.test(text) && /\b(NA|nákladní|vozidlo)\b/i.test(text))
  ) {
    return PRIMARY_CAUSE.BROKEN_VEHICLE;
  }
  if (
    type === "prekazka" ||
    illustrationKey === "prekazka" ||
    /překážka\s+na\s+vozovce/i.test(text)
  ) {
    return PRIMARY_CAUSE.OBSTACLE;
  }
  if (
    type === "prace" ||
    illustrationKey === "prace" ||
    /roadwork|maintenance|construction/.test(type) ||
    /práce na silnici|stavební práce|údržba\s+(?:a\s+opravy|trav)|sekání\s+trávy|pracovní\s+místo|pomalu jedoucí vozidlo údržby/i.test(
      text
    )
  ) {
    return PRIMARY_CAUSE.ROADWORKS;
  }
  if (isFullScopeClosure(text) || type === "uzavirka" || illustrationKey === "uzavirka") {
    // Typed uzavirka alone is not enough if blob is shoulder/lane-only.
    if (isFullScopeClosure(text)) return PRIMARY_CAUSE.FULL_CLOSURE;
    if (
      (type === "uzavirka" || illustrationKey === "uzavirka") &&
      !isShoulderOrVergeRestriction(text) &&
      !isSingleLaneRestriction(text)
    ) {
      return PRIMARY_CAUSE.FULL_CLOSURE;
    }
  }
  if (hasExplicitQueueSource(text)) return PRIMARY_CAUSE.QUEUE;
  if (/silný provoz|hustý provoz/i.test(text)) return PRIMARY_CAUSE.HEAVY_TRAFFIC;
  return PRIMARY_CAUSE.OTHER;
}

function packEventKind(kind, facts, analysis, titleOverride) {
  const base = { ...EVENT_KIND_META[kind], kind };
  if (titleOverride) base.titleCs = titleOverride;
  return {
    ...base,
    facts,
    primaryCause: analysis.primaryCause,
    restrictionScope: analysis.restrictionScope,
    trafficCondition: analysis.trafficCondition,
  };
}

export function classifyEventPresentation(input = {}) {
  const type = clean(input.eventType || input.category).toLowerCase();
  const illustrationKey = clean(input.illustrationKey).toLowerCase();
  const blob = sourceBlob(input);
  const facts = parseOfficialCommentFacts(blob);

  const primaryCause = analyzePrimaryCause(blob, input);
  const restrictionScope = analyzeRestrictionScope(blob);
  const trafficCondition = analyzeTrafficCondition(blob);
  const analysis = { primaryCause, restrictionScope, trafficCondition };

  const pack = (kind, titleOverride) => packEventKind(kind, facts, analysis, titleOverride);

  // Parking occupancy / facility status — before generic omezeni/warning fallback.
  if (isParkingOccupancySituation(input, facts)) {
    return pack(EVENT_KIND.PARKING, "PARKOVIŠTĚ");
  }

  // --- Cause-first classification (scope/condition are secondary layers) ---
  if (primaryCause === PRIMARY_CAUSE.ACCIDENT) {
    return pack(EVENT_KIND.ACCIDENT);
  }

  if (primaryCause === PRIMARY_CAUSE.BROKEN_VEHICLE) {
    return pack(EVENT_KIND.OBSTACLE, "POROUCHANÉ VOZIDLO");
  }
  if (primaryCause === PRIMARY_CAUSE.OBSTACLE) {
    return pack(EVENT_KIND.OBSTACLE);
  }

  if (primaryCause === PRIMARY_CAUSE.ROADWORKS) {
    return pack(EVENT_KIND.ROADWORKS);
  }

  // Full-scope closure only — never from shoulder / single-lane wording alone.
  if (
    primaryCause === PRIMARY_CAUSE.FULL_CLOSURE ||
    restrictionScope === RESTRICTION_SCOPE.FULL_ROAD_CLOSED ||
    restrictionScope === RESTRICTION_SCOPE.DIRECTION_CLOSED ||
    restrictionScope === RESTRICTION_SCOPE.ALL_LANES_CLOSED
  ) {
    if (
      restrictionScope !== RESTRICTION_SCOPE.SINGLE_LANE_CLOSED &&
      restrictionScope !== RESTRICTION_SCOPE.HARD_SHOULDER_CLOSED &&
      restrictionScope !== RESTRICTION_SCOPE.SHOULDER_CLOSED &&
      restrictionScope !== RESTRICTION_SCOPE.VERGE_CLOSED &&
      (isFullScopeClosure(blob) ||
        ((type === "uzavirka" || illustrationKey === "uzavirka") &&
          !isShoulderOrVergeRestriction(blob) &&
          !isSingleLaneRestriction(blob)))
    ) {
      return pack(EVENT_KIND.CLOSURE);
    }
  }

  // Explicit queue only — never silný provoz / zdržení / NDIC type=kolona alone.
  if (
    (primaryCause === PRIMARY_CAUSE.QUEUE || trafficCondition === TRAFFIC_CONDITION.QUEUE) &&
    hasExplicitQueueSource(blob)
  ) {
    return pack(EVENT_KIND.QUEUE);
  }

  if (
    primaryCause === PRIMARY_CAUSE.HEAVY_TRAFFIC ||
    trafficCondition === TRAFFIC_CONDITION.HEAVY_TRAFFIC
  ) {
    return pack(EVENT_KIND.HEAVY_TRAFFIC);
  }

  // NDIC typed categories when blob did not yield a stronger cause.
  if (type === "prace" || illustrationKey === "prace") return pack(EVENT_KIND.ROADWORKS);
  if (type === "nehoda" || illustrationKey === "nehoda") return pack(EVENT_KIND.ACCIDENT);
  if (
    (type === "uzavirka" || illustrationKey === "uzavirka") &&
    !isShoulderOrVergeRestriction(blob) &&
    !isSingleLaneRestriction(blob)
  ) {
    return pack(EVENT_KIND.CLOSURE);
  }
  if (type === "prekazka" || illustrationKey === "prekazka") return pack(EVENT_KIND.OBSTACLE);
  if (type === "kolona" || illustrationKey === "kolona") {
    if (hasExplicitQueueSource(blob)) return pack(EVENT_KIND.QUEUE);
    // NDIC type=kolona must not upgrade silný provoz / zdržení into KOLONA.
    if (/silný provoz|hustý provoz/i.test(blob)) return pack(EVENT_KIND.HEAVY_TRAFFIC);
    if (/zdržení/i.test(blob)) {
      // Fall through — delay alone is not a queue.
    } else {
      // Empty blob or other text: trust structural DATEX/NDIC type.
      return pack(EVENT_KIND.QUEUE);
    }
  }

  if (type === "omezeni" || type === "objizdka" || type === "sjizdnost" || type === "doprava") {
    return pack(EVENT_KIND.WARNING);
  }
  return pack(EVENT_KIND.WARNING);
}

/**
 * True when the card has practical user information for the main feed.
 */
export function isTrafficCardInformative(input = {}) {
  const blob = sourceBlob(input);
  const facts = parseOfficialCommentFacts(blob);
  if (facts.isEmptyTemplate && !input.road && !input.municipality && !input.location) return false;
  if (facts.isEmptyTemplate && EMPTY_IMPACT_RE.test(clean(input.impact || input.impactFull || ""))) {
    // Template-only with no richer place context → hide from main overview.
    if (!facts.kilometerLabel && !facts.directionHuman && !facts.street && !facts.parkingName) {
      return false;
    }
  }
  return true;
}

function stripBoilerplate(text) {
  let s = clean(text);
  if (!s) return "";
  s = s.replace(/\bOd\s+\d{1,2}\.\s*\d{1,2}\.\s*\d{4}[^,]{0,40},?\s*/gi, "");
  s = s.replace(/\bDo\s+\d{1,2}\.\s*\d{1,2}\.\s*\d{4}[^,]{0,40},?\s*/gi, "");
  s = s.replace(/\bVydal:\s*[^,]{2,80}/gi, "");
  s = s.replace(/…+/g, " ");
  s = s.replace(/\.{3,}/g, " ");
  return clean(s);
}

function finalizeSentences(parts) {
  const uniq = [];
  const seen = new Set();
  for (const p of parts) {
    let s = clean(p);
    if (!s) continue;
    s = s.replace(/\s*;\s*/g, ". ");
    if (!/[.!?]$/.test(s)) s += ".";
    s = s.charAt(0).toUpperCase() + s.slice(1);
    const key = situationDedupeKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
  }
  return uniq.join(" ");
}

/** Collapse near-duplicate closure / lane phrases for summary dedupe. */
function situationDedupeKey(sentence) {
  let k = clean(sentence).toLowerCase();
  k = k.replace(/[.!?]+$/g, "");
  k = k.replace(/\s+/g, " ");
  if (/^(silnice|komunikace|dálnice) je uzavřena|uzavírka komunikace|uzavřeno$/.test(k)) {
    return "road_closed";
  }
  k = k.replace(/neprůjezdn[ýáé]\s+/g, "closed_");
  k = k.replace(/\s+je\s+(?:neprůjezdn[ýáé]|uzavřen[ýáéo]?)$/g, "");
  return k;
}

function formatKmCs(km) {
  if (!Number.isFinite(km)) return null;
  if (km >= 10) return String(Math.round(km));
  return String(Math.round(km * 10) / 10).replace(".", ",");
}

/** Source-grounded heavy-traffic length only (never invent). */
function extractHeavyTrafficLengthKm(source, facts, input) {
  if (facts && facts.heavyTrafficLengthKm != null && Number.isFinite(facts.heavyTrafficLengthKm)) {
    return facts.heavyTrafficLengthKm;
  }
  const fromInput =
    input && input.heavyTrafficLengthKm != null ? Number(input.heavyTrafficLengthKm) : null;
  if (fromInput != null && Number.isFinite(fromInput)) return fromInput;
  const m =
    clean(source).match(
      /silný\s+provoz(?:\s+v\s+délce)?\s+(\d+(?:[.,]\d+)?)\s*km/i
    ) ||
    clean(source).match(
      /(\d+(?:[.,]\d+)?)\s*km\s+siln(?:ý|ého)\s+provoz/i
    );
  if (!m) return null;
  return Number(String(m[1]).replace(",", "."));
}

/**
 * Natural Czech accident lead from expanded source (count/type only if present).
 */
function formatAccidentSituationLead(source) {
  const text = clean(source);
  const car = text.match(/(\d+)\s+osobní(?:ch)?\s+automobil(?:y|ů|u)?/i);
  const truck = text.match(
    /(\d+)\s+nákladní(?:ch)?\s+(?:automobil(?:y|ů|u)?|vozidel|vozidla|vozidlo)/i
  );
  const wrecked = text.match(/(\d+)\s+havarovan(?:á|é|ých)\s+vozidel?/i);

  if (car) {
    const n = Number(car[1]);
    if (n === 1) return "Nehoda osobního automobilu";
    if (n === 2) return "Nehoda dvou osobních automobilů";
    if (n === 3) return "Nehoda tří osobních automobilů";
    if (n === 4) return "Nehoda čtyř osobních automobilů";
    if (Number.isFinite(n) && n > 0) return "Nehoda " + n + " osobních automobilů";
  }
  if (truck) {
    const n = Number(truck[1]);
    if (n === 1) return "Nehoda nákladního vozidla";
    if (n === 2) return "Nehoda dvou nákladních vozidel";
    if (Number.isFinite(n) && n > 0) return "Nehoda " + n + " nákladních vozidel";
  }
  if (wrecked) {
    const n = Number(wrecked[1]);
    if (n === 1) return "Nehoda. Havarované vozidlo";
    if (n === 2) return "Nehoda. Dvě havarovaná vozidla";
    if (Number.isFinite(n) && n > 0) return "Nehoda. " + n + " havarovaná vozidla";
  }
  return "Nehoda";
}

function capitalizeLanePhrase(lane) {
  const L = clean(lane).toLowerCase();
  if (!L) return "";
  return L.charAt(0).toUpperCase() + L.slice(1);
}

/** Circumstance phrases proven in source — never invent. */
function extractSituationCircumstanceBits(source) {
  const text = clean(source);
  const bits = [];
  if (/mimořádná\s+událost/i.test(text)) bits.push("Mimořádná událost");
  if (/na místě\s+složky\s+IZS|složky\s+IZS\s+na místě/i.test(text)) {
    bits.push("Na místě složky IZS");
  } else if (/\bsložky\s+IZS\b/i.test(text)) {
    bits.push("Na místě složky IZS");
  }
  return bits;
}

function formatHeavyTrafficBit(source, facts, input) {
  const km = extractHeavyTrafficLengthKm(source, facts, input);
  const kmCs = formatKmCs(km);
  if (kmCs) return "Silný provoz v délce " + kmCs + " km";
  return "Silný provoz";
}

/**
 * Short complete summary — cause → restriction scope → circumstance → traffic condition.
 * Source-grounded only. Never ends with "…" from truncation. Never invents kolona/uzavírka směru.
 */
export function buildTrafficSituationSummary(input = {}) {
  const event = classifyEventPresentation(input);
  const facts = event.facts || parseOfficialCommentFacts(sourceBlob(input));
  const raw = stripBoilerplate(
    clean(input.impactFull) || clean(input.impact) || clean(input.summaryFull) || clean(input.summary) || ""
  );
  const source = expandTrafficAbbreviationsCs(raw);
  const scope = event.restrictionScope || analyzeRestrictionScope(source);
  const condition = event.trafficCondition || analyzeTrafficCondition(source);
  const cause = event.primaryCause || analyzePrimaryCause(source, input);

  if (event.kind === EVENT_KIND.PARKING) {
    return resolveParkingLiveStatus(input, facts).collapsedText;
  }

  const causeBits = [];
  const scopeBits = [];
  const circumstanceBits = extractSituationCircumstanceBits(source);
  const conditionBits = [];

  // --- 1) Cause ---
  if (cause === PRIMARY_CAUSE.ACCIDENT || event.kind === EVENT_KIND.ACCIDENT) {
    causeBits.push(formatAccidentSituationLead(source));
  } else if (cause === PRIMARY_CAUSE.BROKEN_VEHICLE) {
    if (/porucha\s+NA|nákladní|defekt/i.test(source)) {
      causeBits.push("Porouchané nákladní vozidlo");
    } else {
      causeBits.push("Porouchané vozidlo");
    }
  } else if (cause === PRIMARY_CAUSE.OBSTACLE || event.kind === EVENT_KIND.OBSTACLE) {
    causeBits.push("Překážka na vozovce");
  } else if (cause === PRIMARY_CAUSE.ROADWORKS || event.kind === EVENT_KIND.ROADWORKS) {
    if (/pomalu jedoucí vozidlo údržby/i.test(source)) {
      causeBits.push("Pomalu jedoucí vozidlo údržby");
    }
    if (/sekání\s+trávy|údržba\s+trav/i.test(source)) {
      causeBits.push("Probíhá sekání trávy a údržba travních porostů");
    }
    if (/práce na inženýrských sítích/i.test(source)) {
      causeBits.push("Práce na inženýrských sítích");
    }
    if (/stavební práce/i.test(source) && !causeBits.length) causeBits.push("Stavební práce");
    if (
      /práce na silnici|údržba a opravy/i.test(source) &&
      !/sekání|údržba trav|pomalu jedoucí/i.test(causeBits.join(" "))
    ) {
      if (!causeBits.some((b) => /práce na silnici|stavební|údržba/i.test(b))) {
        causeBits.unshift("Práce na silnici");
      }
    }
    if (!causeBits.length) causeBits.push("Práce na silnici");
  } else if (event.kind === EVENT_KIND.CLOSURE || cause === PRIMARY_CAUSE.FULL_CLOSURE) {
    if (/úpln[áa]\s+uzavírk/i.test(source)) {
      const road = clean(input.road);
      if (road) causeBits.push("Úplná uzavírka silnice " + road);
      else causeBits.push("Úplná uzavírka komunikace");
    } else if (/oba směry/i.test(source)) {
      causeBits.push("Silnice je uzavřena v obou směrech");
    } else {
      // Prefer natural full-road phrasing; do not invent closure when type alone.
      causeBits.push("Silnice je uzavřena");
    }
  } else if (event.kind === EVENT_KIND.QUEUE) {
    if (/silný provoz|hustý provoz/i.test(source)) {
      conditionBits.push(formatHeavyTrafficBit(source, facts, input));
    }
    if (/tvoří se kolona/i.test(source)) conditionBits.push("Tvoří se kolona");
    const qKm =
      facts.queueLengthKm != null
        ? facts.queueLengthKm
        : input.queueLengthKm != null
          ? Number(input.queueLengthKm)
          : null;
    if (qKm != null && Number.isFinite(qKm)) {
      const km = formatKmCs(qKm);
      if (km) conditionBits.push("Kolona přibližně " + km + " km");
    } else if (/kolona/i.test(source) && !conditionBits.some((b) => /kolona/i.test(b))) {
      conditionBits.push("Kolona");
    } else if (!conditionBits.length) {
      conditionBits.push("Kolona");
    }
  } else if (event.kind === EVENT_KIND.HEAVY_TRAFFIC) {
    conditionBits.push(formatHeavyTrafficBit(source, facts, input));
  }

  // --- 2) Restriction scope (never invent direction closure from a single lane) ---
  if (scope === RESTRICTION_SCOPE.HARD_SHOULDER_CLOSED) {
    if (/neprůjezdn/i.test(source)) scopeBits.push("Zpevněná krajnice je neprůjezdná");
    else if (/uzavřen/i.test(source) && /zpevněn/i.test(source)) {
      scopeBits.push("Zpevněná krajnice je uzavřena");
    } else scopeBits.push("Uzavřený odstavný pruh");
  } else if (scope === RESTRICTION_SCOPE.SHOULDER_CLOSED || scope === RESTRICTION_SCOPE.VERGE_CLOSED) {
    if (/neprůjezdn/i.test(source)) scopeBits.push("Krajnice je neprůjezdná");
    else scopeBits.push("Krajnice je uzavřena");
  } else if (scope === RESTRICTION_SCOPE.SINGLE_LANE_CLOSED) {
    const lane =
      source.match(/((?:levý|pravý|střední)\s+jízdní\s+pruh)/i) ||
      source.match(/neprůjezdn[ýáé]\s+((?:levý|pravý|střední)\s+jízdní\s+pruh)/i);
    const dir = facts.directionHuman || clean(input.direction);
    if (lane && /neprůjezdn/i.test(source)) {
      scopeBits.push(capitalizeLanePhrase(lane[1]) + " je neprůjezdný");
    } else if (lane && dir) {
      scopeBits.push(capitalizeLanePhrase(lane[1]) + " ve směru " + dir + " je uzavřen");
    } else if (lane) {
      scopeBits.push(capitalizeLanePhrase(lane[1]) + " je uzavřen");
    } else {
      scopeBits.push("Jeden jízdní pruh je uzavřen");
    }
  } else if (
    scope === RESTRICTION_SCOPE.FULL_ROAD_CLOSED ||
    scope === RESTRICTION_SCOPE.DIRECTION_CLOSED ||
    scope === RESTRICTION_SCOPE.ALL_LANES_CLOSED
  ) {
    if (scope === RESTRICTION_SCOPE.ALL_LANES_CLOSED) {
      scopeBits.push("Všechny jízdní pruhy jsou uzavřeny");
    } else if (scope === RESTRICTION_SCOPE.DIRECTION_CLOSED) {
      const dir = facts.directionHuman || clean(input.direction);
      if (dir) scopeBits.push("Uzavřeno ve směru " + dir);
      else scopeBits.push("Směr je uzavřen");
    } else if (!causeBits.some((b) => /uzavírk|uzavřen/i.test(b))) {
      scopeBits.push("Silnice je uzavřena");
    }
  } else if (
    // Typed/classified closure with bare "uzavřeno" and unknown scope — keep road closed
    // phrasing already in causeBits; do not invent lane/shoulder closure.
    (event.kind === EVENT_KIND.CLOSURE || cause === PRIMARY_CAUSE.FULL_CLOSURE) &&
    /\buzavřeno\b/i.test(source) &&
    !causeBits.some((b) => /uzavřen/i.test(b))
  ) {
    scopeBits.push("Silnice je uzavřena");
  }

  // --- 3) Traffic condition (never upgrade delay/heavy → kolona) ---
  if (condition === TRAFFIC_CONDITION.QUEUE && hasExplicitQueueSource(source)) {
    if (/tvoří se kolona/i.test(source) && !conditionBits.some((b) => /kolona/i.test(b))) {
      conditionBits.push("Tvoří se kolona");
    } else if (!conditionBits.some((b) => /kolona/i.test(b))) {
      conditionBits.push("Kolona");
    }
  } else if (condition === TRAFFIC_CONDITION.HEAVY_TRAFFIC) {
    if (!conditionBits.some((b) => /silný provoz/i.test(b))) {
      conditionBits.push(formatHeavyTrafficBit(source, facts, input));
    }
  } else if (condition === TRAFFIC_CONDITION.PASS_WITH_CARE) {
    if (!conditionBits.some((b) => /zvýšenou opatrností/i.test(b))) {
      conditionBits.push("Průjezd se zvýšenou opatrností");
    }
  } else if (condition === TRAFFIC_CONDITION.DELAY) {
    if (!conditionBits.some((b) => /zdržení/i.test(b))) conditionBits.push("Zdržení");
  }

  // Extra trusted phrases not yet covered (roadworks transfer etc.).
  if (/provoz převeden do protisměru/i.test(source)) {
    scopeBits.push("Provoz převeden do protisměru");
  }

  // Order: main fact → traffic impact/scope → circumstance → condition.
  const ordered = [...causeBits, ...scopeBits, ...circumstanceBits, ...conditionBits];
  if (ordered.length) return finalizeSentences(ordered);

  if (facts.situationPhrases.length) return finalizeSentences(facts.situationPhrases.slice(0, 3));
  if (!source || EMPTY_IMPACT_RE.test(source)) return "Dopravní omezení.";
  const clauses = source
    .split(/[.;]/)
    .map(clean)
    .filter(
      (x) =>
        x &&
        x.length >= 8 &&
        !/^od\s+\d/i.test(x) &&
        !/^do\s+\d/i.test(x) &&
        !/^vydal:/i.test(x) &&
        !/^v ulici\b/i.test(x) &&
        !/^v obci\b/i.test(x) &&
        !/^okres\b/i.test(x)
    )
    .slice(0, 2);
  if (clauses.length) return finalizeSentences(clauses);
  return "Dopravní omezení.";
}

function samePlaceName(a, b) {
  const x = clean(a).toLowerCase();
  const y = clean(b).toLowerCase();
  return !!(x && y && x === y);
}

/**
 * Municipality/city name for the Czech entrance-style signboard.
 * Never invents Praha/Jižní spojka; never treats street or city-part as municipality.
 * Parking: after live NDIC fields, may enrich from verified parking registry match only.
 */
export function resolveMunicipalitySignName(input = {}) {
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const structured = clean(input.municipality);
  const fromComment = clean(facts.city);
  const parkingCity = clean(facts.parkingCity);
  const street = streetBareName(facts.street || input.streetHint || input.street);
  const cityPart = clean(facts.cityPart || input.cityPart);

  let city =
    preferFullerMunicipalityName(structured, fromComment) ||
    parkingCity ||
    "";
  if (!city) {
    const reg = matchParkingRegistry({
      ...input,
      parkingName: facts.parkingName || input.parkingName,
    });
    if (reg && reg.municipality) city = clean(reg.municipality);
  }
  if (!city) return null;
  if (/^p\s*\+\s*r\b/i.test(city)) return null;
  if (/\b(ulice|okres|okr\.)\b/i.test(city)) return null;
  if (looksLikeRoadNumberToken(city)) return null;
  if (!structured && looksLikeNonMunicipalityPlace(city)) return null;
  if (street && samePlaceName(city, street)) return null;
  if (cityPart && samePlaceName(city, cityPart)) return null;
  if (facts.streetMulti && looksLikeNonMunicipalityPlace(city)) return null;
  return city;
}

/**
 * Locality header parts: [municipality sign] [road] [street/beside].
 * Priority: municipality → road → named object → confirmed street → other locality.
 * Never fabricates "ulice:" from generic locationLabel / TMC area names.
 */
export function buildLocalityHeaderModel(input = {}) {
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const road = clean(input.road);
  const municipalitySign = resolveMunicipalitySignName(input);
  const street = resolveConfirmedStreet(input, facts);
  const location = clean(input.location);
  const district = clean(input.district) || facts.district || "";
  const cityPart = clean(facts.cityPart || input.cityPart);
  const namedObject = facts.namedObject || null;
  const namedObjectKind = facts.namedObjectKind || null;
  const registry = matchParkingRegistry({
    ...input,
    parkingName: facts.parkingName || input.parkingName,
  });
  const parkingNameRaw =
    (registry && registry.canonicalName) || facts.parkingName || null;
  const useParkingBeside = !!(
    parkingNameRaw && isParkingOccupancySituation(input, facts)
  );
  const parkingName = useParkingBeside ? parkingNameRaw : null;
  const liveStatus = useParkingBeside ? resolveParkingLiveStatus(input, facts) : { statusLabel: "" };
  const parkingStatusLabel = useParkingBeside
    ? liveStatus.statusLabel || formatParkingStatusLabel(facts)
    : "";
  const streetMulti = facts.streetMulti === true;

  let besideLocality = "";
  let streetLabel = null;
  let locationKind = facts.locationKind || LOCATION_KIND.UNKNOWN;

  if (parkingName) {
    besideLocality = parkingName;
    locationKind = LOCATION_KIND.PARKING;
  } else if (streetMulti) {
    besideLocality = "více ulic";
    streetLabel = "více ulic";
    locationKind = LOCATION_KIND.STREET;
  } else if (namedObject && !resolveRoadDisplayName(road)) {
    // Named tunnel/bridge/square beats generic locationLabel (e.g. Letná).
    // Road aliases (D0 → Pražský okruh) keep the communication display name instead.
    besideLocality = namedObject;
    locationKind = namedObjectKind || classifyLocationKindFromName(namedObject);
  } else if (street) {
    streetLabel = "ulice: " + street;
    besideLocality = streetLabel;
    locationKind = LOCATION_KIND.STREET;
  } else if (resolveRoadDisplayName(road)) {
    // Verified road alias (e.g. D0 → Pražský okruh) — plain text beside badge, never muni sign.
    besideLocality = resolveRoadDisplayName(road);
  } else if (
    location &&
    !samePlaceName(location, municipalitySign) &&
    location !== road &&
    !looksLikeRoadNumberToken(location) &&
    !/^d\d/i.test(location) &&
    !/^p\s*\+\s*r\b/i.test(location) &&
    !samePlaceName(location, cityPart)
  ) {
    // Generic / landmark locality — NEVER prefix with "ulice:".
    besideLocality = location;
    locationKind = classifyLocationKindFromName(location);
    if (looksLikeStreetName(location)) locationKind = LOCATION_KIND.GENERIC_LOCALITY;
  }

  let districtBeside = "";
  if (municipalitySign && !besideLocality && !road && district) {
    districtBeside = "okres " + district;
  }

  const cityPartRow = cityPart && !samePlaceName(cityPart, municipalitySign)
    ? "městská část: " + cityPart
    : null;

  return {
    municipalitySign,
    municipalitySignLabel: municipalitySign ? municipalitySign.toUpperCase() : null,
    besideLocality: besideLocality || null,
    streetLabel: streetLabel || null,
    districtBeside: districtBeside || null,
    street: street || null,
    streetMulti,
    namedObject: namedObject || null,
    namedObjectKind: namedObjectKind || null,
    locationKind,
    cityPart: cityPart || null,
    cityPartRow,
    district: district || null,
    parkingName,
    parkingStatusLabel,
    parkingFullyOccupied: liveStatus.kind === "full",
    parkingOccupancyPercent:
      facts.parkingOccupancyPercent != null ? facts.parkingOccupancyPercent : null,
    parkingRegistryId: registry ? registry.parkingId : null,
    parkingRegistryMatch: !!registry,
  };
}

/**
 * Head locality next to road badge (human) — legacy string for tests/compat.
 * Prefer buildLocalityHeaderModel for UI (municipality sign + beside).
 */
export function buildHeadLocalityLabel(input = {}) {
  const hdr = buildLocalityHeaderModel(input);
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const road = clean(input.road);
  const location = clean(input.location);
  const district = hdr.district;

  if (facts.parkingName) {
    const place =
      hdr.municipalitySign ||
      (location && !/^p\+r/i.test(location) ? location : "");
    return { head: facts.parkingName, subtitle: place || null };
  }

  const streetHead = hdr.street ? hdr.street.toUpperCase() : null;
  if (hdr.municipalitySign && streetHead) {
    return {
      head: hdr.municipalitySignLabel + " — " + streetHead,
      subtitle: null,
      municipalitySign: hdr.municipalitySign,
      besideLocality: hdr.besideLocality,
    };
  }
  if (hdr.municipalitySign && hdr.besideLocality && !hdr.street) {
    return {
      head: hdr.municipalitySignLabel + " — " + String(hdr.besideLocality).toUpperCase(),
      subtitle: null,
      municipalitySign: hdr.municipalitySign,
      besideLocality: hdr.besideLocality,
    };
  }
  if (hdr.municipalitySign) {
    return {
      head: hdr.municipalitySignLabel,
      subtitle: hdr.districtBeside,
      municipalitySign: hdr.municipalitySign,
      besideLocality: null,
    };
  }
  if (road && location && location !== road && !/^d\d/i.test(location)) {
    return { head: location, subtitle: null };
  }
  if (!road && hdr.besideLocality && district) {
    return { head: hdr.besideLocality + " · okres " + district, subtitle: null };
  }
  if (!road && hdr.besideLocality) return { head: hdr.besideLocality, subtitle: null };
  if (!road && location) return { head: location, subtitle: null };
  return { head: null, subtitle: null };
}

export function buildPlaceAndDirectionLine(input = {}) {
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const bits = [];
  const road = clean(input.road);
  const dir =
    clean(input.direction) ||
    facts.directionHuman ||
    "";
  const km =
    (input.kilometer != null ? "km " + clean(String(input.kilometer)) : "") ||
    facts.kilometerLabel ||
    "";
  const section = clean(input.section);
  const muni = clean(input.municipality) || facts.city || "";
  const district = clean(input.district) || facts.district || "";
  const street = resolveConfirmedStreet(input, facts);
  const location = clean(input.location);

  if (facts.parkingName) {
    const bits = [facts.parkingName];
    if (muni) bits.push(muni);
    else if (location && !/^p\+r/i.test(location)) bits.push(location);
    return bits.join(" · ");
  }

  if (facts.namedObject && !resolveRoadDisplayName(road)) {
    const placeBits = [facts.namedObject];
    if (facts.cityPart) placeBits.push(facts.cityPart);
    else if (muni) placeBits.push(muni);
    return placeBits.join(" · ");
  }

  if (street && (muni || facts.cityPart)) {
    const placeBits = ["ulice " + street.replace(/^ulice\s+/i, "")];
    if (facts.cityPart) placeBits.push(facts.cityPart);
    else if (muni) placeBits.push(muni);
    if (district && !placeBits.join(" ").includes(district)) placeBits.push("okres " + district);
    return placeBits.join(" · ");
  }

  if (road) bits.push(road);
  {
    const roadDisplayName = resolveRoadDisplayName(road);
    if (roadDisplayName) bits.push(roadDisplayName);
  }
  if (km) bits.push(km);
  else if (section) bits.push(section);
  if (dir) bits.push("směr " + dir);
  if (muni && !bits.includes(muni)) bits.push(muni);
  else if (
    location &&
    location !== road &&
    !looksLikeRoadNumberToken(location) &&
    !bits.includes(location)
  ) {
    bits.push(location);
  }
  if (district) {
    const distLabel = "okres " + district;
    if (!bits.some((b) => String(b).includes(district))) bits.push(distLabel);
  }

  if (bits.length) return bits.join(" · ");
  if (muni && district) return muni + " · okres " + district;
  return muni || location || clean(input.subjectScopeLabel) || "";
}

export function buildCommunicationLine(input = {}) {
  const roadPres = classifyRoadPresentation(input.road, input);
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const hdr = buildLocalityHeaderModel(input);
  const head = buildHeadLocalityLabel(input);
  const dir = clean(input.direction) || facts.directionHuman || null;
  return {
    roadPresentation: roadPres,
    roadDisplayName: roadPres.roadDisplayName || resolveRoadDisplayName(roadPres.road),
    direction: dir,
    // Never mirror parkingName (or any beside text) into localityFallback — that caused
    // "P+R Zličín / P+R Zličín" when municipality sign was missing.
    localityFallback:
      !roadPres.road && !hdr.municipalitySign && !hdr.besideLocality ? head.head : null,
    headLocality:
      roadPres.road && !hdr.municipalitySign && !hdr.besideLocality ? head.head : null,
    municipalitySign: hdr.municipalitySign,
    municipalitySignLabel: hdr.municipalitySignLabel,
    besideLocality: hdr.besideLocality,
    streetLabel: hdr.streetLabel,
    districtBeside: hdr.districtBeside,
    street: hdr.street || null,
    streetMulti: hdr.streetMulti === true,
    namedObject: hdr.namedObject || null,
    namedObjectKind: hdr.namedObjectKind || null,
    locationKind: hdr.locationKind || LOCATION_KIND.UNKNOWN,
    cityPart: hdr.cityPart || null,
    cityPartRow: hdr.cityPartRow || null,
    parkingName: hdr.parkingName || facts.parkingName || null,
    parkingStatusLabel: hdr.parkingStatusLabel || null,
    parkingRegistryId: hdr.parkingRegistryId || null,
    parkingRegistryMatch: hdr.parkingRegistryMatch === true,
    roadTypeIconFirst: roadPres.showMotorVehiclesIcon === true && roadPres.showMotorwayIcon !== true,
  };
}

function placeLineWithoutDuplicateMunicipality(placeLine, municipalitySign) {
  const place = clean(placeLine);
  const muni = clean(municipalitySign);
  if (!place || !muni) return place;
  if (samePlaceName(place, muni)) return "";
  const prefix = muni + " · ";
  if (place.toLowerCase().startsWith(prefix.toLowerCase())) {
    return clean(place.slice(prefix.length));
  }
  return place;
}

export function buildTrafficExpandedDetail(input = {}) {
  const rows = [];
  const seenValues = new Set();
  const push = (key, label, value) => {
    let v = value == null ? "" : clean(String(value));
    if (!v) return;
    if (/^(unknown|n\/a|null|undefined)$/i.test(v)) return;
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const formatted = formatCsDateTime(v);
      if (!formatted) return;
      v = formatted;
    }
    const dedupeKey = label + "|" + v.toLowerCase();
    if (seenValues.has(dedupeKey)) return;
    seenValues.add(dedupeKey);
    rows.push({ key, label, value: v });
  };

  const event = classifyEventPresentation(input);
  const facts = event.facts || parseOfficialCommentFacts(sourceBlob(input));
  const registry = matchParkingRegistry({
    ...input,
    parkingName: facts.parkingName || input.parkingName,
  });
  const liveStatus = resolveParkingLiveStatus(input, facts);

  // Skip redundant "Typ (zdroj)" when it only repeats the card title kind.
  push("road", "Komunikace", input.road);
  push("roadName", "Název komunikace", resolveRoadDisplayName(input.road));
  if (input.roadClassLabel) push("roadClass", "Třída komunikace", input.roadClassLabel);
  push("kilometer", "Kilometráž", facts.kilometerLabel || input.kilometer);
  push("direction", "Směr", clean(input.direction) || facts.directionHuman);
  {
    const confirmedStreet = resolveConfirmedStreet(input, facts);
    push("street", "Ulice", confirmedStreet);
  }
  push(
    "municipality",
    "Obec",
    preferFullerMunicipalityName(
      input.municipality || facts.city,
      facts.city
    ) || (registry ? registry.municipality : null)
  );
  push("cityPart", "Městská část", facts.cityPart || (registry ? registry.cityPart : null));
  push("district", "Okres", input.district || facts.district);
  {
    const roadNorm = clean(input.road)
      .toLowerCase()
      .replace(/\s+/g, "");
    const locNorm = clean(input.location)
      .toLowerCase()
      .replace(/\s+/g, "");
    const named = facts.namedObject || null;
    // Hide LOKALITA when it only echoes the road number (e.g. location=D0).
    const locIsRoadEcho =
      !!(roadNorm && locNorm && locNorm === roadNorm) ||
      (!!locNorm &&
        looksLikeRoadNumberToken(input.location) &&
        !!roadNorm &&
        locNorm === roadNorm);
    if (named) {
      // Named object is the authoritative locality — do not keep a conflicting TMC/area label.
      push("location", "Lokalita", named);
    } else if (!locIsRoadEcho) {
      push("location", "Lokalita", input.location);
    }
  }
  const parkingDisplayName =
    (registry && registry.canonicalName) || facts.parkingName || null;
  if (parkingDisplayName) push("parkingName", "Parkoviště", parkingDisplayName);

  if (liveStatus.kind === "full") {
    push("parkingStatus", "Obsazenost", "PLNĚ OBSAZENO");
  } else if (facts.parkingOccupancyPercent != null) {
    push("parkingOccupancy", "Obsazenost", facts.parkingOccupancyPercent + " %");
  } else if (liveStatus.statusLabel) {
    push("parkingStatus", "Obsazenost", liveStatus.statusLabel);
  }

  if (facts.parkingFreeUpperBound != null) {
    push("parkingFree", "Volná místa", "méně než " + facts.parkingFreeUpperBound);
  } else {
    push(
      "parkingFree",
      "Volná místa",
      input.parkingAvailableSpaces != null ? input.parkingAvailableSpaces : input.freeSpaces
    );
  }

  // Registry enrichment only — separate from NDIC source description.
  if (registry && registry.addressLine) {
    push("parkingAddress", "Adresa", registry.addressLine);
  }
  if (registry && registry.parkAndRide === true) {
    push("parkingType", "Typ parkoviště", "P+R (Park and Ride)");
    push("parkingPrExplanation", "O P+R", PARK_AND_RIDE_EXPLANATION_CS);
  } else if ((registry && registry.parkingType === "P+G") || facts.parkingType === "P+G") {
    push("parkingType", "Typ parkoviště", "P+G");
  } else if (
    (registry && registry.parkingType === "PARKING_HOUSE") ||
    facts.parkingType === "PARKING_HOUSE"
  ) {
    push("parkingType", "Typ parkoviště", "Parkovací dům");
  } else if (registry && registry.parkingType === "PUBLIC_PARKING") {
    push("parkingType", "Typ parkoviště", "Veřejné parkoviště");
  } else if (facts.parkingType === "P+R") {
    push("parkingType", "Typ parkoviště", "P+R (Park and Ride)");
  }

  const qKm = facts.queueLengthKm != null ? facts.queueLengthKm : input.queueLengthKm;
  if (qKm != null) push("queueLength", "Délka kolony", String(qKm).replace(".", ",") + " km");
  push("delay", "Očekávané zdržení", input.delayMinutes != null ? String(input.delayMinutes) + " min" : null);

  const v = input.validity || {};
  push("validityFrom", "Začátek", v.validFrom || input.validFrom);
  push("validityTo", "Konec", v.actualEnd || v.expectedEnd || v.validTo || input.validTo);
  // Prefer structured start/end over repeating validityLine when both exist.
  if (!(v.validFrom || v.expectedEnd || v.actualEnd || v.validTo)) {
    push("validityLine", "Platnost", input.validityLine);
  }
  push("updated", "Aktualizováno", input.lastMeaningfulChangeAt || input.sourceUpdatedAt);

  const sourceFull = expandTrafficAbbreviationsCs(
    clean(input.impactFull) ||
      clean(input.summaryFull) ||
      clean(input.impact) ||
      clean(input.summary) ||
      ""
  );
  if (sourceFull && !EMPTY_IMPACT_RE.test(sourceFull)) {
    rows.push({
      key: "sourceDescription",
      label: "Popis ze zdroje ŘSD/NDIC",
      value: sourceFull,
    });
  }

  return {
    event,
    rows,
    sourceFull,
    facts,
    parkingRegistry: registry
      ? {
          parkingId: registry.parkingId,
          canonicalName: registry.canonicalName,
          addressLine: registry.addressLine,
          parkAndRide: registry.parkAndRide === true,
          provenance: "parking-registry-v1",
        }
      : null,
    parkingLiveStatus: liveStatus,
  };
}

export function buildTrafficCardPresentation(trafficV1) {
  const tv = trafficV1 && typeof trafficV1 === "object" ? trafficV1 : {};
  const roadPres = classifyRoadPresentation(tv.road, {
    motorVehicleRoadConfirmed: tv.motorVehicleRoadConfirmed === true,
    isMotorVehicleRoad: tv.isMotorVehicleRoad === true,
    motorVehicleRoadStatus: tv.motorVehicleRoadStatus,
    roadFacilityType: tv.roadFacilityType,
  });
  const event = classifyEventPresentation(tv);
  const communication = buildCommunicationLine(tv);
  const placeLineRaw = buildPlaceAndDirectionLine(tv);
  // Parking: name lives on the municipality/beside row — hide duplicate MÍSTO block.
  const placeLine =
    event.kind === EVENT_KIND.PARKING
      ? ""
      : placeLineWithoutDuplicateMunicipality(placeLineRaw, communication.municipalitySign);
  const situationSummary = buildTrafficSituationSummary(tv);
  const expanded = buildTrafficExpandedDetail(tv);
  const informative = isTrafficCardInformative(tv);
  const hasPublicOaLeak = /\bOA\b/.test(situationSummary);

  // Parking collapsed UI uses situation stack beside P; title stays kind-only.
  const eventTitle = event.titleCs;

  return {
    roadPresentation: roadPres,
    event: { ...event, titleCs: eventTitle },
    communication,
    placeLine,
    situationSummary,
    situationLabel: event.kind === EVENT_KIND.PARKING ? "Stav parkoviště" : "Dopravní situace",
    placeLabel:
      communication.direction || (placeLine && placeLine.indexOf("směr") >= 0)
        ? "Místo a směr"
        : "Místo",
    validityLine: tv.validityLine != null ? clean(String(tv.validityLine)) : "",
    sourceLabel: tv.source != null ? clean(String(tv.source)) : "ŘSD/NDIC",
    expanded,
    informative,
    mapDotCssVar: TRAFFIC_MAP_DOT_CSS_VAR,
    // Detail opens when we have source text or more than place/validity rows.
    showMore: !!(expanded.sourceFull || (expanded.rows && expanded.rows.length > 0)),
    regression: {
      publicSummaryHasOa: hasPublicOaLeak,
      summaryHasEllipsisTrim: /…$|\.\.\.$/.test(situationSummary),
    },
  };
}
