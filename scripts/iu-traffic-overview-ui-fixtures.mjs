#!/usr/bin/env node
/**
 * Final traffic integration fixtures — shared settings/localities/timeline only.
 */
import {
  TRAFFIC_OVERVIEW_FLAGS,
  TRAFFIC_UI_INITIAL_CARD_CAP,
  TRAFFIC_SPATIAL,
  trafficProjectionToFeedItem,
  trafficBadgeModel,
  resolveSafeTrafficMapUrl,
  collectOfflineTrafficCandidates,
  mergeTrafficIntoOverview,
  isRsdTrafficSourceEnabled,
  isDopravaTopicEnabled,
  scanTrafficUiCanaries,
  saveOfflineTrafficSnapshot,
  loadOfflineTrafficSnapshot,
  clearOfflineTrafficSnapshot,
  trafficItemsFromOfflineSnapshot,
  trafficHistoryLines,
  deriveSpatialModeFromSharedPrefs,
  trafficIntegrationArchitectureAudit,
} from "../assets/iu-traffic-overview-v1.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
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
    location: "D0",
    administrativeArea: null,
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

const arch = trafficIntegrationArchitectureAudit();
ok("arch_pass", arch.pass === true);
ok("flag_pub_off", TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === false);
ok("flag_ui_on", TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_UI_ENABLED === true);
ok("flag_cards_render", TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_CARDS_RENDER === true);
ok("flag_no_home", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_HOME === false);
ok("flag_no_settings", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_SETTINGS === false);
ok("flag_no_filters", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_FILTERS === false);
ok("flag_no_locs", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_LOCALITIES === false);

{
  const r = trafficProjectionToFeedItem(sampleCard());
  ok("proj_ok", r.ok === true);
  ok("proj_shared_region", !!(r.item.region && r.item.region.name));
  ok("proj_section", r.item.sectionId === "doprava" && r.item.sourceGroup === "doprava");
  ok("proj_pub_off", r.item.publicationEnabled === false);
}

{
  const scoped = sampleCard({
    kilometer: 12,
    direction: "positive",
    preciseLocationVerified: false,
    subjectScopeVerified: true,
    locationPresentationLevel: "SCOPED",
    subjectScopeKind: "ROAD",
    subjectScopeLabel: "D0",
    locationDisclosureCs:
      "Týká se komunikace D0. Přesná poloha není v oficiálních datech jednoznačně určena.",
    routeMatchMode: "SCOPE_ONLY",
  });
  const r = trafficProjectionToFeedItem(scoped);
  ok("scoped_ui_ok", r.ok === true);
  ok("scoped_ui_no_km", r.item.trafficV1.kilometer == null);
  ok("scoped_ui_no_dir", r.item.trafficV1.direction == null);
  ok("scoped_ui_level", r.item.trafficV1.locationPresentationLevel === "SCOPED");
  ok("scoped_ui_disclosure", /Týká se komunikace D0/.test(r.item.trafficV1.locationDisclosureCs || ""));
  ok(
    "scoped_map_general",
    resolveSafeTrafficMapUrl(r.item.trafficV1.mapTarget).includes("dopravniinfo.cz")
  );
}

{
  const future = trafficBadgeModel({ lifecycleStatus: "FUTURE", feed: { feedChangeType: "EVENT_CREATED" } });
  ok("badge_future", future.text === "BUDOUCÍ");
}

ok("derive_whole", deriveSpatialModeFromSharedPrefs({}) === TRAFFIC_SPATIAL.WHOLE_CZ);
ok(
  "derive_near",
  deriveSpatialModeFromSharedPrefs({ homeKraj: "Středočeský kraj" }) === TRAFFIC_SPATIAL.NEAR_ME
);
ok(
  "derive_sel",
  deriveSpatialModeFromSharedPrefs({ favoritesOnly: true }) === TRAFFIC_SPATIAL.MY_SELECTION
);

{
  const snap = {
    publicationEnabled: false,
    generatedAt: "2026-08-06T12:00:00.000Z",
    sourceFreshness: "FRESH",
    cards: [sampleCard()],
  };
  const cands = collectOfflineTrafficCandidates(
    { sections: ["doprava"], sourceIds: ["rsd"] },
    { snapshot: snap, nowIso: "2026-08-06T13:00:00.000Z" }
  );
  ok("collect_ok", cands.length === 1);
  const blocked = collectOfflineTrafficCandidates(
    { sections: ["__none__"], sourceIds: ["rsd"] },
    { snapshot: snap }
  );
  ok("collect_topic_gate", blocked.length === 0);
}

{
  const item = trafficProjectionToFeedItem(sampleCard()).item;
  const badge = trafficBadgeModel(item.trafficV1);
  ok("badge", /NOVÁ/.test(badge.text));
  ok("map_ok", resolveSafeTrafficMapUrl(item.trafficV1.mapTarget).includes("dopravniinfo.cz"));
  ok("hist", trafficHistoryLines({ feed: { feedChangeType: "VALIDITY_EXTENDED" } }).length === 0);
}

ok("rsd_on", isRsdTrafficSourceEnabled({ sourceIds: ["rsd"] }) === true);
ok("topic_on", isDopravaTopicEnabled({ sections: ["doprava"] }) === true);
ok("canary_xml", scanTrafficUiCanaries({ x: "<Situation/>" }).ok === false);

{
  const snap = { publicationEnabled: true, cards: [sampleCard()] };
  ok("reject_pub_snap", trafficItemsFromOfflineSnapshot(snap).length === 0);
}

// Static: no parallel settings UI
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-v1.css"), "utf8");
const core = fs.readFileSync(path.join(ROOT, "assets", "iu-info-system-core-v1.js"), "utf8");
ok("ui_no_traffic_prefs", !/data-iu-traffic-prefs/.test(ui) && !/data-iu-pd-sec=\"traffic-rsd\"/.test(ui));
ok("ui_no_traffic_spatial_act", !/traffic-spatial|traffic-temporal|traffic-type/.test(ui));
ok("ui_shared_filterEvents", /collectOfflineTrafficCandidates/.test(ui) && /filterEvents\(pipelineItems/.test(ui));
ok("ui_no_separate_home", !/data-iu-traffic-home/.test(ui));
ok("css_no_prefs_panel", !/\.iuPdTrafficPrefs\b/.test(css));
ok("core_no_parallel_prefs", !/trafficSpatialMode:\s*\"WHOLE_CZ\"/.test(core));
ok("core_strips_legacy", /delete merged\.trafficSpatialMode/.test(core));
ok("section_order_only_three", /SECTION_ORDER\s*=\s*\[\s*\"temata\",\s*\"zdroje\",\s*\"lokalita\"\s*\]/.test(ui));

if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}
clearOfflineTrafficSnapshot();
ok("ls_save", saveOfflineTrafficSnapshot({ publicationEnabled: false, trafficUiEnabled: true, cards: [sampleCard()] }).ok);
ok("ls_load", !!loadOfflineTrafficSnapshot());
{
  const precise = sampleCard({
    preciseLocationVerified: true,
    locationPresentationLevel: "PRECISE",
    kilometer: 12,
    direction: "positive",
    mapTarget: { mapLinkType: "VERIFIED_LOCATION", safeMapTarget: "https://www.dopravniinfo.cz/" },
  });
  const r = trafficProjectionToFeedItem(precise);
  ok("precise_ui_ok", r.ok === true);
  ok("precise_ui_km", r.item.trafficV1.kilometer === 12);
  ok("precise_ui_dir", r.item.trafficV1.direction == null);
}
{
  const general = sampleCard({
    preciseLocationVerified: false,
    subjectScopeVerified: false,
    locationPresentationLevel: "GENERAL",
    kilometer: 99,
    direction: "positive",
    locationDisclosureCs: "Přesná poloha není v oficiálních datech k dispozici.",
    mapTarget: { mapLinkType: "GENERAL_RSD_MAP", safeMapTarget: "https://www.dopravniinfo.cz/" },
  });
  const r = trafficProjectionToFeedItem(general);
  ok("general_ui_ok", r.ok === true);
  ok("general_ui_no_km", r.item.trafficV1.kilometer == null);
  ok("general_ui_no_dir", r.item.trafficV1.direction == null);
  ok("general_ui_map", resolveSafeTrafficMapUrl(r.item.trafficV1.mapTarget).includes("dopravniinfo.cz"));
}
{
  const prefs = { sections: ["doprava"], sourceIds: ["rsd", "ndic"] };
  const snap = {
    publicationEnabled: false,
    trafficUiEnabled: true,
    cards: [
      sampleCard({ locationPresentationLevel: "PRECISE", preciseLocationVerified: true }),
      sampleCard({
        publicEventId: "iu-te-" + "b".repeat(32),
        locationPresentationLevel: "GENERAL",
        preciseLocationVerified: false,
      }),
    ],
  };
  const cands = collectOfflineTrafficCandidates(prefs, { snapshot: snap });
  ok("collect_ui_on", cands.length === 2);
}
{
  ok("initial_card_cap_defined", TRAFFIC_UI_INITIAL_CARD_CAP >= 20 && TRAFFIC_UI_INITIAL_CARD_CAP <= 500);
  const many = {
    publicationEnabled: false,
    trafficUiEnabled: true,
    cards: Array.from({ length: TRAFFIC_UI_INITIAL_CARD_CAP + 40 }, (_, i) =>
      sampleCard({
        publicEventId: "iu-te-" + String(i).padStart(32, "0"),
        locationPresentationLevel: "GENERAL",
        preciseLocationVerified: false,
      })
    ),
  };
  const built = trafficItemsFromOfflineSnapshot(many);
  ok("initial_render_bounded", built.length === TRAFFIC_UI_INITIAL_CARD_CAP);
  const uncapped = trafficItemsFromOfflineSnapshot(many, { maxCards: 10000 });
  ok("max_cards_override", uncapped.length === many.cards.length);
}
clearOfflineTrafficSnapshot();

const success = results.filter((r) => r.pass).length;
const failure = results.filter((r) => !r.pass).length;
console.log(
  JSON.stringify(
    {
      suite: "TRAFFIC_FINAL_INTEGRATION",
      TRAFFIC_UI_TEST_COUNT: results.length,
      TRAFFIC_UI_TEST_SUCCESS_COUNT: success,
      TRAFFIC_UI_TEST_FAILURE_COUNT: failure,
      TRAFFIC_UI_TEST_SKIPPED_COUNT: 0,
      fails,
      MY_OVERVIEW_ONLY: true,
      SEPARATE_TRAFFIC_SETTINGS: false,
      PUBLICATION_ENABLED: false,
      TRAFFIC_UI_ENABLED: true,
      FEATURE_FLAG_DISABLE_READY: true,
    },
    null,
    2
  )
);
process.exitCode = failure === 0 && success === results.length ? 0 : 1;
