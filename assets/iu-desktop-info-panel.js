/**
 * PC informační panel — render, zdroje, detail (desktop feed only).
 */
import {
  IU_INFO_PANEL_DISCLAIMER,
  loadInfoPanelItems,
} from "./iu-desktop-info-panel-data.js";

const MOUNT_ID = "iuDesktopInfoPanelMount";
const PANEL_ID = "iuDesktopInfoPanel";
const DETAIL_ID = "iuDesktopInfoPanelDetail";

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isDesktopPanelContext() {
  try {
    if (typeof window.matchMedia !== "function") return false;
    if (!window.matchMedia("(min-width: 1025px)").matches) return false;
    const body = document.body;
    if (!body || !body.classList.contains("iu-desktop-home-grid")) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function trendClass(dir) {
  if (dir === "up") return "iuDesktopInfoPanel__trend--up";
  if (dir === "down") return "iuDesktopInfoPanel__trend--down";
  if (dir === "flat") return "iuDesktopInfoPanel__trend--flat";
  return "iuDesktopInfoPanel__trend--neutral";
}

function buildSegment(item) {
  const primaryLine = item.primaryLabel
    ? `<span class="iuDesktopInfoPanel__primaryLabel">${esc(item.primaryLabel)}</span>`
    : "";
  return (
    `<article class="iuDesktopInfoPanel__segment" data-iu-info-panel-id="${esc(item.id)}">` +
    `<div class="iuDesktopInfoPanel__segmentHead">` +
    `<span class="iuDesktopInfoPanel__icon" aria-hidden="true">${esc(item.icon)}</span>` +
    `<span class="iuDesktopInfoPanel__label">${esc(item.label)}</span>` +
    `<button type="button" class="iuDesktopInfoPanel__sourceBtn" data-iu-info-panel-source="${esc(item.id)}" aria-label="Zdroj dat: ${esc(item.label)}" title="Zdroj dat">ⓘ</button>` +
    `</div>` +
    primaryLine +
    `<p class="iuDesktopInfoPanel__value">${esc(item.primaryValue)}</p>` +
    `<p class="iuDesktopInfoPanel__trend ${trendClass(item.trendDirection)}">${esc(item.secondaryValue)}</p>` +
    `</article>`
  );
}

function buildPanelHtml(items) {
  const segments = items.map(buildSegment).join("");
  return (
    `<section id="${PANEL_ID}" class="iuDesktopInfoPanel" aria-label="Rychlý přehled">` +
    `<div class="iuDesktopInfoPanel__scroll" tabindex="0" role="region" aria-label="Rychlé informace">` +
    `<div class="iuDesktopInfoPanel__track">${segments}</div>` +
    `</div>` +
    `<p class="iuDesktopInfoPanel__legal">${esc(IU_INFO_PANEL_DISCLAIMER)}</p>` +
    `</section>` +
    `<div id="${DETAIL_ID}" class="iuDesktopInfoPanelDetail" hidden role="dialog" aria-modal="true" aria-labelledby="${DETAIL_ID}Title">` +
    `<div class="iuDesktopInfoPanelDetail__backdrop" data-iu-info-panel-detail-close="backdrop"></div>` +
    `<div class="iuDesktopInfoPanelDetail__card" role="document">` +
    `<header class="iuDesktopInfoPanelDetail__head">` +
    `<h3 id="${DETAIL_ID}Title" class="iuDesktopInfoPanelDetail__title"></h3>` +
    `<button type="button" class="iuDesktopInfoPanelDetail__close" data-iu-info-panel-detail-close="button" aria-label="Zavřít">×</button>` +
    `</header>` +
    `<div class="iuDesktopInfoPanelDetail__body"></div>` +
    `</div>` +
    `</div>`
  );
}

function openDetail(item) {
  const dlg = document.getElementById(DETAIL_ID);
  if (!dlg || !item) return;
  const title = dlg.querySelector(".iuDesktopInfoPanelDetail__title");
  const body = dlg.querySelector(".iuDesktopInfoPanelDetail__body");
  if (!title || !body) return;
  title.textContent = item.label;
  const updated = item.updatedAt ? `Aktualizace: ${item.updatedAt}` : "Aktualizace: zatím nejsou živá data";
  const liveNote = item.isLive
    ? "Údaj je informativní a pochází z ověřeného snapshotu."
    : "Údaj zatím není zobrazen jako živé dato — zdroj se ověřuje.";
  body.innerHTML =
    `<p class="iuDesktopInfoPanelDetail__lead">${esc(liveNote)}</p>` +
    `<dl class="iuDesktopInfoPanelDetail__dl">` +
    `<dt>Poskytovatel</dt><dd>${esc(item.sourceName)}</dd>` +
    `<dt>Typ dat</dt><dd>${esc(item.dataType)}</dd>` +
    `<dt>${esc(updated)}</dt><dd>${esc(item.updateNote)}</dd>` +
    `<dt>Licence / podmínky</dt><dd>${esc(item.licenseNote)}</dd>` +
    `</dl>` +
    `<p class="iuDesktopInfoPanelDetail__links">` +
    `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Oficiální zdroj</a>` +
    ` · ` +
    `<a href="${esc(item.termsUrl)}" target="_blank" rel="noopener noreferrer">Podmínky použití</a>` +
    `</p>`;
  dlg.hidden = false;
  dlg.removeAttribute("hidden");
}

function closeDetail() {
  const dlg = document.getElementById(DETAIL_ID);
  if (!dlg) return;
  dlg.hidden = true;
  dlg.setAttribute("hidden", "");
}

function bindPanelEvents(items) {
  const mount = document.getElementById(MOUNT_ID);
  if (!mount) return;
  const map = {};
  items.forEach((item) => {
    map[item.id] = item;
  });

  mount.addEventListener("click", (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest("[data-iu-info-panel-source]") : null;
    if (!btn) return;
    ev.preventDefault();
    const id = btn.getAttribute("data-iu-info-panel-source");
    if (id && map[id]) openDetail(map[id]);
  });

  const dlg = document.getElementById(DETAIL_ID);
  if (dlg) {
    dlg.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && t.getAttribute && t.getAttribute("data-iu-info-panel-detail-close")) closeDetail();
    });
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeDetail();
  });
}

async function renderPanel() {
  const mount = document.getElementById(MOUNT_ID);
  if (!mount || !isDesktopPanelContext()) {
    if (mount) {
      mount.hidden = true;
      mount.setAttribute("hidden", "");
      mount.innerHTML = "";
    }
    return;
  }
  const items = await loadInfoPanelItems();
  mount.innerHTML = buildPanelHtml(items);
  mount.hidden = false;
  mount.removeAttribute("hidden");
  mount.removeAttribute("aria-hidden");
  bindPanelEvents(items);
  try {
    if (typeof window.iuDesktopHomeSectionTopGapSync === "function") {
      document.body.removeAttribute("data-iu-gap-synced");
      window.iuDesktopHomeSectionTopGapSync();
    }
  } catch (_) {}
}

function initInfoPanel() {
  if (window.__iuDesktopInfoPanelInit) return;
  window.__iuDesktopInfoPanelInit = 1;

  const run = () => {
    renderPanel().catch(() => {});
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
  setTimeout(run, 120);
  setTimeout(run, 900);

  try {
    const mq = window.matchMedia("(min-width: 1025px)");
    const onMq = () => run();
    if (mq.addEventListener) mq.addEventListener("change", onMq);
    else if (mq.addListener) mq.addListener(onMq);
  } catch (_) {}

  window.addEventListener("iu:desktop-home-grid", run);
  document.addEventListener("iu:info-center-mounted", run);
}

initInfoPanel();

export { renderPanel, loadInfoPanelItems };
