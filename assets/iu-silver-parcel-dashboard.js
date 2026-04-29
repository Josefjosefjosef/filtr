/**
 * Silver-only dashboard: localStorage + IU_SILVER_PARCEL_FACADE / IU_PARCEL_TRACKING_ENGINE.
 * Does not open MindMenu parcels overlay; does not duplicate carrier URL logic.
 */

/**
 * Parse optional user-pasted SMS / note. Conservative: only patterns we recognize;
 * never invent data. Used only for local display on the Silver parcel card.
 * @param {string} text
 * @returns {{ version: number, statusHeadline: string|null, password: string|null, openingHours: string|null, addressLine: string|null, addressDisplay: string|null, hasStructured: boolean }}
 */
function iuParseParcelUserDetail(text) {
  var t = String(text || "").trim();
  var base = {
    version: 1,
    statusHeadline: null,
    password: null,
    openingHours: null,
    addressLine: null,
    addressDisplay: null,
    hasStructured: false,
  };
  if (!t) return base;
  if (
    /\bk\s+vydeji\b/i.test(t) ||
    /\bk\s+výdeji\b/i.test(t) ||
    /\bk\s+vyzvednut(i|í)\b/i.test(t)
  ) {
    base.statusHeadline = "Připraveno k vyzvednutí";
  }
  var hp = t.match(/\bHeslo\s+(\d{4,10})\b/i);
  if (hp) base.password = hp[1];
  var op = t.match(/\bPo[-–]Ne\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
  if (op) {
    base.openingHours = "Po–Ne " + op[1] + "–" + op[2];
  }
  var ap = t.match(/(?:Cerpaci|Čerpací)\s+stanic[ei]\s+([^.\n\r]+)/i);
  if (ap) {
    var body = String(ap[1] || "").trim();
    if (body) {
      base.addressLine = body;
      base.addressDisplay = "Čerpací stanice " + body;
    }
  }
  base.hasStructured = !!(
    base.statusHeadline ||
    base.password ||
    base.openingHours ||
    base.addressLine
  );
  return base;
}

try {
  globalThis.iuParseParcelUserDetail = iuParseParcelUserDetail;
} catch (_) {}

(function () {
  "use strict";

  var LS_KEY = "iu_silver_parcel_watch_v1";
  var MAX = 10;
  var detailEditId = null;
  var ERR_FORMAT =
    "Neplatný formát čísla zásilky. Zkontroluj číslo a zkus to znovu.";
  var ERR_LIMIT = "Limit 10 zásilek dosažen. Nejdřív jednu zásilku odeber.";
  var ERR_DUP = "Toto číslo už v seznamu máš.";

  var root = document.getElementById("iuSilverParcelWatch");
  var inp = document.getElementById("iuSilverParcelWatchInput");
  var btnSave = document.getElementById("iuSilverParcelWatchSave");
  var errEl = document.getElementById("iuSilverParcelWatchErr");
  var listEl = document.getElementById("iuSilverParcelWatchList");
  var showAllBtn = document.getElementById("iuSilverParcelWatchShowAll");
  var completedEl = document.getElementById("iuSilverParcelWatchCompleted");

  var showAll = false;

  function uid() {
    return (
      "p" +
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
        : String(Date.now()) + Math.random().toString(16).slice(2))
    );
  }

  function readList() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      var j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }

  function writeList(arr) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
    } catch (_) {}
  }

  function clearErr() {
    if (!errEl) return;
    errEl.textContent = "";
    errEl.hidden = true;
  }

  function setErr(msg) {
    if (!errEl) return;
    errEl.textContent = msg || "";
    errEl.hidden = !msg;
  }

  function formatLastCheck(ts) {
    if (!ts) return "zatím neověřeno";
    var d = new Date(ts);
    var now = new Date();
    var sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    var pad = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    var t = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (sameDay) return "dnes " + t;
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + ". " + t;
  }

  function resolveEngine(item) {
    var fac = window.IU_SILVER_PARCEL_FACADE;
    if (!fac || typeof fac.iuSilverParcelEngineResolve !== "function") {
      return { detection: null, destination: null };
    }
    var r = fac.iuSilverParcelEngineResolve({
      trackingNumber: item.number,
      postalCode: item.postalDigits || "",
      carrierHint: item.carrierHint || "",
    });
    if (!r || !r.ok) return { detection: null, destination: null };
    return { detection: r.detection, destination: r.destination };
  }

  function deriveUiState(det, item) {
    if (item && item.lastCheckedAt == null) {
      return {
        carrierLabel: "zatím nepoznán",
        statusLabel: "ověřuji…",
      };
    }
    if (!det) {
      return {
        carrierLabel: "zatím nepoznán",
        statusLabel: "uloženo bez ověření",
      };
    }
    if (det.state === "no_safe_match" || det.state === "unsupported") {
      return {
        carrierLabel: "zatím nepoznán",
        statusLabel: "uloženo bez ověření",
      };
    }
    if (det.state === "needs_extra_input") {
      return {
        carrierLabel: det.carrierLabel || "zatím nepoznán",
        statusLabel: "uloženo bez ověření",
      };
    }
    if (det.state === "exact_match" || det.state === "probable_match") {
      return {
        carrierLabel: det.carrierLabel || "zatím nepoznán",
        statusLabel: "Klikni pro aktuální stav zásilky",
      };
    }
    return {
      carrierLabel: det.carrierLabel || "zatím nepoznán",
      statusLabel: "uloženo bez ověření",
    };
  }

  function applyPurgeRules(items) {
    var now = Date.now();
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.purgeAfterAt && now > it.purgeAfterAt) continue;
      out.push(it);
    }
    if (out.length !== items.length) writeList(out);
    return out;
  }

  function openOfficialForItem(item) {
    var fac = window.IU_SILVER_PARCEL_FACADE;
    var eng = window.IU_PARCEL_TRACKING_ENGINE;
    if (!fac || !eng || typeof fac.openTrackingDestination !== "function") return;
    var det = eng.getCarrierDetectionResult(
      item.number,
      item.postalDigits || "",
      item.carrierHint || "",
    );
    fac.openTrackingDestination(det, item.postalDigits || "");
  }

  function mapsUrlForQuery(q) {
    return (
      "https://mapy.cz/zakladni?q=" + encodeURIComponent(String(q || "").trim())
    );
  }

  function isMobileTabletDetailUx() {
    try {
      return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 1024px)").matches
      );
    } catch (_) {
      return false;
    }
  }

  function renderCarrierPicker(item, host) {
    var meta = window.IU_MINDMENU_PARCEL_CARRIER_META;
    if (!meta || !host) return;
    host.innerHTML = "";
    var keys = Object.keys(meta).sort();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "iuSilverParcelWatch__chip";
      chip.setAttribute("data-carrier-key", k);
      chip.textContent = meta[k].name || k;
      chip.addEventListener("click", function (ev) {
        var el = ev.currentTarget;
        var key = el ? el.getAttribute("data-carrier-key") : "";
        var list = readList();
        for (var j = 0; j < list.length; j++) {
          if (list[j].id === item.id) {
            list[j].carrierHint = key || "";
            var r = resolveEngine(list[j]);
            list[j].lastCheckedAt = Date.now();
            if (r.detection) list[j].lastDetection = r.detection;
            break;
          }
        }
        writeList(list);
        render();
      });
      host.appendChild(chip);
    }
  }

  function renderDetailSection(item, host, isEditing) {
    host.innerHTML = "";
    var hasStored = item.detailRawText && String(item.detailRawText).trim();
    var parsed =
      item.detailParsed && typeof item.detailParsed === "object"
        ? item.detailParsed
        : null;
    if (!parsed && hasStored) {
      parsed = iuParseParcelUserDetail(String(item.detailRawText));
    }

    if (!hasStored && !isEditing) {
      var addB = document.createElement("button");
      addB.type = "button";
      addB.className = "iuSilverParcelWatch__btnDetailAdd";
      addB.textContent = "➕ Přidat detail";
      addB.addEventListener("click", function () {
        detailEditId = item.id;
        render();
      });
      host.appendChild(addB);
      return;
    }

    if (isEditing) {
      var ta = document.createElement("textarea");
      ta.className = "iuSilverParcelWatch__detailTextarea";
      ta.setAttribute(
        "aria-label",
        "Vlož zprávu od dopravce nebo vlastní poznámku",
      );
      ta.placeholder = "Vlož zprávu od dopravce nebo vlastní poznámku";
      ta.value = item.detailRawText ? String(item.detailRawText) : "";
      var rowBtn = document.createElement("div");
      rowBtn.className = "iuSilverParcelWatch__detailEditActions";
      var saveB = document.createElement("button");
      saveB.type = "button";
      saveB.className =
        "iuSilverParcelWatch__btnSecondary iuSilverParcelWatch__detailSave";
      saveB.textContent = "Uložit";
      var cancelB = document.createElement("button");
      cancelB.type = "button";
      cancelB.className = "iuSilverParcelWatch__btnGhost";
      cancelB.textContent = "Zrušit";

      function syncDetailSaveState() {
        var hasText = String(ta.value || "").trim().length > 0;
        if (isMobileTabletDetailUx()) {
          saveB.disabled = !hasText;
          if (hasText) {
            saveB.classList.add("iuSilverParcelWatch__detailSave--active");
          } else {
            saveB.classList.remove("iuSilverParcelWatch__detailSave--active");
          }
        } else {
          saveB.disabled = false;
          saveB.classList.remove("iuSilverParcelWatch__detailSave--active");
        }
      }
      syncDetailSaveState();
      ta.addEventListener("input", syncDetailSaveState);
      ta.addEventListener("paste", function () {
        setTimeout(syncDetailSaveState, 0);
      });

      saveB.addEventListener("click", function () {
        var raw = String(ta.value || "").trim();
        if (isMobileTabletDetailUx() && !raw.length) {
          return;
        }
        var list = readList();
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === item.id) {
            if (raw) {
              list[i].detailRawText = raw;
              list[i].detailParsed = iuParseParcelUserDetail(raw);
              list[i].detailUpdatedAt = Date.now();
            } else {
              delete list[i].detailRawText;
              delete list[i].detailParsed;
              delete list[i].detailUpdatedAt;
            }
            break;
          }
        }
        writeList(list);
        detailEditId = null;
        render();
      });
      cancelB.addEventListener("click", function () {
        detailEditId = null;
        render();
      });
      rowBtn.appendChild(saveB);
      rowBtn.appendChild(cancelB);
      host.appendChild(ta);
      host.appendChild(rowBtn);
      return;
    }

    var structured = parsed && parsed.hasStructured;
    if (structured) {
      if (parsed.statusHeadline) {
        var d1 = document.createElement("div");
        d1.className = "iuSilverParcelWatch__detailLine";
        d1.textContent = "📦 " + parsed.statusHeadline;
        host.appendChild(d1);
      }
      if (parsed.addressDisplay) {
        var d2 = document.createElement("div");
        d2.className = "iuSilverParcelWatch__detailLine";
        d2.textContent = "📍 " + parsed.addressDisplay;
        host.appendChild(d2);
      }
      if (parsed.password) {
        var d3 = document.createElement("div");
        d3.className = "iuSilverParcelWatch__detailLine";
        d3.textContent = "🔑 Heslo: " + parsed.password;
        host.appendChild(d3);
      }
      if (parsed.openingHours) {
        var d4 = document.createElement("div");
        d4.className = "iuSilverParcelWatch__detailLine";
        d4.textContent = "🕒 " + parsed.openingHours;
        host.appendChild(d4);
      }
      if (parsed.addressLine && String(parsed.addressLine).trim()) {
        var navD = document.createElement("button");
        navD.type = "button";
        navD.className =
          "iuSilverParcelWatch__btnSecondary iuSilverParcelWatch__btnDetailNav iuSilverParcelWatch__btnDetailNav--address";
        navD.textContent = "Navigovat";
        navD.addEventListener("click", function () {
          window.open(
            mapsUrlForQuery(parsed.addressLine),
            "_blank",
            "noopener,noreferrer",
          );
        });
        host.appendChild(navD);
      }
    } else {
      var rawDiv = document.createElement("div");
      rawDiv.className = "iuSilverParcelWatch__detailRaw";
      rawDiv.textContent = String(item.detailRawText || "");
      host.appendChild(rawDiv);
    }

    var editRow = document.createElement("div");
    editRow.className = "iuSilverParcelWatch__detailManage";
    var editB = document.createElement("button");
    editB.type = "button";
    editB.className = "iuSilverParcelWatch__btnDetailLink";
    editB.textContent = "Upravit detail";
    editB.addEventListener("click", function () {
      detailEditId = item.id;
      render();
    });
    var delB = document.createElement("button");
    delB.type = "button";
    delB.className =
      "iuSilverParcelWatch__btnDetailLink iuSilverParcelWatch__btnDetailLink--danger";
    delB.textContent = "Odstranit detail";
    delB.addEventListener("click", function () {
      var list = readList();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === item.id) {
          delete list[i].detailRawText;
          delete list[i].detailParsed;
          delete list[i].detailUpdatedAt;
          break;
        }
      }
      writeList(list);
      if (detailEditId === item.id) detailEditId = null;
      render();
    });
    editRow.appendChild(editB);
    editRow.appendChild(delB);
    host.appendChild(editRow);
  }

  function renderCard(item) {
    var wrap = document.createElement("div");
    wrap.className = "iuSilverParcelWatch__card";
    wrap.setAttribute("data-parcel-id", item.id);

    var r = resolveEngine(item);
    var det = r.detection;
    var ui = deriveUiState(det, item);

    var isCompleted =
      item.terminalVerified === "delivered" ||
      item.terminalVerified === "picked_up";
    if (isCompleted) wrap.classList.add("iuSilverParcelWatch__card--done");

    var title = document.createElement("div");
    title.className = "iuSilverParcelWatch__cardTitle";
    title.textContent = "📦 Zásilka " + item.number;

    var rowCarrier = document.createElement("div");
    rowCarrier.className = "iuSilverParcelWatch__cardRow";
    rowCarrier.textContent = "Dopravce: " + ui.carrierLabel;

    var rowStatus = document.createElement("div");
    rowStatus.className = "iuSilverParcelWatch__cardRow";
    rowStatus.textContent = "Stav: " + ui.statusLabel;

    var rowPick = null;
    if (item.pickupAddressVerified) {
      rowPick = document.createElement("div");
      rowPick.className = "iuSilverParcelWatch__cardRow";
      rowPick.textContent = "Výdejní místo: " + item.pickupAddressVerified;
    }

    var rowTime = document.createElement("div");
    rowTime.className = "iuSilverParcelWatch__cardRow iuSilverParcelWatch__cardRow--muted";
    rowTime.textContent =
      "Poslední ověření: " + formatLastCheck(item.lastCheckedAt);

    wrap.appendChild(title);
    wrap.appendChild(rowCarrier);
    wrap.appendChild(rowStatus);
    if (rowPick) wrap.appendChild(rowPick);
    wrap.appendChild(rowTime);

    if (isCompleted && item.purgeAfterAt) {
      var purge = document.createElement("div");
      purge.className = "iuSilverParcelWatch__purgeNote";
      purge.textContent =
        "Za 2 dny bude automaticky odstraněna.";
      wrap.appendChild(purge);
    }

    var glsRow = null;
    if ((item.carrierHint === "gls" || (det && det.carrierKey === "gls")) && det && det.requiresPostalCode) {
      glsRow = document.createElement("div");
      glsRow.className = "iuSilverParcelWatch__glsRow";
      var glsInp = document.createElement("input");
      glsInp.type = "text";
      glsInp.className = "iuSilverParcelWatch__glsPsc";
      glsInp.setAttribute("inputmode", "numeric");
      glsInp.setAttribute("aria-label", "PSČ pro GLS");
      glsInp.placeholder = "PSČ (GLS)";
      glsInp.value = item.postalDigits || "";
      var glsBtn = document.createElement("button");
      glsBtn.type = "button";
      glsBtn.className = "iuSilverParcelWatch__btnSecondary";
      glsBtn.textContent = "Uložit PSČ";
      glsBtn.addEventListener("click", function () {
        var digits = String(glsInp.value || "").replace(/\D/g, "");
        var list = readList();
        for (var j = 0; j < list.length; j++) {
          if (list[j].id === item.id) {
            list[j].postalDigits = digits;
            list[j].lastCheckedAt = Date.now();
            var rr = resolveEngine(list[j]);
            if (rr.detection) list[j].lastDetection = rr.detection;
            break;
          }
        }
        writeList(list);
        render();
      });
      glsRow.appendChild(glsInp);
      glsRow.appendChild(glsBtn);
      wrap.appendChild(glsRow);
    }

    var detailHost = document.createElement("div");
    detailHost.className = "iuSilverParcelWatch__detailHost";
    renderDetailSection(item, detailHost, detailEditId === item.id);
    wrap.appendChild(detailHost);

    var actions = document.createElement("div");
    actions.className = "iuSilverParcelWatch__actions";

    var openT = document.createElement("button");
    openT.type = "button";
    openT.className = "iuSilverParcelWatch__btnPrimary";
    openT.textContent = "Otevřít tracking";
    openT.addEventListener("click", function () {
      openOfficialForItem(item);
    });
    actions.appendChild(openT);

    if (item.pickupAddressVerified) {
      var nav = document.createElement("button");
      nav.type = "button";
      nav.className = "iuSilverParcelWatch__btnSecondary";
      nav.textContent = "Navigovat";
      nav.addEventListener("click", function () {
        window.open(mapsUrlForQuery(item.pickupAddressVerified), "_blank", "noopener,noreferrer");
      });
      actions.appendChild(nav);
    }

    var carrierUnknown = ui.carrierLabel === "zatím nepoznán";
    var pickerHost = null;
    if (carrierUnknown) {
      var pickCarrier = document.createElement("button");
      pickCarrier.type = "button";
      pickCarrier.className = "iuSilverParcelWatch__btnSecondary";
      pickCarrier.textContent = "Vybrat dopravce";
      pickerHost = document.createElement("div");
      pickerHost.className = "iuSilverParcelWatch__picker";
      pickerHost.hidden = true;
      pickCarrier.addEventListener("click", function () {
        pickerHost.hidden = !pickerHost.hidden;
        if (!pickerHost.hidden && pickerHost.childElementCount === 0) {
          renderCarrierPicker(item, pickerHost);
        }
      });
      actions.appendChild(pickCarrier);
    }

    var hideB = document.createElement("button");
    hideB.type = "button";
    hideB.className = "iuSilverParcelWatch__btnGhost";
    hideB.textContent = "Skrýt";
    hideB.addEventListener("click", function () {
      var list = readList().filter(function (x) {
        return x.id !== item.id;
      });
      writeList(list);
      render();
    });
    actions.appendChild(hideB);

    wrap.appendChild(actions);
    if (pickerHost) wrap.appendChild(pickerHost);

    return wrap;
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (completedEl) completedEl.innerHTML = "";

    var items = applyPurgeRules(readList());
    var active = [];
    var done = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (
        it.terminalVerified === "delivered" ||
        it.terminalVerified === "picked_up"
      ) {
        done.push(it);
      } else active.push(it);
    }

    var n = active.length;
    var cap = showAll || n <= 3 ? n : 3;
    for (var j = 0; j < cap; j++) {
      listEl.appendChild(renderCard(active[j]));
    }
    if (showAllBtn) {
      showAllBtn.hidden = n <= 3;
      if (!showAllBtn.hidden) {
        showAllBtn.textContent = showAll
          ? "Zobrazit méně"
          : "Zobrazit všechny zásilky";
      }
    }

    if (completedEl && done.length) {
      var h = document.createElement("div");
      h.className = "iuSilverParcelWatch__doneHead";
      h.textContent = "Dokončené zásilky";
      completedEl.appendChild(h);
      for (var k = 0; k < done.length; k++) {
        completedEl.appendChild(renderCard(done[k]));
      }
    }
  }

  function onSave() {
    clearErr();
    var eng = window.IU_PARCEL_TRACKING_ENGINE;
    var fac = window.IU_SILVER_PARCEL_FACADE;
    if (!eng || !fac || typeof eng.validateTrackingNumberFormat !== "function") {
      setErr(ERR_FORMAT);
      return;
    }
    var raw = inp ? inp.value : "";
    var fmt = eng.validateTrackingNumberFormat(raw);
    if (!fmt || !fmt.ok) {
      setErr(ERR_FORMAT);
      return;
    }
    var collapsed = fmt.collapsed;
    var list = readList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].number === collapsed) {
        setErr(ERR_DUP);
        return;
      }
    }
    if (list.length >= MAX) {
      setErr(ERR_LIMIT);
      return;
    }

    var item = {
      id: uid(),
      number: collapsed,
      carrierHint: "",
      postalDigits: "",
      addedAt: Date.now(),
      lastCheckedAt: null,
      terminalVerified: null,
      pickupAddressVerified: "",
      completedAt: null,
      purgeAfterAt: null,
      lastDetection: null,
    };

    list.push(item);
    writeList(list);
    if (inp) inp.value = "";

    setTimeout(function () {
      var fresh = readList();
      for (var j = 0; j < fresh.length; j++) {
        if (fresh[j].id === item.id) {
          var rr = resolveEngine(fresh[j]);
          fresh[j].lastCheckedAt = Date.now();
          if (rr.detection) fresh[j].lastDetection = rr.detection;
          break;
        }
      }
      writeList(fresh);
      render();
    }, 160);

    render();
  }

  function refreshAllFromEngine() {
    var list = readList();
    if (!list.length) return;
    var fac = window.IU_SILVER_PARCEL_FACADE;
    if (!fac || typeof fac.iuSilverParcelEngineResolve !== "function") return;
    var now = Date.now();
    for (var i = 0; i < list.length; i++) {
      var rr = resolveEngine(list[i]);
      list[i].lastCheckedAt = now;
      if (rr.detection) list[i].lastDetection = rr.detection;
    }
    writeList(list);
  }

  function init() {
    if (!root || !inp || !btnSave || !listEl) return;
    try {
      window.__IU_SILVER_PARCEL_DASHBOARD = 1;
    } catch (_) {}

    refreshAllFromEngine();
    render();

    window.addEventListener("pageshow", function () {
      refreshAllFromEngine();
      render();
    });

    btnSave.addEventListener("click", onSave);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        onSave();
      }
    });
    if (showAllBtn) {
      showAllBtn.addEventListener("click", function () {
        showAll = !showAll;
        render();
      });
    }

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
