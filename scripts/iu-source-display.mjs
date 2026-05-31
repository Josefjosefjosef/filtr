/**
 * Shared source display normalization for aggregator guards.
 * Must mirror scripts/build_articles.py media_source_display().
 */

export const DOMAIN_MEDIA_DISPLAY = {
  "seznamzpravy.cz": "Seznam Zprávy",
  "novinky.cz": "Novinky",
  "idnes.cz": "iDNES.cz",
  "servis.idnes.cz": "iDNES.cz",
  "ct24.ceskatelevize.cz": "ČT24",
  "ceskatelevize.cz": "ČT24",
  "sport.ceskatelevize.cz": "ČT sport",
  "aktualne.cz": "Aktuálně",
  "zpravy.aktualne.cz": "Aktuálně",
  "sport.aktualne.cz": "Aktuálně",
  "magazin.aktualne.cz": "Aktuálně",
  "denik.cz": "Deník",
  "sport.cz": "Sport.cz",
  "isport.blesk.cz": "iSport",
  "prozeny.cz": "ProŽeny",
  "forbes.cz": "Forbes",
  "hn.cz": "HN",
  "archiv.hn.cz": "HN",
  "ekonom.cz": "Ekonom (HN)",
};

export const FORBIDDEN_SOURCE_SUFFIXES = [
  " – domácí",
  " – zahraničí",
  " – kultura",
  " – sport",
  " – ekonomika",
  " - domácí",
  " - zahraničí",
  " - kultura",
  " - sport",
  " - ekonomika",
];

export function hostFromUrl(url) {
  if (!url) return "";
  try {
    let h = new URL(String(url).trim()).hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    return "";
  }
}

export function normalizeMediaName(name) {
  let s = String(name || "").trim();
  for (const sep of [" – ", " — ", " - ", " / "]) {
    if (s.includes(sep)) {
      s = s.split(sep, 1)[0].trim();
      break;
    }
  }
  return s;
}

export function mediaSourceDisplay(rawLabel, url = "") {
  const host = hostFromUrl(url);
  if (host && DOMAIN_MEDIA_DISPLAY[host]) return DOMAIN_MEDIA_DISPLAY[host];
  for (const [dom, disp] of Object.entries(DOMAIN_MEDIA_DISPLAY)) {
    if (host === dom || host.endsWith("." + dom)) return disp;
  }
  const norm = normalizeMediaName(rawLabel);
  return norm || String(rawLabel || "").trim();
}

export function sourceLabelHasForbiddenSubsection(label) {
  const s = String(label || "");
  if (FORBIDDEN_SOURCE_SUFFIXES.some((pat) => s.toLowerCase().includes(pat.toLowerCase()))) return true;
  if (/\s\/\s/.test(s)) return true;
  return false;
}

export function articleSourceLabel(article) {
  const url = String(article?.url || article?.sources?.[0]?.url || "").trim();
  const raw = String(article?.sourceLabel || article?.sources?.[0]?.name || "").trim();
  return { display: String(article?.sourceLabel || "").trim(), raw, url, expected: mediaSourceDisplay(raw, url) };
}

export function pragueDayFromIso(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });
  } catch {
    return null;
  }
}

export function pragueTodayIso() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });
}
