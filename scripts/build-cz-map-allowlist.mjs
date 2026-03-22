#!/usr/bin/env node
/**
 * Builds projects/data/cz_map_display_cities.json — ids for map-only layer (krajská + okresní sídla).
 * Repro: node scripts/build-cz-map-allowlist.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CZ_KRAJSKE_SIDLA, CZ_OKRESNI_MESTA } from "./cz_map_official_city_names.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** GeoNames English names in our dataset ↔ Czech official names */
const NAME_ALIASES = [
  ["Prague", "Praha"],
  ["Pilsen", "Plzeň"],
];

function normKeysForOfficial(czechName) {
  const o = [norm(czechName)];
  for (const [en, cz] of NAME_ALIASES) {
    if (cz === czechName) o.push(norm(en));
  }
  return [...new Set(o)];
}

const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, "projects/data/cz_localities_picker.json"), "utf8"));
const items = Array.isArray(DATA.items) ? DATA.items : [];

const wanted = [...new Set([...CZ_KRAJSKE_SIDLA, ...CZ_OKRESNI_MESTA])];
const picked = [];
const seenNorm = new Set();

for (const official of wanted) {
  const keys = normKeysForOfficial(official);
  let best = null;
  for (const it of items) {
    const nn = norm(it.n);
    if (!keys.includes(nn)) continue;
    if (official === "Praha" && it.n !== "Prague") continue;
    if (!best || (it.p || 0) > (best.p || 0)) best = it;
  }
  if (best) {
    const kn = norm(best.n);
    if (seenNorm.has(kn)) continue;
    seenNorm.add(kn);
    picked.push({ n: best.n, lat: best.lat, lon: best.lon, p: best.p });
  }
}

picked.sort((a, b) => String(a.n).localeCompare(String(b.n), "cs"));

const out = {
  version: 1,
  source:
    "Derived from public Czech administrative seats + cz_localities_picker.json (GeoNames CC BY 4.0). Map display only.",
  itemCount: picked.length,
  items: picked,
};

const OUT = path.join(ROOT, "projects/data/cz_map_display_cities.json");
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("OK", OUT, "items", picked.length);
