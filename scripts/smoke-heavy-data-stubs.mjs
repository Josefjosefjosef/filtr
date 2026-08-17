/**
 * Variant B: Playwright route stubs for multi‑MB info_events feed + traffic snapshot.
 * Test infrastructure only — does not alter production runtime data or fetch paths.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures");

export const SMOKE_FEED_STUB_PATH = path.join(FIXTURE_DIR, "smoke-info-events-cutover-stub.json");
export const SMOKE_TRAFFIC_STUB_PATH = path.join(FIXTURE_DIR, "smoke-traffic-offline-snapshot-stub.json");

export const SMOKE_STUB_MARKERS = Object.freeze({
  feedTitle: "SMOKE_STUB_INFO_EVENTS_MARKER",
  feedChmiTitle: "SMOKE_STUB_CHMI_ALERT Praha",
  feedId: "smoke-stub-ie-marker-001",
  trafficPreciseHeadline: "SMOKE_STUB_TRAFFIC_PRECISE D0",
  trafficScopedHeadline: "SMOKE_STUB_TRAFFIC_SCOPED D1",
});

const FEED_URL_RE = /\/projects\/data\/info_events\/feed\.json(?:\?|$)/i;
const TRAFFIC_URL_RE =
  /\/projects\/data\/info_events\/ndic_datex_v1\/traffic_offline_snapshot\.json(?:\?|$)/i;

export function loadSmokeFeedStub(filePath = SMOKE_FEED_STUB_PATH) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadSmokeTrafficStub(filePath = SMOKE_TRAFFIC_STUB_PATH) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Keep cutover smoke stub items inside the client/backend 96h active window.
 * Fixed fixture dates flake once `generatedAt`/`publishedAt` age past maxAgeHours.
 * @param {object} feed
 * @param {Date} [now]
 */
export function freshenSmokeFeedStubTimestamps(feed, now = new Date()) {
  const base = feed && typeof feed === "object" ? JSON.parse(JSON.stringify(feed)) : {};
  const t0 = now instanceof Date ? now.getTime() : Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const generatedAt = iso(t0);
  const recent = iso(t0 - 2 * 3600000);
  const validFrom = iso(t0 - 3600000);
  const validTo = iso(t0 + 24 * 3600000);
  base.generatedAt = generatedAt;
  const items = Array.isArray(base.items) ? base.items : [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    it.publishedAtSource = recent;
    it.publishedAt = recent;
    it.updatedAt = recent;
    it.validFrom = validFrom;
    if (it.validTo != null) it.validTo = validTo;
    it.firstSeenByInfoUzel = recent;
    it.lastProcessedAt = recent;
    it.sortAt = recent;
  }
  return base;
}

/**
 * Keep traffic offline stub cards inside ACTIVE overview window.
 * Fixed fixture validity ages out and zeros the shared feed under smoke stubs.
 * @param {object} snap
 * @param {Date} [now]
 */
export function freshenSmokeTrafficStubTimestamps(snap, now = new Date()) {
  const base = snap && typeof snap === "object" ? JSON.parse(JSON.stringify(snap)) : {};
  const t0 = now instanceof Date ? now.getTime() : Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  base.generatedAt = iso(t0);
  const validFrom = iso(t0 - 2 * 3600000);
  const expectedEnd = iso(t0 + 12 * 3600000);
  const cards = Array.isArray(base.cards) ? base.cards : [];
  for (const c of cards) {
    if (!c || typeof c !== "object") continue;
    c.lifecycleStatus = "ACTIVE";
    if (!c.validity || typeof c.validity !== "object") c.validity = {};
    c.validity.validFrom = validFrom;
    c.validity.expectedEnd = expectedEnd;
    c.validity.actualEnd = null;
    if (c.feed && typeof c.feed === "object") {
      c.feed.publishedAt = validFrom;
      c.feed.updatedAt = iso(t0 - 3600000);
    }
  }
  return base;
}

export function validateSmokeFeedStubSchema(feed) {
  const fails = [];
  if (!feed || typeof feed !== "object") {
    return { ok: false, fails: ["feed_not_object"] };
  }
  if (!Array.isArray(feed.items) || feed.items.length < 1) fails.push("feed_items_missing");
  const items = Array.isArray(feed.items) ? feed.items : [];
  if (!items.some((it) => it && it.id === SMOKE_STUB_MARKERS.feedId)) {
    fails.push("feed_marker_id_missing");
  }
  if (!items.some((it) => it && String(it.title || "").includes("SMOKE_STUB_CHMI"))) {
    fails.push("feed_chmi_marker_missing");
  }
  for (const it of items) {
    if (!it || !it.id || !it.title || !it.sourceId) fails.push("feed_item_required_fields");
    if (/javascript:/i.test(String((it && it.url) || "")) || /javascript:/i.test(String((it && it.publicUrl) || ""))) {
      fails.push("feed_unsafe_url");
    }
  }
  return { ok: fails.length === 0, fails };
}

export function validateSmokeTrafficStubSchema(snap) {
  const fails = [];
  if (!snap || typeof snap !== "object") {
    return { ok: false, fails: ["snap_not_object"] };
  }
  if (snap.publicationEnabled === true) fails.push("snap_publication_must_stay_off");
  if (snap.trafficUiEnabled === false) fails.push("snap_traffic_ui_disabled");
  const cards = Array.isArray(snap.cards) ? snap.cards : [];
  if (cards.length < 2) fails.push("snap_cards_missing");
  const levels = new Set(cards.map((c) => c && c.locationPresentationLevel));
  if (!levels.has("PRECISE")) fails.push("snap_missing_precise");
  if (!levels.has("SCOPED")) fails.push("snap_missing_scoped");
  for (const c of cards) {
    const mt = c && c.mapTarget;
    const url = mt && mt.safeMapTarget ? String(mt.safeMapTarget) : "";
    if (!mt || !mt.mapLinkType) fails.push("snap_map_target_missing");
    if (/javascript:/i.test(url) || /data:text\/html/i.test(url)) fails.push("snap_unsafe_url");
    if (!c || !c.publicEventId || !c.feed || !c.feed.feedHeadline) fails.push("snap_required_fields");
  }
  if (!cards.some((c) => /SMOKE_STUB_TRAFFIC_PRECISE/.test(String((c && c.feed && c.feed.feedHeadline) || "")))) {
    fails.push("snap_precise_marker_missing");
  }
  return { ok: fails.length === 0, fails };
}

/**
 * Install Playwright routes. Returns live stats object.
 * @param {import('playwright').Page} page
 * @param {{ feedBody?: string, trafficBody?: string, enabled?: boolean }} [opts]
 */
export async function installSmokeHeavyDataRouteStubs(page, opts = {}) {
  const enabled = opts.enabled !== false;
  const rawFeed = opts.feedJson != null ? opts.feedJson : loadSmokeFeedStub();
  const feedObj =
    opts.feedBody != null || opts.skipFreshen === true
      ? rawFeed
      : freshenSmokeFeedStubTimestamps(rawFeed);
  const rawTraffic = opts.trafficJson != null ? opts.trafficJson : loadSmokeTrafficStub();
  const trafficObj =
    opts.trafficBody != null || opts.skipFreshen === true
      ? rawTraffic
      : freshenSmokeTrafficStubTimestamps(rawTraffic);
  const feedBody = opts.feedBody != null ? opts.feedBody : JSON.stringify(feedObj);
  const trafficBody = opts.trafficBody != null ? opts.trafficBody : JSON.stringify(trafficObj);

  const feedSchema = validateSmokeFeedStubSchema(
    typeof feedObj === "object" ? feedObj : JSON.parse(feedBody)
  );
  const trafficSchema = validateSmokeTrafficStubSchema(
    typeof trafficObj === "object" ? trafficObj : JSON.parse(trafficBody)
  );

  const stats = {
    enabled,
    feedIntercepts: 0,
    trafficIntercepts: 0,
    feedSchema,
    trafficSchema,
    feedBytesServed: Buffer.byteLength(feedBody, "utf8"),
    trafficBytesServed: Buffer.byteLength(trafficBody, "utf8"),
  };

  if (!enabled) return stats;

  await page.route(FEED_URL_RE, async (route) => {
    stats.feedIntercepts += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: feedBody,
    });
  });
  await page.route(TRAFFIC_URL_RE, async (route) => {
    stats.trafficIntercepts += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: trafficBody,
    });
  });

  return stats;
}

export function isFeedStubUrl(url) {
  return FEED_URL_RE.test(String(url || ""));
}

export function isTrafficStubUrl(url) {
  return TRAFFIC_URL_RE.test(String(url || ""));
}
