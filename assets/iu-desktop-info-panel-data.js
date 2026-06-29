/**
 * PC informační panel — katalog položek + načtení same-origin snapshotu.
 */
export const IU_INFO_PANEL_DISCLAIMER =
  "Údaje jsou informativní. Zdroj a čas aktualizace najdete u každé položky.";

export const IU_INFO_PANEL_CATALOG = [
  {
    id: "fuel",
    label: "BENZÍN",
    icon: "⛽",
    primaryLabel: "Natural 95",
    unit: "Kč/l",
    legalStatus: "placeholder_only",
    sourceName: "Zdroj se ověřuje",
    sourceUrl: "https://www.infouzel.cz/projects/",
    termsUrl: "https://www.infouzel.cz/projects/",
    licenseNote: "Bezpečný veřejný zdroj zatím neověřen. Data nejsou zobrazena jako živý údaj.",
    dataType: "Průměrná cena pohonných hmot",
    updateNote: "Po ověření zdroje",
    placeholderPrimary: "Zdroj se ověřuje",
    placeholderSecondary: "Data budou doplněna",
  },
  {
    id: "eur_czk",
    label: "EUR / CZK",
    icon: "💶",
    primaryLabel: "",
    unit: "Kč",
    legalStatus: "verified_requires_attribution",
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
    legalStatus: "verified_requires_attribution",
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
    primaryLabel: "",
    unit: "",
    legalStatus: "placeholder_only",
    sourceName: "Zdroj se ověřuje",
    sourceUrl: "https://www.infouzel.cz/projects/",
    termsUrl: "https://www.infouzel.cz/projects/",
    licenseNote: "Live agregace silničního stavu bez jasné licence zatím nepoužita.",
    dataType: "Agregovaný stav silniční dopravy",
    updateNote: "Po ověření open data / API",
    placeholderPrimary: "Zdroj se ověřuje",
    placeholderSecondary: "Data budou doplněna",
  },
  {
    id: "electricity",
    label: "ELEKTŘINA",
    icon: "⚡",
    primaryLabel: "",
    unit: "Kč/kWh",
    legalStatus: "placeholder_only",
    sourceName: "Zdroj se ověřuje",
    sourceUrl: "https://www.infouzel.cz/projects/",
    termsUrl: "https://www.infouzel.cz/projects/",
    licenseNote: "Burzovní/spotové ceny vyžadují samostatné licenční posouzení.",
    dataType: "Orientační cena elektřiny",
    updateNote: "Po ověření zdroje",
    placeholderPrimary: "Zdroj se ověřuje",
    placeholderSecondary: "Data budou doplněna",
  },
  {
    id: "gold",
    label: "ZLATO",
    icon: "🪙",
    primaryLabel: "",
    unit: "USD/oz",
    legalStatus: "placeholder_only",
    sourceName: "Zdroj se ověřuje",
    sourceUrl: "https://www.infouzel.cz/projects/",
    termsUrl: "https://www.infouzel.cz/projects/",
    licenseNote: "Finanční portály bez API licence vyloučeny.",
    dataType: "Tržní cena zlata",
    updateNote: "Po ověření zdroje",
    placeholderPrimary: "Zdroj se ověřuje",
    placeholderSecondary: "Data budou doplněna",
  },
  {
    id: "bitcoin",
    label: "BITCOIN",
    icon: "₿",
    primaryLabel: "",
    unit: "Kč",
    legalStatus: "verified_requires_attribution",
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
    primaryLabel: "",
    unit: "",
    legalStatus: "placeholder_only",
    sourceName: "Zdroj se ověřuje",
    sourceUrl: "https://www.infouzel.cz/projects/",
    termsUrl: "https://www.infouzel.cz/projects/",
    licenseNote: "Live zpoždění vlaků bez oficiální licence zatím nepoužito.",
    dataType: "Počet zpožděných spojů",
    updateNote: "Po ověření zdroje",
    placeholderPrimary: "Zdroj se ověřuje",
    placeholderSecondary: "Data budou doplněna",
  },
  {
    id: "aviation",
    label: "LETECKÁ DOPRAVA",
    icon: "✈️",
    primaryLabel: "",
    unit: "",
    legalStatus: "placeholder_only",
    sourceName: "Zdroj se ověřuje",
    sourceUrl: "https://www.infouzel.cz/projects/",
    termsUrl: "https://www.infouzel.cz/projects/",
    licenseNote: "Komerční flight trackery bez licence vyloučeny.",
    dataType: "Obecný stav letecké dopravy",
    updateNote: "Po ověření zdroje",
    placeholderPrimary: "Zdroj se ověřuje",
    placeholderSecondary: "Data budou doplněna",
  },
];

const SNAPSHOT_URL = "/projects/data/info_panel_snapshot.json";
const LIVE_OK = new Set(["verified_free_ok", "verified_requires_attribution"]);
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

function formatNumber(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n >= 1000) {
    return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
  }
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mergeItem(catalogItem, snapRow, snapshotMeta) {
  const base = { ...catalogItem };
  const canLive = LIVE_OK.has(catalogItem.legalStatus);
  const row = snapRow && typeof snapRow === "object" ? snapRow : null;
  const liveOk = !!(canLive && row && row.isLive && LIVE_OK.has(row.legalStatus || catalogItem.legalStatus));

  if (liveOk && typeof row.value === "number") {
    base.isLive = true;
    base.isVerified = true;
    base.primaryValue = formatNumber(row.value) + (row.unit || catalogItem.unit ? " " + (row.unit || catalogItem.unit) : "");
    base.secondaryValue = row.secondaryValue || "beze změny";
    base.trendDirection = row.trendDirection || "flat";
    base.updatedAt = row.updatedAt || snapshotMeta.generatedAt || "";
    base.errorState = "";
    return base;
  }

  base.isLive = false;
  base.isVerified = false;
  base.primaryValue = catalogItem.placeholderPrimary || "Zdroj se ověřuje";
  base.secondaryValue = catalogItem.placeholderSecondary || "Data budou doplněna";
  base.trendDirection = "neutral";
  base.updatedAt = "";
  base.errorState = canLive && snapshotMeta && snapshotMeta.errors && snapshotMeta.errors.length ? "unavailable" : "";
  return base;
}

export async function loadInfoPanelItems() {
  let snapshot = { items: {}, generatedAt: "", errors: [] };
  try {
    const res = await fetch(SNAPSHOT_URL, { cache: "no-cache" });
    if (res.ok) snapshot = await res.json();
  } catch (_) {}

  const generatedMs = snapshot.generatedAt ? Date.parse(snapshot.generatedAt) : NaN;
  const stale = !Number.isFinite(generatedMs) || Date.now() - generatedMs > MAX_AGE_MS;
  if (stale && snapshot.items) {
    Object.keys(snapshot.items).forEach((key) => {
      if (snapshot.items[key]) snapshot.items[key].isLive = false;
    });
  }

  return IU_INFO_PANEL_CATALOG.map((item) => mergeItem(item, snapshot.items && snapshot.items[item.id], snapshot));
}

export function getInfoPanelCatalogForDocs() {
  return IU_INFO_PANEL_CATALOG.slice();
}
