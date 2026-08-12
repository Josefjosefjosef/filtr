/**
 * InfoUzel.cz — Přehled dne UI v6 (timeline axis restore + actions align)
 * Hlavní stránka: Můj přehled/Nastavení + Zobrazit (Vše/Uložené/Nepřečtené/Skryté) + feed.
 * Nastavení: jeden overlay/modal — hlavní 3 lišty, jedna otevřená sekce, autosave.
 * Feed: svislá časová osa + puntíky; Uložit/Skrýt zarovnané vpravo.
 */
import {
  applyCutoverDom,
  loadInfoSystemData,
  loadInfoSystemShellData,
  loadInfoSystemFeedOnly,
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
  isHidden,
  localitySuggest,
  getFilteredWarningLocationLabel,
  expandChmiLocalityPresentationCards,
  chmiPresentationSourceId,
  eventTitleBaseWithoutLocality,
  getEffectiveTimelinePresentation,
  nextTimelineBoundaryMs,
  clearInfoEventsFilterMemo,
  getScrollState,
  setScrollState,
  migrateLocalStateOnce,
  migrateChmiCapV2UserStates,
  rollbackChmiCapV2UserStates,
  iuInfoDataUrl,
  MAX_CITY_LOCALITIES,
} from "./iu-info-system-core-v1.js?v=heavy-feed-shell-first-v1-20260809";
import {
  TRAFFIC_OVERVIEW_FLAGS,
  trafficBadgeModel,
  resolveSafeTrafficMapUrl,
  collectOfflineTrafficCandidates,
  isRsdTrafficSourceEnabled,
  isDopravaTopicEnabled,
  trafficFreshnessBanner,
  loadOfflineTrafficSnapshot,
  fetchHostedTrafficOfflineSnapshot,
  buildTrafficCardViewModel,
  isTrafficFollowed,
  toggleTrafficFollow,
  filterOfflineTrafficCandidatesForOverview,
} from "./iu-traffic-overview-v1.js?v=ndic-municipality-signboard-v1-20260812";
import { ROAD_BADGE_CLASS } from "./iu-traffic-event-art-v1.js?v=ndic-municipality-signboard-v1-20260812";

const PAGE_SIZE = 50;
const CACHE_BUST = "ndic-municipality-signboard-v1-20260812";
const CITY_LIMIT_MSG =
  "Můžete vybrat maximálně 20 obcí. Pokud chcete přidat jinou obec, nejprve některou z vybraných odeberte.";
const CZ_MAP_SPRITE_ID = "iu-cz-map-sprite";
let czMapSpritePromise = null;
const NONE_SENTINEL = "__none__";

/** Inject shared Czechia silhouette sprite once (local #iu-cz-map for all cards). */
function ensureCzMapSprite() {
  if (typeof document === "undefined") return Promise.resolve();
  if (document.getElementById(CZ_MAP_SPRITE_ID)) return Promise.resolve();
  if (czMapSpritePromise) return czMapSpritePromise;
  const holder = document.createElement("div");
  holder.id = CZ_MAP_SPRITE_ID;
  holder.hidden = true;
  holder.setAttribute("aria-hidden", "true");
  document.documentElement.appendChild(holder);
  czMapSpritePromise = fetch("/assets/icons/iu-cz-map.svg?v=" + CACHE_BUST, { credentials: "same-origin" })
    .then((r) => {
      if (!r.ok) throw new Error("cz-map-svg");
      return r.text();
    })
    .then((txt) => {
      holder.innerHTML = txt;
    })
    .catch(() => {
      czMapSpritePromise = null;
    });
  return czMapSpritePromise;
}
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
  { id: "ndic", label: "NDIC / ŘSD", groups: ["doprava"], sourceIds: ["ndic", "rsd"] },
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
  timelineBoundaryTimer: null,
  timelineListenersBound: false,
  /** Client-side traffic chips (not SEPARATE_TRAFFIC_FILTERS). */
  trafficFilters: {
    eventTypes: [],
    roadClasses: [],
    roads: [],
    followedOnly: false,
    activeOnly: false,
  },
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** http(s) only — HTML escape is not a URL scheme allowlist. */
function safeHttpUrl(url) {
  try {
    const u = new URL(String(url || ""), "https://infouzel.cz");
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch (_) {}
  return "";
}

function safeCssColor(color) {
  const s = String(color || "").trim();
  if (/^#[0-9A-Fa-f]{3,8}$/.test(s)) return s;
  if (/^[a-zA-Z]{1,32}$/.test(s)) return s;
  return "#5B6CFF";
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function publishIso(ev) {
  return ev.publishedAtSource || ev.sortAt || ev.firstSeenByInfoUzel || ev.publishedAt || ev.updatedAt || "";
}

function scheduleTimelineBoundaryRefresh() {
  if (state.timelineBoundaryTimer) {
    try {
      clearTimeout(state.timelineBoundaryTimer);
    } catch (_) {}
    state.timelineBoundaryTimer = null;
  }
  const items = (state.data && state.data.feed && state.data.feed.items) || [];
  const now = Date.now();
  let next = nextTimelineBoundaryMs(items, now);
  if (!(next > now)) next = now + 60 * 60 * 1000;
  const delay = Math.max(400, Math.min(next - now + 80, 24 * 3600 * 1000));
  state.timelineBoundaryTimer = setTimeout(() => {
    state.timelineBoundaryTimer = null;
    captureFeedScroll();
    clearInfoEventsFilterMemo();
    paint();
    wire();
    scheduleTimelineBoundaryRefresh();
  }, delay);
}

function bindTimelineLifecycleListeners() {
  if (state.timelineListenersBound) return;
  state.timelineListenersBound = true;
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      captureFeedScroll();
      clearInfoEventsFilterMemo();
      paint();
      wire();
      scheduleTimelineBoundaryRefresh();
    });
  } catch (_) {}
  try {
    window.addEventListener("pageshow", () => {
      captureFeedScroll();
      clearInfoEventsFilterMemo();
      paint();
      wire();
      scheduleTimelineBoundaryRefresh();
    });
  } catch (_) {}
  try {
    window.addEventListener("online", () => {
      captureFeedScroll();
      clearInfoEventsFilterMemo();
      paint();
      wire();
      scheduleTimelineBoundaryRefresh();
    });
  } catch (_) {}
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

/** Sources shown in Nastavení (taxonomy). Includes legally paused official bodies so structure stays stable. */
function settingsCatalogSources(registry) {
  return (registry.entries || []).filter((e) => {
    if (!e) return false;
    const st = String(e.legalStatus || "");
    if (st === "rejected") return false;
    return true;
  });
}

function sourcesForNamedGroup(registry, groupDef) {
  const all = settingsCatalogSources(registry);
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
  const all = settingsCatalogSources(registry);
  const claimed = new Set();
  for (const g of SOURCE_GROUPS) {
    for (const e of sourcesForNamedGroup(registry, g)) claimed.add(e.id);
  }
  return all
    .filter((e) => !claimed.has(e.id))
    .sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id), "cs"));
}

function allSelectableSourceIds(registry) {
  return settingsCatalogSources(registry).map((e) => String(e.id));
}

function clonePrefs(p) {
  return JSON.parse(JSON.stringify(p || getPrefs()));
}

function prefsForMode(prefs, mode) {
  const base = clonePrefs(prefs);
  base.unreadOnly = false;
  base.savedOnly = false;
  if (mode === "all") {
    // Temporary locality bypass only — never mutate stored prefs / localStorage.
    // Topics, sources and other settings stay; cards behave as if no locality was selected.
    base.localityQuery = "";
    base.localities = [];
    base.homeKraj = "";
    base.homeOkres = "";
    base.homeObec = "";
    base.myRegionOnly = false;
    base.favoriteRegions = [];
    return base;
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

/** Effective prefs for the current view (includes temporary Vše locality bypass). */
function effectivePrefs() {
  const prefs = state.prefs || getPrefs();
  return prefsForMode(prefs, state.viewMode);
}

function matchesTrafficClientFilters(ev, tf) {
  if (!(ev && ev.trafficV1)) return true;
  const tv = ev.trafficV1;
  if (tf.followedOnly) {
    if (!isTrafficFollowed(tv.publicEventId)) return false;
  }
  if (tf.activeOnly) {
    if (String(tv.lifecycleStatus || "") !== "ACTIVE") return false;
  }
  if (tf.eventTypes && tf.eventTypes.length) {
    const et = String(tv.eventType || tv.category || "").toLowerCase();
    if (!tf.eventTypes.includes(et)) return false;
  }
  if (tf.roadClasses && tf.roadClasses.length) {
    const rc = String(tv.roadClass || "UNKNOWN");
    if (!tf.roadClasses.includes(rc)) return false;
  }
  if (tf.roads && tf.roads.length) {
    const road = String(tv.road || "").toUpperCase();
    if (!tf.roads.map((r) => String(r).toUpperCase()).includes(road)) return false;
  }
  return true;
}

function applyTrafficClientFilters(list) {
  const tf = state.trafficFilters || {};
  const active =
    (tf.eventTypes && tf.eventTypes.length) ||
    (tf.roadClasses && tf.roadClasses.length) ||
    (tf.roads && tf.roads.length) ||
    tf.followedOnly ||
    tf.activeOnly;
  if (!active) return list;
  return list.filter((ev) => {
    if (!(ev && ev.trafficV1)) return true;
    return matchesTrafficClientFilters(ev, tf);
  });
}

function toggleTrafficFilterValue(arr, value) {
  const list = Array.isArray(arr) ? arr.slice() : [];
  const v = String(value || "");
  const idx = list.indexOf(v);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(v);
  return list;
}

function collectVisibleTrafficRoadPicks(items) {
  const counts = new Map();
  for (const ev of items || []) {
    if (!(ev && ev.trafficV1 && ev.trafficV1.road)) continue;
    const r = String(ev.trafficV1.road).trim().toUpperCase();
    if (!r) continue;
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  return Array.from(counts.keys())
    .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b))
    .slice(0, 8);
}

function shouldShowTrafficFilterBar(list) {
  const prefs = effectivePrefs();
  if (isDopravaTopicEnabled(prefs) && isRsdTrafficSourceEnabled(prefs)) return true;
  return (list || []).some((ev) => ev && ev.trafficV1);
}

function trafficFilterBarHtml(list) {
  if (!shouldShowTrafficFilterBar(list)) return "";
  const tf = state.trafficFilters || {};
  const types = [
    { id: "nehoda", label: "Nehoda" },
    { id: "prace", label: "Práce" },
    { id: "omezeni", label: "Omezení" },
    { id: "prekazka", label: "Překážka" },
    { id: "kolona", label: "Kolona" },
  ];
  const classes = [
    { id: "MOTORWAY", label: "Dálnice" },
    { id: "CLASS_I", label: "I. tř." },
    { id: "CLASS_II", label: "II. tř." },
    { id: "CLASS_III", label: "III. tř." },
    { id: "LOCAL", label: "Místní" },
  ];
  const roads = collectVisibleTrafficRoadPicks(list);
  const chip = (kind, value, label, on) =>
    `<button type="button" class="iuPdChip iuPdTrafficChip${on ? " is-on" : ""}" data-act="tf-filter" data-tf-kind="${esc(
      kind
    )}" data-tf-value="${esc(value)}">${esc(label)}</button>`;
  const typeChips = types
    .map((t) => chip("event", t.id, t.label, (tf.eventTypes || []).includes(t.id)))
    .join("");
  const classChips = classes
    .map((c) => chip("roadClass", c.id, c.label, (tf.roadClasses || []).includes(c.id)))
    .join("");
  const roadChips = roads
    .map((r) => chip("road", r, r, (tf.roads || []).map((x) => String(x).toUpperCase()).includes(r)))
    .join("");
  return (
    `<div class="iuPdTrafficFilters" data-iu-traffic-filters="1">` +
    `<div class="iuPdTrafficFilters__row">` +
    `<span class="iuPdTrafficFilters__label">Typ</span>${typeChips}` +
    `</div>` +
    `<div class="iuPdTrafficFilters__row">` +
    `<span class="iuPdTrafficFilters__label">Třída</span>${classChips}` +
    `</div>` +
    (roadChips
      ? `<div class="iuPdTrafficFilters__row"><span class="iuPdTrafficFilters__label">Silnice</span>${roadChips}</div>`
      : "") +
    `<div class="iuPdTrafficFilters__row">` +
    `<span class="iuPdTrafficFilters__label">Stav</span>` +
    chip("followed", "1", "Sledované", !!tf.followedOnly) +
    chip("active", "1", "Aktivní", !!tf.activeOnly) +
    `</div>` +
    `<div class="iuPdTrafficLegend" aria-hidden="true">` +
    `<span class="iuPdTrafficLegend__item iuPdRoadBadge--motorway">Dálnice</span>` +
    `<span class="iuPdTrafficLegend__item iuPdRoadBadge--road">Silnice</span>` +
    `<span class="iuPdTrafficLegend__item iuPdRoadBadge--e-road">E-tah</span>` +
    `<span class="iuPdTrafficLegend__item iuPdRoadBadge--local">Místní</span>` +
    `</div>` +
    `</div>`
  );
}

function mergeChmiAndTrafficTimeline(chmiList, trafficList) {
  const chmi = Array.isArray(chmiList) ? chmiList : [];
  const traffic = Array.isArray(trafficList) ? trafficList : [];
  if (!traffic.length) return chmi;
  if (!chmi.length) return traffic;
  const nowMs = Date.now();
  const merged = traffic.slice();
  for (let i = 0; i < chmi.length; i++) {
    const ev = chmi[i];
    if (!ev) continue;
    const pres = getEffectiveTimelinePresentation(ev, nowMs);
    const ms = (pres && pres.timelineMs) || 0;
    let lo = 0;
    let hi = merged.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const other = merged[mid];
      let oms = 0;
      if (other && other.trafficV1) {
        oms = Date.parse(String(other.publishedAt || other.publishedAtSource || "")) || 0;
      } else {
        const op = getEffectiveTimelinePresentation(other, nowMs);
        oms = (op && op.timelineMs) || 0;
      }
      if (oms >= ms) lo = mid + 1;
      else hi = mid;
    }
    merged.splice(lo, 0, ev);
  }
  return merged;
}

function filteredList() {
  const items = (state.data && state.data.feed && state.data.feed.items) || [];
  const f = effectivePrefs();
  const mode = state.viewMode;
  // Defer saved/hidden/unread to presentation ids after 1→N CHMI locality expand.
  const filterPrefs = Object.assign({}, f, { savedOnly: false, unreadOnly: false });
  const opts = {
    index: state.index,
    generationId: state.data && state.data.manifest && state.data.manifest.generationId,
    hiddenMode: "include",
  };
  // Keep CHMI/shared feed on the memoized filterEvents path (stable items ref).
  // NDIC offline catalog is filtered separately — never concat into filterEvents (O(n log n) sort on 3k+ cards blocks UI).
  let list = filterEvents(items, filterPrefs, opts);
  if (TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_HOME === false && TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_CARDS_RENDER) {
    const offline = collectOfflineTrafficCandidates(f, {
      snapshot: loadOfflineTrafficSnapshot(),
      nowIso: new Date().toISOString(),
    });
    if (offline.length) {
      const trafficList = filterOfflineTrafficCandidatesForOverview(offline, filterPrefs, {
        nowMs: Date.now(),
      });
      const seen = new Set(list.map((x) => String((x && x.id) || "")));
      const uniqueTraffic = trafficList.filter((x) => x && !seen.has(String(x.id)));
      list = mergeChmiAndTrafficTimeline(list, uniqueTraffic);
    }
  }
  list = expandChmiLocalityPresentationCards(list, f);
  list = list.filter((ev) => {
    const id = String((ev && ev.id) || "");
    const src = chmiPresentationSourceId(ev) || id;
    const hid = isHidden(id) || (src && src !== id && isHidden(src));
    if (mode === "hidden") return hid;
    return !hid;
  });
  if (mode === "saved") {
    list = list.filter((ev) => {
      const id = String((ev && ev.id) || "");
      const src = chmiPresentationSourceId(ev) || id;
      return isSaved(id) || (src && src !== id && isSaved(src));
    });
  }
  if (mode === "unread") {
    list = list.filter((ev) => {
      const id = String((ev && ev.id) || "");
      const src = chmiPresentationSourceId(ev) || id;
      return !isRead(id) && !(src && src !== id && isRead(src));
    });
  }
  list = applyTrafficClientFilters(list);
  return list;
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

function chmiPublicDetailUrl(ev) {
  // Unified public click for every CHMI card: https://vystrahy-cr.chmi.cz/
  // Never open CAP XML, ovzduší, or other specialized CAP <web> pages.
  if (!(ev && (ev.capV2 || String(ev.sourceId || "") === "chmi"))) return "";
  const forced = String(
    (ev.publicClickUrl ||
      ev.publicUrl ||
      (ev.capV2 && (ev.capV2.publicClickUrl || ev.capV2.publicUrl)) ||
      "")
  ).trim();
  if (forced) {
    try {
      const u = new URL(forced);
      if (u.protocol === "https:" && /^vystrahy-cr\.chmi\.cz$/i.test(u.hostname.replace(/^www\./, ""))) {
        return u.toString().replace(/\/+$/, "") + "/";
      }
    } catch {
      /* fall through to unified portal */
    }
  }
  return "https://vystrahy-cr.chmi.cz/";
}

/**
 * Presentational title — drop redundant "Výstraha ČHMÚ:" when badge already shows source.
 * For CAP v2, locality suffix follows the active location filter (display-only).
 */
function displayEventTitle(ev, locationFilter) {
  let base = eventTitleBaseWithoutLocality(ev);
  // Display-only chemical notation; capV2.event / identity stay ASCII O3.
  base = String(base || "").replace(/\bO3\b/g, "O₃");
  if (!(ev && ev.capV2)) return base;
  const presLoc = ev && ev._iuPresentation ? String(ev._iuPresentation.locationLabel || "").trim() : "";
  const loc =
    presLoc || getFilteredWarningLocationLabel(ev, locationFilter || state.prefs || getPrefs());
  if (!loc) return base;
  if (base.includes(loc)) return base;
  return base + " — " + loc;
}

function renderTrafficCardBody(ev, url, czMapMarkup) {
  const vm = buildTrafficCardViewModel(ev.trafficV1);
  const badge = vm.badge;
  const warnBadge = badge
    ? `<span class="iuPdCard__warnBadge iuPrehledDne__warnBadge iuPdCard__warnBadge--traffic iuPdCard__warnBadge--${esc(
        badge.kind
      )}" role="status" aria-label="${esc(badge.aria)}">${esc(badge.text)}</span>`
    : "";
  const numberMod =
    (vm.roadBadge && vm.roadBadge.numberBadge) ||
    ROAD_BADGE_CLASS[vm.roadBadge.roadClass] ||
    ROAD_BADGE_CLASS.UNKNOWN ||
    "unknown";
  const roadTypeIcon =
    vm.roadBadge && vm.roadBadge.roadTypeIcon
      ? `<img class="iuPdTrafficRoadSign" src="${esc(vm.roadBadge.roadTypeIcon)}" alt="${esc(
          vm.roadBadge.roadTypeIconAlt || ""
        )}" width="28" height="28" loading="lazy" decoding="async" />`
      : "";
  const roadBadge = vm.roadBadge.road
    ? `<span class="iuPdRoadBadge iuPdRoadBadge--${esc(numberMod)}" title="${esc(
        vm.roadBadge.label
      )}">${esc(vm.roadBadge.road)}</span>`
    : "";
  const muniLabel =
    vm.municipalitySignLabel ||
    (vm.presentation &&
      vm.presentation.communication &&
      vm.presentation.communication.municipalitySignLabel) ||
    "";
  const muniSign = muniLabel
    ? `<span class="iuPdMuniSign" data-iu-muni-sign="1">${esc(muniLabel)}</span>`
    : "";
  const beside =
    vm.besideLocality ||
    (vm.presentation &&
      vm.presentation.communication &&
      vm.presentation.communication.besideLocality) ||
    "";
  const besideBit = beside
    ? `<span class="iuPdTrafficComm__beside">${esc(beside)}</span>`
    : "";
  const districtBeside =
    vm.districtBeside ||
    (vm.presentation &&
      vm.presentation.communication &&
      vm.presentation.communication.districtBeside) ||
    "";
  const districtBit = districtBeside
    ? `<span class="iuPdTrafficComm__district">${esc(districtBeside)}</span>`
    : "";
  const dirBit = vm.direction
    ? `<span class="iuPdTrafficComm__dir">→ směr ${esc(vm.direction)}</span>`
    : "";
  // Fallback only when neither municipality sign nor road badge carries the place.
  const localityFallback =
    !muniSign &&
    !vm.roadBadge.road &&
    (vm.headLocality || vm.locality || vm.localityLine)
      ? `<span class="iuPdTrafficComm__place">${esc(
          vm.headLocality || vm.locality || vm.localityLine
        )}</span>`
      : "";
  const eventSign = vm.eventSignSrc
    ? `<img class="iuPdTrafficEventSign" src="${esc(vm.eventSignSrc)}" alt="" width="40" height="40" loading="lazy" decoding="async" />`
    : "";
  const eventTitle = vm.eventTypeLabel
    ? `<span class="iuPdTrafficEventTitle">${esc(vm.eventTypeLabel)}</span>`
    : "";
  const placeLine = vm.placeLine || vm.communicationLine || "";
  const placeBlock = placeLine
    ? `<div class="iuPdTrafficBlock" data-tk="place">` +
      `<div class="iuPdTrafficBlock__h">${esc(vm.placeLabel || "Místo")}</div>` +
      `<div class="iuPdTrafficBlock__v">${esc(placeLine)}</div>` +
      `</div>`
    : "";
  const situation = vm.situationSummary || vm.leadText || "";
  const situationBlock = situation
    ? `<div class="iuPdTrafficBlock" data-tk="situation">` +
      `<div class="iuPdTrafficBlock__h">${esc(vm.situationLabel || "Dopravní situace")}</div>` +
      `<div class="iuPdTrafficBlock__v">${esc(situation)}</div>` +
      `</div>`
    : "";
  const validityBlock = vm.validityLine
    ? `<div class="iuPdTrafficBlock" data-tk="validity">` +
      `<div class="iuPdTrafficBlock__h">Platnost</div>` +
      `<div class="iuPdTrafficBlock__v">${esc(vm.validityLine)}</div>` +
      `</div>`
    : "";
  const expandedRows = (vm.expandedRows || [])
    .filter((r) => r && r.value && String(r.value).trim())
    .map(
      (r) =>
        `<div class="iuPdTrafficMore__row" data-tk="${esc(r.key)}">` +
        `<span class="iuPdTrafficMore__k">${esc(r.label)}</span>` +
        `<span class="iuPdTrafficMore__v">${esc(r.value)}</span>` +
        `</div>`
    )
    .join("");
  // Source description is only in expandedRows (sourceDescription) — never also as duplicate body.
  const moreBody = expandedRows ? `<div class="iuPdTrafficMore__grid">${expandedRows}</div>` : "";
  const more =
    vm.showMore && moreBody
      ? `<details class="iuPdTrafficMore">` +
        `<summary aria-label="Zobrazit nebo skrýt úplné informace ŘSD/NDIC">` +
        `<span class="iuPdTrafficMore__open">Zobrazit více</span>` +
        `<span class="iuPdTrafficMore__close">Skrýt</span>` +
        `</summary>` +
        moreBody +
        `</details>`
      : "";
  const note = vm.locationNote ? `<p class="iuPdTrafficNote">${esc(vm.locationNote)}</p>` : "";
  const source = vm.sourceLabel
    ? `<div class="iuPdTrafficSource">Zdroj: ${esc(vm.sourceLabel)}</div>`
    : "";
  return (
    `<div class="iuPdTrafficCard" data-iu-traffic-unified="1">` +
    `<div class="iuPdTrafficTop">` +
    `<div class="iuPdTrafficTop__main">` +
    (warnBadge ? `<div class="iuPdTrafficTop__badge">${warnBadge}</div>` : "") +
    `<div class="iuPdTrafficComm">` +
    muniSign +
    roadTypeIcon +
    roadBadge +
    besideBit +
    districtBit +
    dirBit +
    localityFallback +
    `</div>` +
    `</div>` +
    (czMapMarkup ? `<div class="iuPdTrafficTop__map">${czMapMarkup}</div>` : "") +
    `</div>` +
    `<div class="iuPdTrafficEventRow" data-kind="${esc(vm.eventKind || "")}">` +
    eventSign +
    eventTitle +
    `</div>` +
    placeBlock +
    situationBlock +
    validityBlock +
    source +
    more +
    note +
    `</div>`
  );
}

function renderItem(ev) {
  const id = String(ev.id || "");
  const isTraffic = !!(ev && ev.trafficV1);
  const forced = chmiPublicDetailUrl(ev);
  const trafficMapUrl = isTraffic ? resolveSafeTrafficMapUrl(ev.trafficV1.mapTarget) : "";
  // CHMI: never fall back to XML / specialized publisher web — portal only.
  // Traffic: only allowlisted mapTarget URLs (never heuristic internal IDs).
  const url = isTraffic
    ? safeHttpUrl(trafficMapUrl)
    : ev && ev.capV2
      ? safeHttpUrl(forced)
      : safeHttpUrl(forced || ev.url || ev.originalUrl);
  const locationFilter = effectivePrefs();
  const title = isTraffic
    ? String((ev.trafficV1.feed && ev.trafficV1.feed.feedHeadline) || ev.title || "Dopravní událost")
    : displayEventTitle(ev, locationFilter);
  const srcRaw = String(ev.sourceLabel || ev.sourceId || "");
  const isNdic =
    String(ev.sourceId || "") === "ndic" ||
    String(ev.adapterOwner || "") === "ndic-datex-v1" ||
    !!(ev && ev.ndicV1);
  const srcPill = isTraffic
    ? ""
    : ev.capV2
      ? srcRaw
        ? "Zdroj: " + srcRaw
        : "Zdroj: ČHMÚ"
      : isNdic
        ? "Zdroj: NDIC"
        : srcRaw;
  const regionFiltered = getFilteredWarningLocationLabel(ev, locationFilter);
  const region = isTraffic
    ? ""
    : ev.capV2
      ? String(regionFiltered || "")
      : ev.region && (ev.region.summary || ev.region.name)
        ? String(ev.region.summary || ev.region.name)
        : "";
  // Hide locality meta pill when the same text is already in the title (CAP cards).
  const regionPill = region && title.indexOf(region) === -1 ? region : "";
  const imp = isTraffic ? "" : importanceLabel(ev);
  const saved = isSaved(id);
  const hiddenMode = state.viewMode === "hidden";
  const read = isRead(id);
  const color = safeCssColor(sectionColor(ev.sectionId));
  const alert = String(ev.eventType || "") === "mimoradne" || Number(ev.importance) >= 5;
  const capActive = !!(ev.capV2 && ev.capV2.badgeActive);
  const capEnded = !!(ev.capV2 && (ev.status === "ukonceno" || ev.status === "zruseno"));
  const trafficBadge = isTraffic ? trafficBadgeModel(ev.trafficV1) : null;
  const trafficFollowed = isTraffic ? isTrafficFollowed(ev.trafficV1.publicEventId) : false;
  const timeline = getEffectiveTimelinePresentation(ev, Date.now());
  const timePrimary = esc(timeline.primaryDate || fmtTime(publishIso(ev)));
  const timeSub = timeline.primaryTime ? `<div class="iuPrehledDne__timeSub">${esc(timeline.primaryTime)}</div>` : "";
  let timeIssued = "";
  if (timeline.secondaryIssuedLabel) {
    const issued = String(timeline.secondaryIssuedLabel);
    const m = issued.match(/^(Vydáno|Aktualizováno)\s+(.+)$/i);
    let issuedWord = "";
    if (m) {
      issuedWord = /^aktualiz/i.test(m[1]) ? "Aktualizováno" : "Vydáno";
    }
    timeIssued = m
      ? `<div class="iuPrehledDne__issued"><span class="iuPrehledDne__issuedWord">${esc(issuedWord)}</span><span class="iuPrehledDne__issuedDate">${esc(m[2])}</span></div>`
      : `<div class="iuPrehledDne__issued">${esc(issued)}</div>`;
  }
  let timeValidFrom = "";
  if (timeline.isFutureWarning && timeline.secondaryValidFromLabel) {
    // One red sentence for future CAP only (date + time + hod. already in label).
    timeValidFrom =
      `<div class="iuPrehledDne__validFrom iuPrehledDne__validFrom--futureSentence">` +
      `<span class="iuPrehledDne__validFromWord">${esc(timeline.secondaryValidFromLabel)}</span>` +
      `</div>`;
  } else if (
    timeline.secondaryValidFromLabel &&
    (timeline.secondaryValidFromDate || timeline.secondaryValidFromTime)
  ) {
    timeValidFrom =
      `<div class="iuPrehledDne__validFrom">` +
      `<span class="iuPrehledDne__validFromWord">${esc(timeline.secondaryValidFromLabel)}</span>` +
      (timeline.secondaryValidFromDate
        ? `<span class="iuPrehledDne__validFromDate">${esc(timeline.secondaryValidFromDate)}</span>`
        : "") +
      (timeline.secondaryValidFromTime
        ? `<span class="iuPrehledDne__validFromTime">${esc(timeline.secondaryValidFromTime)}</span>`
        : "") +
      `</div>`;
  }
  // Green AKTIVNÍ pill follows live lifecycle (ACTIVE only), not badgeActive (active+future warn cards).
  const activePill = timeline.isActiveWarning
    ? `<span class="iuPdCard__pill iuPdCard__pill--active iuPrehledDne__pill" role="status" aria-label="Právě platná výstraha">AKTIVNÍ VÝSTRAHA</span>`
    : "";
  const titleMarkup = url
    ? `<a class="iuPdCard__title iuPrehledDne__cardTitle" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-act="open-title">${esc(title)}</a>`
    : `<span class="iuPdCard__title iuPrehledDne__cardTitle" data-act="open-title">${esc(title)}</span>`;
  // Shared CZ silhouette — same href + data-act as title (no second URL logic).
  // Color comes from inherited --iu-pd-dot (same token as timeline dot fill).
  const czMapMarkup =
    ev && ev.capV2 && url
      ? `<a class="iuPdCard__czMap iuPrehledDne__czMap" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-act="open-title" aria-label="Otevřít ČHMÚ"><svg class="iuPrehledDne__czMapSvg" viewBox="0 0 100 57.48" width="57.6" height="33.1" aria-hidden="true" focusable="false"><use href="#iu-cz-map"></use></svg></a>`
      : isTraffic && url
        ? `<a class="iuPdCard__czMap iuPrehledDne__czMap" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-act="open-title" aria-label="Otevřít mapu ŘSD"><svg class="iuPrehledDne__czMapSvg" viewBox="0 0 100 57.48" width="57.6" height="33.1" aria-hidden="true" focusable="false"><use href="#iu-cz-map"></use></svg></a>`
        : isTraffic
          ? `<span class="iuPdCard__czMap iuPrehledDne__czMap iuPdCard__czMap--static" aria-hidden="true"><svg class="iuPrehledDne__czMapSvg" viewBox="0 0 100 57.48" width="57.6" height="33.1" focusable="false"><use href="#iu-cz-map"></use></svg></span>`
          : "";
  const warnBadge = capActive
    ? `<span class="iuPdCard__warnBadge iuPrehledDne__warnBadge" role="status" aria-label="Výstraha ČHMÚ">🔴 VÝSTRAHA ČHMÚ</span>`
    : capEnded
      ? `<span class="iuPdCard__warnBadge iuPdCard__warnBadge--ended iuPrehledDne__warnBadge" role="status">${esc(ev.status === "zruseno" ? "Zrušeno" : "Ukončeno")}</span>`
      : !isTraffic && trafficBadge
        ? `<span class="iuPdCard__warnBadge iuPrehledDne__warnBadge iuPdCard__warnBadge--traffic iuPdCard__warnBadge--${esc(
            trafficBadge.kind
          )}" role="status" aria-label="${esc(trafficBadge.aria)}">${esc(trafficBadge.text)}</span>`
        : "";
  const regionCoverage = String((ev && ev._iuPresentation && ev._iuPresentation.regionCoverageLine) || "").trim();
  const regionCoverageMarkup = regionCoverage
    ? `<div class="iuPrehledDne__regionCoverage">${esc(regionCoverage)}</div>`
    : "";
  /* Map inside headMain + CSS float:right so title/coverage wrap beside then under it. */
  const cardHead = czMapMarkup
    ? `<div class="iuPrehledDne__cardHead">` +
      `<div class="iuPrehledDne__cardHeadMain">` +
      czMapMarkup +
      warnBadge +
      titleMarkup +
      regionCoverageMarkup +
      `</div>` +
      `</div>`
    : warnBadge + titleMarkup + regionCoverageMarkup;
  const trafficBody = isTraffic ? renderTrafficCardBody(ev, url, czMapMarkup) : "";
  const followId = isTraffic ? String(ev.trafficV1.publicEventId || "") : "";
  const actions = hiddenMode
    ? `<button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="unhide" data-id="${esc(id)}">Obnovit</button>`
    : isTraffic
      ? `<button type="button" class="iuPdBtn iuPdBtn--primary${
          trafficFollowed ? " is-on" : ""
        }" data-act="traffic-follow" data-id="${esc(id)}" data-peid="${esc(followId)}">${
          trafficFollowed ? "Sleduji" : "Sledovat"
        }</button>` +
        `<button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="hide" data-id="${esc(id)}">Skrýt</button>`
      : `<button type="button" class="iuPdBtn iuPdBtn--ghost${saved ? " is-on" : ""}" data-act="save" data-id="${esc(
          id
        )}">${saved ? "Uloženo" : "Uložit"}</button>` +
        `<button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="hide" data-id="${esc(id)}">Skrýt</button>`;
  return (
    `<li class="iuPdCard iuPrehledDne__item${read ? " is-read" : ""}${timeline.isFutureWarning ? " is-futureWarning" : ""}${
      isTraffic ? " iuPdCard--traffic" : ""
    }" data-id="${esc(id)}"${isTraffic ? ' data-iu-traffic="1"' : ""} style="--iu-pd-dot:${esc(color)}">` +
    `<div class="iuPrehledDne__timeCol">` +
    `<div class="iuPdCard__time iuPrehledDne__time">${timePrimary}</div>` +
    timeSub +
    timeIssued +
    timeValidFrom +
    `<div class="iuPrehledDne__readMark" aria-label="Přečteno">✓</div>` +
    `</div>` +
    `<div class="iuPrehledDne__axis" aria-hidden="true"><span class="iuPrehledDne__dot${
      alert || capActive || (trafficBadge && trafficBadge.kind === "new") ? " iuPrehledDne__dot--alert" : ""
    }"></span></div>` +
    `<article class="iuPrehledDne__card iuPdCard__body${
      czMapMarkup ? " iuPrehledDne__card--hasCzMap" : ""
    }${isTraffic ? " iuPdCard__body--traffic" : ""}">` +
    (isTraffic
      ? trafficBody
      : cardHead +
        `<div class="iuPdCard__meta iuPrehledDne__meta">` +
        (srcPill ? `<span class="iuPdCard__pill iuPrehledDne__pill">${esc(srcPill)}</span>` : "") +
        activePill +
        (regionPill ? `<span class="iuPdCard__pill iuPrehledDne__pill">${esc(regionPill)}</span>` : "") +
        (imp ? `<span class="iuPdCard__pill iuPdCard__pill--imp iuPrehledDne__pill">${esc(imp)}</span>` : "") +
        `</div>`) +
    `<div class="iuPdCard__actions iuPrehledDne__actions">${actions}</div></article></li>`
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
  if (level === "mesto") return asCityEntries(draft).map((c) => c.name);
  const out = [];
  for (const loc of draft.localities || []) {
    if (!loc) continue;
    if (typeof loc === "string") continue;
    if (String(loc.level || "") === level && loc.name) out.push(String(loc.name));
  }
  if (level === "kraj" && draft.homeKraj) out.push(String(draft.homeKraj));
  if (level === "okres" && draft.homeOkres) out.push(String(draft.homeOkres));
  return Array.from(new Set(out));
}

function asCityEntries(draft) {
  const out = [];
  const seenIds = new Set();
  const seenNames = new Set();
  for (const loc of draft.localities || []) {
    if (!loc) continue;
    if (typeof loc === "string") {
      const name = String(loc).trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      out.push({ name, level: "mesto" });
      continue;
    }
    const level = String(loc.level || "mesto").toLowerCase();
    if (level === "kraj" || level === "okres") continue;
    const name = String(loc.name || "").trim();
    if (!name) continue;
    const id = String(loc.id || "").trim();
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    } else {
      const key = name.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
    }
    const entry = { name, level: "mesto" };
    if (id) entry.id = id;
    if (loc.orpCode) entry.orpCode = String(loc.orpCode);
    out.push(entry);
  }
  if (draft.homeObec && !out.length) {
    out.push({ name: String(draft.homeObec), level: "mesto" });
  }
  return out.slice(0, MAX_CITY_LOCALITIES || 20);
}

function setCityList(draft, cities) {
  const desired = [];
  const seenIds = new Set();
  const seenNames = new Set();
  for (const c of cities || []) {
    if (!c) continue;
    const name = String(typeof c === "string" ? c : c.name || "").trim();
    if (!name) continue;
    const id = String((typeof c === "object" && c.id) || "").trim();
    const orpCode = String((typeof c === "object" && (c.orpCode || c.orp)) || "").trim();
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    } else {
      const key = name.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
    }
    if (desired.length >= (MAX_CITY_LOCALITIES || 20)) break;
    const entry = { name, level: "mesto" };
    if (id) entry.id = id;
    if (orpCode) entry.orpCode = orpCode;
    desired.push(entry);
  }
  const desiredByKey = new Map();
  for (const entry of desired) {
    desiredByKey.set(entry.id ? "id:" + entry.id : "n:" + entry.name.toLowerCase(), entry);
  }
  const next = [];
  const placed = new Set();
  for (const loc of draft.localities || []) {
    if (!loc) continue;
    if (typeof loc === "string") {
      const key = "n:" + String(loc).trim().toLowerCase();
      if (desiredByKey.has(key) && !placed.has(key)) {
        next.push(desiredByKey.get(key));
        placed.add(key);
      }
      continue;
    }
    const level = String(loc.level || "mesto").toLowerCase();
    if (level === "kraj" || level === "okres") {
      next.push(loc);
      continue;
    }
    const id = String(loc.id || "").trim();
    const key = id ? "id:" + id : "n:" + String(loc.name || "").trim().toLowerCase();
    if (desiredByKey.has(key) && !placed.has(key)) {
      next.push(desiredByKey.get(key));
      placed.add(key);
    }
  }
  for (const entry of desired) {
    const key = entry.id ? "id:" + entry.id : "n:" + entry.name.toLowerCase();
    if (placed.has(key)) continue;
    next.push(entry);
    placed.add(key);
  }
  draft.localities = next;
  draft.homeObec = desired[0] ? desired[0].name : "";
  draft.myRegionOnly =
    desired.length > 0 || asLocList(draft, "kraj").length > 0 || asLocList(draft, "okres").length > 0;
  if (!desired.length && !asLocList(draft, "kraj").length && !asLocList(draft, "okres").length) {
    draft.myRegionOnly = false;
    draft.homeKraj = draft.homeKraj || "";
    draft.homeOkres = draft.homeOkres || "";
    draft.homeObec = "";
  }
}

function setLocList(draft, level, names) {
  if (level === "mesto") {
    setCityList(
      draft,
      (names || []).map((n) => (typeof n === "string" ? { name: n, level: "mesto" } : n))
    );
    return;
  }
  const wanted = [];
  const seen = new Set();
  for (const n of names || []) {
    const name = String(n || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push({ name, level });
  }
  const wantedKeys = new Set(wanted.map((w) => w.name.toLowerCase()));
  const next = [];
  const placed = new Set();
  for (const loc of draft.localities || []) {
    if (!loc || typeof loc === "string") {
      if (typeof loc === "string" && level === "mesto") continue;
      if (typeof loc === "string") next.push(loc);
      continue;
    }
    const locLevel = String(loc.level || "").toLowerCase();
    if (locLevel !== level) {
      next.push(loc);
      continue;
    }
    const key = String(loc.name || "").trim().toLowerCase();
    if (wantedKeys.has(key) && !placed.has(key)) {
      next.push({ name: String(loc.name).trim(), level });
      placed.add(key);
    }
  }
  for (const w of wanted) {
    const key = w.name.toLowerCase();
    if (placed.has(key)) continue;
    next.push(w);
    placed.add(key);
  }
  draft.localities = next;
  if (level === "kraj") {
    draft.homeKraj = names[0] || "";
    draft.myRegionOnly = names.length > 0 || asLocList(draft, "okres").length > 0 || asCityEntries(draft).length > 0;
  }
  if (level === "okres") {
    draft.homeOkres = names[0] || "";
    draft.myRegionOnly = names.length > 0 || asLocList(draft, "kraj").length > 0 || asCityEntries(draft).length > 0;
  }
  if (!names.length && !asLocList(draft, "kraj").length && !asLocList(draft, "okres").length && !asCityEntries(draft).length) {
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

  // ŘSD/NDIC uses the SAME Zdroje + Lokalita rails — no parallel traffic settings panel.
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
  const selCities = asCityEntries(draft);
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
          .map((s) => {
            const label = s.label || s.name;
            return (
              `<li><button type="button" data-act="city-add" data-name="${esc(s.name)}" data-id="${esc(s.id || "")}" data-orp="${esc(s.orpCode || "")}">${esc(label)}</button></li>`
            );
          })
          .join("")}</ul>`
      : "") +
    (selCities.length
      ? `<div class="iuPdChips">${selCities
          .map(
            (c) =>
              `<button type="button" class="iuPdChip" data-act="city-remove" data-name="${esc(c.name)}" data-id="${esc(c.id || "")}">${esc(c.name)} ×</button>`
          )
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

function bannerHtml() {
  return (
    `<div class="iuPd__banner" data-iu-pd-banner="1" data-testid="prehled-dne-homecard">` +
    `<img class="iuPd__bannerImg" src="/assets/images/infouzel-prehled-dne-banner.png" width="1661" height="616" ` +
    `alt="InfoUzel – přehled dne podle vybraných témat, regionů a zdrojů" ` +
    `decoding="async" fetchpriority="high" loading="eager" />` +
    `</div>`
  );
}

function homeSectionBarHtml(label, barId) {
  const id = String(barId || "1");
  return (
    `<div class="iuHomeSectionBar" data-iu-home-section-bar="${id}" aria-hidden="true">` +
    String(label || "") +
    `</div>`
  );
}

/** Green hero CTA under banner — label centered, › as navigation affordance (right). */
function settingsCtaInnerHtml() {
  return `<span class="iuPdBtn__label">Nastavení</span><span class="iuPdBtn__chevron" aria-hidden="true">›</span>`;
}

function homeShellHtml(listHtml, countLabel, moreHtml, listForFilters) {
  const mode = state.viewMode;
  const offlineSnap = loadOfflineTrafficSnapshot();
  const fresh = trafficFreshnessBanner(offlineSnap);
  const trafficOfflineBanner =
    fresh && isRsdTrafficSourceEnabled(effectivePrefs())
      ? `<div class="iuPdTrafficOffline" data-iu-traffic-offline="1" role="status">${esc(fresh.label)}</div>`
      : "";
  const filterBar = trafficFilterBarHtml(listForFilters || []);
  const hasTraffic = (listForFilters || []).some((ev) => ev && ev.trafficV1);
  return (
    `<section class="iuPrehledDne iuPd" data-iu-ui="v6-clean"${hasTraffic ? ' data-iu-has-traffic="1"' : ""}>` +
    `<div class="iuHomeSectionStack" data-iu-home-section-stack="pd">` +
    homeSectionBarHtml("MŮJ PŘEHLED DNE", "muj-prehled-dne") +
    `<div class="iuPd__hero" data-iu-pd-hero="1" data-testid="prehled-dne-hero">` +
    bannerHtml() +
    `<div class="iuPd__top">` +
    `<button type="button" class="iuPdBtn iuPdBtn--settings iuPdBtn--block" data-act="open-settings" data-testid="prehled-dne-settings-cta">` +
    settingsCtaInnerHtml() +
    `</button>` +
    `</div>` +
    `</div>` +
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
    trafficOfflineBanner +
    filterBar +
    `<ul class="iuPdFeed iuPrehledDne__timeline${hasTraffic ? " iuPdFeed--trafficPad" : ""}" id="iuPrehledDneTimeline">${listHtml}</ul>` +
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
  void ensureCzMapSprite();
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
    const hasTraffic = pageItems.some((ev) => ev && ev.trafficV1);
    feed.classList.toggle("iuPdFeed--trafficPad", hasTraffic);
  }
  if (moreWrap) {
    moreWrap.innerHTML =
      pageItems.length < list.length
        ? `<button type="button" class="iuPdBtn iuPdBtn--ghost iuPdBtn--block" data-act="more">Načíst další</button>`
        : "";
  }
  const existingFilters = root.querySelector("[data-iu-traffic-filters]");
  const bar = trafficFilterBarHtml(list);
  if (bar) {
    if (existingFilters) existingFilters.outerHTML = bar;
    else if (count) count.insertAdjacentHTML("afterend", bar);
  } else if (existingFilters) {
    existingFilters.remove();
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
  // Keep an existing hero shell (boot skeleton / prior paint) to avoid CLS from full innerHTML replace.
  const heroReady = !!root.querySelector('[data-testid="prehled-dne-hero"] [data-act="open-settings"]');
  const feedReady = !!root.querySelector("#iuPrehledDneTimeline");
  if (heroReady && feedReady && !options.forceFullShell) {
    updateFeedDom();
    // Sync show-strip active mode without rebuilding hero.
    try {
      root.querySelectorAll(".iuPdToggle[data-act='mode']").forEach((btn) => {
        const mode = btn.getAttribute("data-mode") || "";
        btn.classList.toggle("is-active", mode === state.viewMode);
      });
    } catch (_) {}
  } else {
    root.innerHTML = homeShellHtml(listHtml, `${list.length} položek · okno 96 h`, moreHtml, list);
  }
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
    const items = (json.items || []).map((it) => {
      const name = String((it.a && it.a[0]) || it.n || "").trim() || String(it.n || "");
      const id = String(it.id || "").trim();
      const orpCode = String(it.orp || it.orpCode || "").trim();
      const okresName = String(it.ok || it.okresName || "").trim();
      const orpName = String(it.orpN || it.orpName || "").trim();
      return {
        name,
        id,
        orpCode,
        orpName,
        okresName,
        level: "mesto",
        label: okresName ? name + " (" + okresName + ")" : name,
      };
    });
    state.localitiesCache = items.filter((x) => x.name && x.id && x.orpCode);
  } catch (_) {
    state.localitiesCache = [
      { name: "Praha", id: "554782", orpCode: "1000", level: "mesto", label: "Praha" },
      { name: "Brno", id: "582786", orpCode: "6203", level: "mesto", label: "Brno" },
      { name: "Ostrava", id: "554821", orpCode: "8119", level: "mesto", label: "Ostrava" },
      { name: "Plzeň", id: "554791", orpCode: "3209", level: "mesto", label: "Plzeň" },
      { name: "Liberec", id: "563889", orpCode: "5105", level: "mesto", label: "Liberec" },
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
        // Toggle: 1st click → temporary locality bypass; 2nd click → restore saved filter (home).
        // Never writes localities to localStorage / prefs.
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
    if (act === "traffic-follow") {
      const peid = String(t.getAttribute("data-peid") || "").trim();
      const card = t.closest("[data-id]");
      let meta = {};
      if (card) {
        const item = ((state.data && state.data.feed && state.data.feed.items) || []).find(
          (x) => x && String(x.id) === String(card.getAttribute("data-id"))
        );
        const tv = (item && item.trafficV1) || null;
        if (tv) meta = { road: tv.road || null, eventType: tv.eventType || tv.category || null };
      }
      if (peid) toggleTrafficFollow(peid, meta);
      paint();
      wire();
      return;
    }
    if (act === "tf-filter") {
      const kind = String(t.getAttribute("data-tf-kind") || "");
      const value = String(t.getAttribute("data-tf-value") || "");
      const tf = state.trafficFilters || {
        eventTypes: [],
        roadClasses: [],
        roads: [],
        followedOnly: false,
        activeOnly: false,
      };
      if (kind === "event") tf.eventTypes = toggleTrafficFilterValue(tf.eventTypes, value);
      else if (kind === "roadClass") tf.roadClasses = toggleTrafficFilterValue(tf.roadClasses, value);
      else if (kind === "road") tf.roads = toggleTrafficFilterValue(tf.roads, value);
      else if (kind === "followed") tf.followedOnly = !tf.followedOnly;
      else if (kind === "active") tf.activeOnly = !tf.activeOnly;
      state.trafficFilters = tf;
      state.page = 1;
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
      const name = String(t.getAttribute("data-name") || "").trim();
      const id = String(t.getAttribute("data-id") || "").trim();
      const orpCode = String(t.getAttribute("data-orp") || "").trim();
      const cities = asCityEntries(state.draft);
      const exists = cities.some((c) => (id && c.id === id) || (!id && c.name === name));
      if (name && !exists) {
        if (cities.length >= (MAX_CITY_LOCALITIES || 20)) {
          showSaveError(CITY_LIMIT_MSG);
          const scrollEl = document.getElementById("iuPdSettingsScroll");
          const prev = scrollEl ? scrollEl.scrollTop : 0;
          paintSettingsOnly({ resetSettingsScroll: false });
          wire();
          restoreSettingsScroll(prev);
          return;
        }
        const entry = { name, level: "mesto" };
        if (id) entry.id = id;
        if (orpCode) entry.orpCode = orpCode;
        cities.push(entry);
        setCityList(state.draft, cities);
      }
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
      const name = String(t.getAttribute("data-name") || "").trim();
      const id = String(t.getAttribute("data-id") || "").trim();
      setCityList(
        state.draft,
        asCityEntries(state.draft).filter((c) => {
          if (id) return c.id !== id;
          return c.name !== name;
        })
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
        .map((s) => {
          const label = s.label || s.name;
          return (
            `<li><button type="button" data-act="city-add" data-name="${esc(s.name)}" data-id="${esc(s.id || "")}" data-orp="${esc(s.orpCode || "")}">${esc(label)}</button></li>`
          );
        })
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

function infoSystemQueryMode() {
  try {
    return String(new URLSearchParams(location.search || "").get("iuInfoSystem") || "").toLowerCase();
  } catch (_) {
    return "";
  }
}

function isBootNetworkAbort(err) {
  const name = String((err && err.name) || "");
  const msg = String((err && err.message) || err || "");
  if (name === "AbortError") return true;
  // Chromium aborts in-flight same-origin fetch on navigation as TypeError: Failed to fetch
  // before the old document is fully disconnected — stillMounted alone is not enough.
  return err instanceof TypeError && /Failed to fetch|Load failed|NetworkError/i.test(msg);
}

async function boot() {
  // Explicit legacy HomeCards / smoke probes: do not hydrate Prehled or race navigations.
  if (infoSystemQueryMode() === "off") return;
  migrateLocalStateOnce();
  applyCutoverDom();
  void ensureCzMapSprite();
  const root = ensureRoot();
  if (!root) return;
  // Interactive hero/CTA must exist BEFORE feed hydrate (feed.json can be tens of MB).
  // Match final shell ids so the first paint() can updateFeedDom() without replacing hero (CLS=0).
  state.prefs = getPrefs();
  root.innerHTML = homeShellHtml(
    `<li class="iuPdEmpty iuPrehledDne__empty" aria-busy="true">Načítám přehled…</li>`,
    "Načítám…",
    ""
  );
  try {
    wire();
  } catch (_) {}
  const bootAbort = typeof AbortController === "function" ? new AbortController() : null;
  const onPageHide = () => {
    try {
      if (bootAbort) bootAbort.abort();
    } catch (_) {}
  };
  try {
    window.addEventListener("pagehide", onPageHide, { once: true });
  } catch (_) {}
  // 1) Await small shell JSON (taxonomy/registry) so settings rails work immediately.
  // 2) Hydrate multi‑MB feed off-main via Worker without blocking shell interactivity.
  void (async () => {
    try {
      const shell = await loadInfoSystemShellData({
        signal: bootAbort ? bootAbort.signal : undefined,
      });
      if (bootAbort && bootAbort.signal.aborted) return;
      state.data = shell;
      state.prefs = getPrefs();
      state.page = 1;
      state.index = buildFeedIndex([]);
      paint();
      wire();
      bindTimelineLifecycleListeners();
      scheduleTimelineBoundaryRefresh();
      try {
        root.setAttribute("data-iu-pd-shell-ready", "1");
      } catch (_) {}

      const feed = await loadInfoSystemFeedOnly({
        signal: bootAbort ? bootAbort.signal : undefined,
        omitFeedSourceIds: ["ndic"],
        manifest: shell.manifest,
      });
      if (bootAbort && bootAbort.signal.aborted) return;
      state.data = Object.assign({}, shell, {
        feed,
        feedLoad: {
          omittedSourceIds: (feed && feed.omittedSourceIds) || ["ndic"],
          trafficPrimarySource: "traffic_offline_snapshot",
          parsedOffMainThread: !!(feed && feed.parsedOffMainThread),
          shellOnly: false,
        },
        loadedAt: new Date().toISOString(),
      });
      try {
        migrateChmiCapV2UserStates((feed && feed.items) || []);
      } catch (_) {}
      // Optional ops diagnostics (no UI change unless ?iu_chmi_diag=1)
      try {
        if (typeof location !== "undefined" && /(?:^|[?&])iu_chmi_diag=1(?:&|$)/.test(location.search || "")) {
          const mon = await fetch(iuInfoDataUrl("monitoring.json"), { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : null
          );
          const d = mon && mon.chmiCapV2;
          if (d) {
            const bar = document.createElement("pre");
            bar.className = "iuPdDiag";
            bar.setAttribute("data-iu-chmi-diag", "1");
            bar.style.cssText =
              "font:12px/1.4 ui-monospace,monospace;padding:8px 12px;margin:0;background:#0b1220;color:#cde;white-space:pre-wrap";
            bar.textContent = JSON.stringify(
              {
                mode: d.mode,
                status: d.status,
                lastRunAt: d.lastRunAt,
                lastSuccessAt: d.lastSuccessAt,
                lastSnapshotAt: d.lastSnapshotAt,
                lastError: d.lastError,
                active: d.activeCount,
                cancelled: d.cancelledCount,
                expired: d.expiredCount,
                alert: d.alertCount,
                update: d.updateCount,
                cancelMsg: d.cancelMsgCount,
                quarantine: d.quarantineCount,
                discovery: d.discoveryType,
                publish: d.publish,
                runMs: d.runMs,
                registry: d.registryVersion,
                rollbackFn: typeof rollbackChmiCapV2UserStates === "function",
              },
              null,
              2
            );
            const host = root.querySelector(".iuPrehledDne") || root;
            host.insertBefore(bar, host.firstChild);
          }
        }
      } catch (_) {}
      state.index = buildFeedIndex((feed && feed.items) || []);
      const scroll = getScrollState();
      // Avoid remounting an open settings overlay (race with Playwright section clicks).
      if (state.settingsOpen) {
        try {
          updateFeedDom();
        } catch (_) {
          paint();
          wire();
        }
      } else {
        paint();
        wire();
      }
      try {
        root.setAttribute("data-iu-pd-feed-ready", "1");
      } catch (_) {}
      if (!state.settingsOpen && scroll && Number(scroll.y) > 0) {
        try {
          const vp = feedViewport();
          if (vp) vp.scrollTop = Number(scroll.y);
        } catch (_) {}
      }
      if (TRAFFIC_OVERVIEW_FLAGS.TRAFFIC_UI_ENABLED === true) {
        void fetchHostedTrafficOfflineSnapshot({ persist: true })
          .then(() => {
            if (bootAbort && bootAbort.signal.aborted) return;
            if (!root.isConnected) return;
            setTimeout(() => {
              if (bootAbort && bootAbort.signal.aborted) return;
              if (!root.isConnected) return;
              try {
                if (state.settingsOpen) updateFeedDom();
                else paint();
              } catch (_) {}
            }, 0);
          })
          .catch(() => {});
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
      const stillMounted =
        !!(root && root.isConnected && typeof document !== "undefined" && document.documentElement.contains(root));
      if (!stillMounted || (bootAbort && bootAbort.signal.aborted)) return;
      if (isBootNetworkAbort(err)) {
        try {
          updateFeedDom();
        } catch (_) {}
        return;
      }
      try {
        const feed = root.querySelector("#iuPrehledDneTimeline");
        if (feed) {
          feed.innerHTML = `<li class="iuPdEmpty iuPrehledDne__empty">Přehled dne se nepodařilo načíst.</li>`;
        }
      } catch (_) {}
      console.error("[iu-prehled-dne]", err);
    } finally {
      try {
        window.removeEventListener("pagehide", onPageHide);
      } catch (_) {}
    }
  })();
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
