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

  /** Shared labels + manual-hint routing (MindMenu + Silver use the same engine). */
  var CARRIER_CATALOG = {
    packeta: { label: "Zásilkovna (Packeta)" },
    balikovna: { label: "Balíkovna / Česká pošta" },
    ppl: { label: "PPL" },
    dpd: { label: "DPD" },
    gls: { label: "GLS" },
    wedo: { label: "WE|DO" },
    dhl: { label: "DHL" },
    messenger: { label: "Messenger" },
  };

  /**
   * Prefixy podacích čísel České pošty / Balíkovny (Track & Trace na balikovna.cz).
   * @see https://www.ceskaposta.cz/rady-a-navody/seznam-druhu-zasilek-s-moznosti-sledovani-v-rezimu-track-trace
   */
  var CZ_POST_TRACKABLE_PREFIXES = {
    DR: 1,
    DE: 1,
    DV: 1,
    NB: 1,
    NR: 1,
    ND: 1,
    RR: 1,
    BA: 1,
    EE: 1,
    EM: 1,
    BN: 1,
    BB: 1,
    BD: 1,
    BX: 1,
    BE: 1,
    CP: 1,
    CS: 1,
    CV: 1,
    NP: 1,
    NV: 1,
    NA: 1,
    VL: 1,
    VV: 1,
    VD: 1,
    VX: 1,
    LA: 1,
    LB: 1,
    LC: 1,
    LD: 1,
    LE: 1,
    LF: 1,
    LG: 1,
    LH: 1,
    LI: 1,
    LJ: 1,
    LK: 1,
    LL: 1,
    LM: 1,
    LN: 1,
    LO: 1,
    LP: 1,
    LQ: 1,
    LR: 1,
    LS: 1,
    LT: 1,
    LU: 1,
    LV: 1,
    LW: 1,
    LX: 1,
    LY: 1,
    LZ: 1,
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

  /**
   * Domácí podací číslo ČP/Balíkovny: prefix + 9–10 číslic + suffix (1–2 znaky).
   * Příklad produkční chyby: DR6081444491U (suffix U, ne CZ).
   */
  function isDomesticCzechPostConsignment(t) {
    var m = /^([A-Z]{2})(\d{9,10})([A-Z0-9]{1,2})$/.exec(t);
    if (!m) return false;
    return !!CZ_POST_TRACKABLE_PREFIXES[m[1]];
  }

  function isBalikovnaCzechPostConsignment(t) {
    return isUpuLikeCzechPost(t) || isDomesticCzechPostConsignment(t);
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

  function resultFromManualHint(hint, c, postalDigits) {
    var meta = CARRIER_CATALOG[hint];
    if (!meta) return null;

    if (hint === "gls") {
      if (!postalDigits || postalDigits.length < 4) {
        return baseResult({
          state: "needs_extra_input",
          carrierKey: "gls",
          carrierLabel: meta.label,
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
        carrierLabel: meta.label,
        confidence: 0.85,
        reason: "Ruční výběr GLS; PSČ doplněno — pokračujte na oficiální stránku GLS.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking_with_extra_input",
      });
    }

    return baseResult({
      state: "exact_match",
      carrierKey: hint,
      carrierLabel: meta.label,
      confidence: 0.9,
      reason:
        "Ruční výběr dopravce „" +
        meta.label +
        "“ — pokračujte na oficiální veřejné sledování.",
      requiresPostalCode: false,
      normalizedTrackingNumber: c,
      destinationType: "official_public_tracking",
    });
  }

  function isRecognizedDetectionState(state) {
    return (
      state === "exact_match" ||
      state === "probable_match" ||
      state === "needs_extra_input"
    );
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

    if (hint && CARRIER_CATALOG[hint]) {
      var manual = resultFromManualHint(hint, c, postalDigits);
      if (manual) return manual;
    }

    if (/^Z\d{5,}$/.test(c)) {
      return baseResult({
        state: "exact_match",
        carrierKey: "packeta",
        carrierLabel: CARRIER_CATALOG.packeta.label,
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
        carrierLabel: CARRIER_CATALOG.ppl.label,
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
        carrierLabel: CARRIER_CATALOG.dpd.label,
        confidence: 0.68,
        reason:
          "14 znaků (písmena a číslice) — často uváděný standard DPD; u jiného dopravce zvolte ruční výběr.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking",
      });
    }

    if (/^JJD\d{14,}$/.test(c) || /^00\d{16,}$/.test(c) || /^\d{10}$/.test(c)) {
      return baseResult({
        state: "probable_match",
        carrierKey: "dhl",
        carrierLabel: CARRIER_CATALOG.dhl.label,
        confidence: 0.72,
        reason:
          "Formát odpovídá běžnému číslu zásilky DHL; při nejistotě zvolte ruční výběr dopravce.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking",
      });
    }

    if (isBalikovnaCzechPostConsignment(c)) {
      return baseResult({
        state: "probable_match",
        carrierKey: "balikovna",
        carrierLabel: CARRIER_CATALOG.balikovna.label,
        confidence: 0.86,
        reason:
          "Formát odpovídá podacímu číslu České pošty / Balíkovny (prefix + číslice + suffix). Pokračujte na oficiální Track & Trace.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking",
      });
    }

    if (/^\d{8,9}$/.test(c)) {
      return baseResult({
        state: "probable_match",
        carrierKey: "wedo",
        carrierLabel: CARRIER_CATALOG.wedo.label,
        confidence: 0.62,
        reason:
          "8–9 číslic — může odpovídat formátu WE|DO; při nejistotě zvolte ruční výběr dopravce.",
        requiresPostalCode: false,
        normalizedTrackingNumber: c,
        destinationType: "official_public_tracking",
      });
    }

    if (/^[A-Z]{2,4}\d{6,12}$/.test(c)) {
      return baseResult({
        state: "probable_match",
        carrierKey: "messenger",
        carrierLabel: CARRIER_CATALOG.messenger.label,
        confidence: 0.55,
        reason:
          "Formát může odpovídat Messenger; při nejistotě zvolte ruční výběr dopravce.",
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
    if (key === "wedo") {
      var wu = "https://trace.wedo.cz/?orderNumber=" + encodeURIComponent(code);
      return {
        action: "open_url",
        url: wu,
        lastPublicSourceKind: "official_web",
        lastOfficialUrl: wu,
      };
    }
    if (key === "dhl") {
      return {
        action: "open_base_clipboard",
        url: "https://www.dhl.com/cz-en/home/tracking.html",
        clipPlain: code,
        lastPublicSourceKind: "official_web",
        lastOfficialUrl: "https://www.dhl.com/cz-en/home/tracking.html",
      };
    }
    if (key === "messenger") {
      return {
        action: "open_base_clipboard",
        url: "https://www.msng.cz/",
        clipPlain: code,
        lastPublicSourceKind: "official_web",
        lastOfficialUrl: "https://www.msng.cz/",
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
    CARRIER_CATALOG: CARRIER_CATALOG,
    normalizeTrackingIntent: normalizeTrackingIntent,
    validateTrackingNumberFormat: validateTrackingNumberFormat,
    isBalikovnaCzechPostConsignment: isBalikovnaCzechPostConsignment,
    isRecognizedDetectionState: isRecognizedDetectionState,
    detectCarrier: detectCarrier,
    getCarrierDetectionResult: getCarrierDetectionResult,
    buildTrackingDestination: buildTrackingDestination,
  };
})(typeof window !== "undefined" ? window : this);
