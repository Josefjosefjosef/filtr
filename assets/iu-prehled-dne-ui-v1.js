/**
 * InfoUzel.cz — Přehled dne UI v6 (čistý koncept)
 * Hlavní stránka: Můj přehled/Nastavení + Zobrazit (Vše/Uložené/Nepřečtené/Skryté) + feed.
 * Nastavení: jedna stránka (overlay/modal) — Témata, Zdroje, Lokalita.
 */
import {
  applyCutoverDom,
  loadInfoSystemData,
  filterEvents,
  buildFeedIndex,
  getPrefs,
  setPrefs,
  markRead,
  toggleSaved,
  hideItem,
  unhideItem,
  isRead,
  isSaved,
  localitySuggest,
  getScrollState,
  setScrollState,
  migrateLocalStateOnce,
} from "./iu-info-system-core-v1.js?v=info-system-v6-clean-20260719";

const PAGE_SIZE = 50;
const CACHE_BUST = "info-system-v6-clean-20260719";

const TOPICS = [
  { id: "doprava", label: "Doprava" },
  { id: "bezpecnost", label: "Bezpečnost" },
  { id: "pocasi", label: "Počasí" },
  { id: "stat", label: "Stát" },
  { id: "cesko-svet", label: "Česko a svět" },
  { id: "zdravi", label: "Zdraví" },
  { id: "kultura", label: "Kultura" },
  { id: "sport", label: "Sport" },
  { id: "veda", label: "Věda" },
];

/** Top-level source group UI → registry group ids (and optional lane filters). */
const SOURCE_GROUPS = [
  { id: "ministerstva", label: "Ministerstva", groups: ["ministerstva"] },
  { id: "policie", label: "Policie", groups: ["policie"] },
  { id: "hzs", label: "HZS", groups: ["hzs"] },
  { id: "chmi", label: "ČHMÚ", groups: ["pocasi"], sourceIds: ["chmi"] },
  { id: "verejnopravni-media", label: "Veřejnoprávní média", groups: ["verejnopravni-media"] },
  { id: "kraje", label: "Kraje", lanes: ["regionalni"], groups: ["verejna-sprava"] },
  {
    id: "dalsi",
    label: "Další instituce",
    groups: ["doprava", "zdravotnictvi", "stat", "verejna-sprava", "kyber", "veda", "hygiena"],
  },
];

const CZ_KRAJE = [
  "Hlavní město Praha",
  "Středočeský kraj",
  "Jihočeský kraj",
  "Plzeňský kraj",
  "Karlovarský kraj",
  "Ústecký kraj",
  "Liberecký kraj",
  "Královéhradecký kraj",
  "Pardubický kraj",
  "Kraj Vysočina",
  "Jihomoravský kraj",
  "Olomoucký kraj",
  "Zlínský kraj",
  "Moravskoslezský kraj",
];

const CZ_OKRESY = {
  "Hlavní město Praha": ["Praha"],
  "Středočeský kraj": [
    "Benešov",
    "Beroun",
    "Kladno",
    "Kolín",
    "Kutná Hora",
    "Mělník",
    "Mladá Boleslav",
    "Nymburk",
    "Praha-východ",
    "Praha-západ",
    "Příbram",
    "Rakovník",
  ],
  "Jihočeský kraj": ["České Budějovice", "Český Krumlov", "Jindřichův Hradec", "Písek", "Prachatice", "Strakonice", "Tábor"],
  "Plzeňský kraj": ["Domažlice", "Klatovy", "Plzeň-město", "Plzeň-jih", "Plzeň-sever", "Rokycany", "Tachov"],
  "Karlovarský kraj": ["Cheb", "Karlovy Vary", "Sokolov"],
  "Ústecký kraj": ["Děčín", "Chomutov", "Litoměřice", "Louny", "Most", "Teplice", "Ústí nad Labem"],
  "Liberecký kraj": ["Česká Lípa", "Jablonec nad Nisou", "Liberec", "Semily"],
  "Královéhradecký kraj": ["Hradec Králové", "Jičín", "Náchod", "Rychnov nad Kněžnou", "Trutnov"],
  "Pardubický kraj": ["Chrudim", "Pardubice", "Svitavy", "Ústí nad Orlicí"],
  "Kraj Vysočina": ["Havlíčkův Brod", "Jihlava", "Pelhřimov", "Třebíč", "Žďár nad Sázavou"],
  "Jihomoravský kraj": ["Blansko", "Brno-město", "Brno-venkov", "Břeclav", "Hodonín", "Vyškov", "Znojmo"],
  "Olomoucký kraj": ["Jeseník", "Olomouc", "Prostějov", "Přerov", "Šumperk"],
  "Zlínský kraj": ["Kroměříž", "Uherské Hradiště", "Vsetín", "Zlín"],
  "Moravskoslezský kraj": ["Bruntál", "Frýdek-Místek", "Karviná", "Nový Jičín", "Opava", "Ostrava-město"],
};

const state = {
  data: null,
  index: null,
  prefs: null,
  draft: null,
  /** @type {'home'|'all'|'saved'|'unread'|'hidden'} */
  viewMode: "home",
  settingsOpen: false,
  openSections: { temata: true, zdroje: false, lokalita: false },
  openSourceGroups: {},
  page: 1,
  cityQuery: "",
  citySuggest: [],
  localitiesCache: null,
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function publishIso(ev) {
  return ev.publishedAtSource || ev.sortAt || ev.firstSeenByInfoUzel || ev.publishedAt || ev.updatedAt || "";
}

function ensureRoot() {
  let root = document.getElementById("iuPrehledDneRoot");
  if (root) return root;
  const viewport = document.getElementById("iuSilverTallScrollViewport");
  if (!viewport) return null;
  root = document.createElement("div");
  root.id = "iuPrehledDneRoot";
  root.className = "iuPrehledDneRoot";
  root.setAttribute("data-iu-prehled-dne-root", "1");
  viewport.insertBefore(root, viewport.firstChild);
  return root;
}

function toggleInArray(arr, id) {
  const set = new Set(arr || []);
  const k = String(id);
  if (set.has(k)) set.delete(k);
  else set.add(k);
  return Array.from(set);
}

function importanceLabel(ev) {
  const n = Number(ev.importance || 0);
  if (!n) return "";
  if (n >= 5) return "Velmi vysoká";
  if (n >= 4) return "Vysoká";
  if (n >= 3) return "Střední";
  return "Běžná";
}

function activeSources(registry) {
  return (registry.entries || []).filter((e) => e && e.productionActive && e.productionApproved !== false);
}

function sourcesForGroup(registry, groupDef) {
  const all = activeSources(registry);
  const gset = new Set(groupDef.groups || []);
  const laneSet = new Set(groupDef.lanes || []);
  const idSet = new Set(groupDef.sourceIds || []);
  return all.filter((e) => {
    if (idSet.size && idSet.has(e.id)) return true;
    if (groupDef.id === "kraje") {
      return laneSet.has(String(e.lane || "")) || /^kraj-/i.test(String(e.id || ""));
    }
    if (groupDef.id === "dalsi") {
      const primary = new Set(["ministerstva", "policie", "hzs", "pocasi", "verejnopravni-media"]);
      if (primary.has(String(e.group || ""))) return false;
      if (String(e.lane || "") === "regionalni" || /^kraj-/i.test(String(e.id || ""))) return false;
      return gset.has(String(e.group || ""));
    }
    if (gset.has(String(e.group || ""))) return true;
    return false;
  });
}

function clonePrefs(p) {
  return JSON.parse(JSON.stringify(p || getPrefs()));
}

function prefsForMode(prefs, mode) {
  const base = clonePrefs(prefs);
  base.unreadOnly = false;
  base.savedOnly = false;
  if (mode === "all") {
    return {
      sections: [],
      eventTypes: [],
      sourceGroups: [],
      sourceIds: [],
      orgTypes: [],
      lanes: [],
      connectorTypes: [],
      statuses: [],
      regionLevels: [],
      institutions: [],
      favoriteSourceIds: [],
      favoriteLanes: [],
      favoriteRegions: [],
      favoriteInstitutions: [],
      homeKraj: "",
      homeOkres: "",
      homeObec: "",
      regionalDoprava: false,
      regionalKrize: false,
      regionalZdravi: false,
      myRegionOnly: false,
      localityQuery: "",
      localities: [],
      searchQuery: "",
      sortMode: "nejnovejsi",
      timeRangeHours: 0,
      importanceMin: 0,
      activeOnly: false,
      newOnly: false,
      unreadOnly: false,
      savedOnly: false,
      favoritesOnly: false,
      activeViewId: "",
    };
  }
  if (mode === "saved") {
    base.savedOnly = true;
    return base;
  }
  if (mode === "unread") {
    base.unreadOnly = true;
    return base;
  }
  return base;
}

function filteredList() {
  const items = (state.data && state.data.feed && state.data.feed.items) || [];
  const prefs = state.prefs || getPrefs();
  const mode = state.viewMode;
  const f = prefsForMode(prefs, mode);
  const opts = {
    index: state.index,
    generationId: state.data && state.data.manifest && state.data.manifest.generationId,
    hiddenMode: mode === "hidden" ? "only" : "exclude",
  };
  return filterEvents(items, f, opts);
}

function renderItem(ev) {
  const id = String(ev.id || "");
  const url = String(ev.url || ev.originalUrl || "#");
  const title = String(ev.title || "Bez názvu");
  const src = String(ev.sourceLabel || ev.sourceId || "");
  const region = ev.region && ev.region.name ? String(ev.region.name) : "";
  const imp = importanceLabel(ev);
  const saved = isSaved(id);
  const hiddenMode = state.viewMode === "hidden";
  const read = isRead(id);
  return (
    `<article class="iuPdCard iuPrehledDne__item iuPrehledDne__card${read ? " is-read" : ""}" data-id="${esc(id)}">` +
    `<div class="iuPdCard__time">${esc(fmtTime(publishIso(ev)))}</div>` +
    `<div class="iuPdCard__body">` +
    `<a class="iuPdCard__title" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-act="open-title">${esc(title)}</a>` +
    `<div class="iuPdCard__meta">` +
    (src ? `<span class="iuPdCard__pill">${esc(src)}</span>` : "") +
    (region ? `<span class="iuPdCard__pill">${esc(region)}</span>` : "") +
    (imp ? `<span class="iuPdCard__pill iuPdCard__pill--imp">${esc(imp)}</span>` : "") +
    `</div>` +
    `<div class="iuPdCard__actions">` +
    (hiddenMode
      ? `<button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="unhide" data-id="${esc(id)}">Obnovit</button>`
      : `<button type="button" class="iuPdBtn iuPdBtn--ghost${saved ? " is-on" : ""}" data-act="save" data-id="${esc(id)}">${saved ? "Uloženo" : "Uložit"}</button>` +
        `<button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="hide" data-id="${esc(id)}">Skrýt</button>`) +
    `</div></div></article>`
  );
}

function topicsAllState(draft) {
  return !draft.sections || draft.sections.length === 0;
}

function checkRow(name, value, label, checked, attrs) {
  return (
    `<label class="iuPdCheck">` +
    `<input type="checkbox" name="${esc(name)}" value="${esc(value)}" ${checked ? "checked" : ""} ${attrs || ""} />` +
    `<span>${esc(label)}</span></label>`
  );
}

function renderSettingsBody() {
  const draft = state.draft || clonePrefs(state.prefs);
  const registry = (state.data && state.data.registry) || { entries: [] };
  const secOpen = state.openSections;

  const topicsAll = !draft.sections || draft.sections.length === 0;
  const topicsHtml =
    checkRow("topic-all", "all", "Vše", topicsAll, 'data-draft-act="topics-all"') +
    TOPICS.map((t) =>
      checkRow("topic", t.id, t.label, !topicsAll && (draft.sections || []).includes(t.id), `data-draft-act="topic" data-id="${esc(t.id)}"`)
    ).join("");

  const selectedGroups = new Set(draft.sourceGroups || []);
  const selectedIds = new Set(draft.sourceIds || []);
  const sourcesAll = selectedGroups.size === 0 && selectedIds.size === 0;

  const sourcesHtml = SOURCE_GROUPS.map((g) => {
    const entries = sourcesForGroup(registry, g);
    const groupChecked =
      sourcesAll ||
      (g.groups || []).some((x) => selectedGroups.has(x)) ||
      (g.sourceIds || []).some((x) => selectedIds.has(x)) ||
      (g.id === "kraje" && selectedGroups.has("verejna-sprava") && (draft.lanes || []).includes("regionalni"));
    const open = !!state.openSourceGroups[g.id];
    const kids = entries
      .map((e) =>
        checkRow(
          "source-id",
          e.id,
          e.label || e.id,
          sourcesAll || selectedIds.has(e.id) || (g.groups || []).some((x) => selectedGroups.has(x)),
          `data-draft-act="source-id" data-id="${esc(e.id)}" data-group="${esc(g.id)}"`
        )
      )
      .join("");
    return (
      `<div class="iuPdSourceGroup" data-sg="${esc(g.id)}">` +
      `<div class="iuPdSourceGroup__head">` +
      checkRow("source-group", g.id, g.label, groupChecked && !sourcesAll ? true : sourcesAll, `data-draft-act="source-group" data-id="${esc(g.id)}"`) +
      `<button type="button" class="iuPdLink" data-act="toggle-sg" data-id="${esc(g.id)}" aria-expanded="${open ? "true" : "false"}">${open ? "Skrýt" : "Rozbalit"}</button>` +
      `</div>` +
      (open ? `<div class="iuPdSourceGroup__body">${kids || `<p class="iuPdMuted">Žádné aktivní zdroje v této skupině.</p>`}</div>` : "") +
      `</div>`
    );
  }).join("");

  const wholeCr = !draft.myRegionOnly && !(draft.localities || []).length && !draft.homeKraj && !draft.homeOkres && !draft.homeObec && !draft.localityQuery;
  const selKraje = asLocList(draft, "kraj");
  const selOkresy = asLocList(draft, "okres");
  const selCities = asLocList(draft, "mesto");

  const okresOptions = [];
  for (const k of selKraje.length ? selKraje : CZ_KRAJE) {
    for (const o of CZ_OKRESY[k] || []) okresOptions.push({ kraj: k, okres: o });
  }

  const localityHtml =
    checkRow("loc-cr", "cr", "Celá ČR", wholeCr, 'data-draft-act="loc-cr"') +
    `<div class="iuPdSubhead">Kraje</div>` +
    `<div class="iuPdChecks iuPdChecks--grid">` +
    CZ_KRAJE.map((k) =>
      checkRow("kraj", k, k, selKraje.includes(k), `data-draft-act="loc-kraj" data-id="${esc(k)}"`)
    ).join("") +
    `</div>` +
    `<div class="iuPdSubhead">Okresy</div>` +
    `<div class="iuPdChecks iuPdChecks--grid">` +
    (okresOptions.length
      ? okresOptions
          .map((o) =>
            checkRow("okres", o.okres, o.okres, selOkresy.includes(o.okres), `data-draft-act="loc-okres" data-id="${esc(o.okres)}"`)
          )
          .join("")
      : `<p class="iuPdMuted">Nejdříve vyberte kraj, nebo ponechte Celá ČR.</p>`) +
    `</div>` +
    `<div class="iuPdSubhead">Město / Obec</div>` +
    `<input class="iuPdInput" type="search" autocomplete="off" placeholder="Začněte psát (např. pra)" value="${esc(state.cityQuery)}" data-act="city-q" />` +
    (state.citySuggest.length
      ? `<ul class="iuPdSuggest">${state.citySuggest
          .map((s) => `<li><button type="button" data-act="city-add" data-name="${esc(s.name)}">${esc(s.name)}</button></li>`)
          .join("")}</ul>`
      : "") +
    (selCities.length
      ? `<div class="iuPdChips">${selCities
          .map((c) => `<button type="button" class="iuPdChip" data-act="city-remove" data-name="${esc(c)}">${esc(c)} ×</button>`)
          .join("")}</div>`
      : "");

  return (
    `<div class="iuPdSettings__scroll">` +
    accordion("temata", "Témata", secOpen.temata, `<div class="iuPdChecks">${topicsHtml}</div>`) +
    accordion(
      "zdroje",
      "Zdroje a instituce",
      secOpen.zdroje,
      `<div class="iuPdChecks">${checkRow("source-all", "all", "Vše", sourcesAll, 'data-draft-act="sources-all"')}${sourcesHtml}</div>`
    ) +
    accordion("lokalita", "Lokalita", secOpen.lokalita, localityHtml) +
    `</div>` +
    `<div class="iuPdSettings__foot">` +
    `<button type="button" class="iuPdBtn iuPdBtn--primary" data-act="settings-save">Uložit nastavení</button>` +
    `<button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="settings-cancel">Zrušit</button>` +
    `</div>`
  );
}

function accordion(id, title, open, body) {
  return (
    `<section class="iuPdAcc${open ? " is-open" : ""}" data-acc="${esc(id)}">` +
    `<button type="button" class="iuPdAcc__toggle" data-act="toggle-acc" data-id="${esc(id)}" aria-expanded="${open ? "true" : "false"}">` +
    `<span>${esc(title)}</span><span class="iuPdAcc__chev" aria-hidden="true"></span>` +
    `</button>` +
    (open ? `<div class="iuPdAcc__body">${body}</div>` : "") +
    `</section>`
  );
}

function asLocList(draft, level) {
  const out = [];
  for (const loc of draft.localities || []) {
    if (!loc) continue;
    if (typeof loc === "string") {
      if (level === "mesto") out.push(loc);
      continue;
    }
    if (String(loc.level || "") === level && loc.name) out.push(String(loc.name));
  }
  if (level === "kraj" && draft.homeKraj) out.push(String(draft.homeKraj));
  if (level === "okres" && draft.homeOkres) out.push(String(draft.homeOkres));
  if (level === "mesto" && draft.homeObec) out.push(String(draft.homeObec));
  return Array.from(new Set(out));
}

function setLocList(draft, level, names) {
  const others = (draft.localities || []).filter((loc) => {
    if (!loc || typeof loc === "string") return level !== "mesto";
    return String(loc.level || "") !== level;
  });
  const next = names.map((n) => ({ name: n, level }));
  draft.localities = others.concat(next);
  if (level === "kraj") {
    draft.homeKraj = names[0] || "";
    draft.myRegionOnly = names.length > 0 || asLocList(draft, "okres").length > 0 || asLocList(draft, "mesto").length > 0;
  }
  if (level === "okres") {
    draft.homeOkres = names[0] || "";
    draft.myRegionOnly = names.length > 0 || asLocList(draft, "kraj").length > 0 || asLocList(draft, "mesto").length > 0;
  }
  if (level === "mesto") {
    draft.homeObec = names[0] || "";
    draft.myRegionOnly = names.length > 0 || asLocList(draft, "kraj").length > 0 || asLocList(draft, "okres").length > 0;
  }
  if (!names.length && !asLocList(draft, "kraj").length && !asLocList(draft, "okres").length && !asLocList(draft, "mesto").length) {
    draft.myRegionOnly = false;
    draft.homeKraj = "";
    draft.homeOkres = "";
    draft.homeObec = "";
  }
}

function paint() {
  const root = ensureRoot();
  if (!root) return;
  const list = filteredList();
  const pageItems = list.slice(0, state.page * PAGE_SIZE);
  const mode = state.viewMode;
  const settings = state.settingsOpen
    ? `<div class="iuPdSettings" id="iuPdSettings" role="dialog" aria-modal="true" aria-label="Nastavení přehledu">` +
      `<div class="iuPdSettings__backdrop" data-act="settings-cancel"></div>` +
      `<div class="iuPdSettings__panel">` +
      `<header class="iuPdSettings__head"><h2>Můj přehled / Nastavení</h2>` +
      `<button type="button" class="iuPdIconBtn" data-act="settings-cancel" aria-label="Zavřít">×</button></header>` +
      renderSettingsBody() +
      `</div></div>`
    : "";

  root.innerHTML =
    `<section class="iuPrehledDne iuPd" data-iu-ui="v6-clean">` +
    `<div class="iuPd__top">` +
    `<button type="button" class="iuPdBtn iuPdBtn--primary iuPdBtn--block" data-act="open-settings">Můj přehled / Nastavení</button>` +
    `</div>` +
    `<div class="iuPd__show">` +
    `<div class="iuPd__label">Zobrazit</div>` +
    `<div class="iuPd__toggles" role="toolbar" aria-label="Zobrazení feedu">` +
    `<button type="button" class="iuPdToggle${mode === "all" ? " is-active" : ""}" data-act="mode" data-mode="all">Vše</button>` +
    `<button type="button" class="iuPdToggle${mode === "saved" ? " is-active" : ""}" data-act="mode" data-mode="saved">Uložené</button>` +
    `<button type="button" class="iuPdToggle${mode === "unread" ? " is-active" : ""}" data-act="mode" data-mode="unread">Nepřečtené</button>` +
    `<button type="button" class="iuPdToggle${mode === "hidden" ? " is-active" : ""}" data-act="mode" data-mode="hidden">Skryté</button>` +
    `</div></div>` +
    `<div class="iuPd__count">${list.length} položek · okno 96 h</div>` +
    `<div class="iuPdFeed" id="iuPrehledDneTimeline">` +
    (pageItems.length ? pageItems.map(renderItem).join("") : `<p class="iuPdEmpty">Žádné položky pro toto zobrazení.</p>`) +
    `</div>` +
    (pageItems.length < list.length
      ? `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--block" data-act="more">Načíst další</button>`
      : "") +
    settings +
    `</section>`;
}

function syncDraftFromEvent(ev) {
  const draft = state.draft;
  if (!draft) return;
  const act = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-draft-act");
  if (!act) return;
  const id = ev.target.getAttribute("data-id") || "";
  const checked = !!ev.target.checked;

  if (act === "topics-all") {
    draft.sections = [];
  } else if (act === "topic") {
    let secs = (draft.sections || []).slice();
    if (topicsAllState(draft)) {
      // was "all" — start from full set then toggle this one off/on
      secs = TOPICS.map((t) => t.id);
    }
    if (checked) {
      if (!secs.includes(id)) secs.push(id);
    } else {
      secs = secs.filter((x) => x !== id);
    }
    if (secs.length === TOPICS.length) secs = [];
    draft.sections = secs;
  } else if (act === "sources-all") {
    draft.sourceGroups = [];
    draft.sourceIds = [];
    draft.lanes = (draft.lanes || []).filter((l) => l !== "regionalni");
  } else if (act === "source-group") {
    const def = SOURCE_GROUPS.find((g) => g.id === id);
    if (!def) return;
    const registry = (state.data && state.data.registry) || { entries: [] };
    const wasAll = !(draft.sourceGroups || []).length && !(draft.sourceIds || []).length;
    if (wasAll && !checked) {
      // Leave "all" mode: select every group except this one
      draft.sourceGroups = [];
      draft.sourceIds = [];
      draft.lanes = [];
      for (const g of SOURCE_GROUPS) {
        if (g.id === id) continue;
        for (const gg of g.groups || []) {
          if (!draft.sourceGroups.includes(gg)) draft.sourceGroups.push(gg);
        }
        for (const sid of g.sourceIds || []) {
          if (!draft.sourceIds.includes(sid)) draft.sourceIds.push(sid);
        }
        if (g.id === "kraje") draft.lanes.push("regionalni");
      }
    } else if (checked) {
      for (const g of def.groups || []) {
        if (!draft.sourceGroups.includes(g)) draft.sourceGroups.push(g);
      }
      if (def.id === "kraje" && !draft.lanes.includes("regionalni")) draft.lanes.push("regionalni");
      for (const sid of def.sourceIds || []) {
        if (!draft.sourceIds.includes(sid)) draft.sourceIds.push(sid);
      }
    } else {
      draft.sourceGroups = (draft.sourceGroups || []).filter((g) => !(def.groups || []).includes(g));
      draft.sourceIds = (draft.sourceIds || []).filter((s) => !(def.sourceIds || []).includes(s));
      if (def.id === "kraje") draft.lanes = (draft.lanes || []).filter((l) => l !== "regionalni");
      const entries = sourcesForGroup(registry, def);
      const ids = new Set(entries.map((e) => e.id));
      draft.sourceIds = (draft.sourceIds || []).filter((s) => !ids.has(s));
    }
  } else if (act === "source-id") {
    draft.sourceIds = checked
      ? Array.from(new Set((draft.sourceIds || []).concat(id)))
      : (draft.sourceIds || []).filter((x) => x !== id);
  } else if (act === "loc-cr") {
    if (checked) {
      draft.localities = [];
      draft.homeKraj = "";
      draft.homeOkres = "";
      draft.homeObec = "";
      draft.localityQuery = "";
      draft.myRegionOnly = false;
    }
  } else if (act === "loc-kraj") {
    let kraje = asLocList(draft, "kraj");
    kraje = checked ? Array.from(new Set(kraje.concat(id))) : kraje.filter((x) => x !== id);
    setLocList(draft, "kraj", kraje);
    // drop okresy not in selected kraje
    const allowed = new Set();
    for (const k of kraje) for (const o of CZ_OKRESY[k] || []) allowed.add(o);
    setLocList(
      draft,
      "okres",
      asLocList(draft, "okres").filter((o) => allowed.has(o))
    );
  } else if (act === "loc-okres") {
    let okresy = asLocList(draft, "okres");
    okresy = checked ? Array.from(new Set(okresy.concat(id))) : okresy.filter((x) => x !== id);
    setLocList(draft, "okres", okresy);
  }
  paint();
  wire();
}

async function ensureLocalities() {
  if (state.localitiesCache) return state.localitiesCache;
  try {
    const base = (window.IU_DATA_BASE || "/projects/data/").replace(/\/?$/, "/");
    const res = await fetch(base + "cz_localities_picker.json", { credentials: "same-origin" });
    if (!res.ok) throw new Error("loc");
    const json = await res.json();
    const items = (json.items || []).map((it) => ({
      name: String((it.a && it.a[0]) || it.n || "").trim() || String(it.n || ""),
      level: "mesto",
    }));
    state.localitiesCache = items.filter((x) => x.name);
  } catch (_) {
    state.localitiesCache = [
      { name: "Praha", level: "mesto" },
      { name: "Brno", level: "mesto" },
      { name: "Ostrava", level: "mesto" },
      { name: "Plzeň", level: "mesto" },
      { name: "Liberec", level: "mesto" },
    ];
  }
  return state.localitiesCache;
}

function wire() {
  const root = ensureRoot();
  if (!root || root.__iuPdWiredV6) {
    // rebind each paint (innerHTML wipes listeners)
  }
  root.onclick = async (ev) => {
    const t = ev.target.closest("[data-act],[data-draft-act]");
    if (!t) return;
    if (t.matches("input[type=checkbox][data-draft-act]")) {
      syncDraftFromEvent({ target: t });
      return;
    }
    const act = t.getAttribute("data-act");
    if (!act) return;
    if (act === "open-settings") {
      state.settingsOpen = true;
      state.draft = clonePrefs(state.prefs);
      state.cityQuery = "";
      state.citySuggest = [];
      paint();
      wire();
      return;
    }
    if (act === "settings-cancel") {
      state.settingsOpen = false;
      state.draft = null;
      paint();
      wire();
      return;
    }
    if (act === "settings-save") {
      const next = clonePrefs(state.draft || state.prefs);
      next.unreadOnly = false;
      next.savedOnly = false;
      setPrefs(next);
      state.prefs = getPrefs();
      state.settingsOpen = false;
      state.draft = null;
      state.viewMode = "home";
      state.page = 1;
      paint();
      wire();
      return;
    }
    if (act === "toggle-acc") {
      const id = t.getAttribute("data-id");
      state.openSections[id] = !state.openSections[id];
      paint();
      wire();
      return;
    }
    if (act === "toggle-sg") {
      const id = t.getAttribute("data-id");
      state.openSourceGroups[id] = !state.openSourceGroups[id];
      paint();
      wire();
      return;
    }
    if (act === "mode") {
      const m = t.getAttribute("data-mode");
      if (m === "all") {
        state.viewMode = state.viewMode === "all" ? "home" : "all";
      } else {
        state.viewMode = m;
      }
      state.page = 1;
      paint();
      wire();
      return;
    }
    if (act === "more") {
      state.page += 1;
      paint();
      wire();
      return;
    }
    if (act === "open-title") {
      const card = t.closest("[data-id]");
      if (card) markRead(card.getAttribute("data-id"));
      return;
    }
    if (act === "save") {
      toggleSaved(t.getAttribute("data-id"));
      paint();
      wire();
      return;
    }
    if (act === "hide") {
      hideItem(t.getAttribute("data-id"));
      paint();
      wire();
      return;
    }
    if (act === "unhide") {
      unhideItem(t.getAttribute("data-id"));
      paint();
      wire();
      return;
    }
    if (act === "city-add") {
      const name = t.getAttribute("data-name");
      const cities = asLocList(state.draft, "mesto");
      if (name && !cities.includes(name)) cities.push(name);
      setLocList(state.draft, "mesto", cities);
      state.cityQuery = "";
      state.citySuggest = [];
      paint();
      wire();
      return;
    }
    if (act === "city-remove") {
      const name = t.getAttribute("data-name");
      setLocList(
        state.draft,
        "mesto",
        asLocList(state.draft, "mesto").filter((x) => x !== name)
      );
      paint();
      wire();
      return;
    }
  };

  root.oninput = async (ev) => {
    const t = ev.target;
    if (!t || t.getAttribute("data-act") !== "city-q") return;
    state.cityQuery = t.value || "";
    const locs = await ensureLocalities();
    state.citySuggest = localitySuggest(state.cityQuery, locs).slice(0, 8);
    // soft update suggest list only
    const box = root.querySelector(".iuPdSuggest");
    const input = root.querySelector('[data-act="city-q"]');
    if (input) input.value = state.cityQuery;
    if (state.citySuggest.length) {
      const html = `<ul class="iuPdSuggest">${state.citySuggest
        .map((s) => `<li><button type="button" data-act="city-add" data-name="${esc(s.name)}">${esc(s.name)}</button></li>`)
        .join("")}</ul>`;
      if (box) box.outerHTML = html;
      else input.insertAdjacentHTML("afterend", html);
    } else if (box) box.remove();
  };

  document.onkeydown = (ev) => {
    if (ev.key === "Escape" && state.settingsOpen) {
      state.settingsOpen = false;
      state.draft = null;
      paint();
      wire();
    }
  };
}

async function boot() {
  migrateLocalStateOnce();
  applyCutoverDom();
  const root = ensureRoot();
  if (!root) return;
  root.innerHTML = `<section class="iuPrehledDne iuPd" data-iu-ui="v6-clean"><p class="iuPdMuted">Načítám Přehled dne…</p></section>`;
  try {
    const data = await loadInfoSystemData({});
    state.data = data;
    state.index = buildFeedIndex((data.feed && data.feed.items) || []);
    state.prefs = getPrefs();
    state.page = 1;
    const scroll = getScrollState();
    paint();
    wire();
    if (scroll && Number(scroll.y) > 0) {
      try {
        const vp = document.getElementById("iuSilverTallScrollViewport");
        if (vp) vp.scrollTop = Number(scroll.y);
      } catch (_) {}
    }
    window.addEventListener(
      "beforeunload",
      () => {
        try {
          const vp = document.getElementById("iuSilverTallScrollViewport");
          setScrollState({ viewId: "prehled-v6", y: vp ? vp.scrollTop : 0 });
        } catch (_) {}
      },
      { once: true }
    );
  } catch (err) {
    root.innerHTML = `<section class="iuPrehledDne iuPd" data-iu-ui="v6-clean"><p class="iuPdEmpty">Přehled dne se nepodařilo načíst.</p></section>`;
    console.error("[iu-prehled-dne]", err);
  }
}

function mountPrehledDne() {
  boot();
}

try {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountPrehledDne, { once: true });
  } else {
    mountPrehledDne();
  }
} catch (_) {
  mountPrehledDne();
}

export { mountPrehledDne, CACHE_BUST };
