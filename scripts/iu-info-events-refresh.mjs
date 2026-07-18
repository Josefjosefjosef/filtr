#!/usr/bin/env node
/**
 * Production connector refresh for Přehled dne (info_events).
 * Fetches official/public RSS (and optional HTML listing pages), keeps only concrete item URLs.
 * Run: node scripts/iu-info-events-refresh.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  decodeXmlEntities,
  dedupeByUrlAndGroup,
  extractFeedItems,
  extractHtmlListItems,
  fetchText,
  isConcreteItemUrl,
  looksLikeFeedXml,
  makeGroupKey,
  makeItemId,
  mapGroupToSection,
  normalizeItemUrl,
  stripHtml,
} from "./iu-info-events-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, "projects", "data", "info_events");

const MAX_ITEMS = Number(process.env.IU_INFO_EVENTS_MAX_ITEMS || "250");
const MAX_AGE_HOURS = Number(process.env.IU_INFO_EVENTS_MAX_AGE_HOURS || "96");
const PER_FEED_CAP = Number(process.env.IU_INFO_EVENTS_PER_FEED_CAP || "25");
const PER_SOURCE_CAP = Number(process.env.IU_INFO_EVENTS_PER_SOURCE_CAP || "35");

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

function scoreImportance(title, group) {
  const t = String(title || "").toLowerCase();
  let n = 2;
  if (/výstrah|mimorad|mimořád|varování|krize|povod|bouř|nehod|útok|kyber/i.test(t)) n = 5;
  else if (/omezení|výluka|uzavír|epidem|stažení|varuje/i.test(t)) n = 4;
  else if (/tiskov|rozhodnutí|nařízení|vyhláš/i.test(t)) n = 3;
  if (group === "policie" || group === "hzs" || group === "pocasi") n = Math.max(n, 3);
  return n;
}

async function ingestFeedUrl(entry, feedUrl, nowIso, collected, report) {
  const home = entry.url || "";
  try {
    const { ok, status, text } = await fetchText(feedUrl);
    if (!ok || !looksLikeFeedXml(text)) {
      report.push({ id: entry.id, feedUrl, ok: false, status, reason: "not_feed" });
      return;
    }
    const rawItems = extractFeedItems(text).slice(0, PER_FEED_CAP);
    let kept = 0;
    for (const raw of rawItems) {
      const url = normalizeItemUrl(raw.link, feedUrl);
      const title = stripHtml(raw.title);
      if (!title || !url) continue;
      if (!isConcreteItemUrl(url, home)) continue;
      const publishedAt = toIso(raw.pubDate) || nowIso;
      const ageH = (Date.parse(nowIso) - Date.parse(publishedAt)) / 3600000;
      if (Number.isFinite(ageH) && ageH > MAX_AGE_HOURS) continue;
      const sec = mapGroupToSection(entry.defaultSectionGroup || entry.group);
      const item = {
        id: makeItemId(entry.id, url, publishedAt),
        title,
        sourceId: entry.id,
        sourceLabel: entry.label || entry.id,
        url,
        sectionId: entry.defaultSectionId || sec.sectionId,
        subsectionId: entry.defaultSubsectionId || sec.subsectionId,
        eventType: "prave-probihajici",
        status: "aktivni",
        importance: scoreImportance(title, entry.group),
        impact: scoreImportance(title, entry.group),
        region: entry.defaultRegion || { level: "cr", name: "Česká republika" },
        publishedAt,
        updatedAt: nowIso,
        groupKey: makeGroupKey(title, publishedAt),
        tags: [entry.group].filter(Boolean),
        links: [],
      };
      collected.push(item);
      kept += 1;
    }
    report.push({ id: entry.id, feedUrl, ok: true, status, kept, raw: rawItems.length });
  } catch (e) {
    report.push({
      id: entry.id,
      feedUrl,
      ok: false,
      status: 0,
      reason: String(e && e.message ? e.message : e),
    });
  }
}

async function ingestHtmlList(entry, listUrl, nowIso, collected, report) {
  const home = entry.url || "";
  try {
    const { ok, status, text } = await fetchText(listUrl);
    if (!ok) {
      report.push({ id: entry.id, listUrl, ok: false, status, reason: "html_fetch_fail" });
      return;
    }
    const rawItems = extractHtmlListItems(text, listUrl, { homeUrl: home, max: PER_FEED_CAP });
    let kept = 0;
    for (const raw of rawItems) {
      const url = normalizeItemUrl(raw.link, listUrl);
      const title = stripHtml(raw.title);
      if (!title || !url || !isConcreteItemUrl(url, home)) continue;
      const publishedAt = nowIso;
      const sec = mapGroupToSection(entry.defaultSectionGroup || entry.group);
      collected.push({
        id: makeItemId(entry.id, url, publishedAt),
        title,
        sourceId: entry.id,
        sourceLabel: entry.label || entry.id,
        url,
        sectionId: entry.defaultSectionId || sec.sectionId,
        subsectionId: entry.defaultSubsectionId || sec.subsectionId,
        eventType: "prave-probihajici",
        status: "aktivni",
        importance: scoreImportance(title, entry.group),
        impact: scoreImportance(title, entry.group),
        region: entry.defaultRegion || { level: "cr", name: "Česká republika" },
        publishedAt,
        updatedAt: nowIso,
        groupKey: makeGroupKey(title, publishedAt),
        tags: [entry.group, "html-list"].filter(Boolean),
        links: [],
      });
      kept += 1;
    }
    report.push({ id: entry.id, listUrl, ok: true, status, kept, raw: rawItems.length, mode: "html" });
  } catch (e) {
    report.push({
      id: entry.id,
      listUrl,
      ok: false,
      status: 0,
      reason: String(e && e.message ? e.message : e),
      mode: "html",
    });
  }
}

async function main() {
  const nowIso = new Date().toISOString();
  const registry = readJson("source_registry.json");
  const cutover = readJson("cutover_state.json");
  const collected = [];
  const ingestReport = [];

  for (const entry of registry.entries || []) {
    if (!entry.productionActive || !entry.productionApproved) continue;
    if (entry.legalStatus !== "approved") continue;

    const feedUrls = []
      .concat(entry.feedUrl ? [entry.feedUrl] : [])
      .concat(Array.isArray(entry.feedUrls) ? entry.feedUrls : [])
      .map((u) => String(u || "").trim())
      .filter(Boolean);

    for (const fu of feedUrls) {
      await ingestFeedUrl(entry, fu, nowIso, collected, ingestReport);
    }

    const listUrls = []
      .concat(entry.htmlListUrl ? [entry.htmlListUrl] : [])
      .concat(Array.isArray(entry.htmlListUrls) ? entry.htmlListUrls : [])
      .map((u) => String(u || "").trim())
      .filter(Boolean);
    // HTML listing only when no RSS produced items for this source
    const gotRss = ingestReport.some((r) => r.id === entry.id && r.ok && (r.kept || 0) > 0 && r.mode !== "html");
    if (!gotRss) {
      for (const lu of listUrls) {
        await ingestHtmlList(entry, lu, nowIso, collected, ingestReport);
      }
    }

    // Probe home for monitoring
    let probe = { ok: false, status: 0 };
    try {
      const homeProbe = await fetchText(entry.url, 8000);
      probe = { ok: homeProbe.ok, status: homeProbe.status };
    } catch {
      probe = { ok: false, status: 0 };
    }
    entry.technicalStatus = probe.ok ? "ok" : "down";
    entry.lastAuditAt = nowIso;
    entry.monitoring = {
      availability: probe.ok ? "ok" : "down",
      freshness: gotRss || listUrls.length ? "ok" : "unknown",
      structureChange: "none",
      lastProbeStatus: probe.status,
      lastProbeAt: nowIso,
      connector: feedUrls.length ? "rss" : listUrls.length ? "html-list" : "none",
    };
  }

  let items = dedupeByUrlAndGroup(collected);
  items.sort((a, b) => {
    const di = Number(b.importance || 0) - Number(a.importance || 0);
    if (di) return di;
    return (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0);
  });
  // Per-source fairness so multi-section public media cannot crowd out official agencies
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

  // Reject any residual homepage URLs (hard gate)
  const before = items.length;
  items = items.filter((it) => isConcreteItemUrl(it.url, null));
  const droppedHome = before - items.length;

  const feed = {
    version: "1.1.0",
    generatedAt: nowIso,
    connector: "iu-info-events-refresh",
    itemCount: items.length,
    maxAgeHours: MAX_AGE_HOURS,
    items,
  };

  const monitoring = {
    version: "1.1.0",
    generatedAt: nowIso,
    cutover,
    feedItemCount: items.length,
    droppedHomepageUrls: droppedHome,
    ingest: ingestReport,
    sources: (registry.entries || [])
      .filter((e) => e.productionActive)
      .map((e) => ({
        id: e.id,
        label: e.label,
        url: e.url,
        feedUrl: e.feedUrl || (e.feedUrls && e.feedUrls[0]) || null,
        legalStatus: e.legalStatus,
        technicalStatus: e.technicalStatus,
        productionActive: e.productionActive,
        monitoring: e.monitoring || null,
      })),
    dedupeGroups: new Set(items.map((i) => i.groupKey).filter(Boolean)).size,
    commercialAggregationActive: !!cutover.commercialAggregationActive,
  };

  writeJson("source_registry.json", registry);
  writeJson("feed.json", feed);
  writeJson("monitoring.json", monitoring);

  const activeConnectors = ingestReport.filter((r) => r.ok && (r.kept || 0) > 0).length;
  console.log("[iu-info-events-refresh] sourcesActive=" + monitoring.sources.length);
  console.log("[iu-info-events-refresh] connectorsWithItems=" + activeConnectors);
  console.log("[iu-info-events-refresh] feedItems=" + feed.itemCount);
  console.log("[iu-info-events-refresh] droppedHomepageUrls=" + droppedHome);
  console.log("[iu-info-events-refresh] commercialAggregationActive=" + monitoring.commercialAggregationActive);
  if (feed.itemCount < 30) {
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
