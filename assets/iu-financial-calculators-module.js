/**
 * infoUzel.cz — finanční kalkulačky overlay V1 (registry UI + Silver-ready hooks)
 */
import {
  IU_FIN_VAT_RATES,
  computeAffordability,
  computeAnnuityRenta,
  computeBudget,
  computeDip,
  computeDiscount,
  computeDps,
  computeDisabilityIncome,
  computeFinancialCalculator,
  computeIncomeLossSick,
  computeInflation,
  computeInvestmentGoal,
  computeInvestmentGrowth,
  computeLifeCoverage,
  computeLoan,
  computeMortgage,
  computeRefinance,
  computeRentVsMortgage,
  computeSavings,
  computeVat,
  listFinancialCalculatorIds,
} from "./iu-financial-calculators-engine.js";
import { iuFinCtaConfigIsRenderable, resolveIuFinCta } from "./iu-financial-calculators-cta.js";

const moneyFmt = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtOutRow(row) {
  if (!row) return "";
  const suf = row.suffix != null ? esc(row.suffix) : "";
  let v;
  if (typeof row.value === "number" && Number.isFinite(row.value)) v = moneyFmt.format(row.value);
  else if (typeof row.value === "number") v = "—";
  else v = esc(String(row.value));
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

/** Data-only CTA cíl — rozšíří se později přes window.__iuFinCtaRoutes nebo event iu-fin-cta. */
const IU_FIN_CTA_DELEGATE = Object.freeze({ kind: "delegate" });

/** Registry: id, title, description, accentClass, disclaimers[], build(root, api), readValues(root), defaults */
const IU_FIN_CALC_REGISTRY = [
  {
    id: "vat",
    title: "DPH",
    description: "Přepočet mezi částkou bez DPH, DPH a cenou včetně daně.",
    category: "everyday",
    pillar: "everyday",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Potřebuji poradit s DPH",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "vat",
    resultSummaryMode: "default",
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
    category: "housing_loans",
    pillar: "housing",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Chci spočítat úvěr na míru",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "loan",
    resultSummaryMode: "default",
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
    category: "housing_loans",
    pillar: "housing",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Chci spočítat hypotéku na míru",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "mortgage",
    resultSummaryMode: "default",
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
    category: "investments",
    pillar: "investment",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Nastavit spořicí plán",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "savings",
    resultSummaryMode: "default",
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
    category: "protection",
    pillar: "protection",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Promluvit o ochraně kupní síly",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "inflation",
    resultSummaryMode: "default",
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
    category: "everyday",
    pillar: "everyday",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Projít rozpočet nákupů",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "discount",
    resultSummaryMode: "default",
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
    category: "everyday",
    pillar: "everyday",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Optimalizovat rozpočet s poradcem",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "household-budget",
    resultSummaryMode: "default",
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
  {
    id: "affordability",
    title: "Bonita / schvalitelnost",
    description: "Orientační odhad dostupné jistiny a bezpečné splátky podle zjednodušeného modelu.",
    category: "housing_loans",
    pillar: "housing",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Zjistit bonitu s poradcem",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "affordability",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--affordability",
    disclaimers: [DISCLAIMER_SHORT, DISCLAIMER_RPSN],
    defaults: {
      netIncome: "60000",
      otherDebts: "8000",
      children: "1",
      annualRatePercent: "5.2",
      years: "25",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-info">${esc(DISCLAIMER_RPSN)}</div>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Čistý měsíční příjem (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="netIncome" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Ostatní měsíční splátky / závazky (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="otherDebts" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Počet vyživovaných dětí v domácnosti</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="children" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Úrok p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualRatePercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Splatnost (roky)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        netIncome: g("netIncome"),
        otherDebts: g("otherDebts"),
        children: g("children"),
        annualRatePercent: g("annualRatePercent"),
        years: g("years"),
      };
    },
    compute: computeAffordability,
  },
  {
    id: "refinance",
    title: "Refinancování hypotéky",
    description: "Porovnání současné a nové splátky při stejné zbývající jistině a době.",
    category: "housing_loans",
    pillar: "housing",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Prověřit možnost refinancování",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "refinance",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--refinance",
    disclaimers: [DISCLAIMER_SHORT, DISCLAIMER_RPSN],
    defaults: {
      principal: "2800000",
      currentRatePercent: "5.4",
      newRatePercent: "4.6",
      years: "22",
      fee: "5000",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-info">${esc(DISCLAIMER_RPSN)}</div>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Zbývající jistina (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="principal" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Současná úroková sazba p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="currentRatePercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Nová úroková sazba p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="newRatePercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Zbývající doba splatnosti (roky)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Jednorázové poplatky refinancování (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="fee" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        principal: g("principal"),
        currentRatePercent: g("currentRatePercent"),
        newRatePercent: g("newRatePercent"),
        years: g("years"),
        fee: g("fee"),
      };
    },
    compute: computeRefinance,
  },
  {
    id: "rent-vs-mortgage",
    title: "Nájem vs hypotéka",
    description: "Orientační srovnání měsíčního cashflow nájmu a vlastního bydlení (splátka + vedlejší náklady).",
    category: "housing_loans",
    pillar: "housing",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Probrat variantu bydlení",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "rent-vs-mortgage",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--rentcompare",
    disclaimers: [DISCLAIMER_SHORT, DISCLAIMER_RPSN],
    defaults: {
      rent: "18000",
      propertyPrice: "5500000",
      downPayment: "1000000",
      mortgageRatePercent: "4.8",
      years: "30",
      sideCosts: "3500",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-info">${esc(DISCLAIMER_RPSN)}</div>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Měsíční nájem (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="rent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Cena nemovitosti / úvěru (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="propertyPrice" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Akontace / vlastní zdroje (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="downPayment" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Úrok hypotéky p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="mortgageRatePercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Splatnost (roky)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Vedlejší měsíční náklady vlastníka (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="sideCosts" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        rent: g("rent"),
        propertyPrice: g("propertyPrice"),
        downPayment: g("downPayment"),
        mortgageRatePercent: g("mortgageRatePercent"),
        years: g("years"),
        sideCosts: g("sideCosts"),
      };
    },
    compute: computeRentVsMortgage,
  },
  {
    id: "investment-growth",
    title: "Složené úročení / investiční růst",
    description: "Odhad budoucí hodnoty při pravidelných vkladech — data připravena i pro budoucí graf.",
    category: "investments",
    pillar: "investment",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Nastavit investiční plán",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "investment-growth",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--investgrowth",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: { initial: "20000", monthly: "4000", annualReturnPercent: "5", years: "15", capitalization: "monthly" },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Počáteční vklad (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="initial" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Měsíční vklad (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="monthly" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Očekávané roční zhodnocení (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualReturnPercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Délka investice (roky)</span>
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
    compute: computeInvestmentGrowth,
  },
  {
    id: "annuity-rent",
    title: "Kalkulačka renty",
    description: "Orientační kapitál pro pasivní příjem a nutná měsíční investice (zjednodušený model výběru).",
    category: "investments",
    pillar: "investment",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Navrhnout rentu s poradcem",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "annuity-rent",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--annuity",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: {
      targetMonthly: "25000",
      years: "20",
      annualReturnPercent: "5",
      withdrawalPercent: "4",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Cílový měsíční pasivní příjem (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="targetMonthly" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Horizont do cíle (roky)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Očekávané zhodnocení p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualReturnPercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Bezpečná roční míra výběru (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="withdrawalPercent" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        targetMonthly: g("targetMonthly"),
        years: g("years"),
        annualReturnPercent: g("annualReturnPercent"),
        withdrawalPercent: g("withdrawalPercent"),
      };
    },
    compute: computeAnnuityRenta,
  },
  {
    id: "investment-goal",
    title: "Investiční plán cíle",
    description: "Jaký měsíční vklad potřebujete k dosažení cílové částky (zjednodušený model).",
    category: "investments",
    pillar: "investment",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Sladit plán s poradcem",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "investment-goal",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--goal",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: { targetAmount: "2000000", initial: "100000", annualReturnPercent: "5", years: "12" },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Cílová částka (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="targetAmount" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Počáteční vklad (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="initial" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Očekávané zhodnocení p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualReturnPercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Horizont (roky)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        targetAmount: g("targetAmount"),
        initial: g("initial"),
        annualReturnPercent: g("annualReturnPercent"),
        years: g("years"),
      };
    },
    compute: computeInvestmentGoal,
  },
  {
    id: "dip",
    title: "DIP kalkulačka",
    description: "Orientační daňový benefit a budoucí hodnota příspěvků (zjednodušený model).",
    category: "investments",
    pillar: "investment",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Porovnat DIP",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "pension-dip",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--dip",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: { monthlyContrib: "3000", marginalTaxPercent: "15", years: "25", annualReturnPercent: "4" },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Měsíční vklad (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="monthlyContrib" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Orientační hraniční sazba daně (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="marginalTaxPercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Horizont (roky)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Očekávané zhodnocení p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualReturnPercent" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        monthlyContrib: g("monthlyContrib"),
        marginalTaxPercent: g("marginalTaxPercent"),
        years: g("years"),
        annualReturnPercent: g("annualReturnPercent"),
      };
    },
    compute: computeDip,
  },
  {
    id: "dps",
    title: "DPS kalkulačka",
    description: "Orientační přehled vkladů, státní podpory a budoucí hodnoty (zjednodušený model).",
    category: "investments",
    pillar: "investment",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Porovnat DPS",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "pension-dps",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--dps",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: {
      monthlyEmployee: "1000",
      employerMonthly: "500",
      years: "20",
      annualReturnPercent: "4",
      stateSupportMonthly: "230",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Měsíční příspěvek zaměstnance (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="monthlyEmployee" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Měsíční příspěvek zaměstnavatele (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="employerMonthly" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Orientační státní podpora měsíčně (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="stateSupportMonthly" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Horizont (roky)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="years" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Očekávané zhodnocení p.a. (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualReturnPercent" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        monthlyEmployee: g("monthlyEmployee"),
        employerMonthly: g("employerMonthly"),
        stateSupportMonthly: g("stateSupportMonthly"),
        years: g("years"),
        annualReturnPercent: g("annualReturnPercent"),
      };
    },
    compute: computeDps,
  },
  {
    id: "income-loss-sick",
    title: "Propad příjmu při nemoci",
    description: "Orientační měsíční a celkový propad při snížené náhradě příjmu.",
    category: "protection",
    pillar: "protection",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Řešit ochranu příjmu",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "income-loss",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--sick",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: { netIncome: "42000", replacementPercent: "60", monthsOut: "3" },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Čistý měsíční příjem (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="netIncome" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Odhad náhrady příjmu (% mzdy)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="replacementPercent" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Doba výpadku (měsíce)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="monthsOut" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        netIncome: g("netIncome"),
        replacementPercent: g("replacementPercent"),
        monthsOut: g("monthsOut"),
      };
    },
    compute: computeIncomeLossSick,
  },
  {
    id: "disability-income",
    title: "Invalidita / dlouhodobý výpadek příjmu",
    description: "Zjednodušený odhad měsíční mezery mezi výdaji, podporou a příjmem.",
    category: "protection",
    pillar: "protection",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Řešit zajištění",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "disability-income",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--disability",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: {
      netIncome: "40000",
      stateSupport: "12000",
      familyExpenses: "28000",
      monthsOut: "12",
      incomeReplacementPercent: "30",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Čistý měsíční příjem před výpadkem (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="netIncome" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Orientační měsíční státní podpora (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="stateSupport" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Základní měsíční výdaje domácnosti (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="familyExpenses" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Délka výpadku (měsíce)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="monthsOut" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Odhad náhrady z příjmu / jiných zdrojů (%)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="incomeReplacementPercent" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        netIncome: g("netIncome"),
        stateSupport: g("stateSupport"),
        familyExpenses: g("familyExpenses"),
        monthsOut: g("monthsOut"),
        incomeReplacementPercent: g("incomeReplacementPercent"),
      };
    },
    compute: computeDisabilityIncome,
  },
  {
    id: "life-coverage",
    title: "Potřeba životního krytí",
    description: "Orientační souhrnné krytí podle příjmů, závazků a výdajů — pro úvodní odhad.",
    category: "protection",
    pillar: "protection",
    enabled: true,
    ctaMode: "contact",
    ctaLabel: "Spočítat krytí na míru",
    ctaTarget: IU_FIN_CTA_DELEGATE,
    ctaServiceKey: "life-coverage",
    resultSummaryMode: "default",
    accentClass: "iu-financial-accent--life",
    disclaimers: [DISCLAIMER_SHORT],
    defaults: {
      netIncome: "45000",
      liabilities: "1500000",
      children: "2",
      reserve: "150000",
      annualExpenses: "480000",
      incomeReplaceYears: "8",
    },
    build(root) {
      root.innerHTML = `
        <p class="iu-financial-overlay-desc">${esc(this.description)}</p>
        <div class="iu-financial-overlay-form">
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Čistý měsíční příjem (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="netIncome" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Splátky a závazky (Kč, součet)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="liabilities" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Počet vyživovaných dětí</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="children" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Cílová finanční rezerva (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="reserve" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Roční výdaje domácnosti (Kč)</span>
            <input type="text" inputmode="decimal" class="iu-financial-overlay-input" data-iu-fin-f="annualExpenses" autocomplete="off" /></label>
          <label class="iu-financial-overlay-field"><span class="iu-financial-overlay-label">Horizont náhrady příjmu (roky, model)</span>
            <input type="text" inputmode="numeric" class="iu-financial-overlay-input" data-iu-fin-f="incomeReplaceYears" autocomplete="off" /></label>
        </div>`;
    },
    readValues(root) {
      const g = (k) => (root.querySelector(`[data-iu-fin-f="${k}"]`) || {}).value;
      return {
        netIncome: g("netIncome"),
        liabilities: g("liabilities"),
        children: g("children"),
        reserve: g("reserve"),
        annualExpenses: g("annualExpenses"),
        incomeReplaceYears: g("incomeReplaceYears"),
      };
    },
    compute: computeLifeCoverage,
  },
];

/** Skupiny v přehledu (4 pilíře) — pořadí karet v rámci sekce. */
export const IU_FIN_HUB_SECTIONS = [
  {
    id: "housing_loans",
    title: "Bydlení a úvěry",
    subtitle: "Finance, bydlení, úvěry",
    pillar: "housing",
    calculatorIds: ["mortgage", "loan", "affordability", "refinance", "rent-vs-mortgage"],
  },
  {
    id: "investments",
    title: "Investice a budování majetku",
    subtitle: "Investice, dlouhodobý růst",
    pillar: "investment",
    calculatorIds: ["investment-growth", "annuity-rent", "investment-goal", "dip", "dps", "savings"],
  },
  {
    id: "protection",
    title: "Zabezpečení a penze",
    subtitle: "Příjem, penze, rizika",
    pillar: "protection",
    calculatorIds: ["income-loss-sick", "disability-income", "life-coverage", "inflation"],
  },
  {
    id: "everyday",
    title: "Běžné finance",
    subtitle: "Denní rozhodnutí a rozpočet",
    pillar: "everyday",
    calculatorIds: ["vat", "discount", "budget"],
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

  let __iuFinCalcResizeBound = null;

  function iuFinCalcIsDesktopFullpageGuards() {
    try {
      if (typeof document === "undefined" || !document.body) return false;
      if (typeof window.matchMedia !== "function") return false;
      if (!window.matchMedia("(min-width: 1025px)").matches) return false;
      const p = String(typeof location !== "undefined" && location && location.pathname ? location.pathname : "").replace(/\\/g, "/");
      const hub =
        p === "/projects/" ||
        p === "/projects" ||
        p.indexOf("/projects/") === 0 ||
        p === "/filtr/projects" ||
        p === "/filtr/projects/";
      if (!hub) return false;
      /* P0: Nezáviset na body.iu-desktop-home-grid — iuDesktopHomeSectionGridGuardApply ho může odebrat dřív než existuje #iuSilverTallScrollViewport; pak se nespustil full-page režim (stack + neprůhledný backdrop) při reálném kliku. */
      return true;
    } catch (_) {
      return false;
    }
  }

  function iuFinCalcSyncChromeBottom() {
    try {
      const el = document.getElementById("leftStickyHeader");
      if (!el || !document.documentElement) return;
      const r = el.getBoundingClientRect();
      const px = Math.max(0, Math.round(r.bottom * 1000) / 1000);
      document.documentElement.style.setProperty("--iu-fin-calc-chrome-bottom", px + "px");
    } catch (_) {}
  }

  function iuFinCalcClearDesktopFullpageLayout() {
    try {
      const qf = document.getElementById("iuQuickFeed");
      if (qf) qf.classList.remove("iu-financial-calculators-fullpage");
    } catch (_) {}
    try {
      if (backdrop) backdrop.classList.remove("iu-financial-calculators-fullpage");
    } catch (_) {}
    try {
      if (panel) panel.classList.remove("iu-financial-calculators-fullpage");
    } catch (_) {}
    try {
      if (document.documentElement) document.documentElement.style.removeProperty("--iu-fin-calc-chrome-bottom");
    } catch (_) {}
    try {
      if (__iuFinCalcResizeBound && typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("resize", __iuFinCalcResizeBound, { passive: true });
      }
    } catch (_) {}
    __iuFinCalcResizeBound = null;
  }

  function iuFinCalcApplyDesktopFullpageLayout(active) {
    if (!active) {
      iuFinCalcClearDesktopFullpageLayout();
      return;
    }
    try {
      const qf = document.getElementById("iuQuickFeed");
      if (qf) qf.classList.add("iu-financial-calculators-fullpage");
    } catch (_) {}
    try {
      if (backdrop) backdrop.classList.add("iu-financial-calculators-fullpage");
    } catch (_) {}
    try {
      if (panel) panel.classList.add("iu-financial-calculators-fullpage");
    } catch (_) {}
    iuFinCalcSyncChromeBottom();
    try {
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        __iuFinCalcResizeBound = function () {
          iuFinCalcSyncChromeBottom();
        };
        window.addEventListener("resize", __iuFinCalcResizeBound, { passive: true });
      }
    } catch (_) {}
  }

  function applyBodyOpen(on, opts) {
    const desktopFp = !!(opts && opts.desktopFullpage);
    try {
      if (on) {
        document.body.classList.add("iu-financial-overlay-open", "iu-modal-open");
        if (desktopFp) document.body.classList.add("iu-financial-calculators-overlay-open");
        panel.dataset.open = "1";
      } else {
        document.body.classList.remove(
          "iu-financial-overlay-open",
          "iu-modal-open",
          "iu-financial-calculators-overlay-open",
        );
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
    if (subEl) subEl.textContent = "Čtyři přehledné skupiny: bydlení, investice, zabezpečení, běžné finance";
    titleEl.textContent = "Finanční kalkulačky";
    if (backBtn) backBtn.hidden = true;
    panel.classList.remove("iu-financial-overlay-panel--detail");
    panel.classList.add("iu-financial-overlay-panel--hub");
    const sections = IU_FIN_HUB_SECTIONS.map((sec) => {
      const cards = sec.calculatorIds
        .map((cid) => {
          const c = byId(cid);
          if (!c || c.enabled === false) return "";
          return `<button type="button" class="iu-financial-overlay-card iu-financial-calculator-card ${esc(c.accentClass)}" data-iu-fin-pick="${esc(c.id)}">
        <span class="iu-financial-overlay-cardTitle">${esc(c.title)}</span>
        <span class="iu-financial-overlay-cardDesc">${esc(c.description)}</span>
      </button>`;
        })
        .filter(Boolean)
        .join("");
      return `<section class="iu-fin-hub-section iu-financial-calculators-section" data-iu-fin-hub-section="${esc(sec.id)}">
      <h3 class="iu-fin-hub-sectionTitle">${esc(sec.title)}</h3>
      <p class="iu-fin-hub-sectionSub">${esc(sec.subtitle)}</p>
      <div class="iu-financial-overlay-hubGrid" role="list">${cards}</div>
    </section>`;
    }).join("");
    views.innerHTML = `<div class="iu-fin-hub-wrap iu-financial-calculators-list" data-iu-fin-hub="1">${sections}</div>`;
    views.querySelectorAll("[data-iu-fin-pick]").forEach((btn) => {
      btn.addEventListener("click", () => openCalculator(btn.getAttribute("data-iu-fin-pick"), null));
    });
  }

  function mountResultCta(def, result, wrapEl) {
    if (!wrapEl) return;
    wrapEl.innerHTML = "";
    if (!result || !result.ok) return;
    try {
      if (!iuFinCtaConfigIsRenderable(def)) return;
      const resolved = resolveIuFinCta(def, { calculatorId: def.id });
      if (!resolved.show || typeof resolved.onActivate !== "function") return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "iu-financial-overlay-ctaBtn";
      btn.textContent = resolved.label;
      btn.setAttribute("data-iu-fin-cta-service", resolved.serviceKey || "");
      btn.setAttribute("data-iu-fin-cta-mode", resolved.mode || "");
      btn.addEventListener("click", resolved.onActivate);
      wrapEl.appendChild(btn);
    } catch (_) {}
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
    const interp =
      result.meta && result.meta.interpretation
        ? `<p class="iu-financial-overlay-interpret">${esc(String(result.meta.interpretation))}</p>`
        : "";
    const notes = (def.disclaimers || []).map((t) => `<p class="iu-financial-overlay-footnote">${esc(t)}</p>`).join("");
    container.innerHTML = `<div class="iu-financial-overlay-results">${rows}${interp}</div><div class="iu-financial-overlay-ctaHost" data-iu-fin-cta-wrap></div><div class="iu-financial-overlay-footnotes">${notes}</div>`;
    mountResultCta(def, result, container.querySelector("[data-iu-fin-cta-wrap]"));
  }

  function wireCalculator(def, root, resultsEl) {
    function run() {
      const vals = def.readValues(root);
      let res;
      try {
        res = def.compute(vals);
      } catch (_) {
        res = {
          ok: false,
          outputs: [],
          meta: { interpretation: "Výpočet se nepodařilo dokončit. Zkontrolujte vstupy (čísla, jednotky)." },
        };
      }
      if (!res || typeof res !== "object") res = { ok: false, outputs: [] };
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
    try {
      if (panel) panel.scrollTop = 0;
    } catch (_) {}
  }

  function openSurface(extra) {
    state.lastFocus = document.activeElement;
    ensureInBody();
    const desktopFp = iuFinCalcIsDesktopFullpageGuards();
    iuFinCalcApplyDesktopFullpageLayout(!!desktopFp);
    setLock(true);
    applyBodyOpen(true, { desktopFullpage: !!desktopFp });
    setVis(true);
    try {
      panel.classList.toggle("iu-financial-overlay-panel--mobile", window.matchMedia("(max-width: 1023px)").matches);
      panel.classList.toggle("iu-financial-overlay-panel--desktop", window.matchMedia("(min-width: 1025px)").matches);
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
    iuFinCalcClearDesktopFullpageLayout();
    applyBodyOpen(false, { desktopFullpage: false });
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
      try {
        if (panel) panel.scrollTop = 0;
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

  /**
   * BFCache / partial nav / chybějící close: DOM říká overlay zavřený, ale body může držet
   * iu-financial-* + iu-modal-open a viewport lock → uživatel vidí „prázdnou“ stránku / nejde scrollovat.
   * Revert CSS (#2665) tento stav neřeší — je to JS stav vs. DOM.
   *
   * P0: Musí chytit i rozpad dataset.open vs. hidden (např. dataset "1" ale oba uzly už mají hidden),
   * jinak stará podmínka domClosed vracela false a reconcile se nespustil.
   */
  function iuFinCalcReconcileOrphanBodyState() {
    try {
      if (!document.body) return;
      const bd = document.getElementById("iuFinancialCalcBackdrop");
      const pn = document.getElementById("iuFinancialCalcPanel");
      if (!bd || !pn) {
        try {
          document.body.classList.remove(
            "iu-financial-overlay-open",
            "iu-financial-calculators-overlay-open",
          );
        } catch (_) {}
        return;
      }
      const finOnBody =
        document.body.classList.contains("iu-financial-calculators-overlay-open") ||
        document.body.classList.contains("iu-financial-overlay-open");
      if (!finOnBody) {
        try {
          iuFinCalcClearDesktopFullpageLayout();
        } catch (_) {}
        return;
      }

      const openFlag = String(pn.dataset.open || "0") === "1";
      const bothHiddenAttr = bd.hasAttribute("hidden") && pn.hasAttribute("hidden");
      let bothInvis = false;
      try {
        const unseen = (el) => {
          const s = getComputedStyle(el);
          return s.display === "none" || s.visibility === "hidden";
        };
        bothInvis = unseen(bd) && unseen(pn);
      } catch (_) {}

      /* Skutečně otevřený povrch: dataset 1 a alespoň jeden z backdrop/panel není „zavřený“ v DOM ani computed. */
      const finSurfaceReallyOpen =
        openFlag &&
        !bothHiddenAttr &&
        !bothInvis;

      if (finSurfaceReallyOpen) return;

      document.body.classList.remove(
        "iu-financial-overlay-open",
        "iu-financial-calculators-overlay-open",
      );
      iuFinCalcClearDesktopFullpageLayout();
      try {
        setLock(false);
      } catch (_) {}
      try {
        if (typeof window.iuSetViewportLock === "function") {
          window.iuSetViewportLock(false);
        }
      } catch (_) {}
      try {
        const others =
          typeof window !== "undefined" &&
          typeof window.iuDetectOpenOverlays === "function"
            ? window.iuDetectOpenOverlays()
            : null;
        if (Array.isArray(others) && others.length === 0) {
          document.body.classList.remove("iu-modal-open");
        }
      } catch (_) {}
    } catch (_) {}
  }

  try {
    if (typeof window !== "undefined") {
      window.iuFinCalcReconcileOrphanBodyState = iuFinCalcReconcileOrphanBodyState;
      const runReconcile = function () {
        try {
          iuFinCalcReconcileOrphanBodyState();
        } catch (_) {}
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", runReconcile, { once: true });
      } else {
        setTimeout(runReconcile, 0);
      }
      window.addEventListener("pageshow", runReconcile);
    }
  } catch (_) {}

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
