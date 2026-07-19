/**
 * InfoUzel.cz — Přehled dne UI v3 (personalizace + inteligentní filtry)
 * Control panel + timeline. No internal pages. No images/perex. Local-first prefs.
 */
import {
  IUInfoSystem,
  applyCutoverDom,
  loadInfoSystemData,
  filterEvents,
  getPrefs,
  setPrefs,
  markRead,
  toggleSaved,
  hideItem,
  isRead,
  isSaved,
  localitySuggest,
  toggleFavoriteInPrefs,
} from "./iu-info-system-core-v1.js";

const PAGE_SIZE = 60;

const LANE_OPTIONS = [
  { id: "doprava", label: "Doprava" },
  { id: "pocasi", label: "Počasí" },
  { id: "bezpecnost", label: "Bezpečnost" },
  { id: "ministerstva", label: "Ministerstva" },
  { id: "ekonomika", label: "Ekonomika" },
  { id: "zdravotnictvi", label: "Zdravotnictví" },
  { id: "skoly-kultura", label: "Školství a kultura" },
  { id: "regionalni", label: "Regiony" },
  { id: "verejnopravni-media", label: "Veřejnoprávní média" },
  { id: "ostatni", label: "Ostatní" },
];

const ORG_OPTIONS = [
  { id: "government", label: "Stát / ministerstva" },
  { id: "security", label: "Bezpečnost" },
  { id: "meteo", label: "Počasí" },
  { id: "transport", label: "Doprava" },
  { id: "health", label: "Zdravotnictví" },
  { id: "public-media", label: "Veřejnoprávní média" },
  { id: "education-science", label: "Školství a věda" },
  { id: "culture", label: "Kultura" },
  { id: "agency", label: "Agentury" },
  { id: "cyber", label: "Kyber" },
  { id: "public", label: "Veřejné" },
];

const REGION_LEVEL_OPTIONS = [
  { id: "cr", label: "ČR" },
  { id: "kraj", label: "Kraje" },
  { id: "okres", label: "Okresy" },
  { id: "mesto", label: "Města" },
  { id: "obec", label: "Obce" },
];

const TIME_RANGE_OPTIONS = [
  { id: 0, label: "Celé období" },
  { id: 6, label: "6 h" },
  { id: 24, label: "24 h" },
  { id: 72, label: "3 dny" },
  { id: 168, label: "7 dní" },
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
  { name: "Jihomoravský kraj", level: "kraj" },
  { name: "Moravskoslezský kraj", level: "kraj" },
  { name: "Ústecký kraj", level: "kraj" },
  { name: "Plzeňský kraj", level: "kraj" },
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

function chipRow(items, attr, activeIds) {
  const active = new Set((activeIds || []).map(String));
  return (items || [])
    .map((it) => {
      const on = active.has(String(it.id));
      return `<button type="button" class="iuPrehledDne__chip${on ? " is-active" : ""}" ${attr}="${esc(it.id)}">${esc(
        it.label
      )}</button>`;
    })
    .join("");
}

function renderActiveTags(prefs) {
  const tags = [];
  (prefs.localities || []).forEach((l) => tags.push({ kind: "loc", id: l.name || l, label: `Lokalita: ${l.name || l}` }));
  if (prefs.localityQuery) tags.push({ kind: "q", id: "q", label: `Lokalita: ${prefs.localityQuery}` });
  (prefs.sections || []).forEach((id) => tags.push({ kind: "sec", id, label: id }));
  (prefs.eventTypes || []).forEach((id) => tags.push({ kind: "type", id, label: `Typ: ${id}` }));
  (prefs.sourceGroups || []).forEach((id) => tags.push({ kind: "src", id, label: id }));
  (prefs.lanes || []).forEach((id) => {
    const lab = (LANE_OPTIONS.find((x) => x.id === id) || {}).label || id;
    tags.push({ kind: "lane", id, label: lab });
  });
  (prefs.orgTypes || []).forEach((id) => {
    const lab = (ORG_OPTIONS.find((x) => x.id === id) || {}).label || id;
    tags.push({ kind: "org", id, label: lab });
  });
  (prefs.regionLevels || []).forEach((id) => {
    const lab = (REGION_LEVEL_OPTIONS.find((x) => x.id === id) || {}).label || id;
    tags.push({ kind: "level", id, label: lab });
  });
  (prefs.sourceIds || []).forEach((id) => tags.push({ kind: "sid", id, label: `Zdroj: ${id}` }));
  (prefs.favoriteSourceIds || []).forEach((id) => tags.push({ kind: "favsrc", id, label: `★ ${id}` }));
  (prefs.favoriteLanes || []).forEach((id) => tags.push({ kind: "favlane", id, label: `★ ${id}` }));
  (prefs.favoriteRegions || []).forEach((id) => tags.push({ kind: "favreg", id, label: `★ ${id}` }));
  if (prefs.timeRangeHours) tags.push({ kind: "time", id: String(prefs.timeRangeHours), label: `${prefs.timeRangeHours} h` });
  if (prefs.activeOnly) tags.push({ kind: "flag", id: "activeOnly", label: "Aktivní" });
  if (prefs.newOnly) tags.push({ kind: "flag", id: "newOnly", label: "Nové" });
  if (prefs.unreadOnly) tags.push({ kind: "flag", id: "unreadOnly", label: "Nepřečtené" });
  if (prefs.savedOnly) tags.push({ kind: "flag", id: "savedOnly", label: "Uložené" });
  if (prefs.favoritesOnly) tags.push({ kind: "flag", id: "favoritesOnly", label: "Jen oblíbené" });
  if (!tags.length) return "";
  return `<div class="iuPrehledDne__activeTags">${tags
    .map(
      (t) =>
        `<span class="iuPrehledDne__tag" data-kind="${esc(t.kind)}" data-id="${esc(t.id)}">${esc(t.label)}<button type="button" aria-label="Odstranit">×</button></span>`
    )
    .join("")}</div>`;
}

function renderItem(ev, taxonomy, prefs) {
  const color = sectionColor(taxonomy, ev.sectionId);
  const alert = String(ev.eventType) === "mimoradne" || Number(ev.importance) >= 5;
  const read = isRead(ev.id);
  const saved = isSaved(ev.id);
  const favSrc = (prefs.favoriteSourceIds || []).includes(String(ev.sourceId));
  return `
  <li class="iuPrehledDne__item${read ? " is-read" : ""}${favSrc ? " is-fav" : ""}" data-id="${esc(ev.id)}" style="--iu-pd-dot:${esc(color)}">
    <div class="iuPrehledDne__timeCol">
      <div class="iuPrehledDne__time">${esc(fmtTime(ev.sortAt || ev.publishedAtSource || ev.firstSeenByInfoUzel || ev.publishedAt || ev.updatedAt))}</div>
      <div class="iuPrehledDne__rel">${esc(fmtRel(ev.sortAt || ev.publishedAtSource || ev.firstSeenByInfoUzel || ev.publishedAt || ev.updatedAt))}</div>
      <div class="iuPrehledDne__readMark" aria-label="Přečteno">✓</div>
    </div>
    <div class="iuPrehledDne__axis"><span class="iuPrehledDne__dot${alert ? " iuPrehledDne__dot--alert" : ""}"></span></div>
    <article class="iuPrehledDne__card">
      <a class="iuPrehledDne__cardTitle" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">${esc(ev.title)}</a>
      <div class="iuPrehledDne__meta">
        <span class="iuPrehledDne__pill">${esc(ev.sourceLabel || ev.sourceId)}</span>
        <span class="iuPrehledDne__pill">${esc((ev.region && ev.region.name) || "ČR")}</span>
        <span class="iuPrehledDne__pill">${esc(ev.status || ev.eventType || "")}</span>
        ${ev.lane ? `<span class="iuPrehledDne__pill">${esc(ev.lane)}</span>` : ""}
        ${(ev.tags || []).slice(0, 2).map((t) => `<span class="iuPrehledDne__pill">${esc(t)}</span>`).join("")}
        ${ev._clusterSize > 1 ? `<span class="iuPrehledDne__pill">skupina ${esc(ev._clusterSize)}</span>` : ""}
        ${favSrc ? `<span class="iuPrehledDne__pill iuPrehledDne__pill--fav">★</span>` : ""}
      </div>
      ${
        Array.isArray(ev._clusterLinks) && ev._clusterLinks.length > 1
          ? `<div class="iuPrehledDne__origins">${ev._clusterLinks
              .map(
                (l) =>
                  `<a class="iuPrehledDne__origin" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(
                    l.label || "Zdroj"
                  )}</a>`
              )
              .join("")}</div>`
          : ""
      }
      <div class="iuPrehledDne__actions">
        <button type="button" data-act="save">${saved ? "Uloženo" : "Uložit"}</button>
        <button type="button" data-act="fav-source" data-source="${esc(ev.sourceId)}">${favSrc ? "★ Zdroj" : "☆ Zdroj"}</button>
        <button type="button" data-act="hide">Skrýt</button>
      </div>
    </article>
  </li>`;
}

async function mountPrehledDne(rootEl) {
  const root = rootEl || ensureRoot();
  if (!root) return null;
  applyCutoverDom();

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
  let pendingNew = [];
  let renderedSnapshot = items.slice();
  let visibleCount = PAGE_SIZE;

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

  const sortModes = (taxonomy.sortModes || []).slice();
  if (!sortModes.some((m) => m.id === "oblibene")) {
    sortModes.push({ id: "oblibene", label: "Oblíbené první" });
  }

  function paint() {
    const filtered = filterEvents(renderedSnapshot, prefs);
    const shown = filtered.slice(0, visibleCount);
    const more = filtered.length - shown.length;

    const sectionChips = chipRow(taxonomy.sections || [], "data-sec", prefs.sections);
    const typeChips = chipRow(
      (taxonomy.eventTypes || []).filter((t) => !["neprectene", "ulozene"].includes(t.id)),
      "data-type",
      prefs.eventTypes
    );
    const laneChips = chipRow(LANE_OPTIONS, "data-lane", prefs.lanes);
    const orgChips = chipRow(ORG_OPTIONS, "data-org", prefs.orgTypes);
    const levelChips = chipRow(REGION_LEVEL_OPTIONS, "data-level", prefs.regionLevels);
    const favLaneChips = chipRow(LANE_OPTIONS, "data-fav-lane", prefs.favoriteLanes);

    const sortOpts = sortModes
      .map((m) => `<option value="${esc(m.id)}"${prefs.sortMode === m.id ? " selected" : ""}>${esc(m.label)}</option>`)
      .join("");
    const groupOpts = [`<option value="">Všechny skupiny zdrojů</option>`]
      .concat(
        (taxonomy.sourceGroups || []).map(
          (g) =>
            `<option value="${esc(g.id)}"${(prefs.sourceGroups || [])[0] === g.id ? " selected" : ""}>${esc(g.label)}</option>`
        )
      )
      .join("");
    const sourceOpts = [`<option value="">Všechny zdroje</option>`]
      .concat(
        activeSources.map(
          (s) =>
            `<option value="${esc(s.id)}"${(prefs.sourceIds || [])[0] === s.id ? " selected" : ""}>${esc(s.label)}</option>`
        )
      )
      .join("");
    const timeOpts = TIME_RANGE_OPTIONS.map(
      (t) =>
        `<option value="${esc(t.id)}"${Number(prefs.timeRangeHours) === Number(t.id) ? " selected" : ""}>${esc(t.label)}</option>`
    ).join("");

    root.innerHTML = `
    <section class="iuPrehledDne" aria-label="Přehled dne">
      <h2 class="iuPrehledDne__title">Přehled dne</h2>
      <p class="iuPrehledDne__lead">Ověřené informace z veřejných a veřejnoprávních zdrojů — přizpůsobitelné filtry, bez fotek a perexů.</p>
      <div class="iuPrehledDne__newBanner" id="iuPrehledDneNewBanner" role="status">
        <span>Přibyly nové informace.</span>
        <button type="button" data-act="accept-new">Zobrazit</button>
      </div>
      <div class="iuPrehledDne__panel">
        <div class="iuPrehledDne__row"><span class="iuPrehledDne__label">Témata</span>
          <button type="button" class="iuPrehledDne__chip${!(prefs.sections || []).length ? " is-active" : ""}" data-sec="">Vše</button>
          ${sectionChips}
        </div>
        <div class="iuPrehledDne__row"><span class="iuPrehledDne__label">Skupiny</span>
          <button type="button" class="iuPrehledDne__chip${!(prefs.lanes || []).length ? " is-active" : ""}" data-lane="">Vše</button>
          ${laneChips}
        </div>
        <div class="iuPrehledDne__row"><span class="iuPrehledDne__label">Typ organizace</span>${orgChips}</div>
        <div class="iuPrehledDne__row"><span class="iuPrehledDne__label">Typ informací</span>${typeChips}</div>
        <div class="iuPrehledDne__row"><span class="iuPrehledDne__label">Úroveň regionu</span>${levelChips}</div>
        <div class="iuPrehledDne__row">
          <span class="iuPrehledDne__label">Lokalita</span>
          <input class="iuPrehledDne__input" id="iuPrehledDneLoc" type="search" placeholder="kraj, okres, město, obec" value="${esc(prefs.localityQuery || "")}" autocomplete="off" />
          <ul class="iuPrehledDne__suggest" id="iuPrehledDneSuggest" hidden></ul>
          <button type="button" class="iuPrehledDne__chip${(prefs.favoriteRegions || []).includes(String(prefs.localityQuery || "")) ? " is-active" : ""}" data-act="fav-region" title="Označit lokalitu jako oblíbenou">★ Region</button>
        </div>
        <div class="iuPrehledDne__row">
          <span class="iuPrehledDne__label">Zdroje, čas a řazení</span>
          <select class="iuPrehledDne__select" id="iuPrehledDneGroup">${groupOpts}</select>
          <select class="iuPrehledDne__select" id="iuPrehledDneSource">${sourceOpts}</select>
          <select class="iuPrehledDne__select" id="iuPrehledDneTime">${timeOpts}</select>
          <select class="iuPrehledDne__select" id="iuPrehledDneSort">${sortOpts}</select>
        </div>
        <div class="iuPrehledDne__row">
          <span class="iuPrehledDne__label">Rychlé filtry</span>
          <button type="button" class="iuPrehledDne__chip${prefs.activeOnly ? " is-active" : ""}" data-toggle="active">Aktivní</button>
          <button type="button" class="iuPrehledDne__chip${prefs.newOnly ? " is-active" : ""}" data-toggle="new">Nové</button>
          <button type="button" class="iuPrehledDne__chip${prefs.unreadOnly ? " is-active" : ""}" data-toggle="unread">Nepřečtené</button>
          <button type="button" class="iuPrehledDne__chip${prefs.savedOnly ? " is-active" : ""}" data-toggle="saved">Uložené</button>
          <button type="button" class="iuPrehledDne__chip${prefs.favoritesOnly ? " is-active" : ""}" data-toggle="favorites">Jen oblíbené</button>
        </div>
        <div class="iuPrehledDne__row"><span class="iuPrehledDne__label">Oblíbené skupiny</span>${favLaneChips}</div>
        ${renderActiveTags(prefs)}
        <div class="iuPrehledDne__count" aria-live="polite">Zobrazeno ${esc(shown.length)} z ${esc(filtered.length)} (celkem ve feedu ${esc(renderedSnapshot.length)})</div>
      </div>
      <ul class="iuPrehledDne__timeline">
        ${shown.length ? shown.map((ev) => renderItem(ev, taxonomy, prefs)).join("") : `<li class="iuPrehledDne__empty">Žádné položky pro zvolené filtry.</li>`}
      </ul>
      ${
        more > 0
          ? `<div class="iuPrehledDne__more"><button type="button" data-act="more">Načíst dalších ${esc(
              Math.min(PAGE_SIZE, more)
            )} (${esc(more)} zbývá)</button></div>`
          : ""
      }
    </section>`;

    wire(filtered.length);
  }

  function persist() {
    setPrefs(prefs);
    visibleCount = PAGE_SIZE;
    paint();
  }

  function wire(totalFiltered) {
    root.querySelectorAll("[data-sec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-sec") || "";
        prefs.sections = id ? toggleInArray(prefs.sections, id) : [];
        persist();
      });
    });
    root.querySelectorAll("[data-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        prefs.eventTypes = toggleInArray(prefs.eventTypes, btn.getAttribute("data-type"));
        persist();
      });
    });
    root.querySelectorAll("[data-lane]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-lane") || "";
        prefs.lanes = id ? toggleInArray(prefs.lanes, id) : [];
        persist();
      });
    });
    root.querySelectorAll("[data-org]").forEach((btn) => {
      btn.addEventListener("click", () => {
        prefs.orgTypes = toggleInArray(prefs.orgTypes, btn.getAttribute("data-org"));
        persist();
      });
    });
    root.querySelectorAll("[data-level]").forEach((btn) => {
      btn.addEventListener("click", () => {
        prefs.regionLevels = toggleInArray(prefs.regionLevels, btn.getAttribute("data-level"));
        persist();
      });
    });
    root.querySelectorAll("[data-fav-lane]").forEach((btn) => {
      btn.addEventListener("click", () => {
        prefs = toggleFavoriteInPrefs(prefs, "favoriteLanes", btn.getAttribute("data-fav-lane"));
        persist();
      });
    });
    root.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-toggle");
        if (t === "unread") prefs.unreadOnly = !prefs.unreadOnly;
        if (t === "saved") prefs.savedOnly = !prefs.savedOnly;
        if (t === "active") prefs.activeOnly = !prefs.activeOnly;
        if (t === "new") prefs.newOnly = !prefs.newOnly;
        if (t === "favorites") prefs.favoritesOnly = !prefs.favoritesOnly;
        persist();
      });
    });
    const sortEl = root.querySelector("#iuPrehledDneSort");
    if (sortEl) {
      sortEl.addEventListener("change", () => {
        prefs.sortMode = sortEl.value;
        persist();
      });
    }
    const groupEl = root.querySelector("#iuPrehledDneGroup");
    if (groupEl) {
      groupEl.addEventListener("change", () => {
        prefs.sourceGroups = groupEl.value ? [groupEl.value] : [];
        persist();
      });
    }
    const sourceEl = root.querySelector("#iuPrehledDneSource");
    if (sourceEl) {
      sourceEl.addEventListener("change", () => {
        prefs.sourceIds = sourceEl.value ? [sourceEl.value] : [];
        persist();
      });
    }
    const timeEl = root.querySelector("#iuPrehledDneTime");
    if (timeEl) {
      timeEl.addEventListener("change", () => {
        prefs.timeRangeHours = Number(timeEl.value) || 0;
        persist();
      });
    }
    const loc = root.querySelector("#iuPrehledDneLoc");
    const sug = root.querySelector("#iuPrehledDneSuggest");
    if (loc && sug) {
      loc.addEventListener("input", () => {
        const q = loc.value;
        prefs.localityQuery = q;
        const hits = localitySuggest(q, BUILTIN_LOCALITIES);
        if (!hits.length) {
          sug.hidden = true;
          sug.innerHTML = "";
          return;
        }
        sug.hidden = false;
        sug.innerHTML = hits
          .map((h) => `<li><button type="button" data-loc="${esc(h.name)}">${esc(h.name)}</button></li>`)
          .join("");
        sug.querySelectorAll("[data-loc]").forEach((b) => {
          b.addEventListener("click", () => {
            const name = b.getAttribute("data-loc");
            prefs.localities = [{ name }];
            prefs.localityQuery = name;
            loc.value = name;
            sug.hidden = true;
            persist();
          });
        });
      });
      loc.addEventListener("change", () => {
        prefs.localityQuery = loc.value;
        persist();
      });
    }
    const favRegBtn = root.querySelector('[data-act="fav-region"]');
    if (favRegBtn) {
      favRegBtn.addEventListener("click", () => {
        const name = String(prefs.localityQuery || (prefs.localities[0] && prefs.localities[0].name) || "").trim();
        if (!name) return;
        prefs = toggleFavoriteInPrefs(prefs, "favoriteRegions", name);
        persist();
      });
    }
    root.querySelectorAll(".iuPrehledDne__tag button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tag = btn.closest(".iuPrehledDne__tag");
        const kind = tag.getAttribute("data-kind");
        const id = tag.getAttribute("data-id");
        if (kind === "sec") prefs.sections = (prefs.sections || []).filter((x) => x !== id);
        if (kind === "type") prefs.eventTypes = (prefs.eventTypes || []).filter((x) => x !== id);
        if (kind === "src") prefs.sourceGroups = (prefs.sourceGroups || []).filter((x) => x !== id);
        if (kind === "lane") prefs.lanes = (prefs.lanes || []).filter((x) => x !== id);
        if (kind === "org") prefs.orgTypes = (prefs.orgTypes || []).filter((x) => x !== id);
        if (kind === "level") prefs.regionLevels = (prefs.regionLevels || []).filter((x) => x !== id);
        if (kind === "sid") prefs.sourceIds = (prefs.sourceIds || []).filter((x) => x !== id);
        if (kind === "favsrc") prefs.favoriteSourceIds = (prefs.favoriteSourceIds || []).filter((x) => x !== id);
        if (kind === "favlane") prefs.favoriteLanes = (prefs.favoriteLanes || []).filter((x) => x !== id);
        if (kind === "favreg") prefs.favoriteRegions = (prefs.favoriteRegions || []).filter((x) => x !== id);
        if (kind === "time") prefs.timeRangeHours = 0;
        if (kind === "flag") prefs[id] = false;
        if (kind === "loc" || kind === "q") {
          prefs.localities = [];
          prefs.localityQuery = "";
        }
        persist();
      });
    });
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
          if (act === "fav-source") {
            const sid = b.getAttribute("data-source");
            prefs = toggleFavoriteInPrefs(prefs, "favoriteSourceIds", sid);
            setPrefs(prefs);
            paint();
          }
          if (act === "hide") {
            hideItem(id);
            paint();
          }
        });
      });
    });
    const moreBtn = root.querySelector('[data-act="more"]');
    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        visibleCount = Math.min((totalFiltered || 0), visibleCount + PAGE_SIZE);
        paint();
      });
    }
    const banner = root.querySelector("#iuPrehledDneNewBanner");
    const accept = root.querySelector('[data-act="accept-new"]');
    if (banner && pendingNew.length) banner.classList.add("is-visible");
    if (accept) {
      accept.addEventListener("click", () => {
        renderedSnapshot = pendingNew.concat(renderedSnapshot);
        pendingNew = [];
        banner.classList.remove("is-visible");
        paint();
      });
    }
  }

  paint();

  const timer = setInterval(async () => {
    try {
      const fresh = await loadInfoSystemData();
      const freshItems = (fresh.feed && fresh.feed.items) || [];
      const known = new Set(renderedSnapshot.map((x) => x.id).concat(pendingNew.map((x) => x.id)));
      const neu = freshItems.filter((x) => x && !known.has(x.id));
      if (neu.length) {
        pendingNew = neu.concat(pendingNew);
        const banner = root.querySelector("#iuPrehledDneNewBanner");
        if (banner) banner.classList.add("is-visible");
      }
    } catch (_) {}
  }, 120000);

  const api = { root, refresh: paint, destroy: () => clearInterval(timer), prefs };
  try {
    window.IUPrehledDne = Object.assign({ mountPrehledDne }, api);
  } catch (_) {}
  return api;
}

function boot() {
  applyCutoverDom();
  if (!IUInfoSystem.isCutoverEnabled() && !IUInfoSystem.isParallelMode()) return;
  const root = ensureRoot();
  if (!root) return;
  mountPrehledDne(root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

export { mountPrehledDne, boot };
export default { mountPrehledDne, boot };
