/**
 * infoUzel.cz — finanční kalkulačky V1 (pure engine, bez DOM)
 * Deterministické výpočty, bez fetch, vhodné pro unit guard i Silver hook computeFinancialCalculator.
 */

/** Oficiální standardní sazby DPH v ČR (zdroj: legislativa; aktualizace přes IU_FIN_VAT_VERSION). */
export const IU_FIN_VAT_VERSION = "2026-01";
export const IU_FIN_VAT_RATES = Object.freeze({ standard: 21, reduced: 12 });

export function iuFinParseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function iuFinParseNonNeg(raw) {
  const n = iuFinParseNumber(raw);
  if (n == null || n < 0) return null;
  return n;
}

export function iuFinParsePositiveInt(raw) {
  const n = iuFinParseNumber(raw);
  if (n == null || n <= 0) return null;
  return Math.min(1e6, Math.max(1, Math.floor(n + 1e-9)));
}

export function iuFinClampPercent(rate) {
  if (rate == null || !Number.isFinite(rate)) return 0;
  return Math.min(100, Math.max(0, rate));
}

/** Zaokrouhlení jen na výstupu (peníze). */
export function iuFinRoundMoney(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100 + 1e-9) / 100;
}

export function iuFinRoundPercent(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100 + 1e-9) / 100;
}

/**
 * DPH: amountMode 'net' = částka bez DPH, 'gross' = částka s DPH.
 * ratePreset: '21' | '12' | 'custom' + customRate 0–100
 */
export function computeVat(values) {
  const amount = iuFinParseNonNeg(values.amount);
  const mode = values.amountMode === "gross" ? "gross" : "net";
  let ratePct = IU_FIN_VAT_RATES.standard;
  if (values.ratePreset === "12") ratePct = IU_FIN_VAT_RATES.reduced;
  else if (values.ratePreset === "21") ratePct = IU_FIN_VAT_RATES.standard;
  else if (values.ratePreset === "custom") {
    const c = iuFinParseNumber(values.customRate);
    ratePct = c == null ? 0 : iuFinClampPercent(c);
  }
  const r = ratePct / 100;
  if (amount == null) {
    return { ok: false, outputs: [], meta: { ratePct, mode } };
  }
  let base;
  let vat;
  let total;
  if (mode === "net") {
    base = amount;
    vat = base * r;
    total = base + vat;
  } else {
    total = amount;
    if (r === -1) {
      return { ok: false, outputs: [], meta: { ratePct, mode } };
    }
    base = total / (1 + r);
    vat = total - base;
  }
  return {
    ok: true,
    outputs: [
      { key: "base", label: "Základ", value: iuFinRoundMoney(base) },
      { key: "vat", label: "DPH", value: iuFinRoundMoney(vat) },
      { key: "total", label: "Celkem", value: iuFinRoundMoney(total) },
    ],
    meta: { ratePct, mode, vatVersion: IU_FIN_VAT_VERSION },
  };
}

/** Anuitní splátka; months kladné celé; annualRatePercent může být 0. */
export function computeAnnuityLoan(principal, annualRatePercent, months, fee) {
  const P = iuFinParseNonNeg(principal);
  let n = iuFinParsePositiveInt(months);
  const feeN = iuFinParseNonNeg(fee) ?? 0;
  if (n != null) n = Math.min(3600, n);
  if (P == null || n == null) {
    return { ok: false, monthly: 0, totalPaid: 0, totalInterest: 0, totalCost: 0 };
  }
  const apr = iuFinParseNumber(annualRatePercent);
  const rateYear = apr == null ? 0 : Math.max(0, apr) / 100;
  const r = rateYear / 12;
  let monthly;
  if (r <= 0) {
    monthly = P / n;
  } else {
    const pow = Math.pow(1 + r, n);
    if (!Number.isFinite(pow) || pow === 1) {
      monthly = P / n;
    } else {
      monthly = (P * r * pow) / (pow - 1);
    }
  }
  if (!Number.isFinite(monthly) || monthly < 0) monthly = 0;
  const totalPaid = monthly * n;
  const totalInterest = Math.max(0, totalPaid - P);
  const totalCost = totalPaid + feeN;
  return {
    ok: true,
    monthly: iuFinRoundMoney(monthly),
    totalPaid: iuFinRoundMoney(totalPaid),
    totalInterest: iuFinRoundMoney(totalInterest),
    totalCost: iuFinRoundMoney(totalCost),
  };
}

export function computeLoan(values) {
  const principal = values.principal;
  const annualRatePercent = values.annualRatePercent;
  const termUnit = values.termUnit === "years" ? "years" : "months";
  const termN = iuFinParsePositiveInt(values.termLength);
  let months = termN;
  if (termUnit === "years" && termN != null) months = termN * 12;
  const fee = values.fee;
  const a = computeAnnuityLoan(principal, annualRatePercent, months, fee);
  if (!a.ok) return { ok: false, outputs: [] };
  return {
    ok: true,
    outputs: [
      { key: "monthly", label: "Měsíční splátka", value: a.monthly },
      { key: "totalPaid", label: "Celkem zaplaceno (jistina + úrok)", value: a.totalPaid },
      { key: "totalInterest", label: "Celkem na úrocích", value: a.totalInterest },
      { key: "totalCost", label: "Celkové náklady vč. poplatku", value: a.totalCost },
    ],
    meta: { months },
  };
}

export function computeMortgage(values) {
  const principal = values.principal;
  const annualRatePercent = values.annualRatePercent;
  const years = iuFinParsePositiveInt(values.years);
  const months = years == null ? null : Math.min(600, years * 12);
  const propertyPrice = iuFinParseNonNeg(values.propertyPrice);
  const ownFunds = iuFinParseNonNeg(values.ownFunds);
  const fee = values.fee;
  const a = computeAnnuityLoan(principal, annualRatePercent, months, fee);
  if (!a.ok) return { ok: false, outputs: [], meta: {} };
  const outputs = [
    { key: "monthly", label: "Měsíční splátka úvěru", value: a.monthly },
    { key: "totalPaid", label: "Celkem zaplaceno (jistina + úrok)", value: a.totalPaid },
    { key: "totalInterest", label: "Celkem na úrocích", value: a.totalInterest },
    { key: "totalCost", label: "Celkové náklady vč. uvedených poplatků", value: a.totalCost },
  ];
  let ltv = null;
  if (propertyPrice != null && propertyPrice > 0) {
    const loan = iuFinParseNonNeg(principal);
    if (loan != null) {
      ltv = iuFinRoundPercent((loan / propertyPrice) * 100);
    }
  }
  if (ltv != null && Number.isFinite(ltv)) {
    outputs.push({ key: "ltv", label: "LTV (úvěr / cena nemovitosti)", value: ltv, suffix: " %" });
  }
  return {
    ok: true,
    outputs,
    meta: { months, propertyPrice, ownFunds, ltv },
  };
}

/** Kapitalizace: 'monthly' | 'annual'; monthlyDeposit a initial >= 0; annualReturnPercent může být 0. */
export function computeSavings(values) {
  const initial = iuFinParseNonNeg(values.initial) ?? 0;
  const monthly = iuFinParseNonNeg(values.monthly) ?? 0;
  const years = iuFinParsePositiveInt(values.years);
  const apr = iuFinParseNumber(values.annualReturnPercent);
  const ret = apr == null ? 0 : Math.max(0, apr) / 100;
  const cap = values.capitalization === "annual" ? "annual" : "monthly";
  if (years == null) return { ok: false, outputs: [] };

  let balance = initial;
  let totalContributed = initial;

  if (cap === "monthly") {
    const rm = ret / 12;
    const totalMonths = years * 12;
    for (let m = 0; m < totalMonths; m++) {
      balance = balance * (1 + rm) + monthly;
      totalContributed += monthly;
    }
  } else {
    for (let y = 0; y < years; y++) {
      for (let m = 0; m < 12; m++) {
        balance += monthly;
        totalContributed += monthly;
      }
      balance *= 1 + ret;
    }
  }

  const finalBal = iuFinRoundMoney(balance);
  const contributed = iuFinRoundMoney(totalContributed);
  const gain = iuFinRoundMoney(finalBal - contributed);
  return {
    ok: true,
    outputs: [
      { key: "final", label: "Konečný stav", value: finalBal },
      { key: "contributed", label: "Celkem vloženo", value: contributed },
      { key: "gain", label: "Výnos", value: gain },
    ],
    meta: { capitalization: cap },
  };
}

/**
 * inflationMode: 'nominal_need' = kolik Kč bude potřeba za n let pro stejnou kupní sílu;
 * 'real_preserve' = reálná hodnota dnešní částky v cenách dneška za n let.
 */
export function computeInflation(values) {
  const amount = iuFinParseNonNeg(values.amount);
  const years = iuFinParsePositiveInt(values.years);
  const inf = iuFinParseNumber(values.inflationPercent);
  const inflation = inf == null ? 0 : Math.max(0, inf) / 100;
  const mode = values.inflationMode === "nominal_need" ? "nominal_need" : "real_preserve";
  if (amount == null || years == null) return { ok: false, outputs: [] };

  let mainVal;
  let loss;
  let pctChange;
  if (mode === "nominal_need") {
    mainVal = amount * Math.pow(1 + inflation, years);
    loss = mainVal - amount;
    pctChange = amount > 0 ? (loss / amount) * 100 : 0;
  } else {
    mainVal = amount / Math.pow(1 + inflation, years);
    loss = amount - mainVal;
    pctChange = amount > 0 ? (loss / amount) * 100 : 0;
  }

  return {
    ok: true,
    outputs: [
      {
        key: "main",
        label: mode === "nominal_need" ? "Budoucí nominální ekvivalent" : "Reálná hodnota (v cenách dneška)",
        value: iuFinRoundMoney(mainVal),
      },
      { key: "loss", label: "Změna kupní síly (v Kč)", value: iuFinRoundMoney(loss) },
      { key: "pct", label: "Procentní dopad na kupní sílu", value: iuFinRoundPercent(pctChange), suffix: " %" },
    ],
    meta: { mode, inflationSource: values.inflationSource || "manual" },
  };
}

export function computeDiscount(values) {
  const original = iuFinParseNonNeg(values.original);
  const changePct = iuFinParseNumber(values.changePercent);
  const dir = values.direction === "markup" ? "markup" : "discount";
  if (original == null || changePct == null) return { ok: false, outputs: [] };
  const f = dir === "discount" ? 1 - changePct / 100 : 1 + changePct / 100;
  const newPrice = iuFinRoundMoney(original * f);
  const diff = iuFinRoundMoney(newPrice - original);
  const pctFromOrig = original > 0 ? iuFinRoundPercent((diff / original) * 100) : 0;
  return {
    ok: true,
    outputs: [
      { key: "newPrice", label: "Nová cena", value: newPrice },
      { key: "diffKc", label: "Rozdíl v Kč", value: diff },
      { key: "diffPct", label: "Rozdíl v % k původní ceně", value: pctFromOrig, suffix: " %" },
    ],
    meta: { dir },
  };
}

export function computeBudget(values) {
  const income = iuFinParseNonNeg(values.income);
  if (income == null) return { ok: false, outputs: [], meta: { badge: "unknown" } };
  const housing = iuFinParseNonNeg(values.housing) ?? 0;
  const energy = iuFinParseNonNeg(values.energy) ?? 0;
  const food = iuFinParseNonNeg(values.food) ?? 0;
  const transport = iuFinParseNonNeg(values.transport) ?? 0;
  const loans = iuFinParseNonNeg(values.loans) ?? 0;
  const other = iuFinParseNonNeg(values.other) ?? 0;
  const totalExp = housing + energy + food + transport + loans + other;
  const balance = iuFinRoundMoney(income - totalExp);
  const pct = (k) => (income > 0 ? iuFinRoundPercent((k / income) * 100) : 0);

  let badge = "ok";
  if (balance < 0) badge = "deficit";
  else if (income > 0 && balance < income * 0.1) badge = "tight";

  return {
    ok: true,
    outputs: [
      { key: "expenses", label: "Celkové výdaje", value: iuFinRoundMoney(totalExp) },
      { key: "balance", label: "Zůstatek", value: balance },
      { key: "pHousing", label: "Podíl: bydlení", value: pct(housing), suffix: " %" },
      { key: "pEnergy", label: "Podíl: energie", value: pct(energy), suffix: " %" },
      { key: "pFood", label: "Podíl: jídlo", value: pct(food), suffix: " %" },
      { key: "pTransport", label: "Podíl: doprava", value: pct(transport), suffix: " %" },
      { key: "pLoans", label: "Podíl: úvěry", value: pct(loans), suffix: " %" },
      { key: "pOther", label: "Podíl: ostatní", value: pct(other), suffix: " %" },
    ],
    meta: { badge },
  };
}

const COMPUTERS = {
  vat: computeVat,
  loan: computeLoan,
  mortgage: computeMortgage,
  savings: computeSavings,
  inflation: computeInflation,
  discount: computeDiscount,
  budget: computeBudget,
};

export function computeFinancialCalculator(id, values) {
  const fn = COMPUTERS[String(id || "").trim()];
  if (!fn) return { ok: false, outputs: [], meta: { error: "unknown_id" } };
  try {
    return fn(values || {});
  } catch {
    return { ok: false, outputs: [], meta: { error: "compute_throw" } };
  }
}

export function listFinancialCalculatorIds() {
  return Object.keys(COMPUTERS);
}
