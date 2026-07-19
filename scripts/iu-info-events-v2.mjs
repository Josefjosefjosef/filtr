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
    version: IU_INFO_EVENTS_V2,
    filterDimensions: [
      { id: "institution", path: "sourceName", label: "Instituce" },
      { id: "sourceId", path: "sourceId", label: "Zdroj" },
      { id: "orgType", path: "orgType", label: "Typ organizace" },
      { id: "lane", path: "lane", label: "Skupina" },
      { id: "connectorType", path: "connectorType", label: "Typ konektoru" },
      { id: "regionLevel", path: "region.level", label: "Úroveň regionu" },
      { id: "regionName", path: "region.name", label: "Region" },
      { id: "sectionId", path: "sectionId", label: "Téma" },
      { id: "subsectionId", path: "subsectionId", label: "Podtéma" },
      { id: "eventType", path: "eventType", label: "Typ události" },
      { id: "importance", path: "importance", label: "Priorita" },
      { id: "timeRange", path: "sortAt", type: "range", label: "Časové období" },
    ],
    note: "Datová architektura filtrů — UI personalizace se napojí později bez redesignu feedu.",
  };
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
