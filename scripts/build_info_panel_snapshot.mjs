#!/usr/bin/env node
/**
 * Build same-origin snapshot for PC info panel.
 * Sources: ČNB (EUR/USD), CoinGecko (BTC, PAX Gold), ČSÚ DataStat (fuel, CPI, COICOP).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "projects", "data", "info_panel_snapshot.json");

const CNB_URL =
  "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt";
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,pax-gold&vs_currencies=czk&include_24hr_change=true";
const CSU_BASE = "https://data.csu.gov.cz/api/dotaz/v1/data/vybery";
const CSU_FUEL = `${CSU_BASE}/CENPHMTT01?format=CSV`;
const CSU_COICOP = `${CSU_BASE}/CEN0101ET03?format=CSV`;
const CSU_INFLATION = `${CSU_BASE}/WCEN01MT01?format=CSV`;

function parseCnbRates(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("cnb_empty");
  const headerDate = lines[0].split("#")[0].trim();
  const out = { date: headerDate, EUR: null, USD: null };
  for (let i = 2; i < lines.length; i++) {
    const parts = lines[i].split("|");
    if (parts.length < 5) continue;
    const code = String(parts[3] || "").trim();
    const raw = String(parts[4] || "").trim().replace(",", ".");
    const val = parseFloat(raw);
    if (!Number.isFinite(val)) continue;
    if (code === "EUR") out.EUR = val;
    if (code === "USD") out.USD = val;
  }
  if (!out.EUR || !out.USD) throw new Error("cnb_missing_codes");
  return out;
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
  const s = String(period || "");
  const w = s.match(/(\d{4})[-\s]?W(\d{1,2})/i);
  if (w) return parseInt(w[1], 10) * 100 + parseInt(w[2], 10);
  const m = s.match(/(\d{4})[-\s]?M(\d{1,2})/i);
  if (m) return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  const y = s.match(/(\d{4})/);
  if (y) return parseInt(y[1], 10) * 100;
  return 0;
}

function findLatestCsuRows(records, labelMatch) {
  const header = records[0] || [];
  const labelIdx = header.findIndex((h) => /text|n[aá]zev|label|položka|polozka/i.test(h));
  const periodIdx = header.findIndex((h) => /cas|obdob|period|time/i.test(h));
  const valueIdx = header.findIndex((h) => /hodnot|value|údaj|udaj/i.test(h));
  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    const label = (labelIdx >= 0 ? row[labelIdx] : row.slice(0, 3).join(" ")) || "";
    if (!labelMatch(label)) continue;
    const period = periodIdx >= 0 ? row[periodIdx] : row[0];
    const value = parseNumber(valueIdx >= 0 ? row[valueIdx] : row[row.length - 1]);
    if (value == null) continue;
    rows.push({ period, value, label: String(label).trim() });
  }
  rows.sort((a, b) => periodSortKey(b.period) - periodSortKey(a.period));
  return rows;
}

function trendFromDelta(delta, pct) {
  if (delta == null && pct == null) return { direction: "flat", text: "beze změny" };
  const d = typeof delta === "number" ? delta : typeof pct === "number" ? pct : 0;
  if (Math.abs(d) < 0.0001) return { direction: "flat", text: "beze změny" };
  const sign = d > 0 ? "▲" : "▼";
  const abs = Math.abs(d);
  if (typeof pct === "number" && typeof delta !== "number") {
    return { direction: d > 0 ? "up" : "down", text: `${sign} ${abs.toFixed(2)} %` };
  }
  return { direction: d > 0 ? "up" : "down", text: `${sign} ${abs.toFixed(2)}` };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { Accept: "text/plain, text/csv, */*", "Accept-Language": "cs" },
  });
  if (!res.ok) throw new Error("http_" + res.status);
  return res.text();
}

async function fetchCnb() {
  return parseCnbRates(await fetchText(CNB_URL));
}

async function fetchCoinGecko() {
  const res = await fetch(COINGECKO_URL, {
    headers: { Accept: "application/json", "User-Agent": "InfoUzelInfoPanel/1.0" },
  });
  if (!res.ok) throw new Error("coingecko_http_" + res.status);
  const json = await res.json();
  const btc = json && json.bitcoin;
  const gold = json && json["pax-gold"];
  if (!btc || typeof btc.czk !== "number") throw new Error("coingecko_btc_missing");
  if (!gold || typeof gold.czk !== "number") throw new Error("coingecko_gold_missing");
  return {
    btc: {
      czk: btc.czk,
      change24hPct: typeof btc.czk_24h_change === "number" ? btc.czk_24h_change : null,
    },
    gold: {
      czk: gold.czk,
      change24hPct: typeof gold.czk_24h_change === "number" ? gold.czk_24h_change : null,
    },
  };
}

async function fetchCsuFuel() {
  const records = parseCsvRecords(await fetchText(CSU_FUEL));
  const petrol = findLatestCsuRows(records, (l) => /natural\s*95|natural95/i.test(l));
  const diesel = findLatestCsuRows(records, (l) => /motorov[aá]\s*nafta|nafta/i.test(l) && !/natural/i.test(l));
  if (!petrol.length) throw new Error("csu_fuel_petrol_missing");
  if (!diesel.length) throw new Error("csu_fuel_diesel_missing");
  return { petrol: petrol[0], diesel: diesel[0], petrolPrev: petrol[1] || null, dieselPrev: diesel[1] || null };
}

async function fetchCsuCoicop() {
  const records = parseCsvRecords(await fetchText(CSU_COICOP));
  const energy = findLatestCsuRows(records, (l) => /bydlen[ií].*energ|energie.*paliv|^\s*04\s/i.test(l));
  const transport = findLatestCsuRows(records, (l) => /^doprava\s*$/i.test(l.trim()) || /^\s*07\s*doprava/i.test(l));
  const rail = findLatestCsuRows(records, (l) => /železni|zelezn/i.test(l));
  const air = findLatestCsuRows(records, (l) => /leteck/i.test(l));
  if (!energy.length) throw new Error("csu_coicop_energy_missing");
  return {
    energy: energy[0],
    energyPrev: energy[1] || null,
    transport: transport[0] || null,
    transportPrev: transport[1] || null,
    rail: rail[0] || null,
    railPrev: rail[1] || null,
    air: air[0] || null,
    airPrev: air[1] || null,
  };
}

async function fetchCsuInflation() {
  const records = parseCsvRecords(await fetchText(CSU_INFLATION));
  const rows = findLatestCsuRows(records, (l) => /m[ií]ra\s*inflace/i.test(l));
  if (!rows.length) throw new Error("csu_inflation_missing");
  return { current: rows[0], prev: rows[1] || null };
}

function readPrevious() {
  try {
    if (!fs.existsSync(OUT)) return null;
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch (_) {
    return null;
  }
}

function coicopTrend(current, prev) {
  if (!current || !prev) return trendFromDelta(null, null);
  const delta = current.value - prev.value;
  return trendFromDelta(delta);
}

async function main() {
  const prev = readPrevious();
  const generatedAt = new Date().toISOString();
  const snapshot = { version: 2, generatedAt, items: {}, errors: [] };

  try {
    const cnb = await fetchCnb();
    const prevEur = prev && prev.items && prev.items.eur_czk ? prev.items.eur_czk.value : null;
    const prevUsd = prev && prev.items && prev.items.usd_czk ? prev.items.usd_czk.value : null;
    const eurDelta = prevEur != null ? cnb.EUR - prevEur : null;
    const usdDelta = prevUsd != null ? cnb.USD - prevUsd : null;
    const eurTrend = trendFromDelta(eurDelta);
    const usdTrend = trendFromDelta(usdDelta);
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
  } catch (err) {
    snapshot.errors.push({ id: "cnb", message: String(err && err.message ? err.message : err) });
  }

  try {
    const cg = await fetchCoinGecko();
    snapshot.items.bitcoin = {
      value: Math.round(cg.btc.czk),
      unit: "Kč",
      primaryLabel: "",
      secondaryValue: trendFromDelta(null, cg.btc.change24hPct).text,
      trendDirection: trendFromDelta(null, cg.btc.change24hPct).direction,
      updatedAt: generatedAt,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
    snapshot.items.gold = {
      value: Math.round(cg.gold.czk),
      unit: "Kč",
      primaryLabel: "PAX Gold",
      secondaryValue: trendFromDelta(null, cg.gold.change24hPct).text,
      trendDirection: trendFromDelta(null, cg.gold.change24hPct).direction,
      updatedAt: generatedAt,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg.includes("btc")) snapshot.errors.push({ id: "bitcoin", message: msg });
    else if (msg.includes("gold")) snapshot.errors.push({ id: "gold", message: msg });
    else snapshot.errors.push({ id: "coingecko", message: msg });
  }

  try {
    const fuel = await fetchCsuFuel();
    const petrolDelta = fuel.petrolPrev ? fuel.petrol.value - fuel.petrolPrev.value : null;
    const dieselDelta = fuel.dieselPrev ? fuel.diesel.value - fuel.dieselPrev.value : null;
    snapshot.items.fuel = {
      value: fuel.petrol.value,
      unit: "Kč/l",
      primaryLabel: "Natural 95",
      secondaryValue: trendFromDelta(petrolDelta).text,
      trendDirection: trendFromDelta(petrolDelta).direction,
      updatedAt: fuel.petrol.period,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
    snapshot.items.transport = {
      value: fuel.diesel.value,
      unit: "Kč/l",
      primaryLabel: "Motorová nafta",
      secondaryValue: trendFromDelta(dieselDelta).text,
      trendDirection: trendFromDelta(dieselDelta).direction,
      updatedAt: fuel.diesel.period,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
  } catch (err) {
    snapshot.errors.push({ id: "csu_fuel", message: String(err && err.message ? err.message : err) });
  }

  try {
    const coicop = await fetchCsuCoicop();
    const energyTrend = coicopTrend(coicop.energy, coicop.energyPrev);
    snapshot.items.electricity = {
      value: coicop.energy.value,
      unit: "index",
      primaryLabel: "Energie a paliva",
      secondaryValue: energyTrend.text,
      trendDirection: energyTrend.direction,
      updatedAt: coicop.energy.period,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };

    const railRow = coicop.rail || coicop.transport;
    const railPrev = coicop.rail ? coicop.railPrev : coicop.transportPrev;
    if (railRow) {
      const railTrend = coicopTrend(railRow, railPrev);
      snapshot.items.trains = {
        value: railRow.value,
        unit: "index",
        primaryLabel: coicop.rail ? "Železniční doprava" : "Doprava",
        secondaryValue: railTrend.text,
        trendDirection: railTrend.direction,
        updatedAt: railRow.period,
        isLive: true,
        legalStatus: "verified_requires_attribution",
      };
    }

    const airRow = coicop.air || coicop.transport;
    const airPrev = coicop.air ? coicop.airPrev : coicop.transportPrev;
    if (airRow) {
      const airTrend = coicopTrend(airRow, airPrev);
      snapshot.items.aviation = {
        value: airRow.value,
        unit: "index",
        primaryLabel: coicop.air ? "Letecká doprava" : "Doprava",
        secondaryValue: airTrend.text,
        trendDirection: airTrend.direction,
        updatedAt: airRow.period,
        isLive: true,
        legalStatus: "verified_requires_attribution",
      };
    }
  } catch (err) {
    snapshot.errors.push({ id: "csu_coicop", message: String(err && err.message ? err.message : err) });
  }

  try {
    const infl = await fetchCsuInflation();
    const inflDelta = infl.prev ? infl.current.value - infl.prev.value : null;
    if (!snapshot.items.aviation) {
      snapshot.items.aviation = {
        value: infl.current.value,
        unit: "%",
        primaryLabel: "Míra inflace",
        secondaryValue: trendFromDelta(inflDelta).text,
        trendDirection: trendFromDelta(inflDelta).direction,
        updatedAt: infl.current.period,
        isLive: true,
        legalStatus: "verified_requires_attribution",
      };
    }
    if (!snapshot.items.trains && snapshot.items.electricity) {
      snapshot.items.trains = {
        value: infl.current.value,
        unit: "%",
        primaryLabel: "Míra inflace",
        secondaryValue: trendFromDelta(inflDelta).text,
        trendDirection: trendFromDelta(inflDelta).direction,
        updatedAt: infl.current.period,
        isLive: true,
        legalStatus: "verified_requires_attribution",
      };
    }
  } catch (err) {
    snapshot.errors.push({ id: "csu_inflation", message: String(err && err.message ? err.message : err) });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, OUT);
  console.log("info_panel_snapshot_ok", OUT, Object.keys(snapshot.items).length, snapshot.errors.length);
}

main().catch((err) => {
  console.error("info_panel_snapshot_fail", err);
  process.exit(1);
});
