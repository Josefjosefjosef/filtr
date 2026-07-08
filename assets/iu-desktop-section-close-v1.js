/**
 * infoUzel.cz — PC (≥901px) left-rail section close + exact scroll restore.
 * Toggle: re-click same nav item | top/bottom Zavřít buttons.
 */
(function iuDesktopSectionCloseV1() {
  "use strict";

  if (window.__iuDesktopSectionCloseV1Init) return;
  window.__iuDesktopSectionCloseV1Init = true;

  var DESKTOP_MQ = "(min-width: 901px)";
  var RESTORE_TIMEOUT_MS = 6000;
  var restoreState = null;
  var preClickCapture = null;

  function isDesktop() {
    try {
      return !!(window.matchMedia && window.matchMedia(DESKTOP_MQ).matches);
    } catch (_) {
      return false;
    }
  }

  function getScrollY() {
    try {
      if (typeof window.iuGetMainScrollTop === "function") return window.iuGetMainScrollTop();
    } catch (_) {}
    try {
      return Math.max(
        0,
        window.scrollY || 0,
        (document.documentElement && document.documentElement.scrollTop) || 0,
        (document.body && document.body.scrollTop) || 0
      );
    } catch (_) {
      return 0;
    }
  }

  function getFeedPage() {
    try {
      var st = window.__iuFeedPipelineState;
      var pg = st ? Number(st.page) : 1;
      return Number.isFinite(pg) && pg >= 1 ? pg : 1;
    } catch (_) {
      return 1;
    }
  }

  function normalizeNavKey(key) {
    var parts = String(key || "").split("|");
    var sec = String(parts[0] || "feed").trim().toLowerCase();
    var topic = String(parts[1] || "").trim().toLowerCase();
    if (sec === "media") sec = "feed";
    if (sec === "tv") sec = "tvonline";
    if (sec === "maps") sec = "mapy";
    if (topic === "all") topic = "";
    return sec + "|" + topic;
  }

  function navKeyFromItem(item) {
    if (!item) return "";
    var mediaTopic = String(item.getAttribute("data-media-topic") || "").trim().toLowerCase();
    if (mediaTopic) return normalizeNavKey("feed|" + mediaTopic);
    var accent = String(item.getAttribute("data-accent") || "").trim().toLowerCase();
    if (accent === "travel") return "travel|";
    return normalizeNavKey(accent + "|");
  }

  function currentNavKeyFromUrl() {
    try {
      var p = new URLSearchParams(String(location.search || ""));
      var sec = String(p.get("section") || "feed").trim().toLowerCase();
      var topic = String(p.get("topic") || "").trim().toLowerCase();
      return normalizeNavKey(sec + "|" + topic);
    } catch (_) {
      return "feed|";
    }
  }

  function sectionOpenFromLeftRail() {
    try {
      var p = new URLSearchParams(String(location.search || ""));
      var sec = String(p.get("section") || "").trim().toLowerCase();
      if (!sec) return false;
      if (sec === "feed" || sec === "media") {
        var topic = String(p.get("topic") || "").trim().toLowerCase();
        return !!(topic && topic !== "all");
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function cancelRestore() {
    restoreState = null;
  }

  function removeCloseButtons() {
    try {
      document.querySelectorAll(".iuDesktopSectionCloseBar").forEach(function (el) {
        el.remove();
      });
      document.querySelectorAll(".iuDesktopSectionCloseFooter").forEach(function (el) {
        el.remove();
      });
      document.querySelectorAll(".iuDesktopSectionCloseBtn").forEach(function (el) {
        if (!el.closest(".iuSectionHeader")) el.remove();
        else el.remove();
      });
    } catch (_) {}
  }

  function makeCloseBtn(pos) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "iuDesktopSectionCloseBtn";
    b.setAttribute("data-iu-desktop-section-close", pos);
    b.textContent = "Zavřít";
    return b;
  }

  function findVisibleSectionRoot() {
    try {
      var sec = String((document.body && document.body.dataset.section) || "").trim().toLowerCase();
      if (!sec || sec === "feed" || sec === "media") {
        var feedOnly = document.getElementById("feed");
        if (feedOnly) {
          var fst = getComputedStyle(feedOnly);
          if (fst.display !== "none" && fst.visibility !== "hidden") return feedOnly;
        }
        return null;
      }
      if (sec.indexOf("aff-") === 0) {
        var aff = document.getElementById("iuAffiliateView");
        if (aff) return aff;
      }
      var bySec = {
        pocasi: "iuWeatherView",
        mapy: "iuMapyView",
        maps: "iuMapyView",
        jr: "iuJrEmptyView",
        tvprogram: "iuTvProgramView",
        tvonline: "iuTvOnlineView",
        radio: "iuRadioView",
        travel: "feed",
        hry: "feed",
        kultura: "feed",
        veda: "feed",
        vzdelavani: "feed",
      };
      var id = bySec[sec] || "";
      if (id === "feed") {
        var feed = document.getElementById("feed");
        if (feed) return feed;
      }
      if (id) {
        var view = document.getElementById(id);
        if (view) return view;
      }
    } catch (_) {}
    return null;
  }

  function findSectionHeader(root) {
    if (!root) return null;
    var header = root.querySelector(".iuSectionHeader");
    if (header) return header;
    if (root.id === "iuTvProgramView") {
      return root.querySelector(".iuTvPgHero__inner") || root.querySelector(".iuTvPgHero");
    }
    return null;
  }

  function getSectionTitle() {
    try {
      var active = document.querySelector("#iuLeftRail .iu-leftNavItem.is-active");
      if (active) {
        var lbl = active.querySelector(".iu-leftNavLabel");
        if (lbl) return String(lbl.textContent || "").trim();
      }
    } catch (_) {}
    try {
      var h = document.querySelector(
        "#iuCenterStage .iuSectionHeader h1, #iuCenterStage .iuSectionHeader h2"
      );
      if (h) return String(h.textContent || "").trim();
    } catch (_) {}
    return "Sekce";
  }

  function ensureTopCloseButton(root) {
    if (!root || !isDesktop() || !sectionOpenFromLeftRail()) return;
    var header = findSectionHeader(root);
    if (header) {
      if (!header.querySelector('[data-iu-desktop-section-close="top"]')) {
        if (header.classList.contains("iuTvPgHero__inner")) {
          try {
            header.style.display = "flex";
            header.style.alignItems = "center";
            header.style.gap = "10px";
            header.style.flexWrap = "nowrap";
          } catch (_) {}
          if (!header.querySelector(".iuSectionHeaderLine")) {
            var heroLine = document.createElement("div");
            heroLine.className = "iuSectionHeaderLine";
            heroLine.setAttribute("aria-hidden", "true");
            heroLine.style.flex = "1 1 auto";
            header.appendChild(heroLine);
          }
        }
        header.appendChild(makeCloseBtn("top"));
      }
      return;
    }
    if (root.querySelector('[data-iu-desktop-section-close="top"]')) return;
    var bar = document.createElement("div");
    bar.className = "iuDesktopSectionCloseBar iuSectionHeader";
    var h2 = document.createElement("h2");
    h2.textContent = getSectionTitle();
    var line = document.createElement("div");
    line.className = "iuSectionHeaderLine";
    line.setAttribute("aria-hidden", "true");
    bar.appendChild(h2);
    bar.appendChild(line);
    bar.appendChild(makeCloseBtn("top"));
    root.insertBefore(bar, root.firstChild || null);
  }

  function ensureBottomCloseButton(root) {
    if (!root || !isDesktop() || !sectionOpenFromLeftRail()) return;
    if (root.querySelector('[data-iu-desktop-section-close="bottom"]')) return;
    var footer = document.createElement("div");
    footer.className = "iuDesktopSectionCloseFooter";
    footer.appendChild(makeCloseBtn("bottom"));
    root.appendChild(footer);
  }

  function ensureCloseButtons() {
    if (!isDesktop()) {
      removeCloseButtons();
      return;
    }
    if (!sectionOpenFromLeftRail()) {
      removeCloseButtons();
      return;
    }
    var root = findVisibleSectionRoot();
    if (!root) return;
    ensureTopCloseButton(root);
    ensureBottomCloseButton(root);
    scrollOpenedSectionToStartOnce();
  }

  function getTopbarStackOffsetPx() {
    try {
      var cs = getComputedStyle(document.documentElement);
      var v = parseFloat(cs.getPropertyValue("--topbarStackH"));
      if (Number.isFinite(v) && v > 0) return v;
    } catch (_) {}
    return 68;
  }

  function getSectionScrollAnchorEl() {
    var root = findVisibleSectionRoot();
    if (!root) return null;
    try {
      var fst = getComputedStyle(root);
      if (fst.display === "none" || fst.visibility === "hidden") return null;
    } catch (_) {}
    var header = findSectionHeader(root);
    if (header) {
      try {
        var hr = header.getBoundingClientRect();
        if (hr.height > 0 && hr.bottom > 0) return header;
      } catch (_) {}
    }
    var closeTop = root.querySelector('[data-iu-desktop-section-close="top"]');
    if (closeTop) {
      try {
        var cr = closeTop.getBoundingClientRect();
        if (cr.height > 0 && cr.bottom > 0) return closeTop;
      } catch (_) {}
    }
    var bar = root.querySelector(".iuDesktopSectionCloseBar");
    if (bar) {
      try {
        var br = bar.getBoundingClientRect();
        if (br.height > 0 && br.bottom > 0) return bar;
      } catch (_) {}
    }
    return null;
  }

  function shouldScrollOpenedSectionToStart() {
    if (!isDesktop() || !sectionOpenFromLeftRail()) return false;
    try {
      if (window.__iuDesktopSectionCloseRestoring) return false;
      if (window.__iuScrollRestorePendingNav) return false;
    } catch (_) {}
    return true;
  }

  function scrollOpenedSectionToStartOnce() {
    if (!shouldScrollOpenedSectionToStart()) return false;
    var anchor = getSectionScrollAnchorEl();
    if (!anchor) return false;
    try {
      if (typeof window.iuDesktopHomeSectionTopGapSync === "function") {
        window.iuDesktopHomeSectionTopGapSync();
      }
    } catch (_) {}
    try {
      var sticky = getTopbarStackOffsetPx();
      var rect = anchor.getBoundingClientRect();
      var current = getScrollY();
      var target = Math.max(0, Math.round(rect.top + current - sticky));
      if (typeof window.iuSetMainScrollTop === "function") {
        window.iuSetMainScrollTop(target);
      } else {
        window.scrollTo(0, target);
        try {
          document.documentElement.scrollTop = target;
          if (document.body) document.body.scrollTop = target;
        } catch (_) {}
      }
      return true;
    } catch (_) {}
    return false;
  }

  function scheduleScrollOpenedSectionToStart() {
    if (!shouldScrollOpenedSectionToStart()) return;
    var left = 72;
    var step = function () {
      if (!shouldScrollOpenedSectionToStart()) return;
      if (scrollOpenedSectionToStartOnce()) return;
      left -= 1;
      if (left > 0) {
        try {
          requestAnimationFrame(step);
        } catch (_) {}
      }
    };
    scrollOpenedSectionToStartOnce();
    try {
      requestAnimationFrame(step);
    } catch (_) {
      scrollOpenedSectionToStartOnce();
    }
    try {
      setTimeout(scrollOpenedSectionToStartOnce, 0);
      setTimeout(scrollOpenedSectionToStartOnce, 120);
      setTimeout(scrollOpenedSectionToStartOnce, 500);
      setTimeout(scrollOpenedSectionToStartOnce, 900);
      setTimeout(scrollOpenedSectionToStartOnce, 1400);
      setTimeout(scrollOpenedSectionToStartOnce, 2200);
      setTimeout(scrollOpenedSectionToStartOnce, 3500);
    } catch (_) {}
  }

  function scheduleEnsureCloseButtons() {
    ensureCloseButtons();
    scheduleScrollOpenedSectionToStart();
    try {
      requestAnimationFrame(ensureCloseButtons);
    } catch (_) {
      ensureCloseButtons();
    }
    try {
      setTimeout(ensureCloseButtons, 0);
      setTimeout(ensureCloseButtons, 120);
      setTimeout(ensureCloseButtons, 500);
    } catch (_) {}
  }

  function closeDesktopSection() {
    if (!isDesktop()) return;
    var snap = window.__iuDesktopSectionCloseSnap;
    if (!snap || !snap.href) return;
    window.__iuDesktopSectionCloseSnap = null;
    removeCloseButtons();
    cancelRestore();
    try {
      if (typeof window.iuDesktopSectionCloseApply === "function") {
        window.iuDesktopSectionCloseApply(snap);
      }
    } catch (_) {}
  }

  function getSavedHomeScrollY() {
    try {
      var raw = sessionStorage.getItem("iu:scrollRestoreMapV1");
      var m = raw ? JSON.parse(raw) : null;
      var home = m && m.home;
      if (home && Number.isFinite(Number(home.y))) {
        return Math.max(0, Math.round(Number(home.y)));
      }
    } catch (_) {}
    return getScrollY();
  }

  function getSavedHomeFeedPage() {
    var page = getFeedPage();
    try {
      var raw = sessionStorage.getItem("iu:scrollRestoreMapV1");
      var m = raw ? JSON.parse(raw) : null;
      var home = m && m.home;
      if (home && Number(home.p) > 1) page = Number(home.p);
    } catch (_) {}
    return page;
  }

  window.iuDesktopSectionCloseBeforeOpen = function (item) {
    if (!isDesktop()) return;
    var scrollY = getSavedHomeScrollY();
    var page = getSavedHomeFeedPage();
    var href = String(location.href || "");
    try {
      if (
        preClickCapture &&
        Date.now() - preClickCapture.t < 1200 &&
        preClickCapture.key === navKeyFromItem(item) &&
        Number(preClickCapture.scrollY) > Number(scrollY)
      ) {
        scrollY = preClickCapture.scrollY;
        page = preClickCapture.page;
        href = preClickCapture.href;
      }
    } catch (_) {}
    preClickCapture = null;
    window.__iuDesktopSectionCloseSnap = {
      scrollY: scrollY,
      page: page,
      href: href,
      openKey: navKeyFromItem(item),
    };
  };

  window.iuDesktopSectionCloseHandleNavClick = function (item, e) {
    if (!isDesktop() || !item) return false;
    if (!sectionOpenFromLeftRail()) return false;
    if (!item.classList.contains("is-active")) return false;
    if (normalizeNavKey(navKeyFromItem(item)) !== currentNavKeyFromUrl()) return false;
    try {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      if (e && typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    } catch (_) {}
    closeDesktopSection();
    return true;
  };

  window.iuDesktopSectionCloseAfterOpen = function () {
    if (!isDesktop()) return;
    try {
      var sec = String((document.body && document.body.dataset.section) || "")
        .trim()
        .toLowerCase();
      if (
        window.__iuSectionViewsLazyMount &&
        typeof window.__iuSectionViewsLazyMount.ensure === "function" &&
        sec
      ) {
        window.__iuSectionViewsLazyMount.ensure(sec);
      }
    } catch (_) {}
    scheduleEnsureCloseButtons();
  };

  window.iuDesktopSectionCloseOnSectionClosed = function () {
    removeCloseButtons();
    window.__iuDesktopSectionCloseSnap = null;
    cancelRestore();
  };

  try {
    document.addEventListener(
      "pointerdown",
      function (e) {
        if (!isDesktop()) return;
        var item =
          e.target && e.target.closest
            ? e.target.closest("#iuLeftRail .iu-leftNavItem")
            : null;
        if (!item) return;
        preClickCapture = {
          t: Date.now(),
          key: navKeyFromItem(item),
          scrollY: getScrollY(),
          page: getFeedPage(),
          href: String(location.href || ""),
        };
      },
      true
    );
  } catch (_) {}

  try {
    document.addEventListener(
      "pointerdown",
      function (e) {
        if (!isDesktop()) return;
        var btn =
          e.target && e.target.closest
            ? e.target.closest("[data-iu-desktop-section-close]")
            : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        closeDesktopSection();
      },
      true
    );
  } catch (_) {}

  try {
    document.addEventListener(
      "click",
      function (e) {
        if (!isDesktop()) return;
        var btn =
          e.target && e.target.closest
            ? e.target.closest("[data-iu-desktop-section-close]")
            : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      },
      true
    );
  } catch (_) {}

  try {
    document.addEventListener("iu:section-view-mounted", function () {
      scheduleEnsureCloseButtons();
      scheduleScrollOpenedSectionToStart();
    });
  } catch (_) {}

  try {
    var feedEl = document.getElementById("feed");
    if (feedEl && !feedEl.__iuDesktopCloseObs) {
      feedEl.__iuDesktopCloseObs = true;
      new MutationObserver(function () {
        if (!isDesktop()) return;
        if (feedEl.getAttribute("data-feed-ready") === "true") {
          scheduleEnsureCloseButtons();
          scheduleScrollOpenedSectionToStart();
        }
      }).observe(feedEl, { attributes: true, attributeFilter: ["data-feed-ready", "hidden"] });
    }
  } catch (_) {}

  try {
    window.iuDesktopSectionCloseScrollToSectionStart = scheduleScrollOpenedSectionToStart;
  } catch (_) {}

  try {
    window.addEventListener("resize", function () {
      if (!isDesktop()) removeCloseButtons();
    });
  } catch (_) {}
})();
