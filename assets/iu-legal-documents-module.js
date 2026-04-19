/**
 * infoUzel.cz — generátor dokumentů (overlay UI).
 */
import {
  IU_LEGAL_CATEGORIES,
  IU_LEGAL_HIGH_RISK_NOTE,
  IU_LEGAL_MODULE_DISCLAIMER,
  createEmptyParty,
} from "./iu-legal-documents-schema.js";
import { IU_LEGAL_DOCUMENTS, getLegalDocumentById, listLegalDocumentsInCategory } from "./iu-legal-documents-registry.js";

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** @param {import('./iu-legal-documents-registry.js').LegalDocumentDef} doc */
export function createEmptyFormState(doc) {
  const content = {};
  (doc.contentFields || []).forEach((f) => {
    content[f.key] = "";
  });
  const extra = { misto: "", datum: "" };
  (doc.extraFields || []).forEach((f) => {
    extra[f.key] = "";
  });
  return {
    partyA: createEmptyParty(),
    partyB: createEmptyParty(),
    content,
    extra,
  };
}

function normSearch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function docMatchesFilters(d, q, tags) {
  const hay = normSearch(`${d.title} ${d.shortDescription} ${(d.tags || []).join(" ")}`);
  if (q && !hay.includes(normSearch(q))) return false;
  if (tags && tags.size) {
    const ok = Array.from(tags).some((t) => (d.tags || []).includes(t));
    if (!ok) return false;
  }
  return true;
}

function fieldInput(path, value, multiline, label) {
  if (multiline) {
    return `<label class="iu-legal-field"><span class="iu-legal-fieldLabel">${esc(label)}</span><textarea class="iu-legal-input" data-iu-legal-path="${esc(path)}" autocomplete="off" rows="4">${esc(value)}</textarea></label>`;
  }
  return `<label class="iu-legal-field"><span class="iu-legal-fieldLabel">${esc(label)}</span><input class="iu-legal-input" type="text" data-iu-legal-path="${esc(path)}" autocomplete="off" value="${esc(value)}" /></label>`;
}

function partyOptionsForDoc(doc) {
  const opts = [];
  if (doc.supportsNaturalPerson) opts.push({ v: "fo", l: "Fyzická osoba" });
  if (doc.supportsEntrepreneur) opts.push({ v: "zivnost", l: "Podnikající fyzická osoba" });
  if (doc.supportsLegalEntity) opts.push({ v: "po", l: "Právnická osoba" });
  if (!opts.length) opts.push({ v: "fo", l: "Fyzická osoba" });
  return opts
    .map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`)
    .join("");
}

function partyBlock(doc, prefix, heading) {
  const opts = partyOptionsForDoc(doc);
  const fo = [
    fieldInput(`${prefix}.firstName`, "", false, "Jméno"),
    fieldInput(`${prefix}.lastName`, "", false, "Příjmení"),
    fieldInput(`${prefix}.birthDate`, "", false, "Datum narození"),
    fieldInput(`${prefix}.address`, "", true, "Adresa / trvalé bydliště"),
  ].join("");
  const ziv = [
    fieldInput(`${prefix}.firstName`, "", false, "Jméno"),
    fieldInput(`${prefix}.lastName`, "", false, "Příjmení"),
    fieldInput(`${prefix}.tradeName`, "", false, "Obchodní firma (pokud používá)"),
    fieldInput(`${prefix}.ico`, "", false, "IČO"),
    fieldInput(`${prefix}.dic`, "", false, "DIČ"),
    fieldInput(`${prefix}.placeOfBusiness`, "", true, "Místo podnikání / sídlo"),
    fieldInput(`${prefix}.deliveryAddress`, "", true, "Adresa pro doručování (volitelně)"),
    fieldInput(`${prefix}.registryNote`, "", true, "Údaj o zápisu / evidenci (volitelně)"),
  ].join("");
  const po = [
    fieldInput(`${prefix}.companyName`, "", false, "Obchodní firma / název"),
    fieldInput(`${prefix}.legalForm`, "", false, "Právní forma"),
    fieldInput(`${prefix}.ico`, "", false, "IČO"),
    fieldInput(`${prefix}.dic`, "", false, "DIČ"),
    fieldInput(`${prefix}.registeredOffice`, "", true, "Sídlo"),
    fieldInput(`${prefix}.zapsanoV`, "", false, "Zapsána v / zapsán v"),
    fieldInput(`${prefix}.oddil`, "", false, "Oddíl"),
    fieldInput(`${prefix}.vlozka`, "", false, "Vložka"),
    fieldInput(`${prefix}.registryConsolidated`, "", false, "Spisová značka / rejstříkový údaj (souhrn, volitelně)"),
    fieldInput(`${prefix}.actingPerson`, "", false, "Osoba jednající za společnost"),
    fieldInput(`${prefix}.actingRole`, "", false, "Funkce osoby jednající"),
  ].join("");
  return `<section class="iu-legal-partySection" data-iu-legal-party-root="${esc(prefix)}">
    <h4 class="iu-legal-h4">${esc(heading)}</h4>
    <label class="iu-legal-field"><span class="iu-legal-fieldLabel">Typ subjektu</span>
      <select class="iu-legal-select" data-iu-legal-path="${esc(prefix)}.type" data-iu-legal-party-type="${esc(prefix)}">${opts}</select>
    </label>
    <div class="iu-legal-partyFields" data-iu-legal-pg="${esc(prefix)}" data-pg="fo">${fo}</div>
    <div class="iu-legal-partyFields" data-iu-legal-pg="${esc(prefix)}" data-pg="zivnost" hidden>${ziv}</div>
    <div class="iu-legal-partyFields" data-iu-legal-pg="${esc(prefix)}" data-pg="po" hidden>${po}</div>
  </section>`;
}

function readFormState(root, doc) {
  const state = createEmptyFormState(doc);
  root.querySelectorAll("[data-iu-legal-path]").forEach((el) => {
    const path = el.getAttribute("data-iu-legal-path") || "";
    const segs = path.split(".");
    if (segs.length < 2) return;
    const [a, b] = segs;
    if (a === "partyA" || a === "partyB") {
      state[a][b] = el.value;
    } else if (a === "content") {
      state.content[b] = el.value;
    } else if (a === "extra") {
      state.extra[b] = el.value;
    }
  });
  return state;
}

function syncPartyPanels(root) {
  ["partyA", "partyB"].forEach((px) => {
    const sel = root.querySelector(`[data-iu-legal-party-type="${px}"]`);
    const t = (sel && sel.value) || "fo";
    root.querySelectorAll(`[data-iu-legal-pg="${px}"]`).forEach((box) => {
      const g = box.getAttribute("data-pg");
      box.hidden = g !== t;
    });
  });
}

function applyPartyTypeConstraints(doc, root) {
  const allowed = new Set();
  if (doc.supportsNaturalPerson) allowed.add("fo");
  if (doc.supportsEntrepreneur) allowed.add("zivnost");
  if (doc.supportsLegalEntity) allowed.add("po");
  ["partyA", "partyB"].forEach((px) => {
    const sel = root.querySelector(`[data-iu-legal-party-type="${px}"]`);
    if (!sel) return;
    Array.from(sel.options).forEach((op) => {
      op.disabled = !allowed.has(op.value);
    });
    if (!allowed.has(sel.value)) {
      sel.value = allowed.has("fo") ? "fo" : Array.from(allowed)[0];
    }
  });
  syncPartyPanels(root);
}

/** @param {import('./iu-legal-documents-registry.js').LegalDocumentDef} doc */
function renderDocumentForm(doc) {
  const partyAHeading =
    doc.partyMode === "power"
      ? doc.partyLabels.a || "Zmocnitel"
      : doc.partyMode === "one"
        ? doc.partyLabels.a || "Subjekt"
        : doc.partyLabels.a || "Strana A";
  const partyBHeading =
    doc.partyMode === "power" ? doc.partyLabels.b || "Zmocněnec" : doc.partyLabels.b || "Strana B";

  let parties = "";
  if (doc.partyMode === "one") {
    parties = partyBlock(doc, "partyA", partyAHeading);
  } else {
    parties = partyBlock(doc, "partyA", partyAHeading) + partyBlock(doc, "partyB", partyBHeading);
  }

  const contentFields = (doc.contentFields || [])
    .map((f) => fieldInput(`content.${f.key}`, "", !!f.multiline, f.label))
    .join("");

  const extraBase = [
    fieldInput("extra.misto", "", false, "Místo podpisu"),
    fieldInput("extra.datum", "", false, "Datum"),
  ].join("");
  const extraMore = (doc.extraFields || [])
    .map((f) => fieldInput(`extra.${f.key}`, "", !!f.multiline, f.label))
    .join("");

  const riskBlock =
    doc.legalRiskLevel === "high"
      ? `<div class="iu-legal-risk iu-legal-risk--high" role="status"><strong>Zvýšená pozornost.</strong> ${esc(IU_LEGAL_HIGH_RISK_NOTE)}</div>`
      : doc.legalRiskLevel === "medium"
        ? `<div class="iu-legal-risk iu-legal-risk--medium" role="status">Standardní právní dopad — při nejistotě zvažte konzultaci.</div>`
        : "";

  const warn = doc.requiresSpecialWarning
    ? `<div class="iu-legal-warn" role="status">Tento typ dokumentu bývá citlivý. Před použitím pečlivě ověřte okolnosti.</div>`
    : "";

  const meta = `<div class="iu-legal-metaRow">
    <span class="iu-legal-badge iu-legal-badge--cx">${esc(doc.complexity)}</span>
    <span class="iu-legal-badge iu-legal-badge--risk">${esc(doc.legalRiskLevel)}</span>
    ${doc.supportsHandoverSection ? `<span class="iu-legal-badge iu-legal-badge--handover">předání</span>` : ""}
  </div>`;

  return `${meta}${warn}${riskBlock}
  <p class="iu-legal-docLead">${esc(doc.shortDescription)}</p>
  ${parties}
  <section class="iu-legal-block">
    <h4 class="iu-legal-h4">Obsah dokumentu</h4>
    <div class="iu-legal-fieldGrid">${contentFields || "<p class=\"iu-legal-muted\">Bez dalších polí.</p>"}</div>
  </section>
  <section class="iu-legal-block">
    <h4 class="iu-legal-h4">Doplňující údaje</h4>
    <div class="iu-legal-fieldGrid">${extraBase}${extraMore}</div>
  </section>
  <section class="iu-legal-block">
    <h4 class="iu-legal-h4">Náhled textu</h4>
    <textarea class="iu-legal-preview" readonly rows="14" data-iu-legal-preview aria-label="Náhled dokumentu"></textarea>
    <div class="iu-legal-actions">
      <button type="button" class="iu-legal-btn iu-legal-btn--primary" data-iu-legal-copy>Zkopírovat text</button>
    </div>
  </section>`;
}

export function initIuLegalDocumentsOverlay(deps) {
  const getLock = (deps && deps.iuSetViewportLock) || (typeof window !== "undefined" ? window.iuSetViewportLock : null);

  const backdrop = document.getElementById("iuLegalDocsBackdrop");
  const panel = document.getElementById("iuLegalDocsPanel");
  const scrollHost = document.getElementById("iuLegalDocsScrollHost");
  const views = document.getElementById("iuLegalDocsViews");
  const titleEl = document.getElementById("iuLegalDocsTitle");
  const subEl = document.getElementById("iuLegalDocsSub");
  const backBtn = document.getElementById("iuLegalDocsBack");
  const closeBtn = document.getElementById("iuLegalDocsClose");

  if (!backdrop || !panel || !scrollHost || !views || !titleEl) return null;

  const ui = {
    level: "hub",
    categoryId: null,
    docId: null,
    search: "",
    tagFilters: new Set(),
    lastFocus: null,
  };

  let previewTimer = 0;

  function setLock(on) {
    try {
      if (typeof getLock === "function") getLock(!!on);
    } catch (_) {}
  }

  function ensureInBody() {
    if (backdrop.parentElement === document.body && panel.parentElement === document.body) return true;
    const frag = document.createDocumentFragment();
    frag.appendChild(backdrop);
    frag.appendChild(panel);
    document.body.appendChild(frag);
    return true;
  }

  function applyBodyOpen(on) {
    try {
      if (on) {
        document.body.classList.add("iu-legal-docs-overlay-open", "iu-modal-open");
        panel.dataset.open = "1";
      } else {
        document.body.classList.remove("iu-legal-docs-overlay-open", "iu-modal-open");
        panel.dataset.open = "0";
      }
    } catch (_) {}
  }

  function setVis(open) {
    if (open) {
      backdrop.removeAttribute("hidden");
      panel.removeAttribute("hidden");
      try {
        backdrop.setAttribute("aria-hidden", "false");
        panel.setAttribute("aria-hidden", "false");
      } catch (_) {}
      try {
        if (window.iuSetElOpenVisible) {
          window.iuSetElOpenVisible(backdrop, true);
          window.iuSetElOpenVisible(panel, true);
        }
      } catch (_) {}
    } else {
      try {
        if (window.iuSetElOpenVisible) {
          window.iuSetElOpenVisible(backdrop, false);
          window.iuSetElOpenVisible(panel, false);
        }
      } catch (_) {}
      backdrop.setAttribute("hidden", "");
      panel.setAttribute("hidden", "");
      try {
        backdrop.setAttribute("aria-hidden", "true");
        panel.setAttribute("aria-hidden", "true");
      } catch (_) {}
    }
  }

  function filteredDocs() {
    return IU_LEGAL_DOCUMENTS.filter((d) => docMatchesFilters(d, ui.search, ui.tagFilters));
  }

  function renderHub() {
    ui.level = "hub";
    ui.categoryId = null;
    ui.docId = null;
    if (backBtn) backBtn.hidden = true;
    titleEl.textContent = "Vzory smluv a plné moci";
    if (subEl) subEl.textContent = "Generátor strukturovaných dokumentů";
    panel.classList.remove("iu-legal-overlay-panel--detail", "iu-legal-overlay-panel--category");
    panel.classList.add("iu-legal-overlay-panel--hub");

    const disc = `<p class="iu-legal-disclaimer">${esc(IU_LEGAL_MODULE_DISCLAIMER)}</p>`;
    const search = `<div class="iu-legal-searchRow">
      <label class="iu-legal-searchLabel"><span class="iu-legal-srOnly">Hledat</span>
        <input type="search" class="iu-legal-searchInput" data-iu-legal-search placeholder="Hledat v dokumentech…" autocomplete="off" value="${esc(ui.search)}" />
      </label>
    </div>`;
    const chips = [
      { id: "fo", label: "FO" },
      { id: "podnikatel", label: "Podnikatel" },
      { id: "firma", label: "Firma" },
    ]
      .map((c) => {
        const on = ui.tagFilters.has(c.id) ? " is-on" : "";
        return `<button type="button" class="iu-legal-chip${on}" data-iu-legal-tag="${esc(c.id)}">${esc(c.label)}</button>`;
      })
      .join("");

    const cats = IU_LEGAL_CATEGORIES.map((c) => {
      const n = filteredDocs().filter((d) => d.category === c.id).length;
      return `<button type="button" class="iu-legal-catCard" data-iu-legal-cat="${esc(c.id)}">
        <span class="iu-legal-catTitle">${esc(c.label)}</span>
        <span class="iu-legal-catCount">${n} dokumentů</span>
      </button>`;
    }).join("");

    const flat = filteredDocs();
    let flatBlock = "";
    if (ui.search.trim() || ui.tagFilters.size) {
      const rows = flat
        .map(
          (d) =>
            `<button type="button" class="iu-legal-docRow" data-iu-legal-open-doc="${esc(d.id)}">
            <span class="iu-legal-docRowTitle">${esc(d.title)}</span>
            <span class="iu-legal-docRowSub">${esc(d.shortDescription)}</span>
          </button>`,
        )
        .join("");
      flatBlock = `<section class="iu-legal-flat" aria-label="Výsledky vyhledávání">
        <h3 class="iu-legal-h3">Výsledky</h3>
        ${rows || "<p class=\"iu-legal-muted\">Žádný dokument nevyhovuje filtru.</p>"}
      </section>`;
    }

    views.innerHTML = `${disc}${search}<div class="iu-legal-chipRow" role="group" aria-label="Filtry">${chips}</div>
      <div class="iu-legal-catGrid" role="list">${cats}</div>${flatBlock}`;

    wireHubEvents();
  }

  function wireHubEvents() {
    const s = views.querySelector("[data-iu-legal-search]");
    if (s) {
      s.addEventListener("input", () => {
        ui.search = s.value;
        renderHub();
        try {
          views.querySelector("[data-iu-legal-search]")?.focus();
        } catch (_) {}
      });
    }
    views.querySelectorAll("[data-iu-legal-tag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-iu-legal-tag");
        if (!id) return;
        if (ui.tagFilters.has(id)) ui.tagFilters.delete(id);
        else ui.tagFilters.add(id);
        renderHub();
      });
    });
    views.querySelectorAll("[data-iu-legal-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-iu-legal-cat");
        if (id) renderCategory(id);
      });
    });
    views.querySelectorAll("[data-iu-legal-open-doc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-iu-legal-open-doc");
        if (id) renderDetail(id);
      });
    });
  }

  function renderCategory(catId) {
    ui.level = "category";
    ui.categoryId = catId;
    ui.docId = null;
    if (backBtn) backBtn.hidden = false;
    const cat = IU_LEGAL_CATEGORIES.find((c) => c.id === catId);
    titleEl.textContent = cat ? cat.label : "Kategorie";
    if (subEl) subEl.textContent = "Vyberte dokument";
    panel.classList.remove("iu-legal-overlay-panel--hub", "iu-legal-overlay-panel--detail");
    panel.classList.add("iu-legal-overlay-panel--category");

    const docs = listLegalDocumentsInCategory(catId).filter((d) => docMatchesFilters(d, ui.search, ui.tagFilters));
    const rows = docs
      .map((d) => {
        const hi = d.legalRiskLevel === "high" ? " iu-legal-docPick--high" : "";
        return `<button type="button" class="iu-legal-docPick${hi}" data-iu-legal-open-doc="${esc(d.id)}">
          <span class="iu-legal-docPickTitle">${esc(d.title)}</span>
          <span class="iu-legal-docPickDesc">${esc(d.shortDescription)}</span>
          <span class="iu-legal-docPickMeta">${esc(d.complexity)} · ${esc(d.legalRiskLevel)}</span>
        </button>`;
      })
      .join("");
    views.innerHTML = `<div class="iu-legal-docPickList" role="list">${rows || "<p class=\"iu-legal-muted\">Žádný dokument.</p>"}</div>`;
    views.querySelectorAll("[data-iu-legal-open-doc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-iu-legal-open-doc");
        if (id) renderDetail(id);
      });
    });
    try {
      scrollHost.scrollTop = 0;
    } catch (_) {}
  }

  function schedulePreview(root, doc) {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      previewTimer = 0;
      const ta = root.querySelector("[data-iu-legal-preview]");
      if (!ta || !doc) return;
      try {
        const st = readFormState(root, doc);
        ta.value = doc.buildText(st);
      } catch (_) {
        ta.value = "(Chyba při generování náhledu.)";
      }
    }, 100);
  }

  function renderDetail(docId) {
    const doc = getLegalDocumentById(docId);
    if (!doc) return;
    ui.categoryId = doc.category;
    ui.level = "detail";
    ui.docId = docId;
    if (backBtn) backBtn.hidden = false;
    titleEl.textContent = doc.title;
    if (subEl) subEl.textContent = "Vyplňte údaje a zkontrolujte náhled";
    panel.classList.remove("iu-legal-overlay-panel--hub", "iu-legal-overlay-panel--category");
    panel.classList.add("iu-legal-overlay-panel--detail");

    views.innerHTML = `<div class="iu-legal-detailInner" data-iu-legal-detail-root>${renderDocumentForm(doc)}</div>`;
    const root = views.querySelector("[data-iu-legal-detail-root]");
    if (!root) return;

    applyPartyTypeConstraints(doc, root);
    root.querySelectorAll("[data-iu-legal-party-type]").forEach((sel) => {
      sel.addEventListener("change", () => {
        applyPartyTypeConstraints(doc, root);
        schedulePreview(root, doc);
      });
    });
    root.addEventListener("input", () => schedulePreview(root, doc));
    root.addEventListener("change", () => schedulePreview(root, doc));

    const copyBtn = root.querySelector("[data-iu-legal-copy]");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const st = readFormState(root, doc);
        const text = doc.buildText(st);
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = "Zkopírováno";
          window.setTimeout(() => {
            copyBtn.textContent = "Zkopírovat text";
          }, 1600);
        } catch (_) {
          copyBtn.textContent = "Zkopírování selhalo";
        }
      });
    }

    schedulePreview(root, doc);
    try {
      scrollHost.scrollTop = 0;
    } catch (_) {}
  }

  function goBack() {
    if (ui.level === "detail") {
      if (ui.categoryId) renderCategory(ui.categoryId);
      else renderHub();
    } else if (ui.level === "category") {
      renderHub();
    }
  }

  function openSurface() {
    ui.lastFocus = document.activeElement;
    ensureInBody();
    setLock(true);
    applyBodyOpen(true);
    setVis(true);
    try {
      panel.classList.toggle("iu-legal-overlay-panel--mobile", window.matchMedia("(max-width: 1024px)").matches);
      panel.classList.toggle("iu-legal-overlay-panel--desktop", window.matchMedia("(min-width: 1025px)").matches);
    } catch (_) {}
    renderHub();
    try {
      if (closeBtn) closeBtn.focus();
    } catch (_) {}
  }

  function closeSurface() {
    setVis(false);
    setLock(false);
    applyBodyOpen(false);
    ui.level = "hub";
    ui.categoryId = null;
    ui.docId = null;
    views.innerHTML = "";
    try {
      if (ui.lastFocus && typeof ui.lastFocus.focus === "function") ui.lastFocus.focus();
    } catch (_) {}
  }

  if (backBtn) {
    backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      goBack();
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeSurface();
    });
  }
  backdrop.addEventListener("click", () => closeSurface());
  panel.addEventListener("click", (e) => {
    if (e.target === panel) closeSurface();
  });
  const cardShell = panel.querySelector(".iu-legal-overlay-cardShell");
  if (cardShell) {
    cardShell.addEventListener("click", (e) => e.stopPropagation());
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (panel.hasAttribute("hidden")) return;
    closeSurface();
  });

  try {
    window.iuLegalDocsOpenSurface = openSurface;
    window.iuLegalDocsCloseSurface = closeSurface;
    window.ensureLegalDocsModalInBody = ensureInBody;
  } catch (_) {}

  const api = { open: openSurface, close: closeSurface };
  try {
    window.__iuLegalDocuments = api;
  } catch (_) {}

  return api;
}
