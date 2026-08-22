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
function iuExtractParcelPickupAddress(text) {
  var t = String(text || "").trim();
  if (!t) return null;

  var gas = t.match(/(?:Cerpaci|Čerpací)\s+stanic[ei]\s+([^.\n\r]+)/i);
  if (gas) {
    var gasBody = String(gas[1] || "")
      .trim()
      .replace(/[.;,\s]+$/, "");
    if (gasBody && /\d/.test(gasBody)) {
      return {
        addressLine: gasBody,
        addressDisplay: "Čerpací stanice " + gasBody,
      };
    }
  }

  var streetSuffix =
    "(?:ská|ské|ský|ná|ní|ého|ova|ovo|třída|náměstí|nám\\.|ulice|ul\\.|tr\\.)";
  var houseNum = "\\d{1,4}[a-zA-Z]?(?:\\/\\d{1,4})?";
  var streetRe = new RegExp(
    "([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž\\-]+" +
      streetSuffix +
      ")\\s+(" +
      houseNum +
      ")(?:\\s*\\(([^)]+)\\))?",
    "gi",
  );

  var matches = [];
  var m;
  while ((m = streetRe.exec(t)) !== null) {
    matches.push({
      index: m.index,
      full: m[0],
      street: m[1],
      num: m[2],
      paren: m[3] || "",
    });
  }
  if (!matches.length) return null;

  var best = matches[matches.length - 1];
  var before = t.slice(0, best.index);
  var clauseStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf(";"),
    before.lastIndexOf("!"),
  );
  var clause = t.slice(clauseStart + 1).trim();
  var addrEnd = best.index + best.full.length - (clauseStart + 1);
  if (addrEnd > 0) {
    clause = clause.slice(0, addrEnd).trim();
  } else {
    clause = best.street + " " + best.num + (best.paren ? " (" + best.paren + ")" : "");
  }
  clause = clause.replace(/[.;,\s]+$/, "");

  if (!clause || clause.length < 6) {
    clause =
      best.street +
      " " +
      best.num +
      (best.paren ? " (" + best.paren + ")" : "");
  }

  return {
    addressLine: clause,
    addressDisplay: clause,
  };
}

function iuParseParcelUserDetail(text) {
  var t = String(text || "").trim();
  var base = {
    version: 2,
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
    /\bk\s+vyzvednut(i|í)\b/i.test(t) ||
    /\bpřipraveno\s+k\s+v(y)?deji\b/i.test(t) ||
    /\bpřipraveno\s+k\s+vyzvednut(i|í)\b/i.test(t)
  ) {
    base.statusHeadline = "Připraveno k vyzvednutí";
  }
  var hp = t.match(/\bHeslo\s+(\d{4,10})\b/i);
  if (hp) base.password = hp[1];
  var op = t.match(/\bPo[-–]Ne\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
  if (op) {
    base.openingHours = "Po–Ne " + op[1] + "–" + op[2];
  }
  var addr = iuExtractParcelPickupAddress(t);
  if (addr) {
    base.addressLine = addr.addressLine;
    base.addressDisplay = addr.addressDisplay;
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
  globalThis.iuExtractParcelPickupAddress = iuExtractParcelPickupAddress;
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

  function writeList(arr, onWritten) {
    var payload = JSON.stringify(arr);
    function finish(ok) {
      if (typeof onWritten === "function") onWritten(!!ok);
    }
    function store() {
      try {
        localStorage.setItem(LS_KEY, payload);
        finish(true);
      } catch (_) {
        finish(false);
      }
    }
    var ldp = window.iuLocalDataProtection;
    if (
      ldp &&
      typeof ldp.isLocalDataProtectionNoticeAccepted === "function" &&
      !ldp.isLocalDataProtectionNoticeAccepted() &&
      typeof ldp.ensureLocalDataProtectionBeforeSave === "function"
    ) {
      void ldp.ensureLocalDataProtectionBeforeSave().then(function (ok) {
        if (!ok) {
          finish(false);
          return;
        }
        store();
      });
      return;
    }
    store();
  }

  function removeParcelFromList(itemId) {
    var list = readList().filter(function (x) {
      return x.id !== itemId;
    });
    writeList(list);
    render();
  }

  var removeConfirmEl = null;
  var removeConfirmEscHandler = null;
  var removeConfirmLastFocus = null;
  var removeConfirmPendingId = null;

  function closeRemoveConfirmDialog() {
    if (!removeConfirmEl) return;
    removeConfirmEl.hidden = true;
    removeConfirmEl.setAttribute("aria-hidden", "true");
    removeConfirmPendingId = null;
    if (removeConfirmEscHandler) {
      document.removeEventListener("keydown", removeConfirmEscHandler);
      removeConfirmEscHandler = null;
    }
    try {
      if (removeConfirmLastFocus && typeof removeConfirmLastFocus.focus === "function") {
        removeConfirmLastFocus.focus();
      }
    } catch (_) {}
    removeConfirmLastFocus = null;
  }

  function ensureRemoveConfirmDialog() {
    if (removeConfirmEl) return removeConfirmEl;

    var overlay = document.createElement("div");
    overlay.id = "iuSilverParcelWatchRemoveConfirm";
    overlay.className = "iuSilverParcelWatch__confirmModal";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "iuSilverParcelWatchRemoveConfirmTitle");
    overlay.setAttribute("aria-describedby", "iuSilverParcelWatchRemoveConfirmDesc");
    overlay.setAttribute("aria-hidden", "true");

    var card = document.createElement("div");
    card.className = "iuSilverParcelWatch__confirmCard";

    var title = document.createElement("h4");
    title.id = "iuSilverParcelWatchRemoveConfirmTitle";
    title.className = "iuSilverParcelWatch__confirmTitle";
    title.textContent = "Odstranit sledovanou zásilku?";

    var desc = document.createElement("p");
    desc.id = "iuSilverParcelWatchRemoveConfirmDesc";
    desc.className = "iuSilverParcelWatch__confirmDesc";
    desc.textContent =
      "Opravdu chcete odstranit tuto zásilku ze sledování?";

    var actions = document.createElement("div");
    actions.className = "iuSilverParcelWatch__confirmActions";

    var cancelB = document.createElement("button");
    cancelB.type = "button";
    cancelB.id = "iuSilverParcelWatchRemoveConfirmCancel";
    cancelB.className =
      "iuSilverParcelWatch__btnSecondary iuSilverParcelWatch__confirmCancel";
    cancelB.textContent = "Zrušit";
    cancelB.addEventListener("click", function () {
      closeRemoveConfirmDialog();
    });

    var okB = document.createElement("button");
    okB.type = "button";
    okB.id = "iuSilverParcelWatchRemoveConfirmOk";
    okB.className =
      "iuSilverParcelWatch__btnGhost iuSilverParcelWatch__btnRemoveParcel iuSilverParcelWatch__confirmOk";
    okB.textContent = "Odstranit";
    okB.addEventListener("click", function () {
      var id = removeConfirmPendingId;
      closeRemoveConfirmDialog();
      if (id) removeParcelFromList(id);
    });

    actions.appendChild(cancelB);
    actions.appendChild(okB);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(actions);
    overlay.appendChild(card);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeRemoveConfirmDialog();
    });
    card.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    document.body.appendChild(overlay);
    removeConfirmEl = overlay;
    return overlay;
  }

  function openRemoveConfirmDialog(item, triggerEl) {
    var dlg = ensureRemoveConfirmDialog();
    removeConfirmPendingId = item.id;
    removeConfirmLastFocus = triggerEl || document.activeElement;
    dlg.hidden = false;
    dlg.setAttribute("aria-hidden", "false");
    if (removeConfirmEscHandler) {
      document.removeEventListener("keydown", removeConfirmEscHandler);
    }
    removeConfirmEscHandler = function (e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeRemoveConfirmDialog();
    };
    document.addEventListener("keydown", removeConfirmEscHandler);
    var cancelBtn = document.getElementById("iuSilverParcelWatchRemoveConfirmCancel");
    if (cancelBtn && typeof cancelBtn.focus === "function") {
      cancelBtn.focus();
    }
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
    var parsed = hasStored
      ? iuParseParcelUserDetail(String(item.detailRawText))
      : null;

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
        "Vlož SMS od dopravce, že je zásilka připravena k vyzvednutí, nebo přidej vlastní poznámku",
      );
      ta.placeholder =
        "Vlož SMS od dopravce, že je zásilka připravena k vyzvednutí, nebo přidej vlastní poznámku";
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
        writeList(list, function (ok) {
          if (!ok) return;
          detailEditId = null;
          render();
        });
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
            mapsUrlForQuery(parsed.addressLine || parsed.addressDisplay),
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
    hideB.className =
      "iuSilverParcelWatch__btnGhost iuSilverParcelWatch__btnRemoveParcel";
    hideB.setAttribute("aria-label", "Odstranit zásilku ze seznamu");
    hideB.textContent = "Odstranit";
    hideB.addEventListener("click", function () {
      openRemoveConfirmDialog(item, hideB);
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

    var items = readList();
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
    if (isMobileTabletDetailUx()) {
      var trimmedMain = String(inp && inp.value ? inp.value : "").trim();
      if (!trimmedMain.length) {
        return;
      }
    }
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
      lastDetection: null,
    };

    list.push(item);
    writeList(list, function (ok) {
      if (!ok) return;
      if (inp) inp.value = "";
      syncMainSaveState();

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
    });
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

  function syncMainSaveState() {
    if (!inp || !btnSave) return;
    var has = String(inp.value || "").trim().length > 0;
    if (isMobileTabletDetailUx()) {
      btnSave.disabled = !has;
      if (has) {
        btnSave.classList.add("iuSilverParcelWatch__mainSave--active");
      } else {
        btnSave.classList.remove("iuSilverParcelWatch__mainSave--active");
      }
    } else {
      btnSave.disabled = false;
      btnSave.classList.remove("iuSilverParcelWatch__mainSave--active");
    }
  }

  function init() {
    if (!root || !inp || !btnSave || !listEl) return;
    try {
      window.__IU_SILVER_PARCEL_DASHBOARD = 1;
    } catch (_) {}

    btnSave.classList.add("iuSilverParcelWatch__mainSave");

    refreshAllFromEngine();

    window.addEventListener("pageshow", function () {
      refreshAllFromEngine();
      render();
      syncMainSaveState();
    });

    window.addEventListener("iu-vault-hydrated", function () {
      render();
      syncMainSaveState();
    });

    window.addEventListener("iu-local-store-changed", function (ev) {
      try {
        if (ev && ev.detail && ev.detail.key === LS_KEY) {
          render();
          syncMainSaveState();
        }
      } catch (_) {}
    });

    btnSave.addEventListener("click", onSave);
    inp.addEventListener("input", syncMainSaveState);
    inp.addEventListener("paste", function () {
      setTimeout(syncMainSaveState, 0);
    });
    try {
      var mqMain = window.matchMedia("(max-width: 1024px)");
      if (mqMain && typeof mqMain.addEventListener === "function") {
        mqMain.addEventListener("change", syncMainSaveState);
      }
    } catch (_) {}

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

    syncMainSaveState();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
