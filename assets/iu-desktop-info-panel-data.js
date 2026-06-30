/**
 * PC informační panel V3 — katalog položek + same-origin snapshot.
 */
export const IU_INFO_PANEL_DISCLAIMER =
  "Údaje slouží pouze pro rychlou orientaci. Před důležitým rozhodnutím doporučujeme ověřit informace přímo u oficiálního poskytovatele.";

export const IU_INFO_PANEL_MINDMENU_GAP_PX = 30;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const IU_INFO_PANEL_CATALOG = [
  {
    id: "fuel",
    label: "BENZÍN",
    icon: "⛽",
    primaryLabel: "Natural 95",
    unit: "Kč/l",
    maxAgeMs: 14 * DAY_MS,
    legalStatus: "verified_requires_attribution",
    verificationDate: "2026-06-28",
    sourceName: "Český statistický úřad (DataStat)",
    sourceUrl: "https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CENPHMTT01?format=CSV",
    termsUrl: "https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu",
    licenseNote: "Otevřená data ČSÚ — povinné uvedení zdroje dle podmínek DataStat API.",
    dataType: "Průměrná cena Natural 95 (týdenní)",
    updateNote: "Týdenní aktualizace, snapshot v CI",
  },
  {
    id: "eur_czk",
    label: "EUR / CZK",
    icon: "💶",
    primaryLabel: "",
    unit: "Kč",
    maxAgeMs: 2 * DAY_MS,
    legalStatus: "verified_requires_attribution",
    verificationDate: "2026-06-28",
    sourceName: "Česká národní banka",
    sourceUrl:
      "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt",
    termsUrl:
      "https://www.cnb.cz/cs/verejnost/pro-media/informace-pro-media/pravidla-pro-pouzivani-informaci-cnb/",
    licenseNote: "Povinné uvedení ČNB jako zdroje dat.",
    dataType: "Oficiální denní fixace devizového kurzu",
    updateNote: "Pracovní dny, snapshot v CI",
  },
  {
    id: "usd_czk",
    label: "USD / CZK",
    icon: "💵",
    primaryLabel: "",
    unit: "Kč",
    maxAgeMs: 2 * DAY_MS,
    legalStatus: "verified_requires_attribution",
    verificationDate: "2026-06-28",
    sourceName: "Česká národní banka",
    sourceUrl:
      "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt",
    termsUrl:
      "https://www.cnb.cz/cs/verejnost/pro-media/informace-pro-media/pravidla-pro-pouzivani-informaci-cnb/",
    licenseNote: "Povinné uvedení ČNB jako zdroje dat.",
    dataType: "Oficiální denní fixace devizového kurzu",
    updateNote: "Pracovní dny, snapshot v CI",
  },
  {
    id: "transport",
    label: "DOPRAVA",
    icon: "🚗",
    primaryLabel: "Motorová nafta",
    unit: "Kč/l",
    maxAgeMs: 14 * DAY_MS,
    legalStatus: "verified_requires_attribution",
    verificationDate: "2026-06-28",
    sourceName: "Český statistický úřad (DataStat)",
    sourceUrl: "https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CENPHMTT01?format=CSV",
    termsUrl: "https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu",
    licenseNote: "Otevřená data ČSÚ — průměrná cena motorové nafty jako orientační ukazatel dopravy.",
    dataType: "Průměrná cena motorové nafty (týdenní)",
    updateNote: "Týdenní aktualizace, snapshot v CI",
  },
  {
    id: "electricity",
    label: "ELEKTŘINA",
    icon: "⚡",
    primaryLabel: "Energie a paliva",
    unit: "index",
    maxAgeMs: 45 * DAY_MS,
    legalStatus: "verified_requires_attribution",
    verificationDate: "2026-06-28",
    sourceName: "Český statistický úřad (DataStat)",
    sourceUrl: "https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101ET03?format=CSV",
    termsUrl: "https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu",
    licenseNote: "Index spotřebitelských cen COICOP — kategorie bydlení, energie a paliva.",
    dataType: "Index spotřebitelských cen (COICOP)",
    updateNote: "Měsíční aktualizace, snapshot v CI",
  },
  {
    id: "gold",
    label: "ZLATO",
    icon: "🪙",
    primaryLabel: "PAX Gold",
    unit: "Kč",
    maxAgeMs: 2 * HOUR_MS,
    legalStatus: "verified_requires_attribution",
    verificationDate: "2026-06-28",
    sourceName: "CoinGecko",
    sourceUrl: "https://www.coingecko.com/en/api",
    termsUrl: "https://www.coingecko.com/en/api_terms",
    licenseNote: "Orientační tržní cena tokenizovaného zlata (PAXG) v CZK; uvedení CoinGecko.",
    dataType: "Agregovaná tržní cena PAX Gold v CZK",
    updateNote: "Snapshot v CI (max. hodinově)",
  },
  {
    id: "bitcoin",
    label: "BITCOIN",
    icon: "₿",
    primaryLabel: "",
    unit: "Kč",
    maxAgeMs: 2 * HOUR_MS,
    legalStatus: "verified_requires_attribution",
    verificationDate: "2026-06-28",
    sourceName: "CoinGecko",
    sourceUrl: "https://www.coingecko.com/en/api",
    termsUrl: "https://www.coingecko.com/en/api_terms",
    licenseNote: "Orientační tržní cena; uvedení CoinGecko jako zdroje.",
    dataType: "Agregovaná tržní cena BTC v CZK",
    updateNote: "Snapshot v CI (max. hodinově)",
  },
  {
    id: "trains",
    label: "VLAKY",
    icon: "🚆",
    primaryLabel: "Doprava",
    unit: "index",
    maxAgeMs: 45 * DAY_MS,
    legalStatus: "verified_requires_attribution",
    verificationDate: "2026-06-28",
    sourceName: "Český statistický úřad (DataStat)",
    sourceUrl: "https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101ET03?format=CSV",
    termsUrl: "https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu",
    licenseNote: "Index spotřebitelských cen COICOP — kategorie dopravy (železniční nebo agregovaná doprava).",
    dataType: "Index spotřebitelských cen dopravy (COICOP)",
    updateNote: "Měsíční aktualizace, snapshot v CI",
  },
  {
    id: "aviation",
    label: "LETECKÁ DOPRAVA",
    icon: "✈️",
    primaryLabel: "Letecká doprava",
    unit: "index",
    maxAgeMs: 45 * DAY_MS,
    legalStatus: "verified_requires_attribution",
    verificationDate: "2026-06-28",
    sourceName: "Český statistický úřad (DataStat)",
    sourceUrl: "https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101ET03?format=CSV",
    termsUrl: "https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu",
    licenseNote: "Index spotřebitelských cen COICOP — letecká doprava, případně míra inflace jako náhrada.",
    dataType: "Index spotřebitelských cen letecké dopravy (COICOP)",
    updateNote: "Měsíční aktualizace, snapshot v CI",
  },
];

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

function isSnapshotRowStale(catalogItem, row, snapshotMeta) {
  const maxAge = catalogItem.maxAgeMs > 0 ? catalogItem.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const genAt = snapshotMeta && snapshotMeta.generatedAt ? Date.parse(snapshotMeta.generatedAt) : NaN;
  if (!Number.isFinite(genAt)) return true;
  return Date.now() - genAt > maxAge;
}

function snapshotErrorAffectsItem(catalogItem, errorId) {
  const id = String(errorId || "");
  if (!id) return false;
  if (id === catalogItem.id) return true;
  if ((catalogItem.id === "eur_czk" || catalogItem.id === "usd_czk") && id === "cnb") return true;
  if (catalogItem.id === "bitcoin" && (id === "bitcoin" || id === "coingecko")) return true;
  if (catalogItem.id === "gold" && (id === "gold" || id === "coingecko")) return true;
  if ((catalogItem.id === "fuel" || catalogItem.id === "transport") && id === "csu_fuel") return true;
  if (
    (catalogItem.id === "electricity" || catalogItem.id === "trains" || catalogItem.id === "aviation") &&
    (id === "csu_coicop" || id === "csu_inflation")
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
