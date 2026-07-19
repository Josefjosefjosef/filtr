/**
 * InfoUzel.cz — Přehled dne UI v5 (štíhlý frontend, bohatý backend)
 * Saved views V4 + migrace, jednotný panel Filtry, pevná chronologie, local-first.
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
  isRead,
  isSaved,
  localitySuggest,
  toggleFavoriteInPrefs,
  listViews,
  saveView,
  updateView,
  deleteView,
  applyView,
  getAlertConfig,
  setAlertConfig,
  getAlertState,
  setAlertState,
  evaluateLocalAlerts,
  dismissAlert,
  dismissAllAlerts,
  getScrollState,
  setScrollState,
  getViewBaseline,
  setViewBaseline,
  countTemporaryFilters,
  migrateLocalStateOnce,
} from "./iu-info-system-core-v1.js?v=info-system-v5-ui-slim-20260719";

const PAGE_SIZE = 50;

const MAIN_TOPICS = [
  { id: "doprava", label: "Doprava" },
  { id: "bezpecnost", label: "Bezpečnost" },
  { id: "pocasi", label: "Počasí" },
  { id: "stat", label: "Stát" },
];

const MORE_TOPICS = [
  { id: "cesko-svet", label: "Česko a svět" },
  { id: "zdravi", label: "Zdraví" },
  { id: "veda", label: "Věda" },
  { id: "kultura", label: "Kultura" },
  { id: "sport", label: "Sport" },
];

const ALL_TOPICS = MAIN_TOPICS.concat(MORE_TOPICS);

const SOURCE_GROUP_OPTIONS = [
  { id: "ministerstva", label: "Ministerstva" },
  { id: "doprava", label: "Doprava" },
  { id: "policie", label: "Bezpečnostní složky" },
  { id: "hzs", label: "HZS" },
  { id: "zdravotnictvi", label: "Zdravotnictví" },
  { id: "verejnopravni-media", label: "Veřejnoprávní média" },
  { id: "samospravy", label: "Kraje a samosprávy" },
  { id: "skoly", label: "Školství a věda" },
  { id: "kultura", label: "Kultura" },
  { id: "veda", label: "Věda a výzkum" },
  { id: "verejna-sprava", label: "Veřejná správa" },
];

const BUILTIN_LOCALITIES = [
  { name: "Česká republika", level: "cr" },
  { name: "Praha", level: "mesto" },
  { name: "Brno", level: "mesto" },
  { name: "Ostrava", level: "mesto" },
  { name: "Pardubický kraj", level: "kraj" },
  { name: "Kunčina", level: "obec" },
  { name: "Moravská Třebová", level: "mesto" },
  { name: "Svitavy", level: "okres" },
  { name: "Jihomoravský kraj", level: "kraj" },
  { name: "Středočeský kraj", level: "kraj" },
  { name: "Královéhradecký kraj", level: "kraj" },
  { name: "Moravskoslezský kraj", level: "kraj" },
  { name: "Ústecký kraj", level: "kraj" },
  { name: "Plzeňský kraj", level: "kraj" },
  { name: "Liberecký kraj", level: "kraj" },
  { name: "Olomoucký kraj", level: "kraj" },
  { name: "Zlínský kraj", level: "kraj" },
  { name: "Jihočeský kraj", level: "kraj" },
  { name: "Karlovarský kraj", level: "kraj" },
  { name: "Vysočina", level: "kraj" },
];

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
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

function fmtRel(iso) {
  const t = Date.parse(iso || "") || 0;
  if (!t) return "";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return "právě teď";
  if (m < 60) return `před ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.round(h / 24);
  return `před ${d} d`;
}

function publishIso(ev) {
  return ev.publishedAtSource || ev.sortAt || ev.firstSeenByInfoUzel || ev.publishedAt || ev.updatedAt || "";
}

function sectionColor(taxonomy, sectionId) {
  const sec = (taxonomy.sections || []).find((s) => s.id === sectionId);
  return (sec && sec.color) || "#5B6CFF";
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

function statusLabelForItem(ev) {
  const st = String(ev.status || "");
  const et = String(ev.eventType || "");
  if (st === "prave-probihajici" || et === "prave-probihajici") return "Právě probíhá";
  if (st === "planovane" || et === "planovane") {
    if (ev.validFrom) {
      try {
        const d = new Date(ev.validFrom);
        if (!Number.isNaN(d.getTime())) {
          return "Plánováno od " + d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
        }
      } catch (_) {}
    }
    return "Plánováno";
  }
  if (st === "ukoncene" || et === "ukoncene") return "Ukončeno";
  if (st === "aktualizovano") {
    const u = ev.lastUpdatedBySource || ev.updatedAt;
    return u ? "Aktualizováno " + fmtRel(u) : "Aktualizováno";
  }
  if (et === "mimoradne" || Number(ev.importance) >= 5) return "Mimořádné";
  if (ev.validTo && (st === "aktivni" || et === "vystraha")) {
    try {
      const d = new Date(ev.validTo);
      if (!Number.isNaN(d.getTime())) {
        return "Platnost do " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
      }
    } catch (_) {}
    return "Aktivní výstraha";
  }
  // Běžná tisková zpráva: žádný štítek Aktivní / Publikováno
  return "";
}

function formatSourcesLine(ev) {
  const pubs = Array.isArray(ev.sourcePublications) ? ev.sourcePublications : [];
  const labels = [];
  const seen = new Set();
  const push = (lab) => {
    const t = String(lab || "").trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    labels.push(t);
  };
  push(ev.sourceLabel || ev.sourceId);
  for (const p of pubs) push(p.sourceLabel || p.sourceId);
  if (Array.isArray(ev._clusterLinks)) {
    for (const l of ev._clusterLinks) push(l.label);
  }
  if (labels.length <= 1) return labels[0] || "Zdroj";
  if (labels.length === 2) return labels[0] + " + " + labels[1];
  return labels[0] + " • další " + (labels.length - 1) + " zdroje";
}

function localitySummary(prefs) {
  const locs = prefs.localities || [];
  const fav = prefs.favoriteRegions || [];
  if (prefs.myRegionOnly && prefs.homeKraj) {
    const parts = [prefs.homeKraj, prefs.homeOkres, prefs.homeObec].filter(Boolean);
    return parts.join(", ") || prefs.homeKraj;
  }
  if (locs.length === 1) return locs[0].name || String(locs[0]);
  if (locs.length > 1) return locs.length + " sledované regiony";
  if (prefs.localityQuery) return prefs.localityQuery;
  if (fav.length === 1) return fav[0];
  if (fav.length > 1) return fav.length + " sledované regiony";
  if (prefs.homeKraj) return prefs.homeKraj;
  return "Celá ČR";
}

function renderItem(ev, taxonomy, prefs) {
  const color = sectionColor(taxonomy, ev.sectionId);
  const alert = String(ev.eventType) === "mimoradne" || Number(ev.importance) >= 5;
  const read = isRead(ev.id);
  const saved = isSaved(ev.id);
  const statusLabel = statusLabelForItem(ev);
  const pubs = Array.isArray(ev.sourcePublications) ? ev.sourcePublications : [];
  const clusterLinks =
    Array.isArray(ev._clusterLinks) && ev._clusterLinks.length > 1
      ? ev._clusterLinks
      : pubs.length > 1
        ? pubs.map((p) => ({ label: p.sourceLabel || p.sourceId, url: p.url }))
        : [];
  const region = (ev.region && ev.region.name) || "";
  const sourcesLine = formatSourcesLine(ev);
  return `
  <li class="iuPrehledDne__item${read ? " is-read" : ""}" data-id="${esc(ev.id)}" style="--iu-pd-dot:${esc(color)}">
    <div class="iuPrehledDne__timeCol">
      <div class="iuPrehledDne__time">${esc(fmtTime(publishIso(ev)))}</div>
      <div class="iuPrehledDne__rel">${esc(fmtRel(publishIso(ev)))}</div>
      <div class="iuPrehledDne__readMark" aria-label="Přečteno">✓</div>
    </div>
    <div class="iuPrehledDne__axis"><span class="iuPrehledDne__dot${alert ? " iuPrehledDne__dot--alert" : ""}"></span></div>
    <article class="iuPrehledDne__card">
      <a class="iuPrehledDne__cardTitle" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">${esc(ev.title)}</a>
      <div class="iuPrehledDne__meta">
        <span class="iuPrehledDne__pill">${esc(sourcesLine)}</span>
        ${region ? `<span class="iuPrehledDne__pill">${esc(region)}</span>` : ""}
        ${statusLabel ? `<span class="iuPrehledDne__pill">${esc(statusLabel)}</span>` : ""}
      </div>
      ${
        clusterLinks.length > 1
          ? `<div class="iuPrehledDne__origins" hidden data-origins>
              ${clusterLinks
                .map(
                  (l) =>
                    `<a class="iuPrehledDne__origin" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(
                      l.label || "Zdroj"
                    )} — otevřít originál</a>`
                )
                .join("")}
            </div>
            <button type="button" class="iuPrehledDne__linkish" data-act="toggle-origins">Zobrazit všechny zdroje</button>`
          : ""
      }
      <div class="iuPrehledDne__actions">
        <button type="button" data-act="save">${saved ? "Uloženo" : "Uložit"}</button>
        <button type="button" data-act="hide">Skrýt</button>
      </div>
    </article>
  </li>`;
}

function chip(active, attrs, label) {
  return `<button type="button" class="iuPrehledDne__chip${active ? " is-active" : ""}" ${attrs}>${esc(label)}</button>`;
}

async function mountPrehledDne(rootEl) {
  const root = rootEl || ensureRoot();
  if (!root) return null;
  applyCutoverDom();
  migrateLocalStateOnce();

  let data;
  try {
    data = await loadInfoSystemData();
  } catch (err) {
    root.innerHTML = `<div class="iuPrehledDne"><p class="iuPrehledDne__empty">Přehled dne se nepodařilo načíst.</p></div>`;
    console.warn("[iu-prehled-dne]", err);
    return null;
  }

  const taxonomy = data.taxonomy || { sections: [], eventTypes: [], sourceGroups: [], sortModes: [] };
  const registry = data.registry || { entries: [] };
  const items = (data.feed && data.feed.items) || [];
  let prefs = getPrefs();
  if (!prefs.activeViewId) {
    prefs = applyView("muj-prehled", prefs);
    setPrefs(prefs);
  } else if (!localStorage.getItem("iu.infoEvents.viewBaseline.v1")) {
    setViewBaseline(prefs);
  }

  let alertCfg = getAlertConfig();
  let pendingNew = [];
  let renderedSnapshot = items.slice();
  let visibleCount = PAGE_SIZE;
  let feedIndex = buildFeedIndex(renderedSnapshot);
  let alertPending = (getAlertState().pending || []).slice();
  let sheetOpen = false;
  let sheetFocus = ""; // "temata" | "lokalita" | ""
  let draft = null;
  let preserveScroll = false;
  let lastScrollY = 0;

  const byId = new Map((registry.entries || []).map((e) => [e.id, e]));
  for (const it of items) {
    const src = byId.get(it.sourceId);
    if (src) {
      it.sourceGroup = src.group;
      if (!it.sourceName) it.sourceName = src.institution || src.label;
    }
  }

  const activeSources = (registry.entries || [])
    .filter((e) => e.productionActive)
    .map((e) => ({ id: e.id, label: e.label || e.id, institution: e.institution || e.label || e.id }));

  function captureScroll() {
    const vp = document.getElementById("iuSilverTallScrollViewport");
    lastScrollY = vp ? Number(vp.scrollTop) || 0 : 0;
  }

  function restoreScroll() {
    const vp = document.getElementById("iuSilverTallScrollViewport");
    if (vp && preserveScroll) vp.scrollTop = lastScrollY;
    preserveScroll = false;
  }

  function runAlerts() {
    const evaled = evaluateLocalAlerts(renderedSnapshot, prefs, alertCfg, getAlertState());
    setAlertState(evaled.state);
    alertPending = evaled.pending || [];
  }

  function tempFilterCount() {
    return countTemporaryFilters(prefs, getViewBaseline());
  }

  function topicActive(id) {
    return (prefs.sections || []).includes(id);
  }

  function allTopicsActive() {
    return !(prefs.sections || []).length;
  }

  function renderSheet(p) {
    const groups = SOURCE_GROUP_OPTIONS.map((g) =>
      chip((p.sourceGroups || []).includes(g.id), `data-draft-group="${esc(g.id)}"`, g.label)
    ).join("");
    const topics = ALL_TOPICS.map((t) => chip((p.sections || []).includes(t.id), `data-draft-sec="${esc(t.id)}"`, t.label)).join(
      ""
    );
    const srcOpts = activeSources
      .map(
        (s) =>
          `<option value="${esc(s.id)}"${(p.sourceIds || []).includes(s.id) ? " selected" : ""}>${esc(s.label)}</option>`
      )
      .join("");
    const favRegs = (p.favoriteRegions || []).map((r) => chip(true, `data-draft-favreg="${esc(r)}"`, r)).join("");
    return `
    <div class="iuPrehledDne__sheet" id="iuPrehledDneSheet" role="dialog" aria-modal="true" aria-label="Filtry">
      <div class="iuPrehledDne__sheetBackdrop" data-act="sheet-dismiss"></div>
      <div class="iuPrehledDne__sheetPanel">
        <div class="iuPrehledDne__sheetHead">
          <strong>Filtry</strong>
          <button type="button" class="iuPrehledDne__chip" data-act="sheet-dismiss" aria-label="Zavřít">Zavřít</button>
        </div>
        <div class="iuPrehledDne__sheetBody">
          <section class="iuPrehledDne__sheetSec" id="iuPrehledDneSheetTemata" data-sheet-sec="temata">
            <h3>Témata</h3>
            <div class="iuPrehledDne__row">
              ${chip(!(p.sections || []).length, 'data-draft-sec=""', "Vše")}
              ${topics}
            </div>
          </section>
          <section class="iuPrehledDne__sheetSec" data-sheet-sec="zdroje">
            <h3>Zdroje a instituce</h3>
            <div class="iuPrehledDne__row">${groups}</div>
            <label class="iuPrehledDne__fieldLabel" for="iuPrehledDneDraftSource">Konkrétní instituce</label>
            <input class="iuPrehledDne__input" id="iuPrehledDneDraftSourceQ" type="search" placeholder="Hledat instituci…" autocomplete="off" />
            <select class="iuPrehledDne__select" id="iuPrehledDneDraftSource" multiple size="6">${srcOpts}</select>
            <button type="button" class="iuPrehledDne__chip${p.favoritesOnly ? " is-active" : ""}" data-draft-toggle="favorites">Jen oblíbené zdroje</button>
          </section>
          <section class="iuPrehledDne__sheetSec" id="iuPrehledDneSheetLokalita" data-sheet-sec="lokalita">
            <h3>Lokalita</h3>
            <div class="iuPrehledDne__row">
              <button type="button" class="iuPrehledDne__chip${!p.localityQuery && !(p.localities || []).length && !p.myRegionOnly ? " is-active" : ""}" data-act="draft-cr">Celá ČR</button>
              <button type="button" class="iuPrehledDne__chip${p.myRegionOnly ? " is-active" : ""}" data-draft-toggle="myRegion">Moje uložené regiony</button>
            </div>
            <input class="iuPrehledDne__input" id="iuPrehledDneDraftLoc" type="search" placeholder="kraj, okres, město, obec" value="${esc(
              p.localityQuery || ""
            )}" autocomplete="off" />
            <ul class="iuPrehledDne__suggest" id="iuPrehledDneDraftSuggest" hidden></ul>
            <div class="iuPrehledDne__row">
              <input class="iuPrehledDne__input" id="iuPrehledDneDraftKraj" type="text" placeholder="Kraj" value="${esc(p.homeKraj || "")}" />
              <input class="iuPrehledDne__input" id="iuPrehledDneDraftOkres" type="text" placeholder="Okres" value="${esc(p.homeOkres || "")}" />
              <input class="iuPrehledDne__input" id="iuPrehledDneDraftObec" type="text" placeholder="Obec" value="${esc(p.homeObec || "")}" />
            </div>
            ${favRegs ? `<div class="iuPrehledDne__row"><span class="iuPrehledDne__muted">Oblíbené:</span>${favRegs}</div>` : ""}
          </section>
          <section class="iuPrehledDne__sheetSec" data-sheet-sec="zobrazit">
            <h3>Zobrazit pouze</h3>
            <div class="iuPrehledDne__row">
              ${chip(!!p.unreadOnly, 'data-draft-toggle="unread"', "Nepřečtené")}
              ${chip(!!p.savedOnly, 'data-draft-toggle="saved"', "Uložené")}
              ${chip(!!p.favoritesOnly, 'data-draft-toggle="favorites"', "Jen oblíbené")}
            </div>
          </section>
        </div>
        <div class="iuPrehledDne__sheetFoot">
          <button type="button" class="iuPrehledDne__chip" data-act="sheet-reset">Resetovat změny</button>
          <button type="button" class="iuPrehledDne__chip is-active" data-act="sheet-apply">Použít filtry</button>
        </div>
      </div>
    </div>`;
  }

  function paint() {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const filtered = filterEvents(renderedSnapshot, prefs, {
      index: feedIndex,
      generationId: (data.manifest && data.manifest.generationId) || "",
    });
    const shown = filtered.slice(0, visibleCount);
    const more = filtered.length - shown.length;
    const totalActive = renderedSnapshot.length;
    const nTemp = tempFilterCount();
    const views = listViews();
    const primaryViews = views.filter((v) =>
      ["muj-prehled", "doprava", "muj-kraj", "ministerstva"].includes(v.id) || !v.builtin
    );
    const viewChips = primaryViews
      .map((v) => {
        const on = String(prefs.activeViewId || "") === String(v.id);
        return chip(on, `data-view="${esc(v.id)}"`, v.label);
      })
      .join("");

    const topicChips =
      chip(allTopicsActive(), 'data-topic=""', "Vše") +
      MAIN_TOPICS.map((t) => chip(topicActive(t.id), `data-topic="${esc(t.id)}"`, t.label)).join("") +
      chip(false, 'data-act="open-more-topics"', "Více");

    const filtersLabel = nTemp > 0 ? `Filtry (${nTemp})` : "Filtry";
    const countText =
      nTemp > 0 || (prefs.sections || []).length || prefs.unreadOnly || prefs.savedOnly || prefs.favoritesOnly || prefs.myRegionOnly
        ? `Zobrazeno ${filtered.length} z ${totalActive} informací za posledních 96 hodin`
        : `${totalActive} informací za posledních 96 hodin`;

    const dirty = nTemp > 0 && String(prefs.activeViewId || "").indexOf("custom-") === 0;
    const alertList =
      alertCfg.enabled && alertPending.length
        ? `<div class="iuPrehledDne__alerts" id="iuPrehledDneAlerts">
            <div class="iuPrehledDne__alertsHead">
              <strong>Lokální upozornění (${esc(alertPending.length)})</strong>
              <button type="button" data-act="dismiss-all-alerts">Označit vše</button>
            </div>
            <ul>${alertPending
              .slice(0, 6)
              .map(
                (a) =>
                  `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
                  <button type="button" data-act="dismiss-alert" data-id="${esc(a.itemId)}">×</button></li>`
              )
              .join("")}</ul>
          </div>`
        : "";

    root.innerHTML = `
    <section class="iuPrehledDne iuPrehledDne--slim" aria-label="Přehled dne" data-iu-ui="v5-slim">
      <header class="iuPrehledDne__head">
        <h2 class="iuPrehledDne__title">Přehled dne</h2>
        <p class="iuPrehledDne__lead">Ověřené informace z veřejných a veřejnoprávních zdrojů.</p>
      </header>
      <div class="iuPrehledDne__newBanner" id="iuPrehledDneNewBanner" role="status">
        <span>Přibyly nové informace.</span>
        <button type="button" data-act="accept-new">Zobrazit</button>
      </div>
      ${alertList}
      <div class="iuPrehledDne__scrollRow" role="toolbar" aria-label="Uložené pohledy">
        ${viewChips}
        <button type="button" class="iuPrehledDne__chip iuPrehledDne__chip--plus" data-act="save-view" aria-label="Vytvořit nový pohled">+</button>
        ${
          dirty
            ? `<button type="button" class="iuPrehledDne__chip" data-act="update-view">Uložit změny pohledu</button>`
            : ""
        }
        ${
          String(prefs.activeViewId || "").indexOf("custom-") === 0
            ? `<button type="button" class="iuPrehledDne__chip" data-act="delete-view">Smazat</button>`
            : ""
        }
      </div>
      <div class="iuPrehledDne__scrollRow" role="toolbar" aria-label="Hlavní témata">
        ${topicChips}
      </div>
      <button type="button" class="iuPrehledDne__locality" data-act="open-locality" aria-label="Nastavení lokality">
        <span aria-hidden="true">📍</span> ${esc(localitySummary(prefs))}
      </button>
      <div class="iuPrehledDne__quick" role="toolbar" aria-label="Rychlé ovládání">
        ${chip(nTemp > 0, 'data-act="open-filters"', filtersLabel)}
        ${chip(!!prefs.unreadOnly, 'data-toggle="unread"', "Nepřečtené")}
        ${chip(!!prefs.savedOnly, 'data-toggle="saved"', "Uložené")}
      </div>
      <div class="iuPrehledDne__count" aria-live="polite">${esc(countText)}</div>
      <ul class="iuPrehledDne__timeline" id="iuPrehledDneTimeline">
        ${shown.length ? shown.map((ev) => renderItem(ev, taxonomy, prefs)).join("") : `<li class="iuPrehledDne__empty">Žádné položky pro zvolené filtry.</li>`}
      </ul>
      ${
        more > 0
          ? `<div class="iuPrehledDne__more"><button type="button" data-act="more">Načíst dalších ${esc(
              Math.min(PAGE_SIZE, more)
            )} (${esc(more)} zbývá)</button></div>`
          : ""
      }
      ${sheetOpen && draft ? renderSheet(draft) : ""}
    </section>`;

    wire();
    if (preserveScroll) restoreScroll();
    else {
      try {
        const sc = getScrollState();
        if (sc && sc.viewId === String(prefs.activeViewId || "") && Number(sc.y) > 0) {
          const vp = document.getElementById("iuSilverTallScrollViewport");
          if (vp) vp.scrollTop = Number(sc.y) || 0;
        }
      } catch (_) {}
    }
    if (sheetOpen && sheetFocus) {
      const el = root.querySelector(
        sheetFocus === "lokalita" ? "#iuPrehledDneSheetLokalita" : "#iuPrehledDneSheetTemata"
      );
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
    }
    void t0;
  }

  function persist(opts) {
    const o = opts || {};
    setPrefs(prefs);
    if (!o.keepPage) visibleCount = PAGE_SIZE;
    if (!o.keepScroll) {
      preserveScroll = false;
      try {
        const vp = document.getElementById("iuSilverTallScrollViewport");
        if (vp) vp.scrollTop = 0;
      } catch (_) {}
    } else {
      captureScroll();
      preserveScroll = true;
    }
    paint();
  }

  function openSheet(focus) {
    captureScroll();
    preserveScroll = true;
    sheetOpen = true;
    sheetFocus = focus || "";
    draft = Object.assign({}, prefs, {
      sections: (prefs.sections || []).slice(),
      lanes: (prefs.lanes || []).slice(),
      sourceGroups: (prefs.sourceGroups || []).slice(),
      sourceIds: (prefs.sourceIds || []).slice(),
      localities: (prefs.localities || []).slice(),
      favoriteRegions: (prefs.favoriteRegions || []).slice(),
    });
    paint();
  }

  function closeSheet(apply) {
    if (apply && draft) {
      prefs = Object.assign({}, prefs, draft);
      // temporary change — do not rewrite baseline / saved view
      sheetOpen = false;
      draft = null;
      sheetFocus = "";
      persist({ keepScroll: false });
      return;
    }
    sheetOpen = false;
    draft = null;
    sheetFocus = "";
    preserveScroll = true;
    paint();
  }

  function resetDraftOrPrefs() {
    const baseline = getViewBaseline();
    if (sheetOpen && draft) {
      draft = Object.assign({}, baseline, {
        sections: (baseline.sections || []).slice(),
        lanes: (baseline.lanes || []).slice(),
        sourceGroups: (baseline.sourceGroups || []).slice(),
        sourceIds: (baseline.sourceIds || []).slice(),
        localities: (baseline.localities || []).slice(),
        favoriteRegions: (baseline.favoriteRegions || []).slice(),
        unreadOnly: !!baseline.unreadOnly,
        savedOnly: !!baseline.savedOnly,
        favoritesOnly: !!baseline.favoritesOnly,
        myRegionOnly: !!baseline.myRegionOnly,
        localityQuery: baseline.localityQuery || "",
        homeKraj: baseline.homeKraj || "",
        homeOkres: baseline.homeOkres || "",
        homeObec: baseline.homeObec || "",
        activeViewId: prefs.activeViewId,
      });
      paint();
      return;
    }
    prefs = Object.assign({}, baseline, { activeViewId: prefs.activeViewId });
    persist();
  }

  function wire() {
    root.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        prefs = applyView(btn.getAttribute("data-view"), prefs);
        persist();
      });
    });
    root.querySelectorAll("[data-topic]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-topic") || "";
        if (!id) prefs.sections = [];
        else {
          // exclusive quick topic (temporary deviation from view)
          prefs.sections = [id];
        }
        persist();
      });
    });
    root.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-toggle");
        if (t === "unread") prefs.unreadOnly = !prefs.unreadOnly;
        if (t === "saved") prefs.savedOnly = !prefs.savedOnly;
        persist({ keepScroll: false });
      });
    });
    const openFilters = root.querySelector('[data-act="open-filters"]');
    if (openFilters) openFilters.addEventListener("click", () => openSheet(""));
    const openMore = root.querySelector('[data-act="open-more-topics"]');
    if (openMore) openMore.addEventListener("click", () => openSheet("temata"));
    const openLoc = root.querySelector('[data-act="open-locality"]');
    if (openLoc) openLoc.addEventListener("click", () => openSheet("lokalita"));

    const saveViewBtn = root.querySelector('[data-act="save-view"]');
    if (saveViewBtn) {
      saveViewBtn.addEventListener("click", () => {
        const name = window.prompt("Název nového pohledu", "Můj pohled");
        if (!name) return;
        const entry = saveView(name, prefs);
        if (entry) {
          prefs.activeViewId = entry.id;
          setViewBaseline(prefs);
          persist();
        }
      });
    }
    const updViewBtn = root.querySelector('[data-act="update-view"]');
    if (updViewBtn) {
      updViewBtn.addEventListener("click", () => {
        if (updateView(prefs.activeViewId, prefs)) {
          setViewBaseline(prefs);
          persist({ keepScroll: true });
        }
      });
    }
    const delViewBtn = root.querySelector('[data-act="delete-view"]');
    if (delViewBtn) {
      delViewBtn.addEventListener("click", () => {
        if (deleteView(prefs.activeViewId)) {
          prefs = applyView("muj-prehled", prefs);
          persist();
        }
      });
    }

    root.querySelectorAll('[data-act="sheet-dismiss"]').forEach((b) =>
      b.addEventListener("click", () => closeSheet(false))
    );
    const applyBtn = root.querySelector('[data-act="sheet-apply"]');
    if (applyBtn) applyBtn.addEventListener("click", () => closeSheet(true));
    const resetBtn = root.querySelector('[data-act="sheet-reset"]');
    if (resetBtn) resetBtn.addEventListener("click", () => resetDraftOrPrefs());
    const draftCr = root.querySelector('[data-act="draft-cr"]');
    if (draftCr && draft) {
      draftCr.addEventListener("click", () => {
        draft.localities = [];
        draft.localityQuery = "";
        draft.myRegionOnly = false;
        paint();
      });
    }
    root.querySelectorAll("[data-draft-sec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!draft) return;
        const id = btn.getAttribute("data-draft-sec") || "";
        draft.sections = id ? toggleInArray(draft.sections, id) : [];
        paint();
      });
    });
    root.querySelectorAll("[data-draft-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!draft) return;
        draft.sourceGroups = toggleInArray(draft.sourceGroups, btn.getAttribute("data-draft-group"));
        paint();
      });
    });
    root.querySelectorAll("[data-draft-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!draft) return;
        const t = btn.getAttribute("data-draft-toggle");
        if (t === "unread") draft.unreadOnly = !draft.unreadOnly;
        if (t === "saved") draft.savedOnly = !draft.savedOnly;
        if (t === "favorites") draft.favoritesOnly = !draft.favoritesOnly;
        if (t === "myRegion") draft.myRegionOnly = !draft.myRegionOnly;
        paint();
      });
    });
    const draftSource = root.querySelector("#iuPrehledDneDraftSource");
    if (draftSource && draft) {
      draftSource.addEventListener("change", () => {
        draft.sourceIds = Array.from(draftSource.selectedOptions).map((o) => o.value);
      });
    }
    const draftSourceQ = root.querySelector("#iuPrehledDneDraftSourceQ");
    if (draftSourceQ && draftSource) {
      draftSourceQ.addEventListener("input", () => {
        const q = String(draftSourceQ.value || "")
          .trim()
          .toLowerCase();
        Array.from(draftSource.options).forEach((opt) => {
          opt.hidden = q ? !String(opt.textContent || "").toLowerCase().includes(q) : false;
        });
      });
    }
    ["iuPrehledDneDraftKraj", "iuPrehledDneDraftOkres", "iuPrehledDneDraftObec"].forEach((id) => {
      const el = root.querySelector("#" + id);
      if (!el || !draft) return;
      el.addEventListener("change", () => {
        if (id.endsWith("Kraj")) draft.homeKraj = el.value.trim();
        if (id.endsWith("Okres")) draft.homeOkres = el.value.trim();
        if (id.endsWith("Obec")) draft.homeObec = el.value.trim();
      });
    });
    const dloc = root.querySelector("#iuPrehledDneDraftLoc");
    const dsug = root.querySelector("#iuPrehledDneDraftSuggest");
    if (dloc && dsug && draft) {
      dloc.addEventListener("input", () => {
        draft.localityQuery = dloc.value;
        const hits = localitySuggest(dloc.value, BUILTIN_LOCALITIES);
        if (!hits.length) {
          dsug.hidden = true;
          dsug.innerHTML = "";
          return;
        }
        dsug.hidden = false;
        dsug.innerHTML = hits
          .map((h) => `<li><button type="button" data-dloc="${esc(h.name)}">${esc(h.name)}</button></li>`)
          .join("");
        dsug.querySelectorAll("[data-dloc]").forEach((b) => {
          b.addEventListener("click", () => {
            const name = b.getAttribute("data-dloc");
            const cur = Array.isArray(draft.localities) ? draft.localities.slice() : [];
            if (!cur.some((x) => String(x.name || x) === name)) cur.push({ name });
            draft.localities = cur;
            draft.localityQuery = name;
            dloc.value = name;
            dsug.hidden = true;
            paint();
          });
        });
      });
    }

    root.querySelectorAll(".iuPrehledDne__item").forEach((li) => {
      const id = li.getAttribute("data-id");
      const title = li.querySelector(".iuPrehledDne__cardTitle");
      if (title) {
        title.addEventListener("click", () => {
          markRead(id);
          li.classList.add("is-read");
        });
      }
      li.querySelectorAll("[data-act]").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.preventDefault();
          const act = b.getAttribute("data-act");
          if (act === "save") {
            const on = toggleSaved(id);
            b.textContent = on ? "Uloženo" : "Uložit";
          }
          if (act === "hide") {
            hideItem(id);
            persist({ keepScroll: true, keepPage: true });
          }
          if (act === "toggle-origins") {
            const box = li.querySelector("[data-origins]");
            if (box) {
              box.hidden = !box.hidden;
              b.textContent = box.hidden ? "Zobrazit všechny zdroje" : "Skrýt zdroje";
            }
          }
        });
      });
    });

    const moreBtn = root.querySelector('[data-act="more"]');
    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        visibleCount += PAGE_SIZE;
        preserveScroll = true;
        captureScroll();
        paint();
      });
    }
    const acceptNew = root.querySelector('[data-act="accept-new"]');
    if (acceptNew) {
      acceptNew.addEventListener("click", () => {
        if (!pendingNew.length) return;
        renderedSnapshot = pendingNew.concat(renderedSnapshot);
        feedIndex = buildFeedIndex(renderedSnapshot);
        pendingNew = [];
        const ban = root.querySelector("#iuPrehledDneNewBanner");
        if (ban) ban.classList.remove("is-visible");
        persist();
      });
    }
    root.querySelectorAll('[data-act="dismiss-alert"]').forEach((b) => {
      b.addEventListener("click", () => {
        dismissAlert(b.getAttribute("data-id"));
        alertPending = (getAlertState().pending || []).slice();
        preserveScroll = true;
        captureScroll();
        paint();
      });
    });
    const dismissAll = root.querySelector('[data-act="dismiss-all-alerts"]');
    if (dismissAll) {
      dismissAll.addEventListener("click", () => {
        dismissAllAlerts();
        alertPending = [];
        preserveScroll = true;
        captureScroll();
        paint();
      });
    }

    // Escape closes sheet without apply
    if (sheetOpen) {
      const onKey = (ev) => {
        if (ev.key === "Escape") {
          document.removeEventListener("keydown", onKey);
          closeSheet(false);
        }
      };
      document.addEventListener("keydown", onKey);
    }
  }

  function onScroll() {
    try {
      const vp = document.getElementById("iuSilverTallScrollViewport");
      if (!vp) return;
      setScrollState({ viewId: String(prefs.activeViewId || ""), y: vp.scrollTop || 0 });
    } catch (_) {}
  }

  const vp = document.getElementById("iuSilverTallScrollViewport");
  if (vp) {
    vp.removeEventListener("scroll", onScroll);
    vp.addEventListener("scroll", onScroll, { passive: true });
  }

  runAlerts();
  paint();

  // Soft poll for new items without resetting prefs
  try {
    setInterval(async () => {
      try {
        const next = await loadInfoSystemData();
        const nextItems = (next.feed && next.feed.items) || [];
        const known = new Set(renderedSnapshot.map((x) => x.id).concat(pendingNew.map((x) => x.id)));
        const fresh = nextItems.filter((x) => x && x.id && !known.has(x.id));
        if (!fresh.length) return;
        pendingNew = fresh.concat(pendingNew).slice(0, 80);
        const ban = root.querySelector("#iuPrehledDneNewBanner");
        if (ban) ban.classList.add("is-visible");
      } catch (_) {}
    }, 120000);
  } catch (_) {}

  return root;
}

function boot() {
  const bootNow = () => {
    const root = document.getElementById("iuPrehledDneRoot") || ensureRoot();
    if (!root) return;
    if (root.getAttribute("data-iu-mounted") === "1") return;
    root.setAttribute("data-iu-mounted", "1");
    mountPrehledDne(root);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootNow);
  else bootNow();
}

boot();

export { mountPrehledDne, boot };
