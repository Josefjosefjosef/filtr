/**
 * Unified ŘSD/NDIC traffic card presentation (deterministic, no invented facts).
 * Layers: RAW source fields → normalized trafficV1 → CARD SUMMARY → EXPANDED DETAIL.
 *
 * Official NDIC publicComment often carries km/směr/ulice/P+R while structured
 * card fields are null — parse only substrings present in that trusted text.
 */

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

export const EVENT_KIND = Object.freeze({
  ACCIDENT: "accident",
  QUEUE: "queue",
  ROADWORKS: "roadworks",
  CLOSURE: "closure",
  PARKING: "parking",
  WARNING: "warning",
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
    city: null,
    cityPart: null,
    district: null,
    parkingName: null,
    parkingOccupancyPercent: null,
    parkingFreeUpperBound: null,
    queueLengthKm: null,
    situationPhrases: [],
    isEmptyTemplate: false,
  };
  if (!text) return out;
  if (EMPTY_IMPACT_RE.test(text)) {
    out.isEmptyTemplate = true;
    return out;
  }

  const kmRange =
    text.match(/\bkm\s+(\d+(?:[.,]\d+)?)\s*(?:až|–|-|—)\s*(\d+(?:[.,]\d+)?)/i) ||
    text.match(/\bmezi\s+km\s+(\d+(?:[.,]\d+)?)\s+a\s+(\d+(?:[.,]\d+)?)/i);
  if (kmRange) {
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

  const street = text.match(/\bulice\s+([^,;]{2,80})/i);
  if (street) out.street = clean(street[1]);

  const okr = text.match(/\bokr\.\s*([^,;]{2,60})/i);
  if (okr) out.district = clean(okr[1]);

  // "ulice X, CityPart, City," pattern (Hornopolní)
  const locTrip = text.match(
    /\bulice\s+([^,;]+),\s*([^,;]+),\s*([A-ZÁ-Ž][\p{L}\-]+(?:\s+[A-ZÁ-Ž][\p{L}\-]+)?)\b/u
  );
  if (locTrip) {
    out.street = clean(locTrip[1]);
    out.cityPart = clean(locTrip[2]);
    out.city = clean(locTrip[3]);
  } else {
    const cityHint = text.match(
      /,\s*([A-ZÁ-Ž][\p{L}\-]+(?:\s+[A-ZÁ-Ž][\p{L}\-]+)?)\s*,\s*okr\./u
    );
    if (cityHint) out.city = clean(cityHint[1]);
  }

  const pr = text.match(/\bP\s*\+\s*R\s+([^,;]{2,60})/i);
  if (pr) out.parkingName = "P+R " + clean(pr[1]);
  const occ = text.match(/(\d{1,3})\s*%\s*obsazeno/i);
  if (occ) out.parkingOccupancyPercent = Number(occ[1]);
  const freeBound = text.match(/méně než\s+(\d+)\s+volných/i);
  if (freeBound) out.parkingFreeUpperBound = Number(freeBound[1]);

  const q = text.match(/\bkolona\s+(\d+(?:[.,]\d+)?)\s*km\b/i);
  if (q) out.queueLengthKm = Number(String(q[1]).replace(",", "."));

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
    String(opts.roadFacilityType || "").toUpperCase() === "MOTOR_VEHICLE_ROAD";

  if (!road) {
    return {
      road: "",
      roadClass: "UNKNOWN",
      numberBadge: ROAD_NUMBER_BADGE.UNKNOWN,
      roadTypeIcon: null,
      roadTypeIconAlt: "",
      showMotorwayIcon: false,
      showMotorVehiclesIcon: false,
    };
  }
  if (/^E\d+[A-Za-z]?$/i.test(road) || /^E\s*\d+/i.test(road)) {
    return {
      road,
      roadClass: "E_ROAD",
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
    numberBadge: ROAD_NUMBER_BADGE.ROAD,
    roadTypeIcon: motorVehicleConfirmed ? TRAFFIC_SIGN_ASSET.MOTOR_VEHICLES : null,
    roadTypeIconAlt: motorVehicleConfirmed ? "Silnice pro motorová vozidla" : "",
    showMotorwayIcon: false,
    showMotorVehiclesIcon: motorVehicleConfirmed,
  };
}

export function classifyEventPresentation(input = {}) {
  const type = clean(input.eventType || input.category).toLowerCase();
  const illustrationKey = clean(input.illustrationKey).toLowerCase();
  const blob = sourceBlob(input);
  const facts = parseOfficialCommentFacts(blob);
  const parkingFields =
    input.parkingAvailableSpaces != null ||
    input.parkingCapacity != null ||
    input.freeSpaces != null ||
    input.parkingOccupancy != null ||
    !!facts.parkingName ||
    /p\s*\+\s*r\b/i.test(blob) ||
    /\bparkovišt/i.test(blob);

  if (
    type === "parkoviste" ||
    type === "parking" ||
    illustrationKey === "parking" ||
    parkingFields
  ) {
    const meta = { ...EVENT_KIND_META[EVENT_KIND.PARKING] };
    if (facts.parkingName) meta.titleCs = "PARKOVIŠTĚ – " + facts.parkingName.toUpperCase();
    return { kind: EVENT_KIND.PARKING, ...meta, facts };
  }

  if (type === "nehoda" || illustrationKey === "nehoda" || /\baccident\b/.test(type)) {
    return { kind: EVENT_KIND.ACCIDENT, ...EVENT_KIND_META[EVENT_KIND.ACCIDENT], facts };
  }
  if (type === "kolona" || illustrationKey === "kolona" || /abnormal|congest|queue/.test(type)) {
    return { kind: EVENT_KIND.QUEUE, ...EVENT_KIND_META[EVENT_KIND.QUEUE], facts };
  }
  if (type === "prace" || illustrationKey === "prace" || /roadwork|maintenance|construction/.test(type)) {
    return { kind: EVENT_KIND.ROADWORKS, ...EVENT_KIND_META[EVENT_KIND.ROADWORKS], facts };
  }
  if (type === "uzavirka" || illustrationKey === "uzavirka" || /closure/.test(type)) {
    return { kind: EVENT_KIND.CLOSURE, ...EVENT_KIND_META[EVENT_KIND.CLOSURE], facts };
  }
  if (
    /\búpln[áa]\s+uzavírk/i.test(blob) ||
    /\buzavírk/i.test(blob) ||
    /\buzavř/i.test(blob) ||
    /\bneprůjezdn/i.test(blob)
  ) {
    if (type === "omezeni" || type === "prekazka" || type === "doprava" || !type) {
      return { kind: EVENT_KIND.CLOSURE, ...EVENT_KIND_META[EVENT_KIND.CLOSURE], facts };
    }
  }
  if (/silný provoz|tvoří se kolona|\bkolona\b/i.test(blob) && (type === "omezeni" || type === "doprava")) {
    return { kind: EVENT_KIND.QUEUE, ...EVENT_KIND_META[EVENT_KIND.QUEUE], facts };
  }
  if (type === "omezeni" || type === "objizdka" || type === "prekazka" || type === "sjizdnost") {
    return { kind: EVENT_KIND.WARNING, ...EVENT_KIND_META[EVENT_KIND.WARNING], facts };
  }
  return { kind: EVENT_KIND.WARNING, ...EVENT_KIND_META[EVENT_KIND.WARNING], facts };
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
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
  }
  return uniq.join(" ");
}

/**
 * Short complete summary — never ends with "…" from truncation.
 */
export function buildTrafficSituationSummary(input = {}) {
  const event = classifyEventPresentation(input);
  const facts = event.facts || parseOfficialCommentFacts(sourceBlob(input));
  const raw = stripBoilerplate(
    clean(input.impactFull) || clean(input.impact) || clean(input.summaryFull) || clean(input.summary) || ""
  );
  const source = expandTrafficAbbreviationsCs(raw);

  if (event.kind === EVENT_KIND.PARKING) {
    const bits = [];
    if (facts.parkingOccupancyPercent != null) bits.push(facts.parkingOccupancyPercent + " % obsazeno");
    if (facts.parkingFreeUpperBound != null) {
      bits.push("Méně než " + facts.parkingFreeUpperBound + " volných parkovacích míst");
    } else if (input.parkingAvailableSpaces != null || input.freeSpaces != null) {
      const free = input.parkingAvailableSpaces != null ? input.parkingAvailableSpaces : input.freeSpaces;
      if (Number.isFinite(Number(free))) return "Volných míst: " + String(Number(free));
    }
    if (bits.length) return finalizeSentences(bits);
    return "Informace o obsazenosti parkoviště.";
  }

  if (event.kind === EVENT_KIND.QUEUE) {
    const bits = [];
    if (/silný provoz/i.test(source)) bits.push("Silný provoz");
    if (/tvoří se kolona/i.test(source)) bits.push("Tvoří se kolona");
    const qKm =
      facts.queueLengthKm != null
        ? facts.queueLengthKm
        : input.queueLengthKm != null
          ? Number(input.queueLengthKm)
          : null;
    if (qKm != null && Number.isFinite(qKm)) {
      const km = qKm >= 10 ? String(Math.round(qKm)) : String(Math.round(qKm * 10) / 10).replace(".", ",");
      bits.push("Kolona přibližně " + km + " km");
    } else if (/kolona/i.test(source) && !bits.length) bits.push("Kolona");
    if (bits.length) return finalizeSentences(bits);
    return "Kolona.";
  }

  if (event.kind === EVENT_KIND.ACCIDENT) {
    const bits = ["Nehoda"];
    // Prefer expanded vehicle counts from trusted comment (OA → osobní automobil…).
    const vehicleBits = source
      .split(/[;,.]/)
      .map(clean)
      .filter((x) => x && /osobní automobil|nákladní automobil|neprůjezdn|porouchan/i.test(x))
      .slice(0, 3);
    bits.push(...vehicleBits);
    for (const p of facts.situationPhrases) {
      if (/nehoda/i.test(p)) continue;
      if (vehicleBits.some((v) => v.toLowerCase().includes(p.toLowerCase().slice(0, 12)))) continue;
      bits.push(p);
    }
    if (bits.length === 1 && source && !EMPTY_IMPACT_RE.test(source)) {
      const clipped = source
        .replace(/^nehoda[;,:]?\s*/i, "")
        .split(/[,;.]/)
        .map(clean)
        .filter((x) => x && !/^od\s+\d/i.test(x) && x.length < 80)
        .slice(0, 2);
      bits.push(...clipped);
    }
    return finalizeSentences(bits);
  }

  if (event.kind === EVENT_KIND.ROADWORKS) {
    const bits = [];
    for (const p of facts.situationPhrases) bits.push(p);
    if (!bits.length) {
      if (/práce na inženýrských sítích/i.test(source)) bits.push("Práce na inženýrských sítích");
      if (/provoz převeden do protisměru/i.test(source)) bits.push("Provoz převeden do protisměru");
      if (/stavební práce/i.test(source)) bits.push("Stavební práce");
      if (/práce na silnici/i.test(source) && !bits.length) bits.push("Práce na silnici");
    }
    if (!bits.length) bits.push("Práce na silnici");
    return finalizeSentences(bits);
  }

  if (event.kind === EVENT_KIND.CLOSURE) {
    if (/\búpln[áa]\s+uzavírk/i.test(source)) {
      const road = clean(input.road);
      if (road) return "Úplná uzavírka silnice " + road + ".";
      const ul = source.match(/úplná uzavírka\s+ul\.\s*([^,;]{2,60})/i);
      if (ul) return "Úplná uzavírka ulice " + clean(ul[1]) + ".";
      return "Úplná uzavírka komunikace.";
    }
    if (/\boba směry\b/i.test(source)) return "Silnice je uzavřena v obou směrech.";
    const bits = [];
    for (const p of facts.situationPhrases) bits.push(p);
    const dir = facts.directionHuman || clean(input.direction);
    if (dir) bits.push("uzavřeno ve směru " + dir);
    if (bits.length) return finalizeSentences(bits);
    return "Silnice je uzavřena.";
  }

  if (facts.situationPhrases.length) return finalizeSentences(facts.situationPhrases.slice(0, 3));
  if (!source || EMPTY_IMPACT_RE.test(source)) return "Dopravní omezení.";
  // Prefer first complete clause(s), never ellipsis-truncate mid sentence.
  const clauses = source
    .split(/[.;]/)
    .map(clean)
    .filter((x) => x && x.length >= 8 && !/^od\s+\d/i.test(x) && !/^do\s+\d/i.test(x) && !/^vydal:/i.test(x))
    .slice(0, 2);
  if (clauses.length) return finalizeSentences(clauses);
  return "Dopravní omezení.";
}

function streetBareName(raw) {
  return clean(raw).replace(/^ulice\s+/i, "");
}

function samePlaceName(a, b) {
  const x = clean(a).toLowerCase();
  const y = clean(b).toLowerCase();
  return !!(x && y && x === y);
}

/**
 * Municipality/city name for the Czech entrance-style signboard.
 * Never invents Praha/Jižní spojka; never treats street or city-part as municipality.
 */
export function resolveMunicipalitySignName(input = {}) {
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const structured = clean(input.municipality);
  const fromComment = clean(facts.city);
  const street = streetBareName(facts.street || input.streetHint || input.street);
  const cityPart = clean(facts.cityPart || input.cityPart);

  let city = structured || fromComment || "";
  if (!city) return null;
  if (/^p\s*\+\s*r\b/i.test(city)) return null;
  if (street && samePlaceName(city, street)) return null;
  if (cityPart && samePlaceName(city, cityPart)) return null;
  return city;
}

/**
 * Locality header parts: [municipality sign] [road] [street/beside].
 */
export function buildLocalityHeaderModel(input = {}) {
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const road = clean(input.road);
  const municipalitySign = resolveMunicipalitySignName(input);
  const street = streetBareName(facts.street || input.streetHint || input.street);
  const location = clean(input.location);
  const district = clean(input.district) || facts.district || "";
  const cityPart = clean(facts.cityPart || input.cityPart);

  let besideLocality = "";
  if (street) besideLocality = street;
  else if (
    location &&
    !samePlaceName(location, municipalitySign) &&
    location !== road &&
    !/^d\d/i.test(location) &&
    !/^p\s*\+\s*r\b/i.test(location) &&
    !samePlaceName(location, cityPart)
  ) {
    // Short location label (e.g. Hornopolní) when it is not the city itself.
    besideLocality = location;
  }

  let districtBeside = "";
  if (municipalitySign && !besideLocality && !road && district) {
    districtBeside = "okres " + district;
  }

  return {
    municipalitySign,
    municipalitySignLabel: municipalitySign ? municipalitySign.toUpperCase() : null,
    besideLocality: besideLocality || null,
    districtBeside: districtBeside || null,
    street: street || null,
    cityPart: cityPart || null,
    district: district || null,
    parkingName: facts.parkingName || null,
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

  if (hdr.municipalitySign && hdr.besideLocality) {
    return {
      head: hdr.municipalitySignLabel + " — " + hdr.besideLocality.toUpperCase(),
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
  const street = facts.street || clean(input.streetHint || input.street) || "";
  const location = clean(input.location);

  if (facts.parkingName) {
    const bits = [facts.parkingName];
    if (muni) bits.push(muni);
    else if (location && !/^p\+r/i.test(location)) bits.push(location);
    return bits.join(" · ");
  }

  if (street && (muni || facts.cityPart)) {
    const placeBits = ["ulice " + street.replace(/^ulice\s+/i, "")];
    if (facts.cityPart) placeBits.push(facts.cityPart);
    else if (muni) placeBits.push(muni);
    if (district && !placeBits.join(" ").includes(district)) placeBits.push("okres " + district);
    return placeBits.join(" · ");
  }

  if (road) bits.push(road);
  if (km) bits.push(km);
  else if (section) bits.push(section);
  if (dir) bits.push("směr " + dir);
  if (muni && !bits.includes(muni)) bits.push(muni);
  else if (location && location !== road && !bits.includes(location)) bits.push(location);
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
    direction: dir,
    localityFallback:
      !roadPres.road && !hdr.municipalitySign
        ? head.head
        : !roadPres.road && hdr.municipalitySign
          ? null
          : null,
    headLocality: roadPres.road && !hdr.municipalitySign ? head.head : null,
    municipalitySign: hdr.municipalitySign,
    municipalitySignLabel: hdr.municipalitySignLabel,
    besideLocality: hdr.besideLocality,
    districtBeside: hdr.districtBeside,
    street: hdr.street || null,
    parkingName: facts.parkingName || null,
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

  // Skip redundant "Typ (zdroj)" when it only repeats the card title kind.
  push("road", "Komunikace", input.road);
  if (input.roadClassLabel) push("roadClass", "Třída komunikace", input.roadClassLabel);
  push("kilometer", "Kilometráž", facts.kilometerLabel || input.kilometer);
  push("direction", "Směr", clean(input.direction) || facts.directionHuman);
  push("street", "Ulice", facts.street || input.streetHint || input.street);
  push("municipality", "Obec", input.municipality || facts.city);
  push("cityPart", "Městská část", facts.cityPart);
  push("district", "Okres", input.district || facts.district);
  push("location", "Lokalita", input.location);
  if (facts.parkingName) push("parkingName", "Parkoviště", facts.parkingName);
  if (facts.parkingOccupancyPercent != null) {
    push("parkingOccupancy", "Obsazenost", facts.parkingOccupancyPercent + " %");
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

  return { event, rows, sourceFull, facts };
}

export function buildTrafficCardPresentation(trafficV1) {
  const tv = trafficV1 && typeof trafficV1 === "object" ? trafficV1 : {};
  const roadPres = classifyRoadPresentation(tv.road, {
    motorVehicleRoadConfirmed: tv.motorVehicleRoadConfirmed === true,
    isMotorVehicleRoad: tv.isMotorVehicleRoad === true,
    roadFacilityType: tv.roadFacilityType,
  });
  const event = classifyEventPresentation(tv);
  const communication = buildCommunicationLine(tv);
  const placeLineRaw = buildPlaceAndDirectionLine(tv);
  const placeLine = placeLineWithoutDuplicateMunicipality(
    placeLineRaw,
    communication.municipalitySign
  );
  const situationSummary = buildTrafficSituationSummary(tv);
  const expanded = buildTrafficExpandedDetail(tv);
  const informative = isTrafficCardInformative(tv);
  const hasPublicOaLeak = /\bOA\b/.test(situationSummary);

  let eventTitle = event.titleCs;
  if (event.kind === EVENT_KIND.PARKING && communication.parkingName) {
    eventTitle = "PARKOVIŠTĚ – " + String(communication.parkingName).toUpperCase();
  }

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
