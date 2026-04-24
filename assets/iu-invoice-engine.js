/**
 * infoUzel.cz — fakturační modul: čistá logika (stav, výpočty, validace, text).
 */

export const IU_INVOICE_FORM_KEY = "iu_invoice_form_state_v1";
export const IU_INVOICE_RECIPIENTS_KEY = "iu_invoice_recipients_v1";
export const IU_INVOICE_SUPPLIERS_KEY = "iu_invoice_suppliers_v1";
export const IU_INVOICE_COUNTER_KEY = "iu_invoice_counter_year_v1";

export function escHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function newId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return "id_" + String(Date.now()) + "_" + String(Math.random()).slice(2, 9);
}

export function nextAutoInvoiceNumber() {
  try {
    const y = new Date().getFullYear();
    const key = IU_INVOICE_COUNTER_KEY + "_" + y;
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    let n = raw ? parseInt(String(raw), 10) : 0;
    if (!Number.isFinite(n) || n < 0) n = 0;
    n += 1;
    if (typeof localStorage !== "undefined") localStorage.setItem(key, String(n));
    return String(y) + String(n).padStart(4, "0");
  } catch (_) {
    return String(new Date().getFullYear()) + "0001";
  }
}

export function emptyLine(vatPayer) {
  return {
    id: newId(),
    name: "",
    description: "",
    qty: "1",
    unit: "ks",
    unitPrice: "",
    vatRate: vatPayer ? "21" : "0",
  };
}

export function defaultFormState() {
  const today = new Date();
  const iso = (d) => {
    try {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    } catch (_) {
      return "";
    }
  };
  const due = new Date(today);
  due.setDate(due.getDate() + 14);
  return {
    supplierKind: "fo",
    supplierVatPayer: true,
    supplierFo: {
      firstName: "",
      lastName: "",
      tradeName: "",
      ico: "",
      dic: "",
      address: "",
      phone: "",
      email: "",
      accountNumber: "",
      bank: "",
    },
    supplierPo: {
      companyName: "",
      legalForm: "",
      ico: "",
      dic: "",
      address: "",
      courtRegistry: "",
      fileMark: "",
      contactPerson: "",
      phone: "",
      email: "",
      accountNumber: "",
      bank: "",
    },
    buyerKind: "fo",
    buyerFo: {
      firstName: "",
      lastName: "",
      ico: "",
      dic: "",
      address: "",
      phone: "",
      email: "",
    },
    buyerPo: {
      companyName: "",
      legalForm: "",
      ico: "",
      dic: "",
      address: "",
      courtRegistry: "",
      fileMark: "",
      contactPerson: "",
      phone: "",
      email: "",
    },
    invoice: {
      number: "",
      autoNumber: true,
      issueDate: iso(today),
      dueDate: iso(due),
      taxableDate: iso(today),
      variableSymbol: "",
      payment: "transfer",
      accountNumber: "",
      bankCode: "",
      iban: "",
      swift: "",
    },
    lines: [emptyLine(true)],
  };
}

export function parseNum(str) {
  if (str == null) return NaN;
  const t = String(str).trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return NaN;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

export function parseIco(ico) {
  const d = String(ico || "").replace(/\D/g, "");
  return d;
}

export function parseVatRate(str) {
  const n = parseInt(String(str || "0"), 10);
  if (!Number.isFinite(n)) return 0;
  if ([0, 5, 10, 15, 21].indexOf(n) === -1) return 0;
  return n;
}

/**
 * @param {number} qty
 * @param {number} unitPrice
 * @param {number} vatPct
 * @param {boolean} supplierVatPayer
 */
export function lineAmounts(qty, unitPrice, vatPct, supplierVatPayer) {
  const base = Math.round(qty * unitPrice * 100) / 100;
  if (!supplierVatPayer) {
    return { base, vat: 0, gross: base };
  }
  const vat = Math.round(base * (vatPct / 100) * 100) / 100;
  const gross = Math.round((base + vat) * 100) / 100;
  return { base, vat, gross };
}

export function computeTotals(state) {
  const payer = !!state.supplierVatPayer;
  let sumBase = 0;
  let sumVat = 0;
  let sumGross = 0;
  const lineDetails = [];
  (state.lines || []).forEach((ln) => {
    const qty = parseNum(ln.qty);
    const up = parseNum(ln.unitPrice);
    const vr = payer ? parseVatRate(ln.vatRate) : 0;
    if (!Number.isFinite(qty) || !Number.isFinite(up)) {
      lineDetails.push({ base: 0, vat: 0, gross: 0 });
      return;
    }
    const a = lineAmounts(qty, up, vr, payer);
    sumBase += a.base;
    sumVat += a.vat;
    sumGross += a.gross;
    lineDetails.push(a);
  });
  sumBase = Math.round(sumBase * 100) / 100;
  sumVat = Math.round(sumVat * 100) / 100;
  sumGross = Math.round(sumGross * 100) / 100;
  return { sumBase, sumVat, sumGross, payer, lineDetails };
}

export function validateForm(state) {
  const err = [];
  const icoOk = (s, required) => {
    const d = parseIco(s);
    if (!required && !d) return true;
    return d.length === 8;
  };

  if (state.supplierKind === "fo") {
    const fo = state.supplierFo || {};
    if (!String(fo.firstName || "").trim()) err.push("Dodavatel: jméno");
    if (!String(fo.lastName || "").trim()) err.push("Dodavatel: příjmení");
    if (!icoOk(fo.ico, true)) err.push("Dodavatel: IČO (8 číslic)");
    if (!String(fo.address || "").trim()) err.push("Dodavatel: adresa");
    if (!String(fo.accountNumber || "").trim()) err.push("Dodavatel: číslo účtu");
  } else {
    const po = state.supplierPo || {};
    if (!String(po.companyName || "").trim()) err.push("Dodavatel: název společnosti");
    if (!String(po.legalForm || "").trim()) err.push("Dodavatel: právní forma");
    if (!icoOk(po.ico, true)) err.push("Dodavatel: IČO (8 číslic)");
    if (!String(po.address || "").trim()) err.push("Dodavatel: sídlo");
    if (!String(po.fileMark || "").trim()) err.push("Dodavatel: spisová značka");
    if (!String(po.courtRegistry || "").trim()) err.push("Dodavatel: zápis u soudu / rejstříku");
    if (!String(po.accountNumber || "").trim()) err.push("Dodavatel: číslo účtu");
  }

  if (state.buyerKind === "fo") {
    const fo = state.buyerFo || {};
    if (!String(fo.firstName || "").trim()) err.push("Odběratel: jméno");
    if (!String(fo.lastName || "").trim()) err.push("Odběratel: příjmení");
    if (!String(fo.address || "").trim()) err.push("Odběratel: adresa");
    if (fo.ico && !icoOk(fo.ico, false)) err.push("Odběratel: IČO musí mít 8 číslic");
  } else {
    const po = state.buyerPo || {};
    if (!String(po.companyName || "").trim()) err.push("Odběratel: název společnosti");
    if (!String(po.legalForm || "").trim()) err.push("Odběratel: právní forma");
    if (!icoOk(po.ico, true)) err.push("Odběratel: IČO (8 číslic)");
    if (!String(po.address || "").trim()) err.push("Odběratel: sídlo");
    if (!String(po.fileMark || "").trim()) err.push("Odběratel: spisová značka");
    if (!String(po.courtRegistry || "").trim()) err.push("Odběratel: zápis u soudu / rejstříku");
  }

  const inv = state.invoice || {};
  if (!String(inv.number || "").trim()) err.push("Faktura: číslo");
  ["issueDate", "dueDate", "taxableDate"].forEach((k) => {
    if (!String(inv[k] || "").trim()) err.push("Faktura: datum (" + k + ")");
  });

  if (inv.payment === "transfer") {
    if (!String(inv.accountNumber || "").trim()) err.push("Platba převodem: číslo účtu");
  }

  const lines = state.lines || [];
  if (!lines.length) err.push("Položky: přidejte alespoň jednu položku");
  lines.forEach((ln, i) => {
    const idx = i + 1;
    if (!String(ln.name || "").trim()) err.push("Položka " + idx + ": název");
    const qty = parseNum(ln.qty);
    if (!Number.isFinite(qty) || qty <= 0) err.push("Položka " + idx + ": množství");
    const up = parseNum(ln.unitPrice);
    if (!Number.isFinite(up)) err.push("Položka " + idx + ": cena za jednotku");
  });

  return { ok: err.length === 0, errors: err };
}

/** Uložení profilu dodavatele — bez validace odběratele / položek. */
export function validateSupplierProfile(state) {
  const err = [];
  const icoOk = (s, required) => {
    const d = parseIco(s);
    if (!required && !d) return true;
    return d.length === 8;
  };
  if (state.supplierKind === "fo") {
    const fo = state.supplierFo || {};
    if (!String(fo.firstName || "").trim()) err.push("Dodavatel: jméno");
    if (!String(fo.lastName || "").trim()) err.push("Dodavatel: příjmení");
    if (!icoOk(fo.ico, true)) err.push("Dodavatel: IČO (8 číslic)");
    if (!String(fo.address || "").trim()) err.push("Dodavatel: adresa");
    if (!String(fo.accountNumber || "").trim()) err.push("Dodavatel: číslo účtu");
  } else {
    const po = state.supplierPo || {};
    if (!String(po.companyName || "").trim()) err.push("Dodavatel: název společnosti");
    if (!String(po.legalForm || "").trim()) err.push("Dodavatel: právní forma");
    if (!icoOk(po.ico, true)) err.push("Dodavatel: IČO (8 číslic)");
    if (!String(po.address || "").trim()) err.push("Dodavatel: sídlo");
    if (!String(po.fileMark || "").trim()) err.push("Dodavatel: spisová značka");
    if (!String(po.courtRegistry || "").trim()) err.push("Dodavatel: zápis u soudu / rejstříku");
    if (!String(po.accountNumber || "").trim()) err.push("Dodavatel: číslo účtu");
  }
  return { ok: err.length === 0, errors: err };
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " Kč";
  } catch (_) {
    return String(Math.round(n * 100) / 100) + " Kč";
  }
}

function fmtDateCs(iso) {
  const s = String(iso || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return m[3] + "." + m[2] + "." + m[1];
}

export function supplierBlockText(state) {
  if (state.supplierKind === "fo") {
    const fo = state.supplierFo || {};
    const lines = [];
    lines.push(String(fo.firstName || "").trim() + " " + String(fo.lastName || "").trim());
    if (String(fo.tradeName || "").trim()) lines.push("Obch. název: " + fo.tradeName.trim());
    lines.push("IČO: " + parseIco(fo.ico));
    if (String(fo.dic || "").trim()) lines.push("DIČ: " + fo.dic.trim());
    lines.push(String(fo.address || "").trim());
    if (String(fo.phone || "").trim()) lines.push("Tel.: " + fo.phone.trim());
    if (String(fo.email || "").trim()) lines.push("E-mail: " + fo.email.trim());
    lines.push("Účet: " + String(fo.accountNumber || "").trim());
    if (String(fo.bank || "").trim()) lines.push("Banka: " + fo.bank.trim());
    lines.push(state.supplierVatPayer ? "Plátce DPH" : "Neplátce DPH");
    return lines.filter(Boolean).join("\n");
  }
  const po = state.supplierPo || {};
  const lines = [];
  lines.push(String(po.companyName || "").trim());
  if (String(po.legalForm || "").trim()) lines.push(po.legalForm.trim());
  lines.push("IČO: " + parseIco(po.ico));
  if (String(po.dic || "").trim()) lines.push("DIČ: " + po.dic.trim());
  lines.push("Sídlo: " + String(po.address || "").trim());
  lines.push("Spisová značka: " + String(po.fileMark || "").trim());
  lines.push("Zápis: " + String(po.courtRegistry || "").trim());
  if (String(po.contactPerson || "").trim()) lines.push("Kontakt: " + po.contactPerson.trim());
  if (String(po.phone || "").trim()) lines.push("Tel.: " + po.phone.trim());
  if (String(po.email || "").trim()) lines.push("E-mail: " + po.email.trim());
  lines.push("Účet: " + String(po.accountNumber || "").trim());
  if (String(po.bank || "").trim()) lines.push("Banka: " + po.bank.trim());
  lines.push(state.supplierVatPayer ? "Plátce DPH" : "Neplátce DPH");
  return lines.filter(Boolean).join("\n");
}

export function buyerBlockText(state) {
  if (state.buyerKind === "fo") {
    const fo = state.buyerFo || {};
    const lines = [];
    lines.push(String(fo.firstName || "").trim() + " " + String(fo.lastName || "").trim());
    if (parseIco(fo.ico)) lines.push("IČO: " + parseIco(fo.ico));
    if (String(fo.dic || "").trim()) lines.push("DIČ: " + fo.dic.trim());
    lines.push(String(fo.address || "").trim());
    if (String(fo.phone || "").trim()) lines.push("Tel.: " + fo.phone.trim());
    if (String(fo.email || "").trim()) lines.push("E-mail: " + fo.email.trim());
    return lines.filter(Boolean).join("\n");
  }
  const po = state.buyerPo || {};
  const lines = [];
  lines.push(String(po.companyName || "").trim());
  if (String(po.legalForm || "").trim()) lines.push(po.legalForm.trim());
  lines.push("IČO: " + parseIco(po.ico));
  if (String(po.dic || "").trim()) lines.push("DIČ: " + po.dic.trim());
  lines.push("Sídlo: " + String(po.address || "").trim());
  lines.push("Spisová značka: " + String(po.fileMark || "").trim());
  lines.push("Zápis: " + String(po.courtRegistry || "").trim());
  if (String(po.contactPerson || "").trim()) lines.push("Kontakt: " + po.contactPerson.trim());
  if (String(po.phone || "").trim()) lines.push("Tel.: " + po.phone.trim());
  if (String(po.email || "").trim()) lines.push("E-mail: " + po.email.trim());
  return lines.filter(Boolean).join("\n");
}

export function buildPlainText(state, totals) {
  const inv = state.invoice || {};
  const pay = inv.payment === "cash" ? "Hotově" : "Převodem";
  let bank = "";
  if (inv.payment === "transfer") {
    bank =
      "Účet: " +
      String(inv.accountNumber || "").trim() +
      (inv.bankCode ? " / " + String(inv.bankCode).trim() : "") +
      (inv.iban ? "\nIBAN: " + inv.iban : "") +
      (inv.swift ? "\nSWIFT: " + inv.swift : "");
  }
  const lines = [];
  lines.push("FAKTURA č. " + String(inv.number || "").trim());
  lines.push("");
  lines.push("Dodavatel:");
  lines.push(supplierBlockText(state));
  lines.push("");
  lines.push("Odběratel:");
  lines.push(buyerBlockText(state));
  lines.push("");
  lines.push("Datum vystavení: " + fmtDateCs(inv.issueDate));
  lines.push("Datum splatnosti: " + fmtDateCs(inv.dueDate));
  lines.push("DUZP: " + fmtDateCs(inv.taxableDate));
  lines.push("Způsob úhrady: " + pay);
  if (String(inv.variableSymbol || "").trim()) lines.push("Variabilní symbol: " + inv.variableSymbol.trim());
  if (bank) lines.push(bank);
  lines.push("");
  lines.push("Položky:");
  (state.lines || []).forEach((ln, i) => {
    const qty = parseNum(ln.qty);
    const up = parseNum(ln.unitPrice);
    const vr = totals.payer ? parseVatRate(ln.vatRate) : 0;
    const a = lineAmounts(Number.isFinite(qty) ? qty : 0, Number.isFinite(up) ? up : 0, vr, totals.payer);
    lines.push(
      String(i + 1) +
        ". " +
        String(ln.name || "").trim() +
        (ln.description ? " — " + String(ln.description).trim() : ""),
    );
    lines.push(
      "   " +
        String(qty) +
        " " +
        String(ln.unit || "ks") +
        " × " +
        fmtMoney(up) +
        (totals.payer ? " (DPH " + vr + "%)" : "") +
        " = " +
        fmtMoney(a.gross),
    );
  });
  lines.push("");
  if (totals.payer) {
    lines.push("Mezisoučet bez DPH: " + fmtMoney(totals.sumBase));
    lines.push("DPH: " + fmtMoney(totals.sumVat));
  }
  lines.push("Celkem k úhradě: " + fmtMoney(totals.sumGross));
  lines.push("");
  lines.push("www.infoUzel.cz");
  return lines.join("\n");
}

/** Jednotná vizuální HTML šablona faktury (náhled + PDF). Neplain-text export. */
export function buildInvoicePaperHtml(state, totals) {
  const inv = state.invoice || {};
  const brand = "#881337";
  const rows = (state.lines || [])
    .map((ln, i) => {
      const qty = parseNum(ln.qty);
      const up = parseNum(ln.unitPrice);
      const vr = totals.payer ? parseVatRate(ln.vatRate) : 0;
      const a = lineAmounts(Number.isFinite(qty) ? qty : 0, Number.isFinite(up) ? up : 0, vr, totals.payer);
      return (
        "<tr><td>" +
        escHtml(String(i + 1)) +
        "</td><td>" +
        escHtml(ln.name) +
        (ln.description ? "<div class=\"iu-inv-pr-desc\">" + escHtml(ln.description) + "</div>" : "") +
        "</td><td class=\"iu-inv-pr-num\">" +
        escHtml(String(ln.qty)) +
        "</td><td>" +
        escHtml(ln.unit || "ks") +
        "</td><td class=\"iu-inv-pr-num\">" +
        escHtml(fmtMoney(up)) +
        "</td>" +
        (totals.payer ? "<td class=\"iu-inv-pr-num\">" + escHtml(String(vr)) + "%</td>" : "") +
        "<td class=\"iu-inv-pr-num iu-inv-pr-strong\">" +
        escHtml(fmtMoney(a.gross)) +
        "</td></tr>"
      );
    })
    .join("");
  const payLabel = inv.payment === "cash" ? "Hotově" : "Převodem";
  let bankHtml = "";
  if (inv.payment === "transfer") {
    bankHtml =
      "<div class=\"iu-inv-pr-bank\">Účet: " +
      escHtml(inv.accountNumber) +
      (inv.bankCode ? " / " + escHtml(inv.bankCode) : "") +
      (inv.iban ? "<br/>IBAN: " + escHtml(inv.iban) : "") +
      (inv.swift ? "<br/>SWIFT: " + escHtml(inv.swift) : "") +
      "</div>";
  }
  return (
    "<div class=\"iu-inv-pr\">" +
    "<div class=\"iu-inv-pr-head\" style=\"border-left:4px solid " +
    brand +
    ";\">" +
    "<div class=\"iu-inv-pr-created\">Vytvořeno pomocí infoUzel.cz</div>" +
    "<div class=\"iu-inv-pr-title\">FAKTURA</div>" +
    "<div class=\"iu-inv-pr-no\">číslo faktury " +
    escHtml(inv.number) +
    "</div></div>" +
    "<div class=\"iu-inv-pr-grid\">" +
    "<div><div class=\"iu-inv-pr-h\">Dodavatel</div><pre class=\"iu-inv-pr-pre\">" +
    escHtml(supplierBlockText(state)) +
    "</pre></div>" +
    "<div><div class=\"iu-inv-pr-h\">Odběratel</div><pre class=\"iu-inv-pr-pre\">" +
    escHtml(buyerBlockText(state)) +
    "</pre></div></div>" +
    "<table class=\"iu-inv-pr-meta\"><tbody>" +
    "<tr><th>Datum vystavení</th><td>" +
    escHtml(fmtDateCs(inv.issueDate)) +
    "</td><th>Splatnost</th><td>" +
    escHtml(fmtDateCs(inv.dueDate)) +
    "</td></tr>" +
    "<tr><th>DUZP</th><td>" +
    escHtml(fmtDateCs(inv.taxableDate)) +
    "</td><th>Úhrada</th><td>" +
    escHtml(payLabel) +
    "</td></tr>" +
    (inv.variableSymbol
      ? "<tr><th>VS</th><td colspan=\"3\">" + escHtml(inv.variableSymbol) + "</td></tr>"
      : "") +
    "</tbody></table>" +
    bankHtml +
    "<table class=\"iu-inv-pr-table\"><thead><tr><th>#</th><th>Položka</th><th>Množ.</th><th>Jedn.</th><th>Cena / j.</th>" +
    (totals.payer ? "<th>DPH</th>" : "") +
    "<th>Celkem</th></tr></thead><tbody>" +
    rows +
    "</tbody></table>" +
    "<div class=\"iu-inv-pr-totals\">" +
    (totals.payer
      ? "<div>Mezisoučet bez DPH: <strong>" +
        escHtml(fmtMoney(totals.sumBase)) +
        "</strong></div><div>DPH: <strong>" +
        escHtml(fmtMoney(totals.sumVat)) +
        "</strong></div>"
      : "") +
    "<div class=\"iu-inv-pr-due\">Celkem k úhradě: " +
    escHtml(fmtMoney(totals.sumGross)) +
    "</div></div>" +
    "<div class=\"iu-inv-pr-foot\">www.infoUzel.cz · Vytvořeno pomocí infoUzel.cz</div></div>"
  );
}

/**
 * Samostatná A4 / PDF šablona (print režim). Nesmí být plain text.
 * Náhled overlay používá buildInvoicePaperHtml — tato funkce je jen pro PDF/tisk.
 */
export function buildInvoicePrintHtml(state, totals) {
  const inv = state.invoice || {};
  const rows = (state.lines || [])
    .map((ln, i) => {
      const qty = parseNum(ln.qty);
      const up = parseNum(ln.unitPrice);
      const vr = totals.payer ? parseVatRate(ln.vatRate) : 0;
      const a = lineAmounts(Number.isFinite(qty) ? qty : 0, Number.isFinite(up) ? up : 0, vr, totals.payer);
      return (
        "<tr class=\"iu-invoice-print-item-row\">" +
        "<td class=\"iu-invoice-print-col-desc\">" +
        "<span class=\"iu-invoice-print-line-no\">" +
        escHtml(String(i + 1)) +
        ".</span> " +
        escHtml(ln.name) +
        (ln.description
          ? "<div class=\"iu-invoice-print-desc\">" + escHtml(ln.description) + "</div>"
          : "") +
        "</td><td class=\"iu-invoice-print-col-qty iu-invoice-print-num\">" +
        escHtml(String(ln.qty)) +
        " " +
        escHtml(ln.unit || "ks") +
        "</td><td class=\"iu-invoice-print-col-price iu-invoice-print-num\">" +
        escHtml(fmtMoney(up)) +
        "</td>" +
        (totals.payer
          ? "<td class=\"iu-invoice-print-col-vat iu-invoice-print-num\">" + escHtml(String(vr)) + "%</td>"
          : "") +
        "<td class=\"iu-invoice-print-col-total iu-invoice-print-num iu-invoice-print-strong\">" +
        escHtml(fmtMoney(a.gross)) +
        "</td></tr>"
      );
    })
    .join("");
  const payCash = inv.payment === "cash";
  const payCell = payCash
    ? "<strong class=\"iu-invoice-print-pay iu-invoice-print-pay--cash\">Hotově</strong>"
    : "<span class=\"iu-invoice-print-pay iu-invoice-print-pay--transfer\">Převodem</span>";
  let bankHtml = "";
  if (inv.payment === "transfer") {
    bankHtml =
      "<div class=\"iu-invoice-print-bank\"><strong>Platební údaje</strong><br/>Účet: " +
      escHtml(inv.accountNumber) +
      (inv.bankCode ? " / " + escHtml(inv.bankCode) : "") +
      (inv.iban ? "<br/>IBAN: " + escHtml(inv.iban) : "") +
      (inv.swift ? "<br/>SWIFT: " + escHtml(inv.swift) : "") +
      "</div>";
  }
  const theadCols =
    "<th class=\"iu-invoice-print-th-desc\">Popis</th>" +
    "<th class=\"iu-invoice-print-th-qty\">Množství</th>" +
    "<th class=\"iu-invoice-print-th-price\">Jedn. cena</th>" +
    (totals.payer ? "<th class=\"iu-invoice-print-th-vat\">DPH</th>" : "") +
    "<th class=\"iu-invoice-print-th-total\">Celkem</th>";
  return (
    "<header class=\"iu-invoice-print-header\">" +
    "<em class=\"iu-invoice-print-brand\">Vytvořeno pomocí infoUzel.cz</em>" +
    "</header>" +
    "<div class=\"iu-invoice-print-title-bar\">" +
    "<h1 class=\"iu-invoice-print-title\">FAKTURA</h1>" +
    "</div>" +
    "<div class=\"iu-invoice-print-docno\">číslo faktury " +
    escHtml(inv.number) +
    "</div>" +
    "<div class=\"iu-invoice-print-docno-gap\" aria-hidden=\"true\"></div>" +
    "<div class=\"iu-invoice-print-parties\">" +
    "<div class=\"iu-invoice-print-party\">" +
    "<div class=\"iu-invoice-print-section-label iu-invoice-print-section-label--bold iu-invoice-print-section-title\">Dodavatel</div>" +
    "<pre class=\"iu-invoice-print-pre\">" +
    escHtml(supplierBlockText(state)) +
    "</pre></div>" +
    "<div class=\"iu-invoice-print-party\">" +
    "<div class=\"iu-invoice-print-section-label iu-invoice-print-section-label--bold iu-invoice-print-section-title\">Odběratel</div>" +
    "<pre class=\"iu-invoice-print-pre\">" +
    escHtml(buyerBlockText(state)) +
    "</pre></div></div>" +
    "<section class=\"iu-invoice-print-section\">" +
    "<div class=\"iu-invoice-print-meta iu-invoice-print-meta--grid\">" +
    "<div class=\"iu-invoice-print-meta-field\">" +
    "<div class=\"iu-invoice-print-meta-k\">Datum vystavení</div>" +
    "<div class=\"iu-invoice-print-meta-v\">" +
    escHtml(fmtDateCs(inv.issueDate)) +
    "</div></div>" +
    "<div class=\"iu-invoice-print-meta-field\">" +
    "<div class=\"iu-invoice-print-meta-k\">Datum splatnosti</div>" +
    "<div class=\"iu-invoice-print-meta-v\">" +
    escHtml(fmtDateCs(inv.dueDate)) +
    "</div></div>" +
    "<div class=\"iu-invoice-print-meta-field\">" +
    "<div class=\"iu-invoice-print-meta-k\">DUZP</div>" +
    "<div class=\"iu-invoice-print-meta-v\">" +
    escHtml(fmtDateCs(inv.taxableDate)) +
    "</div></div>" +
    "<div class=\"iu-invoice-print-meta-field\">" +
    "<div class=\"iu-invoice-print-meta-k\">Způsob úhrady</div>" +
    "<div class=\"iu-invoice-print-meta-v iu-invoice-print-pay-cell\">" +
    payCell +
    "</div></div>" +
    (inv.variableSymbol
      ? "<div class=\"iu-invoice-print-meta-field iu-invoice-print-meta-field--full\">" +
        "<div class=\"iu-invoice-print-meta-k\">Variabilní symbol</div>" +
        "<div class=\"iu-invoice-print-meta-v\">" +
        escHtml(inv.variableSymbol) +
        "</div></div>"
      : "") +
    "</div></section>" +
    bankHtml +
    "<table class=\"iu-invoice-print-table iu-invoice-print-items" +
    (totals.payer ? " iu-invoice-print-items--vat" : "") +
    "\"><thead><tr>" +
    theadCols +
    "</tr></thead><tbody>" +
    rows +
    "</tbody></table>" +
    "<div class=\"iu-invoice-print-total\">" +
    (totals.payer ? "<div class=\"iu-invoice-print-total-gap-before-sub\"></div>" : "") +
    (totals.payer
      ? "<div class=\"iu-invoice-print-total-line\">Mezisoučet bez DPH: <span class=\"iu-invoice-print-strong\">" +
        escHtml(fmtMoney(totals.sumBase)) +
        "</span></div><div class=\"iu-invoice-print-total-line\">DPH: <span class=\"iu-invoice-print-strong\">" +
        escHtml(fmtMoney(totals.sumVat)) +
        "</span></div>"
      : "") +
    "<div class=\"iu-invoice-print-total-due\"><strong class=\"iu-invoice-print-total-due-label\">Celkem k úhradě</strong> " +
    "<strong class=\"iu-invoice-print-total-due-amount\">" +
    escHtml(fmtMoney(totals.sumGross)) +
    "</strong></div>" +
    "<div class=\"iu-invoice-print-total-gap-after-due\" aria-hidden=\"true\"></div></div>" +
    "<footer class=\"iu-invoice-print-footer\">www.infoUzel.cz</footer>"
  );
}

/** @deprecated alias — používej buildInvoicePaperHtml */
export function buildInvoiceHtmlPreview(state, totals) {
  return buildInvoicePaperHtml(state, totals);
}

export function loadRecipients() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(IU_INVOICE_RECIPIENTS_KEY) : null;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && x.id && x.data)
      .map((x) => ({
        id: String(x.id),
        label: String(x.label || x.data.companyName || x.data.lastName || "Odběratel"),
        lastUsed: typeof x.lastUsed === "number" ? x.lastUsed : 0,
        data: x.data,
      }))
      .sort((a, b) => {
        if (b.lastUsed !== a.lastUsed) return b.lastUsed - a.lastUsed;
        return String(a.label).localeCompare(String(b.label), "cs");
      });
  } catch (_) {
    return [];
  }
}

export function saveRecipients(list) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(IU_INVOICE_RECIPIENTS_KEY, JSON.stringify(list));
  } catch (_) {}
}

export function loadSuppliers() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(IU_INVOICE_SUPPLIERS_KEY) : null;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && x.id && x.data)
      .map((x) => ({
        id: String(x.id),
        label: String(x.label || ""),
        lastUsed: typeof x.lastUsed === "number" ? x.lastUsed : 0,
        data: x.data,
      }))
      .sort((a, b) => {
        if (b.lastUsed !== a.lastUsed) return b.lastUsed - a.lastUsed;
        return String(a.label).localeCompare(String(b.label), "cs");
      });
  } catch (_) {
    return [];
  }
}

export function saveSuppliers(list) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(IU_INVOICE_SUPPLIERS_KEY, JSON.stringify(list));
  } catch (_) {}
}

export function snapshotSupplier(state) {
  return {
    supplierKind: state.supplierKind,
    supplierVatPayer: !!state.supplierVatPayer,
    supplierFo: Object.assign({}, state.supplierFo),
    supplierPo: Object.assign({}, state.supplierPo),
  };
}

export function applySupplierSnapshot(state, snap) {
  const next = Object.assign({}, state);
  next.supplierKind = snap.supplierKind === "po" ? "po" : "fo";
  next.supplierVatPayer = !!snap.supplierVatPayer;
  next.supplierFo = Object.assign({}, state.supplierFo, snap.supplierFo || {});
  next.supplierPo = Object.assign({}, state.supplierPo, snap.supplierPo || {});
  return next;
}

export function snapshotBuyer(state) {
  return {
    buyerKind: state.buyerKind,
    buyerFo: Object.assign({}, state.buyerFo),
    buyerPo: Object.assign({}, state.buyerPo),
  };
}

export function applyBuyerSnapshot(state, snap) {
  const next = Object.assign({}, state);
  next.buyerKind = snap.buyerKind || "fo";
  next.buyerFo = Object.assign({}, state.buyerFo, snap.buyerFo || {});
  next.buyerPo = Object.assign({}, state.buyerPo, snap.buyerPo || {});
  return next;
}

export function loadFormState() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(IU_INVOICE_FORM_KEY) : null;
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    const d = defaultFormState();
    return Object.assign(d, o, {
      supplierFo: Object.assign(d.supplierFo, o.supplierFo || {}),
      supplierPo: Object.assign(d.supplierPo, o.supplierPo || {}),
      buyerFo: Object.assign(d.buyerFo, o.buyerFo || {}),
      buyerPo: Object.assign(d.buyerPo, o.buyerPo || {}),
      invoice: Object.assign(d.invoice, o.invoice || {}),
      lines: Array.isArray(o.lines) && o.lines.length ? o.lines.map((ln) => Object.assign(emptyLine(!!o.supplierVatPayer), ln)) : d.lines,
    });
  } catch (_) {
    return null;
  }
}

export function persistFormState(state) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(IU_INVOICE_FORM_KEY, JSON.stringify(state));
  } catch (_) {}
}
