#!/usr/bin/env node
/**
 * Unit + schema guards: change math + MPSV labour parsers (no live network required for math).
 * Optional live: IU_MPSV_LIVE=1
 */
import assert from "assert";
import {
  computeComparableChange,
  IU_CHANGE_UNAVAILABLE,
  trendFromComparablePair,
  trendFromPercentPoint,
} from "../assets/iu-info-panel-change-utils.js";
import {
  aggregateNationalPnoRows,
  aggregateNationalVacanciesCsv,
  periodLabelFromIsoDate,
} from "./mpsv_labor_open_data.mjs";
import { IU_INFO_PANEL_CATALOG } from "../assets/iu-desktop-info-panel-catalog.js";

function ok(label) {
  console.log("PASS", label);
}

// --- change math ---
{
  const w = computeComparableChange(51280, 50172, { unit: "Kč", indicatorId: "avg_wage" });
  assert.strictEqual(w.direction, "up");
  assert.ok(w.text.includes("Kč"), w.text);
  assert.ok(!w.text.includes("50174"), w.text);
  ok("wage_absolute_with_unit");
}

{
  const bad = computeComparableChange(50174, 0, { unit: "Kč", indicatorId: "avg_wage" });
  assert.strictEqual(bad.text, IU_CHANGE_UNAVAILABLE);
  ok("wage_vs_zero_unavailable");
}

{
  const miss = trendFromComparablePair({ value: 100 }, null, { unit: "", indicatorId: "education" });
  assert.strictEqual(miss.text, IU_CHANGE_UNAVAILABLE);
  ok("missing_prev_unavailable");
}

{
  const u = computeComparableChange(4.79, 4.99, {
    unit: "%",
    indicatorId: "unemployment",
    kind: "percentage_points",
  });
  assert.strictEqual(u.direction, "down");
  assert.ok(u.text.includes("p. b."), u.text);
  ok("unemployment_percentage_points");
}

{
  const pct = trendFromPercentPoint(2.5);
  assert.ok(pct.text.includes("%"), pct.text);
  ok("crypto_percent_trend");
}

{
  const jump = computeComparableChange(500230, 100, { unit: "žáků", indicatorId: "education" });
  assert.strictEqual(jump.text, IU_CHANGE_UNAVAILABLE);
  ok("absurd_ratio_rejected");
}

// --- MPSV parsers ---
{
  assert.strictEqual(periodLabelFromIsoDate("2026-06-30"), "červen 2026");
  const series = aggregateNationalPnoRows([
    {
      rozhodne_datum: "2026-05-31",
      pocet_uchazeci_dosazitelni: 100,
      pocet_uchazeci_v_evidenci: 110,
      pocet_obyvatel_vek_15_64: 2000,
    },
    {
      rozhodne_datum: "2026-05-31",
      pocet_uchazeci_dosazitelni: 50,
      pocet_uchazeci_v_evidenci: 55,
      pocet_obyvatel_vek_15_64: 1000,
    },
    {
      rozhodne_datum: "2026-06-30",
      pocet_uchazeci_dosazitelni: 200,
      pocet_uchazeci_v_evidenci: 220,
      pocet_obyvatel_vek_15_64: 4000,
    },
  ]);
  assert.strictEqual(series.length, 2);
  assert.strictEqual(series[0].registeredSeekers, 165);
  assert.ok(Math.abs(series[0].unemploymentRatePct - 5) < 1e-9);
  assert.strictEqual(series[1].period, "červen 2026");
  ok("pno_aggregate");
}

{
  const csv =
    "\uFEFFrozhodne_datum;volna_mista_rozhodne_datum\n2026-06-30;10\n2026-06-30;5.5\n2026-05-31;3\n";
  const v = aggregateNationalVacanciesCsv(csv);
  assert.strictEqual(v.length, 2);
  assert.strictEqual(v[1].vacancies, 16);
  assert.strictEqual(v[1].period, "červen 2026");
  ok("vpm_csv_aggregate");
}

// --- catalog wiring ---
{
  const labor = IU_INFO_PANEL_CATALOG.filter((c) =>
    ["unemployment", "job_vacancies", "registered_unemployment"].includes(c.id)
  );
  assert.strictEqual(labor.length, 3);
  for (const item of labor) {
    assert.strictEqual(item.fetchBucket, "mpsv_labor");
    assert.strictEqual(item.publishFrequency, "monthly");
    assert.ok(String(item.sourceUrl || "").includes("data.mpsv.cz"), item.id);
    assert.ok(!String(item.sourceUrl || "").includes("WREG01CT4"), item.id);
  }
  ok("catalog_mpsv_labor");
}

if (process.env.IU_MPSV_LIVE === "1") {
  const { fetchMpsvNationalLaborSeries } = await import("./mpsv_labor_open_data.mjs");
  const live = await fetchMpsvNationalLaborSeries();
  const year = Number(String(live.latest.unemployment.periodIso || "").slice(0, 4));
  assert.ok(year >= 2025, "expected period year >= 2025, got " + live.latest.unemployment.period);
  assert.ok(live.latest.unemployment.value > 0 && live.latest.unemployment.value < 20);
  assert.ok(live.latest.registered_unemployment.value > 100000);
  assert.ok(live.latest.job_vacancies.value > 1000);
  console.log(
    "PASS live_mpsv",
    live.latest.unemployment.period,
    live.latest.unemployment.value,
    live.latest.registered_unemployment.value,
    live.latest.job_vacancies.value
  );
}

console.log("iu_info_panel_change_mpsv_guard_ok");
