#!/usr/bin/env node
/**
 * Production connector refresh for Přehled dne (info_events).
 * Fetches official/public RSS, HTML listings, and CHMI CAP bulletins.
 * Isolates per-source failures; keeps only concrete item URLs.
 * Run: node scripts/iu-info-events-refresh.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  canonicalizeUrl,
  dedupeByUrlAndGroup,
  extractCapBulletinItems,
  extractFeedItems,
  extractHtmlListItems,
  fetchText,
  isConcreteItemUrl,
  listCapXmlFromIndex,
  looksLikeFeedXml,
  makeGroupKey,
  makeItemId,
  mapGroupToSection,
  normalizeItemUrl,
  stripHtml,
} from "./iu-info-events-lib.mjs";
import {
  IU_INFO_EVENTS_V2,
  applyChronology,
  atomicPublishInfoEvents,
  buildConnectorGroups,
  buildPersonalizationMeta,
  defaultPeriodicityMin,
  loadPreviousFirstSeen,
  regionalAdapterSpec,
  resolveConnectorType,
  resolveLane,
  resolveOrgType,
  splitIntoLanes,
  validateStagingFeed,
} from "./iu-info-events-v2.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, "projects", "data", "info_events");

const MAX_ITEMS = Number(process.env.IU_INFO_EVENTS_MAX_ITEMS || "300");
const MAX_AGE_HOURS = Number(process.env.IU_INFO_EVENTS_MAX_AGE_HOURS || "120");
const PER_FEED_CAP = Number(process.env.IU_INFO_EVENTS_PER_FEED_CAP || "25");
const PER_SOURCE_CAP = Number(process.env.IU_INFO_EVENTS_PER_SOURCE_CAP || "40");
const CAP_FILES_MAX = Number(process.env.IU_INFO_EVENTS_CAP_FILES_MAX || "6");
const ONLY_GROUP = String(process.env.IU_INFO_EVENTS_GROUP || "").trim().toLowerCase();

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function writeJson(name, obj) {
  fs.writeFileSync(path.join(DIR, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function toIso(raw) {
  const t = Date.parse(String(raw || ""));
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return "";
}

function scoreImportance(title, group, severity) {
  const t = String(title || "").toLowerCase();
  let n = 2;
  if (/výstrah|mimorad|mimořád|varování|krize|povod|bouř|nehod|útok|kyber/i.test(t)) n = 5;
  else if (/omezení|výluka|uzavír|epidem|stažení|varuje/i.test(t)) n = 4;
  else if (/tiskov|rozhodnutí|nařízení|vyhláš/i.test(t)) n = 3;
  if (group === "policie" || group === "hzs" || group === "pocasi") n = Math.max(n, 3);
  if (/Extreme/i.test(severity || "")) n = 5;
  else if (/Severe/i.test(severity || "")) n = Math.max(n, 4);
  else if (/Moderate/i.test(severity || "")) n = Math.max(n, 3);
  return n;
}

function buildItem(entry, raw, nowIso, extra = {}) {
  const home = entry.url || "";
  const url = normalizeItemUrl(raw.link, raw.base || entry.url || "");
  const title = stripHtml(raw.title);
  if (!title || !url) return null;
  if (!isConcreteItemUrl(url, home)) return null;
  const sourcePub = toIso(raw.pubDate);
  const hasSourcePubDate = !!sourcePub;
  const publishedAt = sourcePub || nowIso;
  const ageH = (Date.parse(nowIso) - Date.parse(publishedAt)) / 3600000;
  if (Number.isFinite(ageH) && ageH > MAX_AGE_HOURS) return null;
  const sec = mapGroupToSection(entry.defaultSectionGroup || entry.group);
  const importance = scoreImportance(title, entry.group, raw.severity);
  const canonical = canonicalizeUrl(url);
  const region =
    raw.area
      ? { level: "kraj", name: raw.area }
      : entry.defaultRegion || { level: "cr", name: "Česká republika" };
  const lane = resolveLane(entry);
  const connectorType = resolveConnectorType(entry);
  const orgType = resolveOrgType(entry);
  return {
    id: makeItemId(entry.id, canonical || url, publishedAt),
    title,
    sourceId: entry.id,
    sourceLabel: entry.label || entry.id,
    sourceName: entry.label || entry.id,
    url,
    originalUrl: url,
    canonicalUrl: canonical || url,
    sectionId: entry.defaultSectionId || sec.sectionId,
    subsectionId: entry.defaultSubsectionId || sec.subsectionId,
    eventType: importance >= 5 ? "mimoradne" : "prave-probihajici",
    status: "aktivni",
    importance,
    impact: importance,
    region,
    lane,
    connectorType,
    orgType,
    publishedAtSource: hasSourcePubDate ? sourcePub : null,
    publishedAt,
    updatedAt: nowIso,
    _hasSourcePubDate: hasSourcePubDate,
    groupKey: makeGroupKey(title, publishedAt),
    tags: [entry.group, lane, connectorType].concat(extra.tags || []).filter(Boolean),
    links: [],
  };
}

async function ingestFeedUrl(entry, feedUrl, nowIso, collected, report) {
  const t0 = Date.now();
  try {
    const { ok, status, text, ms, attempts } = await fetchText(feedUrl);
    if (!ok || !looksLikeFeedXml(text)) {
      report.push({
        id: entry.id,
        feedUrl,
        ok: false,
        status,
        reason: "not_feed",
        ms: ms || Date.now() - t0,
        attempts,
      });
      return 0;
    }
    const rawItems = extractFeedItems(text).slice(0, PER_FEED_CAP);
    let kept = 0;
    for (const raw of rawItems) {
      const item = buildItem(entry, { ...raw, base: feedUrl }, nowIso);
      if (!item) continue;
      collected.push(item);
      kept += 1;
    }
    report.push({
      id: entry.id,
      feedUrl,
      ok: true,
      status,
      kept,
      raw: rawItems.length,
      ms: ms || Date.now() - t0,
      attempts,
      mode: "rss",
    });
    return kept;
  } catch (e) {
    report.push({
      id: entry.id,
      feedUrl,
      ok: false,
      status: 0,
      reason: String(e && e.message ? e.message : e),
      ms: Date.now() - t0,
      mode: "rss",
    });
    return 0;
  }
}

async function ingestHtmlList(entry, listUrl, nowIso, collected, report) {
  const t0 = Date.now();
  try {
    const { ok, status, text, ms, attempts } = await fetchText(listUrl);
    if (!ok) {
      report.push({
        id: entry.id,
        listUrl,
        ok: false,
        status,
        reason: "html_fetch_fail",
        ms: ms || Date.now() - t0,
        attempts,
        mode: "html",
      });
      return 0;
    }
    const rawItems = extractHtmlListItems(text, listUrl, {
      homeUrl: entry.url || "",
      max: PER_FEED_CAP,
      pathInclude: entry.htmlPathInclude || null,
    });
    let kept = 0;
    for (const raw of rawItems) {
      const item = buildItem(entry, { ...raw, base: listUrl }, nowIso, { tags: ["html-list"] });
      if (!item) continue;
      collected.push(item);
      kept += 1;
    }
    report.push({
      id: entry.id,
      listUrl,
      ok: true,
      status,
      kept,
      raw: rawItems.length,
      ms: ms || Date.now() - t0,
      attempts,
      mode: "html",
    });
    return kept;
  } catch (e) {
    report.push({
      id: entry.id,
      listUrl,
      ok: false,
      status: 0,
      reason: String(e && e.message ? e.message : e),
      ms: Date.now() - t0,
      mode: "html",
    });
    return 0;
  }
}

async function ingestCapIndex(entry, indexUrl, nowIso, collected, report) {
  const t0 = Date.now();
  try {
    const idx = await fetchText(indexUrl, 20000);
    if (!idx.ok) {
      report.push({
        id: entry.id,
        capIndexUrl: indexUrl,
        ok: false,
        status: idx.status,
        reason: "cap_index_fail",
        ms: idx.ms,
        mode: "cap",
      });
      return 0;
    }
    const listed = listCapXmlFromIndex(idx.text, indexUrl);
    const files = listed.slice(0, CAP_FILES_MAX).map((x) => x.url || x);
    let kept = 0;
    let raw = 0;
    for (const fileUrl of files) {
      try {
        const cap = await fetchText(fileUrl, 45000, 1);
        if (!cap.ok || !/<alert[\s>]/i.test(cap.text)) continue;
        const items = extractCapBulletinItems(cap.text, fileUrl, { max: 6 });
        raw += items.length;
        for (const rawItem of items) {
          const item = buildItem(entry, { ...rawItem, base: fileUrl }, nowIso, { tags: ["cap", "vystraha"] });
          if (!item) continue;
          collected.push(item);
          kept += 1;
        }
      } catch {
        /* isolate single CAP file */
      }
    }
    report.push({
      id: entry.id,
      capIndexUrl: indexUrl,
      ok: kept > 0,
      status: idx.status,
      kept,
      raw,
      files: files.length,
      ms: Date.now() - t0,
      mode: "cap",
    });
    return kept;
  } catch (e) {
    report.push({
      id: entry.id,
      capIndexUrl: indexUrl,
      ok: false,
      status: 0,
      reason: String(e && e.message ? e.message : e),
      ms: Date.now() - t0,
      mode: "cap",
    });
    return 0;
  }
}

async function main() {
  const nowIso = new Date().toISOString();
  const registry = readJson("source_registry.json");
  const cutover = readJson("cutover_state.json");
  const firstSeenMap = loadPreviousFirstSeen(DIR);
  const collected = [];
  const ingestReport = [];
  let sourceErrors = 0;
  const runStarted = Date.now();

  for (const entry of registry.entries || []) {
    // Enrich registry architecture fields for all approved entries
    entry.lane = resolveLane(entry);
    entry.connectorType = resolveConnectorType(entry);
    entry.orgType = resolveOrgType(entry);
    entry.periodicityMin = defaultPeriodicityMin(entry);

    if (!entry.productionActive || !entry.productionApproved) continue;
    if (entry.legalStatus !== "approved") continue;
    if (ONLY_GROUP && resolveLane(entry) !== ONLY_GROUP) continue;

    let keptTotal = 0;
    const srcStarted = Date.now();
    try {
      if (entry.capIndexUrl) {
        keptTotal += await ingestCapIndex(entry, entry.capIndexUrl, nowIso, collected, ingestReport);
      }

      const feedUrls = []
        .concat(entry.feedUrl ? [entry.feedUrl] : [])
        .concat(Array.isArray(entry.feedUrls) ? entry.feedUrls : [])
        .map((u) => String(u || "").trim())
        .filter(Boolean);

      for (const fu of feedUrls) {
        keptTotal += await ingestFeedUrl(entry, fu, nowIso, collected, ingestReport);
      }

      const listUrls = []
        .concat(entry.htmlListUrl ? [entry.htmlListUrl] : [])
        .concat(Array.isArray(entry.htmlListUrls) ? entry.htmlListUrls : [])
        .map((u) => String(u || "").trim())
        .filter(Boolean);

      const gotPrimary = keptTotal > 0;
      if (!gotPrimary || entry.htmlAlways === true) {
        for (const lu of listUrls) {
          keptTotal += await ingestHtmlList(entry, lu, nowIso, collected, ingestReport);
        }
      }
    } catch (e) {
      sourceErrors += 1;
      ingestReport.push({
        id: entry.id,
        ok: false,
        status: 0,
        reason: "source_isolated_error:" + String(e && e.message ? e.message : e),
        lane: resolveLane(entry),
      });
    }

    let probe = { ok: false, status: 0, ms: 0 };
    try {
      const homeProbe = await fetchText(entry.url, 8000, 1);
      probe = { ok: homeProbe.ok, status: homeProbe.status, ms: homeProbe.ms };
    } catch {
      probe = { ok: false, status: 0, ms: 0 };
    }
    entry.technicalStatus = probe.ok ? "ok" : "down";
    entry.lastAuditAt = nowIso;
    entry.connectorStatus = keptTotal > 0 ? "PRODUCTION_ACTIVE" : entry.connectorStatus || "PRODUCTION_ACTIVE";
    entry.monitoring = {
      availability: probe.ok ? "ok" : "down",
      freshness: keptTotal > 0 ? "ok" : "stale_or_empty",
      structureChange: "none",
      lastProbeStatus: probe.status,
      lastProbeAt: nowIso,
      lastAttemptAt: nowIso,
      lastSuccessAt: keptTotal > 0 ? nowIso : entry.monitoring && entry.monitoring.lastSuccessAt,
      lastError: keptTotal > 0 ? null : "no_items_kept",
      itemsKept: keptTotal,
      itemsNew: keptTotal,
      runMs: Date.now() - srcStarted,
      responseMs: probe.ms,
      dataAgeHours: null,
      lane: resolveLane(entry),
      connectorType: resolveConnectorType(entry),
      periodicityMin: entry.periodicityMin,
      connector: entry.capIndexUrl
        ? "opendata-cap"
        : entry.feedUrl || (entry.feedUrls && entry.feedUrls.length)
          ? "rss"
          : entry.htmlListUrl || (entry.htmlListUrls && entry.htmlListUrls.length)
            ? "html-list"
            : "none",
    };
  }

  const beforeDedupe = collected.length;
  let items = dedupeByUrlAndGroup(collected);
  const removedDupes = beforeDedupe - items.length;

  // Chronology: source publish time preferred; else firstSeenByInfoUzel
  items = items.map((it) => {
    const chron = applyChronology(it, nowIso, firstSeenMap);
    delete chron._hasSourcePubDate;
    return chron;
  });

  items.sort((a, b) => {
    const di = Number(b.importance || 0) - Number(a.importance || 0);
    if (di) return di;
    return (Date.parse(b.sortAt || b.publishedAt || 0) || 0) - (Date.parse(a.sortAt || a.publishedAt || 0) || 0);
  });

  const perSource = new Map();
  const fair = [];
  for (const it of items) {
    const sid = String(it.sourceId || "");
    const n = perSource.get(sid) || 0;
    if (n >= PER_SOURCE_CAP) continue;
    perSource.set(sid, n + 1);
    fair.push(it);
  }
  items = fair;
  if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);

  const beforeHome = items.length;
  items = items.filter((it) => isConcreteItemUrl(it.url, null) && isConcreteItemUrl(it.originalUrl || it.url, null));
  const droppedHome = beforeHome - items.length;

  const lanes = splitIntoLanes(items);
  const laneCounts = {};
  for (const [lid, arr] of Object.entries(lanes)) laneCounts[lid] = arr.length;

  const feed = {
    version: IU_INFO_EVENTS_V2,
    generatedAt: nowIso,
    connector: "iu-info-events-refresh",
    architecture: "v2-pipeline",
    itemCount: items.length,
    maxAgeHours: MAX_AGE_HOURS,
    onlyGroup: ONLY_GROUP || null,
    laneCounts,
    items,
  };

  const metadata = {
    version: IU_INFO_EVENTS_V2,
    generatedAt: nowIso,
    architecture: {
      backendOnlyFetch: true,
      frontendLocalFirst: true,
      frontendMustNotFetchSourceSites: true,
      atomicPublish: true,
      splitDatasets: true,
    },
    connectorPreference: ["api", "opendata", "rss", "atom", "xml", "json", "html"],
    connectorGroups: buildConnectorGroups(),
    personalization: buildPersonalizationMeta(),
    regionalAdapter: regionalAdapterSpec(),
    chronology: {
      fields: ["publishedAtSource", "firstSeenByInfoUzel", "lastUpdatedBySource", "lastProcessedAt", "sortAt"],
      sortRule: "prefer publishedAtSource; else firstSeenByInfoUzel",
    },
  };

  const failedConnectors = ingestReport.filter((r) => !r.ok);
  const monitoring = {
    version: IU_INFO_EVENTS_V2,
    generatedAt: nowIso,
    cutover,
    runMs: Date.now() - runStarted,
    onlyGroup: ONLY_GROUP || null,
    feedItemCount: items.length,
    droppedHomepageUrls: droppedHome,
    removedDuplicates: removedDupes,
    sourceErrors,
    laneCounts,
    failedConnectors: failedConnectors.map((r) => ({
      id: r.id,
      reason: r.reason || "fail",
      status: r.status,
      mode: r.mode || null,
      lane: r.lane || null,
    })),
    ingest: ingestReport,
    sources: (registry.entries || [])
      .filter((e) => e.productionActive)
      .map((e) => ({
        id: e.id,
        label: e.label,
        url: e.url,
        lane: e.lane || resolveLane(e),
        connectorType: e.connectorType || resolveConnectorType(e),
        orgType: e.orgType || resolveOrgType(e),
        periodicityMin: e.periodicityMin || defaultPeriodicityMin(e),
        feedUrl: e.feedUrl || (e.feedUrls && e.feedUrls[0]) || null,
        capIndexUrl: e.capIndexUrl || null,
        legalStatus: e.legalStatus,
        technicalStatus: e.technicalStatus,
        productionActive: e.productionActive,
        connectorStatus: e.connectorStatus || "PRODUCTION_ACTIVE",
        monitoring: e.monitoring || null,
      })),
    pendingSources: (registry.entries || [])
      .filter((e) => !e.productionActive)
      .map((e) => ({
        id: e.id,
        lane: e.lane || resolveLane(e),
        connectorType: e.connectorType || resolveConnectorType(e),
        connectorStatus: e.connectorStatus || "NO_STABLE_ITEM_SOURCE",
        blocker: e.blocker || e.notes || "",
      })),
    dedupeGroups: new Set(items.map((i) => i.groupKey).filter(Boolean)).size,
    commercialAggregationActive: !!cutover.commercialAggregationActive,
  };

  registry.version = IU_INFO_EVENTS_V2;
  registry.generatedAt = nowIso;

  // Atomic publish: stage lanes + feed + metadata + monitoring + registry, then promote
  const files = {
    "feed.json": feed,
    "metadata.json": metadata,
    "monitoring.json": monitoring,
    "source_registry.json": registry,
  };
  for (const [lid, arr] of Object.entries(lanes)) {
    files[`lanes/${lid}.json`] = {
      version: IU_INFO_EVENTS_V2,
      lane: lid,
      generatedAt: nowIso,
      itemCount: arr.length,
      items: arr,
    };
  }

  try {
    const manifest = atomicPublishInfoEvents(
      DIR,
      {
        generationId: nowIso.replace(/[:.]/g, "-"),
        generatedAt: nowIso,
        itemCount: items.length,
        laneCounts,
        files,
      },
      validateStagingFeed
    );
    console.log("[iu-info-events-refresh] atomicPublish generationId=" + manifest.generationId);
  } catch (e) {
    console.error("[iu-info-events-refresh] ATOMIC_PUBLISH_FAIL", e && e.message ? e.message : e);
    console.log("RESULT=FAIL");
    process.exit(1);
  }

  const activeConnectors = ingestReport.filter((r) => r.ok && (r.kept || 0) > 0).length;
  console.log("[iu-info-events-refresh] architecture=v2");
  console.log("[iu-info-events-refresh] sourcesActive=" + monitoring.sources.length);
  console.log("[iu-info-events-refresh] connectorsWithItems=" + activeConnectors);
  console.log("[iu-info-events-refresh] feedItems=" + feed.itemCount);
  console.log("[iu-info-events-refresh] droppedHomepageUrls=" + droppedHome);
  console.log("[iu-info-events-refresh] removedDuplicates=" + removedDupes);
  console.log("[iu-info-events-refresh] failedConnectors=" + failedConnectors.length);
  console.log("[iu-info-events-refresh] lanes=" + JSON.stringify(laneCounts));
  console.log("[iu-info-events-refresh] commercialAggregationActive=" + monitoring.commercialAggregationActive);
  if (failedConnectors.length) {
    for (const f of failedConnectors.slice(0, 12)) {
      console.log("[iu-info-events-refresh] FAIL_CONNECTOR id=" + f.id + " reason=" + (f.reason || ""));
    }
  }
  if (feed.itemCount < 50) {
    console.log("RESULT=FAIL");
    console.error("[iu-info-events-refresh] too few concrete items: " + feed.itemCount);
    process.exit(1);
  }
  console.log("RESULT=PASS");
}

main().catch((err) => {
  console.error(err);
  console.log("RESULT=FAIL");
  process.exit(1);
});
