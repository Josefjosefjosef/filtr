/**
 * infoUzel.cz — safe parcel carrier detection + official destination planning (no scraping).
 * Silver-ready: pure functions on window.IU_PARCEL_TRACKING_ENGINE
 */
(function (global) {
  "use strict";

  var IU_TRACKING_SHIPMENT_STATUS = {
    unknown: "unknown",
    created: "created",
    in_transit: "in_transit",
    out_for_delivery: "out_for_delivery",
    ready_for_pickup: "ready_for_pickup",
    delivered: "delivered",
    delivery_issue: "delivery_issue",
    returned: "returned",
  };

  function stripInnerSpaces(s) {
    return String(s || "").replace(/\s+/g, "");
  }

  function normalizeTrackingIntent(raw) {
    var t = String(raw || "").trim();
    var collapsed = stripInnerSpaces(t).toUpperCase();
    return { rawTrimmed: t, collapsed: collapsed, forDetection: collapsed };
  }

  /**
   * Silver / shared UI: format-only gate (does not judge carrier match).
   * Allowed: A–Z, 0–9, ASCII hyphen after trim + inner space collapse.
   */
  function validateTrackingNumberFormat(raw) {
    var norm = normalizeTrackingIntent(raw);
    var c = norm.forDetection;
    if (!c) {
      return { ok: false, reason: "empty", collapsed: "", display: "" };
    }
    if (c.length > 64) {
      return { ok: false, reason: "too_long", collapsed: c, display: norm.collapsed };
    }
    if (!/^[A-Z0-9\-]+$/.test(c)) {
      return { ok: false, reason: "bad_chars", collapsed: c, display: norm.collapsed };
    }
    return { ok: true, reason: "", collapsed: c, display: norm.collapsed };
  }

  function isUpuLikeCzechPost(t) {
    return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(t) || /^[A-Z]{2}\d{10}[A-Z]{2}$/.test(t);
  }

  function baseResult(partial) {
    return {
      state: partial.state,
      carrierKey: partial.carrierKey || "",
      carrierLabel: partial.carrierLabel || "",
      confidence: typeof partial.confidence === "number" ? partial.confidence : 0,
      reason: partial.reason || "",
      requiresPostalCode: !!partial.requiresPostalCode,
      normalizedTrackingNumber: partial.normalizedTrackingNumber || "",
      destinationType: partial.destinationType || "manual_choice",
    };
  }

  /**
   * @param {string} trackingNumber
   * @param {string} [extraInput] postal / ZIP digits for GLS
   * @param {string} [carrierHint] when user picked a carrier manually (e.g. gls)
   */
  function getCarrierDetectionResult(trackingNumber, extraInput, carrierHint) {
    var norm = normalizeTrackingIntent(trackingNumber);
    var c = norm.forDetection;
    var hint = String(carrierHint || "")
      .trim()
      .toLowerCase();
    var postalDigits = String(extraInput || "").replace(/\D/g, "");

    if (!c) {
      return baseResult({
        state: "no_safe_match",
        reason: "Zadejte číslo zásilky.",
        destinationType: "manual_choice",
      });
    }

    if (c.length > 64) {
      return baseResult({
        state: "unsupported",
        reason: "Vstup je příliš dlouhý.",
        destinationType: "manual_choice",
      });
    }

    if (hint === "gls") {
      if (!postalDigits || postalDigits.length < 4) {
        return baseResult({
          state: "needs_extra_input",
          carrierKey: "gls",
          carrierLabel: "GLS",
          confidence: 0.55,
          reason:
            "GLS vyžaduje k veřejnému sledování číslo balíku a PSČ doručovací adresy nebo výdejního místa (ochrana osobních údajů).",
          requiresPostalCode: true,
          normalizedTrackingNumber: c,
          destinationType: "official_public_tracking_with_extra_input",
        });
      }
      return baseResult({
        state: "exact_match",
        carrierKey: "gls",
        carrierLabel: "GLS",
        confidence: 0.7,
        reason: "Ruční výběr GLS; PSČ doplněno — pokračujte na oficiální stránku GLS.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking_with_extra_input",
      });
    }

    if (/^Z\d{5,}$/.test(c)) {
      return baseResult({
        state: "exact_match",
        carrierKey: "packeta",
        carrierLabel: "Zásilkovna (Packeta)",
        confidence: 0.94,
        reason:
          "Číslo začíná písmenem Z a obsahuje číslice — typický formát veřejného sledování Zásilkovny.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking",
      });
    }

    if (/^\d{11}$/.test(c)) {
      return baseResult({
        state: "probable_match",
        carrierKey: "ppl",
        carrierLabel: "PPL",
        confidence: 0.78,
        reason:
          "Jedná se o 11 číslic — odpovídá často uváděnému formátu zásilky PPL; při nejistotě použijte ruční výběr.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking",
      });
    }

    if (/^[A-Z0-9]{14}$/.test(c)) {
      return baseResult({
        state: "probable_match",
        carrierKey: "dpd",
        carrierLabel: "DPD",
        confidence: 0.68,
        reason:
          "14 znaků (písmena a číslice) — často uváděný standard DPD; u jiného dopravce zvolte ruční výběr.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking",
      });
    }

    if (isUpuLikeCzechPost(c)) {
      return baseResult({
        state: "probable_match",
        carrierKey: "balikovna",
        carrierLabel: "Balíkovna / Česká pošta",
        confidence: 0.82,
        reason:
          "Formát připomíná podací číslo (předpona + číslice + přípona). Pokračujte na oficiální Track & Trace — data neukládáme.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking",
      });
    }

    return baseResult({
      state: "no_safe_match",
      reason:
        "Dopravce nešlo bezpečně určit podle čísla. Vyberte dopravce ručně níže — u GLS doplňte PSČ.",
      destinationType: "manual_choice",
    });
  }

  function detectCarrier(trackingNumber, extraInput, carrierHint) {
    var r = getCarrierDetectionResult(trackingNumber, extraInput, carrierHint);
    return r.carrierKey || null;
  }

  /**
   * @param {object} detection — from getCarrierDetectionResult
   * @param {string} [postalDigits] for GLS clipboard helper
   */
  function buildTrackingDestination(detection, postalDigits) {
    if (!detection || !detection.carrierKey || detection.state === "no_safe_match") {
      return {
        action: "none",
        lastPublicSourceKind: "none",
        lastOfficialUrl: "",
      };
    }
    if (detection.state === "needs_extra_input") {
      return {
        action: "need_input",
        fields: ["postalCode"],
        lastPublicSourceKind: "official_web",
        lastOfficialUrl: "https://gls-group.com/CZ/cs/sledovani-zasilek",
      };
    }

    var code = detection.normalizedTrackingNumber || "";
    var key = detection.carrierKey;
    var psc = String(postalDigits || "").replace(/\D/g, "");

    if (key === "packeta") {
      var u =
        "https://tracking.app.packeta.com/cs/" + encodeURIComponent(code);
      return {
        action: "open_url",
        url: u,
        lastPublicSourceKind: "official_web",
        lastOfficialUrl: u,
      };
    }
    if (key === "balikovna") {
      var bu =
        "https://www.balikovna.cz/cs/sledovat-balik/-/balik/" +
        encodeURIComponent(code);
      return {
        action: "open_url",
        url: bu,
        lastPublicSourceKind: "official_web",
        lastOfficialUrl: bu,
      };
    }
    if (key === "dpd") {
      var du =
        "https://tracking.dpd.de/status/cs_CZ/parcel/" +
        encodeURIComponent(code);
      return {
        action: "open_url",
        url: du,
        lastPublicSourceKind: "official_web",
        lastOfficialUrl: du,
      };
    }
    if (key === "ppl") {
      return {
        action: "open_base_clipboard",
        url: "https://www.ppl.cz/vyhledat-zasilku",
        clipPlain: code,
        lastPublicSourceKind: "official_web",
        lastOfficialUrl: "https://www.ppl.cz/vyhledat-zasilku",
      };
    }
    if (key === "gls") {
      var clip = code;
      if (psc.length >= 4) clip = code + "\nPSČ: " + psc;
      return {
        action: "open_base_clipboard",
        url: "https://gls-group.com/CZ/cs/sledovani-zasilek",
        clipPlain: clip,
        lastPublicSourceKind: "official_web",
        lastOfficialUrl: "https://gls-group.com/CZ/cs/sledovani-zasilek",
      };
    }

    return {
      action: "none",
      lastPublicSourceKind: "none",
      lastOfficialUrl: "",
    };
  }

  global.IU_PARCEL_TRACKING_ENGINE = {
    IU_TRACKING_SHIPMENT_STATUS: IU_TRACKING_SHIPMENT_STATUS,
    normalizeTrackingIntent: normalizeTrackingIntent,
    validateTrackingNumberFormat: validateTrackingNumberFormat,
    detectCarrier: detectCarrier,
    getCarrierDetectionResult: getCarrierDetectionResult,
    buildTrackingDestination: buildTrackingDestination,
  };
})(typeof window !== "undefined" ? window : this);
