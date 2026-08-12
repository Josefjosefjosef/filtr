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
} from "./iu-parking-registry-v1.js?v=ndic-parking-classify-v1-20260812";

export {
  matchParkingRegistry,
  PARK_AND_RIDE_EXPLANATION_CS,
  PARKING_REGISTRY,
  PARKING_REGISTRY_VERSION,
  normalizeParkingAliasKey,
  isAmbiguousParkingName,
} from "./iu-parking-registry-v1.js?v=ndic-parking-classify-v1-20260812";

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

function streetBareName(raw) {
  return clean(raw)
    .replace(/^ulice:?\s+/i, "")
    .replace(/^v\s+ulici\s+/i, "");
}

/** Heuristic: street-like tokens must never become the white municipality board. */
export function looksLikeStreetName(raw) {
  const t = clean(raw);
  if (!t) return false;
  if (/^(náměstí|nábřeží)\b/i.test(t)) return true;
  if (/\btřída\b/i.test(t)) return true;
  if (/^praha\s+\d/i.test(t)) return false;
  if (/\s/.test(t)) {
    if (/\ba\b/i.test(t)) return false;
    return /(ská|cká|ovská)(?:\s|$)/i.test(t);
  }
  return /(ská|cká|ovská|ová|ova|ná|ní)$/i.test(t);
}

function looksLikeRoadNumberToken(raw) {
  const t = clean(raw);
  if (!t) return false;
  return /^(?:[DIE]\s*)?\d+[A-Za-z]?$/i.test(t) || /^(?:I{1,3}|D|E|R)\/\d+/i.test(t);
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
  if (type === "nehoda" || type === "prace" || type === "uzavirka" || type === "kolona") {
    // Strong typed road events win unless the blob is clearly occupancy-only.
    if (!PARKING_OCCUPANCY_CLAUSE_RE.test(text) && !/\bP\s*\+\s*[RG]\b/i.test(text)) return true;
  }
  if (/\bparkovací(?:ho)?\s+pruhu?\b/i.test(text)) return true;
  if (/\b(uzavřen[íýáo]|uzavírk).{0,40}parkovac/i.test(text)) return true;
  if (/\b(stavební práce|práce na silnici|oprava povrchu|práce na inženýrských).{0,60}parkovišt/i.test(text)) {
    return true;
  }
  if (/\bparkovišt.{0,40}(uzavřen|neprůjezdn|objížďk)/i.test(text)) return true;
  if (/\bnehoda\b/i.test(text) && !PARKING_OCCUPANCY_CLAUSE_RE.test(text)) return true;
  if (/\búpln[áa]\s+uzavírk/i.test(text) && !PARKING_OCCUPANCY_CLAUSE_RE.test(text)) return true;
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

  if (facts.parkingName) return true;
  if (/\bP\s*\+\s*[RG]\b/i.test(blob)) return true;
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

  const mObci = text.match(
    /\b[Vv]\s+(?:katastru\s+obce|obci)\s+([A-ZÁ-Ž][\p{L}0-9\-]+(?:\s+(?:nad|pod|u)\s+[A-ZÁ-Ž][\p{L}0-9\-]+)?)/u
  );
  if (mObci) out.city = clean(mObci[1]);

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

  // "ulice X, CityPart, City," pattern (Hornopolní) — only when City is not another street.
  const locTrip = text.match(
    /\bulice:?\s+([^,;]+),\s*([^,;]+),\s*([A-ZÁ-Ž][\p{L}\-]+(?:\s+[A-ZÁ-Ž][\p{L}\-]+)?)\b/u
  );
  if (locTrip && !out.streetMulti) {
    const s0 = streetBareName(locTrip[1]);
    const s1 = clean(locTrip[2]);
    const s2 = clean(locTrip[3]);
    const cityOk = s2 && !looksLikeStreetName(s2) && !looksLikeRoadNumberToken(s2);
    const midOk = s1 && (!looksLikeStreetName(s1) || /\s/.test(s1));
    if (cityOk && midOk) {
      out.street = s0;
      out.cityPart = s1;
      if (!out.city) out.city = s2;
    }
  }

  if (!out.city) {
    const cityHint = text.match(
      /,\s*([A-ZÁ-Ž][\p{L}\-]+(?:\s+[A-ZÁ-Ž][\p{L}\-]+)?)\s*,\s*okr\./u
    );
    if (cityHint && !looksLikeStreetName(cityHint[1])) out.city = clean(cityHint[1]);
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

  // Parking occupancy / facility status — before generic omezeni/warning fallback.
  // False-positive road events that only mention parking are excluded inside the helper.
  if (isParkingOccupancySituation(input, facts)) {
    const meta = { ...EVENT_KIND_META[EVENT_KIND.PARKING] };
    meta.titleCs = "PARKOVIŠTĚ";
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
    return resolveParkingLiveStatus(input, facts).collapsedText;
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

  let city = structured || fromComment || parkingCity || "";
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
  if (!structured && looksLikeStreetName(city)) return null;
  if (street && samePlaceName(city, street)) return null;
  if (cityPart && samePlaceName(city, cityPart)) return null;
  if (facts.streetMulti && looksLikeStreetName(city)) return null;
  return city;
}

/**
 * Locality header parts: [municipality sign] [road] [street/beside].
 * Preferred order: municipality → road number → "ulice: …" (SMV icon is first in UI when confirmed).
 */
export function buildLocalityHeaderModel(input = {}) {
  const facts = parseOfficialCommentFacts(sourceBlob(input));
  const road = clean(input.road);
  const municipalitySign = resolveMunicipalitySignName(input);
  const street = streetBareName(facts.street || input.streetHint || input.street);
  const location = clean(input.location);
  const district = clean(input.district) || facts.district || "";
  const cityPart = clean(facts.cityPart || input.cityPart);
  const registry = matchParkingRegistry({
    ...input,
    parkingName: facts.parkingName || input.parkingName,
  });
  const parkingName =
    (registry && registry.canonicalName) || facts.parkingName || null;
  const liveStatus = resolveParkingLiveStatus(input, facts);
  const parkingStatusLabel = liveStatus.statusLabel || formatParkingStatusLabel(facts);
  const streetMulti = facts.streetMulti === true;

  let besideLocality = "";
  let streetLabel = null;
  if (parkingName) {
    besideLocality = parkingName;
  } else if (streetMulti) {
    besideLocality = "více ulic";
    streetLabel = "více ulic";
  } else if (street) {
    streetLabel = "ulice: " + street;
    besideLocality = streetLabel;
  } else if (
    location &&
    !samePlaceName(location, municipalitySign) &&
    location !== road &&
    !looksLikeRoadNumberToken(location) &&
    !/^d\d/i.test(location) &&
    !/^p\s*\+\s*r\b/i.test(location) &&
    !samePlaceName(location, cityPart) &&
    !looksLikeStreetName(location)
  ) {
    besideLocality = location;
  } else if (
    location &&
    !samePlaceName(location, municipalitySign) &&
    location !== road &&
    !looksLikeRoadNumberToken(location) &&
    !/^d\d/i.test(location) &&
    !/^p\s*\+\s*r\b/i.test(location) &&
    !samePlaceName(location, cityPart) &&
    looksLikeStreetName(location)
  ) {
    streetLabel = "ulice: " + streetBareName(location);
    besideLocality = streetLabel;
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
    streetLabel: hdr.streetLabel,
    districtBeside: hdr.districtBeside,
    street: hdr.street || null,
    streetMulti: hdr.streetMulti === true,
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
  if (input.roadClassLabel) push("roadClass", "Třída komunikace", input.roadClassLabel);
  push("kilometer", "Kilometráž", facts.kilometerLabel || input.kilometer);
  push("direction", "Směr", clean(input.direction) || facts.directionHuman);
  push("street", "Ulice", facts.street || input.streetHint || input.street);
  push(
    "municipality",
    "Obec",
    input.municipality || facts.city || (registry ? registry.municipality : null)
  );
  push("cityPart", "Městská část", facts.cityPart || (registry ? registry.cityPart : null));
  push("district", "Okres", input.district || facts.district);
  push("location", "Lokalita", input.location);
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
  } else if (facts.parkingType === "P+G") {
    push("parkingType", "Typ parkoviště", "P+G");
  } else if (facts.parkingType === "PARKING_HOUSE") {
    push("parkingType", "Typ parkoviště", "Parkovací dům");
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
