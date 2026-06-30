/**
 * PC informační panel V2 — render, zdroje, detail (desktop feed only).
 */
import {
  IU_INFO_PANEL_DISCLAIMER,
  getLoadingInfoPanelItems,
  loadInfoPanelItems,
} from "./iu-desktop-info-panel-data.js";

const MOUNT_ID = "iuDesktopInfoPanelMount";
const PANEL_ID = "iuDesktopInfoPanel";
const DETAIL_ID = "iuDesktopInfoPanelDetail";

let lastSourceBtn = null;

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

function stateClass(state) {
  const s = String(state || "placeholder");
  return "iuDesktopInfoPanel__segment--" + s;
}

function buildSegment(item) {
  const primaryLine = item.primaryLabel
    ? `<span class="iuDesktopInfoPanel__primaryLabel">${esc(item.primaryLabel)}</span>`
    : "";
  const timeLine = item.updatedAtDisplay
    ? `<p class="iuDesktopInfoPanel__time"><time>${esc(item.updatedAtDisplay)}</time></p>`
    : item.state === "loading"
      ? `<p class="iuDesktopInfoPanel__time iuDesktopInfoPanel__time--loading" aria-hidden="true">…</p>`
      : "";
  const liveAttr = item.isLive ? "true" : "false";
  return (
    `<article class="iuDesktopInfoPanel__segment ${stateClass(item.state)}" data-iu-info-panel-id="${esc(item.id)}" data-iu-info-panel-state="${esc(item.state)}" data-iu-info-panel-live="${liveAttr}">` +
    `<div class="iuDesktopInfoPanel__segmentHead">` +
    `<span class="iuDesktopInfoPanel__icon" aria-hidden="true">${esc(item.icon)}</span>` +
    `<span class="iuDesktopInfoPanel__label">${esc(item.label)}</span>` +
    `<button type="button" class="iuDesktopInfoPanel__sourceBtn" data-iu-info-panel-source="${esc(item.id)}" aria-label="Zdroj dat: ${esc(item.label)}" title="Zdroj dat">ⓘ</button>` +
    `</div>` +
    primaryLine +
    `<p class="iuDesktopInfoPanel__value">${esc(item.primaryValue)}</p>` +
    `<p class="iuDesktopInfoPanel__trend ${trendClass(item.trendDirection)}">${esc(item.secondaryValue)}</p>` +
    timeLine +
    `</article>`
  );
}

function buildPanelHtml(items) {
  const segments = items.map(buildSegment).join("");
  return (
    `<section id="${PANEL_ID}" class="iuDesktopInfoPanel" aria-label="Rychlý přehled orientačních údajů">` +
    `<div class="iuDesktopInfoPanel__scroll" tabindex="0" role="region" aria-label="Rychlé informace — horizontální posuv">` +
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

function legalStatusLabel(status) {
  const map = {
    verified_free_ok: "Ověřeno — lze použít",
    verified_requires_attribution: "Ověřeno — vyžaduje uvedení zdroje",
    verified_not_allowed: "Ověřeno — nelze použít",
    pending_review: "Čeká na ověření",
    placeholder_only: "Pouze placeholder",
  };
  return map[status] || String(status || "neuvedeno");
}

function openDetail(item, sourceBtn) {
  const dlg = document.getElementById(DETAIL_ID);
  if (!dlg || !item) return;
  lastSourceBtn = sourceBtn && sourceBtn.focus ? sourceBtn : null;
  const title = dlg.querySelector(".iuDesktopInfoPanelDetail__title");
  const body = dlg.querySelector(".iuDesktopInfoPanelDetail__body");
  if (!title || !body) return;
  title.textContent = item.label;
  const updated = item.updatedAtDisplay
    ? `Aktualizace: ${item.updatedAtDisplay}`
    : "Aktualizace: zatím nejsou živá data";
  const liveNote = item.isLive
    ? "Údaj je orientační a pochází z ověřeného snapshotu."
    : item.state === "stale"
      ? "Údaj je starší než povolený limit — neprezentujeme ho jako aktuální."
      : "Údaj zatím není zobrazen jako živé dato nebo se ověřuje zdroj.";
  body.innerHTML =
    `<p class="iuDesktopInfoPanelDetail__lead">${esc(liveNote)}</p>` +
    `<dl class="iuDesktopInfoPanelDetail__dl">` +
    `<dt>Poskytovatel</dt><dd>${esc(item.sourceName)}</dd>` +
    `<dt>Typ dat</dt><dd>${esc(item.dataType)}</dd>` +
    `<dt>${esc(updated)}</dt><dd>${esc(item.updateNote)}</dd>` +
    `<dt>Stav ověření</dt><dd>${esc(legalStatusLabel(item.legalStatus))}</dd>` +
    `<dt>Datum ověření</dt><dd>${esc(item.verificationDate || "—")}</dd>` +
    `<dt>Licence / podmínky</dt><dd>${esc(item.licenseNote)}</dd>` +
    `</dl>` +
    `<p class="iuDesktopInfoPanelDetail__links">` +
    `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Oficiální zdroj</a>` +
    ` · ` +
    `<a href="${esc(item.termsUrl)}" target="_blank" rel="noopener noreferrer">Podmínky použití</a>` +
    `</p>` +
    `<p class="iuDesktopInfoPanelDetail__note">${esc(IU_INFO_PANEL_DISCLAIMER)}</p>`;
  dlg.hidden = false;
  dlg.removeAttribute("hidden");
  const closeBtn = dlg.querySelector(".iuDesktopInfoPanelDetail__close");
  if (closeBtn) closeBtn.focus();
}

function closeDetail() {
  const dlg = document.getElementById(DETAIL_ID);
  if (!dlg) return;
  dlg.hidden = true;
  dlg.setAttribute("hidden", "");
  if (lastSourceBtn && typeof lastSourceBtn.focus === "function") {
    try {
      lastSourceBtn.focus();
    } catch (_) {}
  }
  lastSourceBtn = null;
}

function trapDetailFocus(ev) {
  const dlg = document.getElementById(DETAIL_ID);
  if (!dlg || dlg.hidden || ev.key !== "Tab") return;
  const nodes = dlg.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const focusables = Array.from(nodes).filter((el) => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
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
    if (id && map[id]) openDetail(map[id], btn);
  });

  const dlg = document.getElementById(DETAIL_ID);
  if (dlg) {
    dlg.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && t.getAttribute && t.getAttribute("data-iu-info-panel-detail-close")) closeDetail();
    });
    dlg.addEventListener("keydown", trapDetailFocus);
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeDetail();
  });
}

function syncTopGap() {
  try {
    if (typeof window.iuDesktopHomeSectionTopGapSync === "function") {
      window.iuDesktopHomeSectionTopGapSync();
    }
  } catch (_) {}
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

  mount.hidden = false;
  mount.removeAttribute("hidden");
  mount.removeAttribute("aria-hidden");
  mount.innerHTML = buildPanelHtml(getLoadingInfoPanelItems());
  syncTopGap();

  const items = await loadInfoPanelItems();
  mount.innerHTML = buildPanelHtml(items);
  bindPanelEvents(items);
  syncTopGap();
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
