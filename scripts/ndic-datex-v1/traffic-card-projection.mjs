/**
 * Internal traffic card projection (not live on web).
 */
import { PUBLICATION_LAYER_FLAGS } from "./traffic-publication-constants.mjs";

export function buildTrafficCardProjection(publicationProjection) {
  if (!publicationProjection || typeof publicationProjection !== "object") {
    return { ok: false };
  }
  const p = publicationProjection;
  const card = Object.freeze({
    schema: "iu-traffic-card-projection-v1",
    publicEventId: p.publicEventId,
    lifecycleStatus: p.lifecycleStatus,
    changeStatus: p.changeStatus,
    eventType: p.eventType,
    category: p.eventCategory,
    severity: p.severity,
    road: p.roadNumber,
    roadClass: p.roadClass || null,
    roadClassLabel: p.roadClassLabel || null,
    kilometer: p.kilometer,
    section: p.sectionLabel,
    direction: p.direction,
    location: p.locationLabel,
    municipality: p.municipality || null,
    district: p.district || null,
    validity: Object.freeze({
      validFrom: p.validFrom,
      expectedEnd: p.expectedEnd,
      actualEnd: p.actualEnd,
    }),
    validityLine: p.validityLine || null,
    impact: p.impactSummary,
    impactFull: p.impactFull || null,
    impactSource: p.impactSource || null,
    illustrationKey: p.illustrationKey || "neutral",
    freshness: p.freshnessStatus,
    source: p.sourceLabel,
    mapTarget: Object.freeze({
      mapLinkType: p.mapLinkType,
      safeMapTarget: p.safeMapTarget,
    }),
    feed: Object.freeze({
      feedHeadline: p.feedHeadline,
      feedChangeType: p.feedChangeType,
    }),
    fieldProvenance: p.fieldProvenance || {},
    publicationEligibility: p.publicationEligibility,
    publicationEnabled: false,
    liveCardEnabled: PUBLICATION_LAYER_FLAGS.TRAFFIC_CARDS_LIVE_ENABLED,
    locationPresentationLevel: p.locationPresentationLevel || null,
    subjectScopeVerified: p.subjectScopeVerified === true,
    preciseLocationVerified: p.preciseLocationVerified === true,
    subjectScopeKind: p.subjectScopeKind || null,
    subjectScopeLabel: p.subjectScopeLabel || null,
    locationDisclosureCs: p.locationDisclosureCs || null,
    routeMatchMode: p.routeMatchMode || null,
    lastMeaningfulChangeAt: p.lastMeaningfulChangeAt || null,
    changeTimeSource: p.changeTimeSource || null,
    timelineField: p.timelineField || null,
    downloadedAt: p.downloadedAt || null,
    sourceUpdatedAt: p.sourceUpdatedAt || null,
    measurementTime: p.measurementTime || null,
    delayAvailable: p.delayAvailable === true,
    delayMinutes: p.delayAvailable === true ? p.delayMinutes : null,
    stableSituationId: p.stableSituationId || null,
    stableRecordId: p.stableRecordId || null,
  });
  return { ok: true, card };
}
