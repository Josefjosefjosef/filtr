/**
 * CHMI CAP completeness production verify — compare official CAP streams vs feed.
 * Exit 0 = PRODUCTION_VERIFIED, 1 = FAIL.
 *
 * Usage:
 *   node scripts/chmi-cap-v2-prod-verify.mjs
 *   node scripts/chmi-cap-v2-prod-verify.mjs --feed=https://infouzel.cz/projects/data/info_events/feed.json
 *   node scripts/chmi-cap-v2-prod-verify.mjs --feed=projects/data/info_events/feed.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { listCapXmlFromIndex } from "./iu-info-events-lib.mjs";
import { selectLatestPerProductStream, capProductKeyFromUrl } from "./chmi-cap-v2/discovery-adapter.mjs";
import { parseCapAlertXml } from "./chmi-cap-v2/parse-cap.mjs";
import { processCapDocuments } from "./chmi-cap-v2/sync-core.mjs";
import { revisionsToFeed, mergeFeedItemsById, isPublishableChmiItem } from "./chmi-cap-v2/normalize-feed.mjs";
import { createGeoRegistry } from "./chmi-cap-v2/geo-registry.mjs";
import { latestRevisionForThread } from "./chmi-cap-v2/revisions.mjs";
import { CHMI_OPENDATA_CAP_INDEX, CHMI_SYNC_UA, getChmiCapV2Config } from "./chmi-cap-v2/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DEFAULT_FEED = "https://infouzel.cz/projects/data/info_events/feed.json";
const CITIES = ["Praha", "Brno", "Plzeň", "Benešov", "Rumburk"];

function argVal(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": CHMI_SYNC_UA, Accept: "*/*", "Cache-Control": "no-cache" },
  });
  const body = await res.text();
  return { status: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
}

function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cityMatch(item, city) {
  const n = fold(city);
  const r = item.region || {};
  const parts = [
    r.name,
    r.summary,
    ...(r.orpNames || []),
    ...(r.okresNames || []),
    ...(r.krajNames || []),
    ...(r.areaDescs || []),
    item.capV2 && item.capV2.searchText,
  ]
    .filter(Boolean)
    .map(fold)
    .join(" ");
  return parts.includes(n);
}

async function loadFeed(feedSpec) {
  if (/^https?:\/\//i.test(feedSpec)) {
    const res = await fetchText(feedSpec);
    if (res.status < 200 || res.status >= 300) throw new Error("feed_http_" + res.status);
    return { feed: JSON.parse(res.body), source: feedSpec };
  }
  const p = path.isAbsolute(feedSpec) ? feedSpec : path.join(REPO, feedSpec);
  return { feed: JSON.parse(fs.readFileSync(p, "utf8")), source: p };
}

async function main() {
  const feedSpec = argVal("feed", DEFAULT_FEED);
  const out = {
    verifiedAt: new Date().toISOString(),
    productionVerified: false,
    feedSource: feedSpec,
    source: {},
    parser: {},
    production: {},
    filters: {},
    diffs: [],
    alarms: [],
  };

  const idx = await fetchText(CHMI_OPENDATA_CAP_INDEX);
  const listed = listCapXmlFromIndex(idx.body, CHMI_OPENDATA_CAP_INDEX);
  const streams = selectLatestPerProductStream(listed);
  out.source = {
    indexHttp: idx.status,
    listedXml: listed.length,
    streams: streams.map((s) => ({ productKey: s.productKey, name: s.name, mtime: s.mtime })),
  };

  const config = getChmiCapV2Config({ IU_CHMI_CAP_V2_MODE: "active" });
  const registry = createGeoRegistry();
  const allItems = [];
  let infoBlocks = 0;
  let totalAreas = 0;
  const events = new Set();

  for (const stream of streams) {
    const xmlRes = await fetchText(stream.url);
    if (xmlRes.status < 200 || xmlRes.status >= 300) {
      out.alarms.push({ code: "STREAM_FETCH_FAIL", url: stream.url, status: xmlRes.status });
      continue;
    }
    const one = processCapDocuments([{ xml: xmlRes.body, sourceUrl: stream.url }], { config, registry });
    const tids = [...new Set(one.report.revisions.map((r) => r.alert_thread_id))];
    const revs = tids.map((tid) => latestRevisionForThread(one.store, tid)).filter(Boolean);
    for (const r of revs) {
      infoBlocks += (r.hazards || []).length;
      for (const h of r.hazards || []) {
        totalAreas += (h.areas || []).length;
        if (h.event && !/^žádn|^no warning/i.test(h.event)) events.add(h.event);
      }
    }
    allItems.push(...revisionsToFeed(revs));
  }

  const expected = mergeFeedItemsById(allItems).filter((i) => isPublishableChmiItem(i));
  out.parser = {
    streamsProcessed: streams.length,
    infoBlocks,
    totalAreas,
    uniqueEvents: [...events],
    expectedActive: expected.filter((i) => i.status === "aktivni").length,
    expectedPublishable: expected.length,
    expectedTitles: expected.map((i) => i.title),
  };

  const { feed, source } = await loadFeed(feedSpec);
  out.feedSource = source;
  const chmi = (feed.items || []).filter((i) => String(i.sourceId) === "chmi" && isPublishableChmiItem(i));
  out.production = {
    generatedAt: feed.generatedAt || null,
    chmiCapV2Active: !!feed.chmiCapV2Active,
    activeCount: chmi.filter((i) => i.status === "aktivni").length,
    scheduledCount: chmi.filter((i) => i.status === "naplanovano").length,
    publishableCount: chmi.length,
    titles: chmi.map((i) => i.title),
    events: [...new Set(chmi.map((i) => (i.capV2 && i.capV2.event) || String(i.title || "").split(" — ")[0]))],
    orpCoverage: chmi.map((i) => ({
      title: i.title,
      orpCount: (i.region && i.region.orpIds && i.region.orpIds.length) || 0,
      summary: (i.region && (i.region.summary || i.region.name)) || "",
    })),
  };

  const expKeys = new Set(expected.map((i) => i.id));
  const prodKeys = new Set(chmi.map((i) => i.id));
  for (const id of expKeys) if (!prodKeys.has(id)) out.diffs.push({ type: "missing_in_production", id });
  for (const id of prodKeys) if (!expKeys.has(id)) out.diffs.push({ type: "extra_in_production", id });

  // Title/event set comparison (stable across id hash changes)
  const expEvents = new Set(expected.map((i) => (i.capV2 && i.capV2.event) || String(i.title).split(" — ")[0]));
  const prodEvents = new Set(out.production.events);
  for (const e of expEvents) if (!prodEvents.has(e)) out.diffs.push({ type: "missing_event", event: e });
  for (const e of prodEvents) if (!expEvents.has(e)) out.diffs.push({ type: "unexpected_event", event: e });

  if (expected.length > 0 && chmi.length === 0) out.alarms.push({ code: "PROD_EMPTY_SOURCE_NONEMPTY" });
  if (expected.length >= 3 && chmi.length > 0 && chmi.length < expected.length * 0.5) {
    out.alarms.push({ code: "PROD_ACTIVE_DROP", expected: expected.length, production: chmi.length });
  }
  if (!feed.chmiCapV2Active) out.alarms.push({ code: "CHMI_CAP_V2_NOT_ACTIVE_FLAG" });

  for (const city of CITIES) {
    const expHit = expected.filter((i) => cityMatch(i, city)).map((i) => i.title);
    const prodHit = chmi.filter((i) => cityMatch(i, city)).map((i) => i.title);
    out.filters[city] = { expected: expHit, production: prodHit, ok: expHit.length === prodHit.length || (expHit.length > 0 && prodHit.length > 0) };
    if (expHit.length && !prodHit.length) {
      out.alarms.push({ code: "CITY_FILTER_MISS", city, expected: expHit });
      out.diffs.push({ type: "city_filter_miss", city });
    }
  }

  const hardFail =
    out.alarms.some((a) =>
      [
        "PROD_EMPTY_SOURCE_NONEMPTY",
        "PROD_ACTIVE_DROP",
        "STREAM_FETCH_FAIL",
        "CITY_FILTER_MISS",
        "CANONICAL_AREA_MISMATCH",
      ].includes(a.code)
    ) || out.diffs.some((d) => d.type === "missing_event" || d.type === "city_filter_miss");

  // Canonical content gate — count equality alone is insufficient.
  const areaMismatch = [];
  for (const exp of expected) {
    const prod =
      chmi.find((i) => i.id === exp.id) ||
      chmi.find((i) => (i.capV2 && i.capV2.event) === (exp.capV2 && exp.capV2.event) && (i.capV2 && i.capV2.severity) === (exp.capV2 && exp.capV2.severity));
    if (!prod) continue;
    const eOrps = new Set((exp.region && exp.region.orpIds) || []);
    const pOrps = new Set((prod.region && prod.region.orpIds) || []);
    if (!eOrps.size) continue;
    const missing = [...eOrps].filter((x) => !pOrps.has(x));
    if (missing.length && missing.length === eOrps.size) {
      areaMismatch.push({ id: exp.id, missing: missing.slice(0, 8) });
    }
  }
  if (areaMismatch.length) {
    out.alarms.push({ code: "CANONICAL_AREA_MISMATCH", count: areaMismatch.length });
    out.diffs.push(...areaMismatch.map((m) => ({ type: "area_mismatch", ...m })));
  }

  out.productionVerified =
    !hardFail &&
    !out.alarms.some((a) => a.code === "CANONICAL_AREA_MISMATCH") &&
    expected.length > 0 &&
    chmi.length > 0 &&
    out.diffs.filter((d) => d.type === "missing_event").length === 0;
  out.verdict = out.productionVerified ? "PRODUCTION_VERIFIED" : "FAIL";

  console.log("CHMI_CAP_V2_PROD_VERIFY=" + out.verdict);
  console.log("streams=" + streams.length);
  console.log("expectedActive=" + expected.length);
  console.log("productionActive=" + chmi.length);
  console.log("events=" + [...expEvents].join("|"));
  console.log("diffs=" + out.diffs.length);
  console.log("alarms=" + out.alarms.map((a) => a.code).join(","));
  const outPath = path.join(process.env.TEMP || process.env.TMPDIR || ".", "iu_chmi_prod_verify.json");
  try {
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    console.log("report=" + outPath);
  } catch {
    /* ignore */
  }
  if (!out.productionVerified) process.exit(1);
}

main().catch((e) => {
  console.error("CHMI_CAP_V2_PROD_VERIFY=FAIL");
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});
