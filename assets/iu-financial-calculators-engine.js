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
/** Z měsíční splátky a úroku dopočítá jistinu (inverze anuity). */
export function iuFinLoanPrincipalFromPayment(monthlyPayment, annualRatePercent, months) {
  const M = iuFinParseNonNeg(monthlyPayment);
  const n = iuFinParsePositiveInt(months);
  if (M == null || n == null || M <= 0) return null;
  const apr = iuFinParseNumber(annualRatePercent);
  const rateYear = apr == null ? 0 : Math.max(0, apr) / 100;
  const r = rateYear / 12;
  if (r <= 0) return iuFinRoundMoney(M * n);
  const pow = Math.pow(1 + r, n);
  if (!Number.isFinite(pow) || pow <= 1) return null;
  const p = (M * (pow - 1)) / (r * pow);
  return iuFinRoundMoney(p);
}

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
    meta: {
      months,
      interpretation: "Porovnávejte nabídky i podle RPSN a poplatků; splátka je jen jedna z položek celkové ceny úvěru.",
      chartSeries: null,
    },
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
    meta: {
      months,
      propertyPrice,
      ownFunds,
      ltv,
      interpretation:
        "Orientační měsíční splátka a přeplacení; celkové náklady na bydlení mohou být vyšší (pojištění, údržba, daně).",
      chartSeries: null,
    },
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
    meta: {
      capitalization: cap,
      interpretation: "Model bez zohlednění poplatků, daní a výkyvů trhu; vhodné pro hrubý odhad.",
      chartSeries: null,
    },
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
    meta: {
      mode,
      inflationSource: values.inflationSource || "manual",
      interpretation: "Vlastní sazba inflace; pro oficiální řady lze později napojit datový zdroj (např. ČSÚ).",
      chartSeries: null,
    },
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
    meta: {
      badge,
      interpretation: "Jednoduchý přehled podílů; pro změny priorit použijte konzultaci nebo detailní plán.",
      chartSeries: null,
    },
  };
}

/** Bonita / schvalitelnost — orientační model (45 % disponibilní splátka − závazky − orient. dopad dětí). */
export function computeAffordability(values) {
  const netIncome = iuFinParseNonNeg(values.netIncome);
  const otherDebts = iuFinParseNonNeg(values.otherDebts) ?? 0;
  const children = iuFinParseNonNeg(values.children) ?? 0;
  const annualRatePercent = values.annualRatePercent;
  const years = iuFinParsePositiveInt(values.years);
  if (netIncome == null || years == null) return { ok: false, outputs: [], meta: {} };
  const months = Math.min(600, years * 12);
  const childAdj = Math.min(netIncome, children * 2200);
  const maxPayment = Math.max(0, netIncome * 0.45 - otherDebts - childAdj);
  const maxLoan = iuFinLoanPrincipalFromPayment(maxPayment, annualRatePercent, months);
  if (maxLoan == null || maxLoan <= 0) {
    return {
      ok: true,
      outputs: [
        { key: "maxLoan", label: "Orientační dostupná výše úvěru", value: 0 },
        { key: "safePayment", label: "Orientační bezpečná měsíční splátka", value: iuFinRoundMoney(maxPayment) },
      ],
      meta: {
        interpretation:
          "Při zadaných parametrech vychází orientační rámec na nulový nebo velmi nízký úvěr. Jde o zjednodušený model — banka posuzuje individuálně.",
        chartSeries: null,
      },
    };
  }
  const sched = computeAnnuityLoan(maxLoan, annualRatePercent, months, "0");
  const safePay = sched.ok ? sched.monthly : maxPayment;
  return {
    ok: true,
    outputs: [
      { key: "maxLoan", label: "Orientační dostupná výše úvěru", value: maxLoan },
      { key: "safePayment", label: "Orientační bezpečná měsíční splátka", value: safePay },
      { key: "totalPaid", label: "Celkem zaplaceno při této jistině (splatnost)", value: sched.ok ? sched.totalPaid : 0 },
    ],
    meta: {
      interpretation:
        "Orientační odhad podle zjednodušeného poměru splátky k příjmu; skutečná bonita závisí na interních pravidlech banky a dalších faktorech.",
      chartSeries: null,
    },
  };
}

/** Refinancování — porovnání splátek a úspor. */
export function computeRefinance(values) {
  const principal = iuFinParseNonNeg(values.principal);
  const currentRate = values.currentRatePercent;
  const newRate = values.newRatePercent;
  const years = iuFinParsePositiveInt(values.years);
  const fee = iuFinParseNonNeg(values.fee) ?? 0;
  if (principal == null || years == null) return { ok: false, outputs: [], meta: {} };
  const months = Math.min(600, years * 12);
  const oldA = computeAnnuityLoan(principal, currentRate, months, "0");
  const newA = computeAnnuityLoan(principal, newRate, months, "0");
  if (!oldA.ok || !newA.ok) return { ok: false, outputs: [], meta: {} };
  const monthlySave = iuFinRoundMoney(oldA.monthly - newA.monthly);
  const totalSave = iuFinRoundMoney(monthlySave * months - fee);
  return {
    ok: true,
    outputs: [
      { key: "oldMonthly", label: "Současná měsíční splátka", value: oldA.monthly },
      { key: "newMonthly", label: "Nová měsíční splátka (orient.)", value: newA.monthly },
      { key: "monthlySave", label: "Měsíční úspora", value: monthlySave },
      { key: "totalSave", label: "Celková úspora za zbývající dobu (po poplatku)", value: totalSave },
    ],
    meta: {
      interpretation:
        monthlySave > 0
          ? "Úspora je orientační; zahrňte i poplatky za ukončení starého úvěru, odhad nemovitosti a časové náklady."
          : "Při zadaných sazbách refinancování nemusí přinést úsporu — ověřte i fixaci a podmínky u banky.",
      chartSeries: null,
    },
  };
}

/** Nájem vs hypotéka — měsíční cashflow (nájem vs splátka + vedlejší náklady). */
export function computeRentVsMortgage(values) {
  const rent = iuFinParseNonNeg(values.rent);
  const propertyPrice = iuFinParseNonNeg(values.propertyPrice);
  const downPayment = iuFinParseNonNeg(values.downPayment) ?? 0;
  const annualRatePercent = values.mortgageRatePercent;
  const years = iuFinParsePositiveInt(values.years);
  const sideCosts = iuFinParseNonNeg(values.sideCosts) ?? 0;
  if (rent == null || propertyPrice == null || years == null) return { ok: false, outputs: [], meta: {} };
  const loanAmt = Math.max(0, propertyPrice - downPayment);
  const months = Math.min(600, years * 12);
  const mort = computeAnnuityLoan(loanAmt, annualRatePercent, months, "0");
  if (!mort.ok) return { ok: false, outputs: [], meta: {} };
  const ownCashflow = mort.monthly + sideCosts;
  const delta = iuFinRoundMoney(rent - ownCashflow);
  let verdict = "Nájem i vlastní bydlení jsou orientačně srovnatelné — záleží na riziku, flexibilitě a dalších nákladech.";
  if (delta > 200) verdict = "Nájem vychází měsíčně vyšší než orientační splátka s vedlejšími náklady — vlastní bydlení může být výhodnější na cashflow (ne vždy celkově).";
  else if (delta < -200) verdict = "Orientační měsíční náklady vlastního bydlení převyšují nájem — zvažte akontaci, sazbu a nepeněžní faktory.";
  return {
    ok: true,
    outputs: [
      { key: "rent", label: "Měsíční nájem", value: rent },
      { key: "mortgage", label: "Orientační měsíční splátka úvěru", value: mort.monthly },
      { key: "side", label: "Vedlejší měsíční náklady (vlastní)", value: sideCosts },
      { key: "ownerTotal", label: "Měsíční cashflow vlastní (splátka + vedlejší)", value: iuFinRoundMoney(ownCashflow) },
      { key: "delta", label: "Rozdíl (nájem − vlastní cashflow)", value: delta },
    ],
    meta: { interpretation: verdict, chartSeries: null },
  };
}

/** Složené úročení / investiční růst — stejný jádrový model jako spoření; chartSeries hook pro budoucí graf (bez duplicitní simulace). */
export function computeInvestmentGrowth(values) {
  const res = computeSavings(values);
  if (!res.ok) return res;
  return {
    ok: true,
    outputs: res.outputs.map((o) =>
      o.key === "final"
        ? { ...o, label: "Odhad hodnoty portfolia" }
        : o.key === "contributed"
          ? { ...o, label: "Celkem vloženo" }
          : o.key === "gain"
            ? { ...o, label: "Zisk nad vklady" }
            : o,
    ),
    meta: {
      ...res.meta,
      interpretation: "Výsledek je orientační model bez poplatků a daní; vhodný jako vstup pro plánování.",
      chartSeries: null,
      chartSeriesHook: "investment-growth",
    },
  };
}

/** Potřebný kapitál k pasivnímu příjmu + měsíční investice (zjednodušený bezpečný výběr). */
export function computeAnnuityRenta(values) {
  const targetMonthly = iuFinParseNonNeg(values.targetMonthly);
  const years = iuFinParsePositiveInt(values.years);
  const annualReturnPercent = values.annualReturnPercent;
  const withdrawalPercent = values.withdrawalPercent;
  const wRaw = iuFinParseNumber(withdrawalPercent);
  const w = wRaw == null ? 4 : iuFinClampPercent(wRaw);
  const annualNeed = targetMonthly != null ? targetMonthly * 12 : null;
  if (annualNeed == null || years == null) return { ok: false, outputs: [], meta: {} };
  const wr = Math.max(0.1, w) / 100;
  const requiredCapital = iuFinRoundMoney(annualNeed / wr);
  const apr = iuFinParseNumber(annualReturnPercent);
  const ret = apr == null ? 0 : Math.max(0, apr) / 100;
  const n = years;
  const fv = requiredCapital;
  let monthlyNeed = 0;
  if (n > 0 && ret > 0) {
    const rm = ret / 12;
    const totalM = n * 12;
    const factor = (Math.pow(1 + rm, totalM) - 1) / rm;
    monthlyNeed = factor > 0 ? fv / factor : 0;
  } else if (n > 0) {
    monthlyNeed = fv / (n * 12);
  }
  monthlyNeed = iuFinRoundMoney(monthlyNeed);
  return {
    ok: true,
    outputs: [
      { key: "capital", label: "Potřebný cílový kapitál (orient.)", value: requiredCapital },
      { key: "monthlyInvest", label: "Orientační nutná měsíční investice", value: monthlyNeed },
      { key: "annualDraw", label: "Cílový roční pasivní příjem", value: iuFinRoundMoney(annualNeed) },
    ],
    meta: {
      interpretation:
        "Model používá zjednodušené bezpečné čerpání z kapitálu; reálná renta závisí na daních, struktuře portfolia a inflaci.",
      chartSeries: null,
    },
  };
}

/** Investiční plán k cílové částce — měsíční vklad. */
export function computeInvestmentGoal(values) {
  const target = iuFinParseNonNeg(values.targetAmount);
  const initial = iuFinParseNonNeg(values.initial) ?? 0;
  const years = iuFinParsePositiveInt(values.years);
  const annualReturnPercent = values.annualReturnPercent;
  if (target == null || years == null) return { ok: false, outputs: [], meta: {} };
  const apr = iuFinParseNumber(annualReturnPercent);
  const ret = apr == null ? 0 : Math.max(0, apr) / 100;
  const totalM = years * 12;
  const rm = ret / 12;
  const fvInit = initial * Math.pow(1 + rm, totalM);
  const gap = Math.max(0, target - fvInit);
  let monthly = 0;
  if (gap > 0 && totalM > 0) {
    if (rm <= 0) monthly = gap / totalM;
    else {
      const factor = (Math.pow(1 + rm, totalM) - 1) / rm;
      monthly = factor > 0 ? gap / factor : 0;
    }
  }
  monthly = iuFinRoundMoney(monthly);
  return {
    ok: true,
    outputs: [
      { key: "target", label: "Cílová částka", value: target },
      { key: "monthly", label: "Nutný měsíční vklad (orient.)", value: monthly },
      { key: "fvInit", label: "Hodnota počátečního vkladu v cíli", value: iuFinRoundMoney(fvInit) },
    ],
    meta: {
      interpretation: "Výpočet je zjednodušený; nezahrnuje poplatky, daně ani změnu výnosu v čase.",
      chartSeries: null,
    },
  };
}

/** DIP — orientační daňový benefit a budoucí hodnota (zjednodušený model). */
export function computeDip(values) {
  const monthlyContrib = iuFinParseNonNeg(values.monthlyContrib);
  const marginalTax = values.marginalTaxPercent;
  const years = iuFinParsePositiveInt(values.years);
  const annualReturnPercent = values.annualReturnPercent;
  if (monthlyContrib == null || years == null) return { ok: false, outputs: [], meta: {} };
  const tax = iuFinParseNumber(marginalTax);
  const tr = tax == null ? 0.15 : iuFinClampPercent(tax) / 100;
  const annualContrib = monthlyContrib * 12;
  const orientTaxSave = iuFinRoundMoney(annualContrib * tr * 0.5);
  const sav = computeSavings({
    initial: "0",
    monthly: String(monthlyContrib),
    annualReturnPercent: annualReturnPercent || "0",
    years: String(years),
    capitalization: "monthly",
  });
  const futureVal = sav.ok ? sav.outputs.find((o) => o.key === "final")?.value ?? 0 : 0;
  return {
    ok: true,
    outputs: [
      { key: "taxSave", label: "Orientační roční daňová úspora (model)", value: orientTaxSave },
      { key: "future", label: "Orientační budoucí hodnota vkladů", value: futureVal },
      { key: "contribY", label: "Roční vklady (hrubé)", value: iuFinRoundMoney(annualContrib) },
    ],
    meta: {
      interpretation:
        "Orientační výpočet bez závaznosti; limit odpočtu a podmínky produktu se řídí aktuální legislativou.",
      chartSeries: null,
    },
  };
}

/** DPS — státní příspěvky a budoucí hodnota (zjednodušený model). */
export function computeDps(values) {
  const monthly = iuFinParseNonNeg(values.monthlyEmployee);
  const employer = iuFinParseNonNeg(values.employerMonthly) ?? 0;
  const years = iuFinParsePositiveInt(values.years);
  const annualReturnPercent = values.annualReturnPercent;
  const statePerMonth = iuFinParseNonNeg(values.stateSupportMonthly);
  const st = statePerMonth == null ? 230 : Math.min(5000, statePerMonth);
  if (monthly == null || years == null) return { ok: false, outputs: [], meta: {} };
  const totalMonthly = monthly + employer + st;
  const ownTotal = iuFinRoundMoney(monthly * 12 * years);
  const stateTotal = iuFinRoundMoney(st * 12 * years);
  const empTotal = iuFinRoundMoney(employer * 12 * years);
  const sav = computeSavings({
    initial: "0",
    monthly: String(totalMonthly),
    annualReturnPercent: annualReturnPercent || "0",
    years: String(years),
    capitalization: "monthly",
  });
  const futureVal = sav.ok ? sav.outputs.find((o) => o.key === "final")?.value ?? 0 : 0;
  return {
    ok: true,
    outputs: [
      { key: "own", label: "Vlastní vklady (součet za období)", value: ownTotal },
      { key: "state", label: "Orientační státní příspěvky (součet)", value: stateTotal },
      { key: "employer", label: "Příspěvky zaměstnavatele (součet)", value: empTotal },
      { key: "future", label: "Orientační budoucí hodnota", value: futureVal },
    ],
    meta: {
      interpretation:
        "Model státní podpory je zjednodušený; skutečné připsání a limity závisí na poskytovateli a pravidlech programu.",
      chartSeries: null,
    },
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
  affordability: computeAffordability,
  refinance: computeRefinance,
  "rent-vs-mortgage": computeRentVsMortgage,
  "investment-growth": computeInvestmentGrowth,
  "annuity-rent": computeAnnuityRenta,
  "investment-goal": computeInvestmentGoal,
  dip: computeDip,
  dps: computeDps,
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
