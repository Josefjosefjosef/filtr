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
  parsePublishDateToIso,
  extractTitleLeadingDate,
} from "./iu-info-events-lib.mjs";
import { getChmiCapV2Config, isLegacyProductionPath } from "./chmi-cap-v2/config.mjs";
import {
  IU_INFO_EVENTS_V2,
  applyChronology,
  atomicPublishInfoEvents,
  buildConnectorGroups,
  buildPersonalizationMeta,
  buildDataQualityMetrics,
  defaultPeriodicityMin,
  enrichMonitoringV3,
  isInActiveFeedWindow,
  loadPreviousFirstSeen,
  regionalAdapterSpec,
  resolveConnectorType,
  resolveLane,
  resolveOrgType,
  splitIntoLanes,
  validateStagingFeed,
} from "./iu-info-events-v2.mjs";
import {
  assertChmiCapV2FeedPreserved,
  assertMonitoringForeignNamespacesPreserved,
  composeFeedItemsWithForeignNamespaces,
  composeMonitoringWithForeignNamespaces,
  shouldSkipChmiLegacyIngest,
} from "./iu-info-events-namespace-compose.mjs";
import {
  attachLegalProvenance,
  canPublishFromSource,
  loadLegalRegistry,
} from "./iu-info-events-legal-registry-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Optional prep sandbox for deferred shared-write (narrow lock). */
const DIR = process.env.IU_INFO_EVENTS_DATA_DIR
  ? path.resolve(process.env.IU_INFO_EVENTS_DATA_DIR)
  : path.join(REPO, "projects", "data", "info_events");

const MAX_ITEMS = Number(process.env.IU_INFO_EVENTS_MAX_ITEMS || "300");
const MAX_AGE_HOURS = Number(process.env.IU_INFO_EVENTS_MAX_AGE_HOURS || "96");
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
  return parsePublishDateToIso(raw) || "";
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

function resolveLifecycle(entry, raw, importance) {
  if (raw.lifecycleHint === "warning" || entry.group === "pocasi" || entry.capIndexUrl) {
    return { eventType: "mimoradne", status: "aktivni", lifecycle: "prave-probihajici" };
  }
  if (entry.group === "doprava" && /výluka|uzavír|omezení|nehod/i.test(String(raw.title || ""))) {
    return { eventType: "prave-probihajici", status: "aktivni", lifecycle: "prave-probihajici" };
  }
  if (importance >= 5) {
    return { eventType: "mimoradne", status: "publikovano", lifecycle: "publikovano" };
  }
  // Ordinary press / articles are published info — not "active events"
  return { eventType: "aktualni", status: "publikovano", lifecycle: "publikovano" };
}

function buildItem(entry, raw, nowIso, extra = {}) {
  const home = entry.url || "";
  const url = normalizeItemUrl(raw.link, raw.base || entry.url || "");
  const title = stripHtml(raw.title);
  if (!title || !url) return null;
  if (!isConcreteItemUrl(url, home)) return null;

  let timeSourceHint = String(raw.timeSourceHint || "");
  let sourcePub = toIso(raw.pubDate);
  if (!sourcePub) {
    const titleDate = extractTitleLeadingDate(title);
    if (titleDate) {
      sourcePub = parsePublishDateToIso(titleDate);
      if (sourcePub) timeSourceHint = "title_date";
    }
  } else if (!timeSourceHint) {
    timeSourceHint = entry.capIndexUrl
      ? "opendata_cap_sent"
      : entry.feedUrl || (entry.feedUrls && entry.feedUrls.length)
        ? "rss_pub_date"
        : "source_pub_date";
  }

  const hasSourcePubDate = !!sourcePub;
  const validFrom = toIso(raw.validFrom) || null;
  const validTo = toIso(raw.validTo) || null;
  const importance = scoreImportance(title, entry.group, raw.severity);
  const life = resolveLifecycle(entry, raw, importance);

  // Age gate ONLY on reliable publishedAtSource — never invent "now" to pass the window.
  if (hasSourcePubDate) {
    const ageH = (Date.parse(nowIso) - Date.parse(sourcePub)) / 3600000;
    const stillValid = validTo && Date.parse(validTo) >= Date.parse(nowIso);
    if (Number.isFinite(ageH) && ageH > MAX_AGE_HOURS && !stillValid) return null;
  }

  const sec = mapGroupToSection(entry.defaultSectionGroup || entry.group);
  const canonical = canonicalizeUrl(url);
  const region =
    raw.area
      ? { level: "kraj", name: raw.area }
      : entry.defaultRegion || { level: "cr", name: "Česká republika" };
  const lane = resolveLane(entry);
  const connectorType = resolveConnectorType(entry);
  const orgType = resolveOrgType(entry);
  const idSeed = sourcePub || canonical || url;
  return {
    id: makeItemId(entry.id, canonical || url, idSeed),
    title,
    sourceId: entry.id,
    sourceLabel: entry.label || entry.id,
    sourceName: entry.institution || entry.label || entry.id,
    sourceGroup: entry.group || "",
    url,
    originalUrl: url,
    canonicalUrl: canonical || url,
    sectionId: entry.defaultSectionId || sec.sectionId,
    subsectionId: entry.defaultSubsectionId || sec.subsectionId,
    eventType: life.eventType,
    status: life.status,
    lifecycle: life.lifecycle,
    importance,
    impact: importance,
    region,
    lane,
    connectorType,
    orgType,
    publishedAtSource: hasSourcePubDate ? sourcePub : null,
    publishedAt: hasSourcePubDate ? sourcePub : null,
    updatedAt: nowIso,
    validFrom,
    validTo,
    resolvedAt: null,
    timeSourceHint,
    _hasSourcePubDate: hasSourcePubDate,
    groupKey: makeGroupKey(title, sourcePub || "unknown"),
    // User-facing tags only — never connector/parser technical ids
    tags: extra.tags ? extra.tags.filter((t) => t && !/^(html|rss|atom|opendata|api|xml|json|html-list|none)$/i.test(t)) : [],
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
  const legalRegistry = loadLegalRegistry(REPO);
  const firstSeenMap = loadPreviousFirstSeen(DIR);
  let prevFeed = null;
  try {
    prevFeed = readJson("feed.json");
  } catch {
    prevFeed = null;
  }
  const prevFeedItems = (prevFeed && Array.isArray(prevFeed.items) && prevFeed.items) || [];
  const chmiV2CfgEarly = getChmiCapV2Config(process.env);
  const skipChmiLegacy = shouldSkipChmiLegacyIngest(prevFeedItems, chmiV2CfgEarly);
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
    const legalGate = canPublishFromSource(entry, legalRegistry);
    if (!legalGate.ok) {
      ingestReport.push({
        id: entry.id,
        ok: false,
        reason: "legal_gate:" + legalGate.reason,
        mode: "legal-whitelist",
        lane: entry.lane || resolveLane(entry),
      });
      sourceErrors += 1;
      continue;
    }
    if (ONLY_GROUP && resolveLane(entry) !== ONLY_GROUP) continue;

    let keptTotal = 0;
    const srcStarted = Date.now();
    try {
      if (entry.capIndexUrl) {
        if (entry.id === "chmi" && skipChmiLegacy) {
          // CAP v2 owns ie-chmi-v2-* / monitoring.chmiCapV2. Never legacy-overwrite.
          const preservedN = prevFeedItems.filter(
            (i) => i && String(i.sourceId || "") === "chmi" && (i.capV2 || /^ie-chmi-v2-/i.test(String(i.id || "")))
          ).length;
          ingestReport.push({
            id: entry.id,
            ok: true,
            kept: preservedN,
            reason:
              chmiV2CfgEarly.mode === "active"
                ? "delegated_to_chmi_cap_v2_active"
                : "preserve_existing_chmi_cap_v2_items",
            mode: "cap-v2-namespace-preserve",
            ms: 0,
          });
          keptTotal += preservedN;
        } else {
          keptTotal += await ingestCapIndex(entry, entry.capIndexUrl, nowIso, collected, ingestReport);
        }
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

  // Chronology: source publish time preferred; never invent publish = now
  items = items.map((it) => {
    const chron = applyChronology(it, nowIso, firstSeenMap);
    delete chron._hasSourcePubDate;
    delete chron.timeSourceHint;
    const src = (registry.entries || []).find((e) => e && e.id === chron.sourceId);
    const legalGate = canPublishFromSource(src, legalRegistry);
    return attachLegalProvenance(chron, src, legalGate.legal || null, legalRegistry);
  });

  // Drop any item whose source is no longer legally publishable (stale in-memory mix)
  items = items.filter((it) => {
    const src = (registry.entries || []).find((e) => e && e.id === it.sourceId);
    return canPublishFromSource(src, legalRegistry).ok;
  });

  const beforeWindow = items.length;
  const windowDropped = [];
  items = items.filter((it) => {
    const w = isInActiveFeedWindow(it, nowIso, MAX_AGE_HOURS);
    if (!w.ok) {
      windowDropped.push({ id: it.id, sourceId: it.sourceId, reason: w.reason });
      return false;
    }
    return true;
  });
  const droppedOutsideWindow = beforeWindow - items.length;

  // Guard: large first-seen-only batch → exclude fallback items from active feed
  const fallbackItems = items.filter((it) => it.timeConfidence === "fallback" || !it.publishedAtSource);
  if (fallbackItems.length >= 20) {
    const keepIds = new Set();
    // Keep only CAP/long-lived or already-known captures
    for (const it of items) {
      if (it.publishedAtSource) keepIds.add(it.id);
      else if (it.validTo) keepIds.add(it.id);
      else if (!it.isNewCapture) keepIds.add(it.id);
    }
    const beforeFb = items.length;
    items = items.filter((it) => keepIds.has(it.id));
    console.log(
      "[iu-info-events-refresh] backfill_guard dropped_fallback=" +
        (beforeFb - items.length) +
        " kept=" +
        items.length
    );
  }

  items.sort((a, b) => {
    const di = Number(b.importance || 0) - Number(a.importance || 0);
    if (di) return di;
    return (Date.parse(b.publishedAtSource || b.sortAt || 0) || 0) - (Date.parse(a.publishedAtSource || a.sortAt || 0) || 0);
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

  // Preserve CHMI CAP v2 namespace from previous feed; drop legacy CHMI replacements.
  // Must run BEFORE splitIntoLanes so lane files also keep CAP v2 cards.
  items = composeFeedItemsWithForeignNamespaces(prevFeedItems, items);
  assertChmiCapV2FeedPreserved(prevFeedItems, items);
  const feedChmiV2N = items.filter(
    (i) => i && String(i.sourceId || "") === "chmi" && (i.capV2 || /^ie-chmi-v2-/i.test(String(i.id || "")))
  ).length;

  const dataQuality = buildDataQualityMetrics(items, { nowIso });

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
    activeWindowHours: MAX_AGE_HOURS,
    onlyGroup: ONLY_GROUP || null,
    laneCounts,
    dataQuality,
    chmiCapV2Active: feedChmiV2N > 0 || skipChmiLegacy,
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
      fields: [
        "publishedAtSource",
        "firstSeenByInfoUzel",
        "lastUpdatedBySource",
        "lastProcessedAt",
        "sortAt",
        "validFrom",
        "validTo",
        "resolvedAt",
        "timeSource",
        "timeConfidence",
      ],
      sortRule: "prefer publishedAtSource; else firstSeenByInfoUzel (display only)",
      activeWindowHours: MAX_AGE_HOURS,
      activeWindowRule: "include by publishedAtSource within window; long-lived via validTo/status",
      neverRejuvenateByFirstSeen: true,
    },
    dataQuality,
    chmiCapV2: (() => {
      const cfg = getChmiCapV2Config(process.env);
      const active = cfg.mode === "active";
      return {
        mode: cfg.mode,
        enabled: cfg.enabled,
        shadow: cfg.shadow,
        legacyProductionPath: isLegacyProductionPath(cfg),
        productionPublishV2: active,
        intervalMinutes: 15,
        note:
          cfg.mode === "off"
            ? "CAP v2 flag off — legacy CHMI CAP ingest unchanged"
            : cfg.mode === "shadow"
              ? "CAP v2 shadow only — does not replace production snapshot; run scripts/chmi-cap-v2-shadow-run.mjs for fixture audit"
              : "CAP v2 active — production CHMI items published by update-chmi-cap-v2 (15 min, max 1 bulletin)",
      };
    })(),
  };

  const failedConnectors = ingestReport.filter((r) => !r.ok);
  let prevMonitoring = null;
  try {
    prevMonitoring = readJson("monitoring.json");
  } catch {
    prevMonitoring = null;
  }
  const monitoringBase = {
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
    droppedOutsideActiveWindow: droppedOutsideWindow,
    dataQuality,
    commercialAggregationActive: !!cutover.commercialAggregationActive,
  };
  const monitoringOwned = enrichMonitoringV3(monitoringBase, prevMonitoring, nowIso);
  const monitoring = composeMonitoringWithForeignNamespaces(prevMonitoring, monitoringOwned);
  assertMonitoringForeignNamespacesPreserved(prevMonitoring, monitoring);

  // Fail-closed if CAP v2 items exist in feed but monitoring lost the ops block.
  if (feedChmiV2N > 0 && !(monitoring.chmiCapV2 && typeof monitoring.chmiCapV2 === "object")) {
    if (prevMonitoring && prevMonitoring.chmiCapV2) {
      throw new Error("MONITORING_COMPOSE_ABORT: chmiCapV2 required when CAP v2 feed items are present");
    }
  }

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
  console.log("[iu-info-events-refresh] maxAgeHours=" + MAX_AGE_HOURS);
  console.log("[iu-info-events-refresh] droppedOutsideWindow=" + droppedOutsideWindow);
  console.log("[iu-info-events-refresh] droppedHomepageUrls=" + droppedHome);
  console.log("[iu-info-events-refresh] removedDuplicates=" + removedDupes);
  console.log("[iu-info-events-refresh] failedConnectors=" + failedConnectors.length);
  console.log("[iu-info-events-refresh] dataQuality=" + JSON.stringify(dataQuality));
  console.log("[iu-info-events-refresh] lanes=" + JSON.stringify(laneCounts));
  console.log("[iu-info-events-refresh] commercialAggregationActive=" + monitoring.commercialAggregationActive);
  if (failedConnectors.length) {
    for (const f of failedConnectors.slice(0, 12)) {
      console.log("[iu-info-events-refresh] FAIL_CONNECTOR id=" + f.id + " reason=" + (f.reason || ""));
    }
  }
  if (feed.itemCount < 5) {
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
