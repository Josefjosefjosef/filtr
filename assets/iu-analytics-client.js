/**
 * InfoUzel Analytics client — consent-gated, allowlisted events only.
 * Never sends IP, fingerprint, full UA, free-text, or private module content.
 */
(function iuAnalyticsClient() {
  "use strict";

  var ENDPOINT =
    (typeof window !== "undefined" && window.__IU_ANALYTICS_ENDPOINT__) ||
    "https://infouzel-analytics.josef-zmrhal.workers.dev/v1/ingest";

  var queue = [];
  var flushTimer = null;
  var active = false;
  var pageViewSent = false;
  var techErrorSent = false;

  function granted() {
    try {
      return !!(window.iuConsent && window.iuConsent.isAnalyticsGranted && window.iuConsent.isAnalyticsGranted());
    } catch (_) {
      return false;
    }
  }

  function deviceCategory() {
    try {
      var w = window.innerWidth || 0;
      if (w > 0 && w < 768) return "mobile";
      if (w >= 768 && w <= 1024) return "tablet";
      if (w > 1024) return "pc";
    } catch (_) {}
    return "unknown";
  }

  function sanitizeId(v) {
    var s = String(v || "").trim();
    if (!/^[a-zA-Z0-9_.:\-]{1,64}$/.test(s)) return "";
    return s;
  }

  function track(type, fields) {
    if (!active || !granted()) return false;
    var ev = { type: String(type || ""), device_category: deviceCategory() };
    fields = fields || {};
    if (fields.section_id) ev.section_id = sanitizeId(fields.section_id);
    if (fields.campaign_id) ev.campaign_id = sanitizeId(fields.campaign_id);
    if (fields.placement_id) ev.placement_id = sanitizeId(fields.placement_id);
    if (fields.slot_type) ev.slot_type = sanitizeId(fields.slot_type) || "unknown";
    if (fields.metric_name) ev.metric_name = sanitizeId(fields.metric_name);
    if (fields.metric_value != null && isFinite(Number(fields.metric_value))) {
      ev.metric_value = Number(fields.metric_value);
    }
    if (fields.error_code) ev.error_code = sanitizeId(fields.error_code) || "unknown";

    // Hard block accidental PII keys from callers
    var blocked = ["ip", "fingerprint", "user_agent", "email", "payload", "text", "content", "query"];
    for (var i = 0; i < blocked.length; i++) {
      if (Object.prototype.hasOwnProperty.call(fields, blocked[i])) return false;
    }

    queue.push(ev);
    if (queue.length >= 8) flush();
    else scheduleFlush();
    return true;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flush();
    }, 1500);
  }

  function flush() {
    if (!active || !granted() || !queue.length) {
      queue = [];
      return;
    }
    var batch = queue.splice(0, 20);
    try {
      var body = JSON.stringify({ events: batch });
      // sendBeacon may exist but return false (quota / blocked / stub) — always fall back to fetch.
      var sent = false;
      if (typeof navigator.sendBeacon === "function") {
        try {
          var blob = new Blob([body], { type: "application/json" });
          sent = !!navigator.sendBeacon(ENDPOINT, blob);
        } catch (_) {
          sent = false;
        }
      }
      if (!sent) {
        fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body,
          mode: "cors",
          keepalive: true,
          credentials: "omit",
        }).catch(function () {});
      }
    } catch (_) {}
  }

  function sectionFromLocation() {
    try {
      var u = new URL(location.href);
      var sec = u.searchParams.get("section") || "";
      if (sec) return sanitizeId(sec) || "home";
      var path = (u.pathname || "").replace(/\/+$/, "");
      if (/\/projects\/statistiky/i.test(path)) return "statistiky";
      if (/\/projects\/zdroje-a-licence/i.test(path)) return "zdroje-a-licence";
      if (/\/projects\/?$/i.test(path) || path === "" || path === "/") return "home";
      return "public";
    } catch (_) {
      return "home";
    }
  }

  function sendPageViewOnce() {
    if (pageViewSent) return;
    pageViewSent = true;
    track("page_view", { section_id: sectionFromLocation() });
    track("public_section_view", { section_id: sectionFromLocation() });
  }

  function maybePerf() {
    try {
      if (!window.performance || !performance.getEntriesByType) return;
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav && typeof nav.duration === "number") {
        track("performance_metric", {
          metric_name: "navigation_duration_ms",
          metric_value: Math.min(60000, Math.max(0, Math.round(nav.duration))),
        });
      }
    } catch (_) {}
  }

  function maybeTechErrorHook() {
    if (window.__IU_ANALYTICS_ERR_HOOK__) return;
    window.__IU_ANALYTICS_ERR_HOOK__ = true;
    window.addEventListener("error", function () {
      if (techErrorSent || !active || !granted()) return;
      techErrorSent = true;
      track("technical_error", { error_code: "client_js_error" });
    });
  }

  function init() {
    if (!granted()) {
      active = false;
      window.__IU_ANALYTICS_ACTIVE__ = false;
      queue = [];
      return;
    }
    active = true;
    window.__IU_ANALYTICS_ACTIVE__ = true;
    sendPageViewOnce();
    maybeTechErrorHook();
    setTimeout(maybePerf, 2500);
  }

  function teardown() {
    active = false;
    pageViewSent = false;
    queue = [];
    window.__IU_ANALYTICS_ACTIVE__ = false;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  /** Public API for dynamic ads (future placements) — aggregate only. */
  window.iuAnalytics = {
    track: track,
    flush: flush,
    impression: function (campaignId, placementId, opts) {
      opts = opts || {};
      return track("ad_impression", {
        campaign_id: campaignId,
        placement_id: placementId,
        section_id: opts.section_id || sectionFromLocation(),
        slot_type: opts.slot_type || "unknown",
      });
    },
    click: function (campaignId, placementId, opts) {
      opts = opts || {};
      return track("ad_click", {
        campaign_id: campaignId,
        placement_id: placementId,
        section_id: opts.section_id || sectionFromLocation(),
        slot_type: opts.slot_type || "unknown",
      });
    },
    privateToolsOpen: function () {
      return track("private_tools_total_open", {});
    },
    isActive: function () {
      return !!(active && granted());
    },
  };

  // Replace consent stubs
  var prevInit = window.iuAnalyticsInit;
  var prevTeardown = window.iuAnalyticsTeardown;
  window.iuAnalyticsInit = function () {
    if (typeof prevInit === "function") {
      try {
        /* keep consent bookkeeping */
      } catch (_) {}
    }
    init();
  };
  window.iuAnalyticsTeardown = function () {
    teardown();
    if (typeof prevTeardown === "function") {
      try {
        /* noop */
      } catch (_) {}
    }
  };

  window.addEventListener("iu:consent-change", function (e) {
    try {
      if (e && e.detail && e.detail.analytics === "granted") init();
      else teardown();
    } catch (_) {
      teardown();
    }
  });

  window.addEventListener("pagehide", function () {
    flush();
  });

  if (granted()) init();
})();
