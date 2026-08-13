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
import {
  matchTunnelRegistry,
  matchOutsideCityTunnelRegistry,
  resolveTunnelDisplayName,
} from "./iu-tunnel-registry-v1.js?v=ndic-info-loss-forensic-v1-20260813";

export {
  matchParkingRegistry,
  PARK_AND_RIDE_EXPLANATION_CS,
  PARKING_REGISTRY,
  PARKING_REGISTRY_VERSION,
  normalizeParkingAliasKey,
  isAmbiguousParkingName,
} from "./iu-parking-registry-v1.js?v=ndic-parking-hl-nadrazi-muni-v1-20260812";

export {
  matchTunnelRegistry,
  matchOutsideCityTunnelRegistry,
  resolveTunnelDisplayName,
  TUNNEL_REGISTRY,
  OUTSIDE_CITY_TUNNEL_REGISTRY,
  OUTSIDE_CITY_TUNNEL_SOURCE,
  TUNNEL_REGISTRY_VERSION,
  normalizeTunnelAliasKey,
  isAmbiguousTunnelName,
  isAmbiguousOutsideCityTunnelName,
} from "./iu-tunnel-registry-v1.js?v=ndic-info-loss-forensic-v1-20260813";

export const TRAFFIC_SIGN_ASSET = Object.freeze({
  MOTORWAY: "/assets/images/traffic-road-motorway.png",
  MOTOR_VEHICLES: "/assets/images/traffic-road-motor-vehicles.png",
  /** Location/object marker for outside-city tunnels — not an event-type icon. */
  TUNNEL_OBJECT: "/assets/images/traffic-road-tunnel.png",
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
  RAILWAY_CROSSING: "RAILWAY_CROSSING",
  RAMP: "RAMP",
  EXIT_RAMP: "EXIT_RAMP",
  REST_AREA: "REST_AREA",
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

/**
 * Format kilometrage token for UI. Preserves source fractional precision
 * (e.g. 36.77 → "36,77"). Never rounds 36.77/36.84 down to a shared "36,8".
 */
export function formatKmToken(raw) {
  const cleaned = clean(String(raw ?? ""));
  if (!cleaned) return "";
  const normalized = cleaned.replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return cleaned.replace(".", ",");
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  const fracMatch = normalized.match(/\.(\d{1,6})/);
  if (fracMatch) {
    const sign = n < 0 ? "-" : "";
    const absInt = String(Math.trunc(Math.abs(n)));
    // Keep source digits (cap 3) — do not re-round via toFixed.
    const frac = fracMatch[1].slice(0, 3);
    return sign + absInt + "," + frac;
  }
  return String(n).replace(".", ",");
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

/**
 * Strip source wrapper delimiters from extracted tokens (street, place, …).
 * Removes leading/trailing ()[]{},; — preserves Czech abbreviations like tř. / nám.
 */
export function sanitizeExtractedValueToken(raw) {
  let s = clean(raw);
  if (!s) return "";
  s = s.replace(/^[\s({"'„\[]+/u, "");
  s = s.replace(/[)\]}>]+$/g, "");
  s = s.replace(/[,;]+$/g, "");
  s = s.replace(/["'“”]+$/g, "");
  // Drop a trailing period only when it is not a Czech abbreviation suffix.
  if (/\.$/.test(s) && !/\b(?:tř|nám|nábř|ul|okr|č)\.$/iu.test(s)) {
    s = s.replace(/\.$/, "");
  }
  return clean(s);
}

function streetBareName(raw) {
  return sanitizeExtractedValueToken(
    clean(raw)
      .replace(/^ulice:?\s+/i, "")
      .replace(/^v\s+ulici\s+/i, "")
      .replace(/^ul\.\s*/i, "")
  );
}

/** Praha 1–22 (and lettered variants) are city parts, never the municipality. */
export function isPrahaCityPartName(raw) {
  return /^praha\s+\d+[a-zA-Z]?$/i.test(clean(raw));
}

/**
 * Split "City N" / "City Na" urban district labels into municipality + cityPart.
 * Praha keeps the dedicated helper; other cities use the same numeric-district shape
 * (e.g. "Plzeň 4" → municipality Plzeň, cityPart Plzeň 4). Never invents a city.
 */
export function splitMunicipalityAndCityPart(raw) {
  const t = clean(raw);
  if (!t) return null;
  if (isPrahaCityPartName(t)) {
    return { municipality: "Praha", cityPart: t };
  }
  const m = t.match(/^(.+?)\s+(\d{1,2}[A-Za-z]?)$/u);
  if (!m) return null;
  const base = clean(m[1]);
  if (!base || !/^[A-ZÁ-Ž]/u.test(base)) return null;
  if (looksLikeRoadNumberToken(base)) return null;
  if (looksLikeSegmentOrAreaLabel(base)) return null;
  if (
    /náměstí|nábřeží|tunel|\bmost\b|MÚK\b|křižovatka|nádraží|terminál|parkovišt|parkovací\s+dům|přejezd|nájezd|sjezd|odpočívk/i.test(
      base
    )
  ) {
    return null;
  }
  // Reject street-like single tokens ("Rokycanská 4") — municipalities are not street morphology alone.
  if (
    !/\s/.test(base) &&
    /(ská|cká|ovská|ová|ova|ná|ní)$/i.test(base)
  ) {
    return null;
  }
  if (/^(ulice|okres|okr\.|silnice|dálnice)$/i.test(base)) return null;
  return { municipality: base, cityPart: t };
}

export function isNumericCityPartName(raw) {
  return !!splitMunicipalityAndCityPart(raw);
}

/** Direction clause boundaries that are circumstance / cause, not the destination. */
const DIRECTION_TAIL_BOUNDARY_RE =
  /\s+(?:v souvislosti s|z důvodu(?:\s+provádění)?|za účelem|v rámci|po dobu|kvůli|v důsledku|v souvislosti se)\b/i;

/** Lane / routing prose that must never remain inside a structured SMĚR value. */
const DIRECTION_ROUTING_OVERFLOW_RE =
  /jízdním\s+pruhem|parkovacím\s+pruhem|provoz\s+ve\s+směr|veden\s+provoz|vozovky\s+a|až\s+ke\s+křižovatce|uzavřen\s+(?:západní|východní)|zachován\s+obousměrný|objízdn/i;

/** Stop destination capture before lane/routing continuation. */
const DIRECTION_DEST_STOP_RE =
  /\s+(?:východním|západním|severním|jižním|levým|pravým|středním|parkovacím|jízdním|provoz|veden|vozovky|až\s+ke|před\s+křižovatk\w*|před\s+objekt\w*|zachován|objízdn|v\s+souvislosti|z\s+důvodu|za\s+účelem|v\s+rámci|po\s+dobu|kvůli|v\s+důsledku)\b/i;

/** Nested direction marker — must end the current capture so the next směr can match. */
const DIRECTION_NESTED_MARKER_RE =
  /\s+(?:ve\s+směru|v\s+směru|(?<![A-Za-zÁ-Žá-ž])směr)\b/i;

/** Known Czech abbreviations whose trailing "." must not end an extracted value.
 * Avoid \\b — JS word boundaries are ASCII-only and break on č/ř/… abbreviations.
 */
const CZECH_ABBREV_BEFORE_DOT_RE =
  /(?:^|[^A-Za-zÁ-Žá-ž0-9])(?:ul|okr|č|ev\.?\s*č|tzv|např|sv|ing|dr|nám|nábř|tř|p|m|km|čp|ev)\s*$/iu;

/**
 * True when "." at dotIndex inside text is an abbreviation / initial, not a sentence end.
 * Examples: "P.Bezruče", "P. Bezruče", "ul. Moskevská", "č. 100", "okr. Frýdek-Místek".
 */
export function isAbbreviationOrInitialDot(text, dotIndex) {
  const s = String(text || "");
  if (dotIndex < 0 || dotIndex >= s.length || s[dotIndex] !== ".") return false;
  const before = s.slice(0, dotIndex);
  const after = s.slice(dotIndex + 1);
  // Single-letter initial: "P." / "T." — keep when name continues immediately or after space.
  if (/\b[A-ZÁ-Ž]\s*$/u.test(before)) {
    if (/^[A-ZÁ-Ža-zá-ž0-9]/.test(after) || /^\s+[A-ZÁ-Ža-zá-ž0-9]/.test(after)) return true;
  }
  if (CZECH_ABBREV_BEFORE_DOT_RE.test(before)) {
    // "ul. Moskevská" / "č. 100" / "okr. Frýdek-Místek"
    if (/^\s*[A-ZÁ-Ža-zá-ž0-9]/.test(after) || after === "") return true;
  }
  return false;
}

/**
 * Clip extracted free-text before comma/semicolon/sentence-end, keeping abbreviation dots.
 */
export function clipExtractedValueAtStructuralEnd(raw, maxLen = 120) {
  const s = String(raw || "");
  if (!s) return "";
  let out = "";
  const lim = Math.min(s.length, Math.max(8, maxLen));
  for (let i = 0; i < lim; i += 1) {
    const ch = s[i];
    if (ch === "," || ch === ";") break;
    if (ch === ".") {
      if (isAbbreviationOrInitialDot(s, i)) {
        out += ch;
        continue;
      }
      // Sentence-ending period — stop; do not keep it.
      break;
    }
    out += ch;
  }
  return clean(out);
}

/** Normalize "P.Bezruče" → "P. Bezruče" (space after single-letter initial). */
function normalizeInitialDotSpacing(raw) {
  return clean(String(raw || "").replace(/\b([A-ZÁ-Ž])\.(\S)/gu, "$1. $2"));
}

/**
 * Detect parser/clip mid-token fragments (e.g. "… provoz ve smě").
 * Does not reject legitimately short destination names.
 */
export function looksLikeTruncatedFragment(raw) {
  const s = clean(raw);
  if (!s) return false;
  if (/\bve\s+smě$/i.test(s)) return true;
  if (/\bv\s+rámc$/i.test(s)) return true;
  if (/\bna\s+sil$/i.test(s)) return true;
  if (/\bprováděn$/i.test(s)) return true;
  if (/\bsouvislost$/i.test(s)) return true;
  // Ends with a dangling Czech preposition / conjunction after a clip.
  if (/\s(?:ve|na|v|do|z|se|ke|od|a|i)$/i.test(s)) return true;
  if (/[-–—…]$/.test(s)) return true;
  // Parser-generated dangling delimiters / open parentheticals.
  if (/[()]$/.test(s)) return true;
  if (/\([^)]*$/.test(s) && !/\([^)]+\)$/.test(s)) return true;
  return false;
}

/**
 * Keep only the semantic direction destination from NDIC phrasing.
 * "ve směru do centra v souvislosti s …" → "do centra"
 * Does not invent direction from unrelated "v centru" prose.
 * Rejects traffic-routing overflow ("na Bohdalec východním jízdním pruhem…").
 */
export function normalizeDirectionHuman(raw) {
  let d = clean(raw);
  if (!d) return null;
  // Routing prose clause (lane/parking guidance) is never a structured SMĚR value —
  // even if a destination token could be salvaged from the start of the clause.
  if (
    DIRECTION_ROUTING_OVERFLOW_RE.test(d) &&
    /\s+(?:východním|západním|severním|jižním|levým|pravým|středním|parkovacím|jízdním)\b/i.test(d)
  ) {
    return null;
  }
  if (looksLikeTruncatedFragment(d)) return null;
  d = d.replace(/^ve\s+směru\s+/i, "").replace(/^v\s+směru\s+/i, "").replace(/^směr\s+/i, "");
  d = clean(d.split(DIRECTION_TAIL_BOUNDARY_RE)[0]);
  d = clean(d.split(DIRECTION_DEST_STOP_RE)[0]);
  d = sanitizeExtractedValueToken(d);
  d = normalizeInitialDotSpacing(d);
  if (!d) return null;
  if (looksLikeTruncatedFragment(d)) return null;
  if (/^(kladný|záporný)\s+směr$/i.test(d)) return null;
  if (/^(unknown|n\/a|null|undefined|neuvedeno)$/i.test(d)) return null;
  // Reject obvious non-direction overflow / prose.
  if (DIRECTION_ROUTING_OVERFLOW_RE.test(d)) return null;
  if (
    /prováděn|stavebních prac|souvislosti|za účelem|v rámci akce|vyblokován|probíhají|bude uzavř|křižovatk/i.test(
      d
    )
  ) {
    return null;
  }
  // Segment / landmark direction: "od mostu P. Bezruče k husitské zvonici".
  // Must not die on initials (P.) and must not invent destinations from unrelated prose.
  if (/^od\s+/i.test(d)) {
    if (d.length > 96) return null;
    // Reject truncated initial-only leftovers ("od mostu P") — require continuation
    // after a single-letter initial, or a clear "k …" / multi-word landmark path.
    if (/\b[A-ZÁ-Ž]\.\s*$/u.test(d)) return null;
    if (/\b[A-ZÁ-Ž]$/u.test(d) && !/\b[A-ZÁ-Ž]{2,}/u.test(d)) return null;
    if (
      /\bk\s+\S{2,}/i.test(d) ||
      /\bmostu\b/i.test(d) ||
      /\s/.test(d.replace(/^od\s+/i, ""))
    ) {
      return d;
    }
    return null;
  }
  if (d.length > 48) return null;
  // Destination-like: short place / left-right / centrum forms.
  // NOTE: do not use the `i` flag on the capital-letter branch — `[A-Z]` with `i`
  // would match lowercase and swallow routing prose after "vlevo".
  if (
    /^(?:do\s+|z\s+|na\s+|směr\s+)?(?:centra|centrum|vlevo|vpravo|oba směry)$/i.test(d)
  ) {
    return d.replace(/^směr\s+/i, "").trim();
  }
  if (/^(?:do\s+|z\s+|na\s+)/i.test(d)) {
    const rest = d.replace(/^(?:do\s+|z\s+|na\s+)/i, "");
    if (/^[A-ZÁ-Ž]/u.test(rest) && /^[A-ZÁ-Ž][\wÁ-Žá-ž0-9 ./-]{0,40}$/u.test(rest)) {
      return d;
    }
    return null;
  }
  if (/^[A-ZÁ-Ž]/u.test(d) && /^[A-ZÁ-Ž][\wÁ-Žá-ž0-9 ./-]{0,40}$/u.test(d)) {
    return d;
  }
  return null;
}

/**
 * Collect safe destination tokens from comment. When multiple distinct destinations
 * appear (typical urban multi-way routing), structured SMĚR stays null — facts go
 * into DOPRAVNÍ SITUACE instead.
 */
function collectDirectionDestinationsFromComment(text) {
  const src = clean(text);
  if (!src) return [];
  const found = [];
  // Capture body may include abbreviation dots (P.Bezruče / ul. X). Do NOT use [^,;.] —
  // that class stops at the first "." and truncates initials.
  const re =
    /\b(?:ve\s+směru|v\s+směru|(?<![A-Za-zÁ-Žá-ž])směr)\s+((?:na\s+|do\s+|z\s+|od\s+)?[^,;]{1,120})/giu;
  let m;
  while ((m = re.exec(src))) {
    const matchStart = m.index;
    const bodyOffset = m[0].length - m[1].length;
    let chunk = clipExtractedValueAtStructuralEnd(m[1], 120);
    // Do not swallow a later "ve směru …" inside this capture (urban multi-clause).
    chunk = clean(chunk.split(DIRECTION_NESTED_MARKER_RE)[0]);
    chunk = clean(chunk.split(DIRECTION_DEST_STOP_RE)[0]);
    chunk = clean(chunk.split(DIRECTION_TAIL_BOUNDARY_RE)[0]);
    // "Bohdalec až ke křižovatce…" → stop before "až"
    chunk = clean(chunk.split(/\s+až\b/i)[0]);
    chunk = normalizeInitialDotSpacing(chunk);
    const norm = normalizeDirectionHuman(chunk);
    if (norm) found.push(norm);
    // Rewind past marker + kept chunk so a nested direction marker still matches.
    const advance = Math.max(1, bodyOffset + (chunk ? chunk.length : 1));
    re.lastIndex = Math.min(src.length, matchStart + advance);
  }
  const uniq = [];
  for (const d of found) {
    if (!uniq.some((x) => samePlaceName(x, d))) uniq.push(d);
  }
  return uniq;
}

function extractDirectionHumanFromComment(text) {
  const dests = collectDirectionDestinationsFromComment(text);
  if (!dests.length) return null;
  const isTurnSide = (d) => /^(?:na\s+|do\s+|z\s+)?(?:vlevo|vpravo)$/i.test(d);
  const placeLike = dests.filter((d) => !isTurnSide(d));
  const turnLike = dests.filter((d) => isTurnSide(d));
  // Prefer a single place/centrum destination over turn-side "vlevo/vpravo".
  if (placeLike.length === 1) return placeLike[0];
  // Multiple distinct place destinations (urban multi-way routing) → no single SMĚR.
  if (placeLike.length > 1) return null;
  if (turnLike.length === 1) return turnLike[0];
  return null;
}

/**
 * Prefer classed road identity from comment when structured value is bare digits
 * (e.g. structured "26" + comment "I/26" → "I/26"). Never invents a class without evidence.
 */
export function preferClassedRoadNumber(structured, fromComment) {
  const s = clean(structured).replace(/\s+/g, "");
  const c = clean(fromComment).replace(/\s+/g, "");
  if (!s) return c || null;
  if (!c) return s;
  // III. class Czech roads may use 5-digit numbers (e.g. III/03554).
  const bare = s.match(/^(\d{1,6}[A-Za-z]?)$/i);
  const classed = c.match(/^(I{1,3}|II|III|D)\/(\d{1,6}[A-Za-z]?)$/i);
  if (bare && classed && bare[1].toLowerCase() === classed[2].toLowerCase()) {
    return classed[1].toUpperCase() + "/" + classed[2];
  }
  if (/^(I{1,3}|II|III|D)\//i.test(s)) {
    const m = s.match(/^(I{1,3}|II|III|D)\/(\d{1,6}[A-Za-z]?)$/i);
    if (m) return m[1].toUpperCase() + "/" + m[2];
    return s;
  }
  return s;
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
  if (
    /tunel|\bmost\b|MÚK\b|křižovatka|nádraží|terminál|parkovišt|parkovací\s+dům|přejezd|nájezd|sjezd|odpočívk/i.test(
      t
    )
  ) {
    return false;
  }
  if (/\btřída\b/i.test(t)) return true;
  if (isPrahaCityPartName(t)) return false;
  // Czech street morphology: adjective (-ská) + possessive genitive (-ského / -ého).
  const STREET_END =
    /(?:ská|cká|ovská|ová|ova|ná|ní|ského|ckého|kého|ého|ího)$/i;
  if (/\s/.test(t)) {
    if (/\ba\b/i.test(t)) return false;
    return /(?:ská|cká|ovská)(?:\s|$)/i.test(t);
  }
  return STREET_END.test(t);
}

/** True when a token must not become the white municipality entrance board. */
export function looksLikeNonMunicipalityPlace(raw) {
  const t = clean(raw);
  if (!t) return false;
  if (isPrahaCityPartName(t)) return true;
  if (isNumericCityPartName(t)) return true;
  if (
    /náměstí|nábřeží|tunel|\bmost\b|MÚK\b|křižovatka|nádraží|terminál|parkovišt|parkovací\s+dům|přejezd|nájezd|sjezd|odpočívk/i.test(
      t
    )
  ) {
    return true;
  }
  return looksLikeStreetName(t);
}

/** Named non-street transport object kinds that must never become Ulice. */
function isNamedNonStreetKind(kind) {
  return (
    kind === LOCATION_KIND.TUNNEL ||
    kind === LOCATION_KIND.BRIDGE ||
    kind === LOCATION_KIND.SQUARE ||
    kind === LOCATION_KIND.INTERSECTION ||
    kind === LOCATION_KIND.STATION ||
    kind === LOCATION_KIND.PARKING ||
    kind === LOCATION_KIND.RAILWAY_CROSSING ||
    kind === LOCATION_KIND.RAMP ||
    kind === LOCATION_KIND.EXIT_RAMP ||
    kind === LOCATION_KIND.REST_AREA
  );
}

/**
 * Sanitize municipality name captured after "v obci" / "v katastru obce".
 * Keeps full multi-word official names; strips leaked traffic clauses and
 * parenthetical locality details ("Velký Újezd (u domů č. 100…" → "Velký Újezd").
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
  // Strip parenthetical locality contamination (complete or dangling open paren).
  city = clean(city.replace(/\s*\([^)]*$/u, ""));
  city = clean(city.replace(/\s*\([^)]*\)\s*$/u, ""));
  city = clean(city);
  if (!city) return null;
  if (!/^[A-ZÁ-Ž]/u.test(city)) return null;
  if (looksLikeRoadNumberToken(city)) return null;
  if (/^p\s*\+\s*r\b/i.test(city)) return null;
  if (/^ulice\b|\btřída\b/i.test(city)) return null;
  if (/^okres\b|^okr\./i.test(city)) return null;
  if (looksLikeNonMunicipalityPlace(city)) return null;
  // Reject dangling delimiter contamination.
  if (/[()]$/.test(city) || /\($/.test(city)) return null;
  return city;
}

/**
 * Parenthetical locality detail after "v obci {Municipality} (…)" — never part of municipality.
 * Fail-closed: only house / č.p. style details.
 */
export function extractMunicipalityParentheticalLocalityDetail(rawText) {
  const text = clean(rawText);
  if (!text) return null;
  // Do not use \\b before "v" — Czech letters before "v obci" kill ASCII-ish word boundaries.
  const m = text.match(
    /(?:^|[^\p{L}])v\s+obci\s+[A-ZÁ-Ž][^,(]{1,60}?\s*\(([^)]{3,100})\)/u
  );
  if (!m) return null;
  let detail = sanitizeExtractedValueToken(m[1]);
  if (!detail) return null;
  if (!/(?:^|\s)(?:u\s+domů|č\.?\s*\d|č\.?\s*p\.|domu|domech)/iu.test(detail)) return null;
  return detail;
}

/**
 * TMC / Alert-C segment or area labels (e.g. "Branky – Police-jih") — never municipality.
 */
export function looksLikeSegmentOrAreaLabel(raw) {
  const t = clean(raw);
  if (!t) return false;
  if (/[–—]/.test(t)) return true;
  if (/\s+-\s+/.test(t)) return true;
  if (/-(jih|sever|východ|západ)\b/i.test(t)) return true;
  return false;
}

/**
 * Prefer the fuller official multi-word municipality when structured field was
 * truncated to the first token (e.g. "České" vs "České Budějovice").
 * Never prefers TMC segment labels over an explicit municipality from the comment.
 */
export function preferFullerMunicipalityName(structured, fromComment) {
  const a = clean(structured);
  const b = clean(fromComment);
  if (!a) return b || null;
  if (!b) return a;
  if (looksLikeSegmentOrAreaLabel(a) && !looksLikeSegmentOrAreaLabel(b)) return b;
  if (looksLikeSegmentOrAreaLabel(b) && !looksLikeSegmentOrAreaLabel(a)) return a;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return a;
  if (bl.startsWith(al + " ") || bl.startsWith(al + "-")) return b;
  if (al.startsWith(bl + " ") || al.startsWith(bl + "-")) return a;
  return a;
}

/**
 * Road number from official NDIC text when structured roadNumber is empty.
 * Only explicit "na silnici N" / "silnice N" / "silnice č. III/…" forms — never invents roads.
 * Supports 5–6 digit III-class numbers (e.g. III/03554).
 */
export function extractRoadNumberFromOfficialComment(rawText) {
  const all = extractAllRoadNumbersFromOfficialComment(rawText);
  return all.length ? all[0] : null;
}

/**
 * All explicit classed road identities present in official comment text (order preserved).
 */
export function extractAllRoadNumbersFromOfficialComment(rawText) {
  const text = clean(rawText);
  if (!text) return [];
  const found = [];
  const re =
    /\b(?:(?:na\s+)?silnici|silnice|sil\.)\s*(?:č\.\s*)?((?:I{1,3}|II|III)\s*\/\s*\d{1,6}[A-Za-z]?)\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const norm = clean(m[1]).replace(/\s+/g, "").replace(/^(i{1,3}|ii|iii)\//i, (x) => x.toUpperCase());
    const canon = norm.replace(/^(I{1,3}|II|III)\//i, (_, cls) => String(cls).toUpperCase() + "/");
    if (canon && !found.some((x) => x.toLowerCase() === canon.toLowerCase())) found.push(canon);
  }
  // Also bare "III/03554" after "silnice č." already covered; catch remaining classed tokens
  // only when preceded by silnice/sil. context nearby (avoid random fractions).
  if (!found.length) {
    const m2 =
      text.match(/\bna\s+silnici\s+((?:I{1,3}|II|III)\s*\/\s*)?(\d{1,6}[A-Za-z]?)\b/i) ||
      text.match(/\bsilnice\s+(?:č\.\s*)?((?:I{1,3}|II|III)\s*\/\s*)?(\d{1,6}[A-Za-z]?)\b/i) ||
      text.match(/\bsil\.\s*(?:č\.\s*)?((?:I{1,3}|II|III)\s*\/\s*)?(\d{1,6}[A-Za-z]?)\b/i);
    if (m2) {
      const cls = clean(m2[1] || "").replace(/\s+/g, "");
      const num = clean(m2[2] || "");
      if (num) found.push(cls ? (cls.endsWith("/") ? cls : cls + "/") + num : num);
    }
  }
  return found.map((r) => {
    const m = r.match(/^(I{1,3}|II|III|D)\/(\d{1,6}[A-Za-z]?)$/i);
    return m ? m[1].toUpperCase() + "/" + m[2] : r;
  });
}

/** Structured road, else safe comment extraction. Prefer classed identity when evidence exists. */
export function resolvePresentationRoadNumber(input = {}, factsIn = null) {
  const structured = clean(input.road || input.roadNumber);
  const facts = factsIn || parseOfficialCommentFacts(sourceBlob(input));
  const fromComment =
    clean(facts.roadNumber) || extractRoadNumberFromOfficialComment(sourceBlob(input));
  if (structured && fromComment) {
    return preferClassedRoadNumber(structured, fromComment);
  }
  if (structured) return structured;
  return fromComment || null;
}

export function classifyLocationKindFromName(name) {
  const t = clean(name);
  if (!t) return LOCATION_KIND.UNKNOWN;
  if (/parkovací\s+dům|parkovišt|\bP\s*\+\s*[RG]\b/i.test(t)) return LOCATION_KIND.PARKING;
  if (/tunel/i.test(t)) return LOCATION_KIND.TUNNEL;
  if (/\bmost\b/i.test(t)) return LOCATION_KIND.BRIDGE;
  if (/železniční(?:ho)?\s+přejezd|přejezd/i.test(t)) return LOCATION_KIND.RAILWAY_CROSSING;
  if (/MÚK\b|křižovatka/i.test(t)) return LOCATION_KIND.INTERSECTION;
  if (/\bnájezd\b/i.test(t)) return LOCATION_KIND.RAMP;
  if (/\bsjezd\b/i.test(t)) return LOCATION_KIND.EXIT_RAMP;
  if (/odpočívk/i.test(t)) return LOCATION_KIND.REST_AREA;
  if (/náměstí/i.test(t)) return LOCATION_KIND.SQUARE;
  if (/nádraží|terminál/i.test(t)) return LOCATION_KIND.STATION;
  if (/^ulice\b|\btřída\b/i.test(t)) return LOCATION_KIND.STREET;
  if (looksLikeRoadNumberToken(t)) return LOCATION_KIND.ROAD;
  if (/^praha\s+\d/i.test(t)) return LOCATION_KIND.CITY_PART;
  if (isNumericCityPartName(t)) return LOCATION_KIND.CITY_PART;
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
  // NDIC may prefix tunnels as "ulice Tunel X" / "ulice Brusnický tunel" — strip that.
  const leadRaw = clean(text.split(/[,;]/)[0] || "");
  const lead = streetBareName(leadRaw);
  if (
    lead &&
    !looksLikeRoadNumberToken(lead) &&
    !isPrahaCityPartName(lead) &&
    !/^od\s+\d/i.test(lead) &&
    /tunel|\bmost\b|MÚK\b|křižovatka|nádraží|terminál|náměstí|parkovací\s+dům|přejezd|nájezd|sjezd|odpočívk/i.test(
      lead
    )
  ) {
    return { name: lead, kind: classifyLocationKindFromName(lead) };
  }

  // Full-text scan with direction clauses removed (avoid "směr Barrandovský most").
  const scan = text.replace(/\bsměr(?:em)?\s+[^,;.]{2,80}/gi, " ");

  // Railway crossing with explicit identifier (e.g. P1234) — keep type + id.
  // Do not use \b before "ž…" — JS word boundaries are ASCII-only.
  const railId = scan.match(
    /(?:^|[^\p{L}\p{N}_])železniční(?:ho)?\s+přejezd(?:u)?\s+([A-Z]\d{2,6}|\d{2,6})\b/iu
  );
  if (railId) {
    const id = clean(railId[1]).toUpperCase();
    return {
      name: "železniční přejezd " + id,
      kind: LOCATION_KIND.RAILWAY_CROSSING,
      objectIdentifier: id,
    };
  }
  const railBare = scan.match(
    /(?:^|[^\p{L}\p{N}_])železniční(?:ho)?\s+přejezd(?:u)?(?=[\s,;.]|$)/iu
  );
  if (railBare) {
    return { name: "železniční přejezd", kind: LOCATION_KIND.RAILWAY_CROSSING };
  }

  const tunnel =
    scan.match(/\b([A-ZÁ-Ž][\p{L}\-]*(?:\s+[A-ZÁ-Ž][\p{L}\-]*){0,3}\s+[Tt]unel)\b/u) ||
    scan.match(/\b([Tt]unel\s+[A-ZÁ-Ž][\p{L}0-9\-]+)\b/u);
  if (tunnel) {
    const name = streetBareName(tunnel[1]);
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
  const intersection = scan.match(
    /\bkřižovatk[ay]\s+([A-ZÁ-Ž][\p{L}0-9\-]+(?:\s+[A-ZÁ-Ž][\p{L}0-9\-]+){0,3})\b/u
  );
  if (intersection) {
    return {
      name: "křižovatka " + clean(intersection[1]),
      kind: LOCATION_KIND.INTERSECTION,
    };
  }
  const ramp = scan.match(
    /\bnájezd(?:u)?\s+([A-ZÁ-Ž][\p{L}0-9\-]+(?:\s+[A-ZÁ-Ž][\p{L}0-9\-]+){0,3})\b/u
  );
  if (ramp) {
    return { name: "nájezd " + clean(ramp[1]), kind: LOCATION_KIND.RAMP };
  }
  const exitRamp = scan.match(
    /\bsjezd(?:u)?\s+([A-ZÁ-Ž][\p{L}0-9\-]+(?:\s+[A-ZÁ-Ž][\p{L}0-9\-]+){0,3})\b/u
  );
  if (exitRamp) {
    return {
      name: "sjezd " + clean(exitRamp[1]),
      kind: LOCATION_KIND.EXIT_RAMP,
    };
  }
  const rest = scan.match(
    /\bodpočívk[ay]\s+([A-ZÁ-Ž][\p{L}0-9\-]+(?:\s+[A-ZÁ-Ž][\p{L}0-9\-]+){0,3})\b/u
  );
  if (rest) {
    return {
      name: "odpočívka " + clean(rest[1]),
      kind: LOCATION_KIND.REST_AREA,
    };
  }
  const square = scan.match(/\b([A-ZÁ-Ž][\p{L}\-]*(?:\s+[A-ZÁ-Ž][\p{L}\-]*){0,3}\s+náměstí)\b/u);
  if (square) return { name: clean(square[1]), kind: LOCATION_KIND.SQUARE };

  return null;
}

/**
 * Concrete closed object phrase already present after "úplná uzavírka …" in NDIC text.
 * Fail-closed: only when source names a transport object (not generic komunikace/silnice).
 * Preserves source morphology + identifier (e.g. "železničního přejezdu P1234").
 */
export function extractFullClosureObjectPhrase(rawText) {
  const text = clean(rawText);
  if (!text) return null;
  const m = text.match(
    /úpln[áa]\s+uzavírk[ay]\s+([^,;.]{3,90}?)(?=\s+(?:na|ve?|u|od|do|pro|přes|směrem)\s+|[,;]|$)/iu
  );
  if (!m) return null;
  let obj = clean(m[1]);
  if (!obj) return null;
  // Strip trailing authority / boilerplate crumbs if lookahead missed.
  obj = clean(
    obj.replace(
      /\s+(?:Vydal|Zdroj|Od\s+\d|Do\s+\d|okres\b|okr\.|kraj\b).*$/i,
      ""
    )
  );
  if (!obj) return null;
  // Generic carriageway nouns — not a concrete object.
  if (
    /^(?:komunikace|silnice|ulice|vozovk[ay]|dálnice|místní\s+komunikace|silniční\s+komunikace)(?:\s|$)/i.test(
      obj
    )
  ) {
    return null;
  }
  // Must be an explicit transport-object category from the source.
  if (
    !/(?:železničního\s+)?přejezdu?|(?:^|\s)tunelu?\b|(?:^|\s)mostu?\b|křižovatk[ay]|nájezdu?|sjezdu?|odpočívk[ay]|MÚK\b/i.test(
      obj
    )
  ) {
    return null;
  }
  // Keep identifier when present; reject empty type-only if somehow truncated to noise.
  if (obj.length < 4) return null;
  return obj;
}

/**
 * Nominative display label for a parsed transport object (for facts / headers).
 * Never invents names — only normalizes known railway-crossing morphology.
 */
export function formatNamedTransportObjectLabel(named) {
  if (!named || !named.name) return null;
  const name = clean(named.name);
  if (!name) return null;
  if (named.kind === LOCATION_KIND.RAILWAY_CROSSING) {
    const id =
      clean(named.objectIdentifier) ||
      (name.match(/\b([A-Z]\d{2,6}|\d{2,6})\b/i) || [])[1] ||
      "";
    const idUp = id ? clean(id).toUpperCase() : "";
    if (idUp) return "železniční přejezd " + idUp;
    return "železniční přejezd";
  }
  return name;
}

/**
 * Street only with evidence: explicit "ulice:" / "v ulici" in comment, or structured street
 * that is not merely a copy of generic locationLabel / TMC area name.
 */
export function resolveConfirmedStreet(input = {}, factsIn = null) {
  const facts = factsIn || parseOfficialCommentFacts(sourceBlob(input));
  if (facts.streetMulti) return null;

  const named = facts.namedObject
    ? { name: facts.namedObject, kind: facts.namedObjectKind }
    : extractNamedTransportObject(sourceBlob(input));

  if (Array.isArray(facts.streets) && facts.streets.length >= 1) {
    const joined = formatStreetDisplayList(facts.streets, {
      asRange: facts.streetRange === true && facts.streets.length === 2,
    });
    if (joined && !looksLikeTruncatedFragment(joined) && !/[()]$/.test(joined)) {
      return joined;
    }
  }

  if (facts.streetFrom && facts.streetTo) {
    const range = formatStreetDisplayList([facts.streetFrom, facts.streetTo], {
      asRange: true,
    });
    if (range) return range;
  }

  if (facts.street) {
    const fromFacts = streetBareName(facts.street);
    if (!fromFacts) return null;
    if (looksLikeTruncatedFragment(fromFacts) || /[()]$/.test(fromFacts)) return null;
    // Reject unsanitized multi-street glue ("Olomoucká - ulice Lipenská").
    if (/\s-\s*ulice\s+/i.test(fromFacts) || /\sulice\s+/i.test(fromFacts)) return null;
    // "ulice Tunel …" / tunnel morphology must never become Ulice.
    if (named && samePlaceName(fromFacts, named.name) && isNamedNonStreetKind(named.kind)) {
      return null;
    }
    const kind = classifyLocationKindFromName(fromFacts);
    if (isNamedNonStreetKind(kind)) return null;
    return fromFacts;
  }

  const structured = streetBareName(input.streetHint || input.street);
  if (!structured) return null;
  if (looksLikeTruncatedFragment(structured) || /[()]$/.test(structured)) return null;
  if (/\s-\s*ulice\s+/i.test(structured) || /\sulice\s+/i.test(structured)) return null;
  const location = clean(input.location);
  // Never treat generic locationLabel / TMC area as street.
  if (location && samePlaceName(structured, location)) return null;
  if (named && samePlaceName(structured, named.name)) return null;
  if (looksLikeNonMunicipalityPlace(structured) && !/\btřída\b/i.test(structured)) {
    // Structured value that is clearly a named non-street object.
    const kind = classifyLocationKindFromName(structured);
    if (isNamedNonStreetKind(kind)) return null;
  }
  // Accept structured street only when comment contains street evidence markers,
  // or when structured is distinct from location and has street morphology + no named object.
  const blob = sourceBlob(input);
  if (/\bulice:?\s+/i.test(blob) || /\bv\s+ulici\s+/i.test(blob)) {
    // Source may say "ulice Tunel X" while the object is a tunnel — reject.
    if (isNamedNonStreetKind(classifyLocationKindFromName(structured))) return null;
    if (named && isNamedNonStreetKind(named.kind)) return null;
    return structured;
  }
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

/**
 * Parse street names from NDIC comment: "(ulice A - ulice B)", "ul. A, B", "ul. C".
 * Returns unique bare street names in source order. Never invents.
 */
export function extractStreetNamesFromOfficialComment(rawText) {
  const text = clean(rawText);
  if (!text) return [];
  const found = [];
  const push = (raw) => {
    let sn = sanitizeExtractedValueToken(streetBareName(raw));
    if (!sn) return;
    sn = clean(
      sn.split(
        /\s+(?:v\s+obci|za\s+účelem|ve\s+směru|v\s+souvislosti|z\s+důvodu|v\s+rámci|před\s+křižovatk|od\s+\d)/i
      )[0]
    );
    sn = sanitizeExtractedValueToken(sn);
    if (!sn) return;
    if (/^(bude|byl|je|jsou)\b/i.test(sn) || /\buzavřen/i.test(sn)) return;
    if (/^(práce|oprava|omezení)\b/i.test(sn)) return;
    if (/[()]$/.test(sn) || looksLikeTruncatedFragment(sn)) return;
    if (/\s-\s*ulice\s+/i.test(sn) || /\sulice\s+/i.test(sn)) return;
    if (sn.length > 48) return;
    if (/\s/.test(sn) && !/^(?:náměstí|třída)\b/i.test(sn) && sn.split(/\s+/).length > 3) {
      return;
    }
    if (
      /za\s+účelem|vyblokován|stavebních|souvislosti|křižovatk|prováděn|akce\s+[„"]/i.test(sn)
    ) {
      return;
    }
    if (!looksLikeStreetName(sn) && !/náměstí/i.test(sn)) return;
    if (isNamedNonStreetKind(classifyLocationKindFromName(sn))) return;
    if (!found.some((x) => samePlaceName(x, sn))) found.push(sn);
  };

  const paren = text.match(/\(\s*ulice\s+([^)]+?)\)/i);
  if (paren) {
    const parts = String(paren[1]).split(/\s*-\s*ulice\s+|\s*,\s*(?:ulice\s+|ul\.\s*)?/i);
    for (const p of parts) push(p);
  }

  // Prefer streets from the closure lead; ignore cross-street names after purpose clauses.
  let scan = text;
  const closureLead = text.match(
    /((?:úpln[áa]|částečn[áa])\s+uzavírk[\s\S]{0,320})/i
  );
  if (closureLead) {
    scan = clean(String(closureLead[1]).split(/\s+(?:za\s+účelem|v\s+souvislosti|v\s+rámci)\b/i)[0]);
  }

  const ulLists = scan.matchAll(
    /\bul\.\s*([^,;()]{2,60}?)(?=\s+(?:a\s+silnice|v\s+obci|za\s+účelem|ve\s+směru|v\s+souvislosti|z\s+důvodu|v\s+rámci|v\s+[A-ZÁ-Ž]|Od\s+\d|Do\s+\d)|[,;]|$)/giu
  );
  for (const m of ulLists) {
    const chunk = clean(m[1]);
    if (!chunk) continue;
    for (const p of chunk.split(/\s*,\s*/)) push(p);
  }

  const bareUlice = text.match(/\bulice:?\s+([^,;()]{2,80})/i);
  if (bareUlice && !paren) {
    const chunk = clean(bareUlice[1]);
    if (/\s-\s*ulice\s+/i.test(chunk) || /\sulice\s+/i.test(chunk)) {
      const parts = chunk.split(/\s*-\s*ulice\s+|\s*,\s*(?:ulice\s+)?/i);
      for (const p of parts) push(p);
    } else if (!/[-–—]/.test(chunk)) {
      push(chunk);
    }
  }

  // Comma-separated street lists: "ulice: A, B, C, D" (do not stop at first comma).
  const bareUliceList = text.match(/\bulice:?\s+((?:[^,;]+,\s*){1,}[^,;.]+)/i);
  if (bareUliceList && !paren) {
    const listChunk = clean(
      String(bareUliceList[1]).split(/\s+(?:v\s+obci|okr\.|okres|Od\s+\d|Do\s+\d|Vydal)/i)[0]
    );
    for (const p of listChunk.split(/\s*,\s*/)) push(p);
  }

  // Range / between patterns when bare list missed a genitive street name.
  const range = extractStreetRangeFromOfficialComment(text);
  if (range) {
    push(range.streetFrom);
    push(range.streetTo);
  }

  return found;
}

export function formatStreetDisplayList(streets, opts = {}) {
  const list = (streets || []).map((s) => clean(s)).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  if (list.length === 2 && (opts.asRange === true || opts.streetRange === true)) {
    return list[0] + " – " + list[1];
  }
  return list.join(" / ");
}

/**
 * Two-street segment: "ulice A - ulice B", "ul. A - ul. B",
 * "mezi ulicemi A a B", "od ulice A k ulici B".
 * Returns { streetFrom, streetTo } or null. Never invents names.
 */
export function extractStreetRangeFromOfficialComment(rawText) {
  const text = clean(rawText);
  if (!text) return null;

  const toStreet = (raw) => {
    let sn = sanitizeExtractedValueToken(streetBareName(raw));
    if (!sn) return null;
    sn = clean(
      sn.split(
        /\s+(?:v\s+obci|za\s+účelem|ve\s+směru|v\s+souvislosti|z\s+důvodu|v\s+rámci|před\s+křižovatk|od\s+\d)/i
      )[0]
    );
    sn = sanitizeExtractedValueToken(sn);
    if (!sn || looksLikeTruncatedFragment(sn) || /[()]$/.test(sn)) return null;
    if (/\s-\s*ulice\s+/i.test(sn) || /\sulice\s+/i.test(sn)) return null;
    if (!looksLikeStreetName(sn) && !/náměstí/i.test(sn)) return null;
    if (isNamedNonStreetKind(classifyLocationKindFromName(sn))) return null;
    return sn;
  };

  const pairs = [
    text.match(/\bulice:?\s+([^,;()]+?)\s*[-–—]\s*ulice\s+([^,;()]+)/i),
    text.match(/\bul\.\s*([^,;()]+?)\s*[-–—]\s*ul\.\s*([^,;()]+)/i),
    text.match(/\bmezi\s+ulicemi\s+([^,;]+?)\s+a\s+([^,;]+?)(?=\s*[,;]|$)/i),
    text.match(/\bod\s+ulice\s+([^,;]+?)\s+k\s+ulici\s+([^,;]+?)(?=\s*[,;]|$)/i),
  ];
  for (const m of pairs) {
    if (!m) continue;
    const streetFrom = toStreet(m[1]);
    const streetTo = toStreet(m[2]);
    if (streetFrom && streetTo && !samePlaceName(streetFrom, streetTo)) {
      return { streetFrom, streetTo };
    }
  }
  return null;
}

/**
 * Concrete work / reconstruction phrase from NDIC comment (not generic category).
 * Examples: "Rekonstrukce plynovodu", "výsprava vozovky", "údržba mostu".
 * Never invents; never returns bare "stavební práce" / "práce na silnici".
 */
export function extractSpecificWorkFromOfficialComment(rawText) {
  const text = clean(rawText);
  if (!text) return null;
  const cut = text.split(/\bVydal\s*:/i)[0] || text;
  const GENERIC =
    /^(?:stavební\s+práce|práce\s+na\s+silnici|práce\s+na\s+inženýrských\s+sítích|dopravní\s+omezení|uzavírka|uzavřeno)\.?$/i;
  const re =
    /(?:^|[,;\s])((?:pravidelná\s+)?(?:rekonstrukce|oprava|údržba(?:\s+a\s+opravy)?|výsprava|pokládka|výkop|uložení|revitalizace)\s+[^,;.]+)/giu;
  let best = null;
  for (const m of cut.matchAll(re)) {
    let phrase = clean(m[1]);
    phrase = clean(
      phrase.split(
        /\s+v\s+MK\b|\s+v\s+ulici\b|\s+v\s+obci\b|\s+ulice\b|\s+ve\s+směru\b|\s+z\s+důvodu\b/i
      )[0]
    );
    phrase = clipExtractedValueAtStructuralEnd(phrase, 90);
    phrase = sanitizeExtractedValueToken(phrase);
    if (!phrase || phrase.length < 8 || GENERIC.test(phrase)) continue;
    if (/^(?:od|do)\s+\d/i.test(phrase)) continue;
    if (!best || phrase.length < best.length) best = phrase;
  }
  return best;
}

/**
 * Precise place qualifier from NDIC (parcel / cadastral hint) — never invents.
 * Kept out of the main title; used in expanded "Upřesnění místa".
 */
export function extractLocationQualifierFromOfficialComment(rawText) {
  const text = clean(rawText);
  if (!text) return null;
  const cut = text.split(/\bVydal\s*:/i)[0] || text;
  const m =
    cut.match(/\bu\s+p\.?\s*p\.?\s*č\.\s*([\d]+(?:\/[\d]+)?)/i) ||
    cut.match(/\bu\s+parcel(?:y|ní\s+číslo)?\s*(?:č\.)?\s*([\d]+(?:\/[\d]+)?)/i);
  if (!m) return null;
  const num = clean(m[1]);
  if (!num) return null;
  return "u p.p.č. " + num;
}

/**
 * Explicit event reason from "z důvodu …" plus optional quoted event/action name.
 */
export function extractEventReasonFromOfficialComment(rawText) {
  const text = clean(rawText);
  if (!text) return { reasonText: null, eventName: null, reasonKind: null };
  // Never take publisher lines as reason / quoted names.
  const cut = text.split(/\bVydal\s*:/i)[0] || text;
  const m = cut.match(/\bz\s+důvodu\s+(.+)$/is);
  if (!m) return { reasonText: null, eventName: null, reasonKind: null };
  // Keep abbreviation dots; stop at semicolon, direction clause, or sentence end.
  let reasonText = clipExtractedValueAtStructuralEnd(m[1], 180);
  reasonText = clean(reasonText.split(/\s*;\s*/)[0]);
  reasonText = clean(
    reasonText.split(/\s+(?:směr|ve\s+směru|v\s+směru)\b/i)[0]
  );
  reasonText = sanitizeExtractedValueToken(reasonText);
  if (!reasonText) return { reasonText: null, eventName: null, reasonKind: null };
  // Drop trailing sentence crumbs after a closed quote.
  reasonText = clean(reasonText.replace(/(["“”„][^"“”„]*["“”„]).*$/u, "$1"));
  let eventName = null;
  const q =
    reasonText.match(/[„"]([^„"]{3,80})[“"]/) ||
    reasonText.match(/"([^"]{3,80})"/) ||
    reasonText.match(/„([^“]{3,80})“/);
  if (q) eventName = sanitizeExtractedValueToken(q[1] || q[2]);
  // Quote may sit just after reason when period was between name and end.
  if (!eventName) {
    const q2 =
      cut.match(/\bz\s+důvodu[\s\S]{0,160}?[„"]([^„"]{3,80})[“"]/i) ||
      cut.match(/\bz\s+důvodu[\s\S]{0,160}?"([^"]{3,80})"/i);
    if (q2) eventName = sanitizeExtractedValueToken(q2[1]);
  }
  let reasonKind = "OTHER";
  if (/kulturní\s+akc/i.test(reasonText)) reasonKind = "CULTURAL_EVENT";
  else if (/stavební\s+prac/i.test(reasonText)) reasonKind = "ROADWORKS";
  else if (/\búdržb/i.test(reasonText)) reasonKind = "MAINTENANCE";
  else if (/\boprav/i.test(reasonText)) reasonKind = "REPAIR";
  else if (/\bhavár/i.test(reasonText)) reasonKind = "ACCIDENT";
  else if (/\bpožár/i.test(reasonText)) reasonKind = "FIRE";
  else if (/\bIZS\b/i.test(reasonText)) reasonKind = "EMERGENCY_SERVICES";
  return { reasonText, eventName, reasonKind };
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
    streets: [],
    streetMulti: false,
    streetFrom: null,
    streetTo: null,
    streetRange: false,
    city: null,
    cityPart: null,
    district: null,
    localityDetail: null,
    parkingName: null,
    parkingCity: null,
    parkingType: null,
    parkingOccupancyPercent: null,
    parkingFullyOccupied: false,
    parkingFreeUpperBound: null,
    parkingFewSpacesLeft: false,
    queueLengthKm: null,
    heavyTrafficLengthKm: null,
    municipalityRelation: null,
    roadNumber: null,
    roadNumbers: [],
    eventReason: null,
    eventName: null,
    reasonKind: null,
    specificWork: null,
    locationQualifier: null,
    openLaneCount: null,
    affectedRoadPart: null,
    roadworkDetail: null,
    situationPhrases: [],
    isEmptyTemplate: false,
    namedObject: null,
    namedObjectKind: null,
    objectIdentifier: null,
    locationKind: LOCATION_KIND.UNKNOWN,
  };
  if (!text) return out;
  if (EMPTY_IMPACT_RE.test(text)) {
    out.isEmptyTemplate = true;
    return out;
  }

  out.roadNumbers = extractAllRoadNumbersFromOfficialComment(text);
  out.roadNumber = out.roadNumbers.length ? out.roadNumbers[0] : null;

  const eventReason = extractEventReasonFromOfficialComment(text);
  out.eventReason = eventReason.reasonText;
  out.eventName = eventReason.eventName;
  out.reasonKind = eventReason.reasonKind;
  out.specificWork = extractSpecificWorkFromOfficialComment(text);
  out.localityDetail = extractMunicipalityParentheticalLocalityDetail(text);
  out.locationQualifier = extractLocationQualifierFromOfficialComment(text);

  // Explicit open / passable lane count from NDIC ("počet průjezdných pruhů: 2").
  {
    const laneM = text.match(/počet\s+průjezdných\s+pruhů\s*:\s*(\d{1,2})\b/i);
    if (laneM) {
      const n = Number(laneM[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 20) out.openLaneCount = n;
    }
  }
  // Work/restriction profile location ("rozsah: zpevněná krajnice") — never invents closure.
  if (/rozsah\s*:\s*zpevněn[áa]\s+krajnice/i.test(text)) {
    out.affectedRoadPart = "HARD_SHOULDER";
  } else if (/rozsah\s*:\s*krajnice/i.test(text)) {
    out.affectedRoadPart = "SHOULDER";
  }
  if (/údržba\s+a\s+opravy\s+mostů/i.test(text)) {
    out.roadworkDetail = "BRIDGE_MAINTENANCE";
  } else if (/údržba\s+a\s+opravy\b/i.test(text)) {
    out.roadworkDetail = "MAINTENANCE_REPAIR";
  } else if (/výsprava\s+tryskovou/i.test(text)) {
    out.roadworkDetail = "JET_PATCHING";
  }

  const named = extractNamedTransportObject(text);
  if (named) {
    out.namedObject = formatNamedTransportObjectLabel(named) || streetBareName(named.name);
    out.namedObjectKind = named.kind;
    out.objectIdentifier = named.objectIdentifier ? clean(named.objectIdentifier) : null;
    out.locationKind = named.kind;
  }

  // Location kilometrage (not queue/delay length). Preserve source order; allow negatives.
  const kmRange =
    text.match(
      /\bkm\s+(-?\d+(?:[.,]\d+)?)\s*(?:až|–|-|—)\s*(-?\d+(?:[.,]\d+)?)/i
    ) ||
    text.match(
      /\bmezi\s+km\s+(-?\d+(?:[.,]\d+)?)\s+a\s+(-?\d+(?:[.,]\d+)?)/i
    ) ||
    // NDIC: "mezi 36.77 a 36.84 km" (numbers before the km unit).
    text.match(
      /\bmezi\s+(-?\d+(?:[.,]\d+)?)\s+a\s+(-?\d+(?:[.,]\d+)?)\s*km\b/i
    ) ||
    text.match(
      /\b(-?\d+(?:[.,]\d+)?)\s*(?:až|–|-|—)\s*(-?\d+(?:[.,]\d+)?)\s*km\b/i
    );
  if (kmRange) {
    // Preserve source order (e.g. km 277,5–276,9) — never Math.min/max sort.
    out.kilometerFrom = formatKmToken(kmRange[1]);
    out.kilometerTo = formatKmToken(kmRange[2]);
    out.kilometerLabel = "km " + out.kilometerFrom + "–" + out.kilometerTo;
  } else {
    const kmPrefix = text.match(/\bkm\s+(-?\d+(?:[.,]\d+)?)\b/i);
    let kmToken = kmPrefix ? kmPrefix[1] : null;
    if (!kmToken) {
      // NDIC sometimes writes "43,2 km" (suffix). Skip length phrases (kolona/délka … km).
      const suffixRe = /\b(-?\d+(?:[.,]\d+)?)\s*km\b/gi;
      let m;
      while ((m = suffixRe.exec(text))) {
        const before = text.slice(Math.max(0, m.index - 36), m.index).toLowerCase();
        if (
          /\b(kolona|délka|delka|zúžení|zuzeni|vzdálenost|vzdalenost|po)\s*$/i.test(
            before.trimEnd()
          )
        ) {
          continue;
        }
        kmToken = m[1];
        break;
      }
    }
    if (kmToken != null) {
      out.kilometerFrom = formatKmToken(kmToken);
      out.kilometerLabel = "km " + out.kilometerFrom;
    }
  }

  const dirHuman = extractDirectionHumanFromComment(text);
  if (dirHuman) out.directionHuman = dirHuman;

  // Explicit event localization "u obce X" (not diversion "přes X", not "v katastru obce").
  const mUObce = text.match(
    /\bu\s+obce\s+([^,;]{2,80}?)(?=\s*(?:okres\b|okr\.|kraj\b|ulice\b|v\s+ulici\b|[,;]|$))/iu
  );
  if (mUObce) {
    const city = normalizeExtractedMunicipalityName(mUObce[1]);
    if (city) {
      out.city = city;
      out.municipalityRelation = "u_obce";
    }
  }

  if (!out.city) {
    const mObci = text.match(
      /\b(?:[Vv]\s+katastru\s+obce|[Vv]\s+obci|\bobec)\s+([^,;]{2,80}?)(?=\s*(?:okres\b|okr\.|kraj\b|ulice\b|v\s+ulici\b|[,;]|$))/u
    );
    if (mObci) {
      const city = normalizeExtractedMunicipalityName(mObci[1]);
      if (city) out.city = city;
    }
  }

  const streetIn =
    text.match(/\bv\s+ulici\s+([^,;()]{2,80})/i) ||
    text.match(/\bulice:?\s+([^,;()]{2,80})/i) ||
    text.match(/\bul\.\s*([^,;()]{2,80})/i);
  if (streetIn) {
    let sn = streetBareName(streetIn[1]);
    sn = clean(sn.split(/\s+v\s+obci\b/i)[0]);
    sn = clean(sn.split(/\s+okres\b/i)[0]);
    sn = sanitizeExtractedValueToken(sn);
    if (
      !sn ||
      /^(bude|byl|je|jsou)\b/i.test(sn) ||
      /\buzavřen/i.test(sn) ||
      /^(práce|oprava|omezení)\b/i.test(sn)
    ) {
      sn = "";
    }
    if (sn) {
      const snKind = classifyLocationKindFromName(sn);
      if (isNamedNonStreetKind(snKind)) {
        // Source said "ulice …" but the token is a tunnel/bridge/etc.
        if (!out.namedObject || /^ulice\b/i.test(out.namedObject)) {
          out.namedObject = sn;
          out.namedObjectKind = snKind;
          out.locationKind = snKind;
        }
      } else {
        out.street = sn;
      }
    }
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

  // Explicit multi-street parse: "(ulice A - ulice B)", "ul. A, B", "ul. C".
  {
    const range = extractStreetRangeFromOfficialComment(text);
    const streets = extractStreetNamesFromOfficialComment(text);
    if (range) {
      out.streetFrom = range.streetFrom;
      out.streetTo = range.streetTo;
      out.streetRange = true;
      out.streets = [range.streetFrom, range.streetTo];
      // Prefer range names; merge any extra confirmed streets after the pair.
      for (const s of streets) {
        if (!out.streets.some((x) => samePlaceName(x, s))) out.streets.push(s);
      }
      out.street = formatStreetDisplayList(
        [range.streetFrom, range.streetTo],
        { asRange: true }
      );
      out.streetMulti = out.streets.length >= 4;
    } else if (streets.length) {
      out.streets = streets;
      if (streets.length === 1) {
        // multiStreetBlob may already know a longer comma list — do not demote.
        if (!out.streetMulti) {
          out.street = streets[0];
          out.streetMulti = false;
        }
      } else {
        // Prefer readable joined form over opaque "více ulic" for 2–3 streets.
        out.street = formatStreetDisplayList(streets);
        out.streetMulti = streets.length >= 4 || out.streetMulti === true;
      }
    }
  }

  // Bare ", Town, okr." municipality when no "v obci" marker exists.
  if (!out.city) {
    const mTown = text.match(/,\s*([^,;]+?)\s*,\s*okr\./u);
    if (mTown) {
      const town = normalizeExtractedMunicipalityName(mTown[1]);
      if (
        town &&
        !looksLikeStreetName(town) &&
        !looksLikeNonMunicipalityPlace(town) &&
        !looksLikeRoadNumberToken(town)
      ) {
        out.city = town;
      }
    }
  }

  // "ulice X, CityPart, City," pattern (Hornopolní) — only when City is a real municipality.
  // Also covers "ulice Tunel X, Praha 5, Praha" where X is a named tunnel (not a street).
  const locTrip = text.match(
    /\bulice:?\s+([^,;]+),\s*([^,;]+),\s*([^,;]+?)(?=\s*,|\s*$)/u
  );
  if (locTrip && !out.streetMulti) {
    const s0 = streetBareName(locTrip[1]);
    const s1 = clean(locTrip[2]);
    const s2raw = clean(locTrip[3]);
    const s2 = normalizeExtractedMunicipalityName(s2raw);
    const s0Kind = classifyLocationKindFromName(s0);
    const midIsPrahaPart = isPrahaCityPartName(s1);
    const midOk = s1 && (midIsPrahaPart || !looksLikeStreetName(s1) || /\s/.test(s1));
    if (s0 && midOk && (s2 || /^praha$/i.test(s2raw) || isPrahaCityPartName(s2raw))) {
      if (isNamedNonStreetKind(s0Kind)) {
        if (!out.namedObject || /^ulice\b/i.test(out.namedObject)) {
          out.namedObject = s0;
          out.namedObjectKind = s0Kind;
          out.locationKind = s0Kind;
        }
        out.street = null;
      } else if (s2) {
        out.street = s0;
      }
      if (midIsPrahaPart) {
        if (!out.cityPart) out.cityPart = s1;
      } else if (s2 && !isPrahaCityPartName(s1)) {
        out.cityPart = s1;
      }
      if (s2) {
        if (!out.city) out.city = s2;
      } else if (/^praha$/i.test(s2raw) && !out.city) {
        out.city = "Praha";
      } else if (isPrahaCityPartName(s2raw)) {
        if (!out.cityPart) out.cityPart = s2raw;
        if (!out.city) out.city = "Praha";
      }
    }
  }

  if (!out.city) {
    const cityHint = text.match(/,\s*([^,;]+?)\s*,\s*okr\./u);
    if (cityHint) {
      const hint = normalizeExtractedMunicipalityName(cityHint[1]);
      if (hint) out.city = hint;
    }
  }

  // "Praha 4, Praha" / "Praha 13, Praha" — city part + municipality (never Praha N as obec).
  const prahaPart = text.match(/\b(Praha\s+\d+[a-zA-Z]?)\s*,\s*Praha\b/u);
  if (prahaPart) {
    if (!out.cityPart || isPrahaCityPartName(out.cityPart)) {
      out.cityPart = clean(prahaPart[1]);
    }
    if (!out.city || isPrahaCityPartName(out.city)) out.city = "Praha";
  } else if (/\bPraha\b/u.test(text) && isPrahaCityPartName(out.city)) {
    // Mis-parsed city-part as municipality — demote.
    if (!out.cityPart) out.cityPart = out.city;
    out.city = "Praha";
  }

  // Urban district after street/road: ", Plzeň 4," / ", Brno 1," — demote to city + cityPart.
  if (!out.cityPart || !out.city) {
    const urbanDist = text.match(
      /,\s*([A-ZÁ-Ž][^,;]{1,40}?\s+\d{1,2}[A-Za-z]?)\s*,/u
    );
    if (urbanDist) {
      const split = splitMunicipalityAndCityPart(urbanDist[1]);
      if (split) {
        if (!out.cityPart) out.cityPart = split.cityPart;
        if (!out.city || isNumericCityPartName(out.city)) out.city = split.municipality;
      }
    }
  }

  // Final guard: tunnel/bridge names must never remain in street.
  if (out.street) {
    const sk = classifyLocationKindFromName(out.street);
    if (isNamedNonStreetKind(sk)) {
      if (!out.namedObject) {
        out.namedObject = streetBareName(out.street);
        out.namedObjectKind = sk;
        out.locationKind = sk;
      }
      out.street = null;
    } else {
      out.street = sanitizeExtractedValueToken(out.street);
    }
  }
  if (out.namedObject) out.namedObject = streetBareName(out.namedObject);
  if (out.city && isPrahaCityPartName(out.city)) {
    if (!out.cityPart) out.cityPart = out.city;
    out.city = /\bPraha\b/u.test(text) ? "Praha" : null;
  }
  if (out.city && isNumericCityPartName(out.city)) {
    const split = splitMunicipalityAndCityPart(out.city);
    if (split) {
      if (!out.cityPart) out.cityPart = split.cityPart;
      out.city = split.municipality;
    }
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
    // Height limits use Czech decimal commas — must not stop at "," in "3,7 m".
    /neprůjezdn[áaý]\s+pro\s+vozidla\s+vyšší\s+než\s+\d+(?:[.,]\d+)?\s*m/i,
    /neprůjezdn[ýáé]\s+[^,;.]{3,40}/i,
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
const NAMED_LANE_RE =
  "(?:levý|pravý|střední|západní|východní|severní|jižní|jeden)";

export function isSingleLaneRestriction(rawText) {
  const text = clean(rawText);
  if (!text) return false;
  // Named L/R/C/cardinal lane closed or impassable. "zúžená vozovka na jeden jízdní pruh"
  // is narrowing (handled separately) — do not invent "uzavřen" from it.
  const lane = NAMED_LANE_RE;
  if (
    new RegExp(lane + "\\s+jízdní\\s+pruh.{0,40}(?:uzavřen|neprůjezdn)", "i").test(text) ||
    new RegExp("(?:uzavřen|neprůjezdn).{0,40}" + lane + "\\s+jízdní\\s+pruh", "i").test(text) ||
    new RegExp("neprůjezdn[ýáé]\\s+" + lane + "\\s+jízdní\\s+pruh", "i").test(text) ||
    new RegExp("zúžen[ýáé]\\s+" + lane + "\\s+jízdní\\s+pruh", "i").test(text) ||
    new RegExp(lane + "\\s+jízdní\\s+pruh.{0,40}zúžen", "i").test(text) ||
    /odbočovací\s+pruh.{0,40}(?:uzavřen|vyblokován)/i.test(text) ||
    /(?:uzavřen|vyblokován).{0,40}odbočovací\s+pruh/i.test(text)
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
  // Whole tunnel closed — not a single lane / shoulder inside a tunnel.
  if (
    !isSingleLaneRestriction(text) &&
    !isShoulderOrVergeRestriction(text) &&
    (/(?:^|[,;.\s])tunel(?:y)?\s+(?:je\s+|jsou\s+)?uzavřen/i.test(text) ||
      /uzavřen[ýáo]?\s+tunel(?:y)?(?:[,;.\s]|$)/i.test(text))
  ) {
    return true;
  }
  if (/uzavřen[áao]\s+pro\s+veškerou\s+dopravu/i.test(text)) return true;
  if (/oba\s+směry.{0,30}uzavř/i.test(text)) return true;
  if (/všechny\s+jízdní\s+pruhy.{0,30}(?:uzavř|neprůjezdn)/i.test(text)) return true;
  if (/neprůjezdn[áaý]\s+(?:komunikace|silnice|dálnice|úsek)\b/i.test(text)) return true;
  if (/úplně\s+uzavřen/i.test(text) || /komunikace\s+dočasně\s+uzavřen/i.test(text)) {
    return true;
  }
  // Bare NDIC token ", uzavřeno," (local road / municipal notice) — full closure,
  // unless already classified as single-lane / shoulder / truck-only restriction.
  if (
    /(?:^|[,;]\s*)uzavřeno(?!\s+pro\s)(?:\s*[,;.]|\s+|$)/i.test(text) &&
    !isSingleLaneRestriction(text) &&
    !isShoulderOrVergeRestriction(text)
  ) {
    return true;
  }
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
  s = s.replace(/\bod\s+\d{1,2}\.\d{1,2}\.\d{4}[^,]{0,40},?\s*/gi, "");
  s = s.replace(/\bdo\s+\d{1,2}\.\d{1,2}\.\d{4}[^,]{0,40},?\s*/gi, "");
  s = s.replace(/\bVydal:\s*[^,]{2,80}/gi, "");
  s = s.replace(/\bZdroj:\s*[^,]{2,120}/gi, "");
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
 * Source-grounded only — never invent vehicle type from wrecked count alone.
 */
function formatAccidentSituationLead(source) {
  const text = clean(source);

  // Animal collision phrases (explicit in NDIC comment).
  if (
    /střet(?:u)?\s+osobní(?:ho)?\s+automobil(?:u)?\s+se\s+srn/i.test(text) ||
    /střet(?:u)?\s+osobní(?:ho)?\s+automobil(?:u)?\s+se\s+srnou/i.test(text)
  ) {
    return "Střet osobního automobilu se srnou";
  }
  if (/střet(?:u)?\s+osobní(?:ho)?\s+automobil(?:u)?\s+se\s+jelen/i.test(text)) {
    return "Střet osobního automobilu s jelenem";
  }
  if (
    /střet(?:u)?\s+osobní(?:ho)?\s+automobil(?:u)?\s+se\s+(?:zvěří|zvířetem)/i.test(text)
  ) {
    return "Střet osobního automobilu se zvěří";
  }

  const car = text.match(/(\d+)\s+osobní(?:ch)?\s+automobil(?:y|ů|u)?/i);
  const truck = text.match(
    /(\d+)\s+nákladní(?:ch)?\s+(?:automobil(?:y|ů|u)?|vozidel|vozidla|vozidlo)/i
  );
  // "vozidla" ≠ "vozidel" — previous vozidel? missed nominative plural.
  const wrecked = text.match(
    /(\d+)\s+havarovan(?:á|é|ých)\s+(?:vozidla|vozidlo|vozidel)/i
  );

  if (car && truck) {
    const nc = Number(car[1]);
    const nt = Number(truck[1]);
    if (nc === 1 && nt === 1) return "Nehoda osobního a nákladního automobilu";
    if (Number.isFinite(nc) && Number.isFinite(nt) && nc > 0 && nt > 0) {
      return "Nehoda " + nc + " osobních a " + nt + " nákladních vozidel";
    }
  }
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
    if (n === 1) return "Nehoda vozidla";
    if (n === 2) return "Nehoda dvou vozidel";
    if (n === 3) return "Nehoda tří vozidel";
    if (n === 4) return "Nehoda čtyř vozidel";
    if (Number.isFinite(n) && n > 0) return "Nehoda " + n + " vozidel";
  }

  // Singular uncounted wrecked + explicit OA (after abbreviation expand).
  if (
    /havarovan(?:é|á)\s+vozidlo/i.test(text) &&
    /osobní(?:ho)?\s+automobil/i.test(text)
  ) {
    return "Nehoda osobního automobilu";
  }
  if (/havarovan(?:é|á)\s+vozidlo/i.test(text)) {
    return "Nehoda. Havarované vozidlo";
  }
  return "Nehoda";
}

/**
 * Secondary impact facts when not already the primary cause lead.
 * Keeps obstacle / wildlife / fire available beside accident leads.
 */
function extractSecondaryImpactBits(source, cause, causeBits) {
  const text = clean(source);
  const lead = causeBits.join(" ");
  const bits = [];
  // Skip only when the primary lead is already the obstacle (not when eventType
  // is typed "prekazka" but cause resolved to broken vehicle / accident).
  if (
    /překážka\s+na\s+vozovce/i.test(text) &&
    cause !== PRIMARY_CAUSE.OBSTACLE &&
    !/překážka/i.test(lead)
  ) {
    bits.push("Překážka na vozovce");
  }
  if (
    /zvěř\s+na\s+vozovce/i.test(text) &&
    !/zvěř|srn|jelen/i.test(lead)
  ) {
    bits.push("Zvěř na vozovce");
  }
  if (/\bpožár\b/i.test(text) && !/požár/i.test(lead)) {
    bits.push("Požár");
  }
  if (
    /Lidé na vozovce|osoby na vozovce/i.test(text) &&
    !/lidé na vozovce|osoby na vozovce/i.test(lead)
  ) {
    bits.push("Lidé na vozovce");
  }
  return bits;
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
  if (/pravidelná\s+údržba/i.test(text)) bits.push("Pravidelná údržba");
  const speed =
    text.match(/\brychlost\s+snížen[ao]\s+na\s+(\d+)\s*km(?:\/h)?/i) ||
    text.match(/\bsnížení\s+rychlosti\s+na\s+(\d+)\s*km(?:\/h)?/i) ||
    text.match(/\bomezení\s+rychlosti\s+na\s+(\d+)\s*km(?:\/h)?/i);
  if (speed) {
    bits.push("Rychlost snížena na " + speed[1] + " km/h");
  }
  return bits;
}

/**
 * Narrowing / shuttle / truck-only / height / urban routing — source-grounded
 * impact bits that must not be dropped when a generic roadworks/closure lead wins.
 */
function extractOperationalImpactBits(source, causeBits, scopeBits) {
  const text = clean(source);
  const have = causeBits.concat(scopeBits).join(" ");
  const bits = [];

  if (/\bkyvadlový provoz\b/i.test(text) && !/kyvadlov/i.test(have)) {
    if (/\bjedním\s+jízdním\s+pruhem\b/i.test(text)) {
      bits.push("Kyvadlový provoz jedním jízdním pruhem");
    } else {
      bits.push("Kyvadlový provoz");
    }
  } else if (
    /\bstřídavý\s+jednosměrný\s+provoz\b/i.test(text) &&
    !/střídavý|jednosměrný|kyvadlov/i.test(have)
  ) {
    bits.push("Střídavý jednosměrný provoz");
  } else if (
    /\b(?:provoz\s+)?jedním jízdním pruhem\b/i.test(text) &&
    !/jedním jízdním pruhem|kyvadlov/i.test(have)
  ) {
    bits.push("Provoz jedním jízdním pruhem");
  } else if (
    /\bzúžen(?:á|í)\s+vozovk[ay]\s+na\s+jeden\s+jízdní\s+pruh\b/i.test(text) &&
    !/zúžen|jedním jízdním|kyvadlov/i.test(have)
  ) {
    bits.push("Zúžená vozovka na jeden jízdní pruh");
  } else if (
    /(?:^|[,;\s])zúžené\s+jízdní\s+pruhy(?:\s*[,;.]|\s+|$)/i.test(text) &&
    !/zúžen|jedním jízdním|kyvadlov/i.test(have)
  ) {
    bits.push("Jízdní pruhy jsou zúžené");
  }

  if (
    /výjezd\s+neprůjezdn/i.test(text) &&
    !/výjezd\s+neprůjezdn|neprůjezdn[ýáé]\s+výjezd/i.test(have + " " + bits.join(" "))
  ) {
    bits.push("Výjezd je neprůjezdný");
  }

  // Cardinal / named lane closed (západní/východní …) — not only L/R/C.
  {
    const closedLane =
      text.match(
        new RegExp(
          "uzavřen\\s+(" + NAMED_LANE_RE + "\\s+jízdní\\s+pruh)",
          "i"
        )
      ) ||
      text.match(
        new RegExp(
          "(" + NAMED_LANE_RE + "\\s+jízdní\\s+pruh).{0,24}uzavřen",
          "i"
        )
      );
    if (closedLane && !/jízdní pruh je uzavřen|západní|východní|severní|jižní/i.test(have)) {
      bits.push(capitalizeLanePhrase(closedLane[1]) + " je uzavřen");
    }
  }

  // Traffic routing by destination + lane/parking strip (urban multi-way works).
  {
    const routePatterns = [
      /(?:provoz\s+)?(?:ve\s+směru|v\s+směru)\s+na\s+([^,;]{2,40}?)\s+veden\s+((?:východním|západním|severním|jižním|levým|pravým|středním)\s+jízdním\s+pruhem|parkovacím\s+pruhem)/gi,
      /veden\s+provoz\s+(?:ve\s+směru|v\s+směru)\s+na\s+([^,;]{2,40}?)\s+((?:východním|západním|severním|jižním|levým|pravým|středním)\s+jízdním\s+pruhem|parkovacím\s+pruhem)/gi,
      /(?:ve\s+směru|v\s+směru)\s+na\s+([^,;]{2,40}?)\s+((?:východním|západním|severním|jižním|levým|pravým|středním)\s+jízdním\s+pruhem(?:\s+vozovky)?|parkovacím\s+pruhem)/gi,
    ];
    const seenRoute = new Set();
    for (const routeRe of routePatterns) {
      let rm;
      while ((rm = routeRe.exec(text))) {
        let dest = sanitizeExtractedValueToken(clean(rm[1]).split(DIRECTION_DEST_STOP_RE)[0]);
        dest = clean(dest.split(/\s+až\b/i)[0]);
        let via = clean(rm[2]).toLowerCase().replace(/\s+vozovky$/i, "");
        if (!dest || !via) continue;
        if (dest.length > 40 || DIRECTION_ROUTING_OVERFLOW_RE.test(dest)) continue;
        if (!/^(?:[A-ZÁ-Ž]|Koh)/u.test(dest) && !/^[A-Za-zÁ-Žá-ž]/.test(dest)) continue;
        const key = dest.toLowerCase() + "|" + via;
        if (seenRoute.has(key)) continue;
        seenRoute.add(key);
        const bit = "Provoz směrem na " + dest + " je veden " + via;
        if (!bits.some((b) => situationDedupeKey(b) === situationDedupeKey(bit))) {
          bits.push(bit);
        }
      }
    }
  }

  if (
    /zachován\s+obousměrný\s+provoz|obousměrný\s+provoz\s+(?:zůstává\s+)?zachován/i.test(text) &&
    !/obousměrný/i.test(have + " " + bits.join(" "))
  ) {
    bits.push("Obousměrný provoz zůstává zachován");
  }

  // Concrete work activity — do not collapse to bare "Práce na silnici."
  if (/výsprava\s+tryskovou\s+metodou/i.test(text) && !/výsprava|tryskov/i.test(have)) {
    bits.push("Výsprava tryskovou metodou");
  }
  if (/\bsanace\b/i.test(text) && !/\bsanace\b/i.test(have)) {
    bits.push("Sanace");
  }
  if (/frézování/i.test(text) && !/frézován/i.test(have)) {
    bits.push("Frézování");
  }

  if (
    /\buzavřen[oaýá]?\s+pro\s+(?:těžká\s+)?nákladní(?:\s+vozidla)?/i.test(text) &&
    !/nákladní vozidla|těžká nákladní/i.test(have)
  ) {
    bits.push(
      /\btěžká\s+nákladní/i.test(text)
        ? "Uzavřeno pro těžká nákladní vozidla"
        : "Uzavřeno pro nákladní vozidla"
    );
  }

  const height =
    text.match(
      /\bneprůjezdn[áaý]\s+pro\s+vozidla\s+vyšší\s+než\s+(\d+(?:[.,]\d+)?)\s*m\b/i
    ) ||
    text.match(
      /\bsnížení\s+povolené\s+výšky[^.]{0,60}?(\d+(?:[.,]\d+)?)\s*m\b/i
    ) ||
    text.match(
      /\bomezení\s+výšky[^.]{0,60}?(\d+(?:[.,]\d+)?)\s*m\b/i
    );
  if (height && !/vyšší než|výšk/i.test(have)) {
    const h = String(height[1]).replace(".", ",");
    bits.push("Neprůjezdná pro vozidla vyšší než " + h + " m");
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
    if (/výsprava\s+tryskovou\s+metodou/i.test(source)) {
      causeBits.push("Výsprava tryskovou metodou");
    }
    // Concrete NDIC work phrases must beat the generic "Práce na silnici" fallback.
    if (/údržba\s+a\s+opravy\s+mostů/i.test(source) || facts.roadworkDetail === "BRIDGE_MAINTENANCE") {
      causeBits.push("Údržba a opravy mostů");
    } else if (/údržba\s+a\s+opravy\b/i.test(source) && !causeBits.length) {
      const detail = source.match(/údržba\s+a\s+opravy(?:\s+(?:mostů|vozovky|silnice))?/i);
      causeBits.push(detail ? clean(detail[0]).replace(/^./u, (c) => c.toUpperCase()) : "Údržba a opravy");
    }

    // Rich lead: closed roadworks with explicit work detail ("z důvodu …" or specific work phrase).
    // Never invent; only merge facts proven in source. Direction stays out of situation.
    const reasonDetail = clean(facts.eventReason);
    const specificWork = clean(facts.specificWork);
    const hasBareClosed =
      /(?:^|[,;]\s*)uzavřeno(?:\s*[,;.]|\s*$)/i.test(source) ||
      /úpln[áa]\s+uzavírk/i.test(source) ||
      scope === RESTRICTION_SCOPE.FULL_ROAD_CLOSED;
    const hasStavebni = /stavební práce/i.test(source);
    const reasonIsWorkDetail =
      !!(reasonDetail &&
        !/kulturní\s+akc/i.test(reasonDetail) &&
        !/\bsměr\b/i.test(reasonDetail) &&
        reasonDetail.length >= 6);
    const workDetail = reasonIsWorkDetail ? reasonDetail : specificWork;
    const formatWorkReason = (raw) => {
      const t = clean(raw);
      if (!t) return "";
      return t.charAt(0).toLocaleLowerCase("cs") + t.slice(1);
    };
    let roadworksReasonMerged = false;
    if (hasBareClosed && hasStavebni && workDetail && !causeBits.length) {
      const noun =
        /\bmístní\s+komunikace\b|\bkomunikace\b/i.test(source) && !/\bsilnice\s+[ID]/i.test(source)
          ? "Komunikace"
          : /\bsilnice\b|\bdálnice\b/i.test(source)
            ? "Silnice"
            : "Komunikace";
      if (reasonIsWorkDetail) {
        causeBits.push(
          noun + " uzavřena z důvodu stavebních prací – " + reasonDetail
        );
      } else {
        causeBits.push(
          "Stavební práce. " +
            noun +
            " je uzavřena z důvodu " +
            formatWorkReason(workDetail)
        );
      }
      roadworksReasonMerged = true;
    } else if (hasStavebni && reasonIsWorkDetail && !causeBits.length) {
      // Open roadworks with explicit reason — never invent closure wording.
      causeBits.push("Stavební práce z důvodu " + formatWorkReason(reasonDetail));
      roadworksReasonMerged = true;
    } else if (hasStavebni && specificWork && !causeBits.length) {
      causeBits.push(
        "Stavební práce – " + formatWorkReason(specificWork)
      );
    } else if (specificWork && !causeBits.length && !hasStavebni) {
      const sw = clean(specificWork);
      causeBits.push(sw.charAt(0).toLocaleUpperCase("cs") + sw.slice(1));
    } else if (hasStavebni && !causeBits.length) {
      causeBits.push("Stavební práce");
    }
    if (
      /práce na silnici/i.test(source) &&
      !causeBits.some((b) => /práce na silnici|stavební|údržba|výsprava|sekání|inženýrských|uzavřena z důvodu/i.test(b))
    ) {
      causeBits.unshift("Práce na silnici");
    }
    if (!causeBits.length) causeBits.push("Práce na silnici");
    // Stash merge flag on facts-like local for later circumstance skip.
    facts._roadworksReasonMerged = roadworksReasonMerged;

    // Profile location of works (not a full-road closure claim).
    if (
      (facts.affectedRoadPart === "HARD_SHOULDER" ||
        /rozsah\s*:\s*zpevněn[áa]\s+krajnice/i.test(source)) &&
      !causeBits.some((b) => /zpevněn/i.test(b)) &&
      !scopeBits.some((b) => /zpevněn|krajnice/i.test(b))
    ) {
      circumstanceBits.push("Práce probíhají na zpevněné krajnici");
    }

    // Explicit remaining passable lanes — never invent original lane count.
    {
      const openN =
        facts.openLaneCount != null && Number.isFinite(facts.openLaneCount)
          ? Number(facts.openLaneCount)
          : (() => {
              const m = source.match(/počet\s+průjezdných\s+pruhů\s*:\s*(\d{1,2})\b/i);
              return m ? Number(m[1]) : null;
            })();
      if (openN != null && Number.isFinite(openN) && openN >= 0) {
        const laneBit =
          openN === 1
            ? "Průjezdný je 1 jízdní pruh"
            : openN >= 2 && openN <= 4
              ? "Průjezdné jsou " + openN + " jízdní pruhy"
              : "Průjezdných je " + openN + " jízdních pruhů";
        if (
          !causeBits.some((b) => /průjezdn/i.test(b)) &&
          !circumstanceBits.some((b) => /průjezdn/i.test(b))
        ) {
          circumstanceBits.push(laneBit);
        }
      }
    }
  } else if (/částečn[áa]\s+uzavírk/i.test(source)) {
    const road = resolvePresentationRoadNumber(input, facts);
    const street = resolveConfirmedStreet(input, facts) || facts.street;
    if (street && !road) {
      causeBits.push("Částečná uzavírka ulice " + street.replace(/^ulice\s+/i, ""));
    } else if (road) causeBits.push("Částečná uzavírka silnice " + road);
    else causeBits.push("Částečná uzavírka");
  } else if (event.kind === EVENT_KIND.CLOSURE || cause === PRIMARY_CAUSE.FULL_CLOSURE) {
    const closureObjEarly = /úpln[áa]\s+uzavírk/i.test(source)
      ? extractFullClosureObjectPhrase(source)
      : null;
    if (closureObjEarly) {
      causeBits.push("Úplná uzavírka " + closureObjEarly);
    } else if (
      /(?:^|[,;.\s])tunel(?:y)?\s+(?:je\s+|jsou\s+)?uzavřen/i.test(source) ||
      /uzavřen[ýáo]?\s+tunel(?:y)?(?:[,;.\s]|$)/i.test(source)
    ) {
      causeBits.push("Tunel je uzavřen");
    } else if (
      /\bmost\s+uzavřen\b/i.test(source) ||
      /\buzavřen[ýáo]?\s+most\b/i.test(source) ||
      /\búplná\s+uzavírka\s+mostu\b(?!\s+[A-ZÁ-Ž])/i.test(source)
    ) {
      causeBits.push("Most je uzavřen");
    } else if (/úpln[áa]\s+uzavírk/i.test(source)) {
      if (
        facts.namedObjectKind === LOCATION_KIND.RAILWAY_CROSSING &&
        facts.namedObject
      ) {
        const id =
          clean(facts.objectIdentifier) ||
          ((facts.namedObject.match(/\b([A-Z]\d{2,6}|\d{2,6})\b/i) || [])[1] || "");
        causeBits.push(
          "Úplná uzavírka železničního přejezdu" + (id ? " " + id.toUpperCase() : "")
        );
      } else {
        const roads =
          Array.isArray(facts.roadNumbers) && facts.roadNumbers.length
            ? facts.roadNumbers
            : [resolvePresentationRoadNumber(input, facts)].filter(Boolean);
        const streets =
          Array.isArray(facts.streets) && facts.streets.length
            ? facts.streets
            : (() => {
                const one = resolveConfirmedStreet(input, facts) || facts.street;
                return one && !/\s\/\s/.test(one) ? [one] : [];
              })();
        const muni =
          resolveMunicipalitySignName(input) ||
          clean(facts.city) ||
          "";
        let lead = "Úplná uzavírka komunikace";
        if (roads.length >= 2 && streets.length >= 2) {
          const primaryStreets = streets.slice(0, Math.max(1, streets.length - 1));
          const lastStreet = streets[streets.length - 1];
          lead =
            "Úplná uzavírka silnice " +
            roads[0] +
            " v ulicích " +
            formatStreetDisplayList(primaryStreets) +
            " a silnice " +
            roads[1] +
            " v ulici " +
            lastStreet;
          if (roads.length > 2) {
            lead += " a silnice " + roads.slice(2).join(" a ");
          }
        } else if (roads.length === 1 && streets.length >= 2) {
          lead =
            "Úplná uzavírka silnice " +
            roads[0] +
            " v ulicích " +
            formatStreetDisplayList(streets);
        } else if (roads.length === 1 && streets.length === 1) {
          lead = "Úplná uzavírka silnice " + roads[0] + " v ulici " + streets[0];
        } else if (roads.length >= 1) {
          lead =
            "Úplná uzavírka silnice " +
            (roads.length === 1
              ? roads[0]
              : roads.slice(0, -1).join(", ") + " a " + roads[roads.length - 1]);
        } else if (streets.length >= 1) {
          lead =
            streets.length === 1
              ? "Úplná uzavírka ulice " + streets[0]
              : "Úplná uzavírka ulic " + formatStreetDisplayList(streets);
        }
        if (
          muni &&
          !/^Úplná uzavírka komunikace$/i.test(lead) &&
          !lead.toLowerCase().includes(muni.toLowerCase())
        ) {
          lead += " v obci " + muni;
        }
        causeBits.push(lead);
      }
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
    const turnLane = /odbočovací\s+pruh/i.test(source);
    const lane =
      source.match(/((?:levý|pravý|střední|západní|východní|severní|jižní)\s+jízdní\s+pruh)/i) ||
      source.match(/neprůjezdn[ýáé]\s+((?:levý|pravý|střední|západní|východní|severní|jižní)\s+jízdní\s+pruh)/i) ||
      source.match(/zúžen[ýáé]\s+((?:levý|pravý|střední|západní|východní|severní|jižní)\s+jízdní\s+pruh)/i);
    const dir = normalizeDirectionHuman(facts.directionHuman || clean(input.direction) || "");
    const turnSide = /(?:pro\s+)?směr\s+vlevo|\bvlevo\b/i.test(source)
      ? "vlevo"
      : /(?:pro\s+)?směr\s+vpravo|\bvpravo\b/i.test(source)
        ? "vpravo"
        : null;
    const crossStreet = (
      source.match(
        /před\s+křižovatkou\s+s\s+(?:ul\.?\s*|ulicí\s+)([^,;()]{2,60}?)(?=\s+ve\s+směru|\s+v\s+souvislosti|\s+za\s+účelem|\s+z\s+důvodu|\s+v\s+rámci|\s*,|\s*$)/i
      ) ||
      source.match(
        /křižovatk(?:ou|a)\s+s\s+(?:ul\.?\s*|ulicí\s+)([^,;()]{2,60}?)(?=\s+ve\s+směru|\s+v\s+souvislosti|\s+za\s+účelem|\s+z\s+důvodu|\s+v\s+rámci|\s*,|\s*$)/i
      )
    );
    const narrowed = /zúžen[ýáé]\s+(?:levý|pravý|střední|jeden)\s+jízdní\s+pruh/i.test(source);
    if (turnLane) {
      let turn = "Odbočovací pruh";
      if (turnSide) turn += " " + turnSide;
      if (crossStreet) {
        const sn = sanitizeExtractedValueToken(streetBareName(crossStreet[1]));
        if (sn) turn += " před křižovatkou s ulicí " + sn;
      }
      turn += " je uzavřen";
      scopeBits.push(turn);
    } else if (lane && /neprůjezdn/i.test(source)) {
      scopeBits.push(capitalizeLanePhrase(lane[1]) + " je neprůjezdný");
    } else if (lane && narrowed) {
      scopeBits.push(capitalizeLanePhrase(lane[1]) + " je zúžený");
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
      if (
        /\bmost\s+uzavřen\b/i.test(source) ||
        /\buzavřen[ýáo]?\s+most\b/i.test(source)
      ) {
        scopeBits.push("Most je uzavřen");
      } else if (
        /\bmístní\s+komunikace\b|\bkomunikace\b/i.test(source) &&
        !/\bsilnice\s+[ID]/i.test(source)
      ) {
        scopeBits.push("Komunikace je uzavřena");
      } else {
        scopeBits.push("Silnice je uzavřena");
      }
    }
  } else if (
    // Typed/classified closure with bare "uzavřeno" and unknown scope — keep road closed
    // phrasing already in causeBits; do not invent lane/shoulder closure.
    (event.kind === EVENT_KIND.CLOSURE || cause === PRIMARY_CAUSE.FULL_CLOSURE) &&
    /\buzavřeno\b/i.test(source) &&
    !causeBits.some((b) => /uzavřen/i.test(b))
  ) {
    if (
      /\bmost\s+uzavřen\b/i.test(source) ||
      /\buzavřen[ýáo]?\s+most\b/i.test(source)
    ) {
      scopeBits.push("Most je uzavřen");
    } else {
      scopeBits.push("Silnice je uzavřena");
    }
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

  // Explicit delay must not disappear when care/heavy wins the primary condition slot.
  if (
    /(?:^|[,;]\s*)zdržení(?:[,;.]|$)/i.test(source) &&
    !conditionBits.some((b) => /zdržení/i.test(b))
  ) {
    conditionBits.push("Zdržení");
  }

  // Extra trusted phrases not yet covered (roadworks transfer etc.).
  if (/provoz převeden do protisměru/i.test(source)) {
    scopeBits.push("Provoz převeden do protisměru");
  }

  // Partial closure lead when not already captured by cause (typed restriction).
  // Keep even when a named lane is already in scopeBits — complementary facts.
  if (
    /částečn[áa]\s+uzavírk/i.test(source) &&
    !causeBits.some((b) => /částečn/i.test(b))
  ) {
    const road = resolvePresentationRoadNumber(input, facts);
    const street = resolveConfirmedStreet(input, facts) || facts.street;
    if (street && !road) {
      causeBits.unshift("Částečná uzavírka ulice " + street.replace(/^ulice\s+/i, ""));
    } else {
      causeBits.unshift(road ? "Částečná uzavírka silnice " + road : "Částečná uzavírka");
    }
  }

  // Turning-lane closure when scope analyzer missed it (e.g. mixed partial-closure wording).
  if (
    /odbočovací\s+pruh/i.test(source) &&
    /(?:uzavřen|vyblokován)/i.test(source) &&
    !scopeBits.some((b) => /odbočovací/i.test(b))
  ) {
    const turnSide = /(?:pro\s+)?směr\s+vlevo|\bvlevo\b/i.test(source)
      ? "vlevo"
      : /(?:pro\s+)?směr\s+vpravo|\bvpravo\b/i.test(source)
        ? "vpravo"
        : null;
    const crossStreet =
      source.match(
        /před\s+křižovatkou\s+s\s+(?:ul\.?\s*|ulicí\s+)([^,;()]{2,60}?)(?=\s+ve\s+směru|\s+v\s+souvislosti|\s+za\s+účelem|\s+z\s+důvodu|\s+v\s+rámci|\s*,|\s*$)/i
      ) ||
      source.match(
        /křižovatk(?:ou|a)\s+s\s+(?:ul\.?\s*|ulicí\s+)([^,;()]{2,60}?)(?=\s+ve\s+směru|\s+v\s+souvislosti|\s+za\s+účelem|\s+z\s+důvodu|\s+v\s+rámci|\s*,|\s*$)/i
      );
    let turn = "Odbočovací pruh";
    if (turnSide) turn += " " + turnSide;
    if (crossStreet) {
      const sn = sanitizeExtractedValueToken(streetBareName(crossStreet[1]));
      if (sn) turn += " před křižovatkou s ulicí " + sn;
    }
    turn += " je uzavřen";
    scopeBits.push(turn);
  }
  if (
    /stavebn(?:í|ích)\s+prac/i.test(source) &&
    !causeBits.some((b) => /stavební|práce na silnici/i.test(b)) &&
    !circumstanceBits.some((b) => /stavební/i.test(b))
  ) {
    circumstanceBits.push("Stavební práce");
  }

  // Obstacle / wildlife / fire / people as secondary impact (not dropped when cause=accident).
  const secondaryImpact = extractSecondaryImpactBits(source, cause, causeBits);
  for (const bit of secondaryImpact) {
    if (!scopeBits.some((b) => situationDedupeKey(b) === situationDedupeKey(bit))) {
      scopeBits.push(bit);
    }
  }

  // Shuttle / narrowing / truck-only / height — keep beside generic roadworks leads.
  const operational = extractOperationalImpactBits(source, causeBits, scopeBits);
  for (const bit of operational) {
    if (!scopeBits.some((b) => situationDedupeKey(b) === situationDedupeKey(bit))) {
      scopeBits.push(bit);
    }
  }

  // Explicit "z důvodu …" + quoted event/action name — never drop when present in RAW.
  {
    const reasonText = clean(facts.eventReason);
    const eventName = clean(facts.eventName);
    if (reasonText || eventName) {
      let reasonBit = null;
      if (facts._roadworksReasonMerged) {
        // Already folded into the roadworks lead — do not duplicate.
        reasonBit = null;
      } else if (facts.reasonKind === "CULTURAL_EVENT") {
        reasonBit = eventName
          ? 'Uzavírka je z důvodu konání kulturní akce „' + eventName + "“"
          : "Uzavírka je z důvodu konání kulturní akce";
      } else if (reasonText) {
        const closedNow =
          scope === RESTRICTION_SCOPE.FULL_ROAD_CLOSED ||
          scope === RESTRICTION_SCOPE.DIRECTION_CLOSED ||
          scope === RESTRICTION_SCOPE.ALL_LANES_CLOSED ||
          /(?:^|[,;]\s*)uzavřeno(?:\s*[,;.]|\s*$)/i.test(source) ||
          /úpln[áa]\s+uzavírk/i.test(source);
        const lead = closedNow
          ? "Uzavírka je z důvodu "
          : cause === PRIMARY_CAUSE.ROADWORKS || event.kind === EVENT_KIND.ROADWORKS
            ? "Stavební práce z důvodu "
            : "Omezení je z důvodu ";
        reasonBit = lead + reasonText.replace(/^konání\s+/i, "konání ");
        if (eventName && !reasonBit.includes(eventName)) {
          reasonBit += ' „' + eventName + "“";
        }
      } else if (eventName) {
        reasonBit = "Událost: „" + eventName + "“";
      }
      if (
        reasonBit &&
        !causeBits.some((b) => /z důvodu|kulturní akc/i.test(b)) &&
        !circumstanceBits.some((b) => /z důvodu|kulturní akc/i.test(b))
      ) {
        circumstanceBits.push(reasonBit);
      }
    }
  }
  if (facts.localityDetail && /domů|č\./i.test(facts.localityDetail)) {
    const locBit = "Týká se úseku " + facts.localityDetail;
    if (
      !causeBits.some((b) => situationDedupeKey(b) === situationDedupeKey(locBit)) &&
      !circumstanceBits.some((b) => /domů|č\./i.test(b))
    ) {
      circumstanceBits.push(locBit);
    }
  }

  // Order: main fact → traffic impact/scope → circumstance → condition.
  const ordered = [...causeBits, ...scopeBits, ...circumstanceBits, ...conditionBits];
  if (ordered.length) return finalizeSentences(ordered);

  if (facts.situationPhrases.length) return finalizeSentences(facts.situationPhrases.slice(0, 3));
  if (!source || EMPTY_IMPACT_RE.test(source)) return "Dopravní omezení.";
  // Split on sentence ends — never on abbreviation dots (ul. / okr. / č. / ev.č.).
  const clauses = source
    .replace(/\b(ul|okr|č|ev\.?\s*č|tzv|např|m|km)\./gi, "$1\u2024")
    .split(/[.;]/)
    .map((x) => clean(x.replace(/\u2024/g, ".")))
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
  if (clauses.length) {
    const cleaned = clauses.filter(
      (x) =>
        !/^ulice\b/i.test(x) &&
        !/^zdroj:/i.test(x) &&
        !isPrahaCityPartName(x) &&
        !/^praha$/i.test(x)
    );
    if (cleaned.length) return finalizeSentences(cleaned);
  }
  return "Dopravní omezení.";
}

function samePlaceName(a, b) {
  const x = clean(a).toLowerCase();
  const y = clean(b).toLowerCase();
  return !!(x && y && x === y);
}

/**
 * Resolve municipality vs city-part misfiles (Praha 7 / Plzeň 4 ≠ obec).
 */
function resolveMunicipalityCandidate(structuredRaw, fromCommentRaw, blob, cityPartHint, relationHint) {
  let structured = normalizeExtractedMunicipalityName(structuredRaw) || "";
  let fromComment = normalizeExtractedMunicipalityName(fromCommentRaw) || clean(fromCommentRaw);
  // Prefer normalized comment municipality when structured still looks truncated.
  if (looksLikeTruncatedFragment(clean(structuredRaw))) structured = "";
  if (looksLikeTruncatedFragment(fromComment)) fromComment = "";
  const blobText = clean(blob);
  const cityPart = clean(cityPartHint);
  const relation = clean(relationHint);

  const demoteCityPartToken = (token) => {
    const split = splitMunicipalityAndCityPart(token);
    if (!split) return token;
    if (isPrahaCityPartName(token)) {
      return /\bPraha\b/u.test(blobText) || fromComment === "Praha" || cityPart ? "Praha" : "";
    }
    return split.municipality;
  };

  if (isPrahaCityPartName(fromComment) || isNumericCityPartName(fromComment)) {
    fromComment = demoteCityPartToken(fromComment);
  }
  if (isPrahaCityPartName(structured) || isNumericCityPartName(structured)) {
    structured = demoteCityPartToken(structured);
  }
  // Explicit "u obce X" always wins over TMC segment labels misfiled as municipality.
  if (relation === "u_obce" && fromComment && !looksLikeSegmentOrAreaLabel(fromComment)) {
    return fromComment;
  }
  if (looksLikeSegmentOrAreaLabel(structured)) structured = "";
  let city = preferFullerMunicipalityName(structured, fromComment) || "";
  if (isPrahaCityPartName(city) || isNumericCityPartName(city)) {
    city = demoteCityPartToken(city) || "";
  }
  if (looksLikeSegmentOrAreaLabel(city)) {
    city = fromComment && !looksLikeSegmentOrAreaLabel(fromComment) ? fromComment : "";
  }
  city = normalizeExtractedMunicipalityName(city) || "";
  if (looksLikeTruncatedFragment(city)) return null;
  return city || null;
}

/**
 * Urban tunnel registry enrichment — never overrides a conflicting official municipality.
 * @returns {{
 *  entry: object,
 *  municipality: string|null,
 *  displayName: string|null,
 *  conflict: boolean,
 *  usedRegistryMunicipality: boolean,
 * }|null}
 */
export function resolveTunnelRegistryEnrichment(input = {}, factsIn = null) {
  const facts = factsIn || parseOfficialCommentFacts(sourceBlob(input));
  const named =
    (facts.namedObject && facts.namedObjectKind === LOCATION_KIND.TUNNEL
      ? facts.namedObject
      : null) ||
    (classifyLocationKindFromName(input.location) === LOCATION_KIND.TUNNEL
      ? streetBareName(input.location)
      : null);
  const entry = matchTunnelRegistry({
    ...input,
    namedObject: named || facts.namedObject || null,
    tunnelName: named || null,
    location: input.location,
    impact: input.impact,
    impactFull: input.impactFull,
    summary: input.summary,
    summaryFull: input.summaryFull,
  });
  if (!entry || entry.urban !== true) return null;

  const officialRaw =
    resolveMunicipalityCandidate(
      input.municipality,
      facts.city,
      sourceBlob(input),
      facts.cityPart || input.cityPart,
      facts.municipalityRelation
    ) || "";
  const official = clean(officialRaw);
  const registryMuni = clean(entry.municipality);
  let conflict = false;
  let municipality = null;
  let usedRegistryMunicipality = false;
  if (official && registryMuni && !samePlaceName(official, registryMuni)) {
    conflict = true;
    municipality = official; // official structured/comment wins; never silent overwrite
  } else if (official) {
    municipality = official;
  } else if (registryMuni) {
    municipality = registryMuni;
    usedRegistryMunicipality = true;
  }
  const displayName = resolveTunnelDisplayName(entry, named || facts.namedObject || input.location);
  return {
    entry,
    municipality,
    displayName,
    conflict,
    usedRegistryMunicipality,
  };
}

function normalizeRoadNumberKey(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^DÁLNICE/, "D");
}

/**
 * Provenance for outside-city tunnel road badge.
 * Live NDIC/event road wins over registry; never invent when both empty; conflict → event.
 * @param {string|null|undefined} eventRoad
 * @param {string|null|undefined} registryRoad
 * @returns {{ road: string|null, conflict: boolean, usedRegistryRoad: boolean }}
 */
export function resolveOutsideCityTunnelRoad(eventRoad, registryRoad) {
  const ev = clean(eventRoad);
  const reg = clean(registryRoad);
  if (ev && reg && normalizeRoadNumberKey(ev) !== normalizeRoadNumberKey(reg)) {
    return { road: ev, conflict: true, usedRegistryRoad: false };
  }
  if (ev) return { road: ev, conflict: false, usedRegistryRoad: false };
  if (reg) return { road: reg, conflict: false, usedRegistryRoad: true };
  return { road: null, conflict: false, usedRegistryRoad: false };
}

/**
 * Outside-city tunnel enrichment for header: icon + name + optional road.
 * Urban registry match always wins (city mode preserved). Fail-closed on ambiguity.
 * Never overrides dynamic NDIC situation / validity / lane facts.
 *
 * @returns {{
 *  entry: object,
 *  displayName: string,
 *  tunnelObjectIcon: string,
 *  road: string|null,
 *  roadConflict: boolean,
 *  usedRegistryRoad: boolean,
 *  outsideCityTunnelMode: true,
 * }|null}
 */
export function resolveOutsideCityTunnelEnrichment(input = {}, factsIn = null) {
  const facts = factsIn || parseOfficialCommentFacts(sourceBlob(input));
  const named =
    (facts.namedObject && facts.namedObjectKind === LOCATION_KIND.TUNNEL
      ? facts.namedObject
      : null) ||
    (classifyLocationKindFromName(input.location) === LOCATION_KIND.TUNNEL
      ? streetBareName(input.location)
      : null);

  // City / urban tunnel layer has absolute precedence.
  const urban = matchTunnelRegistry({
    ...input,
    namedObject: named || facts.namedObject || null,
    tunnelName: named || null,
    location: input.location,
    impact: input.impact,
    impactFull: input.impactFull,
    summary: input.summary,
    summaryFull: input.summaryFull,
  });
  if (urban && urban.urban === true) return null;

  const entry = matchOutsideCityTunnelRegistry({
    ...input,
    namedObject: named || facts.namedObject || null,
    tunnelName: named || null,
    location: input.location,
    impact: input.impact,
    impactFull: input.impactFull,
    summary: input.summary,
    summaryFull: input.summaryFull,
  });
  if (!entry || entry.urban !== false) return null;

  const eventRoad = resolvePresentationRoadNumber(input, facts);
  const picked = resolveOutsideCityTunnelRoad(eventRoad, entry.roadNumber);
  const displayName = resolveTunnelDisplayName(
    entry,
    named || facts.namedObject || input.location
  );
  return {
    entry,
    displayName,
    tunnelObjectIcon: TRAFFIC_SIGN_ASSET.TUNNEL_OBJECT,
    road: picked.road,
    roadConflict: picked.conflict,
    usedRegistryRoad: picked.usedRegistryRoad,
    outsideCityTunnelMode: true,
  };
}

/**
 * Municipality/city name for the Czech entrance-style signboard.
 * Never invents Praha/Jižní spojka; never treats street or city-part as municipality.
 * Parking / urban tunnels: after live NDIC fields, may enrich from verified registries only.
 */
export function resolveMunicipalitySignName(input = {}) {
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const blob = sourceBlob(input);
  const parkingCity = clean(facts.parkingCity);
  const street = streetBareName(facts.street || input.streetHint || input.street);
  let cityPart = clean(facts.cityPart || input.cityPart);
  if (!cityPart && isPrahaCityPartName(input.municipality)) {
    cityPart = clean(input.municipality);
  }
  if (!cityPart && isNumericCityPartName(input.municipality)) {
    cityPart = clean(input.municipality);
  }

  let city =
    resolveMunicipalityCandidate(
      input.municipality,
      facts.city,
      blob,
      cityPart,
      facts.municipalityRelation
    ) ||
    parkingCity ||
    "";
  if (!city) {
    const reg = matchParkingRegistry({
      ...input,
      parkingName: facts.parkingName || input.parkingName,
    });
    if (reg && reg.municipality) city = clean(reg.municipality);
  }
  if (!city) {
    const tun = resolveTunnelRegistryEnrichment(input, facts);
    // Only enrich when no official municipality and no conflict path.
    if (tun && tun.usedRegistryMunicipality && tun.municipality && !tun.conflict) {
      city = clean(tun.municipality);
    }
  }
  if (!city) return null;
  if (/^p\s*\+\s*r\b/i.test(city)) return null;
  if (/\b(ulice|okres|okr\.)\b/i.test(city)) return null;
  if (looksLikeRoadNumberToken(city)) return null;
  if (isPrahaCityPartName(city)) return null;
  if (isNumericCityPartName(city)) return null;
  if (looksLikeSegmentOrAreaLabel(city)) return null;
  if (!clean(input.municipality) && looksLikeNonMunicipalityPlace(city)) return null;
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
  let road = resolvePresentationRoadNumber(input, facts);
  let municipalitySign = resolveMunicipalitySignName(input);
  const street = resolveConfirmedStreet(input, facts);
  const location = clean(input.location);
  const district = clean(input.district) || facts.district || "";
  let cityPart = clean(facts.cityPart || input.cityPart);
  if (!cityPart && isPrahaCityPartName(input.municipality)) {
    cityPart = clean(input.municipality);
  }
  if (!cityPart && isNumericCityPartName(input.municipality)) {
    cityPart = clean(input.municipality);
  }
  let namedObject = facts.namedObject ? streetBareName(facts.namedObject) : null;
  let namedObjectKind = facts.namedObjectKind || null;
  const tunnelEnrich = resolveTunnelRegistryEnrichment(input, facts);
  if (tunnelEnrich && tunnelEnrich.displayName) {
    namedObject = tunnelEnrich.displayName;
    namedObjectKind = LOCATION_KIND.TUNNEL;
  }
  const outsideTunnel = resolveOutsideCityTunnelEnrichment(input, facts);
  if (outsideTunnel && outsideTunnel.displayName) {
    namedObject = outsideTunnel.displayName;
    namedObjectKind = LOCATION_KIND.TUNNEL;
    // Outside-city mode: never force a white municipality entrance sign.
    municipalitySign = null;
    if (!road && outsideTunnel.road) road = outsideTunnel.road;
    else if (outsideTunnel.road && !outsideTunnel.roadConflict) {
      // Keep event road; registry only fills gaps (already applied above).
    }
  }
  const nearMunicipality =
    facts.municipalityRelation === "u_obce" && !!municipalitySign;
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
  } else if (nearMunicipality) {
    // road + "u obce" + white municipality sign — TMC/locality must not override header.
    locationKind = LOCATION_KIND.MUNICIPALITY;
  } else if (outsideTunnel && outsideTunnel.displayName) {
    // Outside-city: [tunnel icon] + name + [road badge] — icon rendered in UI layer.
    besideLocality = outsideTunnel.displayName;
    locationKind = LOCATION_KIND.TUNNEL;
  } else if (
    namedObject &&
    !resolveRoadDisplayName(road) &&
    !(
      street &&
      (namedObjectKind === LOCATION_KIND.RAILWAY_CROSSING ||
        namedObjectKind === LOCATION_KIND.RAMP ||
        namedObjectKind === LOCATION_KIND.EXIT_RAMP ||
        namedObjectKind === LOCATION_KIND.REST_AREA)
    )
  ) {
    // Named tunnel/bridge/square beats generic locationLabel (e.g. Letná).
    // Urban tunnels: [MĚSTO] + tunnel name (municipalitySign from NDIC or tunnel registry).
    // Road aliases (D0 → Pražský okruh) keep the communication display name instead.
    // Railway crossing / ramp / exit / rest-area are situation objects — keep confirmed street.
    besideLocality = namedObject;
    locationKind = namedObjectKind || classifyLocationKindFromName(namedObject);
  } else if (street) {
    streetLabel = "ulice: " + street.replace(/^ulice\s+/i, "");
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

  const cityPartRow =
    !outsideTunnel && cityPart && !samePlaceName(cityPart, municipalitySign)
      ? "městská část: " + cityPart
      : null;

  return {
    municipalitySign,
    municipalitySignLabel: municipalitySign ? municipalitySign.toUpperCase() : null,
    municipalityRelation: facts.municipalityRelation || null,
    nearMunicipalityPrefix:
      !outsideTunnel && facts.municipalityRelation === "u_obce" ? "u obce" : null,
    besideLocality: besideLocality || null,
    streetLabel: streetLabel || null,
    districtBeside: districtBeside || null,
    street: street || null,
    streetMulti,
    namedObject: namedObject || null,
    namedObjectKind: namedObjectKind || null,
    locationKind,
    cityPart: outsideTunnel ? null : cityPart || null,
    cityPartRow,
    district: district || null,
    parkingName,
    parkingStatusLabel,
    parkingFullyOccupied: liveStatus.kind === "full",
    parkingOccupancyPercent:
      facts.parkingOccupancyPercent != null ? facts.parkingOccupancyPercent : null,
    parkingRegistryId: registry ? registry.parkingId : null,
    parkingRegistryMatch: !!registry,
    outsideCityTunnelMode: !!(outsideTunnel && outsideTunnel.outsideCityTunnelMode),
    tunnelObjectIcon: outsideTunnel ? outsideTunnel.tunnelObjectIcon : null,
    tunnelObjectIconAlt: outsideTunnel ? "Tunel" : null,
    outsideCityTunnelRoad: outsideTunnel ? outsideTunnel.road || null : null,
    outsideCityTunnelRoadConflict: !!(outsideTunnel && outsideTunnel.roadConflict),
    outsideCityTunnelUsedRegistryRoad: !!(outsideTunnel && outsideTunnel.usedRegistryRoad),
  };
}

/**
 * Head locality next to road badge (human) — legacy string for tests/compat.
 * Prefer buildLocalityHeaderModel for UI (municipality sign + beside).
 */
export function buildHeadLocalityLabel(input = {}) {
  const hdr = buildLocalityHeaderModel(input);
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const road = resolvePresentationRoadNumber(input, facts);
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

/**
 * Resolve collapsed-card kilometrage label from structured fields + official comment.
 * Never invents km. Prefers full range when both ends are known.
 *
 * @returns {{
 *  kind: "SINGLE_KM"|"KM_RANGE",
 *  label: string,
 *  from: string,
 *  to: string|null,
 *  source: "structured_range"|"structured_single"|"comment",
 * }|null}
 */
export function resolveCollapsedKilometerLabel(input = {}, factsIn = null) {
  const facts = factsIn || parseOfficialCommentFacts(sourceBlob(input));
  const fromStruct =
    input.kilometerFrom != null
      ? formatKmToken(input.kilometerFrom)
      : input.kmFrom != null
        ? formatKmToken(input.kmFrom)
        : null;
  const toStruct =
    input.kilometerTo != null
      ? formatKmToken(input.kilometerTo)
      : input.kmTo != null
        ? formatKmToken(input.kmTo)
        : null;
  if (fromStruct && toStruct) {
    return {
      kind: "KM_RANGE",
      label: "km " + fromStruct + "–" + toStruct,
      from: fromStruct,
      to: toStruct,
      source: "structured_range",
    };
  }
  if (input.kilometer != null && clean(String(input.kilometer)) !== "") {
    const one = formatKmToken(input.kilometer);
    return {
      kind: "SINGLE_KM",
      label: "km " + one,
      from: one,
      to: null,
      source: "structured_single",
    };
  }
  if (facts.kilometerFrom && facts.kilometerTo) {
    return {
      kind: "KM_RANGE",
      label:
        facts.kilometerLabel ||
        "km " + facts.kilometerFrom + "–" + facts.kilometerTo,
      from: facts.kilometerFrom,
      to: facts.kilometerTo,
      source: "comment",
    };
  }
  if (facts.kilometerLabel) {
    const range = String(facts.kilometerLabel).match(
      /^km\s+(-?[\d,]+)(?:–|-)(-?[\d,]+)$/i
    );
    if (range) {
      return {
        kind: "KM_RANGE",
        label: "km " + range[1] + "–" + range[2],
        from: range[1],
        to: range[2],
        source: "comment",
      };
    }
    const one = String(facts.kilometerLabel).match(/^km\s+(-?[\d,]+)$/i);
    return {
      kind: "SINGLE_KM",
      label: facts.kilometerLabel,
      from: one ? one[1] : facts.kilometerFrom || null,
      to: null,
      source: "comment",
    };
  }
  return null;
}

function pushUniqueBit(bits, value) {
  const v = clean(value);
  if (!v) return;
  if (bits.some((b) => String(b).toLowerCase() === v.toLowerCase())) return;
  bits.push(v);
}

export function buildPlaceAndDirectionLine(input = {}) {
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const bits = [];
  const road = resolvePresentationRoadNumber(input, facts);
  const dir =
    normalizeDirectionHuman(clean(input.direction) || facts.directionHuman || "") || "";
  const kmResolved = resolveCollapsedKilometerLabel(input, facts);
  const km = kmResolved ? kmResolved.label : "";
  const section = clean(input.section);
  const muni =
    resolveMunicipalitySignName(input) ||
    resolveMunicipalityCandidate(
      input.municipality,
      facts.city,
      sourceBlob(input),
      facts.cityPart || input.cityPart,
      facts.municipalityRelation
    ) ||
    "";
  const district = clean(input.district) || facts.district || "";
  const street = resolveConfirmedStreet(input, facts);
  const location = clean(input.location);
  let cityPart = clean(facts.cityPart || input.cityPart);
  if (!cityPart && isPrahaCityPartName(input.municipality)) cityPart = clean(input.municipality);
  if (!cityPart && isNumericCityPartName(input.municipality)) cityPart = clean(input.municipality);

  if (facts.parkingName) {
    const bits = [facts.parkingName];
    if (muni) bits.push(muni);
    else if (location && !/^p\+r/i.test(location)) bits.push(location);
    return bits.join(" · ");
  }

  // Numbered road + known km/dir must never be dropped by named-object / street branches.
  if (road) {
    bits.push(road);
    {
      const roadDisplayName = resolveRoadDisplayName(road);
      if (roadDisplayName) bits.push(roadDisplayName);
    }
    if (facts.municipalityRelation === "u_obce") {
      const nearCity =
        preferFullerMunicipalityName(muni, facts.city) || facts.city || muni || "";
      if (nearCity) bits.push("u obce " + nearCity);
    }
    if (km) bits.push(km);
    else if (section) bits.push(section);
    if (street) {
      bits.push("ulice " + street.replace(/^ulice\s+/i, ""));
    }
    if (facts.municipalityRelation !== "u_obce") {
      if (muni && !bits.includes(muni)) bits.push(muni);
      else if (
        location &&
        location !== road &&
        !looksLikeRoadNumberToken(location) &&
        !bits.includes(location) &&
        !(facts.namedObject && samePlaceName(location, facts.namedObject))
      ) {
        // Keep named bridge/tunnel out of place line when road+km already localize the event.
        if (!(km && facts.namedObject)) bits.push(location);
      }
    }
    if (dir) bits.push("směr " + dir);
    if (district) {
      const distLabel = "okres " + district;
      if (!bits.some((b) => String(b).includes(district))) bits.push(distLabel);
    }
    return bits.join(" · ");
  }

  if (facts.namedObject) {
    const placeBits = [streetBareName(facts.namedObject)];
    if (km) pushUniqueBit(placeBits, km);
    if (dir) pushUniqueBit(placeBits, "směr " + dir);
    if (cityPart) placeBits.push(cityPart);
    else if (muni) placeBits.push(muni);
    return placeBits.join(" · ");
  }

  if (street && (muni || cityPart)) {
    const streetDisp = street.replace(/^ulice\s+/i, "");
    const placeBits =
      facts.streetRange === true && facts.streetFrom && facts.streetTo
        ? [streetDisp]
        : ["ulice " + streetDisp];
    if (km) pushUniqueBit(placeBits, km);
    if (dir) pushUniqueBit(placeBits, "směr " + dir);
    // Prefer municipality over city-part on the collapsed place line.
    if (muni) placeBits.push(muni);
    else if (cityPart) placeBits.push(cityPart);
    if (district && !placeBits.join(" ").includes(district)) placeBits.push("okres " + district);
    return placeBits.join(" · ");
  }

  if (km) bits.push(km);
  else if (section) bits.push(section);
  if (dir) bits.push("směr " + dir);
  if (muni && !bits.includes(muni)) bits.push(muni);
  else if (
    location &&
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
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const hdr = buildLocalityHeaderModel(input);
  const eventRoad = resolvePresentationRoadNumber(input, facts);
  const roadResolved =
    eventRoad ||
    (hdr.outsideCityTunnelMode ? hdr.outsideCityTunnelRoad : null) ||
    null;
  let roadPres = classifyRoadPresentation(roadResolved || input.road, input);
  // Outside-city tunnel header uses tunnel object icon — not motorway/SMV road-type icon.
  if (hdr.outsideCityTunnelMode) {
    roadPres = {
      ...roadPres,
      roadTypeIcon: null,
      roadTypeIconAlt: "",
      showMotorwayIcon: false,
      showMotorVehiclesIcon: false,
    };
  }
  const head = buildHeadLocalityLabel(input);
  const dir =
    normalizeDirectionHuman(clean(input.direction) || facts.directionHuman || "") || null;
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
    municipalityRelation: hdr.municipalityRelation || null,
    nearMunicipalityPrefix: hdr.nearMunicipalityPrefix || null,
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
    roadTypeIconFirst:
      !hdr.outsideCityTunnelMode &&
      roadPres.showMotorVehiclesIcon === true &&
      roadPres.showMotorwayIcon !== true,
    outsideCityTunnelMode: hdr.outsideCityTunnelMode === true,
    tunnelObjectIcon: hdr.tunnelObjectIcon || null,
    tunnelObjectIconAlt: hdr.tunnelObjectIconAlt || null,
    outsideCityTunnelRoadConflict: hdr.outsideCityTunnelRoadConflict === true,
    outsideCityTunnelUsedRegistryRoad: hdr.outsideCityTunnelUsedRegistryRoad === true,
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
  const roadResolved = resolvePresentationRoadNumber(input, facts);
  const roadPres = classifyRoadPresentation(roadResolved || input.road, input);
  {
    const roads =
      Array.isArray(facts.roadNumbers) && facts.roadNumbers.length > 1
        ? facts.roadNumbers
        : null;
    push(
      "road",
      "Komunikace",
      roads ? roads.join(", ") : roadPres.road || roadResolved || input.road
    );
  }
  push("roadName", "Název komunikace", resolveRoadDisplayName(roadPres.road || roadResolved || input.road));
  if (input.roadClassLabel) {
    push("roadClass", "Třída komunikace", input.roadClassLabel);
  } else if (roadPres.roadClass === "CLASS_I") {
    push("roadClass", "Třída komunikace", "Silnice I. třídy");
  } else if (roadPres.roadClass === "CLASS_II") {
    push("roadClass", "Třída komunikace", "Silnice II. třídy");
  } else if (roadPres.roadClass === "CLASS_III") {
    push("roadClass", "Třída komunikace", "Silnice III. třídy");
  } else if (roadPres.roadClass === "MOTORWAY") {
    push("roadClass", "Třída komunikace", "Dálnice");
  }
  {
    const kmDet = resolveCollapsedKilometerLabel(input, facts);
    push("kilometer", "Kilometráž", kmDet ? kmDet.label : null);
  }
  push(
    "direction",
    "Směr",
    normalizeDirectionHuman(clean(input.direction) || facts.directionHuman || "")
  );
  {
    const confirmedStreet = resolveConfirmedStreet(input, facts);
    push("street", "Ulice", confirmedStreet);
  }
  let muniResolvedForDedup = null;
  {
    const muniResolved =
      resolveMunicipalitySignName(input) ||
      resolveMunicipalityCandidate(
        input.municipality || facts.city,
        facts.city,
        sourceBlob(input),
        facts.cityPart || input.cityPart
      ) ||
      (registry ? registry.municipality : null);
    muniResolvedForDedup = muniResolved;
    push("municipality", "Obec", muniResolved);
  }
  let cityPartForDedup = null;
  {
    let cityPartVal = facts.cityPart || input.cityPart || (registry ? registry.cityPart : null);
    if (!cityPartVal && isPrahaCityPartName(input.municipality)) {
      cityPartVal = clean(input.municipality);
    }
    if (!cityPartVal && isNumericCityPartName(input.municipality)) {
      cityPartVal = clean(input.municipality);
    }
    cityPartForDedup = cityPartVal;
    push("cityPart", "Městská část", cityPartVal);
  }
  push("district", "Okres", input.district || facts.district);
  {
    const locQ = clean(facts.locationQualifier);
    if (locQ) push("locationQualifier", "Upřesnění místa", locQ);
  }
  {
    const roadNorm = clean(roadResolved || input.road)
      .toLowerCase()
      .replace(/\s+/g, "");
    const locNorm = clean(input.location)
      .toLowerCase()
      .replace(/\s+/g, "");
    const streetNorm = clean(resolveConfirmedStreet(input, facts) || facts.street)
      .toLowerCase()
      .replace(/\s+/g, "");
    const muniNorm = clean(muniResolvedForDedup)
      .toLowerCase()
      .replace(/\s+/g, "");
    const partNorm = clean(cityPartForDedup)
      .toLowerCase()
      .replace(/\s+/g, "");
    const named = facts.namedObject ? streetBareName(facts.namedObject) : null;
    const namedKind = facts.namedObjectKind || (named ? classifyLocationKindFromName(named) : null);
    // Hide LOKALITA when it only echoes the road number (e.g. location=D0).
    const locIsRoadEcho =
      !!(roadNorm && locNorm && locNorm === roadNorm) ||
      (!!locNorm &&
        looksLikeRoadNumberToken(input.location) &&
        !!roadNorm &&
        locNorm === roadNorm);
    const locIsStreetEcho = !!(locNorm && streetNorm && locNorm === streetNorm);
    const locIsMuniEcho = !!(locNorm && muniNorm && locNorm === muniNorm);
    const locIsPartEcho = !!(locNorm && partNorm && locNorm === partNorm);
    const distNorm = clean(input.district || facts.district)
      .toLowerCase()
      .replace(/\s+/g, "");
    const cityNorm = clean(facts.city)
      .toLowerCase()
      .replace(/\s+/g, "");
    const locIsDistrictEcho =
      !!(locNorm && distNorm && locNorm === distNorm) &&
      !!(muniNorm && distNorm === muniNorm);
    const locIsCityEcho = !!(locNorm && cityNorm && locNorm === cityNorm);
    const localityDetail = clean(facts.localityDetail);
    if (named && namedKind === LOCATION_KIND.TUNNEL) {
      push("tunnel", "Tunel", named);
    } else if (named && namedKind === LOCATION_KIND.BRIDGE) {
      push("bridge", "Most", named);
    } else if (named && isNamedNonStreetKind(namedKind)) {
      push("namedObject", "Objekt", named);
    } else if (named) {
      // Named object is the authoritative locality — do not keep a conflicting TMC/area label.
      push("location", "Lokalita", named);
    } else if (localityDetail) {
      push("location", "Lokalita", localityDetail);
    } else if (
      !locIsRoadEcho &&
      !locIsStreetEcho &&
      !locIsMuniEcho &&
      !locIsPartEcho &&
      !locIsDistrictEcho &&
      !locIsCityEcho
    ) {
      let locVal = sanitizeExtractedValueToken(input.location);
      if (looksLikeTruncatedFragment(locVal)) locVal = "";
      // Contaminated multi-street glue from upstream location parsers.
      if (/\s-\s*ulice\s+/i.test(locVal) || /\sulice\s+/i.test(locVal)) locVal = "";
      // Never keep a false "ulice …tunel" locality echo.
      if (locVal && !(/^ulice\b/i.test(locVal) && /tunel/i.test(locVal))) {
        // Also hide when locality only repeats street glue / multi-street display.
        const locStreetish = streetBareName(locVal)
          .toLowerCase()
          .replace(/\s*\/\s*/g, "")
          .replace(/\s*-\s*/g, "")
          .replace(/\s+/g, "");
        const streetDisp = streetNorm.replace(/\s*\/\s*/g, "").replace(/\s+/g, "");
        const streetTokens = (facts.streets || [])
          .map((s) => clean(s).toLowerCase())
          .filter(Boolean);
        const locOnlyRepeatsStreet =
          !!(streetDisp && locStreetish && locStreetish === streetDisp) ||
          (streetTokens.length >= 1 &&
            streetTokens.every((t) => locStreetish.includes(t.replace(/\s+/g, ""))) &&
            !/\bdomů\b|\bč\./i.test(locVal));
        if (!locOnlyRepeatsStreet) {
          push("location", "Lokalita", locVal);
        }
      }
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
  const event = classifyEventPresentation(tv);
  // Communication owns road provenance (incl. outside-city tunnel registry fill).
  const communication = buildCommunicationLine(tv);
  const roadPres = communication.roadPresentation || classifyRoadPresentation(tv.road, tv);
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
