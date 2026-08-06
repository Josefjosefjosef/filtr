#!/usr/bin/env node
/**
 * Traffic overview UI fixtures (synthetic only). Publication stays off.
 */
import {
  TRAFFIC_OVERVIEW_FLAGS,
  TRAFFIC_SPATIAL,
  TRAFFIC_TEMPORAL,
  TRAFFIC_TYPE,
  trafficProjectionToFeedItem,
  trafficBadgeModel,
  resolveSafeTrafficMapUrl,
  filterTrafficFeedItems,
  mergeTrafficIntoOverview,
  isRsdTrafficSourceEnabled,
  isDopravaTopicEnabled,
  scanTrafficUiCanaries,
  saveOfflineTrafficSnapshot,
  loadOfflineTrafficSnapshot,
  clearOfflineTrafficSnapshot,
  trafficItemsFromOfflineSnapshot,
  trafficHistoryLines,
  sanitizeTrafficPrefs,
} from "./../assets/iu-traffic-overview-v1.js";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

const PEID = "iu-te-" + "a".repeat(32);

function sampleCard(extra = {}) {
  return {
    publicEventId: PEID,
    lifecycleStatus: "ACTIVE",
    changeStatus: "NEW",
    eventType: "nehoda",
    category: "nehoda",
    severity: "high",
    road: "D0",
    kilometer: 12,
    section: null,
    direction: "POSITIVE",
    location: "D0",
    validity: {
      validFrom: "2026-08-06T08:00:00.000Z",
      expectedEnd: "2026-08-06T20:00:00.000Z",
      actualEnd: null,
    },
    impact: "Na místě je evidována nehoda.",
    freshness: "FRESH",
    source: "ŘSD/NDIC",
    mapTarget: {
      mapLinkType: "GENERAL_RSD_MAP",
      safeMapTarget: "https://www.dopravniinfo.cz/",
    },
    feed: {
      feedHeadline: "Nová nehoda na D0",
      feedChangeType: "EVENT_CREATED",
    },
    fieldProvenance: {},
    publicationEligibility: "ELIGIBLE_FOR_PUBLICATION",
    changeTimeSource: "EVENT_CHANGE",
    lastMeaningfulChangeAt: "2026-08-06T12:00:00.000Z",
    downloadedAt: "2026-08-06T11:00:00.000Z",
    ...extra,
  };
}

ok("flag_pub_off", TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === false);
ok("flag_api_off", TRAFFIC_OVERVIEW_FLAGS.PUBLIC_API_ENABLED === false);
ok("flag_live_off", TRAFFIC_OVERVIEW_FLAGS.LIVE_NDIC_INGEST === false);
ok("flag_no_home", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_HOME === false);
ok("flag_render_on", TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_CARDS_RENDER === true);

{
  const r = trafficProjectionToFeedItem(sampleCard());
  ok("proj_ok", r.ok === true);
  ok("proj_id", r.item.id === "ie-traffic-" + PEID);
  ok("proj_src", r.item.sourceId === "rsd");
  ok("proj_tv", !!r.item.trafficV1);
  ok("proj_pub_off", r.item.publicationEnabled === false);
  ok("proj_no_lcd", !/"locationCode"\s*:/.test(JSON.stringify(r.item)));
}

{
  const bad = trafficProjectionToFeedItem({ publicEventId: "raw-ndic-1" });
  ok("rej_bad_peid", bad.ok === false);
}

{
  const b = trafficBadgeModel(sampleCard().feed ? { feed: sampleCard().feed, category: "nehoda", lifecycleStatus: "ACTIVE" } : {});
  const card = sampleCard();
  const badge = trafficBadgeModel({
    feed: card.feed,
    category: card.category,
    lifecycleStatus: card.lifecycleStatus,
  });
  ok("badge_new", badge.text.indexOf("NOVÁ") >= 0);
  void b;
}

{
  ok(
    "map_ok",
    resolveSafeTrafficMapUrl({ mapLinkType: "GENERAL_RSD_MAP", safeMapTarget: "https://www.dopravniinfo.cz/" }).indexOf(
      "dopravniinfo.cz"
    ) >= 0
  );
  ok(
    "map_reject_http",
    resolveSafeTrafficMapUrl({ mapLinkType: "GENERAL_RSD_MAP", safeMapTarget: "http://dopravniinfo.cz/" }) === ""
  );
  ok(
    "map_reject_other",
    resolveSafeTrafficMapUrl({ mapLinkType: "OFFICIAL_EVENT", safeMapTarget: "https://evil.example/x" }) === ""
  );
  ok("map_none", resolveSafeTrafficMapUrl({ mapLinkType: "NONE", safeMapTarget: null }) === "");
}

{
  const item = trafficProjectionToFeedItem(sampleCard()).item;
  const prefs = sanitizeTrafficPrefs({
    trafficSpatialMode: TRAFFIC_SPATIAL.WHOLE_CZ,
    trafficTemporalFilter: TRAFFIC_TEMPORAL.NOW,
    trafficTypeFilter: TRAFFIC_TYPE.ACCIDENTS,
  });
  const filtered = filterTrafficFeedItems([item], prefs, { nowIso: "2026-08-06T13:00:00.000Z" });
  ok("filter_acc", filtered.length === 1);
  const prefs2 = sanitizeTrafficPrefs({ trafficTypeFilter: TRAFFIC_TYPE.CLOSURES });
  ok("filter_type_miss", filterTrafficFeedItems([item], prefs2, { nowIso: "2026-08-06T13:00:00.000Z" }).length === 0);
}

{
  const prefsSel = sanitizeTrafficPrefs({
    trafficSpatialMode: TRAFFIC_SPATIAL.MY_SELECTION,
    trafficMySelection: { roads: ["D0"], eventTypes: [], directions: [] },
    trafficTemporalFilter: TRAFFIC_TEMPORAL.NOW,
    trafficTypeFilter: TRAFFIC_TYPE.ALL,
  });
  const item = trafficProjectionToFeedItem(sampleCard()).item;
  ok("my_sel", filterTrafficFeedItems([item], prefsSel, { nowIso: "2026-08-06T13:00:00.000Z" }).length === 1);
  const prefsRoutes = sanitizeTrafficPrefs({
    trafficSpatialMode: TRAFFIC_SPATIAL.MY_ROUTES,
    trafficMyRoutes: [{ road: "D0", fromLabel: "A", toLabel: "B" }],
    trafficTemporalFilter: TRAFFIC_TEMPORAL.NOW,
  });
  ok("my_routes", filterTrafficFeedItems([item], prefsRoutes, { nowIso: "2026-08-06T13:00:00.000Z" }).length === 1);
}

{
  ok("rsd_all", isRsdTrafficSourceEnabled({ sourceIds: [], sourceGroups: [] }) === true);
  ok("rsd_rsd", isRsdTrafficSourceEnabled({ sourceIds: ["rsd"], sourceGroups: [] }) === true);
  ok("rsd_none", isRsdTrafficSourceEnabled({ sourceIds: ["__none__"], sourceGroups: [] }) === false);
  ok("topic_doprava", isDopravaTopicEnabled({ sections: ["doprava"] }) === true);
  ok("topic_none", isDopravaTopicEnabled({ sections: ["__none__"] }) === false);
}

{
  const snap = {
    schema: "iu-traffic-offline-snapshot-v1",
    generatedAt: "2026-08-06T12:00:00.000Z",
    sourceFreshness: "FRESH",
    publicationEnabled: false,
    cards: [sampleCard()],
  };
  // Node has no localStorage — exercise conversion path directly
  const items = trafficItemsFromOfflineSnapshot(snap, sanitizeTrafficPrefs({}), {
    nowIso: "2026-08-06T13:00:00.000Z",
  });
  ok("offline_items", items.length === 1 && items[0].trafficV1);
  const merged = mergeTrafficIntoOverview([{ id: "other", title: "X", publishedAt: "2026-08-06T10:00:00.000Z" }], {
    sections: ["doprava"],
    sourceIds: ["rsd"],
    trafficOfflineAware: true,
    trafficSpatialMode: "WHOLE_CZ",
    trafficTemporalFilter: "NOW",
    trafficTypeFilter: "ALL",
  }, { snapshot: snap, nowIso: "2026-08-06T13:00:00.000Z" });
  ok("merge_overview", merged.some((x) => x.trafficV1) && merged.some((x) => x.id === "other"));
  ok("no_separate_home", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_HOME === false);
}

{
  ok("canary_xml", scanTrafficUiCanaries({ x: "<Situation/>" }).ok === false);
  ok("canary_lcd", scanTrafficUiCanaries({ locationCode: "1" }).ok === false);
  ok("canary_clean", scanTrafficUiCanaries({ road: "D0" }).ok === true);
}

{
  const hist = trafficHistoryLines({ feed: { feedChangeType: "VALIDITY_EXTENDED" } });
  ok("hist_ext", hist[0] === "prodloužená");
}

{
  const ended = trafficProjectionToFeedItem(
    sampleCard({
      lifecycleStatus: "ENDED",
      feed: { feedHeadline: "Omezení ukončeno", feedChangeType: "EVENT_ENDED" },
    })
  );
  ok("ended_badge", trafficBadgeModel(ended.item.trafficV1).kind === "ended");
}

{
  const pubOn = { ...sampleCard(), publicationEnabled: true };
  // item builder forces publicationEnabled false on output; snapshot with publicationEnabled true rejected by merge path
  const merged = mergeTrafficIntoOverview([], { sections: ["doprava"], sourceIds: ["rsd"] }, {
    snapshot: { publicationEnabled: true, cards: [sampleCard()] },
    nowIso: "2026-08-06T13:00:00.000Z",
  });
  ok("reject_pub_snap", merged.length === 0);
  void pubOn;
}

// localStorage stubs for Node
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}
{
  clearOfflineTrafficSnapshot();
  const saved = saveOfflineTrafficSnapshot({
    publicationEnabled: false,
    cards: [sampleCard()],
    generatedAt: "2026-08-06T12:00:00.000Z",
    sourceFreshness: "FRESH",
  });
  ok("ls_save", saved.ok === true);
  ok("ls_load", !!loadOfflineTrafficSnapshot());
  ok("ls_reject_pub", saveOfflineTrafficSnapshot({ publicationEnabled: true, cards: [] }).ok === false);
  clearOfflineTrafficSnapshot();
  ok("ls_clear", loadOfflineTrafficSnapshot() === null);
}

const success = results.filter((r) => r.pass).length;
const failure = results.filter((r) => !r.pass).length;
const summary = {
  suite: "TRAFFIC_OVERVIEW_UI",
  TRAFFIC_UI_TEST_COUNT: results.length,
  TRAFFIC_UI_TEST_SUCCESS_COUNT: success,
  TRAFFIC_UI_TEST_FAILURE_COUNT: failure,
  TRAFFIC_UI_TEST_SKIPPED_COUNT: 0,
  fails,
  PUBLICATION_ENABLED: false,
  SEPARATE_TRAFFIC_HOME: false,
};
console.log(JSON.stringify(summary, null, 2));
process.exitCode = failure === 0 && success === results.length ? 0 : 1;
