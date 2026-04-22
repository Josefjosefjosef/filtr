/**
 * infoUzel.cz — overlay „Vytvořit fakturu“ (UI vrstva).
 */
import {
  applyBuyerSnapshot,
  buildInvoiceHtmlPreview,
  buildPlainText,
  computeTotals,
  defaultFormState,
  emptyLine,
  loadFormState,
  loadRecipients,
  nextAutoInvoiceNumber,
  persistFormState,
  saveRecipients,
  snapshotBuyer,
  validateForm,
} from "./iu-invoice-engine.js";

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
  return `<div class="iu-inv-root" data-iu-invoice-root>
  <p class="iu-inv-intro">Údaje se ukládají pouze v tomto prohlížeči. Slouží jako pomůcka — před použitím vždy zkontrolujte správnost.</p>

  <section class="iu-inv-block" aria-labelledby="iu-inv-h-sup">
    <h3 class="iu-inv-h" id="iu-inv-h-sup">Dodavatel</h3>
    <div class="iu-inv-seg" role="group" aria-label="Typ dodavatele">
      ${kindRadios("iu-sup-kind", "fo")}
    </div>
    <div class="iu-inv-fieldGrid" data-inv-panel="supplierFo"></div>
    <div class="iu-inv-fieldGrid iu-inv-guard-hidden" data-inv-panel="supplierPo" hidden></div>
    <div class="iu-inv-fieldGrid">
      ${fieldSelect("supplierVatPayer", "Režim DPH", "1", [
        { v: "1", l: "Plátce DPH" },
        { v: "0", l: "Neplátce DPH" },
      ])}
    </div>
  </section>

  <section class="iu-inv-block" aria-labelledby="iu-inv-h-buy">
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
    <div class="iu-inv-fieldGrid" data-inv-panel="buyerFo"></div>
    <div class="iu-inv-fieldGrid iu-inv-guard-hidden" data-inv-panel="buyerPo" hidden></div>
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
  </section>

  <div class="iu-inv-stickyBar" data-inv-actions>
    <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-copy>Kopírovat text</button>
    <button type="button" class="iu-inv-btn iu-inv-btn--primary" data-inv-preview>Náhled faktury</button>
    <button type="button" class="iu-inv-btn iu-inv-btn--primary" data-inv-share>Sdílet / exportovat</button>
  </div>

  <div class="iu-inv-status" data-inv-status role="status" aria-live="polite"></div>

  <div class="iu-inv-previewLayer iu-inv-guard-hidden" data-inv-preview-layer hidden>
    <div class="iu-inv-previewToolbar">
      <button type="button" class="iu-inv-btn iu-inv-btn--ghost" data-inv-preview-back>Zpět do formuláře</button>
      <button type="button" class="iu-inv-btn iu-inv-btn--primary" data-inv-preview-share>Sdílet / exportovat</button>
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
  root.querySelectorAll("[data-inv]").forEach((el) => {
    const path = el.getAttribute("data-inv");
    if (!path) return;
    const segs = path.split(".");
    if (segs.length < 2) return;
    const a = segs[0];
    const b = segs[1];
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

  const sk = root.querySelector('input[name="iu-sup-kind"]:checked');
  if (sk) st.supplierKind = sk.value === "po" ? "po" : "fo";
  const bk = root.querySelector('input[name="iu-buy-kind"]:checked');
  if (bk) st.buyerKind = bk.value === "po" ? "po" : "fo";
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
  const pfo = root.querySelector('[data-inv-panel="supplierFo"]');
  const ppo = root.querySelector('[data-inv-panel="supplierPo"]');
  const bfo = root.querySelector('[data-inv-panel="buyerFo"]');
  const bpo = root.querySelector('[data-inv-panel="buyerPo"]');
  if (pfo) pfo.hidden = st.supplierKind !== "fo";
  if (ppo) ppo.hidden = st.supplierKind !== "po";
  if (bfo) bfo.hidden = st.buyerKind !== "fo";
  if (bpo) bpo.hidden = st.buyerKind !== "po";
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

export function initIuInvoiceOverlay(deps) {
  const getLock = (deps && deps.iuSetViewportLock) || (typeof window !== "undefined" ? window.iuSetViewportLock : null);

  const backdrop = document.getElementById("iuInvoiceBackdrop");
  const panel = document.getElementById("iuInvoicePanel");
  const scrollHost = document.getElementById("iuInvoiceScrollHost");
  const mount = document.getElementById("iuInvoiceMount");
  const closeBtn = document.getElementById("iuInvoiceClose");

  if (!backdrop || !panel || !scrollHost || !mount) return null;

  let state = loadFormState() || defaultFormState();
  let saveTimer = 0;
  let rootEl = null;

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
        document.body.classList.add("iu-invoice-overlay-open", "iu-modal-open");
        panel.dataset.open = "1";
      } else {
        document.body.classList.remove("iu-invoice-overlay-open", "iu-modal-open");
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

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      persistFormState(state);
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

    async function doShare() {
      readStateFromDom(root, state);
      const v = validateForm(state);
      if (!v.ok) {
        setStatus(root, v.errors.join(" · "));
        return;
      }
      const totals = computeTotals(state);
      const text = buildPlainText(state, totals);
      const title = "Faktura " + String((state.invoice && state.invoice.number) || "").trim();
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({ title: title, text: text });
          setStatus(root, "Sdílení dokončeno nebo zrušeno uživatelem.");
          return;
        } catch (_) {}
      }
      try {
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = (title.replace(/\s+/g, "_") || "faktura") + ".txt";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        setStatus(root, "Stažen textový soubor (fallback).");
      } catch (_) {
        setStatus(root, "Sdílení není k dispozici — zkopírujte text.");
      }
    }

    function openPreview() {
      readStateFromDom(root, state);
      const v = validateForm(state);
      if (!v.ok) {
        setStatus(root, v.errors.join(" · "));
        return;
      }
      const totals = computeTotals(state);
      const host = root.querySelector("[data-inv-preview-host]");
      const layer = root.querySelector("[data-inv-preview-layer]");
      if (!host || !layer) return;
      host.innerHTML = buildInvoiceHtmlPreview(state, totals);
      layer.hidden = false;
      layer.classList.remove("iu-inv-guard-hidden");
      try {
        scrollHost.scrollTop = 0;
      } catch (_) {}
    }

    function closePreview() {
      const layer = root.querySelector("[data-inv-preview-layer]");
      if (layer) {
        layer.hidden = true;
        layer.classList.add("iu-inv-guard-hidden");
      }
    }

    root.querySelector("[data-inv-copy]")?.addEventListener("click", () => {
      doCopy();
    });
    root.querySelector("[data-inv-preview]")?.addEventListener("click", () => {
      openPreview();
    });
    root.querySelector("[data-inv-share]")?.addEventListener("click", () => {
      doShare();
    });
    root.querySelector("[data-inv-preview-back]")?.addEventListener("click", () => {
      closePreview();
    });
    root.querySelector("[data-inv-preview-share]")?.addEventListener("click", () => {
      doShare();
    });
  }

  function openSurface() {
    ensureInBody();
    setLock(true);
    applyBodyOpen(true);
    setVis(true);
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
    wire(rootEl);

    try {
      if (closeBtn) closeBtn.focus();
    } catch (_) {}
    try {
      scrollHost.scrollTop = 0;
    } catch (_) {}
  }

  function closeSurface() {
    if (rootEl) {
      readStateFromDom(rootEl, state);
      persistFormState(state);
    }
    setVis(false);
    setLock(false);
    applyBodyOpen(false);
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
      const layer = rootEl.querySelector("[data-inv-preview-layer]");
      if (layer && !layer.hidden) {
        layer.hidden = true;
        layer.classList.add("iu-inv-guard-hidden");
        e.preventDefault();
        return;
      }
    }
    closeSurface();
  });

  try {
    window.iuInvoiceOpenSurface = openSurface;
    window.iuInvoiceCloseSurface = closeSurface;
    window.ensureInvoiceModalInBody = ensureInBody;
  } catch (_) {}

  return { open: openSurface, close: closeSurface };
}
