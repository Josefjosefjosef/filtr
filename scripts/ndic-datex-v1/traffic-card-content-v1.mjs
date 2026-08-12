/**
 * Traffic card content helpers — deterministic, no invented facts.
 * Used by snapshot persist + UI fixtures. Keep pure (no DOM / network).
 */

export const ROAD_CLASS = Object.freeze({
  MOTORWAY: "MOTORWAY",
  CLASS_I: "CLASS_I",
  CLASS_II: "CLASS_II",
  CLASS_III: "CLASS_III",
  E_ROAD: "E_ROAD",
  LOCAL: "LOCAL",
  UNKNOWN: "UNKNOWN",
});

export const ROAD_CLASS_LABEL_CS = Object.freeze({
  MOTORWAY: "Dálnice",
  CLASS_I: "Silnice I. třídy",
  CLASS_II: "Silnice II. třídy",
  CLASS_III: "Silnice III. třídy",
  E_ROAD: "Evropský tah",
  LOCAL: "Místní komunikace",
  UNKNOWN: "Komunikace",
});

export const EVENT_ILLUSTRATION = Object.freeze({
  nehoda: "nehoda",
  prekazka: "prekazka",
  prace: "prace",
  uzavirka: "uzavirka",
  kolona: "kolona",
  pozar: "pozar",
  omezeni: "omezeni",
  objizdka: "omezeni",
  sjizdnost: "prekazka",
  doprava: "neutral",
  neutral: "neutral",
});

const TECH_DIRECTION = /^(kladný směr|záporný směr|positive|negative|pos|neg|POSITIVE|NEGATIVE)$/i;
const BAD_LOCALITY = /^(česká republika|evidovaná oblast|cr|cz)$/i;

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derive road class from an official road number string (deterministic).
 * @param {string|null|undefined} roadNumber
 */
export function classifyRoadNumber(roadNumber) {
  const r = clean(roadNumber);
  if (!r) return ROAD_CLASS.UNKNOWN;
  if (/^E\d+[A-Za-z]?$/i.test(r) || /^E\s*\d+/i.test(r)) return ROAD_CLASS.E_ROAD;
  if (/^D\d+[A-Za-z]?$/i.test(r) || /^Dálnice\s*D?\d+/i.test(r)) return ROAD_CLASS.MOTORWAY;
  if (/^III\/\d+/i.test(r)) return ROAD_CLASS.CLASS_III;
  if (/^II\/\d+/i.test(r)) return ROAD_CLASS.CLASS_II;
  if (/^I\/\d+/i.test(r)) return ROAD_CLASS.CLASS_I;
  if (/^R\d+/i.test(r)) return ROAD_CLASS.MOTORWAY;
  // Bare digits are typically I. class road numbers in NDIC comments / TMC.
  if (/^\d{1,3}[A-Za-z]?$/i.test(r)) return ROAD_CLASS.CLASS_I;
  if (/^(ulice|náměstí|silnice)/i.test(r)) return ROAD_CLASS.LOCAL;
  return ROAD_CLASS.LOCAL;
}

export function roadClassLabelCs(roadClass) {
  return ROAD_CLASS_LABEL_CS[roadClass] || ROAD_CLASS_LABEL_CS.UNKNOWN;
}

/**
 * Human direction for main UI. Technical positive/negative → null (do not display).
 * @param {string|null|undefined} raw
 */
export function humanDirectionOrNull(raw) {
  const d = clean(raw);
  if (!d) return null;
  if (TECH_DIRECTION.test(d)) return null;
  if (/^oba směry$/i.test(d) || /^BOTH$/i.test(d)) return "oba směry";
  // Short destination-like tokens only
  if (/^[A-Za-zÁ-Žá-ž0-9 ./-]{2,40}$/.test(d)) return d;
  return null;
}

/**
 * Extract municipality / district hints from official NDIC public comment text.
 * Returns only substrings present in source — never invents place names.
 * @param {string|null|undefined} summary
 */
export function extractLocalityFromOfficialComment(summary) {
  const s = clean(summary);
  if (!s) return { municipality: null, district: null, streetHint: null };

  let municipality = null;
  let district = null;
  let streetHint = null;

  const mObci = s.match(
    /(?:[Vv]\s+katastru\s+obce|[Vv]\s+obci|\bobec)\s+([A-ZÁ-Ž][\p{L}0-9\-]+(?:\s+(?:nad|pod|u)\s+[A-ZÁ-Ž][\p{L}0-9\-]+)?)/u
  );
  if (mObci) municipality = clean(mObci[1]);

  if (!municipality) {
    // ", Postřelmov, okr. Šumperk"
    const mTown = s.match(/,\s*([A-ZÁ-Ž][\p{L}\-]+(?:\s+[nNiI]ad\s+[A-ZÁ-Ž][\p{L}\-]+)?)\s*,\s*okr\./u);
    if (mTown) municipality = clean(mTown[1]);
  }

  const mOkr = s.match(/okr\.\s*([A-ZÁ-Ž][\p{L}\-]+(?:\s+[A-ZÁ-Ž][\p{L}\-]+)?)/u);
  if (mOkr) district = clean(mOkr[1]);

  const mStreet =
    s.match(/\bv\s+ulici\s+([^,;]{2,60})/i) || s.match(/\bulice:?\s+([^,;]{2,60})/i);
  if (mStreet) streetHint = clean(mStreet[1]);

  return { municipality, district, streetHint };
}

/**
 * Prefer human locality over national fallback labels.
 * Never promotes a street name into the card locality/municipality slot.
 * @param {{ locationLabel?: string|null, roadNumber?: string|null, summary?: string|null, subjectScopeLabel?: string|null }} p
 */
export function chooseHumanLocality(p = {}) {
  const fromComment = extractLocalityFromOfficialComment(p.summary);
  if (fromComment.municipality) return fromComment.municipality;

  const loc = clean(p.locationLabel);
  const road = clean(p.roadNumber);
  if (loc && !BAD_LOCALITY.test(loc) && loc !== road) {
    // Fail-closed: street-like tokens are not municipalities.
    if (!/(ská|cká|ovská|ová|ova|ná|ní)$/i.test(loc) || /\s/.test(loc)) {
      if (!/^(náměstí|nábřeží)\b/i.test(loc) && !/\btřída\b/i.test(loc)) return loc;
    }
  }

  const scope = clean(p.subjectScopeLabel);
  if (scope && !BAD_LOCALITY.test(scope) && scope !== road) return scope;

  if (fromComment.district) return "okres " + fromComment.district;

  if (road) return road;
  return null;
}

/**
 * Illustration key from structured event type only (never guess from free text).
 * @param {string|null|undefined} eventType
 */
export function illustrationKeyForEventType(eventType) {
  const t = String(eventType || "")
    .trim()
    .toLowerCase();
  if (EVENT_ILLUSTRATION[t]) return EVENT_ILLUSTRATION[t];
  if (/uzavir|closure/.test(t)) return EVENT_ILLUSTRATION.uzavirka;
  if (/nehod|accident/.test(t)) return EVENT_ILLUSTRATION.nehoda;
  if (/prace|roadwork|works|maintenance|construction/.test(t)) return EVENT_ILLUSTRATION.prace;
  if (/kolon|queue|congest|abnormal/.test(t)) return EVENT_ILLUSTRATION.kolona;
  if (/prekaz|obstruct|vehicleobstruction/.test(t)) return EVENT_ILLUSTRATION.prekazka;
  if (/pozar|fire/.test(t)) return EVENT_ILLUSTRATION.pozar;
  if (/omezen|restrict|management/.test(t)) return EVENT_ILLUSTRATION.omezeni;
  return EVENT_ILLUSTRATION.neutral;
}

/**
 * Pick ŘSD timeline timestamp: versionTime → creationTime → publicationTime.
 * Never validity start/end. Never InfoUzel download unless explicitly allowed.
 * @param {{ versionTime?: string|null, creationTime?: string|null, publicationTime?: string|null, downloadedAt?: string|null, allowDownloadFallback?: boolean }} p
 */
export function pickRsdTimelineTimestamp(p = {}) {
  const versionTime = p.versionTime || null;
  const creationTime = p.creationTime || null;
  const publicationTime = p.publicationTime || null;
  if (versionTime) {
    return {
      iso: versionTime,
      field: "situationRecordVersionTime",
      semantics: "Last version time of the DATEX situationRecord from ŘSD/NDIC.",
      changeTimeSource: "EVENT_CHANGE",
    };
  }
  if (creationTime) {
    return {
      iso: creationTime,
      field: "situationRecordCreationTime",
      semantics: "Creation time of the DATEX situationRecord from ŘSD/NDIC.",
      changeTimeSource: "EVENT_CHANGE",
    };
  }
  if (publicationTime) {
    return {
      iso: publicationTime,
      field: "publicationTime",
      semantics: "DATEX payload publicationTime (fallback when record times absent).",
      changeTimeSource: "EVENT_CHANGE",
    };
  }
  if (p.allowDownloadFallback && p.downloadedAt) {
    return {
      iso: p.downloadedAt,
      field: "datexDownloadedAt",
      semantics: "InfoUzel download time — last-resort fallback only.",
      changeTimeSource: "DOWNLOAD_FALLBACK",
    };
  }
  return {
    iso: null,
    field: null,
    semantics: "No safe ŘSD/NDIC source timestamp available.",
    changeTimeSource: "UNKNOWN",
  };
}

/**
 * Prefer official public comment over category templates.
 * Short/placeholder summaries do not override deterministic category templates.
 * @param {string|null|undefined} officialSummary
 * @param {string|null|undefined} templateImpact
 * @param {number} [shortMax]
 */
export function chooseImpactTexts(officialSummary, templateImpact, shortMax = 160) {
  const official = clean(officialSummary);
  const template = clean(templateImpact);
  const looksReal =
    official.length >= 40 ||
    /(?:okr\.|silnice|ulice|katastru|neprůjezd|uzavř|zúžen|Od\s+\d)/i.test(official);
  if (looksReal) {
    const short =
      official.length > shortMax ? official.slice(0, shortMax - 1).trim() + "…" : official;
    return {
      impactShort: short,
      impactFull: official.length > shortMax ? official : null,
      impactSource: "publicComment",
    };
  }
  if (template) {
    return { impactShort: template, impactFull: null, impactSource: "categoryTemplate" };
  }
  if (official) {
    return { impactShort: official, impactFull: null, impactSource: "publicComment" };
  }
  return { impactShort: null, impactFull: null, impactSource: "none" };
}

/**
 * Format Czech validity line only from real bounds.
 */
export function formatValidityLineCs(validFrom, validTo, openEnded) {
  const fromMs = validFrom ? Date.parse(validFrom) : NaN;
  const toMs = validTo ? Date.parse(validTo) : NaN;
  if (!Number.isFinite(fromMs)) return null;
  const fmtDay = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
  const fmtTime = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = fmtDay.format(fromMs);
  const t0 = fmtTime.format(fromMs);
  if (openEnded || !Number.isFinite(toMs)) {
    return day + " · od " + t0;
  }
  const sameDay = fmtDay.format(fromMs) === fmtDay.format(toMs);
  const t1 = fmtTime.format(toMs);
  if (sameDay) return day + " · " + t0 + "–" + t1;
  return "od " + day + " " + t0 + " do " + fmtDay.format(toMs) + " " + t1;
}

/**
 * User-facing regression needles that must never appear in main traffic UI HTML.
 */
export const TRAFFIC_UI_REGRESSION_NEEDLES = Object.freeze([
  "Čerstvost: UNKNOWN",
  "Historie: nová",
  "směr záporný směr",
  "směr kladný směr",
  "záporný směr",
  "kladný směr",
]);

export function scanTrafficUserTextRegressions(text) {
  const s = String(text || "");
  const hits = [];
  for (const n of TRAFFIC_UI_REGRESSION_NEEDLES) {
    if (s.includes(n)) hits.push(n);
  }
  if (/\bUNKNOWN\b/.test(s)) hits.push("UNKNOWN");
  if (/\bNULL\b/.test(s)) hits.push("NULL");
  if (/\bundefined\b/.test(s)) hits.push("undefined");
  if (/\bN\/A\b/i.test(s)) hits.push("N/A");
  return { ok: hits.length === 0, hits };
}
