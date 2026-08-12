/**
 * Unified ŘSD/NDIC traffic card presentation (deterministic, no invented facts).
 * Layers: RAW source fields → normalized trafficV1 → CARD SUMMARY → EXPANDED DETAIL.
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

/** Same design token chain as timeline dots (.iuPrehledDne__dot). */
export const TRAFFIC_MAP_DOT_CSS_VAR = "--iu-pd-dot";

export const ROAD_NUMBER_BADGE = Object.freeze({
  MOTORWAY: "motorway", // red plate, white number
  ROAD: "road", // blue plate (I/II/III + SMV number)
  E_ROAD: "e-road", // green plate
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
 * Safe abbreviation expansion for public card text.
 * Word-boundary aware — does not replace OA inside longer tokens.
 */
export function expandTrafficAbbreviationsCs(text) {
  let s = clean(text);
  if (!s) return "";

  // Counted passenger cars: 2× OA / 2x OA / 2 OA
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

  // Counted trucks
  s = s.replace(/\b(\d+)\s*[×xX]\s*NA\b/g, (_, n) => {
    const num = Number(n);
    return num + " " + czechPlural(num, "nákladní automobil", "nákladní automobily", "nákladních automobilů");
  });
  s = s.replace(/\bpro\s+NA\b/gi, "pro nákladní automobily");
  s = s.replace(/\bNA\b/g, "nákladní automobil");

  return s;
}

/**
 * Classify road number for Czech plate colors + optional road-type icons.
 * motorVehicleRoadConfirmed must be explicit — never inferred from CLASS_I alone.
 */
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

  if (roadClass === "LOCAL" || roadClass === "UNKNOWN") {
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

/**
 * Event kind from structured type first, then safe text cues, else warning fallback.
 */
export function classifyEventPresentation(input = {}) {
  const type = clean(input.eventType || input.category).toLowerCase();
  const illustrationKey = clean(input.illustrationKey).toLowerCase();
  const blob = clean(
    [input.impact, input.impactFull, input.summary, input.summaryFull, input.title].filter(Boolean).join(" ")
  ).toLowerCase();

  const parkingFields =
    input.parkingAvailableSpaces != null ||
    input.parkingCapacity != null ||
    input.freeSpaces != null ||
    input.parkingOccupancy != null;

  if (
    type === "parkoviste" ||
    type === "parking" ||
    illustrationKey === "parking" ||
    parkingFields
  ) {
    return { kind: EVENT_KIND.PARKING, ...EVENT_KIND_META[EVENT_KIND.PARKING] };
  }

  if (type === "nehoda" || illustrationKey === "nehoda" || /\baccident\b/.test(type)) {
    return { kind: EVENT_KIND.ACCIDENT, ...EVENT_KIND_META[EVENT_KIND.ACCIDENT] };
  }
  if (type === "kolona" || illustrationKey === "kolona" || /abnormal|congest|queue/.test(type)) {
    return { kind: EVENT_KIND.QUEUE, ...EVENT_KIND_META[EVENT_KIND.QUEUE] };
  }
  if (
    type === "prace" ||
    illustrationKey === "prace" ||
    /roadwork|maintenance|construction/.test(type)
  ) {
    return { kind: EVENT_KIND.ROADWORKS, ...EVENT_KIND_META[EVENT_KIND.ROADWORKS] };
  }
  if (type === "uzavirka" || illustrationKey === "uzavirka" || /closure/.test(type)) {
    return { kind: EVENT_KIND.CLOSURE, ...EVENT_KIND_META[EVENT_KIND.CLOSURE] };
  }

  // Priority 3: strong closure cues in source text only (never invent scope).
  if (
    /\búpln[áa]\s+uzavírk/i.test(blob) ||
    /\buzavírka\b/i.test(blob) ||
    /\buzavřeno\b/i.test(blob) ||
    /\bneprůjezdn/i.test(blob)
  ) {
    // Prefer closure when text is explicit; keep roadworks if type is prace (handled above).
    if (type === "omezeni" || type === "prekazka" || type === "doprava" || !type) {
      return { kind: EVENT_KIND.CLOSURE, ...EVENT_KIND_META[EVENT_KIND.CLOSURE] };
    }
  }

  if (type === "omezeni" || type === "objizdka" || type === "prekazka" || type === "sjizdnost") {
    return { kind: EVENT_KIND.WARNING, ...EVENT_KIND_META[EVENT_KIND.WARNING] };
  }

  return { kind: EVENT_KIND.WARNING, ...EVENT_KIND_META[EVENT_KIND.WARNING] };
}

function stripDatexBoilerplate(text) {
  let s = clean(text);
  if (!s) return "";
  // Drop leading validity window when followed by more content
  s = s.replace(/^Od\s+\d{1,2}\.\d{1,2}\.\d{4}[^,]*,\s*/i, "");
  s = s.replace(/\bOd\s+\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\s+\d{1,2}:\d{2}\s+Do\s+\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\s+\d{1,2}:\d{2},?\s*/gi, "");
  return clean(s);
}

/**
 * Build short human situation line from available fields only.
 */
export function buildTrafficSituationSummary(input = {}) {
  const event = classifyEventPresentation(input);
  const raw =
    clean(input.impact) ||
    clean(input.summary) ||
    clean(input.impactFull) ||
    clean(input.summaryFull) ||
    "";
  const source = expandTrafficAbbreviationsCs(stripDatexBoilerplate(raw));

  if (event.kind === EVENT_KIND.PARKING) {
    const free =
      input.parkingAvailableSpaces != null
        ? input.parkingAvailableSpaces
        : input.freeSpaces != null
          ? input.freeSpaces
          : null;
    if (free != null && Number.isFinite(Number(free))) {
      return "Volných míst: " + String(Number(free));
    }
    return source || "Parkoviště.";
  }

  if (event.kind === EVENT_KIND.ACCIDENT) {
    if (!source) return "Nehoda.";
    // Prefer compact readable sentence; keep source meaning.
    let t = source;
    if (!/^nehoda/i.test(t)) t = "Nehoda. " + t;
    else t = t.replace(/^nehoda[;,:]?\s*/i, "Nehoda, ");
    return finalizeSummarySentence(t);
  }

  if (event.kind === EVENT_KIND.QUEUE) {
    if (!source) return "Kolona.";
    const len =
      input.queueLengthKm != null && Number.isFinite(Number(input.queueLengthKm))
        ? Number(input.queueLengthKm)
        : input.queueLengthMeters != null && Number.isFinite(Number(input.queueLengthMeters))
          ? Number(input.queueLengthMeters) / 1000
          : null;
    if (len != null) {
      const km =
        len >= 10 ? String(Math.round(len)) : String(Math.round(len * 10) / 10).replace(".", ",");
      return "Kolona přibližně " + km + " km.";
    }
    if (/kolon/i.test(source) || /silný provoz/i.test(source)) return finalizeSummarySentence(source);
    return finalizeSummarySentence("Kolona. " + source);
  }

  if (event.kind === EVENT_KIND.ROADWORKS) {
    if (!source) return "Práce na silnici.";
    return finalizeSummarySentence(source);
  }

  if (event.kind === EVENT_KIND.CLOSURE) {
    if (!source) return "Silnice je uzavřena.";
    if (/\búpln[áa]\s+uzavírk/i.test(source)) return "Úplná uzavírka komunikace.";
    if (/\boba směry\b/i.test(source)) return "Silnice je uzavřena v obou směrech.";
    // Do not invent "oba směry" — only echo known scope.
    if (/uzavř/i.test(source) || /uzavír/i.test(source) || /neprůjezd/i.test(source)) {
      return finalizeSummarySentence(source.length > 180 ? source.slice(0, 177) + "…" : source);
    }
    return "Silnice je uzavřena.";
  }

  if (!source) return "Dopravní omezení.";
  return finalizeSummarySentence(source.length > 180 ? source.slice(0, 177) + "…" : source);
}

function finalizeSummarySentence(t) {
  let s = clean(t);
  if (!s) return "";
  s = s.replace(/\s*;\s*/g, ", ");
  s = s.replace(/\s+,/g, ",");
  s = s.replace(/,\s*,/g, ",");
  if (!/[.!?…]$/.test(s)) s += ".";
  // Capitalize first letter
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/**
 * Place / direction line for the summary card.
 */
export function buildPlaceAndDirectionLine(input = {}) {
  const bits = [];
  const road = clean(input.road);
  const km = input.kilometer != null ? clean(String(input.kilometer)) : "";
  const section = clean(input.section);
  const dir = clean(input.direction);
  const muni = clean(input.municipality);
  const location = clean(input.location);
  const precise = input.preciseLocationVerified === true;

  if (road) bits.push(road);
  if (precise && km) bits.push("km " + km);
  if (precise && section && section !== km) bits.push(section);
  if (dir) bits.push("směr " + dir);
  if (muni) bits.push("u obce " + muni);
  else if (location && location !== road && location !== muni) bits.push(location);

  if (bits.length) return bits.join(" · ");

  const scope = clean(input.subjectScopeLabel);
  if (scope) return scope;
  if (muni) return muni;
  if (location) return location;
  return "";
}

/**
 * First-row communication line: icons handled in UI; text bits here.
 */
export function buildCommunicationLine(input = {}) {
  const roadPres = classifyRoadPresentation(input.road, input);
  const dir = clean(input.direction);
  const muni = clean(input.municipality);
  const location = clean(input.location);
  const street = clean(input.streetHint || input.street);

  if (roadPres.road) {
    return {
      roadPresentation: roadPres,
      direction: dir || null,
      localityFallback: null,
      street: street || null,
    };
  }

  const loc = muni || location || clean(input.subjectScopeLabel) || "";
  return {
    roadPresentation: roadPres,
    direction: dir || null,
    localityFallback: loc || null,
    street: street || null,
  };
}

/**
 * Expanded detail: all relevant public source fields (no parser/debug metadata).
 */
export function buildTrafficExpandedDetail(input = {}) {
  const rows = [];
  const push = (key, label, value) => {
    const v = value == null ? "" : clean(String(value));
    if (!v) return;
    if (/^(unknown|n\/a|null|undefined)$/i.test(v)) return;
    rows.push({ key, label, value: v });
  };

  const event = classifyEventPresentation(input);
  push("eventKind", "Druh události", event.titleCs);
  push("eventType", "Typ (zdroj)", input.eventType || input.category);
  push("road", "Komunikace", input.road);
  push("roadClass", "Třída komunikace", input.roadClassLabel || input.roadClass);
  if (input.europeanRoad) push("europeanRoad", "Evropský tah", input.europeanRoad);
  push("kilometer", "Kilometráž", input.kilometer);
  push("section", "Úsek", input.section);
  push("direction", "Směr", input.direction);
  push("location", "Místo", input.location);
  push("municipality", "Obec", input.municipality);
  push("district", "Okres", input.district);
  push("administrativeArea", "Správní území", input.administrativeArea);
  push("lanes", "Jízdní pruhy", input.lanes || input.laneStatus || input.affectedLanes);
  push("closedLanes", "Uzavřené pruhy", input.closedLanes);
  push("restrictionScope", "Rozsah omezení", input.restrictionScope);
  push("vehicles", "Vozidla", input.vehicles || input.vehicleDescription);
  push("cause", "Příčina", input.cause);
  push("measures", "Dopravní opatření", input.measures || input.trafficMeasure);
  push("diversion", "Objížďka", input.diversion || input.rerouting);
  push("delay", "Očekávané zdržení", input.delayMinutes != null ? String(input.delayMinutes) + " min" : null);
  push("queueLength", "Délka kolony", input.queueLengthKm != null ? String(input.queueLengthKm) + " km" : null);
  push("passability", "Průjezdnost", input.passability || input.carriagewayStatus);
  push("validityFrom", "Začátek platnosti", input.validity && input.validity.validFrom);
  push(
    "validityTo",
    "Konec platnosti",
    (input.validity && (input.validity.actualEnd || input.validity.expectedEnd || input.validity.validTo)) ||
      input.validTo
  );
  push("validityLine", "Platnost", input.validityLine);
  push("updated", "Aktualizace", input.lastMeaningfulChangeAt || input.sourceUpdatedAt);
  push("parkingFree", "Volná místa", input.parkingAvailableSpaces != null ? input.parkingAvailableSpaces : input.freeSpaces);
  push("parkingCapacity", "Kapacita parkoviště", input.parkingCapacity);
  push("parkingOccupancy", "Obsazenost", input.parkingOccupancy);

  const sourceFull =
    clean(input.impactFull) ||
    clean(input.summaryFull) ||
    clean(input.impact) ||
    clean(input.summary) ||
    "";
  if (sourceFull) {
    rows.push({
      key: "sourceDescription",
      label: "Popis ze zdroje ŘSD/NDIC",
      value: expandTrafficAbbreviationsCs(sourceFull),
    });
  }

  return { event, rows, sourceFull };
}

/**
 * Compose the card presentation model used by UI + fixtures.
 */
export function buildTrafficCardPresentation(trafficV1) {
  const tv = trafficV1 && typeof trafficV1 === "object" ? trafficV1 : {};
  const roadPres = classifyRoadPresentation(tv.road, {
    motorVehicleRoadConfirmed: tv.motorVehicleRoadConfirmed === true,
    isMotorVehicleRoad: tv.isMotorVehicleRoad === true,
    roadFacilityType: tv.roadFacilityType,
  });
  const event = classifyEventPresentation(tv);
  const communication = buildCommunicationLine(tv);
  const placeLine = buildPlaceAndDirectionLine(tv);
  const situationSummary = buildTrafficSituationSummary(tv);
  const expanded = buildTrafficExpandedDetail(tv);
  const hasPublicOaLeak = /\bOA\b/.test(situationSummary);

  return {
    roadPresentation: roadPres,
    event,
    communication,
    placeLine,
    situationSummary,
    situationLabel:
      event.kind === EVENT_KIND.PARKING ? "Parkoviště" : "Dopravní situace",
    placeLabel:
      communication.direction || (placeLine && placeLine.indexOf("směr") >= 0)
        ? "Místo a směr"
        : "Místo",
    validityLine: tv.validityLine != null ? clean(String(tv.validityLine)) : "",
    sourceLabel: tv.source != null ? clean(String(tv.source)) : "ŘSD/NDIC",
    expanded,
    mapDotCssVar: TRAFFIC_MAP_DOT_CSS_VAR,
    showMore: !!(expanded.sourceFull || (expanded.rows && expanded.rows.length > 2)),
    regression: {
      publicSummaryHasOa: hasPublicOaLeak,
    },
  };
}
