/**
 * infoUzel.cz — finanční kalkulačky overlay V1 (registry UI + Silver-ready hooks)
 */
import {
  IU_FIN_VAT_RATES,
  computeBudget,
  computeDiscount,
  computeFinancialCalculator,
  computeInflation,
  computeLoan,
  computeMortgage,
  computeSavings,
  computeVat,
  listFinancialCalculatorIds,
} from "./iu-financial-calculators-engine.js";

const moneyFmt = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtOutRow(row) {
  if (!row) return "";
  const suf = row.suffix != null ? esc(row.suffix) : "";
  const v = typeof row.value === "number" && Number.isFinite(row.value) ? moneyFmt.format(row.value) : esc(String(row.value));
  return `<div class="iu-financial-overlay-resultRow" data-iu-fin-res="${esc(row.key || "")}"><span class="iu-financial-overlay-resultLabel">${esc(row.label)}</span><span class="iu-financial-overlay-resultValue">${v}${suf}</span></div>`;
}

function fmtBudgetBadge(badge) {
  if (badge === "deficit") return { text: "Deficit", cls: "iu-financial-overlay-badge--deficit" };
  if (badge === "tight") return { text: "Napjaté", cls: "iu-financial-overlay-badge--tight" };
  return { text: "V pořádku", cls: "iu-financial-overlay-badge--ok" };
}

const DISCLAIMER_SHORT =
  "Výsledek je orientační. U úvěrových produktů vždy porovnávejte i další podmínky a poplatky.";
const DISCLAIMER_RPSN =
  "Pro porovnání nabídek sledujte i ukazatel RPSN/APRC, protože zahrnuje nákladovost úvěru šířeji než samotný úrok.";
const DISCLAIMER_DPH = "Orientační výpočet. Nejedná se o právní nebo daňové posouzení.";
const DISCLAIMER_INFLATION =
  "Metodicky odpovídá výpočet vlastní sazbě; oficiální řady CPI publikuje ČSÚ (vhodné pro budoucí napojení dat).";

/** Registry: id, title, description, accentClass, disclaimers[], build(root, api), readValues(root), defaults */
const IU_FIN_CALC_REGISTRY = [
  {
    id: "vat",
    title: "DPH",
    description: "Přepočet mezi částkou bez DPH, DPH a cenou včetně daně.",
    accentClass: "iu-financial-accent--vat",
    disclaimers: [DISCLAIMER_DPH, DISCLAIMER_SHORT],
    defaults: { amount: "1000", amountMode: "net", ratePreset: "21", customRate: "15" },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Částka (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="amount" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Režim</span>
            <select class="iu-financial-overlay-input" data-iu-fin-f="amountMode">
              <option value="net">Bez DPH (základ)</option>
              <option value="gross">S DPH (celkem)</option>
            </select></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Sazba DPH</span>
            <select class="iu-financial-overlay-input" data-iu-fin-f="ratePreset">
              <option value="21">${IU_FIN_VAT_RATES.standard} % (základní)</option>
              <option value="12">${IU_FIN_VAT_RATES.reduced} % (snížená)</option>
              <option value="custom">Vlastní sazba</option>
            </select></label>
          <label class="iu-financial-overlay-field iu-financial-overlay-field--customRate" hidden><span class="iu-financial-overlay-label">Vlastní sazba (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="customRate" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        amount: g("amount"),
        amountMode: g("amountMode"),
        ratePreset: g("ratePreset"),
        customRate: g("customRate"),
      };
    },
    afterMount(root, api) {
      const sel = root.querySelector('[data-iu-fin-f="ratePreset"]');
      const wrap = root.querySelector(".iu-financial-overlay-field--customRate");
      function sync() {
        const show = sel && sel.value === "custom";
        if (wrap) wrap.hidden = !show;
      }
      if (sel) sel.addEventListener("change", sync);
      sync();
    },
    compute: computeVat,
  },
  {
    id: "loan",
    title: "Úvěr / půjčka",
    description: "Odhad měsíční splátky a celkových nákladů u anuitního splácení.",
    accentClass: "iu-financial-accent--loan",
    disclaimers: [DISCLAIMER_SHORT, DISCLAIMER_RPSN],
    defaults: { principal: "200000", annualRatePercent: "8.5", termUnit: "years", termLength: "5", fee: "0" },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-info">${esc(DISCLAIMER_RPSN)}</div>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Výše úvěru (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="principal" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Nominální úrok p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualRatePercent" autocomplete="off" /></label>
          <div class="iu-financial-overlay-fieldRow">
            <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Doba splácení</span>
              <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="termLength" autocomplete="off" /></label>
            <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Jednotka</span>
              <select class="iu-financial-overlay-input" data-iu-fin-f="termUnit">
                <option value="months">Měsíce</option>
                <option value="years">Roky</option>
              </select></label>
          </div>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Jednorázový poplatek (Kč, volitelně)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="fee" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        principal: g("principal"),
        annualRatePercent: g("annualRatePercent"),
        termUnit: g("termUnit"),
        termLength: g("termLength"),
        fee: g("fee"),
      };
    },
    compute: computeLoan,
  },
  {
    id: "mortgage",
    title: "Hypotéka",
    description: "Měsíční splátka jistiny a úroků u standardního anuitního modelu.",
    accentClass: "iu-financial-accent--mortgage",
    disclaimers: [DISCLAIMER_SHORT, DISCLAIMER_RPSN],
    defaults: {
      principal: "3500000",
      annualRatePercent: "4.2",
      years: "30",
      propertyPrice: "5000000",
      ownFunds: "1500000",
      fee: "0",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <p class="iu-financial-overlay-noteStrong">Výsledek je <strong>splátka úvěru</strong>, nikoli automaticky veškeré náklady na bydlení (poplatky, pojištění, údržba…).</p>
        <div class="iu-financial-overlay-info">${esc(DISCLAIMER_RPSN)}</div>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Výše hypotéky (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="principal" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Úrok p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualRatePercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Splatnost (roky)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Cena nemovitosti (Kč, volitelně — LTV)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="propertyPrice" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Vlastní zdroje (Kč, volitelně)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="ownFunds" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Poplatky nad rámec úroku (Kč, volitelně)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="fee" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        principal: g("principal"),
        annualRatePercent: g("annualRatePercent"),
        years: g("years"),
        propertyPrice: g("propertyPrice"),
        ownFunds: g("ownFunds"),
        fee: g("fee"),
      };
    },
    compute: computeMortgage,
  },
  {
    id: "savings",
    title: "Spoření / zhodnocení",
    description: "Odhad konečného stavu při pravidelných vkladech a složeném úročení.",
    accentClass: "iu-financial-accent--savings",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: { initial: "50000", monthly: "3000", annualReturnPercent: "4", years: "10", capitalization: "monthly" },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Počáteční vklad (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="initial" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Měsíční vklad (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="monthly" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Roční zhodnocení (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualReturnPercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Délka (roky)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Kapitalizace úroku</span>
            <select class="iu-financial-overlay-input" data-iu-fin-f="capitalization">
              <option value="monthly">Měsíční</option>
              <option value="annual">Roční</option>
            </select></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        initial: g("initial"),
        monthly: g("monthly"),
        annualReturnPercent: g("annualReturnPercent"),
        years: g("years"),
        capitalization: g("capitalization"),
      };
    },
    compute: computeSavings,
  },
  {
    id: "inflation",
    title: "Inflace / reálná hodnota",
    description: "Model kupní síly podle zadané roční inflace (vlastní sazba; připraveno na datový adaptér ČSÚ).",
    accentClass: "iu-financial-accent--inflation",
    disclaimers: [DISCLAIMER_SHORT, DISCLAIMER_INFLATION],
    defaults: {
      amount: "100000",
      inflationPercent: "3",
      years: "5",
      inflationMode: "real_preserve",
      inflationSource: "manual",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Režim výstupu</span>
            <select class="iu-financial-overlay-input" data-iu-fin-f="inflationMode">
              <option value="real_preserve">Reálná hodnota dnešní částky (v cenách dneška)</option>
              <option value="nominal_need">Budoucí nominální ekvivalent (stejná kupní síla)</option>
            </select></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Zdroj sazby (V1)</span>
            <select class="iu-financial-overlay-input" data-iu-fin-f="inflationSource">
              <option value="manual">Vlastní sazba</option>
              <option value="orient">Orientační výpočet podle zadané inflace</option>
            </select></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Částka (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="amount" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Roční inflace (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="inflationPercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Počet let</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        inflationMode: g("inflationMode"),
        inflationSource: g("inflationSource"),
        amount: g("amount"),
        inflationPercent: g("inflationPercent"),
        years: g("years"),
      };
    },
    compute: computeInflation,
  },
  {
    id: "discount",
    title: "Sleva / změna ceny",
    description: "Rychlý přepočet ceny po slevě nebo zdražení.",
    accentClass: "iu-financial-accent--discount",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: { original: "1000", changePercent: "20", direction: "discount" },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Původní cena (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="original" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Změna (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="changePercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Režim</span>
            <select class="iu-financial-overlay-input" data-iu-fin-f="direction">
              <option value="discount">Sleva</option>
              <option value="markup">Zdražení</option>
            </select></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return { original: g("original"), changePercent: g("changePercent"), direction: g("direction") };
    },
    compute: computeDiscount,
  },
  {
    id: "budget",
    title: "Rozpočet domácnosti",
    description: "Jednoduchý přehled výdajů vůči příjmům a podílům kategorií.",
    accentClass: "iu-financial-accent--budget",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: {
      income: "45000",
      housing: "12000",
      energy: "4500",
      food: "9000",
      transport: "3500",
      loans: "5000",
      other: "4000",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Čisté příjmy domácnosti (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="income" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Bydlení</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="housing" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Energie</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="energy" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Jídlo</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="food" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Doprava</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="transport" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Úvěry</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="loans" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Ostatní</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="other" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        income: g("income"),
        housing: g("housing"),
        energy: g("energy"),
        food: g("food"),
        transport: g("transport"),
        loans: g("loans"),
        other: g("other"),
      };
    },
    compute: computeBudget,
  },
];

function byId(id) {
  return IU_FIN_CALC_REGISTRY.find((x) => x.id === id) || null;
}

export function initIuFinancialCalculatorsOverlay(deps) {
  const getLock = (deps && deps.iuSetViewportLock) || (typeof window !== "undefined" ? window.iuSetViewportLock : null);

  const backdrop = document.getElementById("iuFinancialCalcBackdrop");
  const panel = document.getElementById("iuFinancialCalcPanel");
  const scrollHost = document.getElementById("iuFinancialCalcScrollHost");
  const views = document.getElementById("iuFinancialCalcViews");
  const titleEl = document.getElementById("iuFinancialCalcTitle");
  const subEl = document.getElementById("iuFinancialCalcSub");
  const backBtn = document.getElementById("iuFinancialCalcBack");
  const closeBtn = document.getElementById("iuFinancialCalcClose");

  if (!backdrop || !panel || !scrollHost || !views || !titleEl) return null;

  const state = {
    view: "hub",
    activeId: null,
    lastFocus: null,
  };

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
        document.body.classList.add("iu-financial-overlay-open", "iu-modal-open");
        panel.dataset.open = "1";
      } else {
        document.body.classList.remove("iu-financial-overlay-open", "iu-modal-open");
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

  function renderHub() {
    state.view = "hub";
    state.activeId = null;
    if (subEl) subEl.textContent = "Praktické výpočty pro běžné finance";
    titleEl.textContent = "Finanční kalkulačky";
    if (backBtn) backBtn.hidden = true;
    panel.classList.remove("iu-financial-overlay-panel--detail");
    panel.classList.add("iu-financial-overlay-panel--hub");
    const cards = IU_FIN_CALC_REGISTRY.map((c) => {
      return `<button type="button" class="iu-financial-overlay-card ${esc(c.accentClass)}" data-iu-fin-pick="${esc(c.id)}">
        <span class="iu-financial-overlay-cardTitle">${esc(c.title)}</span>
        <span class="iu-financial-overlay-cardDesc">${esc(c.description)}</span>
      </button>`;
    }).join("");
    views.innerHTML = `<div class="iu-financial-overlay-hubGrid" role="list">${cards}</div>`;
    views.querySelectorAll("[data-iu-fin-pick]").forEach((btn) => {
      btn.addEventListener("click", () => openCalculator(btn.getAttribute("data-iu-fin-pick"), null));
    });
  }

  function applyDefaults(def, root) {
    if (!def.defaults) return;
    Object.keys(def.defaults).forEach((k) => {
      const inp = root.querySelector(`[data-iu-fin-f="${k}"]`);
      if (inp) inp.value = def.defaults[k] != null ? String(def.defaults[k]) : "";
    });
  }

  function renderResults(def, result, container) {
    if (!result || !result.ok) {
      container.innerHTML = `<div class="iu-financial-overlay-results iu-financial-overlay-results--empty"><p class="iu-financial-overlay-muted">Vyplňte platné hodnoty pro výpočet.</p></div>`;
      return;
    }
    let rows = (result.outputs || []).map(fmtOutRow).join("");
    if (def.id === "budget" && result.meta && result.meta.badge) {
      const b = fmtBudgetBadge(result.meta.badge);
      rows =
        `<div class="iu-financial-overlay-badgeRow"><span class="iu-financial-overlay-badge ${esc(b.cls)}">${esc(b.text)}</span></div>` +
        rows;
    }
    const notes = (def.disclaimers || []).map((t) => `<p class="iu-financial-overlay-footnote">${esc(t)}</p>`).join("");
    container.innerHTML = `<div class="iu-financial-overlay-results">${rows}</div><div class="iu-financial-overlay-footnotes">${notes}</div>`;
  }

  function wireCalculator(def, root, resultsEl) {
    function run() {
      const vals = def.readValues(root);
      const res = def.compute(vals);
      renderResults(def, res, resultsEl);
      try {
        root.__iuFinLastResult = { id: def.id, values: vals, result: res };
      } catch (_) {}
    }
    root.addEventListener("input", run);
    root.addEventListener("change", run);
    if (typeof def.afterMount === "function") {
      try {
        def.afterMount(root, { run });
      } catch (_) {}
    }
    run();
    return run;
  }

  function openCalculator(id, preset) {
    const def = byId(id);
    if (!def) return;
    state.view = "detail";
    state.activeId = id;
    if (subEl) subEl.textContent = def.description;
    titleEl.textContent = def.title;
    if (backBtn) backBtn.hidden = false;
    panel.classList.add("iu-financial-overlay-panel--detail");
    panel.classList.remove("iu-financial-overlay-panel--hub");
    /** Detail wrapper: no iu-financial-accent--* — left strip is hub-card-only (see iu-financial-overlay.css). */
    views.innerHTML = `<div class="iu-financial-overlay-detail iu-fin-calc-detail" data-iu-fin-calc-detail="1">
      <div class="iu-financial-overlay-detailInner" data-iu-fin-active="${esc(id)}"></div>
      <div class="iu-financial-overlay-actions">
        <button type="button" class="iu-financial-overlay-reset" data-iu-fin-reset>Reset</button>
      </div>
      <div class="iu-financial-overlay-resultsHost" data-iu-fin-results></div>
    </div>`;
    const inner = views.querySelector(".iu-financial-overlay-detailInner");
    const resultsHost = views.querySelector("[data-iu-fin-results]");
    def.build(inner);
    applyDefaults(def, inner);
    if (preset && typeof preset === "object") {
      Object.keys(preset).forEach((k) => {
        const inp = inner.querySelector(`[data-iu-fin-f="${k}"]`);
        if (inp) inp.value = preset[k] != null ? String(preset[k]) : "";
      });
    }
    const runFn = wireCalculator(def, inner, resultsHost);
    const resetBtn = views.querySelector("[data-iu-fin-reset]");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        applyDefaults(def, inner);
        if (typeof runFn === "function") runFn();
      });
    }
    try {
      scrollHost.scrollTop = 0;
    } catch (_) {}
  }

  function openSurface(extra) {
    state.lastFocus = document.activeElement;
    ensureInBody();
    setLock(true);
    applyBodyOpen(true);
    setVis(true);
    try {
      panel.classList.toggle("iu-financial-overlay-panel--mobile", window.matchMedia("(max-width: 1023px)").matches);
      panel.classList.toggle("iu-financial-overlay-panel--desktop", window.matchMedia("(min-width: 1024px)").matches);
    } catch (_) {}
    const ex = extra && typeof extra === "object" ? extra : {};
    if (ex.calculatorId) {
      renderHub();
      openCalculator(String(ex.calculatorId), ex.presetValues || null);
    } else {
      renderHub();
    }
    try {
      if (closeBtn) closeBtn.focus();
    } catch (_) {}
  }

  function closeSurface() {
    setVis(false);
    setLock(false);
    applyBodyOpen(false);
    state.view = "hub";
    state.activeId = null;
    views.innerHTML = "";
    try {
      if (state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
    } catch (_) {}
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      renderHub();
      try {
        scrollHost.scrollTop = 0;
      } catch (_) {}
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
  const cardShell = panel.querySelector(".iu-financial-overlay-cardShell");
  if (cardShell) {
    cardShell.addEventListener("click", (e) => e.stopPropagation());
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (panel.hasAttribute("hidden")) return;
    closeSurface();
  });

  try {
    window.iuFinancialCalcOpenSurface = openSurface;
    window.iuFinancialCalcCloseSurface = closeSurface;
    window.ensureFinancialModalInBody = ensureInBody;
  } catch (_) {}

  const api = {
    open: () => openSurface(null),
    openCalculator: (id, preset) => openSurface({ calculatorId: id, presetValues: preset || null }),
    compute: (id, values) => computeFinancialCalculator(id, values),
    close: closeSurface,
    registryIds: () => listFinancialCalculatorIds(),
  };
  try {
    window.__iuFinancialCalculators = api;
  } catch (_) {}

  return api;
}

export { IU_FIN_CALC_REGISTRY };
