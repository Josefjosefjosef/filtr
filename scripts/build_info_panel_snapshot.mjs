#!/usr/bin/env node
/**
 * Build same-origin snapshot for PC info panel V4.
 * Sources: ČNB, CoinGecko, ČSÚ DataStat (vybery CSV), MPSV open data (labour).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { IU_INFO_PANEL_CATALOG } from "../assets/iu-desktop-info-panel-catalog.js";
import { CNB_DAILY_RATES_URL, parseCnbRatesText } from "../assets/iu-cnb-exchange-utils.js";
import {
  trendFromComparablePair,
  trendFromPercentPoint,
} from "../assets/iu-info-panel-change-utils.js";
import {
  bucketContentHash,
  bucketsDueForCheck,
  getAllFetchBuckets,
  readSchedulerState,
  touchBucketCheck,
  writeSchedulerState,
} from "./info_panel_scheduler.mjs";
import { fetchMpsvNationalLaborSeries } from "./mpsv_labor_open_data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "projects", "data", "info_panel_snapshot.json");

const CNB_URL = CNB_DAILY_RATES_URL;
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,pax-gold&vs_currencies=czk&include_24hr_change=true";
const CSU_BASE = "https://data.csu.gov.cz/api/dotaz/v1/data/vybery";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseCnbRates(text) {
  return parseCnbRatesText(text);
}

function parseCsvRecords(text) {
  const rows = [];
  let cur = "";
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() && !cur) continue;
    cur += (cur ? "\n" : "") + line;
    const q = (cur.match(/"/g) || []).length;
    if (q % 2 === 0) {
      rows.push(cur);
      cur = "";
    }
  }
  if (cur.trim()) rows.push(cur);
  if (!rows.length) return [];

  const delim = rows[0].includes(";") && !rows[0].includes('","') ? ";" : ",";
  return rows.map((row) => {
    const cells = [];
    let cell = "";
    let inQ = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (!inQ && ch === delim) {
        cells.push(cell.trim());
        cell = "";
        continue;
      }
      cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  });
}

function parseNumber(raw) {
  const s = String(raw || "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function periodSortKey(period) {
  const s = String(period || "").trim();
  const czWeek = s.match(/(\d{1,2})\.\s*t[yý]den\s*(\d{4})/i);
  if (czWeek) return parseInt(czWeek[2], 10) * 100 + parseInt(czWeek[1], 10);
  const months = {
    leden: 1,
    unor: 2,
    únor: 2,
    brezen: 3,
    březen: 3,
    duben: 4,
    kveten: 5,
    květen: 5,
    cerven: 6,
    červen: 6,
    cervenec: 7,
    červenec: 7,
    srpen: 8,
    zari: 9,
    září: 9,
    rijen: 10,
    říjen: 10,
    listopad: 11,
    prosinec: 12,
  };
  const czMonth = s.match(/^([a-záčďéěíňóřšťúůýž]+)\s+(\d{4})$/i);
  if (czMonth) {
    const m = months[normalizeText(czMonth[1])] || 0;
    if (m) return parseInt(czMonth[2], 10) * 100 + m;
  }
  const schoolYear = s.match(/^(\d{4})\/(\d{4})$/);
  if (schoolYear) return parseInt(schoolYear[1], 10) * 100 + 99;
  const czQuarter = s.match(/(\d)\.\s*ctvrtlet[ií]\s*(\d{4})/i);
  if (czQuarter) return parseInt(czQuarter[2], 10) * 100 + parseInt(czQuarter[1], 10);
  const w = s.match(/(\d{4})[-\s]?W(\d{1,2})/i);
  if (w) return parseInt(w[1], 10) * 100 + parseInt(w[2], 10);
  const m = s.match(/(\d{4})[-\s]?M(\d{1,2})/i);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  const date = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (date) return parseInt(date[3], 10) * 10000 + parseInt(date[2], 10) * 100 + parseInt(date[1], 10);
  const y = s.match(/(\d{4})/);
  if (y) return parseInt(y[1], 10) * 100;
  return 0;
}

function headerIndex(header, patterns) {
  for (let i = 0; i < header.length; i++) {
    const h = normalizeText(header[i]);
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

function isCzechTotal(row, header) {
  const joined = normalizeText(row.join(" "));
  if (/cesko/.test(joined) && !row.some((cell, idx) => idx > 0 && cell && header[idx] && /kraj|okres|nuts/i.test(header[idx]))) {
    return true;
  }
  const stateIdx = headerIndex(header, [/st[aá]t$/, /^uzem[ií]-st[aá]t$/, /cr a kraje-stat/]);
  const regionIdx = headerIndex(header, [/kraj$/, /^uzem[ií]-kraj$/, /cr a kraje-kraj/]);
  if (stateIdx >= 0 && /cesko/.test(normalizeText(row[stateIdx]))) {
    if (regionIdx < 0 || !String(row[regionIdx] || "").trim()) return true;
  }
  const territoryIdx = headerIndex(header, [/^uzem[ií]$/, /^kraje$/]);
  if (territoryIdx >= 0 && /cesko/.test(normalizeText(row[territoryIdx]))) return true;
  return false;
}

function findLatestCsuRows(records, rowMatch) {
  const header = records[0] || [];
  const periodIdx = headerIndex(header, [/t[yý]d/, /m[eě]s/, /ctvrtlet/, /obdob/, /skolni roky/, /^roky$/, /^rok s[cč]it[aá]n[ií]$/]);
  const valueIdx = headerIndex(header, [/hodnot/, /value/, /udaj/]);
  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    if (!rowMatch(row, header, { periodIdx, valueIdx })) continue;
    const period = periodIdx >= 0 ? row[periodIdx] : row[0];
    const value = parseNumber(valueIdx >= 0 ? row[valueIdx] : row[row.length - 1]);
    if (value == null) continue;
    rows.push({ period, value, row });
  }
  rows.sort((a, b) => periodSortKey(b.period) - periodSortKey(a.period));
  return rows;
}

function putItem(snapshot, id, row, options = {}) {
  const prev = options.prev || null;
  const unit = options.unit || "";
  const trend =
    options.trend ||
    trendFromComparablePair(row, prev, {
      unit,
      indicatorId: id,
      kind: options.changeKind,
    });
  snapshot.items[id] = {
    value: options.round ? Math.round(row.value) : row.value,
    unit,
    primaryLabel: options.primaryLabel || "",
    secondaryValue: trend.text,
    trendDirection: trend.direction,
    updatedAt: row.period,
    isLive: true,
    legalStatus: options.legalStatus || "verified_requires_attribution",
    sourceName: options.sourceName || undefined,
    referencePeriod: row.period || undefined,
  };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { Accept: "text/plain, text/csv, */*", "Accept-Language": "cs" },
  });
  if (!res.ok) throw new Error("http_" + res.status);
  return res.text();
}

async function fetchCsuCsv(code) {
  return parseCsvRecords(await fetchText(`${CSU_BASE}/${code}?format=CSV`));
}

function pushError(snapshot, id, err) {
  snapshot.errors.push({
    id,
    message: String(err && err.message ? err.message : err),
  });
}

async function fetchCnb(snapshot, prev) {
  const startedAt = new Date().toISOString();
  try {
    const rawText = await fetchText(CNB_URL);
    const cnb = parseCnbRates(rawText);
    console.log(
      "cnb_fetch_ok",
      JSON.stringify({
        startedAt,
        source: CNB_URL,
        listDate: cnb.date,
        listNumber: cnb.listNumber,
        eur: cnb.EUR,
        usd: cnb.USD,
      })
    );
    const prevEurRow =
      prev && prev.items && prev.items.eur_czk && typeof prev.items.eur_czk.value === "number"
        ? { value: prev.items.eur_czk.value }
        : null;
    const prevUsdRow =
      prev && prev.items && prev.items.usd_czk && typeof prev.items.usd_czk.value === "number"
        ? { value: prev.items.usd_czk.value }
        : null;
    const eurTrend = trendFromComparablePair({ value: cnb.EUR }, prevEurRow, {
      unit: "Kč",
      indicatorId: "eur_czk",
    });
    const usdTrend = trendFromComparablePair({ value: cnb.USD }, prevUsdRow, {
      unit: "Kč",
      indicatorId: "usd_czk",
    });
    snapshot.items.eur_czk = {
      value: cnb.EUR,
      unit: "Kč",
      primaryLabel: "",
      secondaryValue: eurTrend.text,
      trendDirection: eurTrend.direction,
      updatedAt: cnb.date,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
    snapshot.items.usd_czk = {
      value: cnb.USD,
      unit: "Kč",
      primaryLabel: "",
      secondaryValue: usdTrend.text,
      trendDirection: usdTrend.direction,
      updatedAt: cnb.date,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
    snapshot.errors = snapshot.errors.filter((err) => err && err.id !== "cnb");
  } catch (err) {
    console.error(
      "cnb_fetch_fail",
      JSON.stringify({
        startedAt,
        source: CNB_URL,
        message: String(err && err.message ? err.message : err),
        keptPrevious:
          !!(prev && prev.items && prev.items.eur_czk && prev.items.usd_czk),
      })
    );
    pushError(snapshot, "cnb", err);
  }
}

async function fetchCoinGecko(snapshot) {
  try {
    const res = await fetch(COINGECKO_URL, {
      headers: { Accept: "application/json", "User-Agent": "InfoUzelInfoPanel/1.0" },
    });
    if (!res.ok) throw new Error("coingecko_http_" + res.status);
    const json = await res.json();
    const btc = json && json.bitcoin;
    const gold = json && json["pax-gold"];
    if (!btc || typeof btc.czk !== "number") throw new Error("coingecko_btc_missing");
    if (!gold || typeof gold.czk !== "number") throw new Error("coingecko_gold_missing");
    const btcTrend = trendFromPercentPoint(btc.czk_24h_change);
    const goldTrend = trendFromPercentPoint(gold.czk_24h_change);
    snapshot.items.bitcoin = {
      value: Math.round(btc.czk),
      unit: "Kč",
      primaryLabel: "",
      secondaryValue: btcTrend.text,
      trendDirection: btcTrend.direction,
      updatedAt: snapshot.generatedAt,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
    snapshot.items.gold = {
      value: Math.round(gold.czk),
      unit: "Kč",
      primaryLabel: "PAX Gold",
      secondaryValue: goldTrend.text,
      trendDirection: goldTrend.direction,
      updatedAt: snapshot.generatedAt,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg.includes("btc")) pushError(snapshot, "bitcoin", err);
    else if (msg.includes("gold")) pushError(snapshot, "gold", err);
    else pushError(snapshot, "coingecko", err);
  }
}

async function fetchCsuFuel(snapshot) {
  try {
    const records = await fetchCsuCsv("CENPHMTT01");
    const fuelIdx = headerIndex(records[0], [/druh phm/, /phm/]);
    const petrolRows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      const indicator = normalizeText(row[0]);
      const fuelType = normalizeText(row[fuelIdx >= 0 ? fuelIdx : 3]);
      return /prumerna cena/.test(indicator) && /natural\s*95/.test(fuelType);
    });
    const dieselRows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      const indicator = normalizeText(row[0]);
      const fuelType = normalizeText(row[fuelIdx >= 0 ? fuelIdx : 3]);
      return /prumerna cena/.test(indicator) && /motorova nafta/.test(fuelType);
    });
    if (!petrolRows.length) throw new Error("csu_fuel_petrol_missing");
    if (!dieselRows.length) throw new Error("csu_fuel_diesel_missing");
    putItem(snapshot, "fuel", petrolRows[0], { unit: "Kč/l", primaryLabel: "Natural 95", prev: petrolRows[1] });
    putItem(snapshot, "transport", dieselRows[0], { unit: "Kč/l", primaryLabel: "Motorová nafta", prev: dieselRows[1] });
  } catch (err) {
    pushError(snapshot, "csu_fuel", err);
  }
}

async function fetchCsuCoicop(snapshot) {
  try {
    const records = await fetchCsuCsv("CEN0101ET03");
    const oddIdx = headerIndex(records[0], [/coicop.*odd/i]);
    const energyRows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      const odd = normalizeText(oddIdx >= 0 ? row[oddIdx] : row[4]);
      return /bydleni.*energ|energ.*paliv/.test(odd);
    });
    if (!energyRows.length) throw new Error("csu_coicop_energy_missing");
    putItem(snapshot, "electricity", energyRows[0], {
      unit: "index",
      primaryLabel: "Energie a paliva",
      prev: energyRows[1],
    });
  } catch (err) {
    pushError(snapshot, "csu_coicop", err);
  }
}

async function fetchCsuInflation(snapshot) {
  try {
    const records = await fetchCsuCsv("CEN0101HT02");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /stejne obdobi predchoziho roku|ke stejnemu mesici predchoziho roku/.test(normalizeText(row[0]));
    });
    if (!rows.length) throw new Error("csu_inflation_missing");
    putItem(snapshot, "inflation", rows[0], { unit: "%", primaryLabel: "Meziročně", prev: rows[1] });
  } catch (err) {
    pushError(snapshot, "csu_inflation", err);
  }
}

async function fetchMpsvLabor(snapshot, prev) {
  try {
    const labor = await fetchMpsvNationalLaborSeries();
    const attribution = labor.source.attribution;
    const srcName = labor.source.provider;

    const prevVacRaw =
      prev && prev.items && prev.items.job_vacancies && typeof prev.items.job_vacancies.value === "number"
        ? prev.items.job_vacancies
        : null;
    const prevVacPeriod = prevVacRaw ? String(prevVacRaw.updatedAt || "") : "";
    const currVacPeriod = String(labor.latest.job_vacancies.period || "");
    const prevVacComparable =
      prevVacRaw &&
      prevVacPeriod &&
      currVacPeriod &&
      prevVacPeriod !== currVacPeriod &&
      // Nepoužívat archivní roční ČSÚ 2023 jako „předchozí měsíc“.
      !/^\d{4}$/.test(prevVacPeriod.trim()) &&
      periodSortKey(prevVacPeriod) > 0 &&
      Math.abs(periodSortKey(currVacPeriod) - periodSortKey(prevVacPeriod)) <= 2
        ? { value: prevVacRaw.value, period: prevVacPeriod }
        : null;

    putItem(snapshot, "unemployment", labor.latest.unemployment, {
      unit: "%",
      primaryLabel: "Podíl nezaměstnaných",
      prev: labor.previous.unemployment,
      changeKind: "percentage_points",
      sourceName: srcName,
      legalStatus: "verified_requires_attribution",
    });
    putItem(snapshot, "registered_unemployment", labor.latest.registered_unemployment, {
      unit: "",
      primaryLabel: "Uchazeči ÚP",
      prev: labor.previous.registered_unemployment,
      changeKind: "absolute",
      round: true,
      sourceName: srcName,
      legalStatus: "verified_requires_attribution",
    });
    putItem(snapshot, "job_vacancies", labor.latest.job_vacancies, {
      unit: "",
      primaryLabel: "Evidence ÚP",
      prev: labor.previous.job_vacancies || prevVacComparable,
      changeKind: "absolute",
      round: true,
      sourceName: srcName,
      legalStatus: "verified_requires_attribution",
    });

    snapshot.items.unemployment.attribution = attribution;
    snapshot.items.registered_unemployment.attribution = attribution;
    snapshot.items.job_vacancies.attribution = attribution;
    snapshot.errors = snapshot.errors.filter(
      (err) => err && err.id !== "mpsv_labor" && err.id !== "csu_labor_reg"
    );
    console.log(
      "mpsv_labor_ok",
      JSON.stringify({
        period: labor.latest.unemployment.period,
        pno: labor.latest.unemployment.value,
        seekers: labor.latest.registered_unemployment.value,
        vacancies: labor.latest.job_vacancies.value,
        vacPrevComparable: !!prevVacComparable,
      })
    );
  } catch (err) {
    pushError(snapshot, "mpsv_labor", err);
  }
}

async function fetchCsuWageQuarterly(snapshot) {
  try {
    const records = await fetchCsuCsv("WPRACECRQT3");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /prumerna hruba mesicni mzda/.test(normalizeText(row[0]));
    });
    if (!rows.length) throw new Error("csu_avg_wage_missing");
    putItem(snapshot, "avg_wage", rows[0], { unit: "Kč", primaryLabel: "Hrubá měsíční", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_wage_q", err);
  }
}

async function fetchCsuWageYearly(snapshot) {
  try {
    const records = await fetchCsuCsv("WREG0303");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /prumerna hruba mesicni mzda/.test(normalizeText(row[0]));
    });
    if (!rows.length) throw new Error("csu_avg_gross_wage_missing");
    putItem(snapshot, "avg_gross_wage", rows[0], { unit: "Kč", primaryLabel: "Roční průměr", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_wage_y", err);
  }
}

async function fetchCsuGdp(snapshot) {
  try {
    const records = await fetchCsuCsv("WNUC01T01");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /hruby domaci produkt.*mezictvrtletni/.test(normalizeText(row[0]));
    });
    if (!rows.length) throw new Error("csu_gdp_missing");
    putItem(snapshot, "gdp", rows[0], { unit: "%", primaryLabel: "Mezičtvrtletní růst", prev: rows[1] });
  } catch (err) {
    pushError(snapshot, "csu_gdp", err);
  }
}

async function fetchCsuIndustry(snapshot) {
  try {
    const records = await fetchCsuCsv("PRU01BT1");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      const joined = normalizeText(row.join(" "));
      return /index prumyslove produkce/.test(joined) && /prumysl celkem/.test(joined) && /mezirocni index/.test(joined);
    });
    if (!rows.length) throw new Error("csu_industry_missing");
    putItem(snapshot, "industry", rows[0], { unit: "index", primaryLabel: "Meziroční index", prev: rows[1] });
  } catch (err) {
    pushError(snapshot, "csu_industry", err);
  }
}

async function fetchCsuConstruction(snapshot) {
  try {
    const records = await fetchCsuCsv("STA04BT1");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      const joined = normalizeText(row.join(" "));
      return /index stavebni produkce/.test(joined) && /mezirocni index/.test(joined) && /ocisteno o kalendar/.test(joined);
    });
    if (!rows.length) throw new Error("csu_construction_missing");
    putItem(snapshot, "construction", rows[0], { unit: "index", primaryLabel: "Meziroční index", prev: rows[1] });
  } catch (err) {
    pushError(snapshot, "csu_construction", err);
  }
}

async function fetchCsuRetail(snapshot) {
  try {
    const records = await fetchCsuCsv("OBC01BT1");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      const joined = normalizeText(row.join(" "));
      return /maloobchod/.test(joined) && /mezirocni index/.test(joined) && /ocisteno o kalendar/.test(joined);
    });
    if (!rows.length) throw new Error("csu_retail_missing");
    putItem(snapshot, "retail", rows[0], { unit: "index", primaryLabel: "Meziroční tržby", prev: rows[1] });
  } catch (err) {
    pushError(snapshot, "csu_retail", err);
  }
}

async function fetchCsuAgriculture(snapshot) {
  try {
    const records = await fetchCsuCsv("CEN02031T03");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      const joined = normalizeText(row.join(" "));
      return /index cen zemedelskych vyrobcu/.test(joined) && /zemedelska vyroba/.test(joined) && /mezirocni index/.test(joined);
    });
    if (!rows.length) throw new Error("csu_agriculture_missing");
    putItem(snapshot, "agriculture", rows[0], { unit: "index", primaryLabel: "Ceny výrobců", prev: rows[1] });
  } catch (err) {
    pushError(snapshot, "csu_agriculture", err);
  }
}

async function fetchCsuEmployment(snapshot) {
  try {
    const records = await fetchCsuCsv("WVSPSAT1");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      const joined = normalizeText(row.join(" "));
      return /zamestnani \(tis\. osob\)/.test(joined) && /celkem/.test(joined);
    });
    if (!rows.length) throw new Error("csu_employment_missing");
    putItem(snapshot, "employment", rows[0], { unit: "tis.", primaryLabel: "VŠPS celkem", prev: rows[1] });
  } catch (err) {
    pushError(snapshot, "csu_employment", err);
  }
}

async function fetchCsuPopulation(snapshot) {
  try {
    const records = await fetchCsuCsv("WOBYNEJ");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /pocet obyvatel/.test(normalizeText(row[0]));
    });
    if (!rows.length) throw new Error("csu_population_missing");
    putItem(snapshot, "population", rows[0], { unit: "", primaryLabel: "Počet obyvatel", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_population", err);
  }
}

async function fetchCsuBirths(snapshot) {
  try {
    const records = await fetchCsuCsv("WOBY03");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return normalizeText(row[0]) === "celkem";
    });
    if (!rows.length) throw new Error("csu_births_missing");
    putItem(snapshot, "births", rows[0], { unit: "", primaryLabel: "Živě narození", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_births", err);
  }
}

async function fetchCsuDeaths(snapshot) {
  try {
    const records = await fetchCsuCsv("WOBY04A");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return normalizeText(row[0]) === "celkem" && normalizeText(row[headerIndex(header, [/pohlavi/i])] || 3) === "celkem";
    });
    if (!rows.length) throw new Error("csu_deaths_missing");
    putItem(snapshot, "deaths", rows[0], { unit: "", primaryLabel: "Celkem", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_deaths", err);
  }
}

async function fetchCsuMarriages(snapshot) {
  try {
    const records = await fetchCsuCsv("WOBY05A");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /snatky/.test(normalizeText(row[0]));
    });
    if (!rows.length) throw new Error("csu_marriages_missing");
    putItem(snapshot, "marriages", rows[0], { unit: "", primaryLabel: "Počet sňatků", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_marriages", err);
  }
}

async function fetchCsuDivorces(snapshot) {
  try {
    const records = await fetchCsuCsv("WOBY05B");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /rozvody/.test(normalizeText(row[0]));
    });
    if (!rows.length) throw new Error("csu_divorces_missing");
    putItem(snapshot, "divorces", rows[0], { unit: "", primaryLabel: "Počet rozvodů", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_divorces", err);
  }
}

async function fetchCsuForeigners(snapshot) {
  try {
    const records = await fetchCsuCsv("CIZ003T003");
    const rows = findLatestCsuRows(records, (row) => {
      const joined = normalizeText(row.join(" "));
      return /pocet cizincu v cr/.test(joined) && /cizinci celkem/.test(joined) && /cesko/.test(joined);
    });
    if (!rows.length) throw new Error("csu_foreigners_missing");
    putItem(snapshot, "foreigners", rows[0], { unit: "", primaryLabel: "Počet cizinců", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_foreigners", err);
  }
}

async function fetchCsuSeniors(snapshot) {
  try {
    const records = await fetchCsuCsv("WOBY02M2");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /podil obyvatel ve veku 65/.test(normalizeText(row[0]));
    });
    if (!rows.length) throw new Error("csu_seniors_missing");
    putItem(snapshot, "seniors", rows[0], { unit: "%", primaryLabel: "Podíl 65+", prev: rows[1] });
  } catch (err) {
    pushError(snapshot, "csu_seniors", err);
  }
}

async function fetchCsuMigration(snapshot) {
  try {
    const records = await fetchCsuCsv("OBY06T01");
    const rows = findLatestCsuRows(records, (row) => {
      const joined = normalizeText(row.join(" "));
      return joined.startsWith("pristehoval") && /celkem/.test(joined) && /cesko/.test(joined);
    });
    if (!rows.length) throw new Error("csu_migration_missing");
    putItem(snapshot, "migration", rows[0], { unit: "", primaryLabel: "Přistěhovalí", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_migration", err);
  }
}

async function fetchCsuEducation(snapshot) {
  try {
    const records = await fetchCsuCsv("VZD07T02");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      const joined = normalizeText(row.join(" "));
      return /zaci/.test(joined) && /stredni skola/.test(joined) && /celkem/.test(joined);
    });
    if (!rows.length) throw new Error("csu_education_missing");
    putItem(snapshot, "education", rows[0], { unit: "žáků", primaryLabel: "Střední školy", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_education", err);
  }
}

async function fetchCsuHealth(snapshot) {
  try {
    const records = await fetchCsuCsv("WFIN02A");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /naklady na zdravotni sluzby/.test(normalizeText(row[0])) && /celkem/.test(normalizeText(row.join(" ")));
    });
    if (!rows.length) throw new Error("csu_health_missing");
    putItem(snapshot, "health", rows[0], { unit: "mil. Kč", primaryLabel: "Náklady ZP", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_health", err);
  }
}

async function fetchCsuCrime(snapshot) {
  try {
    const records = await fetchCsuCsv("KRI10T01");
    const rows = findLatestCsuRows(records, (row) => {
      const joined = normalizeText(row.join(" "));
      return /pocet registrovanych skutku/.test(joined) && /celkova kriminalita/.test(joined) && /cesko/.test(joined);
    });
    if (!rows.length) throw new Error("csu_crime_missing");
    putItem(snapshot, "crime", rows[0], { unit: "", primaryLabel: "Reg. skutky", prev: rows[1], round: true });
  } catch (err) {
    pushError(snapshot, "csu_crime", err);
  }
}

async function fetchCsuElections(snapshot) {
  try {
    const records = await fetchCsuCsv("VOLPST2");
    const rows = findLatestCsuRows(records, (row, header) => {
      if (!isCzechTotal(row, header)) return false;
      return /volebni ucast/.test(normalizeText(row[0]));
    });
    if (!rows.length) throw new Error("csu_elections_missing");
    putItem(snapshot, "elections", rows[0], { unit: "%", primaryLabel: "Účast PS", prev: rows[1] });
  } catch (err) {
    pushError(snapshot, "csu_elections", err);
  }
}

function readPrevious() {
  try {
    if (!fs.existsSync(OUT)) return null;
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch (_) {
    return null;
  }
}

const BUCKET_FETCHERS = {
  cnb: fetchCnb,
  coingecko: fetchCoinGecko,
  csu_fuel: fetchCsuFuel,
  csu_coicop: fetchCsuCoicop,
  csu_inflation: fetchCsuInflation,
  mpsv_labor: fetchMpsvLabor,
  csu_wage_q: fetchCsuWageQuarterly,
  csu_wage_y: fetchCsuWageYearly,
  csu_gdp: fetchCsuGdp,
  csu_industry: fetchCsuIndustry,
  csu_construction: fetchCsuConstruction,
  csu_retail: fetchCsuRetail,
  csu_agriculture: fetchCsuAgriculture,
  csu_employment: fetchCsuEmployment,
  csu_population: fetchCsuPopulation,
  csu_births: fetchCsuBirths,
  csu_deaths: fetchCsuDeaths,
  csu_marriages: fetchCsuMarriages,
  csu_divorces: fetchCsuDivorces,
  csu_foreigners: fetchCsuForeigners,
  csu_seniors: fetchCsuSeniors,
  csu_migration: fetchCsuMigration,
  csu_education: fetchCsuEducation,
  csu_health: fetchCsuHealth,
  csu_crime: fetchCsuCrime,
  csu_elections: fetchCsuElections,
};

function copyPrevErrorsExcept(snapshot, prev, skipBuckets) {
  if (!prev || !Array.isArray(prev.errors)) return;
  prev.errors.forEach((err) => {
    if (!err || !err.id) return;
    if (skipBuckets.has(err.id)) return;
    if (snapshot.errors.some((e) => e.id === err.id)) return;
    snapshot.errors.push({ ...err });
  });
}

function pruneSnapshotToCatalog(snapshot, schedulerState) {
  const catalogIds = new Set(IU_INFO_PANEL_CATALOG.map((item) => item.id));
  const activeBuckets = new Set(getAllFetchBuckets());

  Object.keys(snapshot.items || {}).forEach((id) => {
    if (!catalogIds.has(id)) delete snapshot.items[id];
  });

  if (Array.isArray(snapshot.errors)) {
    snapshot.errors = snapshot.errors.filter((err) => {
      if (!err || !err.id) return true;
      if (!catalogIds.has(err.id) && !activeBuckets.has(err.id)) return false;
      return true;
    });
  }

  if (snapshot.bucketFetchedAt) {
    Object.keys(snapshot.bucketFetchedAt).forEach((bucket) => {
      if (!activeBuckets.has(bucket)) delete snapshot.bucketFetchedAt[bucket];
    });
  }

  if (schedulerState.buckets) {
    Object.keys(schedulerState.buckets).forEach((bucket) => {
      if (!activeBuckets.has(bucket)) delete schedulerState.buckets[bucket];
    });
  }

  snapshot.catalogCount = IU_INFO_PANEL_CATALOG.length;
}

async function main() {
  const prev = readPrevious();
  const generatedAt = new Date().toISOString();
  const nowMs = Date.parse(generatedAt);
  const schedulerState = readSchedulerState();
  const dueBuckets = bucketsDueForCheck(nowMs, schedulerState);
  const fetchedBuckets = new Set();

  const snapshot = {
    version: 4,
    generatedAt,
    catalogCount: IU_INFO_PANEL_CATALOG.length,
    items: {},
    errors: [],
    scheduler: { checkedBuckets: dueBuckets, skippedBuckets: [] },
  };

  if (prev && prev.items) {
    Object.keys(prev.items).forEach((id) => {
      snapshot.items[id] = { ...prev.items[id] };
    });
  }
  if (prev && Array.isArray(prev.errors)) {
    snapshot.errors = prev.errors.map((e) => ({ ...e }));
  }

  for (const bucket of dueBuckets) {
    const fetcher = BUCKET_FETCHERS[bucket];
    if (!fetcher) continue;
    fetchedBuckets.add(bucket);
    touchBucketCheck(schedulerState, bucket, generatedAt, {});

    const bucketIds = IU_INFO_PANEL_CATALOG.filter((c) => c.fetchBucket === bucket).map((c) => c.id);
    const beforeItems = {};
    bucketIds.forEach((id) => {
      if (snapshot.items[id]) beforeItems[id] = { ...snapshot.items[id] };
    });
    const beforeErrorCount = snapshot.errors.length;
    const prevHash = schedulerState.buckets[bucket] && schedulerState.buckets[bucket].contentHash;

    await fetcher(snapshot, prev);
    const newHash = bucketContentHash(snapshot.items, bucket);

    if (prevHash && prevHash === newHash && prev) {
      bucketIds.forEach((id) => {
        if (beforeItems[id]) snapshot.items[id] = beforeItems[id];
        else delete snapshot.items[id];
      });
      snapshot.errors = snapshot.errors.filter((err, idx) => idx < beforeErrorCount);
      touchBucketCheck(schedulerState, bucket, generatedAt, {
        lastFetchedAt: (schedulerState.buckets[bucket] && schedulerState.buckets[bucket].lastFetchedAt) || generatedAt,
        contentHash: prevHash,
        fetchSkipped: true,
      });
      snapshot.scheduler.skippedBuckets.push(bucket);
    } else {
      touchBucketCheck(schedulerState, bucket, generatedAt, {
        lastFetchedAt: generatedAt,
        contentHash: newHash,
        fetchSkipped: false,
      });
    }
  }

  copyPrevErrorsExcept(snapshot, prev, fetchedBuckets);

  pruneSnapshotToCatalog(snapshot, schedulerState);

  snapshot.bucketFetchedAt = {};
  Object.keys(schedulerState.buckets || {}).forEach((bucket) => {
    const lastFetchedAt = schedulerState.buckets[bucket] && schedulerState.buckets[bucket].lastFetchedAt;
    if (lastFetchedAt) snapshot.bucketFetchedAt[bucket] = lastFetchedAt;
  });

  writeSchedulerState(schedulerState);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, OUT);
  console.log(
    "info_panel_snapshot_ok",
    OUT,
    Object.keys(snapshot.items).length,
    snapshot.errors.length,
    "due=" + dueBuckets.length,
    "skipped=" + snapshot.scheduler.skippedBuckets.length
  );
}

main().catch((err) => {
  console.error("info_panel_snapshot_fail", err);
  process.exit(1);
});
