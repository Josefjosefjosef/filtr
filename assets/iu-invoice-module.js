/**
 * infoUzel.cz — overlay „Vytvořit fakturu“ (UI vrstva).
 */
export const IU_INVOICE_MODULE_BUILD = "invoice-desktop-fullpage-v1-20260620";

import {
  applyBuyerSnapshot,
  applySupplierSnapshot,
  buildPlainText,
  computeTotals,
  defaultFormState,
  emptyLine,
  loadFormState,
  loadRecipients,
  loadSuppliers,
  nextAutoInvoiceNumber,
  persistFormState,
  saveRecipients,
  saveSuppliers,
  snapshotBuyer,
  snapshotSupplier,
  validateForm,
  validateSupplierProfile,
} from "./iu-invoice-engine.js";
import {
  IU_INVOICE_STATIC_NOTICE,
  confirmClearForm,
  guardProtectedAction,
} from "./iu-tool-guard.js";

let rasterModulePromise = null;
let pdfModulePromise = null;

function loadRasterModule() {
  if (!rasterModulePromise) {
    rasterModulePromise = import("./iu-invoice-raster-renderer.js");
  }
  return rasterModulePromise;
}

function loadPdfModule() {
  if (!pdfModulePromise) {
    pdfModulePromise = import("./iu-invoice-pdf-renderer.js");
  }
  return pdfModulePromise;
}

async function ensureInvoiceOverlayCssReady() {
  try {
    if (typeof window !== "undefined" && typeof window.iuEnsureOverlayCss === "function") {
      await window.iuEnsureOverlayCss("iu-invoice-overlay.css");
      return true;
    }
  } catch (_) {}
  try {
    const link = document.querySelector('link[href*="iu-invoice-overlay.css"]');
    if (!link) return false;
    try {
      link.media = "all";
    } catch (_) {}
    if (link.sheet) return true;
    return await new Promise((resolve) => {
      const finish = () => resolve(!!link.sheet);
      link.addEventListener("load", finish, { once: true });
      link.addEventListener("error", () => resolve(false), { once: true });
      window.setTimeout(finish, 3000);
    });
  } catch (_) {
    return false;
  }
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function fieldText(path, label, value, opts) {
  const ph = opts && opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : "";
  const req = opts && opts.required ? " required" : "";
  return `<label class="iu-inv-field"><span class="iu-inv-label">${esc(label)}</span><input class="iu-inv-input" type="text" data-inv="${esc(path)}" value="${esc(value)}" autocomplete="off"${ph}${req} /></label>`;
}

function fieldArea(path, label, value) {
  return `<label class="iu-inv-field"><span class="iu-inv-label">${esc(label)}</span><textarea class="iu-inv-textarea" data-inv="${esc(path)}" rows="3" autocomplete="off">${esc(value)}</textarea></label>`;
}

function fieldDate(path, label, value) {
  return `<label class="iu-inv-field"><span class="iu-inv-label">${esc(label)}</span><input class="iu-inv-input" type="date" data-inv="${esc(path)}" value="${esc(value)}" /></label>`;
}

function fieldSelect(path, label, value, options) {
  const opts = options
    .map((o) => `<option value="${esc(o.v)}"${String(value) === String(o.v) ? " selected" : ""}>${esc(o.l)}</option>`)
    .join("");
  return `<label class="iu-inv-field"><span class="iu-inv-label">${esc(label)}</span><select class="iu-inv-select" data-inv="${esc(path)}">${opts}</select></label>`;
}

function kindRadios(name, current) {
  return `<label class="iu-inv-toggle"><input type="radio" name="${esc(name)}" value="fo"${current === "fo" ? " checked" : ""} /> <span>Fyzická osoba</span></label>
  <label class="iu-inv-toggle"><input type="radio" name="${esc(name)}" value="po"${current === "po" ? " checked" : ""} /> <span>Právnická osoba</span></label>`;
}

function renderFormShell() {
  return `<div class="iu-inv-root" data-iu-invoice-root data-export-mode="pdf_only">

  <section class="iu-inv-block iu-inv-supplierBlock" aria-labelledby="iu-inv-h-sup" data-iu-inv-supplier-active="fo">
    <h3 class="iu-inv-h" id="iu-inv-h-sup">Dodavatel</h3>
    <div class="iu-inv-recipientRow">
      <label class="iu-inv-field iu-inv-field--grow"><span class="iu-inv-label">Uložení dodavatele</span>
        <select class="iu-inv-select" data-inv-supplier-select><option value="">— Vyberte uloženého —</option></select>
      </label>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-supplier-load>Načíst</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-supplier-save>Uložit dodavatele</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-supplier-delete>Smazat z listu</button>
    </div>
    <div class="iu-inv-seg" role="group" aria-label="Typ dodavatele">
      ${kindRadios("iu-sup-kind", "fo")}
    </div>
    <div class="iu-inv-fieldGrid iu-inv-formPanel" data-inv-panel="supplierFo" data-iu-inv-form-role="supplier-fo"></div>
    <div class="iu-inv-fieldGrid iu-inv-formPanel iu-inv-guard-layout-off" data-inv-panel="supplierPo" data-iu-inv-form-role="supplier-po" hidden></div>
    <div class="iu-inv-fieldGrid">
      ${fieldSelect("supplierVatPayer", "Režim DPH", "1", [
        { v: "1", l: "Plátce DPH" },
        { v: "0", l: "Neplátce DPH" },
      ])}
    </div>
  </section>

  <section class="iu-inv-block iu-inv-buyerBlock" aria-labelledby="iu-inv-h-buy" data-iu-inv-buyer-active="fo">
    <h3 class="iu-inv-h" id="iu-inv-h-buy">Odběratel</h3>
    <div class="iu-inv-recipientRow">
      <label class="iu-inv-field iu-inv-field--grow"><span class="iu-inv-label">Uložení odběratele</span>
        <select class="iu-inv-select" data-inv-recipient-select><option value="">— Vyberte uloženého —</option></select>
      </label>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-recipient-load>Načíst</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-recipient-save>Uložit odběratele</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-recipient-delete>Smazat z listu</button>
    </div>
    <div class="iu-inv-seg" role="group" aria-label="Typ odběratele">
      ${kindRadios("iu-buy-kind", "fo")}
    </div>
    <div class="iu-inv-fieldGrid iu-inv-formPanel" data-inv-panel="buyerFo" data-iu-inv-form-role="buyer-fo"></div>
    <div class="iu-inv-fieldGrid iu-inv-formPanel iu-inv-guard-layout-off" data-inv-panel="buyerPo" data-iu-inv-form-role="buyer-po" hidden></div>
  </section>

  <section class="iu-inv-block" aria-labelledby="iu-inv-h-inv">
    <h3 class="iu-inv-h" id="iu-inv-h-inv">Faktura</h3>
    <div class="iu-inv-fieldGrid iu-inv-fieldGrid--2">
      ${fieldText("invoice.number", "Číslo faktury", "")}
      <label class="iu-inv-field iu-inv-field--check"><span class="iu-inv-label">Číslo</span>
        <span class="iu-inv-inline"><input type="checkbox" data-inv-auto-num checked /> <span>Generovat automaticky</span></span>
      </label>
      ${fieldDate("invoice.issueDate", "Datum vystavení", "")}
      ${fieldDate("invoice.dueDate", "Datum splatnosti", "")}
      ${fieldDate("invoice.taxableDate", "Datum uskutečnění plnění (DUZP)", "")}
      ${fieldText("invoice.variableSymbol", "Variabilní symbol", "")}
      ${fieldSelect("invoice.payment", "Způsob úhrady", "transfer", [
        { v: "cash", l: "Hotově" },
        { v: "transfer", l: "Převodem" },
      ])}
    </div>
    <div class="iu-inv-fieldGrid iu-inv-guard-hidden" data-inv-bank-block hidden>
      ${fieldText("invoice.accountNumber", "Číslo účtu", "")}
      ${fieldText("invoice.bankCode", "Kód banky", "", { placeholder: "např. 0800" })}
      ${fieldText("invoice.iban", "IBAN (nepovinně)", "")}
      ${fieldText("invoice.swift", "SWIFT (nepovinně)", "")}
    </div>
  </section>

  <section class="iu-inv-block" aria-labelledby="iu-inv-h-lines">
    <h3 class="iu-inv-h" id="iu-inv-h-lines">Položky</h3>
    <div data-inv-lines-wrap></div>
    <div class="iu-inv-lineActions">
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-add-line>+ Přidat položku</button>
    </div>
  </section>

  <section class="iu-inv-block" aria-labelledby="iu-inv-h-sum">
    <h3 class="iu-inv-h" id="iu-inv-h-sum">Souhrn</h3>
    <div class="iu-inv-summary" data-inv-summary></div>
    <div class="iu-invoice-actions-static iu-inv-actionsRow" data-inv-actions>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-copy>Kopírovat text</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--primary" data-inv-preview>Náhled faktury</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-download>Stáhnout</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--primary" data-inv-share-pdf>Sdílet PDF</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-clear-form>Vyčistit formulář</button>
    </div>
    <p class="iu-inv-staticNotice">${esc(IU_INVOICE_STATIC_NOTICE)}</p>
  </section>

  <div class="iu-inv-status" data-inv-status role="status" aria-live="polite"></div>
  <div class="iu-inv-pdfReadyRow iu-inv-guard-hidden" data-inv-pdf-ready-row hidden>
    <button type="button" class="iu-inv-btn iu-inv-btn--primary" data-inv-open-pdf>Otevřít PDF</button>
    <span class="iu-inv-pdfReadyHint">PDF je připravené — klepnutím otevřete soubor (iPhone/Safari).</span>
  </div>

  <div class="iu-inv-previewLayer iu-inv-guard-hidden" data-inv-preview-layer hidden>
    <div class="iu-inv-previewToolbar">
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-preview-back>Zpět do formuláře</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-preview-download>Stáhnout fakturu</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--primary" data-inv-preview-share-pdf>Sdílet PDF</button>
    </div>
    <div class="iu-inv-previewScroll" data-inv-preview-host></div>
  </div>
</div>`;
}

function renderSupplierFo(st) {
  const fo = st.supplierFo || {};
  return [
    fieldText("supplierFo.firstName", "Jméno", fo.firstName, { required: true }),
    fieldText("supplierFo.lastName", "Příjmení", fo.lastName, { required: true }),
    fieldText("supplierFo.tradeName", "Obchodní název (nepovinně)", fo.tradeName),
    fieldText("supplierFo.ico", "IČO", fo.ico, { required: true }),
    fieldText("supplierFo.dic", "DIČ", fo.dic),
    fieldArea("supplierFo.address", "Adresa", fo.address),
    fieldText("supplierFo.phone", "Telefon (nepovinně)", fo.phone),
    fieldText("supplierFo.email", "E-mail (nepovinně)", fo.email),
    fieldText("supplierFo.accountNumber", "Číslo účtu", fo.accountNumber, { required: true }),
    fieldText("supplierFo.bank", "Banka (nepovinně)", fo.bank),
  ].join("");
}

function renderSupplierPo(st) {
  const po = st.supplierPo || {};
  return [
    fieldText("supplierPo.companyName", "Název společnosti", po.companyName, { required: true }),
    fieldText("supplierPo.legalForm", "Právní forma", po.legalForm, { required: true }),
    fieldText("supplierPo.ico", "IČO", po.ico, { required: true }),
    fieldText("supplierPo.dic", "DIČ", po.dic),
    fieldArea("supplierPo.address", "Sídlo", po.address),
    fieldText("supplierPo.fileMark", "Spisová značka", po.fileMark, { required: true }),
    fieldText("supplierPo.courtRegistry", "Zápis u soudu / rejstříku", po.courtRegistry, { required: true }),
    fieldText("supplierPo.contactPerson", "Jednatel / kontaktní osoba (nepovinně)", po.contactPerson),
    fieldText("supplierPo.phone", "Telefon (nepovinně)", po.phone),
    fieldText("supplierPo.email", "E-mail (nepovinně)", po.email),
    fieldText("supplierPo.accountNumber", "Číslo účtu", po.accountNumber, { required: true }),
    fieldText("supplierPo.bank", "Banka (nepovinně)", po.bank),
  ].join("");
}

function renderBuyerFo(st) {
  const fo = st.buyerFo || {};
  return [
    fieldText("buyerFo.firstName", "Jméno", fo.firstName, { required: true }),
    fieldText("buyerFo.lastName", "Příjmení", fo.lastName, { required: true }),
    fieldText("buyerFo.ico", "IČO (nepovinně)", fo.ico),
    fieldText("buyerFo.dic", "DIČ (nepovinně)", fo.dic),
    fieldArea("buyerFo.address", "Adresa", fo.address),
    fieldText("buyerFo.phone", "Telefon (nepovinně)", fo.phone),
    fieldText("buyerFo.email", "E-mail (nepovinně)", fo.email),
  ].join("");
}

function renderBuyerPo(st) {
  const po = st.buyerPo || {};
  return [
    fieldText("buyerPo.companyName", "Název společnosti", po.companyName, { required: true }),
    fieldText("buyerPo.legalForm", "Právní forma", po.legalForm, { required: true }),
    fieldText("buyerPo.ico", "IČO", po.ico, { required: true }),
    fieldText("buyerPo.dic", "DIČ", po.dic),
    fieldArea("buyerPo.address", "Sídlo", po.address),
    fieldText("buyerPo.fileMark", "Spisová značka", po.fileMark, { required: true }),
    fieldText("buyerPo.courtRegistry", "Zápis u soudu / rejstříku", po.courtRegistry, { required: true }),
    fieldText("buyerPo.contactPerson", "Kontaktní osoba (nepovinně)", po.contactPerson),
    fieldText("buyerPo.phone", "Telefon (nepovinně)", po.phone),
    fieldText("buyerPo.email", "E-mail (nepovinně)", po.email),
  ].join("");
}

function vatOptions(payer) {
  if (!payer) return [{ v: "0", l: "bez DPH" }];
  return [
    { v: "0", l: "0 %" },
    { v: "5", l: "5 %" },
    { v: "10", l: "10 %" },
    { v: "15", l: "15 %" },
    { v: "21", l: "21 %" },
  ];
}

function lineInput(id, field, label, value, req) {
  const r = req ? " required" : "";
  return `<label class="iu-inv-field"><span class="iu-inv-label">${esc(label)}</span><input class="iu-inv-input" type="text" data-inv-line="${esc(id)}" data-inv-line-field="${esc(
    field,
  )}" value="${esc(value)}" autocomplete="off"${r} /></label>`;
}

function lineArea(id, field, label, value) {
  return `<label class="iu-inv-field"><span class="iu-inv-label">${esc(label)}</span><textarea class="iu-inv-textarea" data-inv-line="${esc(id)}" data-inv-line-field="${esc(
    field,
  )}" rows="2" autocomplete="off">${esc(value)}</textarea></label>`;
}

function renderLines(st, root) {
  const wrap = root.querySelector("[data-inv-lines-wrap]");
  if (!wrap) return;
  const payer = !!st.supplierVatPayer;
  const rows = (st.lines || []).map((ln, idx) => {
    const vatCell = payer
      ? `<label class="iu-inv-field iu-inv-field--compact"><span class="iu-inv-label">DPH</span><select class="iu-inv-select" data-inv-line="${esc(ln.id)}" data-inv-line-field="vatRate">${vatOptions(true)
          .map((o) => `<option value="${esc(o.v)}"${String(ln.vatRate) === String(o.v) ? " selected" : ""}>${esc(o.l)}</option>`)
          .join("")}</select></label>`
      : `<input type="hidden" data-inv-line="${esc(ln.id)}" data-inv-line-field="vatRate" value="0" />`;
    return `<div class="iu-inv-lineCard" data-line-id="${esc(ln.id)}">
      <div class="iu-inv-lineCardTop"><span class="iu-inv-lineTitle">Položka ${idx + 1}</span>
        <span class="iu-inv-lineBtns">
          <button type="button" class="iu-inv-btn iu-inv-btn--mini" data-inv-dup-line="${esc(ln.id)}">Duplikovat</button>
          <button type="button" class="iu-inv-btn iu-inv-btn--mini" data-inv-del-line="${esc(ln.id)}">Smazat</button>
        </span>
      </div>
      <div class="iu-inv-fieldGrid">
        ${lineInput(ln.id, "name", "Název", ln.name, true)}
        ${lineArea(ln.id, "description", "Popis (nepovinně)", ln.description || "")}
        ${lineInput(ln.id, "qty", "Množství", ln.qty, true)}
        ${lineInput(ln.id, "unit", "Jednotka", ln.unit || "ks", false)}
        ${lineInput(ln.id, "unitPrice", "Cena za jednotku", ln.unitPrice, true)}
        ${vatCell}
      </div>
    </div>`;
  });
  wrap.innerHTML = rows.join("");
}

function readLineFromCard(card, st) {
  const id = card.getAttribute("data-line-id");
  const ln = (st.lines || []).find((x) => x.id === id);
  if (!ln) return;
  card.querySelectorAll("[data-inv-line-field]").forEach((el) => {
    const f = el.getAttribute("data-inv-line-field");
    if (!f) return;
    ln[f] = el.value;
  });
}

function readStateFromDom(root, st) {
  const sk = root.querySelector('input[name="iu-sup-kind"]:checked');
  if (sk) st.supplierKind = sk.value === "po" ? "po" : "fo";
  const bk = root.querySelector('input[name="iu-buy-kind"]:checked');
  if (bk) st.buyerKind = bk.value === "po" ? "po" : "fo";
  const activeSup = st.supplierKind === "po" ? "supplierPo" : "supplierFo";
  const activeBuy = st.buyerKind === "po" ? "buyerPo" : "buyerFo";
  root.querySelectorAll("[data-inv]").forEach((el) => {
    const path = el.getAttribute("data-inv");
    if (!path) return;
    const segs = path.split(".");
    if (segs.length < 2) return;
    const a = segs[0];
    const b = segs[1];
    if (a === "supplierFo" || a === "supplierPo") {
      if (a !== activeSup) return;
    }
    if (a === "buyerFo" || a === "buyerPo") {
      if (a !== activeBuy) return;
    }
    if (a === "supplierFo" || a === "supplierPo" || a === "buyerFo" || a === "buyerPo" || a === "invoice") {
      if (!st[a]) st[a] = {};
      st[a][b] = el.value;
    }
  });
  const vatSel = root.querySelector('[data-inv="supplierVatPayer"]');
  if (vatSel) st.supplierVatPayer = String(vatSel.value) === "1";

  const auto = root.querySelector("[data-inv-auto-num]");
  if (auto) st.invoice.autoNumber = !!auto.checked;

  root.querySelectorAll(".iu-inv-lineCard").forEach((card) => readLineFromCard(card, st));
}

function writeStateToDom(root, st) {
  root.querySelectorAll("[data-inv]").forEach((el) => {
    const path = el.getAttribute("data-inv");
    if (!path) return;
    const segs = path.split(".");
    if (segs.length < 2) return;
    const a = segs[0];
    const b = segs[1];
    const bag = st[a];
    if (bag && Object.prototype.hasOwnProperty.call(bag, b)) el.value = bag[b] == null ? "" : String(bag[b]);
  });
  const vatSel = root.querySelector('[data-inv="supplierVatPayer"]');
  if (vatSel) vatSel.value = st.supplierVatPayer ? "1" : "0";
  const auto = root.querySelector("[data-inv-auto-num]");
  if (auto) auto.checked = !!st.invoice.autoNumber;

  root.querySelectorAll('input[name="iu-sup-kind"]').forEach((r) => {
    r.checked = r.value === st.supplierKind;
  });
  root.querySelectorAll('input[name="iu-buy-kind"]').forEach((r) => {
    r.checked = r.value === st.buyerKind;
  });

  syncPanels(root, st);
  renderLines(st, root);
  root.querySelectorAll(".iu-inv-lineCard").forEach((card) => {
    const id = card.getAttribute("data-line-id");
    const ln = (st.lines || []).find((x) => x.id === id);
    if (!ln) return;
    card.querySelectorAll("[data-inv-line-field]").forEach((el) => {
      const f = el.getAttribute("data-inv-line-field");
      if (!f) return;
      el.value = ln[f] == null ? "" : String(ln[f]);
    });
  });
  updateBankBlock(root, st);
  updateSummary(root, st);
}

function syncPanels(root, st) {
  const supSec = root.querySelector(".iu-inv-supplierBlock");
  if (supSec) supSec.setAttribute("data-iu-inv-supplier-active", st.supplierKind === "po" ? "po" : "fo");
  const buySec = root.querySelector(".iu-inv-buyerBlock");
  if (buySec) buySec.setAttribute("data-iu-inv-buyer-active", st.buyerKind === "po" ? "po" : "fo");
  const pfo = root.querySelector('[data-inv-panel="supplierFo"]');
  const ppo = root.querySelector('[data-inv-panel="supplierPo"]');
  const bfo = root.querySelector('[data-inv-panel="buyerFo"]');
  const bpo = root.querySelector('[data-inv-panel="buyerPo"]');
  const showSupFo = st.supplierKind === "fo";
  const showSupPo = st.supplierKind === "po";
  const showBuyFo = st.buyerKind === "fo";
  const showBuyPo = st.buyerKind === "po";
  if (pfo) {
    pfo.hidden = !showSupFo;
    pfo.classList.toggle("iu-inv-guard-layout-off", !showSupFo);
    pfo.classList.toggle("iu-inv-active-form", showSupFo);
  }
  if (ppo) {
    ppo.hidden = !showSupPo;
    ppo.classList.toggle("iu-inv-guard-layout-off", !showSupPo);
    ppo.classList.toggle("iu-inv-active-form", showSupPo);
  }
  if (bfo) {
    bfo.hidden = !showBuyFo;
    bfo.classList.toggle("iu-inv-guard-layout-off", !showBuyFo);
    bfo.classList.toggle("iu-inv-active-form", showBuyFo);
  }
  if (bpo) {
    bpo.hidden = !showBuyPo;
    bpo.classList.toggle("iu-inv-guard-layout-off", !showBuyPo);
    bpo.classList.toggle("iu-inv-active-form", showBuyPo);
  }
}

function updateBankBlock(root, st) {
  const block = root.querySelector("[data-inv-bank-block]");
  if (!block) return;
  const on = (st.invoice || {}).payment === "transfer";
  block.hidden = !on;
  block.classList.toggle("iu-inv-guard-hidden", !on);
}

function updateSummary(root, st) {
  const el = root.querySelector("[data-inv-summary]");
  if (!el) return;
  const t = computeTotals(st);
  let html = "";
  if (t.payer) {
    html += `<div>Mezisoučet bez DPH: <strong>${esc(fmtMoneyNum(t.sumBase))}</strong></div>`;
    html += `<div>DPH celkem: <strong>${esc(fmtMoneyNum(t.sumVat))}</strong></div>`;
  }
  html += `<div class="iu-inv-summaryDue">Celkem k úhradě: ${esc(fmtMoneyNum(t.sumGross))}</div>`;
  el.innerHTML = html;
}

function fmtMoneyNum(n) {
  if (!Number.isFinite(n)) return "— Kč";
  try {
    return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " Kč";
  } catch (_) {
    return String(n) + " Kč";
  }
}

function fillRecipientSelect(root, list) {
  const sel = root.querySelector("[data-inv-recipient-select]");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Vyberte uloženého —</option>';
  list.forEach((r) => {
    const op = document.createElement("option");
    op.value = r.id;
    op.textContent = r.label;
    sel.appendChild(op);
  });
  if (cur && list.some((x) => x.id === cur)) sel.value = cur;
}

function supplierListLabel(snap) {
  if (snap.supplierKind === "po") {
    const nm = String((snap.supplierPo && snap.supplierPo.companyName) || "").trim();
    const ico = String((snap.supplierPo && snap.supplierPo.ico) || "").trim();
    return (nm || "Firma") + (ico ? " · IČ " + ico : "");
  }
  const fn = String((snap.supplierFo && snap.supplierFo.firstName) || "").trim();
  const ln = String((snap.supplierFo && snap.supplierFo.lastName) || "").trim();
  const ico = String((snap.supplierFo && snap.supplierFo.ico) || "").trim();
  const nm = (fn + " " + ln).trim();
  return (nm || "FO") + (ico ? " · IČ " + ico : "");
}

function fillSupplierSelect(root, list) {
  const sel = root.querySelector("[data-inv-supplier-select]");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Vyberte uloženého —</option>';
  list.forEach((r) => {
    const op = document.createElement("option");
    op.value = r.id;
    op.textContent = r.label;
    sel.appendChild(op);
  });
  if (cur && list.some((x) => x.id === cur)) sel.value = cur;
}

function setStatus(root, msg) {
  const el = root.querySelector("[data-inv-status]");
  if (el) el.textContent = msg || "";
}

function copySupplierBankToInvoiceIfEmpty(st) {
  const inv = st.invoice || {};
  if (String(inv.accountNumber || "").trim()) return;
  let acc = "";
  if (st.supplierKind === "fo") acc = (st.supplierFo && st.supplierFo.accountNumber) || "";
  else acc = (st.supplierPo && st.supplierPo.accountNumber) || "";
  if (acc) st.invoice.accountNumber = acc;
}

function publishInvoiceFirstClickDiag(extra) {
  try {
    const panel = document.getElementById("iuInvoicePanel");
    const rect = panel ? panel.getBoundingClientRect() : null;
    const hidden = panel ? panel.hasAttribute("hidden") : true;
    const cs = panel && !hidden ? window.getComputedStyle(panel) : null;
    const visible = !!(panel && !hidden && rect && rect.width > 80 && rect.height > 80 && cs && cs.display !== "none" && cs.visibility !== "hidden");
    const isDesktop = window.matchMedia && window.matchMedia("(min-width: 1025px)").matches;
    const isMobile = window.matchMedia && window.matchMedia("(max-width: 767px)").matches;
    const isTablet = window.matchMedia && window.matchMedia("(min-width: 768px) and (max-width: 1024px)").matches;
    window._iuInvoiceFirstClickDiag = Object.assign(
      {
        INVOICE_OVERLAY_VISIBLE_AFTER_FIRST_CLICK: visible,
        DESKTOP_FIRST_CLICK_OPENS_INVOICE: isDesktop ? visible : true,
        MOBILE_FIRST_TAP_OPENS_INVOICE: isMobile ? visible : true,
        TABLET_FIRST_TAP_OPENS_INVOICE: isTablet ? visible : true,
        NO_DOUBLE_CLICK_REQUIRED: (window.__iuInvoiceLauncherClickCount || 0) <= 1,
        LAZY_INIT_DOES_NOT_CONSUME_FIRST_CLICK: true,
      },
      extra || {},
    );
  } catch (_) {}
}

function installInvoiceLauncherDelegation(openSurfaceFn) {
  try {
    if (typeof document === "undefined" || window.__iuInvoiceLauncherInstalled) return;
    window.__iuInvoiceLauncherInstalled = true;
    async function bootOnly() {
      await ensureInvoiceOverlayCssReady();
      try {
        if (typeof window.ensureInvoiceModalInBody === "function") window.ensureInvoiceModalInBody();
      } catch (_) {}
    }
    async function openFromLauncher(e, kind) {
      const trigger = e && e.target && e.target.closest ? e.target.closest('[data-iuq="faktura"]') : null;
      if (!trigger) return;
      if (e && e.__iuInvoiceLauncherHandled) return;
      if (e) {
        e.__iuInvoiceLauncherHandled = true;
        e.__iuHandled = true;
        try {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        } catch (_) {}
      }
      try {
        if (typeof window.iuForceCloseAllOverlays === "function") window.iuForceCloseAllOverlays();
      } catch (_) {}
      await bootOnly();
      if (typeof openSurfaceFn === "function") {
        await Promise.resolve(openSurfaceFn());
      } else if (typeof window.iuInvoiceOpenSurface === "function") {
        await Promise.resolve(window.iuInvoiceOpenSurface());
      }
      publishInvoiceFirstClickDiag({ handlerKind: kind || "click", clickCount: (window.__iuInvoiceLauncherClickCount = (window.__iuInvoiceLauncherClickCount || 0) + 1) });
    }
    document.addEventListener(
      "pointerdown",
      function (e) {
        const trigger = e.target && e.target.closest ? e.target.closest('[data-iuq="faktura"]') : null;
        if (trigger) void bootOnly();
      },
      true,
    );
    document.addEventListener(
      "click",
      function (e) {
        void openFromLauncher(e, "click");
      },
      true,
    );
    document.addEventListener(
      "touchend",
      function (e) {
        void openFromLauncher(e, "touch");
      },
      { capture: true, passive: false },
    );
  } catch (_) {}
}

export function initIuInvoiceOverlay(deps) {
  try {
    if (typeof window.iuEnsureInvoicePdfLegacyExport === "function") void window.iuEnsureInvoicePdfLegacyExport();
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.__iuInvoiceOverlayInitialized) {
      if (typeof window.iuInvoiceOpenSurface === "function" && typeof window.iuInvoiceCloseSurface === "function") {
        return { open: window.iuInvoiceOpenSurface, close: window.iuInvoiceCloseSurface };
      }
    }
  } catch (_) {}

  const getLock = (deps && deps.iuSetViewportLock) || (typeof window !== "undefined" ? window.iuSetViewportLock : null);

  const backdrop = document.getElementById("iuInvoiceBackdrop");
  const panel = document.getElementById("iuInvoicePanel");
  const scrollHost = document.getElementById("iuInvoiceScrollHost");
  const mount = document.getElementById("iuInvoiceMount");
  const closeBtn = document.getElementById("iuInvoiceClose");

  if (!backdrop || !panel || !scrollHost || !mount) return null;

  try {
    const cssLink = document.querySelector('link[href*="iu-invoice-overlay.css"]');
    if (cssLink && String(cssLink.href || "").indexOf("invoice-preview-pc-v1") === -1) {
      cssLink.href = "/assets/iu-invoice-overlay.css?v=invoice-preview-pc-v1-20260708";
    }
  } catch (_) {}

  let state = loadFormState() || defaultFormState();
  let saveTimer = 0;
  let rootEl = null;
  let readyPdfBundle = null;
  let previewRasterBundle = null;
  let previewRasterKey = "";
  let iosPdfPopup = null;
  let closePreviewFn = null;
  let previewPortalHost = null;
  let previewEventTrace = {
    clickEvents: 0,
    touchEvents: 0,
    pointerEvents: 0,
    handlerCalls: 0,
    handlerEntered: 0,
    validationBlocked: 0,
    lastValidationResult: "",
    closeWorks: false,
  };
  let previewOpenCoreFn = null;

  const PREVIEW_PORTAL_HTML =
    '<div class="iu-inv-previewToolbar">' +
    '<button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-preview-back>Zpět do formuláře</button>' +
    '<button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-preview-download>Stáhnout fakturu</button>' +
    '<button type="button" class="iu-inv-btn iu-inv-btn--primary" data-inv-preview-share-pdf>Sdílet PDF</button>' +
    "</div>" +
    '<div class="iu-inv-previewScroll" data-inv-preview-host></div>';

  function sealPreviewPortalClosed(el) {
    if (!el) return;
    if (el.classList.contains("iu-invoice-preview-portal--open") || el.getAttribute("data-preview-open") === "1") return;
    el.hidden = true;
    el.setAttribute("hidden", "");
    el.classList.add("iu-inv-guard-hidden");
    try {
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("pointer-events", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
    } catch (_) {}
  }

  function ensurePreviewPortalHost() {
    let el = document.getElementById("iuInvoicePreviewPortal");
    if (el && el.tagName === "DIALOG") {
      try {
        if (el.open && typeof el.close === "function") el.close();
      } catch (_) {}
      try {
        el.remove();
      } catch (_) {}
      el = null;
      previewPortalHost = null;
    }
    if (previewPortalHost && previewPortalHost.isConnected && previewPortalHost.tagName !== "DIALOG") {
      sealPreviewPortalClosed(previewPortalHost);
      return previewPortalHost;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = "iuInvoicePreviewPortal";
      el.className = "iu-inv-previewLayer iu-invoice-preview-portal";
      el.setAttribute("data-inv-preview-layer", "");
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Náhled faktury");
      el.hidden = true;
      el.innerHTML = PREVIEW_PORTAL_HTML;
      document.body.appendChild(el);
      sealPreviewPortalClosed(el);
    }
    if (!el.querySelector("[data-inv-preview-host]")) {
      el.innerHTML = PREVIEW_PORTAL_HTML;
    }
    sealPreviewPortalClosed(el);
    previewPortalHost = el;
    return el;
  }

  function findPreviewLayerEl(root) {
    const portal = ensurePreviewPortalHost();
    if (portal) return portal;
    if (root) {
      const inRoot = root.querySelector("[data-inv-preview-layer]");
      if (inRoot) return inRoot;
    }
    return panel ? panel.querySelector("[data-inv-preview-layer]") : null;
  }

  function publishPreviewDiag(layer, extra) {
    try {
      const cs = layer ? window.getComputedStyle(layer) : null;
      const rect = layer ? layer.getBoundingClientRect() : null;
      const scrollHostEl = document.getElementById("iuInvoiceScrollHost");
      const cardShellEl = panel ? panel.querySelector(".iu-invoice-overlay-cardShell") : null;
      const cardCs = cardShellEl ? window.getComputedStyle(cardShellEl) : null;
      const btn = rootEl ? rootEl.querySelector("button[data-inv-preview]") : null;
      let clipped = false;
      if (layer && rect) {
        clipped = rect.width < 50 || rect.height < 50 || rect.bottom < 0 || rect.right < 0;
      }
      const disp = cs ? cs.display : "";
      const fullscreen =
        !!(cs && cs.position === "fixed" && rect && rect.width >= (window.innerWidth || 0) * 0.92 && rect.height >= (window.innerHeight || 0) * 0.92);
      window._iuInvoicePreviewDiag = Object.assign(
        {
          PREVIEW_BUTTON_FOUND: !!btn,
          PREVIEW_BUTTON_CLICK: previewEventTrace.clickEvents > 0 || previewEventTrace.touchEvents > 0,
          PREVIEW_CLICK_EVENT_FIRED: previewEventTrace.clickEvents,
          PREVIEW_TOUCH_EVENT_FIRED: previewEventTrace.touchEvents,
          PREVIEW_POINTER_EVENT_FIRED: previewEventTrace.pointerEvents,
          PREVIEW_HANDLER_CALLED: previewEventTrace.handlerCalls,
          PREVIEW_CLOSE_WORKS: previewEventTrace.closeWorks,
          PREVIEW_HANDLER_ENTERED: previewEventTrace.handlerEntered > 0,
          PREVIEW_VALIDATION_RESULT: previewEventTrace.lastValidationResult,
          PREVIEW_VALIDATION_BLOCKED: previewEventTrace.validationBlocked,
          PREVIEW_LAYER_DISPLAY: disp,
          PREVIEW_FULLSCREEN: fullscreen,
          PREVIEW_LAYER_CREATED: !!layer,
          PREVIEW_LAYER_EXISTS: !!layer,
          PREVIEW_LAYER_PARENT: layer && layer.parentElement ? layer.parentElement.tagName + (layer.parentElement.id ? "#" + layer.parentElement.id : "") : "",
          PREVIEW_LAYER_VISIBLE: !!(layer && isPreviewLayerOpen(layer) && rect && rect.width > 50 && rect.height > 50),
          PREVIEW_LAYER_TOP: rect ? Math.round(rect.top) : null,
          PREVIEW_LAYER_LEFT: rect ? Math.round(rect.left) : null,
          PREVIEW_LAYER_WIDTH: rect ? Math.round(rect.width) : null,
          PREVIEW_LAYER_HEIGHT: rect ? Math.round(rect.height) : null,
          PREVIEW_LAYER_Z_INDEX: cs ? cs.zIndex : "",
          PREVIEW_LAYER_POINTER_EVENTS: cs ? cs.pointerEvents : "",
          PREVIEW_LAYER_POSITION: cs ? cs.position : "",
          PREVIEW_LAYER_IN_SCROLL_HOST: !!(layer && scrollHostEl && scrollHostEl.contains(layer)),
          PREVIEW_LAYER_CLIPPED: clipped,
          PREVIEW_BODY_CLASS: document.body.classList.contains("iu-invoice-preview-open"),
          PREVIEW_CARD_SHELL_HIDDEN: cardShellEl ? cardCs.visibility === "hidden" || cardCs.display === "none" : null,
          PREVIEW_SCROLL_HOST_HIDDEN: scrollHostEl ? window.getComputedStyle(scrollHostEl).overflow === "hidden" : null,
          ACTIVE_ELEMENT_AFTER_CLICK: document.activeElement ? document.activeElement.tagName + (document.activeElement.getAttribute("data-inv") ? "[data-inv]" : "") : "",
          PREVIEW_LAYER_PORTAL: !!(layer && layer.classList.contains("iu-invoice-preview-portal")),
          PREVIEW_USES_NATIVE_DIALOG: false,
          PREVIEW_PORTAL_MODE: "body-fixed-div",
          PREVIEW_EXCEPTION: extra && extra.PREVIEW_EXCEPTION ? extra.PREVIEW_EXCEPTION : "",
        },
        extra || {},
      );
    } catch (err) {
      try {
        window._iuInvoicePreviewDiag = { ERROR_THROWN: String(err), PREVIEW_EXCEPTION: String(err) };
      } catch (_) {}
    }
  }

  function clearValidationHighlights(root) {
    if (!root) return;
    root.querySelectorAll(".iu-inv-input--invalid, .iu-inv-select--invalid, .iu-inv-textarea--invalid").forEach((el) => {
      el.classList.remove("iu-inv-input--invalid", "iu-inv-select--invalid", "iu-inv-textarea--invalid");
      el.removeAttribute("aria-invalid");
    });
  }

  function highlightValidationField(el) {
    if (!el) return;
    if (el.classList.contains("iu-inv-select")) el.classList.add("iu-inv-select--invalid");
    else if (el.classList.contains("iu-inv-textarea")) el.classList.add("iu-inv-textarea--invalid");
    else el.classList.add("iu-inv-input--invalid");
    el.setAttribute("aria-invalid", "true");
  }

  function scrollToFirstValidationError(root) {
    if (!root) return null;
    clearValidationHighlights(root);
    const required = root.querySelectorAll("input[required], textarea[required], select[required]");
    for (let i = 0; i < required.length; i++) {
      const el = required[i];
      if (el.disabled || el.hidden) continue;
      const val = String(el.value || "").trim();
      if (!val) {
        highlightValidationField(el);
        try {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.focus();
        } catch (_) {}
        return el;
      }
    }
    const lineName = root.querySelector('[data-inv-line-field="name"]');
    if (lineName && !String(lineName.value || "").trim()) {
      highlightValidationField(lineName);
      try {
        lineName.scrollIntoView({ block: "center", behavior: "smooth" });
        lineName.focus();
      } catch (_) {}
      return lineName;
    }
    return null;
  }

  function installPreviewDelegation() {
    try {
      if (typeof document === "undefined" || window.__iuInvoicePreviewDelegateInstalled) return;
      window.__iuInvoicePreviewDelegateInstalled = true;
      const onDocPreview = (e, kind) => {
        try {
          const panelEl = document.getElementById("iuInvoicePanel");
          if (!panelEl || panelEl.hasAttribute("hidden")) return;
          const backBtn = e.target && e.target.closest ? e.target.closest("[data-inv-preview-back]") : null;
          if (backBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof closePreviewFn === "function") closePreviewFn();
            return;
          }
          const dlBtn = e.target && e.target.closest ? e.target.closest("[data-inv-preview-download]") : null;
          const shBtn = e.target && e.target.closest ? e.target.closest("[data-inv-preview-share-pdf]") : null;
          if (dlBtn || shBtn) return;
          const btn = e.target && e.target.closest ? e.target.closest("button[data-inv-preview]") : null;
          const invRoot = document.querySelector("[data-iu-invoice-root]");
          if (!btn || !invRoot || !invRoot.contains(btn)) return;
          if (kind === "touch") previewEventTrace.touchEvents += 1;
          else if (kind === "pointer") previewEventTrace.pointerEvents += 1;
          else previewEventTrace.clickEvents += 1;
          e.preventDefault();
          e.stopPropagation();
          const openFn =
            previewOpenCoreFn ||
            (typeof window.iuInvoiceOpenPreview === "function" ? window.iuInvoiceOpenPreview : null);
          if (typeof openFn === "function") {
            previewEventTrace.handlerCalls += 1;
            openFn();
          }
        } catch (err) {
          publishPreviewDiag(null, { ERROR_THROWN: String(err) });
        }
      };
      document.addEventListener(
        "click",
        (e) => {
          onDocPreview(e, "click");
        },
        true,
      );
      document.addEventListener(
        "touchend",
        (e) => {
          onDocPreview(e, "touch");
        },
        { capture: true, passive: false },
      );
      document.addEventListener(
        "pointerup",
        (e) => {
          onDocPreview(e, "pointer");
        },
        { capture: true, passive: false },
      );
    } catch (_) {}
  }

  function isPreviewLayerOpen(layer) {
    if (!layer) return false;
    if (layer.classList.contains("iu-invoice-preview-portal--open")) return true;
    if (layer.hidden || layer.classList.contains("iu-inv-guard-hidden")) return false;
    try {
      const cs = window.getComputedStyle(layer);
      return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity || "1") > 0.05;
    } catch (_) {
      return !layer.hidden;
    }
  }

  function applyPreviewPortalOpenStyles(layer) {
    if (!layer) return;
    try {
      if (layer.parentElement !== document.body) document.body.appendChild(layer);
    } catch (_) {}
    layer.hidden = false;
    layer.removeAttribute("hidden");
    layer.classList.remove("iu-inv-guard-hidden");
    layer.classList.add("iu-invoice-preview-portal--open");
    layer.setAttribute("data-preview-open", "1");
    try {
      layer.style.setProperty("position", "fixed", "important");
      layer.style.setProperty("inset", "0", "important");
      layer.style.setProperty("z-index", "12250", "important");
      layer.style.setProperty("display", "flex", "important");
      layer.style.setProperty("flex-direction", "column", "important");
      layer.style.setProperty("visibility", "visible", "important");
      layer.style.setProperty("opacity", "1", "important");
      layer.style.setProperty("pointer-events", "auto", "important");
      layer.style.setProperty("width", "100%", "important");
      layer.style.setProperty("height", "100%", "important");
      layer.style.setProperty("max-height", "100dvh", "important");
      layer.style.setProperty("background", "#fafafa", "important");
    } catch (_) {}
  }

  function applyPreviewPortalCloseStyles(layer) {
    if (!layer) return;
    layer.classList.remove("iu-invoice-preview-portal--open");
    layer.removeAttribute("data-preview-open");
    layer.hidden = true;
    layer.setAttribute("hidden", "");
    layer.classList.add("iu-inv-guard-hidden");
    try {
      layer.style.setProperty("display", "none", "important");
    } catch (_) {}
  }

  function closeIosPdfPopup() {
    try {
      if (iosPdfPopup && !iosPdfPopup.closed) iosPdfPopup.close();
    } catch (_) {}
    iosPdfPopup = null;
  }

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

  function iuInvoiceIsDesktopFullpageGuards() {
    try {
      if (typeof document === "undefined" || !document.body) return false;
      if (typeof window.matchMedia !== "function") return false;
      if (!window.matchMedia("(min-width: 1025px)").matches) return false;
      /* Public hub is site root (/); /projects/ is legacy. Match canonical iuIsProjectsRoute. */
      if (typeof window.iuIsProjectsRoute === "function") return !!window.iuIsProjectsRoute();
      const p = String(typeof location !== "undefined" && location && location.pathname ? location.pathname : "").replace(/\\/g, "/");
      const hub =
        p === "/" ||
        p === "/index.html" ||
        p === "/filtr/" ||
        p === "/filtr" ||
        p === "/filtr/index.html" ||
        p === "/projects/" ||
        p === "/projects" ||
        p.indexOf("/projects/") === 0 ||
        p === "/filtr/projects" ||
        p === "/filtr/projects/" ||
        p.indexOf("/filtr/projects/") === 0;
      return !!hub;
    } catch (_) {
      return false;
    }
  }

  function iuInvoiceClearDesktopFullpageLayout() {
    try {
      if (backdrop) backdrop.classList.remove("iu-invoice-fullpage");
    } catch (_) {}
    try {
      if (panel) panel.classList.remove("iu-invoice-fullpage");
    } catch (_) {}
  }

  function iuInvoiceApplyDesktopFullpageLayout(active) {
    if (!active) {
      iuInvoiceClearDesktopFullpageLayout();
      return;
    }
    try {
      if (backdrop) backdrop.classList.add("iu-invoice-fullpage");
    } catch (_) {}
    try {
      if (panel) panel.classList.add("iu-invoice-fullpage");
    } catch (_) {}
  }

  function applyBodyOpen(on, opts) {
    const desktopFp = !!(opts && opts.desktopFullpage);
    try {
      if (on) {
        document.body.classList.add("iu-invoice-overlay-open", "iu-modal-open");
        if (desktopFp) document.body.classList.add("iu-invoice-desktop-overlay-open");
        panel.dataset.open = "1";
      } else {
        document.body.classList.remove("iu-invoice-overlay-open", "iu-modal-open", "iu-invoice-desktop-overlay-open");
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
      clearOverlayOpenFallbackStyles();
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

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      void persistFormState(state);
    }, 400);
  }

  function refreshPanelsContent() {
    if (!rootEl) return;
    const pfo = rootEl.querySelector('[data-inv-panel="supplierFo"]');
    const ppo = rootEl.querySelector('[data-inv-panel="supplierPo"]');
    const bfo = rootEl.querySelector('[data-inv-panel="buyerFo"]');
    const bpo = rootEl.querySelector('[data-inv-panel="buyerPo"]');
    if (pfo) pfo.innerHTML = renderSupplierFo(state);
    if (ppo) ppo.innerHTML = renderSupplierPo(state);
    if (bfo) bfo.innerHTML = renderBuyerFo(state);
    if (bpo) bpo.innerHTML = renderBuyerPo(state);
    writeStateToDom(rootEl, state);
  }

  function wire(root) {
    let previewLayoutMode = "";

    function getPreviewLayerEl() {
      return findPreviewLayerEl(root);
    }

    function getPreviewHostEl() {
      const layer = getPreviewLayerEl();
      if (layer) {
        const host = layer.querySelector("[data-inv-preview-host]");
        if (host) return host;
      }
      return root.querySelector(".iu-inv-previewScroll") || root.querySelector("[data-inv-preview-host]");
    }

    function getPreviewScrollEl() {
      return getPreviewHostEl();
    }

    function getPreviewAvailWidth() {
      const scroll = getPreviewScrollEl();
      if (!scroll) return 800;
      const w = scroll.clientWidth || scroll.getBoundingClientRect().width || 800;
      return Math.max(260, w - 24);
    }

    function isDesktopPreviewBreakpoint() {
      try {
        return window.matchMedia("(min-width: 1025px)").matches;
      } catch (_) {
        return false;
      }
    }

    function buildPreviewHostInner(rasterInnerHtml, mode) {
      if (mode === "desktop") {
        return (
          '<div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--desktop">' +
          '<div class="iu-invoice-preview-desktop">' +
          rasterInnerHtml +
          "</div></div>"
        );
      }
      return (
        '<div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--mobile">' +
        '<div class="iu-invoice-preview-mobile">' +
        '<div class="iu-invoice-preview-scale">' +
        rasterInnerHtml +
        "</div></div></div>"
      );
    }

    async function ensurePreviewRasterBundle() {
      readStateFromDom(root, state);
      const totals = computeTotals(state);
      const raster = await loadRasterModule();
      const key = raster.rasterContentKey(state, totals);
      if (previewRasterBundle && previewRasterKey === key && previewRasterBundle.canvases && previewRasterBundle.canvases.length) {
        return previewRasterBundle;
      }
      const bundle = await raster.renderInvoiceRasterBundle(state, totals);
      previewRasterBundle = bundle;
      previewRasterKey = key;
      return bundle;
    }

    root.addEventListener("change", (e) => {
      const t = e.target;
      readStateFromDom(root, state);
      if (t && t.getAttribute && t.getAttribute("data-inv") === "invoice.payment") {
        copySupplierBankToInvoiceIfEmpty(state);
      }
      if (t && t.getAttribute && t.getAttribute("data-inv") === "supplierVatPayer") {
        if (!state.supplierVatPayer) {
          (state.lines || []).forEach((ln) => {
            ln.vatRate = "0";
          });
        }
      }
      if (t && (t.name === "iu-sup-kind" || t.name === "iu-buy-kind")) {
        refreshPanelsContent();
      }
      if (t && t.matches && t.matches("[data-inv-auto-num]") && t.checked) {
        state.invoice.number = nextAutoInvoiceNumber();
      }
      writeStateToDom(root, state);
      scheduleSave();
    });

    root.addEventListener("input", () => {
      readStateFromDom(root, state);
      updateSummary(root, state);
      scheduleSave();
    });

    root.querySelector("[data-inv-add-line]")?.addEventListener("click", () => {
      readStateFromDom(root, state);
      state.lines.push(emptyLine(!!state.supplierVatPayer));
      writeStateToDom(root, state);
      scheduleSave();
    });

    root.addEventListener("click", (e) => {
      const dup = e.target && e.target.closest ? e.target.closest("[data-inv-dup-line]") : null;
      const del = e.target && e.target.closest ? e.target.closest("[data-inv-del-line]") : null;
      if (dup) {
        e.preventDefault();
        readStateFromDom(root, state);
        const id = dup.getAttribute("data-inv-dup-line");
        const ln = (state.lines || []).find((x) => x.id === id);
        if (ln) {
          const c = Object.assign({}, ln, { id: "x" });
          try {
            c.id =
              typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : "id_" + String(Date.now()) + "_" + String(Math.random()).slice(2, 9);
          } catch (_) {
            c.id = "id_" + String(Date.now());
          }
          state.lines.push(c);
        }
        writeStateToDom(root, state);
        scheduleSave();
      }
      if (del) {
        e.preventDefault();
        readStateFromDom(root, state);
        const id = del.getAttribute("data-inv-del-line");
        if ((state.lines || []).length <= 1) {
          setStatus(root, "Musí zůstat alespoň jedna položka.");
          return;
        }
        state.lines = (state.lines || []).filter((x) => x.id !== id);
        writeStateToDom(root, state);
        scheduleSave();
      }
    });

    root.querySelector("[data-inv-recipient-load]")?.addEventListener("click", () => {
      const sel = root.querySelector("[data-inv-recipient-select]");
      const id = sel && sel.value;
      if (!id) return;
      const list = loadRecipients();
      const hit = list.find((x) => x.id === id);
      if (!hit || !hit.data) return;
      readStateFromDom(root, state);
      state = applyBuyerSnapshot(state, hit.data);
      hit.lastUsed = Date.now();
      const list2 = loadRecipients()
        .map((x) => (x.id === id ? Object.assign({}, x, { lastUsed: Date.now() }) : x))
        .sort((a, b) => b.lastUsed - a.lastUsed);
      saveRecipients(list2);
      fillRecipientSelect(root, list2);
      writeStateToDom(root, state);
      setStatus(root, "Odběratel načten.");
      scheduleSave();
    });

    root.querySelector("[data-inv-recipient-save]")?.addEventListener("click", () => {
      readStateFromDom(root, state);
      const v = validateForm(state);
      if (!v.ok) {
        setStatus(root, "Nejdřív opravte chyby u odběratele: " + v.errors.slice(0, 3).join("; "));
        return;
      }
      const snap = snapshotBuyer(state);
      const label =
        snap.buyerKind === "po"
          ? String((snap.buyerPo && snap.buyerPo.companyName) || "Firma")
          : String((snap.buyerFo && snap.buyerFo.firstName) || "") +
            " " +
            String((snap.buyerFo && snap.buyerFo.lastName) || "");
      const list = loadRecipients().filter((x) => x && x.id);
      let id = "";
      try {
        id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "r_" + String(Date.now());
      } catch (_) {
        id = "r_" + String(Date.now());
      }
      list.push({ id, label: label.trim() || "Odběratel", lastUsed: Date.now(), data: snap });
      saveRecipients(list);
      fillRecipientSelect(root, list);
      setStatus(root, "Odběratel uložen do seznamu.");
    });

    root.querySelector("[data-inv-recipient-delete]")?.addEventListener("click", () => {
      const sel = root.querySelector("[data-inv-recipient-select]");
      const id = sel && sel.value;
      if (!id) return;
      const list = loadRecipients().filter((x) => x.id !== id);
      saveRecipients(list);
      fillRecipientSelect(root, list);
      setStatus(root, "Smazáno.");
    });

    async function doCopy() {
      readStateFromDom(root, state);
      const v = validateForm(state);
      if (!v.ok) {
        setStatus(root, v.errors.join(" · "));
        return;
      }
      const totals = computeTotals(state);
      const text = buildPlainText(state, totals);
      try {
        await navigator.clipboard.writeText(text);
        setStatus(root, "Text zkopírován do schránky.");
      } catch (_) {
        setStatus(root, "Kopírování se nezdařilo — použijte ručně z náhledu.");
      }
    }

    function invoicePdfDiag(step, detail, err) {
      try {
        if (typeof window.iuInvoicePdfExportDiag === "function") {
          window.iuInvoicePdfExportDiag(step, detail, err);
        }
      } catch (_) {}
    }

    function isIosDevice() {
      try {
        const ua = String((typeof navigator !== "undefined" && navigator.userAgent) || "");
        return /iPad|iPhone|iPod/i.test(ua);
      } catch (_) {
        return false;
      }
    }

    function pdfExportFailStatus(err) {
      const d =
        typeof window !== "undefined" && window._iuInvoicePdfExportDiag && window._iuInvoicePdfExportDiag.step
          ? String(window._iuInvoicePdfExportDiag.step)
          : "";
      const msg = err && err.message ? String(err.message) : "";
      if (d) return "PDF se nepodařilo vygenerovat (" + d + ").";
      if (msg) return "PDF se nepodařilo vygenerovat (" + msg + ").";
      return "PDF se nepodařilo vygenerovat.";
    }

    function exportInvoicePdfBlob(cb) {
      readStateFromDom(root, state);
      copySupplierBankToInvoiceIfEmpty(state);
      const v = validateForm(state);
      if (!v.ok) {
        setStatus(root, v.errors.join(" · "));
        cb(new Error("validate"));
        return;
      }
      const totals = computeTotals(state);
      const num = String((state.invoice && state.invoice.number) || "faktura").replace(/[^\w.\-]+/g, "_");
      const fileName = "Faktura_" + num + ".pdf";
      try {
        window._iuInvoiceExportMode = "pdf_only";
        window._iuInvoiceWordPdfStackUsed = false;
      } catch (_) {}
      invoicePdfDiag("invoice_pdf_export_start", { via: "invoice_module", renderer: "raster_canvas_v1" });
      const exportPromise = Promise.all([loadRasterModule(), loadPdfModule(), ensureInvoiceOverlayCssReady()]).then(async ([raster, pdf]) => {
        const key = raster.rasterContentKey(state, totals);
        let bundle = previewRasterBundle && previewRasterKey === key ? previewRasterBundle : null;
        if (!bundle || !bundle.canvases || !bundle.canvases.length) {
          bundle = await raster.renderInvoiceRasterBundle(state, totals);
          previewRasterBundle = bundle;
          previewRasterKey = key;
        }
        return pdf.buildInvoicePdfBlobFromRasterBundle(bundle, fileName, { fromPreviewDom: true, rasterBundle: bundle });
      });
      exportPromise
        .then((out) => {
          if (!out || !out.blob) {
            const err = new Error("pdf_blob_empty");
            invoicePdfDiag("invoice_pdf_error", { via: "invoice_module_renderer" }, err);
            setStatus(root, pdfExportFailStatus(err));
            cb(err);
            return;
          }
          invoicePdfDiag("invoice_pdf_blob_created", {
            size: out.blob.size,
            via: "invoice_module",
            renderer: "raster_canvas_v1",
            fromRasterBundle: true,
          });
          cb(null, out.blob, out.fileName || fileName);
        })
        .catch((err) => {
          invoicePdfDiag("invoice_pdf_error", { via: "invoice_module_renderer" }, err);
          setStatus(root, pdfExportFailStatus(err));
          cb(err || new Error("pdf"));
        });
    }

    function needsGesturePdfDelivery() {
      try {
        if (isIosDevice()) return true;
        return !!(window.matchMedia && window.matchMedia("(max-width: 1024px)").matches);
      } catch (_) {
        return isIosDevice();
      }
    }

    function clearReadyPdfUi() {
      readyPdfBundle = null;
      const row = root.querySelector("[data-inv-pdf-ready-row]");
      if (row) {
        row.hidden = true;
        row.classList.add("iu-inv-guard-hidden");
      }
    }

    function showReadyPdfUi(blob, fileName) {
      readyPdfBundle = { blob, fileName: fileName || "faktura.pdf" };
      const row = root.querySelector("[data-inv-pdf-ready-row]");
      if (row) {
        row.hidden = false;
        row.classList.remove("iu-inv-guard-hidden");
      }
    }

    function beginIosPdfPopupSync() {
      iosPdfPopup = null;
      if (!isIosDevice()) return;
      try {
        iosPdfPopup = window.open("about:blank", "_blank");
      } catch (_) {
        iosPdfPopup = null;
      }
    }

    function canSharePdfFile(blob, fileName) {
      try {
        const name = fileName || "faktura.pdf";
        const file = new File([blob], name, { type: "application/pdf" });
        const nav = typeof navigator !== "undefined" ? navigator : null;
        const shareFn = nav && typeof nav.share === "function" ? nav.share : null;
        const canShareFn = nav && typeof nav.canShare === "function" ? nav.canShare.bind(nav) : null;
        return !!(shareFn && canShareFn && canShareFn({ files: [file] }));
      } catch (_) {
        return false;
      }
    }

    function runPdfDownloadFallback(blob, name) {
      invoicePdfDiag("invoice_pdf_download_start", { ios: isIosDevice(), gesture: needsGesturePdfDelivery() });
      try {
        const url = URL.createObjectURL(blob);
        const safeName = name || "faktura.pdf";
        const a = document.createElement("a");
        a.href = url;
        a.download = safeName;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        return true;
      } catch (eDl) {
        invoicePdfDiag("invoice_pdf_error", { phase: "download" }, eDl);
        return false;
      }
    }

    function tryIosPopupPdfRedirect(blob, mode) {
      if (!iosPdfPopup || iosPdfPopup.closed) return false;
      const url = URL.createObjectURL(blob);
      try {
        iosPdfPopup.location.href = url;
        iosPdfPopup.focus();
        iosPdfPopup = null;
        invoicePdfDiag("invoice_pdf_download_start", { via: "ios_popup_redirect", mode: mode || "" });
        window.setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {}
        }, 120000);
        return true;
      } catch (ePop) {
        invoicePdfDiag("invoice_pdf_error", { phase: "ios_popup_redirect" }, ePop);
        closeIosPdfPopup();
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
        return false;
      }
    }

    function tryOpenPdfBlobUrl(blob) {
      const url = URL.createObjectURL(blob);
      try {
        const w = window.open(url, "_blank");
        if (w) {
          window.setTimeout(() => {
            try {
              URL.revokeObjectURL(url);
            } catch (_) {}
          }, 120000);
          return true;
        }
        if (isIosDevice() || needsGesturePdfDelivery()) {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {}
          return false;
        }
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {}
        }, 120000);
        return true;
      } catch (eOpen) {
        invoicePdfDiag("invoice_pdf_error", { phase: "open_pdf_blob" }, eOpen);
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
        return false;
      }
    }

    function deliverPdfDownload(blob, fileName) {
      const name = fileName || "faktura.pdf";
      readyPdfBundle = { blob, fileName: name };
      if (isIosDevice()) {
        if (tryIosPopupPdfRedirect(blob, "download")) {
          setStatus(root, "PDF otevřeno — uložte přes ikonu sdílení v prohlížeči.");
          return;
        }
      } else if (!needsGesturePdfDelivery()) {
        if (runPdfDownloadFallback(blob, name)) {
          setStatus(root, "PDF staženo.");
          return;
        }
      } else if (runPdfDownloadFallback(blob, name)) {
        setStatus(root, "PDF staženo.");
        return;
      }
      if (tryOpenPdfBlobUrl(blob)) {
        setStatus(root, "PDF otevřeno — uložte nebo sdílejte ze souboru.");
        return;
      }
      showReadyPdfUi(blob, name);
      setStatus(root, "PDF připravené. Klepněte na „Otevřít PDF“.");
    }

    function openReadyPdfNow() {
      const prep = readyPdfBundle;
      if (!prep || !prep.blob) {
        setStatus(root, "Nejdřív vygenerujte PDF (Stáhnout / Sdílet).");
        return;
      }
      invoicePdfDiag("invoice_pdf_download_start", { via: "open_pdf_button" });
      const url = URL.createObjectURL(prep.blob);
      const w = window.open(url, "_blank");
      if (!w) {
        try {
          const a = document.createElement("a");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
        } catch (eA) {
          invoicePdfDiag("invoice_pdf_error", { phase: "open_pdf_button" }, eA);
          setStatus(root, "Otevření PDF se nezdařilo.");
          return;
        }
      }
      window.setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }, 120000);
      setStatus(root, "PDF otevřeno — uložte nebo sdílejte ze souboru.");
    }

    async function sharePdfBlobNow(blob, fileName) {
      const name = fileName || "faktura.pdf";
      readyPdfBundle = { blob, fileName: name };
      const canShareFiles = canSharePdfFile(blob, name);
      invoicePdfDiag("invoice_pdf_share_start", { canShareFiles: canShareFiles, hasBlob: true });
      if (canShareFiles) {
        const file = new File([blob], name, { type: "application/pdf" });
        const nav = typeof navigator !== "undefined" ? navigator : null;
        const shareFn = nav && typeof nav.share === "function" ? nav.share : null;
        try {
          await shareFn.call(nav, { files: [file], title: "Faktura" });
          setStatus(root, "PDF sdíleno nebo zrušeno uživatelem.");
          return;
        } catch (e) {
          const aborted = e && (e.name === "AbortError" || String(e.name) === "AbortError");
          if (aborted) {
            setStatus(root, "Sdílení zrušeno.");
            return;
          }
          invoicePdfDiag("invoice_pdf_error", { phase: "share" }, e);
        }
      }
      if (!isIosDevice() && runPdfDownloadFallback(blob, name)) {
        setStatus(root, "Sdílení není dostupné — PDF staženo.");
        return;
      }
      if (isIosDevice() && tryIosPopupPdfRedirect(blob, "share")) {
        setStatus(root, "PDF otevřeno — sdílejte přes ikonu sdílení v prohlížeči.");
        return;
      }
      if (tryOpenPdfBlobUrl(blob)) {
        setStatus(root, "PDF otevřeno — uložte nebo sdílejte ze souboru.");
        return;
      }
      showReadyPdfUi(blob, name);
      setStatus(root, "Sdílení není dostupné. Klepněte na „Otevřít PDF“.");
    }

    function doDownloadPdf() {
      readStateFromDom(root, state);
      const v = validateForm(state);
      if (!v.ok) {
        setStatus(root, v.errors.join(" · "));
        return;
      }
      clearReadyPdfUi();
      beginIosPdfPopupSync();
      setStatus(root, "Připravuji PDF…");
      exportInvoicePdfBlob((err, blob, fileName) => {
        if (err || !blob) {
          closeIosPdfPopup();
          if (err) setStatus(root, pdfExportFailStatus(err));
          return;
        }
        deliverPdfDownload(blob, fileName || "faktura.pdf");
      });
    }

    async function doSharePdf() {
      if (readyPdfBundle && readyPdfBundle.blob) {
        await sharePdfBlobNow(readyPdfBundle.blob, readyPdfBundle.fileName);
        return;
      }
      readStateFromDom(root, state);
      const v = validateForm(state);
      if (!v.ok) {
        setStatus(root, v.errors.join(" · "));
        return;
      }
      clearReadyPdfUi();
      beginIosPdfPopupSync();
      setStatus(root, "Připravuji PDF…");
      exportInvoicePdfBlob(async (err, blob, fileName) => {
        if (err || !blob) {
          closeIosPdfPopup();
          if (err) setStatus(root, pdfExportFailStatus(err));
          return;
        }
        await sharePdfBlobNow(blob, fileName || "faktura.pdf");
      });
    }

    function syncInvoicePreviewLayout() {
      const host = getPreviewHostEl();
      if (!host) return;
      const paper = host.querySelector(".iu-invoice-paper--raster, .iu-invoice-paper");
      if (!paper) return;
      const mobileWrap = host.querySelector(".iu-invoice-preview-mobile");
      const scaleEl = mobileWrap && mobileWrap.querySelector(".iu-invoice-preview-scale");
      if (!scaleEl) {
        return;
      }
      const csw = mobileWrap ? window.getComputedStyle(mobileWrap) : null;
      const padL = csw ? parseFloat(csw.paddingLeft) || 0 : 0;
      const padR = csw ? parseFloat(csw.paddingRight) || 0 : 0;
      const innerAvail = Math.max(260, (mobileWrap ? mobileWrap.clientWidth : host.clientWidth) - padL - padR - 4);
      const sc = Math.min(1, innerAvail / 794);
      scaleEl.style.width = "794px";
      scaleEl.style.transform = "scale(" + sc + ")";
      scaleEl.style.transformOrigin = "top center";
      const ph = paper.offsetHeight || 1;
      scaleEl.style.height = ph * sc + "px";
    }

    function showPreviewValidationErrors(errors) {
      const msg = (errors || []).join(" · ");
      setStatus(root, msg);
      const stEl = root.querySelector("[data-inv-status]");
      if (stEl) {
        try {
          stEl.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (_) {}
      }
      try {
        let toast = document.body.querySelector("[data-inv-preview-error-toast]");
        if (!toast) {
          toast = document.createElement("div");
          toast.setAttribute("data-inv-preview-error-toast", "");
          toast.className = "iu-inv-previewErrorToast";
          toast.setAttribute("role", "alert");
          document.body.appendChild(toast);
        }
        toast.textContent = msg || "Vyplňte povinná pole faktury.";
        toast.hidden = false;
        window.clearTimeout(showPreviewValidationErrors._t);
        showPreviewValidationErrors._t = window.setTimeout(() => {
          try {
            toast.hidden = true;
          } catch (_) {}
        }, 6000);
      } catch (_) {}
    }

    function wirePreviewPortalToolbar() {
      const layer = ensurePreviewPortalHost();
      if (!layer) return;
      const back = layer.querySelector("[data-inv-preview-back]");
      const dl = layer.querySelector("[data-inv-preview-download]");
      const sh = layer.querySelector("[data-inv-preview-share-pdf]");
      if (back) {
        back.onclick = (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch (_) {}
          closePreview();
        };
      }
      if (dl) {
        dl.onclick = (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch (_) {}
          void guardProtectedAction("invoice", doDownloadPdf);
        };
      }
      if (sh) {
        sh.onclick = (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch (_) {}
          void guardProtectedAction("invoice", doSharePdf);
        };
      }
    }

    function openPreview() {
      let previewException = "";
      previewEventTrace.handlerEntered += 1;
      readStateFromDom(root, state);
      copySupplierBankToInvoiceIfEmpty(state);
      const v = validateForm(state);
      previewEventTrace.lastValidationResult = v.ok ? "pass" : "fail";
      if (!v.ok) {
        previewEventTrace.validationBlocked += 1;
        showPreviewValidationErrors(v.errors);
        scrollToFirstValidationError(root);
        publishPreviewDiag(null, {
          PREVIEW_OPEN: false,
          PREVIEW_VALIDATION_BLOCKED: true,
          PREVIEW_VALIDATION_RESULT: "fail",
          PREVIEW_EXCEPTION: "",
          reason: "validation",
          errors: v.errors,
        });
        return;
      }
      clearValidationHighlights(root);
      clearReadyPdfUi();
      const layer = ensurePreviewPortalHost();
      const host = layer ? layer.querySelector("[data-inv-preview-host]") : null;
      const formLayer = root.querySelector("[data-inv-preview-layer]");
      if (formLayer && formLayer !== layer) {
        formLayer.hidden = true;
        formLayer.setAttribute("hidden", "");
        formLayer.classList.add("iu-inv-guard-hidden");
      }
      if (!host || !layer) {
        const msg = "Náhled faktury: chybí portál náhledu.";
        showPreviewValidationErrors([msg]);
        publishPreviewDiag(layer, {
          PREVIEW_OPEN: false,
          PREVIEW_EXCEPTION: "missing_host_or_layer",
          reason: "missing_host_or_layer",
        });
        return;
      }
      const mode = isDesktopPreviewBreakpoint() ? "desktop" : "mobile";
      previewLayoutMode = mode;
      host.innerHTML =
        '<div class="iu-invoice-raster-loading" data-inv-raster-loading>Připravuji náhled faktury…</div>';
      applyPreviewPortalOpenStyles(layer);
      try {
        document.body.classList.add("iu-invoice-preview-open");
      } catch (_) {}
      ensurePreviewRasterBundle()
        .then(async (bundle) => {
          const raster = await loadRasterModule();
          const rasterInner = raster.buildRasterPreviewHostInner(bundle);
          host.innerHTML = buildPreviewHostInner(rasterInner, mode);
          const opened = isPreviewLayerOpen(layer);
          if (!opened) {
            const msg = "Náhled faktury se nepodařilo zobrazit. Obnovte stránku (tvrdý reload).";
            showPreviewValidationErrors([msg]);
            publishPreviewDiag(layer, {
              PREVIEW_OPEN: false,
              PREVIEW_VALIDATION_RESULT: "pass",
              PREVIEW_VALIDATION_BLOCKED: false,
              PREVIEW_EXCEPTION: "layer_not_visible",
              reason: "layer_not_visible",
            });
            return;
          }
          publishPreviewDiag(layer, {
            PREVIEW_OPEN: true,
            PREVIEW_VALIDATION_RESULT: "pass",
            PREVIEW_VALIDATION_BLOCKED: false,
            PREVIEW_EXCEPTION: "",
            previewLayoutMode: mode,
            PREVIEW_RASTER_PAGES: bundle.pageCount,
            PREVIEW_USES_SAME_RASTER_AS_PDF: true,
          });
          const scrollHost = getPreviewScrollEl();
          try {
            if (scrollHost) scrollHost.scrollTop = 0;
            window.requestAnimationFrame(() => {
              try {
                syncInvoicePreviewLayout();
                if (scrollHost) scrollHost.scrollTop = 0;
                const backBtn = layer.querySelector("[data-inv-preview-back]");
                if (backBtn) backBtn.focus();
                publishPreviewDiag(layer, {
                  PREVIEW_OPEN: isPreviewLayerOpen(layer),
                  PREVIEW_VALIDATION_RESULT: "pass",
                  PREVIEW_VALIDATION_BLOCKED: false,
                  PREVIEW_EXCEPTION: "",
                  previewLayoutMode: mode,
                  PREVIEW_RASTER_PAGES: bundle.pageCount,
                });
              } catch (rafErr) {
                previewException = String(rafErr);
              }
            });
          } catch (scrollErr) {
            previewException = String(scrollErr);
          }
        })
        .catch((err) => {
          previewException = String(err);
          showPreviewValidationErrors(["Náhled faktury: " + previewException]);
          publishPreviewDiag(null, {
            PREVIEW_OPEN: false,
            ERROR_THROWN: previewException,
            PREVIEW_EXCEPTION: previewException,
          });
        });
    }

    function closePreview() {
      const layer = ensurePreviewPortalHost();
      if (layer) {
        applyPreviewPortalCloseStyles(layer);
      }
      previewLayoutMode = "";
      previewEventTrace.closeWorks = true;
      try {
        document.body.classList.remove("iu-invoice-preview-open");
      } catch (_) {}
      try {
        const toast = document.body.querySelector("[data-inv-preview-error-toast]");
        if (toast) toast.hidden = true;
      } catch (_) {}
      publishPreviewDiag(layer, { PREVIEW_OPEN: false, PREVIEW_CLOSE_WORKS: true, reason: "closed" });
    }
    closePreviewFn = closePreview;
    previewOpenCoreFn = openPreview;
    wirePreviewPortalToolbar();

    function repaintPreviewShellIfNeeded() {
      const layer = getPreviewLayerEl();
      const host = getPreviewHostEl();
      if (!isPreviewLayerOpen(layer) || !host || !host.querySelector("[data-invoice-raster-preview]")) return;
      const nextMode = isDesktopPreviewBreakpoint() ? "desktop" : "mobile";
      if (nextMode === previewLayoutMode) {
        syncInvoicePreviewLayout();
        return;
      }
      readStateFromDom(root, state);
      const v = validateForm(state);
      if (!v.ok) {
        syncInvoicePreviewLayout();
        return;
      }
      previewLayoutMode = nextMode;
      ensurePreviewRasterBundle()
        .then(async (bundle) => {
          const raster = await loadRasterModule();
          const rasterInner = raster.buildRasterPreviewHostInner(bundle);
          host.innerHTML = buildPreviewHostInner(rasterInner, nextMode);
          try {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                try {
                  syncInvoicePreviewLayout();
                } catch (_) {}
              });
            });
          } catch (_) {}
        })
        .catch(() => {
          syncInvoicePreviewLayout();
        });
    }

    const previewScrollForRo = getPreviewScrollEl();
    if (previewScrollForRo && typeof ResizeObserver !== "undefined") {
      let roT = 0;
      const ro = new ResizeObserver(() => {
        window.clearTimeout(roT);
        roT = window.setTimeout(() => {
          try {
            repaintPreviewShellIfNeeded();
          } catch (_) {}
        }, 80);
      });
      try {
        ro.observe(previewScrollForRo);
      } catch (_) {}
    }

    root.querySelector("[data-inv-copy]")?.addEventListener("click", () => {
      void guardProtectedAction("invoice", doCopy);
    });
    function bindPreviewOpen(btn) {
      if (!btn || btn.getAttribute("data-inv-preview-bound") === "1") return;
      btn.setAttribute("data-inv-preview-bound", "1");
      const handler = (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_) {}
        void guardProtectedAction("invoice", openPreview);
      };
      btn.addEventListener("click", handler);
      btn.addEventListener("touchend", handler, { passive: false });
    }

    bindPreviewOpen(root.querySelector("[data-inv-preview]"));
    try {
      window.iuInvoiceOpenPreview = openPreview;
      window.__iuInvoicePreviewOpenCore = openPreview;
    } catch (_) {}
    root.querySelector("[data-inv-download]")?.addEventListener("click", () => {
      void guardProtectedAction("invoice", doDownloadPdf);
    });
    root.querySelectorAll("[data-inv-open-pdf]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openReadyPdfNow();
      });
    });
    root.querySelector("[data-inv-share-pdf]")?.addEventListener("click", () => {
      void guardProtectedAction("invoice", doSharePdf);
    });

    root.querySelector("[data-inv-clear-form]")?.addEventListener("click", () => {
      void confirmClearForm().then((ok) => {
        if (!ok) return;
        state = defaultFormState();
        clearReadyPdfUi();
        refreshPanelsContent();
        renderLines(root, state);
        renderSummary(root, state);
        syncBankBlock(root, state);
        fillSupplierSelect(root, loadSuppliers());
        fillRecipientSelect(root, loadRecipients());
        writeStateToDom(root, state);
        void persistFormState(state);
        setStatus(root, "Formulář vymazán.");
      });
    });
    root.querySelector("[data-inv-supplier-load]")?.addEventListener("click", () => {
      const sel = root.querySelector("[data-inv-supplier-select]");
      const id = sel && sel.value;
      if (!id) return;
      const list = loadSuppliers();
      const hit = list.find((x) => x.id === id);
      if (!hit || !hit.data) return;
      readStateFromDom(root, state);
      state = applySupplierSnapshot(state, hit.data);
      hit.lastUsed = Date.now();
      const list2 = loadSuppliers()
        .map((x) => (x.id === id ? Object.assign({}, x, { lastUsed: Date.now() }) : x))
        .sort((a, b) => b.lastUsed - a.lastUsed);
      saveSuppliers(list2);
      fillSupplierSelect(root, list2);
      refreshPanelsContent();
      writeStateToDom(root, state);
      setStatus(root, "Dodavatel načten.");
      scheduleSave();
    });

    root.querySelector("[data-inv-supplier-save]")?.addEventListener("click", () => {
      readStateFromDom(root, state);
      const v = validateSupplierProfile(state);
      if (!v.ok) {
        setStatus(root, v.errors.join(" · "));
        return;
      }
      const snap = snapshotSupplier(state);
      const label = supplierListLabel(snap);
      const list = loadSuppliers().filter((x) => x && x.id);
      let id = "";
      try {
        id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "s_" + String(Date.now());
      } catch (_) {
        id = "s_" + String(Date.now());
      }
      list.push({ id, label: label.trim() || "Dodavatel", lastUsed: Date.now(), data: snap });
      saveSuppliers(list);
      fillSupplierSelect(root, list);
      setStatus(root, "Dodavatel uložen do seznamu.");
    });

    root.querySelector("[data-inv-supplier-delete]")?.addEventListener("click", () => {
      const sel = root.querySelector("[data-inv-supplier-select]");
      const id = sel && sel.value;
      if (!id) return;
      const list = loadSuppliers().filter((x) => x.id !== id);
      saveSuppliers(list);
      fillSupplierSelect(root, list);
      setStatus(root, "Dodavatel smazán ze seznamu.");
    });
  }

  function isInvoiceDesktopViewport() {
    try {
      return !!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches);
    } catch (_) {
      return false;
    }
  }

  function applyOverlayOpenFallbackStyles() {
    try {
      if (iuInvoiceIsDesktopFullpageGuards()) return;
      const desktop = isInvoiceDesktopViewport();
      if (backdrop) {
        backdrop.style.position = "fixed";
        backdrop.style.inset = "0";
        backdrop.style.zIndex = "10090";
        backdrop.style.display = "block";
        backdrop.style.background = "rgba(15, 23, 42, 0.48)";
      }
      if (panel) {
        panel.style.position = "fixed";
        panel.style.inset = "0";
        panel.style.zIndex = "10091";
        panel.style.display = "flex";
        panel.style.flexDirection = "column";
        panel.style.alignItems = "center";
        panel.style.justifyContent = desktop ? "center" : "stretch";
        panel.style.width = desktop ? "" : "100%";
        panel.style.height = desktop ? "" : "100dvh";
        panel.style.maxHeight = desktop ? "" : "100dvh";
        panel.style.padding = desktop ? "18px" : "0";
        panel.style.overflow = "hidden";
        panel.style.boxSizing = "border-box";
        panel.style.background = desktop ? "transparent" : "";
        panel.style.pointerEvents = "none";
      }
      const cardShell = panel ? panel.querySelector(".iu-invoice-overlay-cardShell") : null;
      if (cardShell) {
        cardShell.style.pointerEvents = "auto";
        if (desktop) {
          cardShell.style.display = "flex";
          cardShell.style.flexDirection = "column";
          cardShell.style.flex = "0 1 auto";
          cardShell.style.width = "min(720px, calc(100vw - 80px))";
          cardShell.style.maxWidth = "min(720px, calc(100vw - 80px))";
          cardShell.style.maxHeight = "min(86vh, calc(100dvh - 36px))";
          cardShell.style.height = "auto";
        } else {
          cardShell.style.display = "";
          cardShell.style.flexDirection = "";
          cardShell.style.flex = "";
          cardShell.style.width = "";
          cardShell.style.maxWidth = "";
          cardShell.style.maxHeight = "";
          cardShell.style.height = "";
        }
      }
    } catch (_) {}
  }

  function clearOverlayOpenFallbackStyles() {
    try {
      if (backdrop) {
        backdrop.style.position = "";
        backdrop.style.inset = "";
        backdrop.style.zIndex = "";
        backdrop.style.display = "";
        backdrop.style.background = "";
      }
      if (panel) {
        panel.style.position = "";
        panel.style.inset = "";
        panel.style.zIndex = "";
        panel.style.display = "";
        panel.style.flexDirection = "";
        panel.style.alignItems = "";
        panel.style.justifyContent = "";
        panel.style.width = "";
        panel.style.height = "";
        panel.style.maxHeight = "";
        panel.style.padding = "";
        panel.style.overflow = "";
        panel.style.boxSizing = "";
        panel.style.background = "";
        panel.style.pointerEvents = "";
      }
      const cardShell = panel ? panel.querySelector(".iu-invoice-overlay-cardShell") : null;
      if (cardShell) {
        cardShell.style.pointerEvents = "";
        cardShell.style.display = "";
        cardShell.style.flexDirection = "";
        cardShell.style.flex = "";
        cardShell.style.width = "";
        cardShell.style.maxWidth = "";
        cardShell.style.maxHeight = "";
        cardShell.style.height = "";
      }
    } catch (_) {}
  }

  function openSurfaceSync() {
    ensureInBody();
    const desktopFp = iuInvoiceIsDesktopFullpageGuards();
    iuInvoiceApplyDesktopFullpageLayout(!!desktopFp);
    setLock(true);
    applyBodyOpen(true, { desktopFullpage: !!desktopFp });
    setVis(true);
    if (!desktopFp) applyOverlayOpenFallbackStyles();
    try {
      panel.classList.toggle("iu-invoice-overlay-panel--mobile", window.matchMedia("(max-width: 1024px)").matches);
      panel.classList.toggle("iu-invoice-overlay-panel--desktop", window.matchMedia("(min-width: 1025px)").matches);
    } catch (_) {}

    state = loadFormState() || defaultFormState();
    if (state.invoice && state.invoice.autoNumber && !String(state.invoice.number || "").trim()) {
      state.invoice.number = nextAutoInvoiceNumber();
    }

    mount.innerHTML = renderFormShell();
    rootEl = mount.querySelector("[data-iu-invoice-root]");
    if (!rootEl) return;

    const pfo = rootEl.querySelector('[data-inv-panel="supplierFo"]');
    const ppo = rootEl.querySelector('[data-inv-panel="supplierPo"]');
    const bfo = rootEl.querySelector('[data-inv-panel="buyerFo"]');
    const bpo = rootEl.querySelector('[data-inv-panel="buyerPo"]');
    if (pfo) pfo.innerHTML = renderSupplierFo(state);
    if (ppo) ppo.innerHTML = renderSupplierPo(state);
    if (bfo) bfo.innerHTML = renderBuyerFo(state);
    if (bpo) bpo.innerHTML = renderBuyerPo(state);

    writeStateToDom(rootEl, state);
    fillRecipientSelect(rootEl, loadRecipients());
    fillSupplierSelect(rootEl, loadSuppliers());
    wire(rootEl);
    try {
      void loadPdfModule().then(function (m) {
        try {
          m.preloadInvoicePdfFont();
        } catch (_) {}
      });
    } catch (_) {}

    try {
      if (closeBtn) closeBtn.focus();
    } catch (_) {}
    try {
      scrollHost.scrollTop = 0;
    } catch (_) {}
  }

  function openSurface() {
    return ensureInvoiceOverlayCssReady().then(function () {
      try {
        if (typeof window.ensureInvoiceModalInBody === "function") window.ensureInvoiceModalInBody();
      } catch (_) {}
      openSurfaceSync();
      publishInvoiceFirstClickDiag({ openedVia: "openSurfaceSync" });
    });
  }

  function closeSurface() {
    if (rootEl) {
      try {
        readyPdfBundle = null;
        closeIosPdfPopup();
      } catch (_) {}
      try {
        const layer = document.getElementById("iuInvoicePreviewPortal");
        if (layer) {
          applyPreviewPortalCloseStyles(layer);
        }
        document.body.classList.remove("iu-invoice-preview-open");
        const toast = document.body.querySelector("[data-inv-preview-error-toast]");
        if (toast) toast.remove();
      } catch (_) {}
      readStateFromDom(rootEl, state);
      void persistFormState(state);
    }
    setVis(false);
    setLock(false);
    iuInvoiceClearDesktopFullpageLayout();
    applyBodyOpen(false, { desktopFullpage: false });
    mount.innerHTML = "";
    rootEl = null;
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
  const cardShell = panel.querySelector(".iu-invoice-overlay-cardShell");
  if (cardShell) {
    cardShell.addEventListener("click", (e) => e.stopPropagation());
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (panel.hasAttribute("hidden")) return;
    if (rootEl) {
      const layer = findPreviewLayerEl(rootEl);
      if (layer && isPreviewLayerOpen(layer)) {
        if (typeof closePreviewFn === "function") closePreviewFn();
        else {
          layer.hidden = true;
          layer.setAttribute("hidden", "");
          layer.classList.add("iu-inv-guard-hidden");
          try {
            document.body.classList.remove("iu-invoice-preview-open");
          } catch (_) {}
        }
        e.preventDefault();
        return;
      }
    }
    closeSurface();
  });

  installPreviewDelegation();
  installInvoiceLauncherDelegation(openSurface);
  try {
    ensurePreviewPortalHost();
  } catch (_) {}

  try {
    window.iuInvoiceOpenSurface = openSurface;
    window.iuInvoiceCloseSurface = closeSurface;
    window.ensureInvoiceModalInBody = ensureInBody;
    window.IU_INVOICE_MODULE_BUILD = IU_INVOICE_MODULE_BUILD;
    window.__iuInvoiceOverlayInitialized = true;
  } catch (_) {}

  if (window.__iuInvoicePendingOpen) {
    window.__iuInvoicePendingOpen = false;
    void openSurface();
  }

  return { open: openSurface, close: closeSurface };
}
