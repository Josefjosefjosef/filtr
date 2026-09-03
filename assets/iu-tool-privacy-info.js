/**
 * infoUzel.cz — jednotné informace o soukromí a bezpečnosti v nástrojích
 */
(function iuToolPrivacyInfoModule() {
  "use strict";

  var PRIVACY_BTN_LABEL = "ℹ Informace";
  var PRIVACY_BTN_ARIA = "Informace o soukromí a bezpečnosti";

  var SHORT_TEXT_DEFAULT =
    "🔒 Veškeré údaje ukládáte dobrovolně pouze do svého zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.";

  var DATOVA_AUTOFILL_NOTE =
    "Externí přihlašovací stránka běží na jiné doméně — prohlížeč z bezpečnostních důvodů neumožňuje automatické vyplnění jména a hesla z infoUzel.cz. Po otevření přihlášení zkopírujte údaje z polí níže ručně.";

  var LEGAL_MODULE_DISCLAIMER =
    "Tento nástroj tvoří standardizované textové vzory pro vlastní použití. Nejedná se o individuální právní službu ani advokacii. V sporu, u vyšší hodnoty nebo nestandardní situace doporučujeme text konzultovat s advokátem.";

  var SHORT_TEXTS = {
    datovka: SHORT_TEXT_DEFAULT,
    bakalari: SHORT_TEXT_DEFAULT,
    pojistovna: SHORT_TEXT_DEFAULT,
    banka: SHORT_TEXT_DEFAULT,
    invoice:
      "🔒 Fakturační údaje ukládáte dobrovolně pouze do svého zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.",
    legal:
      "🔒 Vyplněné údaje zůstávají pouze ve vašem prohlížeči. InfoUzel.cz obsah dokumentů neodesílá na své servery ani k němu nemá přístup.",
    financial:
      "🔒 Zadané hodnoty slouží pouze pro výpočet ve vašem zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.",
  };

  var MODAL_TITLES = {
    datovka: "Informace o soukromí — Datové schránky",
    bakalari: "Informace o soukromí — Školní systémy",
    pojistovna: "Informace o soukromí — Zdravotní pojišťovny",
    banka: "Informace o soukromí — Internetové bankovnictví",
    invoice: "Informace o soukromí — Generátor faktur",
    legal: "Informace o soukromí — Generátor smluv a plných mocí",
    financial: "Informace o soukromí — Finanční kalkulačky",
  };

  var LOCAL_STORAGE_SECTION = {
    title: "Ukládání údajů",
    paragraphs: [
      "Uložení údajů je dobrovolné. Údaje slouží pouze pro pohodlnější používání tohoto nástroje ve vašem prohlížeči. Data zůstávají lokálně v tomto zařízení.",
      "InfoUzel.cz je neodesílá na své servery, nemá k nim přístup a nesynchronizuje je mezi zařízeními. Smazání dat v prohlížeči může uložené údaje odstranit.",
    ],
  };

  var SECURITY_SECTION = {
    title: "Bezpečnost a odpovědnost",
    paragraphs: [
      "Používejte tuto funkci pouze na vlastním důvěryhodném a zabezpečeném zařízení.",
      "Na sdíleném nebo nezabezpečeném zařízení mohou mít k uloženým údajům přístup další osoby.",
      "Za zabezpečení zařízení, správnost zadaných údajů a jejich použití odpovídáte vy.",
    ],
  };

  var LEGAL_NOTE_SECTION = {
    title: "Právní poznámka",
    paragraphs: [
      "Text je připraven s ohledem na obecná pravidla ochrany osobních údajů, zejména GDPR (Nařízení Evropského parlamentu a Rady (EU) 2016/679), zákon č. 110/2019 Sb., o zpracování osobních údajů, a zákon o elektronických komunikacích v rozsahu ukládání a čtení informací v zařízení uživatele.",
      "InfoUzel.cz údaje z těchto nástrojů nezpracovává na svých serverech. Údaje ukládáte dobrovolně pouze lokálně ve svém prohlížeči na svém zařízení.",
    ],
  };

  var MODAL_SECTIONS = {
    datovka: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Nástroj usnadňuje uložení přístupových údajů k Datových schránek a rychlé otevření oficiálního portálu v prohlížeči.",
        ],
      },
      {
        title: "Jak funguje",
        paragraphs: [
          "Údaje zůstávají ve vašem prohlížeči. Po kliknutí na otevření portálu přejdete na oficiální web poskytovatele.",
        ],
      },
      LOCAL_STORAGE_SECTION,
      {
        title: "Externí služby",
        paragraphs: [
          "InfoUzel.cz není provozovatelem Datových schránek. Přihlášení probíhá vždy na oficiálním portálu Datových schránek.",
          "Po kliknutí budete přesměrováni na oficiální stránky vybraného poskytovatele. Opustíte prostředí InfoUzel.cz.",
          "InfoUzel.cz neodpovídá za obsah, dostupnost ani změny provedené provozovatelem externí služby.",
        ],
      },
      {
        title: "Externí přihlašovací stránka",
        paragraphs: [DATOVA_AUTOFILL_NOTE],
      },
      SECURITY_SECTION,
    ],
    bakalari: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Nástroj umožňuje uložit odkazy a volitelně přístupové údaje ke školnímu informačnímu systému a rychle otevřít školní portál.",
        ],
      },
      {
        title: "Jak funguje",
        paragraphs: [
          "Údaje zůstávají lokálně v prohlížeči. Otevření portálu probíhá na webu školy nebo poskytovatele.",
        ],
      },
      LOCAL_STORAGE_SECTION,
      {
        title: "Externí služby",
        paragraphs: [
          "InfoUzel.cz není provozovatelem školního informačního systému. Přihlášení probíhá vždy na webu vaší školy nebo poskytovatele.",
          "Po kliknutí budete přesměrováni na oficiální stránky vybraného poskytovatele. Opustíte prostředí InfoUzel.cz.",
        ],
      },
      SECURITY_SECTION,
    ],
    pojistovna: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Nástroj usnadňuje uložení odkazů a volitelných přístupových údajů k portálům zdravotních pojišťoven.",
        ],
      },
      {
        title: "Jak funguje",
        paragraphs: [
          "Údaje zůstávají lokálně v prohlížeči. Otevření portálu probíhá na stránkách konkrétní pojišťovny.",
        ],
      },
      LOCAL_STORAGE_SECTION,
      {
        title: "Externí služby",
        paragraphs: [
          "InfoUzel.cz není provozovatelem zdravotní pojišťovny ani klientského portálu.",
          "Po kliknutí budete přesměrováni na oficiální stránky vybraného poskytovatele. Opustíte prostředí InfoUzel.cz.",
        ],
      },
      SECURITY_SECTION,
    ],
    banka: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Nástroj usnadňuje rychlý přístup do internetového bankovnictví vybraných bank a správu oblíbených bank v zařízení.",
        ],
      },
      {
        title: "Jak funguje",
        paragraphs: [
          "Po kliknutí na banku otevřete oficiální internetové bankovnictví v nové kartě prohlížeče.",
          "Seznam oblíbených bank a vlastní banky se ukládají lokálně pro pohodlnější použití.",
        ],
      },
      LOCAL_STORAGE_SECTION,
      {
        title: "Externí služby",
        paragraphs: [
          "Uživatel opouští prostředí InfoUzel.cz a přechází na oficiální stránky banky.",
          "InfoUzel.cz není provozovatelem bankovní služby a neodpovídá za přihlášení, dostupnost ani obsah bankovního portálu.",
          "Před přihlášením vždy zkontrolujte adresu oficiálního webu banky.",
        ],
      },
      SECURITY_SECTION,
    ],
    invoice: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Generátor faktur pomáhá sestavit fakturační doklad a exportovat ho z prohlížeče.",
        ],
      },
      {
        title: "Jak funguje",
        paragraphs: [
          "Údaje zůstávají ve vašem prohlížeči. Export a náhled probíhají lokálně v zařízení.",
        ],
      },
      LOCAL_STORAGE_SECTION,
      {
        title: "Odborné upozornění",
        paragraphs: [
          "Nejde o účetní, daňové ani právní poradenství.",
          "Uživatel odpovídá za správnost fakturačních údajů, DPH, částek, splatnosti a dalších údajů.",
          "Před použitím dokladu má uživatel vše zkontrolovat.",
        ],
      },
      SECURITY_SECTION,
    ],
    legal: [
      {
        title: "Upozornění k použití vzorů",
        paragraphs: [LEGAL_MODULE_DISCLAIMER],
      },
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Generátor vytváří textové vzory smluv, plných mocí a souvisejících dokumentů v prohlížeči.",
        ],
      },
      {
        title: "Jak funguje",
        paragraphs: [
          "Vyplněné údaje zůstávají v relaci prohlížeče. Trvalé ukládání konceptů je dobrovolné a probíhá lokálně.",
        ],
      },
      {
        title: "Ukládání údajů",
        paragraphs: [
          "InfoUzel.cz neodesílá obsah dokumentů na své servery, k němu nemá přístup a nesynchronizuje ho mezi zařízeními.",
          "Uložení konceptů je dobrovolné a slouží pouze pro pohodlnější práci v tomto prohlížeči.",
        ],
      },
      {
        title: "Odborné upozornění",
        paragraphs: [
          "Nejde o právní službu, advokacii ani individuální právní poradenství.",
          "Dokumenty jsou obecné textové vzory. Uživatel odpovídá za správnost údajů a vhodnost použití dokumentu.",
          "V důležitých, sporných, nestandardních nebo hodnotnějších případech je vhodné konzultovat advokáta.",
        ],
      },
      SECURITY_SECTION,
    ],
    financial: [
      {
        title: "K čemu nástroj slouží",
        paragraphs: [
          "Finanční kalkulačky poskytují orientační výpočty v prohlížeči.",
        ],
      },
      {
        title: "Jak funguje",
        paragraphs: [
          "Zadané hodnoty slouží pro okamžitý výpočet ve vašem zařízení. Po obnovení stránky mohou být ztraceny.",
          "Některé kalkulačky mohou nabídnout odkaz na externí službu — po kliknutí opustíte InfoUzel.cz.",
        ],
      },
      {
        title: "Zpracování údajů",
        paragraphs: [
          "InfoUzel.cz standardně neukládá zadané hodnoty na své servery ani k nim nemá přístup.",
          "Údaje se mezi zařízeními nesynchronizují.",
        ],
      },
      {
        title: "Odborné upozornění",
        paragraphs: [
          "Výpočty jsou pouze orientační. Nejde o investiční, finanční ani daňové poradenství.",
          "Výsledky je nutné ověřit. U důležitých rozhodnutí zvažte konzultaci s odborníkem.",
        ],
      },
      SECURITY_SECTION,
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

  function getShortText(toolKey) {
    return SHORT_TEXTS[toolKey] || SHORT_TEXT_DEFAULT;
  }

  function buildPrivacyBtnHtml(toolKey) {
    return (
      '<button type="button" class="iu-tool-privacy-btn" data-iu-tool-privacy-open="' +
      esc(toolKey) +
      '" aria-haspopup="dialog" aria-label="' +
      esc(PRIVACY_BTN_ARIA) +
      '">' +
      esc(PRIVACY_BTN_LABEL) +
      "</button>"
    );
  }

  function buildHeadBlockHtml(toolKey) {
    return buildPrivacyBtnHtml(toolKey);
  }

  function createPrivacyButton(toolKey) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "iu-tool-privacy-btn";
    btn.setAttribute("data-iu-tool-privacy-open", toolKey);
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-label", PRIVACY_BTN_ARIA);
    btn.textContent = PRIVACY_BTN_LABEL;
    return btn;
  }

  function removeLegacyPrivacyNodes(heading) {
    if (!heading) return;
    heading.querySelectorAll(".iu-tool-privacy-btn, .iu-tool-privacy-short").forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function mountCompactPrivacyRow(heading, toolKey) {
    if (!heading || !toolKey) return;
    removeLegacyPrivacyNodes(heading);
    if (heading.getAttribute("data-iu-tool-privacy-mounted") === "1" && heading.querySelector(".iu-overlay-header-row .iu-tool-privacy-btn")) {
      return;
    }
    var titleNode = findTitleNode(heading);
    if (!titleNode) return;

    var existingRow = heading.querySelector(".iu-overlay-header-row");
    if (existingRow) {
      if (!existingRow.querySelector(".iu-tool-privacy-btn")) {
        existingRow.appendChild(createPrivacyButton(toolKey));
      }
    } else {
      var row = document.createElement("div");
      row.className = "iu-overlay-header-row";
      titleNode.parentNode.insertBefore(row, titleNode);
      row.appendChild(titleNode);
      row.appendChild(createPrivacyButton(toolKey));
    }

    heading.setAttribute("data-iu-tool-privacy-mounted", "1");
    heading.setAttribute("data-iu-tool-privacy-key", toolKey);
  }

  function mountInOverlayHeading(heading, toolKey) {
    mountCompactPrivacyRow(heading, toolKey);
  }

  function renderModalBody(toolKey) {
    var sections = (MODAL_SECTIONS[toolKey] || []).concat([LEGAL_NOTE_SECTION]);
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
      '<div class="iu-tool-privacy-modal__scroll"><div class="iu-tool-privacy-modal__body" id="iuToolPrivacyModalBody"></div></div>' +
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
    var scrollEl = modalEl.querySelector(".iu-tool-privacy-modal__scroll");
    if (scrollEl) scrollEl.scrollTop = 0;
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
    mountCompactPrivacyRow(heading, toolKey);
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
    window.iuToolPrivacyShortText = getShortText;
    window.iuToolPrivacyBtnHtml = buildPrivacyBtnHtml;
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
