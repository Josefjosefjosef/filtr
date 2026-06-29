#!/usr/bin/env node
/**
 * Build same-origin snapshot for PC info panel (CNB rates + CoinGecko BTC).
 * Server-side only — no browser API keys.
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
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=czk&include_24hr_change=true";

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

async function fetchCnb() {
  const res = await fetch(CNB_URL, { headers: { Accept: "text/plain" } });
  if (!res.ok) throw new Error("cnb_http_" + res.status);
  const text = await res.text();
  return parseCnbRates(text);
}

async function fetchBtc() {
  const res = await fetch(COINGECKO_URL, {
    headers: { Accept: "application/json", "User-Agent": "InfoUzelInfoPanel/1.0" },
  });
  if (!res.ok) throw new Error("coingecko_http_" + res.status);
  const json = await res.json();
  const row = json && json.bitcoin;
  if (!row || typeof row.czk !== "number") throw new Error("coingecko_missing");
  return {
    czk: row.czk,
    change24hPct: typeof row.czk_24h_change === "number" ? row.czk_24h_change : null,
  };
}

function readPrevious() {
  try {
    if (!fs.existsSync(OUT)) return null;
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch (_) {
    return null;
  }
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

async function main() {
  const prev = readPrevious();
  const generatedAt = new Date().toISOString();
  const snapshot = {
    version: 1,
    generatedAt,
    items: {},
    errors: [],
  };

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
      updatedAt: generatedAt,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
    snapshot.items.usd_czk = {
      value: cnb.USD,
      unit: "Kč",
      primaryLabel: "",
      secondaryValue: usdTrend.text,
      trendDirection: usdTrend.direction,
      updatedAt: generatedAt,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
  } catch (err) {
    snapshot.errors.push({ id: "cnb", message: String(err && err.message ? err.message : err) });
  }

  try {
    const btc = await fetchBtc();
    snapshot.items.bitcoin = {
      value: Math.round(btc.czk),
      unit: "Kč",
      primaryLabel: "",
      secondaryValue: trendFromDelta(null, btc.change24hPct).text,
      trendDirection: trendFromDelta(null, btc.change24hPct).direction,
      updatedAt: generatedAt,
      isLive: true,
      legalStatus: "verified_requires_attribution",
    };
  } catch (err) {
    snapshot.errors.push({ id: "bitcoin", message: String(err && err.message ? err.message : err) });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, OUT);
  console.log("info_panel_snapshot_ok", OUT, Object.keys(snapshot.items).length);
}

main().catch((err) => {
  console.error("info_panel_snapshot_fail", err);
  process.exit(1);
});
