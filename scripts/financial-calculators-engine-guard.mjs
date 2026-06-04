/**
 * Node guard: deterministické výpočty finančního enginu (bez DOM).
 */
import assert from "node:assert/strict";
import {
  computeAffordability,
  computeBudget,
  computeDiscount,
  computeDps,
  computeFinancialCalculator,
  computeInflation,
  computeInvestmentGrowth,
  computeLoan,
  computeMortgage,
  computeRefinance,
  computeRentVsMortgage,
  computeSavings,
  computeVat,
} from "../assets/iu-financial-calculators-engine.js";

function okVat(v, base, vat, total) {
  assert.equal(v.ok, true);
  const b = v.outputs.find((o) => o.key === "base").value;
  const t = v.outputs.find((o) => o.key === "total").value;
  const d = v.outputs.find((o) => o.key === "vat").value;
  assert.ok(Math.abs(b - base) < 0.02, `base want ${base} got ${b}`);
  assert.ok(Math.abs(d - vat) < 0.02, `vat want ${vat} got ${d}`);
  assert.ok(Math.abs(t - total) < 0.02, `total want ${total} got ${t}`);
}

okVat(computeVat({ amount: "1000", amountMode: "net", ratePreset: "21" }), 1000, 210, 1210);
okVat(computeVat({ amount: "1210", amountMode: "gross", ratePreset: "21" }), 1000, 210, 1210);
okVat(computeVat({ amount: "1000", amountMode: "net", ratePreset: "12" }), 1000, 120, 1120);

const v0 = computeVat({ amount: "1000", amountMode: "net", ratePreset: "custom", customRate: "0" });
okVat(v0, 1000, 0, 1000);

const v50 = computeVat({ amount: "1000", amountMode: "net", ratePreset: "custom", customRate: "50" });
okVat(v50, 1000, 500, 1500);

const loan = computeLoan({
  principal: "100000",
  annualRatePercent: "10",
  termUnit: "years",
  termLength: "1",
  fee: "0",
});
assert.equal(loan.ok, true);
assert.ok(loan.outputs[0].value > 0);

const loan0 = computeLoan({
  principal: "12000",
  annualRatePercent: "0",
  termUnit: "months",
  termLength: "12",
  fee: "100",
});
assert.equal(loan0.ok, true);
assert.ok(Math.abs(loan0.outputs[0].value - 1000) < 0.02);
assert.ok(Math.abs(loan0.outputs[3].value - 12100) < 0.02);

const mort = computeMortgage({
  principal: "1000000",
  annualRatePercent: "5",
  years: "20",
  propertyPrice: "2000000",
  ownFunds: "1000000",
  fee: "0",
});
assert.equal(mort.ok, true);
assert.ok(mort.outputs.some((o) => o.key === "ltv" && Math.abs(o.value - 50) < 0.1));

const sav = computeSavings({
  initial: "1000",
  monthly: "0",
  annualReturnPercent: "0",
  years: "5",
  capitalization: "monthly",
});
assert.equal(sav.ok, true);
assert.ok(Math.abs(sav.outputs[0].value - 1000) < 0.02);

const sav2 = computeSavings({
  initial: "0",
  monthly: "100",
  annualReturnPercent: "0",
  years: "1",
  capitalization: "monthly",
});
assert.equal(sav2.ok, true);
assert.ok(Math.abs(sav2.outputs[1].value - 1200) < 0.02);

const inf = computeInflation({
  amount: "100000",
  inflationPercent: "2",
  years: "5",
  inflationMode: "nominal_need",
  inflationSource: "manual",
});
assert.equal(inf.ok, true);
const main = inf.outputs.find((o) => o.key === "main").value;
assert.ok(Math.abs(main - 110408.08) < 1);

const inf10 = computeInflation({
  amount: "100000",
  inflationPercent: "10",
  years: "10",
  inflationMode: "real_preserve",
  inflationSource: "manual",
});
assert.equal(inf10.ok, true);

const infz = computeInflation({
  amount: "100000",
  inflationPercent: "0",
  years: "5",
  inflationMode: "real_preserve",
  inflationSource: "manual",
});
assert.equal(infz.ok, true);
assert.ok(Math.abs(infz.outputs[0].value - 100000) < 0.02);

const disc = computeDiscount({ original: "1000", changePercent: "20", direction: "discount" });
assert.equal(disc.ok, true);
assert.ok(Math.abs(disc.outputs[0].value - 800) < 0.02);

const mark = computeDiscount({ original: "1000", changePercent: "15", direction: "markup" });
assert.equal(mark.ok, true);
assert.ok(Math.abs(mark.outputs[0].value - 1150) < 0.02);

const flat = computeDiscount({ original: "500", changePercent: "0", direction: "discount" });
assert.equal(flat.ok, true);
assert.ok(Math.abs(flat.outputs[0].value - 500) < 0.02);

const budOk = computeBudget({
  income: "50000",
  housing: "10000",
  energy: "5000",
  food: "8000",
  transport: "5000",
  loans: "5000",
  other: "5000",
});
assert.equal(budOk.ok, true);
assert.equal(budOk.meta.badge, "ok");

const budTight = computeBudget({
  income: "40000",
  housing: "12000",
  energy: "4000",
  food: "7000",
  transport: "4000",
  loans: "6000",
  other: "3500",
});
assert.equal(budTight.ok, true);
assert.equal(budTight.meta.badge, "tight");

const budDef = computeBudget({
  income: "30000",
  housing: "20000",
  energy: "5000",
  food: "8000",
  transport: "2000",
  loans: "4000",
  other: "3000",
});
assert.equal(budDef.ok, true);
assert.equal(budDef.meta.badge, "deficit");

const unk = computeFinancialCalculator("nope", {});
assert.equal(unk.ok, false);

const aff = computeAffordability({
  netIncome: "80000",
  otherDebts: "5000",
  children: "0",
  annualRatePercent: "5",
  years: "25",
});
assert.equal(aff.ok, true);
assert.ok(aff.outputs.some((o) => o.key === "maxLoan"));

const refi = computeRefinance({
  principal: "2000000",
  currentRatePercent: "5.5",
  newRatePercent: "4.5",
  years: "20",
  fee: "0",
});
assert.equal(refi.ok, true);
assert.ok(refi.outputs.some((o) => o.key === "monthlySave"));

const rvm = computeRentVsMortgage({
  rent: "15000",
  propertyPrice: "5000000",
  downPayment: "1000000",
  mortgageRatePercent: "5",
  years: "30",
  sideCosts: "4000",
});
assert.equal(rvm.ok, true);

const ig = computeInvestmentGrowth({
  initial: "1000",
  monthly: "100",
  annualReturnPercent: "4",
  years: "5",
  capitalization: "monthly",
});
assert.equal(ig.ok, true);

const dps = computeDps({
  monthlyEmployee: "1000",
  employerMonthly: "0",
  years: "15",
  annualReturnPercent: "3",
  stateSupportMonthly: "230",
});
assert.equal(dps.ok, true);

assert.equal(computeFinancialCalculator("income-loss-sick", { netIncome: "40000" }).ok, false);

assert.equal(computeFinancialCalculator("affordability", { netIncome: "50000", otherDebts: "0", children: "0", annualRatePercent: "4", years: "20" }).ok, true);
assert.equal(computeFinancialCalculator("investment-growth", { initial: "0", monthly: "100", annualReturnPercent: "0", years: "3", capitalization: "monthly" }).ok, true);

console.log("PASS financial-calculators-engine-guard");
