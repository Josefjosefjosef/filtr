/**
 * PC informační panel V3 — render, navigace šipkami, MindMenu gap, detail portal.
 */
import {
  IU_INFO_PANEL_DISCLAIMER,
  IU_INFO_PANEL_MINDMENU_GAP_PX,
  getLoadingInfoPanelItems,
  loadInfoPanelItems,
} from "./iu-desktop-info-panel-data.js";
import { getInfoPanelUserContent } from "./iu-info-panel-user-content.js";

const MOUNT_ID = "iuDesktopInfoPanelMount";
const MOBILE_MOUNT_ID = "iuMobileInfoPanelMount";
const PANEL_ID = "iuDesktopInfoPanel";
const MOBILE_PANEL_ID = "iuMobileInfoPanel";
const DETAIL_ID = "iuDesktopInfoPanelDetail";
const MIND_MENU_BTN_ID = "iuMyInfoUzelOpenBtn";

let lastSourceBtn = null;
let gapObserver = null;
let panelItemsMap = {};
let activeRender = null;

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

function isMobileTabletPanelContext() {
  try {
    if (typeof window.matchMedia !== "function") return false;
    if (!window.matchMedia("(max-width: 1024px)").matches) return false;
    const body = document.body;
    if (!body) return false;
    if (body.classList.contains("iu-mobileMainVisible")) return false;
    if (body.classList.contains("iu-mobileGateOverlayOpen")) return false;
    if (body.getAttribute("data-iu-fc") === "0") return false;
    return Boolean(document.getElementById(MOBILE_MOUNT_ID));
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

function displayTitle(item) {
  return item && (item.title || item.label) ? String(item.title || item.label) : "";
}

function buildSourcesRow(items) {
  const names = [];
  const seen = new Set();
  items.forEach((item) => {
    const key = item && item.providerShortName;
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push(key);
  });
  if (!names.length) return "";
  return `<p class="iuDesktopInfoPanel__sources"><span class="iuDesktopInfoPanel__sourcesLabel">Zdroje dat:</span> ${esc(names.join(" • "))}</p>`;
}

function buildSegment(item) {
  const cardTitle = displayTitle(item);
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
    `<span class="iuDesktopInfoPanel__label">${esc(cardTitle)}</span>` +
    `<button type="button" class="iuDesktopInfoPanel__sourceBtn" data-iu-info-panel-source="${esc(item.id)}" aria-label="Informace o ukazateli: ${esc(cardTitle)}" title="Informace o ukazateli">ⓘ</button>` +
    `</div>` +
    primaryLine +
    `<p class="iuDesktopInfoPanel__value">${esc(item.primaryValue)}</p>` +
    `<p class="iuDesktopInfoPanel__trend ${trendClass(item.trendDirection)}">${esc(item.secondaryValue)}</p>` +
    timeLine +
    `</article>`
  );
}

function buildDetailHtml() {
  return (
    `<div id="${DETAIL_ID}" class="iuDesktopInfoPanelDetail" hidden role="dialog" aria-modal="true" aria-labelledby="${DETAIL_ID}Title">` +
    `<div class="iuDesktopInfoPanelDetail__backdrop" data-iu-info-panel-detail-close="backdrop"></div>` +
    `<div class="iuDesktopInfoPanelDetail__card" role="document">` +
    `<header class="iuDesktopInfoPanelDetail__head">` +
    `<h3 id="${DETAIL_ID}Title" class="iuDesktopInfoPanelDetail__title"></h3>` +
    `<button type="button" class="iuDesktopInfoPanelDetail__close" data-iu-info-panel-detail-close="button" aria-label="Zavřít dialog">×</button>` +
    `</header>` +
    `<div class="iuDesktopInfoPanelDetail__body"></div>` +
    `</div>` +
    `</div>`
  );
}

function buildPanelHtml(items, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const panelId = options.panelId || PANEL_ID;
  const panelClass = options.panelClass || "iuDesktopInfoPanel";
  const showNav = options.showNav !== false;
  const segments = items.map(buildSegment).join("");
  const navPrev = showNav
    ? `<button type="button" class="iuDesktopInfoPanel__nav iuDesktopInfoPanel__nav--prev" data-iu-info-panel-nav="prev" aria-label="Předchozí informace" hidden>‹</button>`
    : "";
  const navNext = showNav
    ? `<button type="button" class="iuDesktopInfoPanel__nav iuDesktopInfoPanel__nav--next" data-iu-info-panel-nav="next" aria-label="Další informace" hidden>›</button>`
    : "";
  return (
    `<section id="${panelId}" class="${panelClass} iuDesktopInfoPanel" aria-label="Rychlý přehled orientačních údajů">` +
    `<div class="iuDesktopInfoPanel__viewport">` +
    navPrev +
    `<div class="iuDesktopInfoPanel__scroll" tabindex="0" role="region" aria-label="Rychlé informace">` +
    `<div class="iuDesktopInfoPanel__track">${segments}</div>` +
    `</div>` +
    navNext +
    `</div>` +
    buildSourcesRow(items) +
    `<p class="iuDesktopInfoPanel__legal">${esc(IU_INFO_PANEL_DISCLAIMER)}</p>` +
    `</section>`
  );
}

function ensureDetailPortal() {
  let dlg = document.getElementById(DETAIL_ID);
  if (!dlg) {
    const wrap = document.createElement("div");
    wrap.innerHTML = buildDetailHtml();
    dlg = wrap.firstElementChild;
  }
  if (dlg && dlg.parentElement !== document.body) {
    document.body.appendChild(dlg);
  }
  return dlg;
}

function openDetail(item, sourceBtn) {
  const dlg = ensureDetailPortal();
  if (!dlg || !item) return;
  lastSourceBtn = sourceBtn && sourceBtn.focus ? sourceBtn : null;
  const title = dlg.querySelector(".iuDesktopInfoPanelDetail__title");
  const body = dlg.querySelector(".iuDesktopInfoPanelDetail__body");
  if (!title || !body) return;
  const cardTitle = displayTitle(item);
  title.textContent = cardTitle;
  const user = getInfoPanelUserContent(item.id);
  const updatedLine = item.updatedAtDisplay
    ? `Poslední aktualizace: ${item.updatedAtDisplay}`
    : "Poslední aktualizace: zatím nejsou k dispozici";
  const freqLine = item.publishFrequencyLabel || item.updateNote || "Dle zdroje";
  const providerLine = item.sourceName || "Oficiální zdroj";
  const categoryLine = item.categoryLabel || "";

  let html = "";
  if (user) {
    html +=
      `<section class="iuDesktopInfoPanelDetail__section">` +
      `<h4 class="iuDesktopInfoPanelDetail__sectionTitle">Co to znamená</h4>` +
      `<p>${esc(user.meaning)}</p>` +
      `</section>` +
      `<section class="iuDesktopInfoPanelDetail__section">` +
      `<h4 class="iuDesktopInfoPanelDetail__sectionTitle">Proč je to důležité</h4>` +
      `<p>${esc(user.importance)}</p>` +
      `</section>` +
      `<section class="iuDesktopInfoPanelDetail__section">` +
      `<h4 class="iuDesktopInfoPanelDetail__sectionTitle">Jak číst hodnoty</h4>` +
      `<p><strong>Růst:</strong> ${esc(user.rise)}</p>` +
      `<p><strong>Pokles:</strong> ${esc(user.fall)}</p>` +
      `</section>` +
      `<section class="iuDesktopInfoPanelDetail__section">` +
      `<h4 class="iuDesktopInfoPanelDetail__sectionTitle">Dopad do běžného života</h4>` +
      `<p>${esc(user.life)}</p>` +
      `</section>`;
  } else {
    html += `<p class="iuDesktopInfoPanelDetail__lead">${esc(item.dataType || "Orientační ukazatel z ověřeného zdroje.")}</p>`;
  }

  html +=
    `<section class="iuDesktopInfoPanelDetail__section iuDesktopInfoPanelDetail__section--meta">` +
    (categoryLine ? `<p><strong>Kategorie:</strong> ${esc(categoryLine)}</p>` : "") +
    `<p><strong>Poskytovatel:</strong> ${esc(providerLine)}</p>` +
    `<p><strong>${esc(updatedLine)}</strong></p>` +
    `<p><strong>Frekvence zveřejňování:</strong> ${esc(freqLine)}</p>` +
    `</section>` +
    `<p class="iuDesktopInfoPanelDetail__links">` +
    `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Otevřít oficiální zdroj</a>` +
    `</p>` +
    `<p class="iuDesktopInfoPanelDetail__note">${esc(IU_INFO_PANEL_DISCLAIMER)}</p>`;

  body.innerHTML = html;
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

function updateNavState(panel) {
  if (!panel) return;
  const scroll = panel.querySelector(".iuDesktopInfoPanel__scroll");
  const prev = panel.querySelector('[data-iu-info-panel-nav="prev"]');
  const next = panel.querySelector('[data-iu-info-panel-nav="next"]');
  if (!scroll || !prev || !next) return;
  const maxScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
  const sl = scroll.scrollLeft;
  const canPrev = sl > 2;
  const canNext = sl < maxScroll - 2;
  prev.hidden = !canPrev;
  next.hidden = !canNext;
  if (canPrev) prev.removeAttribute("hidden");
  else prev.setAttribute("hidden", "");
  if (canNext) next.removeAttribute("hidden");
  else next.setAttribute("hidden", "");
}

function scrollPanelBy(panel, direction) {
  const scroll = panel && panel.querySelector(".iuDesktopInfoPanel__scroll");
  if (!scroll) return;
  const step = Math.max(240, Math.round(scroll.clientWidth * 0.72));
  scroll.scrollBy({ left: direction * step, behavior: "smooth" });
  window.setTimeout(() => updateNavState(panel), 320);
}

function bindPanelNav(panel) {
  if (!panel || panel.dataset.iuNavBound === "1") return;
  panel.dataset.iuNavBound = "1";
  const scroll = panel.querySelector(".iuDesktopInfoPanel__scroll");
  panel.addEventListener("click", (ev) => {
    const nav = ev.target && ev.target.closest ? ev.target.closest("[data-iu-info-panel-nav]") : null;
    if (!nav) return;
    ev.preventDefault();
    const dir = nav.getAttribute("data-iu-info-panel-nav") === "next" ? 1 : -1;
    scrollPanelBy(panel, dir);
  });
  if (scroll) {
    scroll.addEventListener("scroll", () => updateNavState(panel), { passive: true });
  }
  window.addEventListener("resize", () => updateNavState(panel), { passive: true });
  requestAnimationFrame(() => updateNavState(panel));
}

function hideInfoPanelMount(mount) {
  if (!mount) return;
  mount.hidden = true;
  mount.setAttribute("hidden", "");
  mount.setAttribute("aria-hidden", "true");
  mount.style.visibility = "";
  mount.innerHTML = "";
  mount.removeAttribute("data-iu-info-panel-ready");
}

function bindPanelEvents(items) {
  const mounts = [document.getElementById(MOUNT_ID), document.getElementById(MOBILE_MOUNT_ID)].filter(Boolean);
  if (!mounts.length) return;
  panelItemsMap = {};
  items.forEach((item) => {
    panelItemsMap[item.id] = item;
  });

  mounts.forEach((mount) => {
    if (mount.dataset.iuPanelEventsBound) return;
    mount.dataset.iuPanelEventsBound = "1";
    mount.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("[data-iu-info-panel-source]") : null;
      if (!btn) return;
      ev.preventDefault();
      const id = btn.getAttribute("data-iu-info-panel-source");
      if (id && panelItemsMap[id]) openDetail(panelItemsMap[id], btn);
    });
  });

  const dlg = ensureDetailPortal();
  if (dlg && !dlg.dataset.iuDetailBound) {
    dlg.dataset.iuDetailBound = "1";
    dlg.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && t.getAttribute && t.getAttribute("data-iu-info-panel-detail-close")) closeDetail();
    });
    dlg.addEventListener("keydown", trapDetailFocus);
  }

  if (!window.__iuInfoPanelEscapeBound) {
    window.__iuInfoPanelEscapeBound = 1;
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeDetail();
    });
  }
}

function syncMindMenuPanelGap() {
  try {
    if (!isDesktopPanelContext()) return;
    const btn = document.getElementById(MIND_MENU_BTN_ID);
    const mount = document.getElementById(MOUNT_ID);
    if (!btn || !mount) return;

    mount.style.removeProperty("transform");

    const gap = mount.getBoundingClientRect().top - btn.getBoundingClientRect().bottom;
    if (Math.abs(gap - IU_INFO_PANEL_MINDMENU_GAP_PX) <= 0.5) return;

    const currentMargin = parseFloat(getComputedStyle(mount).marginTop) || 0;
    const marginTop = Math.round(currentMargin + (IU_INFO_PANEL_MINDMENU_GAP_PX - gap));
    if (marginTop === currentMargin) return;
    mount.style.setProperty("--iu-dhp-info-panel-mt-sync", marginTop + "px");
    mount.style.marginTop = "var(--iu-dhp-info-panel-mt-sync)";
    persistMindMenuGap(marginTop);
  } catch (_) {}
}

function syncPanelHomecardsGap() {
  try {
    if (!isDesktopPanelContext()) return;
    const panel = document.getElementById(PANEL_ID);
    const homecards = document.getElementById("iuSilverTallScrollSection");
    if (!panel || !homecards) return;

    const gap = homecards.getBoundingClientRect().top - panel.getBoundingClientRect().bottom;
    if (Math.abs(gap - 30) <= 0.5) return;

    const currentMargin = parseFloat(getComputedStyle(homecards).marginTop) || 30;
    const marginTop = Math.round(currentMargin + (30 - gap));
    homecards.style.setProperty("--iu-dhp-homecards-mt-sync", marginTop + "px");
  } catch (_) {}
}

function syncPanelLayoutGaps() {
  syncMindMenuPanelGap();
  syncPanelHomecardsGap();
}

function applyCachedMindMenuGap() {
  try {
    if (!isDesktopPanelContext()) return;
    const mount = document.getElementById(MOUNT_ID);
    if (!mount) return;
    const cached = sessionStorage.getItem("iuInfoPanelMindMenuMt");
    if (!cached || !/^-?\d+$/.test(cached)) return;
    mount.style.setProperty("--iu-dhp-info-panel-mt-sync", cached + "px");
    mount.style.marginTop = "var(--iu-dhp-info-panel-mt-sync)";
  } catch (_) {}
}

function persistMindMenuGap(marginTop) {
  try {
    sessionStorage.setItem("iuInfoPanelMindMenuMt", String(marginTop));
  } catch (_) {}
}

function initGapSync() {
  if (window.__iuInfoPanelGapSyncInited) return;
  window.__iuInfoPanelGapSyncInited = 1;
  window.addEventListener("resize", syncPanelLayoutGaps, { passive: true });
  try {
    const btn = document.getElementById(MIND_MENU_BTN_ID);
    const stack = document.getElementById("iuSilverWelcomeStack");
    if (typeof ResizeObserver === "function" && (btn || stack)) {
      gapObserver = new ResizeObserver(() => syncMindMenuPanelGap());
      if (btn) gapObserver.observe(btn);
      if (stack) gapObserver.observe(stack);
    }
  } catch (_) {}
}

function syncTopGap() {
  try {
    syncPanelLayoutGaps();
    if (typeof window.iuDesktopHomeSectionTopGapSync === "function") {
      window.iuDesktopHomeSectionTopGapSync();
    }
  } catch (_) {}
}

async function renderPanel() {
  if (activeRender) return activeRender;
  activeRender = renderPanelInner().finally(() => {
    activeRender = null;
  });
  return activeRender;
}

async function renderPanelInner() {
  const desktopMount = document.getElementById(MOUNT_ID);
  const mobileMount = document.getElementById(MOBILE_MOUNT_ID);
  const desktopActive = isDesktopPanelContext();
  const mobileActive = isMobileTabletPanelContext();

  if (desktopMount && !desktopActive) {
    hideInfoPanelMount(desktopMount);
  }
  if (mobileMount && !mobileActive) {
    hideInfoPanelMount(mobileMount);
  }
  if (!desktopActive && !mobileActive) return;

  if (desktopActive && desktopMount) {
    applyCachedMindMenuGap();
    desktopMount.hidden = false;
    desktopMount.removeAttribute("hidden");
    desktopMount.removeAttribute("aria-hidden");
    desktopMount.style.visibility = "visible";
    desktopMount.removeAttribute("data-iu-info-panel-ready");
    desktopMount.innerHTML = buildPanelHtml(getLoadingInfoPanelItems(), { showNav: true, panelId: PANEL_ID });
    initGapSync();
  }

  if (mobileActive && mobileMount) {
    mobileMount.hidden = false;
    mobileMount.removeAttribute("hidden");
    mobileMount.removeAttribute("aria-hidden");
    mobileMount.setAttribute("aria-busy", "true");
    mobileMount.style.visibility = "visible";
    mobileMount.removeAttribute("data-iu-info-panel-ready");
  }

  ensureDetailPortal();

  const desktopPanelLoading = desktopActive ? document.getElementById(PANEL_ID) : null;
  if (desktopPanelLoading) bindPanelNav(desktopPanelLoading);

  const items = await loadInfoPanelItems();

  if (desktopActive && desktopMount && desktopMount.isConnected) {
    desktopMount.innerHTML = buildPanelHtml(items, { showNav: true, panelId: PANEL_ID });
    syncPanelLayoutGaps();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    syncPanelLayoutGaps();
    desktopMount.setAttribute("data-iu-info-panel-ready", "1");
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      bindPanelNav(panel);
      updateNavState(panel);
    }
  }

  if (mobileActive && mobileMount && mobileMount.isConnected) {
    mobileMount.innerHTML = buildPanelHtml(items, {
      showNav: false,
      panelId: MOBILE_PANEL_ID,
      panelClass: "iuMobileInfoPanel",
    });
    mobileMount.setAttribute("data-iu-info-panel-ready", "1");
    mobileMount.removeAttribute("aria-busy");
  }

  ensureDetailPortal();
  bindPanelEvents(items);
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
    const mqDesktop = window.matchMedia("(min-width: 1025px)");
    const onMqDesktop = () => run();
    if (mqDesktop.addEventListener) mqDesktop.addEventListener("change", onMqDesktop);
    else if (mqDesktop.addListener) mqDesktop.addListener(onMqDesktop);
  } catch (_) {}

  try {
    const mqMobile = window.matchMedia("(max-width: 1024px)");
    const onMqMobile = () => run();
    if (mqMobile.addEventListener) mqMobile.addEventListener("change", onMqMobile);
    else if (mqMobile.addListener) mqMobile.addListener(onMqMobile);
  } catch (_) {}

  window.addEventListener("iu:desktop-home-grid", run);
  document.addEventListener("iu:info-center-mounted", run);
}

initInfoPanel();

try {
  window.iuDesktopInfoPanelLayoutSync = syncPanelLayoutGaps;
  window.__iuInfoPanelOpenSourceDetail = (id) => {
    const item = panelItemsMap[id];
    const btn = document.querySelector(`[data-iu-info-panel-source="${id}"]`);
    if (!item) return { ok: false, reason: "missing_item" };
    openDetail(item, btn || null);
    return { ok: true };
  };
} catch (_) {}

export { renderPanel, loadInfoPanelItems, syncMindMenuPanelGap, syncPanelHomecardsGap, syncPanelLayoutGaps };
