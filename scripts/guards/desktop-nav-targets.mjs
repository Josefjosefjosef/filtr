/**
 * Desktop nav entry points after homecards rework:
 * left rail = tools only; feed / vertical sections via homecards.
 */

export const DESKTOP_LEFT_RAIL_ACCENTS = new Set([
  "pocasi",
  "mapy",
  "jr",
  "tvprogram",
  "tvonline",
  "radio",
]);

export const DESKTOP_NAV_SELECTOR_BY_ACCENT = {
  pocasi: '#iuLeftRail a[data-accent="pocasi"]',
  mapy: '#iuLeftRail a[data-accent="mapy"]',
  jr: '#iuLeftRail a[data-accent="jr"]',
  tvprogram: '#iuLeftRail a[data-accent="tvprogram"]',
  tvonline: '#iuLeftRail a[data-accent="tvonline"]',
  radio: '#iuLeftRail a[data-accent="radio"]',
  media: '[data-iu-prehled-dne-preview-card="1"]',
  zpravy: '[data-iu-news-preview-card="1"]',
  sport: '[data-iu-sport-preview-card="1"]',
  finance: '[data-iu-finance-preview-card="1"]',
  zdravi: '[data-iu-health-preview-card="1"]',
  travel: '[data-iu-travel-preview-card="1"]',
  cestovani: '[data-iu-travel-preview-card="1"]',
  hry: '[data-iu-games-preview-card="1"]',
  kultura: '[data-iu-culture-preview-card="1"]',
  veda: '[data-iu-science-history-preview-card="1"]',
  vzdelavani: '[data-iu-education-preview-card="1"]',
};

export function desktopNavSelector(accent) {
  const ac = String(accent || "").trim().toLowerCase();
  if (DESKTOP_NAV_SELECTOR_BY_ACCENT[ac]) return DESKTOP_NAV_SELECTOR_BY_ACCENT[ac];
  return `#iuLeftRail a[data-accent="${ac}"]`;
}

export async function waitDesktopNavTarget(page, accent, timeoutMs = 60000) {
  const sel = desktopNavSelector(accent);
  await page.waitForSelector(sel, { timeout: timeoutMs });
  return sel;
}

export async function clickDesktopNav(page, accent) {
  const sel = await waitDesktopNavTarget(page, accent);
  await page.click(sel);
}

/** Static desktop sections for scroll / discovery guards (tools + homecards). */
export function discoverDesktopNavSections() {
  const tools = [
    { accent: "pocasi", topic: "", label: "Počasí", kind: "tool", headerFile: "", skipScrollDown: true },
    { accent: "mapy", topic: "", label: "Mapy", kind: "tool", headerFile: "", skipScrollDown: true },
    { accent: "jr", topic: "", label: "Jízdní řády", kind: "tool", headerFile: "", skipScrollDown: true },
    { accent: "tvprogram", topic: "", label: "TV program", kind: "tool", headerFile: "", skipScrollDown: true },
    { accent: "tvonline", topic: "", label: "TV online", kind: "tool", headerFile: "", skipScrollDown: true },
    { accent: "radio", topic: "", label: "Rádia", kind: "tool", headerFile: "", skipScrollDown: true },
  ];
  const homecards = [
    { accent: "zpravy", topic: "zpravy", label: "Zprávy", kind: "feed-topic", headerFile: "section-zpravy.jpg" },
    { accent: "sport", topic: "sport", label: "Sport", kind: "feed-topic", headerFile: "section-sport.jpg" },
    { accent: "finance", topic: "finance", label: "Finance", kind: "feed-topic", headerFile: "section-finance.jpg" },
    { accent: "zdravi", topic: "zdravi", label: "Zdraví", kind: "feed-topic", headerFile: "section-zdravi.jpg" },
    { accent: "travel", topic: "cestovani", label: "Cestování", kind: "feed-section", headerFile: "section-cestovani.jpg" },
    { accent: "hry", topic: "", label: "Hry", kind: "feed-section", headerFile: "section-hry.jpg" },
    { accent: "kultura", topic: "", label: "Kultura", kind: "feed-section", headerFile: "section-kultura-akce.jpg" },
    { accent: "veda", topic: "", label: "Věda", kind: "feed-section", headerFile: "section-veda-historie.jpg" },
    { accent: "vzdelavani", topic: "", label: "Vzdělávání", kind: "feed-section", headerFile: "section-vzdelavani.jpg" },
    { accent: "media", topic: "", label: "Přehled dne", kind: "feed-hub", headerFile: "section-prehled-dne.jpg" },
  ];
  return [...homecards, ...tools].map((s) => ({
    ...s,
    selectorTopic: "",
    hasMediaTopicAttr: false,
    navSelector: desktopNavSelector(s.accent),
  }));
}
