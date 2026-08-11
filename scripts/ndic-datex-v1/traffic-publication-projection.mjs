/**
 * Allowlisted publication projection builder + structural canary scan.
 */
import {
  PUBLICATION_LAYER_FLAGS,
  PUBLIC_PROJECTION_ALLOWLIST,
  FORBIDDEN_PUBLIC_SUBSTRINGS,
  PUBLICATION_ERROR,
  PUBLICATION_ELIGIBILITY,
  LIFECYCLE_STATUS,
  CHANGE_STATUS,
  CONFIDENCE_CLASS,
  MAP_LINK_TYPE,
  METRIC_STATUS,
  GENERAL_RSD_MAP_URL,
  publicProvenance,
  FEED_CHANGE_TYPE,
} from "./traffic-publication-constants.mjs";
import { evaluatePublicationEligibility } from "./traffic-publication-eligibility.mjs";
import { buildPublicEventId } from "./traffic-public-event-id.mjs";
import { DIRECTION, FRESHNESS } from "./datex-tmc-resolver-constants.mjs";
import { EVENT_CHANGE_KIND } from "./traffic-event-aggregation-constants.mjs";
import {
  classifyLocationPresentation,
  LOCATION_PRESENTATION_LEVEL,
  SUBJECT_SCOPE_KIND,
} from "./traffic-location-presentation-policy.mjs";
import {
  chooseHumanLocality,
  chooseImpactTexts,
  formatValidityLineCs,
  humanDirectionOrNull,
  illustrationKeyForEventType,
  roadClassLabelCs,
} from "./traffic-card-content-v1.mjs";
import { TRAFFIC_COMMENT_FULL_MAX, TRAFFIC_COMMENT_SUMMARY_MAX } from "./title.mjs";

/** Short presentation summary on the card face. */
const MAX_SUMMARY = TRAFFIC_COMMENT_SUMMARY_MAX;
const MAX_LABEL = 120;
/** Full source-backed description — must not be reconstructed from MAX_SUMMARY. */
const MAX_FULL = TRAFFIC_COMMENT_FULL_MAX;
/** Short preview before "Více informací" (presentation only). */
const IMPACT_SHORT_MAX = 160;

function clip(s, n) {
  if (s == null) return null;
  const t = String(s);
  return t.length > n ? t.slice(0, n) : t;
}

function fv(ev, name) {
  return ev.fields && ev.fields[name] ? ev.fields[name] : null;
}

function mapDiffToFeedChange(changeKinds, prevStatus, nextStatus) {
  const kinds = new Set(changeKinds || []);
  if (kinds.has(EVENT_CHANGE_KIND.NEW_EVENT)) return FEED_CHANGE_TYPE.EVENT_CREATED;
  if (kinds.has(EVENT_CHANGE_KIND.STATUS_CANCELLED)) return FEED_CHANGE_TYPE.EVENT_CANCELLED;
  if (kinds.has(EVENT_CHANGE_KIND.STATUS_ENDED)) return FEED_CHANGE_TYPE.EVENT_ENDED;
  if (prevStatus === "ukonceno" && nextStatus === "aktivni") return FEED_CHANGE_TYPE.EVENT_REOPENED;
  if (kinds.has(EVENT_CHANGE_KIND.START_TIME_CHANGED)) return FEED_CHANGE_TYPE.VALIDITY_START_CHANGED;
  if (kinds.has(EVENT_CHANGE_KIND.END_TIME_CHANGED)) {
    // extended vs shortened decided by caller via opts
    return FEED_CHANGE_TYPE.VALIDITY_EXTENDED;
  }
  if (kinds.has(EVENT_CHANGE_KIND.SEVERITY_CHANGED)) return FEED_CHANGE_TYPE.SEVERITY_CHANGED;
  if (kinds.has(EVENT_CHANGE_KIND.DIRECTION_CHANGED)) return FEED_CHANGE_TYPE.DIRECTION_CHANGED;
  if (kinds.has(EVENT_CHANGE_KIND.ROAD_CHANGED)) return FEED_CHANGE_TYPE.ROAD_CHANGED;
  if (kinds.has(EVENT_CHANGE_KIND.SEGMENT_CHANGED)) return FEED_CHANGE_TYPE.SECTION_CHANGED;
  if (kinds.has(EVENT_CHANGE_KIND.DESCRIPTION_CHANGED)) return FEED_CHANGE_TYPE.IMPACT_CHANGED;
  if (kinds.has(EVENT_CHANGE_KIND.EVENT_UPDATED)) return FEED_CHANGE_TYPE.EVENT_UPDATED;
  return FEED_CHANGE_TYPE.EVENT_UPDATED;
}

export function deriveLifecycleStatus(event, nowIso) {
  const status = fv(event, "status") && fv(event, "status").value;
  if (status === "zruseno") return LIFECYCLE_STATUS.CANCELLED;
  if (status === "ukonceno") return LIFECYCLE_STATUS.ENDED;
  const now = Date.parse(nowIso || new Date().toISOString());
  const to =
    (fv(event, "validTo") && fv(event, "validTo").value) ||
    (fv(event, "expectedEnd") && fv(event, "expectedEnd").value) ||
    null;
  const toMs = to ? Date.parse(to) : NaN;
  // Align with classifyTrafficLifecycle: validity end strictly before now ⇒ ENDED.
  if (Number.isFinite(toMs) && toMs < now) return LIFECYCLE_STATUS.ENDED;
  const from = fv(event, "validFrom") && fv(event, "validFrom").value;
  if (from && Date.parse(from) > now) return LIFECYCLE_STATUS.FUTURE;
  return LIFECYCLE_STATUS.ACTIVE;
}

export function deriveChangeStatus(feedChangeType) {
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_CREATED) return CHANGE_STATUS.NEW;
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_ENDED) return CHANGE_STATUS.ENDED;
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_CANCELLED) return CHANGE_STATUS.CANCELLED;
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_REOPENED) return CHANGE_STATUS.REOPENED;
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_UPDATED || String(feedChangeType).includes("CHANGED") || String(feedChangeType).includes("EXTENDED") || String(feedChangeType).includes("SHORTENED")) {
    return CHANGE_STATUS.CHANGED;
  }
  return CHANGE_STATUS.UNCHANGED;
}

export function buildImpactSummary(event, feedChangeType) {
  const cat = String((fv(event, "trafficCategory") && fv(event, "trafficCategory").value) || "").toLowerCase();
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_ENDED) return "Událost byla ukončena.";
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_CANCELLED) return "Událost byla zrušena.";
  if (feedChangeType === FEED_CHANGE_TYPE.VALIDITY_EXTENDED) return "Očekávaný konec byl prodloužen.";
  if (feedChangeType === FEED_CHANGE_TYPE.VALIDITY_SHORTENED) return "Očekávaný konec byl zkrácen.";
  if (/uzavir|closure/.test(cat)) return "Silnice je dočasně uzavřena.";
  if (/omezen|restrict/.test(cat)) return "Provoz omezen v jednom směru.";
  if (/prace|roadwork|works/.test(cat)) return "Probíhají práce na silnici.";
  if (/nehod|accident/.test(cat)) return "Na místě je evidována nehoda.";
  return "Dopravní událost je evidována.";
}

export function buildFeedHeadline(feedChangeType, event, locationPrecise, presentation = null) {
  const cat = String((fv(event, "trafficCategory") && fv(event, "trafficCategory").value) || "").toLowerCase();
  let road = null;
  if (locationPrecise) {
    const rn = fv(event, "roadNumber");
    if (rn && rn.validationStatus === "validated" && rn.value) road = String(rn.value);
  } else if (
    presentation &&
    presentation.locationPresentationLevel === LOCATION_PRESENTATION_LEVEL.SCOPED &&
    presentation.subjectScopeKind === SUBJECT_SCOPE_KIND.ROAD &&
    presentation.subjectScopeLabel
  ) {
    road = String(presentation.subjectScopeLabel);
  }
  const loc = road ? ("na " + road) : "v evidované oblasti";
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_CREATED && /nehod|accident/.test(cat)) return clip("Nová nehoda " + loc, MAX_LABEL);
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_CREATED && /prace|roadwork|works/.test(cat)) return clip("Nové práce " + loc, MAX_LABEL);
  if (feedChangeType === FEED_CHANGE_TYPE.VALIDITY_EXTENDED && /uzavir|closure|omezen/.test(cat)) return clip("Uzavírka " + loc + " prodloužena", MAX_LABEL);
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_ENDED) return clip("Omezení " + loc + " ukončeno", MAX_LABEL);
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_CANCELLED) return clip("Událost " + loc + " zrušena", MAX_LABEL);
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_CREATED) return clip("Nová dopravní událost " + loc, MAX_LABEL);
  if (feedChangeType === FEED_CHANGE_TYPE.EVENT_REOPENED) return clip("Událost " + loc + " znovu aktivní", MAX_LABEL);
  return clip("Změna dopravní události " + loc, MAX_LABEL);
}

export function resolveMapTarget(event, locationPrecise, opts = {}) {
  if (opts.officialEventUrl && typeof opts.officialEventUrl === "string" && /^https:\/\/www\.dopravniinfo\.cz\//.test(opts.officialEventUrl)) {
    return {
      mapLinkType: MAP_LINK_TYPE.OFFICIAL_EVENT,
      safeMapTarget: opts.officialEventUrl.slice(0, 500),
    };
  }
  if (locationPrecise) {
    const coords = fv(event, "coordinates");
    if (coords && coords.validationStatus === "validated" && coords.value && typeof coords.value.lat === "number") {
      // Do not invent deep-link query params; verified location → official portal.
      return {
        mapLinkType: MAP_LINK_TYPE.VERIFIED_LOCATION,
        safeMapTarget: GENERAL_RSD_MAP_URL,
      };
    }
    return {
      mapLinkType: MAP_LINK_TYPE.VERIFIED_LOCATION,
      safeMapTarget: GENERAL_RSD_MAP_URL,
    };
  }
  // SCOPED / GENERAL / NONE → general ŘSD map (never fake centering).
  if (opts.allowGeneralMap !== false) {
    return {
      mapLinkType: MAP_LINK_TYPE.GENERAL_RSD_MAP,
      safeMapTarget: GENERAL_RSD_MAP_URL,
    };
  }
  return { mapLinkType: MAP_LINK_TYPE.NONE, safeMapTarget: null };
}

/**
 * Security canary scan over a projection object.
 */
export function scanPublicationCanaries(obj) {
  const s = JSON.stringify(obj);
  const hits = [];
  for (const needle of FORBIDDEN_PUBLIC_SUBSTRINGS) {
    if (s.includes(needle)) hits.push(needle);
  }
  // Raw LCD-like field name
  if (/"locationCode"\s*:/.test(s)) hits.push("locationCode_field");
  if (/At line:/.test(s) || /Error:\s/.test(s)) hits.push("stack_or_error");
  if (/IU_NDIC_PULL_PASS|Basic\s+[A-Za-z0-9+/=]{8,}/.test(s)) hits.push("credential");
  return { ok: hits.length === 0, hits };
}

/**
 * Validate projection keys against allowlist (additionalProperties: false).
 */
export function validateProjectionAllowlist(proj) {
  const unknown = [];
  for (const k of Object.keys(proj || {})) {
    if (!PUBLIC_PROJECTION_ALLOWLIST.includes(k)) unknown.push(k);
  }
  return { ok: unknown.length === 0, unknown };
}

/**
 * Build one publication projection (still unpublished).
 */
export function buildTrafficPublicationProjection(event, opts = {}) {
  if (PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === true) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_ENABLED_FORBIDDEN };
  }
  if (!event || typeof event !== "object") {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_INPUT_INVALID };
  }

  const elig = evaluatePublicationEligibility(event, opts.eligibilityOpts || {});
  if (elig.eligibility !== PUBLICATION_ELIGIBILITY.ELIGIBLE_FOR_PUBLICATION) {
    return {
      ok: false,
      rejectCode: PUBLICATION_ERROR.PUB_INELIGIBLE,
      eligibility: elig.eligibility,
      reasons: elig.reasons,
    };
  }

  const nowIso = opts.nowIso || new Date().toISOString();
  const diff = opts.diff || { changeKinds: [EVENT_CHANGE_KIND.NEW_EVENT], meaningful: true };
  let feedChangeType = mapDiffToFeedChange(diff.changeKinds, opts.prevStatus, fv(event, "status") && fv(event, "status").value);
  if (opts.forceFeedChangeType) feedChangeType = opts.forceFeedChangeType;
  if (feedChangeType === FEED_CHANGE_TYPE.VALIDITY_EXTENDED && opts.validityDelta === "shortened") {
    feedChangeType = FEED_CHANGE_TYPE.VALIDITY_SHORTENED;
  }

  const lifecycleStatus = deriveLifecycleStatus(event, nowIso);
  const changeStatus = deriveChangeStatus(feedChangeType);
  const publicEventId = buildPublicEventId(event.eventIdHash);
  const locationPrecise = elig.locationPreciseAllowed === true;
  const presentation = classifyLocationPresentation(event, elig);

  const ts = event.sourceTimestamps || {};
  let lastMeaningful = fv(event, "lastMeaningfulChangeAt") && fv(event, "lastMeaningfulChangeAt").value;
  let changeTimeSource =
    (fv(event, "changeTimeSource") && fv(event, "changeTimeSource").value) || "EVENT_CHANGE";
  let timelineField = (fv(event, "timelineField") && fv(event, "timelineField").value) || null;
  if (!lastMeaningful) {
    lastMeaningful = ts.datexUpdatedAt || ts.datexCreatedAt || ts.datexDownloadedAt || null;
    if (ts.datexUpdatedAt) {
      changeTimeSource = "EVENT_CHANGE";
      timelineField = timelineField || "situationRecordVersionTime";
    } else if (ts.datexCreatedAt) {
      changeTimeSource = "EVENT_CHANGE";
      timelineField = timelineField || "situationRecordCreationTime";
    } else {
      changeTimeSource = lastMeaningful ? "DOWNLOAD_FALLBACK" : "UNKNOWN";
      timelineField = lastMeaningful ? "datexDownloadedAt" : null;
    }
  }

  // Provenance map (only for included fields)
  const fieldProvenance = Object.create(null);
  const putProv = (key, field, confidence) => {
    if (!field) return null;
    const p = publicProvenance(
      field.value,
      field.source,
      field.sourceUpdatedAt || ts.datexUpdatedAt || null,
      lastMeaningful,
      field.validationStatus,
      confidence
    );
    fieldProvenance[key] = p;
    return p;
  };

  // Precise geo fields only when precise; scoped may publish subject road/admin without km/dir.
  const roadNumber =
    presentation.showPreciseGeoFields && fv(event, "roadNumber") && fv(event, "roadNumber").validationStatus === "validated"
      ? putProv("roadNumber", fv(event, "roadNumber"), CONFIDENCE_CLASS.VERIFIED_RESOLVED_BASIC)
      : presentation.locationPresentationLevel === LOCATION_PRESENTATION_LEVEL.SCOPED &&
          presentation.subjectScopeKind === SUBJECT_SCOPE_KIND.ROAD &&
          fv(event, "roadNumber") &&
          fv(event, "roadNumber").validationStatus === "validated"
        ? putProv("roadNumber", fv(event, "roadNumber"), CONFIDENCE_CLASS.VERIFIED_SOURCE_FIELD)
        : null;

  const directionField = fv(event, "direction");
  const directionRaw =
    presentation.showPreciseGeoFields &&
    directionField &&
    directionField.validationStatus === "validated" &&
    directionField.value !== DIRECTION.UNKNOWN &&
    directionField.value !== DIRECTION.CONFLICT
      ? directionField.value
      : null;
  const directionHuman = humanDirectionOrNull(directionRaw);
  const direction = directionHuman
    ? putProv("direction", { ...directionField, value: directionHuman }, CONFIDENCE_CLASS.VERIFIED_RESOLVED_BASIC)
    : null;

  const roadClassField = fv(event, "roadClass");
  const roadClass =
    roadClassField && roadClassField.validationStatus === "validated" && roadClassField.value
      ? putProv("roadClass", roadClassField, CONFIDENCE_CLASS.VERIFIED_DERIVED_DIFF)
      : null;

  const municipalityField = fv(event, "municipality");
  const municipality =
    municipalityField && municipalityField.validationStatus === "validated" && municipalityField.value
      ? putProv("municipality", municipalityField, CONFIDENCE_CLASS.VERIFIED_SOURCE_FIELD)
      : null;

  const districtField = fv(event, "district");
  const district =
    districtField && districtField.validationStatus === "validated" && districtField.value
      ? putProv("district", districtField, CONFIDENCE_CLASS.VERIFIED_SOURCE_FIELD)
      : null;

  const administrativeArea =
    presentation.showPreciseGeoFields &&
    fv(event, "administrativeArea") &&
    fv(event, "administrativeArea").validationStatus === "validated"
      ? putProv("administrativeArea", fv(event, "administrativeArea"), CONFIDENCE_CLASS.VERIFIED_RESOLVED_BASIC)
      : presentation.locationPresentationLevel === LOCATION_PRESENTATION_LEVEL.SCOPED &&
          presentation.subjectScopeKind === SUBJECT_SCOPE_KIND.ADMIN_AREA &&
          fv(event, "administrativeArea") &&
          fv(event, "administrativeArea").validationStatus === "validated"
        ? putProv("administrativeArea", fv(event, "administrativeArea"), CONFIDENCE_CLASS.VERIFIED_SOURCE_FIELD)
        : municipality
          ? municipality
          : null;

  // Coordinates: never emit into projection; map uses link type only
  let coordinatesPublished = false;
  void coordinatesPublished;

  const kilometer =
    presentation.showPreciseGeoFields &&
    fv(event, "kilometer") &&
    fv(event, "kilometer").validationStatus === "validated"
      ? putProv("kilometer", fv(event, "kilometer"), CONFIDENCE_CLASS.VERIFIED_SOURCE_FIELD)
      : null;

  // Metric fields — never estimate
  const delayStatus = opts.delayProven === true ? METRIC_STATUS.PROVEN : METRIC_STATUS.NOT_AVAILABLE;
  const delayMinutes = delayStatus === METRIC_STATUS.PROVEN && typeof opts.delayMinutes === "number" ? opts.delayMinutes : null;
  if (opts.attemptDelayEstimate === true) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_FORBIDDEN_FIELD, reasons: ["delay_estimation_forbidden"] };
  }

  const map = resolveMapTarget(event, locationPrecise, opts);
  const summaryShort =
    (fv(event, "summarySafe") && fv(event, "summarySafe").value) || "";
  const summaryFullRaw =
    (fv(event, "summaryFull") && fv(event, "summaryFull").value) || "";
  // Never reconstruct impactFull from a presentation summary that already ends with
  // our truncation ellipsis (…); that would pretend a clipped summary is the source full text.
  const summaryShortLooksTruncated = /…$|\.\.\.$/.test(String(summaryShort));
  const officialFull = String(
    summaryFullRaw || (!summaryShortLooksTruncated ? summaryShort : "") || ""
  ).trim();
  const templateImpact = buildImpactSummary(event, feedChangeType);
  const impactTexts = chooseImpactTexts(officialFull, templateImpact, IMPACT_SHORT_MAX);
  const feedHeadline = buildFeedHeadline(feedChangeType, event, locationPrecise, presentation);

  putProv("status", fv(event, "status"), CONFIDENCE_CLASS.VERIFIED_SOURCE_FIELD);
  putProv("trafficCategory", fv(event, "trafficCategory"), CONFIDENCE_CLASS.VERIFIED_SOURCE_FIELD);

  // Freshness may be UNKNOWN internally; UI must not print "Čerstvost: UNKNOWN".
  const freshnessStatus = (fv(event, "freshness") && fv(event, "freshness").value) || FRESHNESS.UNKNOWN;

  const humanLoc = chooseHumanLocality({
    locationLabel: presentation.showPreciseGeoFields
      ? presentation.presentationRoad || presentation.presentationAdminArea
      : presentation.locationPresentationLevel === LOCATION_PRESENTATION_LEVEL.SCOPED
        ? presentation.subjectScopeLabel
        : null,
    roadNumber: roadNumber ? roadNumber.value : null,
    summary: officialFull || summaryShort,
    subjectScopeLabel: presentation.subjectScopeLabel,
  });

  const locationLabel = humanLoc;

  const validFromVal = fv(event, "validFrom") ? fv(event, "validFrom").value : null;
  const validToVal = fv(event, "validTo") ? fv(event, "validTo").value : null;
  const validityLine = formatValidityLineCs(validFromVal, validToVal, false);
  const eventTypeVal = fv(event, "trafficCategory") ? fv(event, "trafficCategory").value : null;
  const identity = event.stableIdentity || {};
  const delayAvailable = delayStatus === METRIC_STATUS.PROVEN && delayMinutes != null;

  const proj = {
    schema: "iu-traffic-publication-projection-v1",
    publicEventId,
    lifecycleStatus,
    changeStatus,
    eventType: eventTypeVal,
    eventCategory: eventTypeVal,
    severity: fv(event, "severity") && fv(event, "severity").value
      ? fv(event, "severity").value
      : fv(event, "trafficSeverity")
        ? fv(event, "trafficSeverity").value
        : null,
    roadNumber: roadNumber ? roadNumber.value : null,
    roadName: null,
    roadClass: roadClass ? roadClass.value : null,
    roadClassLabel: roadClass ? roadClassLabelCs(roadClass.value) : null,
    kilometer: kilometer ? kilometer.value : null,
    sectionLabel: opts.sectionLabel && presentation.showPreciseGeoFields ? clip(opts.sectionLabel, MAX_LABEL) : null,
    direction: direction ? direction.value : null,
    locationLabel,
    administrativeArea: administrativeArea ? administrativeArea.value : null,
    municipality: municipality ? municipality.value : null,
    district: district ? district.value : null,
    validFrom: validFromVal,
    expectedEnd: validToVal,
    actualEnd: lifecycleStatus === LIFECYCLE_STATUS.ENDED ? validToVal : null,
    impactSummary: clip(impactTexts.impactShort, MAX_SUMMARY),
    impactFull: impactTexts.impactFull ? clip(impactTexts.impactFull, MAX_FULL) : null,
    impactSource: impactTexts.impactSource,
    validityLine,
    illustrationKey: illustrationKeyForEventType(eventTypeVal),
    lastMeaningfulChangeAt: lastMeaningful,
    changeTimeSource,
    timelineField,
    measurementTime: ts.datexMeasuredAt || null,
    sourceUpdatedAt: ts.datexUpdatedAt || lastMeaningful || null,
    downloadedAt: ts.datexDownloadedAt || null,
    publishedSnapshotAt: null,
    freshnessStatus,
    sourceLabel: "ŘSD/NDIC",
    mapLinkType: map.mapLinkType,
    safeMapTarget: map.safeMapTarget,
    feedHeadline,
    feedChangeType,
    delayStatus,
    delayMinutes,
    delayAvailable,
    queueLengthStatus: opts.queueProven === true ? METRIC_STATUS.PROVEN : METRIC_STATUS.NOT_AVAILABLE,
    queueLengthMeters: opts.queueProven === true && typeof opts.queueLengthMeters === "number" ? opts.queueLengthMeters : null,
    speedStatus: opts.speedProven === true ? METRIC_STATUS.PROVEN : METRIC_STATUS.NOT_AVAILABLE,
    speedKmh: opts.speedProven === true && typeof opts.speedKmh === "number" ? opts.speedKmh : null,
    travelTimeStatus: opts.travelTimeProven === true ? METRIC_STATUS.PROVEN : METRIC_STATUS.NOT_AVAILABLE,
    travelTimeMinutes: opts.travelTimeProven === true && typeof opts.travelTimeMinutes === "number" ? opts.travelTimeMinutes : null,
    fieldProvenance,
    publicationEligibility: elig.eligibility,
    publicationEnabled: false,
    locationPresentationLevel: presentation.locationPresentationLevel,
    subjectScopeVerified: presentation.subjectScopeVerified,
    preciseLocationVerified: presentation.preciseLocationVerified,
    subjectScopeKind: presentation.subjectScopeKind,
    subjectScopeLabel: presentation.subjectScopeLabel,
    locationDisclosureCs: presentation.locationDisclosureCs,
    routeMatchMode: presentation.routeMatchMode,
    stableSituationId: identity.situationId || null,
    stableRecordId: identity.recordId || null,
  };

  // Reject invalid metric numbers
  if (proj.speedStatus === METRIC_STATUS.PROVEN && (proj.speedKmh < 0 || proj.speedKmh > 300 || !Number.isFinite(proj.speedKmh))) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_SCHEMA_VIOLATION, reasons: ["invalid_speed"] };
  }

  const allow = validateProjectionAllowlist(proj);
  if (!allow.ok) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_ALLOWLIST_VIOLATION, unknown: allow.unknown };
  }

  const canary = scanPublicationCanaries(proj);
  if (!canary.ok) {
    return { ok: false, rejectCode: PUBLICATION_ERROR.PUB_SECURITY_CANARY_DETECTED, hits: canary.hits };
  }

  return {
    ok: true,
    projection: Object.freeze(proj),
    eligibility: elig,
    publicationEnabled: false,
    published: false,
  };
}
