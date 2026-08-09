/**
 * Strict schemas for publication projections (additionalProperties: false).
 */
import {
  PUBLIC_PROJECTION_ALLOWLIST,
  LIFECYCLE_STATUS,
  CHANGE_STATUS,
  FEED_CHANGE_TYPE,
  MAP_LINK_TYPE,
  METRIC_STATUS,
} from "./traffic-publication-constants.mjs";

const LIFE = new Set(Object.values(LIFECYCLE_STATUS));
const CHG = new Set(Object.values(CHANGE_STATUS));
const FEED = new Set(Object.values(FEED_CHANGE_TYPE));
const MAP = new Set(Object.values(MAP_LINK_TYPE));
const MET = new Set(Object.values(METRIC_STATUS));

function isIsoOrNull(v) {
  if (v == null) return true;
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) && v.length <= 40;
}

function isStrOrNull(v, max) {
  if (v == null) return true;
  return typeof v === "string" && v.length <= max;
}

export function validateProjectionSchema(proj) {
  const errors = [];
  if (!proj || typeof proj !== "object") return { ok: false, errors: ["not_object"] };
  for (const k of Object.keys(proj)) {
    if (!PUBLIC_PROJECTION_ALLOWLIST.includes(k)) errors.push("unknown:" + k);
  }
  if (proj.schema !== "iu-traffic-publication-projection-v1") errors.push("schema");
  if (!isStrOrNull(proj.publicEventId, 64) || !proj.publicEventId || !/^iu-te-[a-f0-9]{32}$/.test(proj.publicEventId)) {
    errors.push("publicEventId");
  }
  if (!LIFE.has(proj.lifecycleStatus)) errors.push("lifecycleStatus");
  if (!CHG.has(proj.changeStatus)) errors.push("changeStatus");
  if (!FEED.has(proj.feedChangeType)) errors.push("feedChangeType");
  if (!MAP.has(proj.mapLinkType)) errors.push("mapLinkType");
  if (!isStrOrNull(proj.impactSummary, 280)) errors.push("impactSummary");
  if (!isStrOrNull(proj.feedHeadline, 120)) errors.push("feedHeadline");
  if (!isIsoOrNull(proj.validFrom)) errors.push("validFrom");
  if (!isIsoOrNull(proj.expectedEnd)) errors.push("expectedEnd");
  if (!isIsoOrNull(proj.lastMeaningfulChangeAt)) errors.push("lastMeaningfulChangeAt");
  if (proj.publicationEnabled !== false) errors.push("publicationEnabled");
  if (proj.delayStatus && !MET.has(proj.delayStatus)) errors.push("delayStatus");
  if (typeof proj.fieldProvenance !== "object" || proj.fieldProvenance == null) errors.push("fieldProvenance");
  if (proj.locationPresentationLevel != null) {
    const levels = new Set(["PRECISE", "SCOPED", "GENERAL", "NONE"]);
    if (!levels.has(proj.locationPresentationLevel)) errors.push("locationPresentationLevel");
  }
  if (proj.preciseLocationVerified === true && proj.kilometer === 0 && proj.roadNumber == null) {
    // allow km 0 only with verified road context — otherwise suspicious
  }
  if (proj.preciseLocationVerified !== true) {
    if (proj.kilometer != null) errors.push("unverified_km");
    if (proj.direction != null) errors.push("unverified_direction");
  }
  return { ok: errors.length === 0, errors };
}

export function validateFeedItemSchema(item) {
  const errors = [];
  if (!item || item.schema !== "iu-traffic-feed-item-v1") errors.push("schema");
  if (!item.publicEventId) errors.push("publicEventId");
  if (!FEED.has(item.feedChangeType)) errors.push("feedChangeType");
  if (item.published === true || item.publicationEnabled === true) errors.push("published");
  if (!isStrOrNull(item.feedHeadline, 120)) errors.push("feedHeadline");
  return { ok: errors.length === 0, errors };
}

export function validateCardSchema(card) {
  const errors = [];
  if (!card || card.schema !== "iu-traffic-card-projection-v1") errors.push("schema");
  if (!card.publicEventId) errors.push("publicEventId");
  if (card.publicationEnabled !== false) errors.push("publicationEnabled");
  if (card.liveCardEnabled === true) errors.push("liveCardEnabled");
  return { ok: errors.length === 0, errors };
}

export function validateHistoryItemSchema(item) {
  const errors = [];
  if (!item || item.schema !== "iu-traffic-history-item-v1") errors.push("schema");
  if (!FEED.has(item.changeType)) errors.push("changeType");
  if (!item.publicEventId) errors.push("publicEventId");
  return { ok: errors.length === 0, errors };
}

export function validatePublicationSchemas(bundle) {
  const errors = [];
  for (const p of bundle.projections || []) {
    const r = validateProjectionSchema(p);
    if (!r.ok) errors.push(...r.errors.map((e) => "proj:" + e));
  }
  for (const i of (bundle.feed && bundle.feed.items) || []) {
    const r = validateFeedItemSchema(i);
    if (!r.ok) errors.push(...r.errors.map((e) => "feed:" + e));
  }
  for (const c of bundle.cards || []) {
    const r = validateCardSchema(c);
    if (!r.ok) errors.push(...r.errors.map((e) => "card:" + e));
  }
  for (const h of bundle.historyItems || []) {
    const r = validateHistoryItemSchema(h);
    if (!r.ok) errors.push(...r.errors.map((e) => "hist:" + e));
  }
  return { ok: errors.length === 0, errors };
}

/** Contract: schemas forbid additionalProperties */
export const SCHEMA_CONTRACT = Object.freeze({
  additionalProperties: false,
  maxLengthImpact: 280,
  maxLengthHeadline: 120,
  publicEventIdPattern: "^iu-te-[a-f0-9]{32}$",
});
