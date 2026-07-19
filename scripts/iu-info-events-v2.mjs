/**
 * Přehled dne V2 — lanes, chronology merge, atomic publish, metadata.
 */
import fs from "fs";
import path from "path";
import { canonicalizeUrl } from "./iu-info-events-lib.mjs";

export const IU_INFO_EVENTS_V2 = "2.0.0";

export const LANE_IDS = [
  "doprava",
  "pocasi",
  "bezpecnost",
  "ministerstva",
  "ekonomika",
  "zdravotnictvi",
  "skoly-kultura",
  "regionalni",
  "verejnopravni-media",
  "ostatni",
];

/** Map registry group / id → pipeline lane (independent update groups). */
export function resolveLane(entry) {
  if (entry && entry.lane) return entry.lane;
  const id = String((entry && entry.id) || "");
  const g = String((entry && entry.group) || "");
  if (id.startsWith("kraj-") || g === "verejna-sprava" && id.includes("kraj")) return "regionalni";
  if (g === "doprava") return "doprava";
  if (g === "pocasi" || g === "chmi") return "pocasi";
  if (g === "policie" || g === "hzs" || g === "kyber") return "bezpecnost";
  if (g === "ministerstva") return "ministerstva";
  if (g === "zdravotnictvi" || g === "hygiena") return "zdravotnictvi";
  if (g === "skoly" || g === "kultura" || g === "veda" || g === "sport") return "skoly-kultura";
  if (g === "verejnopravni-media") return "verejnopravni-media";
  if (g === "stat" || g === "ekonomika") return "ekonomika";
  if (g === "verejna-sprava") return "ministerstva";
  return "ostatni";
}

export function resolveConnectorType(entry) {
  if (entry && entry.connectorType) return entry.connectorType;
  if (entry && entry.capIndexUrl) return "opendata";
  if (entry && (entry.feedUrl || (entry.feedUrls && entry.feedUrls.length))) return "rss";
  if (entry && (entry.htmlListUrl || (entry.htmlListUrls && entry.htmlListUrls.length))) return "html";
  return "none";
}

export function resolveOrgType(entry) {
  if (entry && entry.orgType) return entry.orgType;
  const g = String((entry && entry.group) || "");
  if (g === "policie" || g === "hzs") return "security";
  if (g === "ministerstva" || g === "verejna-sprava") return "government";
  if (g === "pocasi") return "meteo";
  if (g === "doprava") return "transport";
  if (g === "zdravotnictvi" || g === "hygiena") return "health";
  if (g === "verejnopravni-media") return "public-media";
  if (g === "veda" || g === "skoly") return "education-science";
  if (g === "kultura") return "culture";
  if (g === "stat") return "agency";
  if (g === "kyber") return "cyber";
  return "public";
}

/** Default update interval minutes by connector type / lane (overridable per entry.periodicityMin). */
export function defaultPeriodicityMin(entry) {
  if (entry && Number(entry.periodicityMin) > 0) return Number(entry.periodicityMin);
  const t = resolveConnectorType(entry);
  const lane = resolveLane(entry);
  if (lane === "pocasi" || lane === "bezpecnost" || lane === "doprava") return 15;
  if (t === "opendata" || t === "api") return 20;
  if (t === "rss" || t === "atom") return 30;
  if (t === "html") return 60;
  return 60;
}

export function buildConnectorGroups() {
  return LANE_IDS.map((id) => ({
    id,
    label: id,
    independent: true,
    defaultCronHint:
      id === "pocasi" || id === "bezpecnost" || id === "doprava"
        ? "*/15 * * * *"
        : id === "regionalni"
          ? "0 * * * *"
          : "*/30 * * * *",
  }));
}

export function buildPersonalizationMeta() {
  return {
    version: "4.0.0",
    localStorageKey: "iu.infoEvents.prefs.v1",
    viewsKey: "iu.infoEvents.views.v1",
    alertsKey: "iu.infoEvents.alerts.v1",
    alertStateKey: "iu.infoEvents.alertState.v1",
    scrollKey: "iu.infoEvents.scroll.v1",
    filterDimensions: [
      { id: "institution", path: "sourceName", label: "Instituce" },
      { id: "sourceId", path: "sourceId", label: "Zdroj" },
      { id: "orgType", path: "orgType", label: "Typ organizace" },
      { id: "lane", path: "lane", label: "Skupina" },
      { id: "connectorType", path: "connectorType", label: "Typ konektoru" },
      { id: "regionLevel", path: "region.level", label: "Úroveň regionu" },
      { id: "regionName", path: "region.name", label: "Region" },
      { id: "homeKraj", path: "local.homeKraj", label: "Domovský kraj" },
      { id: "homeOkres", path: "local.homeOkres", label: "Domovský okres" },
      { id: "homeObec", path: "local.homeObec", label: "Domovská obec" },
      { id: "sectionId", path: "sectionId", label: "Téma" },
      { id: "subsectionId", path: "subsectionId", label: "Podtéma" },
      { id: "eventType", path: "eventType", label: "Typ události" },
      { id: "importance", path: "importance", label: "Priorita" },
      { id: "timeRange", path: "sortAt", type: "range", label: "Časové období" },
      { id: "searchQuery", path: "title", label: "Fulltext" },
      { id: "activeOnly", path: "status", label: "Pouze aktivní" },
      { id: "newOnly", path: "firstSeenByInfoUzel", label: "Pouze nové" },
      { id: "unreadOnly", path: "local.read", label: "Pouze nepřečtené" },
      { id: "savedOnly", path: "local.saved", label: "Pouze uložené" },
      { id: "favorites", path: "local.favorites", label: "Oblíbené" },
      { id: "savedViews", path: "local.views", label: "Uložené pohledy" },
      { id: "localAlerts", path: "local.alerts", label: "Lokální upozornění" },
    ],
    favoriteDimensions: ["favoriteSourceIds", "favoriteLanes", "favoriteRegions", "favoriteInstitutions"],
    regionalPersonalization: ["homeKraj", "homeOkres", "homeObec", "myRegionOnly", "regionalDoprava", "regionalKrize", "regionalZdravi"],
    localAlerts: {
      pushServer: false,
      note: "Pouze lokální vyhodnocení v prohlížeči — bez server push.",
    },
    performance: {
      indexedFilter: true,
      pageSize: 50,
      memoizedFilter: true,
    },
    note: "UI personalizace V4 — pohledy, regiony, lokální upozornění, výkon při tisících položek.",
  };
}

/** Enrich monitoring with dataset ages, stale alerts, structure change, outage history. */
export function enrichMonitoringV3(monitoring, prevMonitoring, nowIso) {
  const prev = prevMonitoring && typeof prevMonitoring === "object" ? prevMonitoring : {};
  const prevById = new Map();
  for (const s of prev.sources || []) {
    if (s && s.id) prevById.set(String(s.id), s);
  }
  const prevOutages = Array.isArray(prev.outageHistory) ? prev.outageHistory.slice(-80) : [];
  const outageHistory = prevOutages.slice();
  const alerts = [];
  const clock = Date.parse(nowIso || "") || Date.now();
  const datasetAges = {
    feedGeneratedAt: monitoring.generatedAt || nowIso,
    feedAgeHours: null,
    lanes: monitoring.laneCounts || {},
  };
  const genMs = Date.parse(monitoring.generatedAt || nowIso) || clock;
  datasetAges.feedAgeHours = Math.max(0, Math.round(((clock - genMs) / 3600000) * 10) / 10);

  const sources = (monitoring.sources || []).map((s) => {
    const mon = Object.assign({}, s.monitoring || {});
    const prevS = prevById.get(String(s.id));
    const prevMon = (prevS && prevS.monitoring) || {};
    const lastSuccess = Date.parse(mon.lastSuccessAt || "") || 0;
    const period = Number(s.periodicityMin || mon.periodicityMin || 60);
    const staleAfterMs = Math.max(period, 30) * 3 * 60000;
    let dataAgeHours = mon.dataAgeHours;
    if (lastSuccess) {
      dataAgeHours = Math.max(0, Math.round(((clock - lastSuccess) / 3600000) * 10) / 10);
    }
    let structureChange = mon.structureChange || "none";
    const prevKept = Number(prevMon.itemsKept || 0);
    const kept = Number(mon.itemsKept || 0);
    if (prevKept >= 5 && kept === 0) {
      structureChange = "possible_empty_or_structure_change";
      alerts.push({
        type: "structure_change",
        sourceId: s.id,
        at: nowIso,
        detail: `itemsKept ${prevKept} → ${kept}`,
      });
    }
    const availability = mon.availability || "unknown";
    const isStale = !!(lastSuccess && clock - lastSuccess > staleAfterMs);
    if (availability !== "ok" || isStale) {
      const alertType = availability !== "ok" ? "connector_down" : "stale_source";
      alerts.push({
        type: alertType,
        sourceId: s.id,
        at: nowIso,
        detail:
          availability !== "ok"
            ? `availability=${availability}`
            : `lastSuccessAt=${mon.lastSuccessAt || "null"} periodMin=${period}`,
      });
      if (availability !== "ok") {
        outageHistory.push({
          sourceId: s.id,
          at: nowIso,
          status: mon.lastProbeStatus || 0,
          reason: mon.lastError || availability,
        });
      }
    }
    return Object.assign({}, s, {
      monitoring: Object.assign({}, mon, {
        dataAgeHours,
        structureChange,
        stale: isStale || kept === 0,
      }),
    });
  });

  return Object.assign({}, monitoring, {
    version: "3.0.0",
    datasetAges,
    alerts: alerts.slice(0, 40),
    outageHistory: outageHistory.slice(-100),
    sources,
  });
}

export function regionalAdapterSpec() {
  return {
    type: "html-list",
    description: "Škálovatelný adaptér pro kraje/města/obce — konfigurace, ne stovky kopií kódu.",
    requiredFields: ["id", "label", "url", "htmlListUrl", "htmlPathInclude", "defaultRegion"],
    optionalFields: ["periodicityMin", "lane", "orgType", "feedUrl"],
    example: {
      id: "kraj-example",
      label: "Příklad kraj",
      url: "https://example.cz/",
      htmlListUrl: "https://example.cz/aktuality",
      htmlPathInclude: "aktuality/",
      defaultRegion: { level: "kraj", name: "Příklad" },
      lane: "regionalni",
      connectorType: "html",
      productionActive: true,
      productionApproved: true,
      legalStatus: "approved",
    },
  };
}

/** Preserve firstSeenByInfoUzel across refreshes (by canonical URL). */
export function loadPreviousFirstSeen(dir) {
  const map = new Map();
  try {
    const feed = JSON.parse(fs.readFileSync(path.join(dir, "feed.json"), "utf8"));
    for (const it of feed.items || []) {
      const key = canonicalizeUrl(it.canonicalUrl || it.url || "").toLowerCase();
      if (!key) continue;
      const first = it.firstSeenByInfoUzel || it.publishedAt || it.updatedAt;
      if (first) map.set(key, first);
    }
  } catch {
    /* no previous */
  }
  return map;
}

export function applyChronology(item, nowIso, firstSeenMap) {
  const key = canonicalizeUrl(item.canonicalUrl || item.url || "").toLowerCase();
  const hasSourceTime = !!(item._hasSourcePubDate && item.publishedAtSource);
  const sourcePub = hasSourceTime ? String(item.publishedAtSource) : null;
  const prevFirst = key ? firstSeenMap.get(key) : null;
  const firstSeen = prevFirst || nowIso;
  const lastUpdatedBySource = sourcePub || item.lastUpdatedBySource || null;
  const sortAt = sourcePub || firstSeen;
  return Object.assign({}, item, {
    publishedAtSource: sourcePub,
    firstSeenByInfoUzel: firstSeen,
    lastUpdatedBySource: lastUpdatedBySource || firstSeen,
    lastProcessedAt: nowIso,
    sortAt,
    publishedAt: sortAt,
    updatedAt: nowIso,
  });
}

export function splitIntoLanes(items) {
  const lanes = {};
  for (const id of LANE_IDS) lanes[id] = [];
  for (const it of items || []) {
    const lane = LANE_IDS.includes(it.lane) ? it.lane : "ostatni";
    lanes[lane].push(it);
  }
  return lanes;
}

function writeJsonAtomic(filePath, obj) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Atomic publish: stage → validate → promote → manifest last.
 * Keeps feed.prev.json for rollback.
 */
export function atomicPublishInfoEvents(dir, payload, validateFn) {
  const staging = path.join(dir, "_staging");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, "lanes"), { recursive: true });

  const generationId = payload.generationId || new Date().toISOString().replace(/[:.]/g, "-");
  const files = payload.files || {};

  for (const [rel, obj] of Object.entries(files)) {
    const dest = path.join(staging, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(obj, null, 2) + "\n", "utf8");
  }

  if (typeof validateFn === "function") {
    const result = validateFn(staging, payload);
    if (!result || result.ok !== true) {
      const msg = (result && result.error) || "staging validation failed";
      throw new Error("ATOMIC_PUBLISH_ABORT: " + msg);
    }
  }

  // Rollback snapshot of previous main feed
  const liveFeed = path.join(dir, "feed.json");
  if (fs.existsSync(liveFeed)) {
    try {
      fs.copyFileSync(liveFeed, path.join(dir, "feed.prev.json"));
    } catch {
      /* ignore */
    }
  }

  for (const rel of Object.keys(files)) {
    const from = path.join(staging, rel);
    const to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  const manifest = {
    schemaVersion: IU_INFO_EVENTS_V2,
    generationId,
    generatedAt: payload.generatedAt,
    publishedAt: new Date().toISOString(),
    itemCount: payload.itemCount,
    lanes: LANE_IDS.map((id) => ({
      id,
      path: `lanes/${id}.json`,
      itemCount: (payload.laneCounts && payload.laneCounts[id]) || 0,
    })),
    datasets: {
      feed: "feed.json",
      taxonomy: "taxonomy.json",
      sourceRegistry: "source_registry.json",
      metadata: "metadata.json",
      monitoring: "monitoring.json",
      cutover: "cutover_state.json",
      previousFeed: "feed.prev.json",
    },
    rollback: {
      previousFeed: "feed.prev.json",
      note: "Při chybě dalšího publish zůstává feed.prev.json + poslední validní manifest.",
    },
    frontend: {
      localFirst: true,
      sourceWebFetchForbidden: true,
      load: ["manifest.json", "taxonomy.json", "source_registry.json", "metadata.json", "feed.json"],
      optionalLanes: "lanes/{id}.json",
    },
  };
  writeJsonAtomic(path.join(dir, "manifest.json"), manifest);

  try {
    fs.rmSync(staging, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return manifest;
}

export function validateStagingFeed(stagingDir) {
  try {
    const feed = JSON.parse(fs.readFileSync(path.join(stagingDir, "feed.json"), "utf8"));
    if (!Array.isArray(feed.items) || feed.items.length < 50) {
      return { ok: false, error: "feed.items < 50" };
    }
    for (const it of feed.items.slice(0, 20)) {
      if (!it.url || !it.sortAt) return { ok: false, error: "missing url/sortAt on sample item" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
