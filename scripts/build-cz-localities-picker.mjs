#!/usr/bin/env node
/**
 * Reproducible build: GeoNames Czechia populated places -> projects/data/cz_localities_picker.json
 *
 * Source: https://download.geonames.org/export/dump/CZ.zip (CC BY 4.0)
 * Admin labels: admin1CodesASCII.txt (same license bundle)
 *
 * Run: node scripts/build-cz-localities-picker.mjs
 * Requires: network, tar (bsdtar) for unzip, Node 18+
 */
import fs from "fs";
import https from "https";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "projects/data/cz_localities_picker.json");
const MAX_ROWS = 14000;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          f.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
          return download(res.headers.location, dest).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          f.close();
          reject(new Error("HTTP " + res.statusCode + " " + url));
          return;
        }
        res.pipe(f);
        f.on("finish", () => f.close(() => resolve()));
      })
      .on("error", reject);
  });
}

function featureType(code, pop) {
  const c = String(code || "");
  if (c === "PPLC" || c === "PPLA" || pop >= 50000) return "city";
  if (c === "PPLA2" || c === "PPLA3" || c === "PPLA4" || pop >= 3500) return "town";
  if (pop >= 500) return "obec";
  return "vesnice";
}

function priorityFromPop(pop, code) {
  const p = Number(pop) || 0;
  if (code === "PPLC") return 100;
  let base = 5;
  if (p > 0) base = Math.min(99, Math.round(6 + Math.log10(p + 1) * 24));
  return base;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "czgn-"));
  const zipPath = path.join(tmp, "CZ.zip");
  const adminPath = path.join(tmp, "admin1CodesASCII.txt");

  await download("https://download.geonames.org/export/dump/CZ.zip", zipPath);
  await download("https://download.geonames.org/export/dump/admin1CodesASCII.txt", adminPath);

  execFileSync("tar", ["-xf", zipPath, "-C", tmp], { stdio: "inherit" });
  const czPath = path.join(tmp, "CZ.txt");

  const admin1 = new Map();
  const adminText = fs.readFileSync(adminPath, "utf8");
  for (const line of adminText.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const p = line.split("\t");
    if (p[0] && p[0].startsWith("CZ.")) admin1.set(p[0], String(p[1] || "").trim());
  }

  const rows = [];
  const czRaw = fs.readFileSync(czPath, "utf8");
  for (const line of czRaw.split(/\r?\n/)) {
    if (!line) continue;
    const f = line.split("\t");
    if (f.length < 15) continue;
    if (f[6] !== "P") continue;
    if (!/^PPL/.test(f[7] || "")) continue;
    const name = String(f[1] || "").trim();
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pop = parseInt(f[14], 10) || 0;
    const ac = String(f[10] || "").trim();
    const regKey = ac ? `CZ.${ac}` : "";
    const region = admin1.get(regKey) || "";
    const code = f[7];
    const pr = priorityFromPop(pop, code);
    const t = featureType(code, pop);
    rows.push({ n: name, r: region, lat, lon, p: pr, t, pop, code });
  }

  rows.sort((a, b) => b.pop - a.pop || a.n.localeCompare(b.n));
  const top = rows.slice(0, MAX_ROWS);
  const items = top.map((x) => ({
    n: x.n,
    r: x.r,
    lat: x.lat,
    lon: x.lon,
    p: x.p,
    t: x.t,
    fc: x.code,
  }));

  for (const it of items) {
    if (it.n === "Prague") it.a = ["Praha"];
    if (it.n === "Pilsen") it.a = ["Plzeň"];
  }

  const json = {
    version: 2,
    source:
      "GeoNames CZ dump (https://download.geonames.org/export/dump/CZ.zip), CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ — attribution required in-app for derivative datasets.",
    sourceDetail:
      "Built by scripts/build-cz-localities-picker.mjs: feature class P, feature codes PPL*; admin1 names from admin1CodesASCII.txt; sorted by population desc; capped at " +
      MAX_ROWS +
      " rows.",
    items,
  };

  fs.writeFileSync(OUT, JSON.stringify(json), "utf8");
  const st = fs.statSync(OUT);
  console.log("OK", OUT, "items", items.length, "bytes", st.size);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
