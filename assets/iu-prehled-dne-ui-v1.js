/**
 * InfoUzel.cz — Přehled dne UI v1 (PC + mobile + tablet + PWA)
 * Control panel + timeline. No internal pages. No images/perex.
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
} from "./iu-info-system-core-v1.js";

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

function renderActiveTags(prefs) {
  const tags = [];
  (prefs.localities || []).forEach((l) => tags.push({ kind: "loc", id: l.name || l, label: `📍 ${l.name || l}` }));
  if (prefs.localityQuery) tags.push({ kind: "q", id: "q", label: `📍 ${prefs.localityQuery}` });
  (prefs.sections || []).forEach((id) => tags.push({ kind: "sec", id, label: id }));
  (prefs.eventTypes || []).forEach((id) => tags.push({ kind: "type", id, label: `⚡ ${id}` }));
  (prefs.sourceGroups || []).forEach((id) => tags.push({ kind: "src", id, label: id }));
  if (!tags.length) return "";
  return `<div class="iuPrehledDne__activeTags">${tags
    .map(
      (t) =>
        `<span class="iuPrehledDne__tag" data-kind="${esc(t.kind)}" data-id="${esc(t.id)}">${esc(t.label)}<button type="button" aria-label="Odstranit">×</button></span>`
    )
    .join("")}</div>`;
}

function renderItem(ev, taxonomy) {
  const color = sectionColor(taxonomy, ev.sectionId);
  const alert = String(ev.eventType) === "mimoradne" || Number(ev.importance) >= 5;
  const read = isRead(ev.id);
  const saved = isSaved(ev.id);
  return `
  <li class="iuPrehledDne__item${read ? " is-read" : ""}" data-id="${esc(ev.id)}" style="--iu-pd-dot:${esc(color)}">
    <div class="iuPrehledDne__timeCol">
      <div class="iuPrehledDne__time">${esc(fmtTime(ev.publishedAt || ev.updatedAt))}</div>
      <div class="iuPrehledDne__rel">${esc(fmtRel(ev.publishedAt || ev.updatedAt))}</div>
      <div class="iuPrehledDne__readMark" aria-label="Přečteno">✓</div>
    </div>
    <div class="iuPrehledDne__axis"><span class="iuPrehledDne__dot${alert ? " iuPrehledDne__dot--alert" : ""}"></span></div>
    <article class="iuPrehledDne__card">
      <a class="iuPrehledDne__cardTitle" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">${esc(ev.title)}</a>
      <div class="iuPrehledDne__meta">
        <span class="iuPrehledDne__pill">${esc(ev.sourceLabel || ev.sourceId)}</span>
        <span class="iuPrehledDne__pill">${esc((ev.region && ev.region.name) || "ČR")}</span>
        <span class="iuPrehledDne__pill">${esc(ev.status || ev.eventType || "")}</span>
        ${(ev.tags || []).slice(0, 3).map((t) => `<span class="iuPrehledDne__pill">${esc(t)}</span>`).join("")}
        ${ev._clusterSize > 1 ? `<span class="iuPrehledDne__pill">skupina ${esc(ev._clusterSize)}</span>` : ""}
      </div>
      <div class="iuPrehledDne__actions">
        <button type="button" data-act="save">${saved ? "Uloženo" : "Uložit"}</button>
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

  // Enrich sourceGroup from registry
  const byId = new Map((registry.entries || []).map((e) => [e.id, e]));
  for (const it of items) {
    const src = byId.get(it.sourceId);
    if (src) it.sourceGroup = src.group;
  }

  function paint() {
    const filtered = filterEvents(renderedSnapshot, prefs);
    const sectionChips = (taxonomy.sections || [])
      .map((s) => {
        const on = (prefs.sections || []).includes(s.id);
        return `<button type="button" class="iuPrehledDne__chip${on ? " is-active" : ""}" data-sec="${esc(s.id)}">${esc(s.label)}</button>`;
      })
      .join("");
    const typeChips = (taxonomy.eventTypes || [])
      .filter((t) => !["neprectene", "ulozene"].includes(t.id))
      .map((t) => {
        const on = (prefs.eventTypes || []).includes(t.id);
        return `<button type="button" class="iuPrehledDne__chip${on ? " is-active" : ""}" data-type="${esc(t.id)}">${esc(t.label)}</button>`;
      })
      .join("");
    const sortOpts = (taxonomy.sortModes || [])
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

    root.innerHTML = `
    <section class="iuPrehledDne" aria-label="Přehled dne">
      <h2 class="iuPrehledDne__title">Přehled dne</h2>
      <p class="iuPrehledDne__lead">Ověřené informace z veřejných a veřejnoprávních zdrojů — bez fotek a perexů.</p>
      <div class="iuPrehledDne__newBanner" id="iuPrehledDneNewBanner" role="status">
        <span>Přibyly nové informace.</span>
        <button type="button" data-act="accept-new">Zobrazit</button>
      </div>
      <div class="iuPrehledDne__panel">
        <div class="iuPrehledDne__row"><span class="iuPrehledDne__label">Co chci sledovat</span>
          <button type="button" class="iuPrehledDne__chip${!(prefs.sections || []).length ? " is-active" : ""}" data-sec="">Vše</button>
          ${sectionChips}
        </div>
        <div class="iuPrehledDne__row"><span class="iuPrehledDne__label">Typ informací</span>${typeChips}</div>
        <div class="iuPrehledDne__row">
          <span class="iuPrehledDne__label">Lokalita</span>
          <input class="iuPrehledDne__input" id="iuPrehledDneLoc" type="search" placeholder="např. Kunčina" value="${esc(prefs.localityQuery || "")}" autocomplete="off" />
          <ul class="iuPrehledDne__suggest" id="iuPrehledDneSuggest" hidden></ul>
        </div>
        <div class="iuPrehledDne__row">
          <span class="iuPrehledDne__label">Zdroje a řazení</span>
          <select class="iuPrehledDne__select" id="iuPrehledDneGroup">${groupOpts}</select>
          <select class="iuPrehledDne__select" id="iuPrehledDneSort">${sortOpts}</select>
          <button type="button" class="iuPrehledDne__chip${prefs.unreadOnly ? " is-active" : ""}" data-toggle="unread">Nepřečtené</button>
          <button type="button" class="iuPrehledDne__chip${prefs.savedOnly ? " is-active" : ""}" data-toggle="saved">Uložené</button>
        </div>
        ${renderActiveTags(prefs)}
      </div>
      <ul class="iuPrehledDne__timeline">
        ${filtered.length ? filtered.map((ev) => renderItem(ev, taxonomy)).join("") : `<li class="iuPrehledDne__empty">Žádné položky pro zvolené filtry.</li>`}
      </ul>
    </section>`;

    wire();
  }

  function persist() {
    setPrefs(prefs);
    paint();
  }

  function wire() {
    root.querySelectorAll("[data-sec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-sec") || "";
        if (!id) prefs.sections = [];
        else {
          const set = new Set(prefs.sections || []);
          if (set.has(id)) set.delete(id);
          else set.add(id);
          prefs.sections = Array.from(set);
        }
        persist();
      });
    });
    root.querySelectorAll("[data-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-type");
        const set = new Set(prefs.eventTypes || []);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        prefs.eventTypes = Array.from(set);
        persist();
      });
    });
    root.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-toggle");
        if (t === "unread") prefs.unreadOnly = !prefs.unreadOnly;
        if (t === "saved") prefs.savedOnly = !prefs.savedOnly;
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
    root.querySelectorAll(".iuPrehledDne__tag button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tag = btn.closest(".iuPrehledDne__tag");
        const kind = tag.getAttribute("data-kind");
        const id = tag.getAttribute("data-id");
        if (kind === "sec") prefs.sections = (prefs.sections || []).filter((x) => x !== id);
        if (kind === "type") prefs.eventTypes = (prefs.eventTypes || []).filter((x) => x !== id);
        if (kind === "src") prefs.sourceGroups = (prefs.sourceGroups || []).filter((x) => x !== id);
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
          if (act === "hide") {
            hideItem(id);
            paint();
          }
        });
      });
    });
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

  // Poll for new items without auto-reshuffle
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
