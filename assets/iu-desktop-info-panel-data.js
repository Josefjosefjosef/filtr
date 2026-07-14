/**
 * PC informační panel V4 — katalog + same-origin snapshot merge.
 */
import {
  IU_INFO_PANEL_CATALOG,
  IU_INFO_PANEL_CATALOG_COUNT,
  IU_INFO_PANEL_ORDER_IDS,
  IU_INFO_PANEL_EXCLUDED,
} from "./iu-desktop-info-panel-catalog.js";
import {
  isCnbPublicationBehindExpected,
  parseCzechDailyDate,
} from "./iu-cnb-exchange-utils.js";

export {
  IU_INFO_PANEL_CATALOG,
  IU_INFO_PANEL_CATALOG_COUNT,
  IU_INFO_PANEL_ORDER_IDS,
  IU_INFO_PANEL_EXCLUDED,
};

export const IU_INFO_PANEL_DISCLAIMER =
  "Údaje slouží pouze pro rychlou orientaci. Před důležitým rozhodnutím doporučujeme ověřit informace přímo u oficiálního poskytovatele.";

export const IU_INFO_PANEL_MINDMENU_GAP_PX = 30;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SNAPSHOT_URL = "/projects/data/info_panel_snapshot.json";
const LIVE_OK = new Set(["verified_free_ok", "verified_requires_attribution"]);
const DEFAULT_MAX_AGE_MS = 48 * HOUR_MS;

const CZ_MONTHS = {
  leden: 1,
  unor: 2,
  únor: 2,
  brezen: 3,
  březen: 3,
  duben: 4,
  kveten: 5,
  květen: 5,
  cerven: 6,
  červen: 6,
  cervenec: 7,
  červenec: 7,
  srpen: 8,
  zari: 9,
  září: 9,
  rijen: 10,
  říjen: 10,
  listopad: 11,
  prosinec: 12,
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatNumber(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n >= 1000) {
    return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
  }
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatIsoTimestampLabel(raw) {
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
    }
  } catch (_) {}
  return "";
}

function formatUpdatedAtLabel(raw, generatedAt) {
  const s = String(raw || "").trim();
  if (s) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const formatted = formatIsoTimestampLabel(s);
      if (formatted) return formatted;
    }
    return s;
  }
  if (generatedAt) {
    const formatted = formatIsoTimestampLabel(generatedAt);
    if (formatted) return formatted;
  }
  return "";
}

/** Publication period label → sortable key (higher = newer). Not a wall-clock timestamp. */
export function infoPanelPeriodSortKey(period) {
  const s = String(period || "").trim();
  const czWeek = s.match(/(\d{1,2})\.\s*t[yý]den\s*(\d{4})/i);
  if (czWeek) return parseInt(czWeek[2], 10) * 100 + parseInt(czWeek[1], 10);
  const czMonth = s.match(/^([a-záčďéěíňóřšťúůýž]+)\s+(\d{4})$/i);
  if (czMonth) {
    const m = CZ_MONTHS[normalizeText(czMonth[1])] || CZ_MONTHS[czMonth[1].toLowerCase()] || 0;
    if (m) return parseInt(czMonth[2], 10) * 100 + m;
  }
  const schoolYear = s.match(/^(\d{4})\/(\d{4})$/);
  if (schoolYear) return parseInt(schoolYear[1], 10) * 100 + 99;
  const czQuarter = s.match(/(\d)\.\s*ctvrtlet[ií]\s*(\d{4})/i);
  if (czQuarter) return parseInt(czQuarter[2], 10) * 100 + parseInt(czQuarter[1], 10);
  const w = s.match(/(\d{4})[-\s]?W(\d{1,2})/i);
  if (w) return parseInt(w[1], 10) * 100 + parseInt(w[2], 10);
  const m = s.match(/(\d{4})[-\s]?M(\d{1,2})/i);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  const date = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (date) return parseInt(date[3], 10) * 10000 + parseInt(date[2], 10) * 100 + parseInt(date[1], 10);
  const y = s.match(/^(\d{4})$/);
  if (y) return parseInt(y[1], 10) * 100;
  return 0;
}

function parseCzechDailyDateLocal(period) {
  return parseCzechDailyDate(period);
}

function countBusinessDaysBetween(startDate, endDate) {
  if (!startDate || !endDate) return Number.POSITIVE_INFINITY;
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  if (end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function resolveSnapshotFetchAnchor(catalogItem, snapshotMeta) {
  const bucket = catalogItem && catalogItem.fetchBucket;
  if (snapshotMeta && snapshotMeta.bucketFetchedAt && bucket && snapshotMeta.bucketFetchedAt[bucket]) {
    const bucketAt = Date.parse(snapshotMeta.bucketFetchedAt[bucket]);
    if (Number.isFinite(bucketAt)) return bucketAt;
  }
  if (snapshotMeta && snapshotMeta.generatedAt) {
    const genAt = Date.parse(snapshotMeta.generatedAt);
    if (Number.isFinite(genAt)) return genAt;
  }
  return NaN;
}

function maxBusinessDaysForDaily(maxAgeMs) {
  const days = Math.max(2, Math.round((maxAgeMs > 0 ? maxAgeMs : 2 * DAY_MS) / DAY_MS));
  return Math.max(5, days + 3);
}

function isDailyDataPeriodStale(catalogItem, row) {
  if (catalogItem && catalogItem.fetchBucket === "cnb") {
    return isCnbPublicationBehindExpected(row && row.updatedAt);
  }
  const dataDate = parseCzechDailyDateLocal(row && row.updatedAt);
  if (!dataDate) {
    return false;
  }
  const maxBusinessDays = maxBusinessDaysForDaily(catalogItem.maxAgeMs);
  return countBusinessDaysBetween(dataDate, new Date()) > maxBusinessDays;
}

function isCnbSnapshotRowStale(row) {
  if (!row || typeof row.value !== "number") return true;
  return isCnbPublicationBehindExpected(row.updatedAt);
}

function isFetchAnchorStale(maxAgeMs, anchorAt) {
  if (!Number.isFinite(anchorAt)) return true;
  const maxAge = maxAgeMs > 0 ? maxAgeMs : DEFAULT_MAX_AGE_MS;
  return Date.now() - anchorAt > maxAge;
}

function isSnapshotRowStale(catalogItem, row, snapshotMeta) {
  if (!row) return true;

  const freq = String(catalogItem.publishFrequency || "monthly").toLowerCase();
  const maxAge = catalogItem.maxAgeMs > 0 ? catalogItem.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const fetchAnchor = resolveSnapshotFetchAnchor(catalogItem, snapshotMeta);

  if (freq === "hourly") {
    if (!isFetchAnchorStale(maxAge, fetchAnchor)) return false;
    if (typeof row.value === "number") return false;
    return true;
  }

  if (freq === "daily") {
    if (catalogItem.fetchBucket === "cnb") {
      return isCnbSnapshotRowStale(row);
    }
    if (!isFetchAnchorStale(maxAge, fetchAnchor)) return false;
    if (parseCzechDailyDateLocal(row && row.updatedAt) && !isDailyDataPeriodStale(catalogItem, row)) {
      return false;
    }
    return true;
  }

  if (
    freq === "weekly" ||
    freq === "monthly" ||
    freq === "quarterly" ||
    freq === "annual" ||
    freq === "event"
  ) {
    if (typeof row.value === "number") return false;
    if (!Number.isFinite(fetchAnchor)) return true;
    return isFetchAnchorStale(maxAge, fetchAnchor);
  }

  return isFetchAnchorStale(maxAge, fetchAnchor);
}

function snapshotErrorAffectsItem(catalogItem, errorId) {
  const id = String(errorId || "");
  if (!id) return false;
  if (id === catalogItem.id) return true;
  if (catalogItem.fetchBucket && id === catalogItem.fetchBucket) return true;
  if ((catalogItem.id === "eur_czk" || catalogItem.id === "usd_czk") && id === "cnb") return true;
  if (catalogItem.id === "bitcoin" && (id === "bitcoin" || id === "coingecko")) return true;
  if (catalogItem.id === "gold" && (id === "gold" || id === "coingecko")) return true;
  if ((catalogItem.id === "fuel" || catalogItem.id === "transport") && id === "csu_fuel") return true;
  if (catalogItem.id === "electricity" && id === "csu_coicop") return true;
  if (catalogItem.id === "inflation" && id === "csu_inflation") return true;
  if (
    (catalogItem.id === "unemployment" ||
      catalogItem.id === "job_vacancies" ||
      catalogItem.id === "registered_unemployment") &&
    id === "csu_labor_reg"
  ) {
    return true;
  }
  return false;
}

function mergeItem(catalogItem, snapRow, snapshotMeta) {
  const base = { ...catalogItem };
  const canLive = LIVE_OK.has(catalogItem.legalStatus);
  const row = snapRow && typeof snapRow === "object" ? snapRow : null;
  const hasNumericRow = !!(row && typeof row.value === "number" && row.isLive);
  const snapshotFailed =
    canLive &&
    !hasNumericRow &&
    snapshotMeta &&
    snapshotMeta.errors &&
    snapshotMeta.errors.some((e) => e && snapshotErrorAffectsItem(catalogItem, e.id));

  if (snapshotFailed) {
    base.state = "error";
    base.isLive = false;
    base.isVerified = true;
    base.primaryValue = "Data nyní nejsou dostupná";
    base.secondaryValue = "Zkuste to později";
    base.trendDirection = "neutral";
    base.updatedAt = "";
    base.updatedAtDisplay = "";
    base.errorState = "fetch_failed";
    return base;
  }

  const liveCandidate = !!(row && row.isLive && LIVE_OK.has(row.legalStatus || catalogItem.legalStatus));
  const stale = liveCandidate && isSnapshotRowStale(catalogItem, row, snapshotMeta);

  if (liveCandidate && !stale && typeof row.value === "number") {
    base.state = "live";
    base.isLive = true;
    base.isVerified = true;
    const unit = row.unit || catalogItem.unit;
    const unitSuffix = unit ? " " + unit : "";
    base.primaryLabel = row.primaryLabel != null && row.primaryLabel !== "" ? row.primaryLabel : catalogItem.primaryLabel;
    base.primaryValue = formatNumber(row.value) + unitSuffix;
    base.secondaryValue = row.secondaryValue || "beze změny";
    base.trendDirection = row.trendDirection || "flat";
    base.updatedAt = row.updatedAt || snapshotMeta.generatedAt || "";
    base.updatedAtDisplay = formatUpdatedAtLabel(base.updatedAt, snapshotMeta.generatedAt);
    base.errorState = "";
    return base;
  }

  if (liveCandidate && stale) {
    base.state = "stale";
    base.isLive = false;
    base.isVerified = true;
    base.primaryValue = "Data nejsou aktuální";
    base.secondaryValue = "Ověřte u oficiálního zdroje";
    base.trendDirection = "neutral";
    base.updatedAt = row.updatedAt || "";
    base.updatedAtDisplay = formatUpdatedAtLabel(base.updatedAt, snapshotMeta.generatedAt);
    base.errorState = "stale";
    return base;
  }

  base.state = "placeholder";
  base.isLive = false;
  base.isVerified = canLive;
  base.primaryValue = "Data se načítají";
  base.secondaryValue = "Ověřte u oficiálního zdroje";
  base.trendDirection = "neutral";
  base.updatedAt = "";
  base.updatedAtDisplay = "";
  base.errorState = "";
  return base;
}

export function getLoadingInfoPanelItems() {
  return IU_INFO_PANEL_CATALOG.map((item) => ({
    ...item,
    state: "loading",
    isLive: false,
    isVerified: false,
    primaryValue: "…",
    secondaryValue: "Načítání",
    trendDirection: "neutral",
    updatedAt: "",
    updatedAtDisplay: "",
    errorState: "",
  }));
}

export async function loadInfoPanelItems(options) {
  const forceReload = !!(options && options.forceReload);
  let snapshot = { items: {}, generatedAt: "", errors: [] };
  try {
    const res = await fetch(SNAPSHOT_URL, {
      cache: "no-cache",
      headers: forceReload ? { "Cache-Control": "no-cache", Pragma: "no-cache" } : undefined,
    });
    if (res.ok) snapshot = await res.json();
  } catch (_) {}

  return IU_INFO_PANEL_CATALOG.map((item) => mergeItem(item, snapshot.items && snapshot.items[item.id], snapshot));
}

export function getInfoPanelCatalogForDocs() {
  return IU_INFO_PANEL_CATALOG.slice();
}

/** Guard / test hook — merge catalog row with snapshot without fetch. */
export function mergeInfoPanelItemForGuard(catalogItem, snapRow, snapshotMeta) {
  return mergeItem(catalogItem, snapRow, snapshotMeta);
}
