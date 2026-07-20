/**
 * InfoUzel.cz — Přehled dne UI v6 (timeline axis restore + actions align)
 * Hlavní stránka: Můj přehled/Nastavení + Zobrazit (Vše/Uložené/Nepřečtené/Skryté) + feed.
 * Nastavení: jeden overlay/modal — hlavní 3 lišty, jedna otevřená sekce, autosave.
 * Feed: svislá časová osa + puntíky; Uložit/Skrýt zarovnané vpravo.
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
} from "./iu-info-system-core-v1.js?v=info-system-v6-timeline-restore-20260720";

const PAGE_SIZE = 50;
const CACHE_BUST = "info-system-v6-timeline-restore-20260720";
const NONE_SENTINEL = "__none__";
const SECTION_ORDER = ["temata", "zdroje", "lokalita"];
const SECTION_LABELS = {
  temata: "Témata",
  zdroje: "Zdroje a instituce",
  lokalita: "Lokalita",
};

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

/** Named source groups only (geographic kraj filter and catch-all bucket removed). */
const SOURCE_GROUPS = [
  { id: "ministerstva", label: "Ministerstva", groups: ["ministerstva"] },
  { id: "policie", label: "Policie", groups: ["policie"] },
  { id: "hzs", label: "HZS", groups: ["hzs"] },
  { id: "chmi", label: "ČHMÚ", groups: ["pocasi"], sourceIds: ["chmi"] },
  { id: "verejnopravni-media", label: "Veřejnoprávní média", groups: ["verejnopravni-media"] },
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
  /** @type {null|'temata'|'zdroje'|'lokalita'} */
  activeSection: null,
  openSourceGroups: {},
  page: 1,
  cityQuery: "",
  citySuggest: [],
  localitiesCache: null,
  feedScrollY: 0,
  settingsOpener: null,
  saveError: "",
  persistSeq: 0,
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

function feedViewport() {
  return document.getElementById("iuSilverTallScrollViewport");
}

function captureFeedScroll() {
  const vp = feedViewport();
  if (vp) state.feedScrollY = vp.scrollTop || 0;
}

function restoreFeedScroll() {
  const vp = feedViewport();
  if (!vp) return;
  const y = Number(state.feedScrollY) || 0;
  try {
    vp.scrollTop = y;
  } catch (_) {}
}

function setBodyScrollLock(on) {
  try {
    document.documentElement.classList.toggle("iu-pd-settings-open", !!on);
    document.body.classList.toggle("iu-pd-settings-open", !!on);
  } catch (_) {}
}

function isMinistryEntry(e) {
  if (!e) return false;
  if (String(e.group || "") === "ministerstva") return true;
  if (/ministerstvo/i.test(String(e.label || ""))) return true;
  if (/ministerstvo/i.test(String(e.institution || ""))) return true;
  return false;
}

function activeSources(registry) {
  return (registry.entries || []).filter((e) => e && e.productionActive && e.productionApproved !== false);
}

function sourcesForNamedGroup(registry, groupDef) {
  const all = activeSources(registry);
  const gset = new Set(groupDef.groups || []);
  const idSet = new Set(groupDef.sourceIds || []);
  if (groupDef.id === "ministerstva") {
    return all.filter((e) => isMinistryEntry(e) || idSet.has(e.id));
  }
  return all.filter((e) => {
    if (idSet.size && idSet.has(e.id)) return true;
    if (isMinistryEntry(e)) return false;
    return gset.has(String(e.group || ""));
  });
}

function standaloneSources(registry) {
  const all = activeSources(registry);
  const claimed = new Set();
  for (const g of SOURCE_GROUPS) {
    for (const e of sourcesForNamedGroup(registry, g)) claimed.add(e.id);
  }
  return all
    .filter((e) => !claimed.has(e.id))
    .sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id), "cs"));
}

function allSelectableSourceIds(registry) {
  return activeSources(registry).map((e) => String(e.id));
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

function importanceLabel(ev) {
  const n = Number(ev.importance || 0);
  if (!n) return "";
  if (n >= 5) return "Velmi vysoká";
  if (n >= 4) return "Vysoká";
  if (n >= 3) return "Střední";
  return "Běžná";
}

function sectionColor(sectionId) {
  const taxonomy = (state.data && state.data.taxonomy) || {};
  const sec = (taxonomy.sections || []).find((s) => s && s.id === sectionId);
  return (sec && sec.color) || "#5B6CFF";
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
  const color = sectionColor(ev.sectionId);
  const alert = String(ev.eventType || "") === "mimoradne" || Number(ev.importance) >= 5;
  return (
    `<li class="iuPdCard iuPrehledDne__item${read ? " is-read" : ""}" data-id="${esc(id)}" style="--iu-pd-dot:${esc(color)}">` +
    `<div class="iuPrehledDne__timeCol">` +
    `<div class="iuPdCard__time iuPrehledDne__time">${esc(fmtTime(publishIso(ev)))}</div>` +
    `<div class="iuPrehledDne__readMark" aria-label="Přečteno">✓</div>` +
    `</div>` +
    `<div class="iuPrehledDne__axis" aria-hidden="true"><span class="iuPrehledDne__dot${alert ? " iuPrehledDne__dot--alert" : ""}"></span></div>` +
    `<article class="iuPrehledDne__card iuPdCard__body">` +
    `<a class="iuPdCard__title iuPrehledDne__cardTitle" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-act="open-title">${esc(title)}</a>` +
    `<div class="iuPdCard__meta iuPrehledDne__meta">` +
    (src ? `<span class="iuPdCard__pill iuPrehledDne__pill">${esc(src)}</span>` : "") +
    (region ? `<span class="iuPdCard__pill iuPrehledDne__pill">${esc(region)}</span>` : "") +
    (imp ? `<span class="iuPdCard__pill iuPdCard__pill--imp iuPrehledDne__pill">${esc(imp)}</span>` : "") +
    `</div>` +
    `<div class="iuPdCard__actions iuPrehledDne__actions">` +
    (hiddenMode
      ? `<button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="unhide" data-id="${esc(id)}">Obnovit</button>`
      : `<button type="button" class="iuPdBtn iuPdBtn--ghost${saved ? " is-on" : ""}" data-act="save" data-id="${esc(id)}">${saved ? "Uloženo" : "Uložit"}</button>` +
        `<button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="hide" data-id="${esc(id)}">Skrýt</button>`) +
    `</div></article></li>`
  );
}

function topicsAllState(draft) {
  const secs = draft.sections || [];
  return secs.length === 0;
}

function topicsNoneState(draft) {
  const secs = draft.sections || [];
  return secs.length === 1 && secs[0] === NONE_SENTINEL;
}

function sourcesAllState(draft) {
  const groups = draft.sourceGroups || [];
  const ids = (draft.sourceIds || []).filter((x) => x !== NONE_SENTINEL);
  return groups.length === 0 && (draft.sourceIds || []).length === 0;
}

function sourcesNoneState(draft) {
  const groups = draft.sourceGroups || [];
  const ids = draft.sourceIds || [];
  return groups.length === 0 && ids.length === 1 && ids[0] === NONE_SENTINEL;
}

function checkRow(name, value, label, checked, attrs, indeterminate) {
  const ind = indeterminate ? " data-indeterminate=\"1\"" : "";
  return (
    `<label class="iuPdCheck">` +
    `<input type="checkbox" name="${esc(name)}" value="${esc(value)}" ${checked ? "checked" : ""} ${attrs || ""}${ind} />` +
    `<span>${esc(label)}</span></label>`
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

function groupSelectionState(draft, groupDef, registry) {
  const entries = sourcesForNamedGroup(registry, groupDef);
  const ids = entries.map((e) => String(e.id));
  if (!ids.length) return { checked: false, indeterminate: false };
  if (sourcesAllState(draft)) return { checked: true, indeterminate: false };
  if (sourcesNoneState(draft)) return { checked: false, indeterminate: false };
  const selectedIds = new Set((draft.sourceIds || []).filter((x) => x !== NONE_SENTINEL));
  const selectedGroups = new Set(draft.sourceGroups || []);
  const byGroup = (groupDef.groups || []).some((g) => selectedGroups.has(g));
  let n = 0;
  for (const id of ids) if (selectedIds.has(id) || byGroup) n += 1;
  if (byGroup || n === ids.length) return { checked: true, indeterminate: false };
  if (n > 0) return { checked: false, indeterminate: true };
  return { checked: false, indeterminate: false };
}

function sourceIdChecked(draft, id, groupDef, registry) {
  if (sourcesAllState(draft)) return true;
  if (sourcesNoneState(draft)) return false;
  const selectedIds = new Set((draft.sourceIds || []).filter((x) => x !== NONE_SENTINEL));
  if (selectedIds.has(id)) return true;
  const st = groupSelectionState(draft, groupDef, registry);
  if (st.checked && !st.indeterminate) {
    const selectedGroups = new Set(draft.sourceGroups || []);
    if ((groupDef.groups || []).some((g) => selectedGroups.has(g))) return true;
  }
  return false;
}

function expandExplicitSourceIds(draft, registry) {
  if (sourcesAllState(draft)) return allSelectableSourceIds(registry);
  if (sourcesNoneState(draft)) return [];
  const selectedIds = new Set((draft.sourceIds || []).filter((x) => x !== NONE_SENTINEL));
  const selectedGroups = new Set(draft.sourceGroups || []);
  for (const g of SOURCE_GROUPS) {
    if ((g.groups || []).some((x) => selectedGroups.has(x))) {
      for (const e of sourcesForNamedGroup(registry, g)) selectedIds.add(String(e.id));
    }
  }
  return Array.from(selectedIds);
}

function renderTopicsBody(draft) {
  const all = topicsAllState(draft);
  const none = topicsNoneState(draft);
  const selected = new Set((draft.sections || []).filter((x) => x !== NONE_SENTINEL));
  const partial = !all && !none && selected.size > 0 && selected.size < TOPICS.length;
  return (
    `<div class="iuPdChecks" data-iu-pd-sec="temata">` +
    checkRow("topic-all", "all", "Vše", all, 'data-draft-act="topics-all"', partial) +
    TOPICS.map((t) =>
      checkRow("topic", t.id, t.label, all ? true : !none && selected.has(t.id), `data-draft-act="topic" data-id="${esc(t.id)}"`)
    ).join("") +
    `</div>`
  );
}

function renderSourcesBody(draft) {
  const registry = (state.data && state.data.registry) || { entries: [] };
  const all = sourcesAllState(draft);
  const none = sourcesNoneState(draft);
  const explicit = expandExplicitSourceIds(draft, registry);
  const allIds = allSelectableSourceIds(registry);
  const partial = !all && !none && explicit.length > 0 && explicit.length < allIds.length;

  const groupsHtml = SOURCE_GROUPS.map((g) => {
    const entries = sourcesForNamedGroup(registry, g);
    const st = groupSelectionState(draft, g, registry);
    const open = !!state.openSourceGroups[g.id];
    const kids = entries
      .map((e) =>
        checkRow(
          "source-id",
          e.id,
          e.label || e.id,
          sourceIdChecked(draft, String(e.id), g, registry),
          `data-draft-act="source-id" data-id="${esc(e.id)}" data-group="${esc(g.id)}"`
        )
      )
      .join("");
    return (
      `<div class="iuPdSourceGroup" data-sg="${esc(g.id)}">` +
      `<div class="iuPdSourceGroup__head">` +
      checkRow(
        "source-group",
        g.id,
        g.label,
        st.checked,
        `data-draft-act="source-group" data-id="${esc(g.id)}" aria-controls="iuPdSgBody-${esc(g.id)}"`,
        st.indeterminate
      ) +
      `<button type="button" class="iuPdLink" data-act="toggle-sg" data-id="${esc(g.id)}" aria-expanded="${open ? "true" : "false"}" aria-controls="iuPdSgBody-${esc(g.id)}">${open ? "Skrýt" : "Rozbalit"}</button>` +
      `</div>` +
      (open
        ? `<div class="iuPdSourceGroup__body" id="iuPdSgBody-${esc(g.id)}">${kids || `<p class="iuPdMuted">Žádné aktivní zdroje v této skupině.</p>`}</div>`
        : `<div class="iuPdSourceGroup__body" id="iuPdSgBody-${esc(g.id)}" hidden></div>`) +
      `</div>`
    );
  }).join("");

  const standalones = standaloneSources(registry);
  const standHtml = standalones
    .map((e) => {
      const checked = all ? true : none ? false : (draft.sourceIds || []).includes(e.id);
      return checkRow(
        "source-id",
        e.id,
        e.label || e.id,
        checked,
        `data-draft-act="source-id" data-id="${esc(e.id)}" data-group="standalone"`
      );
    })
    .join("");

  return (
    `<div class="iuPdChecks" data-iu-pd-sec="zdroje">` +
    checkRow("source-all", "all", "Vše", all, 'data-draft-act="sources-all"', partial) +
    groupsHtml +
    (standHtml ? `<div class="iuPdSubhead">Samostatné instituce</div>${standHtml}` : "") +
    `</div>`
  );
}

function renderLocalityBody(draft) {
  const wholeCr =
    !draft.myRegionOnly &&
    !(draft.localities || []).length &&
    !draft.homeKraj &&
    !draft.homeOkres &&
    !draft.homeObec &&
    !draft.localityQuery;
  const selKraje = asLocList(draft, "kraj");
  const selOkresy = asLocList(draft, "okres");
  const selCities = asLocList(draft, "mesto");
  const okresOptions = [];
  for (const k of selKraje.length ? selKraje : []) {
    for (const o of CZ_OKRESY[k] || []) okresOptions.push({ kraj: k, okres: o });
  }

  return (
    `<div class="iuPdLocality" data-iu-pd-sec="lokalita">` +
    checkRow("loc-cr", "cr", "Celá ČR", wholeCr, 'data-draft-act="loc-cr"') +
    `<div class="iuPdSubhead">Kraje</div>` +
    `<div class="iuPdChecks iuPdChecks--grid">` +
    CZ_KRAJE.map((k) => checkRow("kraj", k, k, selKraje.includes(k), `data-draft-act="loc-kraj" data-id="${esc(k)}"`)).join("") +
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
      : "") +
    `</div>`
  );
}

function renderSettingsBody() {
  const draft = state.draft || clonePrefs(state.prefs);
  const active = state.activeSection;
  const err = state.saveError
    ? `<div class="iuPdSettings__toast" role="status">${esc(state.saveError)}</div>`
    : "";

  if (!active) {
    return (
      `<div class="iuPdSettings__scroll" id="iuPdSettingsScroll" data-iu-pd-settings-main="1">` +
      err +
      `<div class="iuPdSettings__menu" data-iu-pd-menu="1">` +
      SECTION_ORDER.map(
        (id) =>
          `<button type="button" class="iuPdAcc__toggle iuPdSettings__rail" data-act="open-section" data-id="${esc(id)}" aria-expanded="false">` +
          `<span>${esc(SECTION_LABELS[id])}</span><span class="iuPdAcc__chev" aria-hidden="true"></span>` +
          `</button>`
      ).join("") +
      `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--block iuPdSettings__closeBtn" data-act="settings-close">Zavřít</button>` +
      `</div></div>`
    );
  }

  const body =
    active === "temata" ? renderTopicsBody(draft) : active === "zdroje" ? renderSourcesBody(draft) : renderLocalityBody(draft);

  return (
    `<div class="iuPdSettings__scroll" id="iuPdSettingsScroll" data-iu-pd-settings-section="${esc(active)}">` +
    err +
    `<div class="iuPdSettings__sectionHead">` +
    `<button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="back-section">Zpět</button>` +
    `<h3 class="iuPdSettings__sectionTitle">${esc(SECTION_LABELS[active] || "")}</h3>` +
    `</div>` +
    `<div class="iuPdSettings__sectionBody">${body}</div>` +
    `</div>`
  );
}

function renderSettingsOverlay() {
  return (
    `<div class="iuPdSettings" id="iuPdSettings" role="dialog" aria-modal="true" aria-label="Nastavení přehledu" data-iu-pd-settings="1">` +
    `<div class="iuPdSettings__backdrop" data-act="settings-close"></div>` +
    `<div class="iuPdSettings__panel">` +
    `<header class="iuPdSettings__head"><h2>Můj přehled / Nastavení</h2>` +
    `<button type="button" class="iuPdIconBtn" data-act="settings-close" aria-label="Zavřít">×</button></header>` +
    renderSettingsBody() +
    `</div></div>`
  );
}

function homeShellHtml(listHtml, countLabel, moreHtml) {
  const mode = state.viewMode;
  return (
    `<section class="iuPrehledDne iuPd" data-iu-ui="v6-clean">` +
    `<div class="iuPd__top">` +
    `<button type="button" class="iuPdBtn iuPdBtn--settings iuPdBtn--block" data-act="open-settings">Můj přehled / Nastavení</button>` +
    `</div>` +
    `<div class="iuPd__show">` +
    `<div class="iuPd__label">Zobrazit</div>` +
    `<div class="iuPd__toggles" role="toolbar" aria-label="Zobrazení feedu">` +
    `<button type="button" class="iuPdToggle${mode === "all" ? " is-active" : ""}" data-act="mode" data-mode="all">Vše</button>` +
    `<button type="button" class="iuPdToggle${mode === "saved" ? " is-active" : ""}" data-act="mode" data-mode="saved">Uložené</button>` +
    `<button type="button" class="iuPdToggle${mode === "unread" ? " is-active" : ""}" data-act="mode" data-mode="unread">Nepřečtené</button>` +
    `<button type="button" class="iuPdToggle${mode === "hidden" ? " is-active" : ""}" data-act="mode" data-mode="hidden">Skryté</button>` +
    `</div></div>` +
    `<div class="iuPd__count" id="iuPdCount">${esc(countLabel)}</div>` +
    `<ul class="iuPdFeed iuPrehledDne__timeline" id="iuPrehledDneTimeline">${listHtml}</ul>` +
    `<div id="iuPdMoreWrap">${moreHtml}</div>` +
    `</section>`
  );
}

function removeSettingsHost() {
  const host = document.getElementById("iuPdSettings");
  if (host && host.parentNode) host.parentNode.removeChild(host);
}

function mountSettingsOverlay() {
  removeSettingsHost();
  if (!state.settingsOpen) return null;
  const wrap = document.createElement("div");
  wrap.innerHTML = renderSettingsOverlay();
  const node = wrap.firstElementChild;
  if (!node) return null;
  document.body.appendChild(node);
  applyIndeterminateFlags(node);
  return node;
}

function applyIndeterminateFlags(root) {
  const scope = root || document;
  scope.querySelectorAll("input[type=checkbox][data-indeterminate]").forEach((el) => {
    try {
      el.indeterminate = el.getAttribute("data-indeterminate") === "1";
    } catch (_) {}
  });
}

function resetSettingsScroll() {
  const el = document.getElementById("iuPdSettingsScroll");
  if (!el) return;
  try {
    el.scrollTop = 0;
  } catch (_) {}
  requestAnimationFrame(() => {
    try {
      const again = document.getElementById("iuPdSettingsScroll");
      if (again) again.scrollTop = 0;
      const panel = document.querySelector(".iuPdSettings__panel");
      if (panel) panel.scrollTop = 0;
    } catch (_) {}
  });
}

function restoreSettingsScroll(y) {
  const target = Math.max(0, Number(y) || 0);
  const apply = () => {
    const el = document.getElementById("iuPdSettingsScroll");
    if (!el) return;
    try {
      el.scrollTop = target;
    } catch (_) {}
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

function updateFeedDom() {
  const root = ensureRoot();
  if (!root) return;
  const list = filteredList();
  const pageItems = list.slice(0, state.page * PAGE_SIZE);
  const count = root.querySelector("#iuPdCount");
  const feed = root.querySelector("#iuPrehledDneTimeline");
  const moreWrap = root.querySelector("#iuPdMoreWrap");
  if (count) count.textContent = `${list.length} položek · okno 96 h`;
  if (feed) {
    feed.innerHTML = pageItems.length
      ? pageItems.map(renderItem).join("")
      : `<li class="iuPdEmpty iuPrehledDne__empty">Žádné položky pro toto zobrazení.</li>`;
  }
  if (moreWrap) {
    moreWrap.innerHTML =
      pageItems.length < list.length
        ? `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--block" data-act="more">Načíst další</button>`
        : "";
  }
}

function paint(opts) {
  const options = opts || {};
  const root = ensureRoot();
  if (!root) return;
  const list = filteredList();
  const pageItems = list.slice(0, state.page * PAGE_SIZE);
  const listHtml = pageItems.length
    ? pageItems.map(renderItem).join("")
    : `<li class="iuPdEmpty iuPrehledDne__empty">Žádné položky pro toto zobrazení.</li>`;
  const moreHtml =
    pageItems.length < list.length
      ? `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--block" data-act="more">Načíst další</button>`
      : "";
  root.innerHTML = homeShellHtml(listHtml, `${list.length} položek · okno 96 h`, moreHtml);
  applyIndeterminateFlags(root);
  if (state.settingsOpen) mountSettingsOverlay();
  else removeSettingsHost();
  setBodyScrollLock(state.settingsOpen);
  if (state.settingsOpen && options.resetSettingsScroll) resetSettingsScroll();
  if (!state.settingsOpen) restoreFeedScroll();
}

function paintSettingsOnly(opts) {
  const options = opts || {};
  if (!state.settingsOpen) {
    removeSettingsHost();
    paint(options);
    wire();
    return;
  }
  const scrollEl = document.getElementById("iuPdSettingsScroll");
  const prev = scrollEl ? scrollEl.scrollTop : 0;
  let host = document.getElementById("iuPdSettings");
  if (!host || host.parentElement !== document.body) {
    host = mountSettingsOverlay();
  }
  if (!host) {
    paint(options);
    wire();
    return;
  }
  const panel = host.querySelector(".iuPdSettings__panel");
  if (!panel) {
    mountSettingsOverlay();
    wire();
    if (options.resetSettingsScroll) resetSettingsScroll();
    return;
  }
  panel.innerHTML =
    `<header class="iuPdSettings__head"><h2>Můj přehled / Nastavení</h2>` +
    `<button type="button" class="iuPdIconBtn" data-act="settings-close" aria-label="Zavřít">×</button></header>` +
    renderSettingsBody();
  applyIndeterminateFlags(panel);
  const nextScroll = document.getElementById("iuPdSettingsScroll");
  if (nextScroll) {
    nextScroll.scrollTop = options.resetSettingsScroll ? 0 : prev;
  }
  if (options.resetSettingsScroll) resetSettingsScroll();
}

function showSaveError(msg) {
  state.saveError = msg || "Změnu se nepodařilo uložit. Zkuste to znovu.";
  paintSettingsOnly({ resetSettingsScroll: false });
  wire();
}

function clearSaveError() {
  if (state.saveError) state.saveError = "";
}

function persistDraft() {
  const seq = ++state.persistSeq;
  const snapshot = clonePrefs(state.draft);
  snapshot.unreadOnly = false;
  snapshot.savedOnly = false;
  const ok = setPrefs(snapshot);
  if (seq !== state.persistSeq) return true;
  if (!ok) {
    state.draft = clonePrefs(getPrefs());
    showSaveError("Změnu se nepodařilo uložit. Obnoven poslední uložený stav.");
    return false;
  }
  try {
    const readBack = getPrefs();
    state.prefs = readBack;
    state.draft = clonePrefs(readBack);
    clearSaveError();
    updateFeedDom();
    return true;
  } catch (_) {
    state.draft = clonePrefs(getPrefs());
    showSaveError("Změnu se nepodařilo ověřit. Obnoven poslední uložený stav.");
    return false;
  }
}

function closeSettings() {
  state.settingsOpen = false;
  state.activeSection = null;
  state.draft = null;
  state.cityQuery = "";
  state.citySuggest = [];
  state.saveError = "";
  removeSettingsHost();
  setBodyScrollLock(false);
  paint();
  wire();
  restoreFeedScroll();
  const opener = state.settingsOpener;
  state.settingsOpener = null;
  if (opener && typeof opener.focus === "function") {
    try {
      opener.focus();
    } catch (_) {}
  }
}

function openSettings(opener) {
  captureFeedScroll();
  state.settingsOpener = opener || null;
  state.settingsOpen = true;
  state.activeSection = null;
  state.draft = clonePrefs(state.prefs || getPrefs());
  state.cityQuery = "";
  state.citySuggest = [];
  state.saveError = "";
  state.openSourceGroups = {};
  paint({ resetSettingsScroll: true });
  wire();
  resetSettingsScroll();
  const closeBtn = document.querySelector('#iuPdSettings [data-act="settings-close"].iuPdIconBtn');
  if (closeBtn && typeof closeBtn.focus === "function") {
    try {
      closeBtn.focus({ preventScroll: true });
    } catch (_) {
      try {
        closeBtn.focus();
      } catch (_2) {}
    }
  }
  resetSettingsScroll();
}

function syncDraftFromEvent(ev) {
  const draft = state.draft;
  if (!draft) return;
  const act = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-draft-act");
  if (!act) return;
  const id = ev.target.getAttribute("data-id") || "";
  const checked = !!ev.target.checked;
  const registry = (state.data && state.data.registry) || { entries: [] };

  if (act === "topics-all") {
    draft.sections = checked ? [] : [NONE_SENTINEL];
  } else if (act === "topic") {
    if (topicsAllState(draft)) {
      draft.sections = TOPICS.map((t) => t.id).filter((x) => x !== id);
    } else if (topicsNoneState(draft)) {
      draft.sections = checked ? [id] : [NONE_SENTINEL];
    } else {
      let secs = (draft.sections || []).filter((x) => x !== NONE_SENTINEL);
      if (checked) {
        if (!secs.includes(id)) secs.push(id);
      } else {
        secs = secs.filter((x) => x !== id);
      }
      if (secs.length === TOPICS.length) draft.sections = [];
      else if (!secs.length) draft.sections = [NONE_SENTINEL];
      else draft.sections = secs;
    }
  } else if (act === "sources-all") {
    draft.sourceGroups = [];
    draft.sourceIds = checked ? [] : [NONE_SENTINEL];
    draft.lanes = (draft.lanes || []).filter((l) => l !== "regionalni");
  } else if (act === "source-group") {
    const def = SOURCE_GROUPS.find((g) => g.id === id);
    if (!def) return;
    const childIds = sourcesForNamedGroup(registry, def).map((e) => String(e.id));
    let ids = expandExplicitSourceIds(draft, registry);
    if (checked) {
      ids = Array.from(new Set(ids.concat(childIds)));
    } else {
      const drop = new Set(childIds);
      ids = ids.filter((x) => !drop.has(x));
    }
    draft.sourceGroups = [];
    if (!ids.length) draft.sourceIds = [NONE_SENTINEL];
    else if (ids.length === allSelectableSourceIds(registry).length) draft.sourceIds = [];
    else draft.sourceIds = ids;
  } else if (act === "source-id") {
    let ids = expandExplicitSourceIds(draft, registry);
    if (checked) {
      if (!ids.includes(id)) ids.push(id);
    } else {
      ids = ids.filter((x) => x !== id);
    }
    draft.sourceGroups = [];
    if (!ids.length) draft.sourceIds = [NONE_SENTINEL];
    else if (ids.length === allSelectableSourceIds(registry).length) draft.sourceIds = [];
    else draft.sourceIds = ids;
  } else if (act === "loc-cr") {
    if (checked) {
      draft.localities = [];
      draft.homeKraj = "";
      draft.homeOkres = "";
      draft.homeObec = "";
      draft.localityQuery = "";
      draft.myRegionOnly = false;
    } else {
      draft.myRegionOnly = true;
    }
  } else if (act === "loc-kraj") {
    let kraje = asLocList(draft, "kraj");
    kraje = checked ? Array.from(new Set(kraje.concat(id))) : kraje.filter((x) => x !== id);
    setLocList(draft, "kraj", kraje);
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

  const scrollEl = document.getElementById("iuPdSettingsScroll");
  const prevScroll = scrollEl ? scrollEl.scrollTop : 0;
  if (!persistDraft()) return;
  paintSettingsOnly({ resetSettingsScroll: false });
  wire();
  restoreSettingsScroll(prevScroll);
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
  if (!root) return;

  const clickHandler = async (ev) => {
    const t = ev.target && ev.target.closest ? ev.target.closest("[data-act],[data-draft-act]") : null;
    if (!t) return;
    if (t.matches("input[type=checkbox][data-draft-act]")) {
      syncDraftFromEvent({ target: t });
      return;
    }
    const act = t.getAttribute("data-act");
    if (!act) return;
    if (act === "open-settings") {
      openSettings(t);
      return;
    }
    if (act === "settings-close") {
      closeSettings();
      return;
    }
    if (act === "open-section") {
      const id = t.getAttribute("data-id");
      if (!SECTION_ORDER.includes(id)) return;
      state.activeSection = id;
      paintSettingsOnly({ resetSettingsScroll: true });
      wire();
      resetSettingsScroll();
      return;
    }
    if (act === "back-section") {
      state.activeSection = null;
      paintSettingsOnly({ resetSettingsScroll: true });
      wire();
      resetSettingsScroll();
      return;
    }
    if (act === "toggle-sg") {
      const id = t.getAttribute("data-id");
      state.openSourceGroups[id] = !state.openSourceGroups[id];
      const scrollEl = document.getElementById("iuPdSettingsScroll");
      const prev = scrollEl ? scrollEl.scrollTop : 0;
      paintSettingsOnly({ resetSettingsScroll: false });
      wire();
      restoreSettingsScroll(prev);
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
      const scrollEl = document.getElementById("iuPdSettingsScroll");
      const prev = scrollEl ? scrollEl.scrollTop : 0;
      if (!persistDraft()) return;
      paintSettingsOnly({ resetSettingsScroll: false });
      wire();
      restoreSettingsScroll(prev);
      return;
    }
    if (act === "city-remove") {
      const name = t.getAttribute("data-name");
      setLocList(
        state.draft,
        "mesto",
        asLocList(state.draft, "mesto").filter((x) => x !== name)
      );
      const scrollEl = document.getElementById("iuPdSettingsScroll");
      const prev = scrollEl ? scrollEl.scrollTop : 0;
      if (!persistDraft()) return;
      paintSettingsOnly({ resetSettingsScroll: false });
      wire();
      restoreSettingsScroll(prev);
      return;
    }
  };

  root.onclick = clickHandler;
  const settingsHost = document.getElementById("iuPdSettings");
  if (settingsHost) settingsHost.onclick = clickHandler;

  const inputHandler = async (ev) => {
    const t = ev.target;
    if (!t || t.getAttribute("data-act") !== "city-q") return;
    state.cityQuery = t.value || "";
    const locs = await ensureLocalities();
    state.citySuggest = localitySuggest(state.cityQuery, locs).slice(0, 8);
    const scope = document.getElementById("iuPdSettings") || root;
    const box = scope.querySelector(".iuPdSuggest");
    const input = scope.querySelector('[data-act="city-q"]');
    if (input) input.value = state.cityQuery;
    if (state.citySuggest.length) {
      const html = `<ul class="iuPdSuggest">${state.citySuggest
        .map((s) => `<li><button type="button" data-act="city-add" data-name="${esc(s.name)}">${esc(s.name)}</button></li>`)
        .join("")}</ul>`;
      if (box) box.outerHTML = html;
      else if (input) input.insertAdjacentHTML("afterend", html);
    } else if (box) box.remove();
  };
  root.oninput = inputHandler;
  if (settingsHost) settingsHost.oninput = inputHandler;

  document.onkeydown = (ev) => {
    if (ev.key === "Escape" && state.settingsOpen) {
      if (state.activeSection) {
        state.activeSection = null;
        paintSettingsOnly({ resetSettingsScroll: true });
        wire();
        resetSettingsScroll();
      } else {
        closeSettings();
      }
    }
  };
}

async function boot() {
  migrateLocalStateOnce();
  applyCutoverDom();
  const root = ensureRoot();
  if (!root) return;
  root.innerHTML =
    `<section class="iuPrehledDne iuPd" data-iu-ui="v6-clean">` +
    `<div class="iuPd__top"><div class="iuPdBtn iuPdBtn--settings iuPdBtn--block" style="opacity:0.35;pointer-events:none">Můj přehled / Nastavení</div></div>` +
    `<div class="iuPd__show"><div class="iuPd__label">Zobrazit</div><div class="iuPd__toggles" aria-hidden="true">` +
    `<span class="iuPdToggle">Vše</span><span class="iuPdToggle">Uložené</span><span class="iuPdToggle">Nepřečtené</span><span class="iuPdToggle">Skryté</span>` +
    `</div></div>` +
    `<div class="iuPdFeed" aria-busy="true"></div>` +
    `</section>`;
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
        const vp = feedViewport();
        if (vp) vp.scrollTop = Number(scroll.y);
      } catch (_) {}
    }
    window.addEventListener(
      "beforeunload",
      () => {
        try {
          const vp = feedViewport();
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
