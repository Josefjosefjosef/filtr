/**
 * NDIC DATEX II v1 adapter — public barrel (server-side only).
 */
export {
  getNdicDatexV1Config,
  shouldPublishNdic,
  shouldRunShadow,
  assertAllowedPullUrl,
  NDIC_SOURCE_ID,
  NDIC_ADAPTER_OWNER,
  NDIC_ID_PREFIX,
  NDIC_ATTRIBUTION_SHORT,
  NDIC_ATTRIBUTION_FULL,
  TMC_COUNTRY_CODE,
  TMC_LOCATION_TABLE_NUMBER,
  PARSER_VERSION,
} from "./config.mjs";

export { parseDatexSituationPublication } from "./parse-datex.mjs";
export { mapSituationRecordType, CATEGORY_MAP_VERSION } from "./category-map.mjs";
export { makeStableItemId, buildSituationIdentity, contentFingerprint } from "./identity.mjs";
export { classifyTrafficLifecycle, compareRevisions, classifyChangeSignificance } from "./lifecycle.mjs";
export {
  parseTmcTablePayload,
  validateTmcTable,
  activateTmcTable,
  rollbackTmcTable,
  emptyTmcStore,
  lookupTmcPoint,
  tmcPublicMeta,
} from "./tmc-table.mjs";
export { localizeFromTmc } from "./tmc-localize.mjs";
export { buildTrafficTitle, buildTrafficSummary, sanitizeTrafficComment, TRAFFIC_COMMENT_FULL_MAX, TRAFFIC_COMMENT_SUMMARY_MAX } from "./title.mjs";
export {
  situationToFeedItem,
  situationsToFeedItems,
  mergeNdicRevisions,
  applyNdicPublishGate,
  isPublishableNdicItem,
  loadNdicFirstSeenById,
} from "./normalize-feed.mjs";
export {
  extractRoadNumberFromNdicComment,
  classifyPublishDecision,
} from "./official-comment-road.mjs";
export {
  createFixtureDiscovery,
  createAuthenticatedPullDiscovery,
  resolveDiscoveryAdapter,
} from "./discovery-adapter.mjs";
export {
  processDatexBody,
  processAndGate,
  tryAcquireLock,
  releaseLock,
  applyConditionalResult,
  atomicPublishDecision,
  createSyncState,
  createLockState,
  sanityCheckSnapshot,
} from "./sync-core.mjs";
