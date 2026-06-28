/**
 * infoUzel.cz — jednotné informace o soukromí, bezpečnosti a právní ochraně v nástrojích
 */
(function iuToolPrivacyInfoModule() {
  "use strict";

  var STORAGE_DIALOG =
    "Uložení údajů je dobrovolné. Údaje slouží pouze pro pohodlnější používání tohoto nástroje ve vašem prohlížeči. Data zůstávají lokálně v tomto zařízení. InfoUzel.cz je neodesílá na své servery, nemá k nim přístup a nesynchronizuje je mezi zařízeními. Vymazání dat prohlížeče může uložené údaje odstranit.";

  var SECURITY_PARAS = [
    "Používejte tuto funkci pouze na vlastním důvěryhodném a zabezpečeném zařízení.",
    "Na sdíleném nebo nezabezpečeném zařízení mohou mít k uloženým údajům přístup další osoby.",
    "Za zabezpečení zařízení, správnost zadaných údajů a jejich použití odpovídáte vy.",
  ];

  var EXTERNAL_REDIRECT =
    "Po kliknutí budete přesměrováni na oficiální stránky vybraného poskytovatele. Opustíte prostředí InfoUzel.cz.";

  var LEGAL_NOTE_SECTION = {
    title: "Právní poznámka",
    paragraphs: [
      "Text je připraven s ohledem na obecná pravidla ochrany osobních údajů, zejména nařízení GDPR (EU) 2016/679, zákon č. 110/2019 Sb., o zpracování osobních údajů, a pravidla k ukládání a čtení informací v zařízení uživatele.",
      "InfoUzel.cz údaje z těchto nástrojů nezpracovává na svých serverech a k nim standardně nemá přístup. Neuplatňujeme zavádějící tvrzení o absolutní bezpečnosti ani o vyloučení GDPR — údaje zpracováváte lokálně ve svém prohlížeči.",
    ],
  };

  var SHORT_TEXTS = {
    datovka:
      "🔒 Veškeré údaje ukládáte dobrovolně pouze do svého zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.",
    banka:
      "🔒 Odkazy a volitelné údaje ukládáte dobrovolně pouze do svého zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.",
    bakalari:
      "🔒 Veškeré údaje ukládáte dobrovolně pouze do svého zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.",
    pojistovna:
      "🔒 Veškeré údaje ukládáte dobrovolně pouze do svého zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.",
    invoice:
      "🔒 Fakturační údaje ukládáte dobrovolně pouze do svého zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.",
    legal:
      "🔒 Vyplněné údaje zůstávají pouze ve vašem prohlížeči. InfoUzel.cz obsah dokumentů neodesílá na své servery ani k němu nemá přístup.",
    financial:
      "🔒 Zadané hodnoty slouží pouze pro výpočet ve vašem zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.",
  };

  var MODAL_TITLES = {
    datovka: "Informace o soukromí — Datové schránky",
    banka: "Informace o soukromí — Internetové bankovnictví",
    bakalari: "Informace o soukromí — Bakaláři",
    pojistovna: "Informace o soukromí — Zdravotní pojišťovny",
    invoice: "Informace o soukromí — Generátor faktur",
    legal: "Informace o soukromí — Generátor smluv a plných mocí",
    financial: "Informace o soukromí — Finanční kalkulačky",
  };

  function sec(title, paragraphs) {
    return { title: title, paragraphs: paragraphs };
  }

  function withLegal(sections) {
    return sections.concat([LEGAL_NOTE_SECTION]);
  }

  var MODAL_SECTIONS = {
    datovka: withLegal([
      sec("K čemu nástroj slouží", [
        "Nástroj usnadňuje uložení přístupových údajů k datovým schránkám a rychlé otevření oficiálního portálu datovek v prohlížeči.",
      ]),
      sec("Jak funguje", [
        "Údaje zadáváte do formuláře v tomto prohlížeči. Otevření portálu probíhá v novém okně nebo záložce na oficiálním webu poskytovatele.",
      ]),
      sec("Ukládání údajů", [STORAGE_DIALOG]),
      sec("Bezpečnost", SECURITY_PARAS.slice()),
      sec("Odpovědnost uživatele", [
        "Za správnost jmen, uživatelských jmen, hesel a jejich použití odpovídáte vy.",
      ]),
      sec("Externí služby", [
        EXTERNAL_REDIRECT,
        "InfoUzel.cz není provozovatelem datových schránek ani portálu datovek. Přihlášení probíhá vždy na webu příslušného poskytovatele.",
        "InfoUzel.cz neodpovídá za dostupnost, obsah ani změny provedené provozovatelem externí služby.",
      ]),
    ]),
    banka: withLegal([
      sec("K čemu nástroj slouží", [
        "Nástroj usnadňuje uložení odkazů na internetové bankovnictví a rychlé otevření oficiálního webu banky.",
      ]),
      sec("Jak funguje", [
        "Po kliknutí na banku opustíte InfoUzel.cz a přejdete na web vybrané banky. Přihlášení probíhá vždy na stránkách banky.",
      ]),
      sec("Ukládání údajů", [
        "Uložení vlastních odkazů na banky je dobrovolné. Odkazy zůstávají lokálně ve vašem zařízení. InfoUzel.cz je neodesílá na své servery ani k nim nemá přístup.",
      ]),
      sec("Bezpečnost", SECURITY_PARAS.slice()),
      sec("Odpovědnost uživatele", [
        "Před přihlášením vždy zkontrolujte adresu oficiálního webu banky.",
        "Za správnost uložených odkazů a bezpečné použití bankovnictví odpovídáte vy.",
      ]),
      sec("Externí služby", [
        EXTERNAL_REDIRECT,
        "InfoUzel.cz není provozovatelem bankovní služby. InfoUzel.cz neodpovídá za přihlášení, dostupnost ani obsah bankovního portálu.",
        "InfoUzel.cz neodpovídá za změny provedené provozovatelem banky.",
      ]),
    ]),
    bakalari: withLegal([
      sec("K čemu nástroj slouží", [
        "Nástroj umožňuje uložit odkazy a volitelně přístupové údaje k Bakalářům a rychle otevřít školní portál.",
      ]),
      sec("Jak funguje", [
        "Údaje zadáváte v tomto prohlížeči. Otevření portálu probíhá na webu vaší školy nebo poskytovatele.",
      ]),
      sec("Ukládání údajů", [STORAGE_DIALOG]),
      sec("Bezpečnost", SECURITY_PARAS.slice()),
      sec("Odpovědnost uživatele", [
        "Za správnost odkazu, přístupových údajů a jejich použití odpovídáte vy.",
      ]),
      sec("Externí služby", [
        EXTERNAL_REDIRECT,
        "InfoUzel.cz není provozovatelem systému Bakaláři. Přihlášení probíhá vždy na webu školy nebo poskytovatele.",
        "InfoUzel.cz neodpovídá za dostupnost ani obsah externí služby.",
      ]),
    ]),
    pojistovna: withLegal([
      sec("K čemu nástroj slouží", [
        "Nástroj usnadňuje uložení odkazů a volitelných přístupových údajů k portálům zdravotních pojišťoven.",
      ]),
      sec("Jak funguje", [
        "Údaje zadáváte v tomto prohlížeči. Otevření portálu probíhá na webu konkrétní pojišťovny.",
      ]),
      sec("Ukládání údajů", [STORAGE_DIALOG]),
      sec("Bezpečnost", SECURITY_PARAS.slice()),
      sec("Odpovědnost uživatele", [
        "Za správnost údajů, zabezpečení zařízení a jejich použití odpovídáte vy.",
      ]),
      sec("Externí služby", [
        EXTERNAL_REDIRECT,
        "InfoUzel.cz není provozovatelem zdravotní pojišťovny ani klientského portálu.",
        "InfoUzel.cz neodpovídá za dostupnost ani obsah externí služby.",
      ]),
    ]),
    invoice: withLegal([
      sec("K čemu nástroj slouží", [
        "Generátor faktur pomáhá sestavit fakturační doklad a exportovat ho z prohlížeče.",
      ]),
      sec("Jak funguje", [
        "Formulář vyplňujete v tomto prohlížeči. Export probíhá lokálně ve vašem zařízení.",
      ]),
      sec("Ukládání údajů", [STORAGE_DIALOG]),
      sec("Bezpečnost", SECURITY_PARAS.slice()),
      sec("Odpovědnost uživatele", [
        "Za správnost fakturačních údajů, DPH, částek, splatnosti a dalších údajů odpovídáte vy.",
        "Před použitím dokladu vždy zkontrolujte správnost údajů.",
      ]),
      sec("Odborné upozornění", [
        "Nejde o účetní, daňové ani právní poradenství.",
        "Před vystavením dokladu vždy ověřte správnost údajů. V pochybnostech zvažte konzultaci s odborníkem.",
      ]),
    ]),
    legal: withLegal([
      sec("K čemu nástroj slouží", [
        "Generátor vytváří textové vzory smluv, plných mocí a souvisejících dokumentů v prohlížeči.",
      ]),
      sec("Jak funguje", [
        "Formulář vyplňujete v relaci prohlížeče. Náhled a export probíhají lokálně ve vašem zařízení.",
      ]),
      sec("Ukládání údajů", [
        "Vyplněné údaje zůstávají v relaci prohlížeče pro pohodlnou práci. Trvalé ukládání konceptů je dobrovolné a probíhá lokálně v zařízení.",
        "InfoUzel.cz neodesílá obsah dokumentů na své servery, k němu nemá přístup a nesynchronizuje ho mezi zařízeními.",
      ]),
      sec("Bezpečnost", SECURITY_PARAS.slice()),
      sec("Odpovědnost uživatele", [
        "Za správnost údajů, vhodnost použití dokumentu a zabezpečení zařízení odpovídáte vy.",
        "Před použitím dokumentu vždy ověřte jeho obsah.",
      ]),
      sec("Odborné upozornění", [
        "Nejde o právní službu, advokacii ani individuální právní poradenství.",
        "Dokumenty jsou obecné textové vzory pro vlastní použití.",
        "V důležitých, sporných, nestandardních nebo hodnotnějších případech doporučujeme konzultaci s advokátem.",
      ]),
    ]),
    financial: withLegal([
      sec("K čemu nástroj slouží", [
        "Finanční kalkulačky poskytují orientační výpočty v prohlížeči.",
      ]),
      sec("Jak funguje", [
        "Zadané hodnoty slouží pro okamžitý výpočet ve vašem zařízení. Po obnovení stránky mohou být ztraceny.",
        "Některé kalkulačky mohou nabídnout odkaz na externí službu — po kliknutí opustíte InfoUzel.cz.",
      ]),
      sec("Zpracování údajů", [
        "InfoUzel.cz standardně neukládá zadané hodnoty na své servery ani k nim nemá přístup.",
        "Údaje se mezi zařízeními nesynchronizují.",
      ]),
      sec("Bezpečnost", SECURITY_PARAS.slice()),
      sec("Odpovědnost uživatele", [
        "Za správnost vstupních údajů a použití výsledků odpovídáte vy.",
      ]),
      sec("Externí služby", [
        EXTERNAL_REDIRECT,
        "InfoUzel.cz neodpovídá za obsah ani dostupnost externích služeb.",
      ]),
      sec("Odborné upozornění", [
        "Výpočty jsou pouze orientační. Nejde o investiční, finanční ani daňové poradenství.",
        "Výsledky vždy ověřte. U důležitých rozhodnutí zvažte konzultaci s odborníkem.",
      ]),
    ]),
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

  function shortTextFor(toolKey) {
    return SHORT_TEXTS[toolKey] || SHORT_TEXTS.datovka;
  }

  function buildHeadBlockHtml(toolKey) {
    return (
      '<button type="button" class="iu-tool-privacy-btn" data-iu-tool-privacy-open="' +
      esc(toolKey) +
      '" aria-haspopup="dialog">ⓘ Informace o soukromí a bezpečnosti</button>' +
      '<p class="iu-tool-privacy-short" role="note">' +
      esc(shortTextFor(toolKey)) +
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

    var shortP = document.createElement("p");
    shortP.className = "iu-tool-privacy-short";
    shortP.setAttribute("role", "note");
    shortP.textContent = shortTextFor(toolKey);
    btn.parentNode.insertBefore(shortP, btn.nextSibling);

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
      .map(function (secItem) {
        var ps = (secItem.paragraphs || [])
          .map(function (p) {
            return "<p>" + esc(p) + "</p>";
          })
          .join("");
        return (
          '<section class="iu-tool-privacy-modal__section">' +
          '<h3 class="iu-tool-privacy-modal__sectionTitle">' +
          esc(secItem.title) +
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
      '<div class="iu-tool-privacy-modal__scroll" id="iuToolPrivacyModalScroll">' +
      '<div class="iu-tool-privacy-modal__body" id="iuToolPrivacyModalBody"></div>' +
      "</div>" +
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
    document.body.classList.remove("iu-tool-privacy-modal-open");
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
    var scrollEl = modalEl.querySelector("#iuToolPrivacyModalScroll");
    if (titleEl) titleEl.textContent = MODAL_TITLES[key] || "Informace o soukromí";
    if (bodyEl) bodyEl.innerHTML = renderModalBody(key);
    if (scrollEl) scrollEl.scrollTop = 0;
    modalEl.hidden = false;
    modalEl.removeAttribute("hidden");
    modalEl.removeAttribute("aria-hidden");
    modalEl.setAttribute("aria-labelledby", "iuToolPrivacyModalTitle");
    document.body.classList.add("iu-tool-privacy-modal-open");
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
    window.iuToolPrivacyShortText = shortTextFor;
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
