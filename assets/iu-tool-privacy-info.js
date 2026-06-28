/**
 * infoUzel.cz — jednotné informace o soukromí a bezpečnosti v nástrojích
 */
(function iuToolPrivacyInfoModule() {
  "use strict";

  var SHORT_TEXT =
    "🔒 Vše, co si zde dobrovolně uložíte, zůstává pouze ve vašem zařízení. InfoUzel.cz tato data neodesílá na své servery ani k nim nemá přístup.";

  var DESCRIPTIONS = {
    datovka: "Bezpečné otevření Datových schránek",
    bakalari: "Rychlý přístup do Bakalářů",
    pojistovna: "Zdravotní pojišťovny",
    invoice: "Generátor faktur",
    legal: "Generátor smluv a plných mocí",
    financial: "Praktické výpočty pro běžné finance",
  };

  var MODAL_TITLES = {
    datovka: "Informace o soukromí — Datové schránky",
    bakalari: "Informace o soukromí — Bakaláři",
    pojistovna: "Informace o soukromí — Zdravotní pojišťovny",
    invoice: "Informace o soukromí — Generátor faktur",
    legal: "Informace o soukromí — Generátor smluv a plných mocí",
    financial: "Informace o soukromí — Finanční kalkulačky",
  };

  var MODAL_SECTIONS = {
    datovka: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Nástroj usnadňuje uložení přístupových údajů k datovým schránkám a rychlé otevření oficiálního portálu datovek v prohlížeči.",
          "InfoUzel.cz není provozovatelem datových schránek ani portálu datovek. Přihlášení probíhá vždy na webu příslušného poskytovatele.",
        ],
      },
      {
        title: "Ukládání údajů",
        paragraphs: [
          "Uložení jmen, uživatelských jmen nebo hesel je zcela dobrovolné. Údaje slouží pouze pro pohodlnější používání tohoto nástroje ve vašem prohlížeči.",
          "Data se ukládají lokálně v tomto prohlížeči na tomto zařízení. InfoUzel.cz je neodesílá na své servery, k nim nemá přístup a nesynchronizuje je mezi zařízeními.",
        ],
      },
      {
        title: "Bezpečnost a odpovědnost",
        paragraphs: [
          "Při použití sdíleného nebo nezabezpečeného zařízení mohou mít k uloženým údajům přístup další osoby. Používejte tuto funkci pouze na vlastním důvěryhodném a zabezpečeném zařízení.",
          "Za zabezpečení zařízení, správnost zadaných údajů a jejich použití odpovídáte vy.",
        ],
      },
    ],
    bakalari: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Nástroj umožňuje uložit odkazy a volitelně přístupové údaje k Bakalářům a rychle otevřít školní portál v prohlížeči.",
          "InfoUzel.cz není provozovatelem systému Bakaláři. Přihlášení probíhá vždy na webu vaší školy nebo poskytovatele.",
        ],
      },
      {
        title: "Ukládání údajů",
        paragraphs: [
          "Uložení údajů je dobrovolné. Nepovinně můžete uložit jméno dítěte, odkaz, uživatelské jméno nebo heslo pro rychlejší práci v tomto prohlížeči.",
          "Údaje zůstávají pouze ve vašem zařízení. InfoUzel.cz je neodesílá na své servery, k nim nemá přístup a nesynchronizuje je mezi zařízeními.",
        ],
      },
      {
        title: "Bezpečnost a odpovědnost",
        paragraphs: [
          "Na sdíleném nebo nezabezpečeném zařízení mohou uložené údaje vidět i jiné osoby. Doporučujeme používat nástroj jen na důvěryhodném zařízení.",
          "Za zabezpečení zařízení, správnost údajů a jejich použití odpovídáte vy.",
        ],
      },
    ],
    pojistovna: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Nástroj usnadňuje uložení odkazů a volitelných přístupových údajů k portálům zdravotních pojišťoven a jejich rychlé otevření.",
          "InfoUzel.cz není provozovatelem zdravotních pojišťoven ani jejich klientských portálů.",
        ],
      },
      {
        title: "Ukládání údajů",
        paragraphs: [
          "Uložení údajů je zcela dobrovolné a slouží pouze pro pohodlnější používání nástroje v tomto prohlížeči.",
          "Údaje zůstávají lokálně ve vašem zařízení. InfoUzel.cz je neodesílá na své servery, k nim nemá přístup a nesynchronizuje je mezi zařízeními.",
        ],
      },
      {
        title: "Bezpečnost a odpovědnost",
        paragraphs: [
          "Na sdíleném nebo nezabezpečeném zařízení mohou mít k uloženým údajům přístup další osoby.",
          "Za zabezpečení zařízení, správnost údajů a jejich použití odpovídáte vy.",
        ],
      },
    ],
    invoice: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Generátor faktur pomáhá sestavit fakturační doklad a exportovat ho z prohlížeče. Nejde o účetní, daňové ani právní poradenství.",
        ],
      },
      {
        title: "Ukládání údajů",
        paragraphs: [
          "Uložení dodavatelů, odběratelů nebo rozpracovaného formuláře je dobrovolné a slouží pro pohodlnější opakované použití.",
          "Data zůstávají pouze ve vašem zařízení. InfoUzel.cz je neodesílá na své servery, k nim nemá přístup a nesynchronizuje je mezi zařízeními.",
        ],
      },
      {
        title: "Bezpečnost a odpovědnost",
        paragraphs: [
          "Před vystavením dokladu vždy zkontrolujte správnost údajů, DPH a částek. Za správnost dokladu odpovídáte vy.",
          "Na sdíleném zařízení mohou být uložené údaje dostupné i jiným osobám. Používejte nástroj na důvěryhodném zařízení.",
        ],
      },
    ],
    legal: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Generátor vytváří textové vzory smluv, plných mocí a souvisejících dokumentů v prohlížeči. Nejde o právní službu ani advokacii.",
        ],
      },
      {
        title: "Ukládání údajů",
        paragraphs: [
          "Vyplněné údaje ve formuláři zůstávají v relaci prohlížeče pro pohodlnou práci. Trvalé ukládání konceptů je dobrovolné a probíhá lokálně v zařízení.",
          "InfoUzel.cz neodesílá obsah dokumentů na své servery, k němu nemá přístup a nesynchronizuje ho mezi zařízeními.",
        ],
      },
      {
        title: "Bezpečnost a odpovědnost",
        paragraphs: [
          "Před použitím dokumentu vždy ověřte jeho obsah. V důležitých případech doporučujeme konzultaci s advokátem.",
          "Za správnost údajů, použití dokumentu a zabezpečení zařízení odpovídáte vy.",
        ],
      },
    ],
    financial: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Finanční kalkulačky poskytují orientační výpočty v prohlížeči. Nejde o investiční, daňové ani finanční poradenství.",
          "Některé kalkulačky mohou nabídnout odkaz na externí službu — po kliknutí opustíte InfoUzel.cz.",
        ],
      },
      {
        title: "Zpracování údajů",
        paragraphs: [
          "Zadané hodnoty slouží pouze pro okamžitý výpočet ve vašem zařízení. InfoUzel.cz je standardně neukládá na své servery ani k nim nemá přístup.",
          "Údaje se mezi zařízeními nesynchronizují. Po obnovení stránky mohou být zadané hodnoty ztraceny.",
        ],
      },
      {
        title: "Bezpečnost a odpovědnost",
        paragraphs: [
          "Výsledky jsou orientační — vždy je ověřte a při rozhodování zvažte odbornou konzultaci.",
          "Za správnost vstupních údajů a použití výsledků odpovídáte vy.",
        ],
      },
    ],
  };

  var modalEl = null;
  var lastFocusEl = null;
  var keyHandler = null;

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function buildHeadBlockHtml(toolKey) {
    var desc = DESCRIPTIONS[toolKey] || "";
    return (
      '<button type="button" class="iu-tool-privacy-btn" data-iu-tool-privacy-open="' +
      esc(toolKey) +
      '" aria-haspopup="dialog">ⓘ Informace o soukromí a bezpečnosti</button>' +
      (desc ? '<p class="iu-tool-privacy-desc">' + esc(desc) + "</p>" : "") +
      '<p class="iu-tool-privacy-short" role="note">' +
      esc(SHORT_TEXT) +
      "</p>"
    );
  }

  function mountInOverlayHeading(heading, toolKey) {
    if (!heading || !toolKey || heading.getAttribute("data-iu-tool-privacy-mounted") === "1") return;
    var titleNode = findTitleNode(heading);
    if (!titleNode) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "iu-tool-privacy-btn";
    btn.setAttribute("data-iu-tool-privacy-open", toolKey);
    btn.setAttribute("aria-haspopup", "dialog");
    btn.textContent = "ⓘ Informace o soukromí a bezpečnosti";
    if (titleNode.nextSibling) {
      titleNode.parentNode.insertBefore(btn, titleNode.nextSibling);
    } else {
      titleNode.parentNode.appendChild(btn);
    }

    var descP = document.createElement("p");
    descP.className = "iu-tool-privacy-desc";
    descP.textContent = DESCRIPTIONS[toolKey] || "";
    btn.parentNode.insertBefore(descP, btn.nextSibling);

    var shortP = document.createElement("p");
    shortP.className = "iu-tool-privacy-short";
    shortP.setAttribute("role", "note");
    shortP.textContent = SHORT_TEXT;
    descP.parentNode.insertBefore(shortP, descP.nextSibling);

    var legacySub = heading.querySelector(
      ".iu-financial-overlay-sub, .iu-legal-overlay-sub, .iu-invoice-overlay-sub"
    );
    if (legacySub) legacySub.hidden = true;

    heading.setAttribute("data-iu-tool-privacy-mounted", "1");
    heading.setAttribute("data-iu-tool-privacy-key", toolKey);
  }

  function renderModalBody(toolKey) {
    var sections = MODAL_SECTIONS[toolKey] || [];
    return sections
      .map(function (sec) {
        var ps = (sec.paragraphs || [])
          .map(function (p) {
            return "<p>" + esc(p) + "</p>";
          })
          .join("");
        return (
          '<section class="iu-tool-privacy-modal__section">' +
          '<h3 class="iu-tool-privacy-modal__sectionTitle">' +
          esc(sec.title) +
          "</h3>" +
          ps +
          "</section>"
        );
      })
      .join("");
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.id = "iuToolPrivacyModal";
    modalEl.className = "iu-tool-privacy-modal";
    modalEl.hidden = true;
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.innerHTML =
      '<div class="iu-tool-privacy-modal__panel">' +
      '<div class="iu-tool-privacy-modal__head"><h2 class="iu-tool-privacy-modal__title" id="iuToolPrivacyModalTitle"></h2></div>' +
      '<div class="iu-tool-privacy-modal__body" id="iuToolPrivacyModalBody"></div>' +
      '<div class="iu-tool-privacy-modal__actions"><button type="button" class="iu-tool-privacy-modal__close" data-iu-tool-privacy-close>Zavřít</button></div>' +
      "</div>";
    document.body.appendChild(modalEl);

    modalEl.addEventListener("click", function (e) {
      if (e.target === modalEl) closeModal();
    });
    var closeBtn = modalEl.querySelector("[data-iu-tool-privacy-close]");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        closeModal();
      });
    }
    return modalEl;
  }

  function closeModal() {
    if (!modalEl || modalEl.hidden) return;
    modalEl.hidden = true;
    modalEl.setAttribute("hidden", "");
    modalEl.setAttribute("aria-hidden", "true");
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
    if (lastFocusEl && typeof lastFocusEl.focus === "function") {
      try {
        lastFocusEl.focus();
      } catch (_) {}
    }
    lastFocusEl = null;
  }

  function openModal(toolKey) {
    var key = String(toolKey || "");
    if (!MODAL_SECTIONS[key]) return;
    ensureModal();
    try {
      lastFocusEl = document.activeElement;
    } catch (_) {
      lastFocusEl = null;
    }
    var titleEl = modalEl.querySelector("#iuToolPrivacyModalTitle");
    var bodyEl = modalEl.querySelector("#iuToolPrivacyModalBody");
    if (titleEl) titleEl.textContent = MODAL_TITLES[key] || "Informace o soukromí";
    if (bodyEl) bodyEl.innerHTML = renderModalBody(key);
    modalEl.hidden = false;
    modalEl.removeAttribute("hidden");
    modalEl.removeAttribute("aria-hidden");
    modalEl.setAttribute("aria-labelledby", "iuToolPrivacyModalTitle");
    var closeBtn = modalEl.querySelector("[data-iu-tool-privacy-close]");
    if (closeBtn) {
      try {
        closeBtn.focus();
      } catch (_) {}
    }
    keyHandler = function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    };
    document.addEventListener("keydown", keyHandler);
  }

  function findTitleNode(heading) {
    if (!heading) return null;
    return (
      heading.querySelector("h2, h1, .iuQTitle, .iu-tool-privacy-title") ||
      heading.querySelector("[id$='Title']")
    );
  }

  function mountInHeading(heading, toolKey) {
    if (!heading || !toolKey || heading.getAttribute("data-iu-tool-privacy-mounted") === "1") return;
    var titleNode = findTitleNode(heading);
    if (!titleNode) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = buildHeadBlockHtml(toolKey);
    var frag = document.createDocumentFragment();
    while (wrap.firstChild) frag.appendChild(wrap.firstChild);
    if (titleNode.nextSibling) {
      titleNode.parentNode.insertBefore(frag, titleNode.nextSibling);
    } else {
      titleNode.parentNode.appendChild(frag);
    }
    heading.setAttribute("data-iu-tool-privacy-mounted", "1");
    heading.setAttribute("data-iu-tool-privacy-key", toolKey);
  }

  function mountDatovkaHeading() {
    var main = document.querySelector(".iu-ds-panelHeaderMain");
    if (!main) return;
    mountInHeading(main, "datovka");
  }

  function initDelegation() {
    if (window.__iuToolPrivacyDelegation) return;
    window.__iuToolPrivacyDelegation = true;
    document.addEventListener(
      "click",
      function (e) {
        var btn = e.target && e.target.closest && e.target.closest("[data-iu-tool-privacy-open]");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        openModal(btn.getAttribute("data-iu-tool-privacy-open"));
      },
      true
    );
  }

  function bootStaticHeadings() {
    var overlayMap = [
      { sel: ".iu-financial-overlay-heading", key: "financial" },
      { sel: ".iu-legal-overlay-heading", key: "legal" },
      { sel: ".iu-invoice-overlay-heading", key: "invoice" },
    ];
    overlayMap.forEach(function (item) {
      var el = document.querySelector(item.sel);
      if (!el) return;
      mountInOverlayHeading(el, item.key);
    });
    mountDatovkaHeading();
  }

  function boot() {
    initDelegation();
    bootStaticHeadings();
  }

  try {
    window.iuToolPrivacyShortText = SHORT_TEXT;
    window.iuToolPrivacyHeadBlockHtml = buildHeadBlockHtml;
    window.iuToolPrivacyMountInHeading = mountInHeading;
    window.iuToolPrivacyMountInOverlayHeading = mountInOverlayHeading;
    window.iuToolPrivacyMountDatovkaHeading = mountDatovkaHeading;
    window.iuToolPrivacyOpenModal = openModal;
    window.iuToolPrivacyCloseModal = closeModal;
    window.iuToolPrivacyBoot = boot;
  } catch (_) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
