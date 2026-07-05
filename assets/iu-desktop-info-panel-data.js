/**
 * PC informační panel V4 — katalog + same-origin snapshot merge.
 */
import {
  IU_INFO_PANEL_CATALOG,
  IU_INFO_PANEL_CATALOG_COUNT,
  IU_INFO_PANEL_ORDER_IDS,
  IU_INFO_PANEL_EXCLUDED,
} from "./iu-desktop-info-panel-catalog.js";

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

function formatNumber(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n >= 1000) {
    return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
  }
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatUpdatedAtLabel(raw, generatedAt) {
  const s = String(raw || "").trim();
  if (s) return s;
  if (generatedAt) {
    try {
      const d = new Date(generatedAt);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
      }
    } catch (_) {}
  }
  return "";
}

function resolveSnapshotFreshnessAnchor(catalogItem, row, snapshotMeta) {
  const bucket = catalogItem && catalogItem.fetchBucket;
  if (snapshotMeta && snapshotMeta.bucketFetchedAt && bucket && snapshotMeta.bucketFetchedAt[bucket]) {
    const bucketAt = Date.parse(snapshotMeta.bucketFetchedAt[bucket]);
    if (Number.isFinite(bucketAt)) return bucketAt;
  }
  if (row && row.updatedAt) {
    const rowAt = Date.parse(row.updatedAt);
    if (Number.isFinite(rowAt)) return rowAt;
  }
  if (snapshotMeta && snapshotMeta.generatedAt) {
    const genAt = Date.parse(snapshotMeta.generatedAt);
    if (Number.isFinite(genAt)) return genAt;
  }
  return NaN;
}

function isSnapshotRowStale(catalogItem, row, snapshotMeta) {
  const maxAge = catalogItem.maxAgeMs > 0 ? catalogItem.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const anchorAt = resolveSnapshotFreshnessAnchor(catalogItem, row, snapshotMeta);
  if (!Number.isFinite(anchorAt)) return true;
  return Date.now() - anchorAt > maxAge;
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
  const snapshotFailed =
    canLive &&
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

export async function loadInfoPanelItems() {
  let snapshot = { items: {}, generatedAt: "", errors: [] };
  try {
    const res = await fetch(SNAPSHOT_URL, { cache: "no-cache" });
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
