#!/usr/bin/env node
/**
 * Build compact ŘSD ULS Layer 5 SMV reference (offline, no per-card fetch).
 * Writes .cache/ndic-datex-v1/smv-uls-reference-v1.json (+ optional projects/data copy).
 * Fail-closed: never invents segments; on failure keeps previous valid file.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SMV_ULS_LAYER } from "./smv-uls-resolver.mjs";

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, ".cache", "ndic-datex-v1");
const CACHE_DEST = path.join(CACHE_DIR, "smv-uls-reference-v1.json");
const DATA_DEST = path.join(
  ROOT,
  "projects",
  "data",
  "info_events",
  "ndic_datex_v1",
  "smv_uls_reference_v1.json"
);

function decimate(pathPts, maxPts = 8) {
  if (!pathPts || pathPts.length <= maxPts) return pathPts || [];
  const out = [];
  for (let i = 0; i < maxPts; i++) {
    const idx = Math.round((i * (pathPts.length - 1)) / (maxPts - 1));
    out.push(pathPts[idx]);
  }
  return out;
}

function normRoad(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(\d+)/);
  return m ? String(Number(m[1])) : t;
}

async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "SILNICE,STANICENI1,STANICENI2,CIS_USEKU,DELKA_US,ADMINJ,KOD_R",
    returnGeometry: "true",
    outSR: "4326",
    resultOffset: String(offset),
    resultRecordCount: "200",
    f: "json",
  });
  const url = SMV_ULS_LAYER.endpoint + "/query?" + params.toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error("SMV_ULS_HTTP_" + res.status);
  return res.json();
}

async function downloadAll() {
  const all = [];
  let offset = 0;
  for (;;) {
    const j = await fetchPage(offset);
    const f = Array.isArray(j.features) ? j.features : [];
    all.push(...f);
    if (!f.length || j.exceededTransferLimit !== true) break;
    offset += f.length;
    if (offset > 5000) throw new Error("SMV_ULS_TOO_MANY");
  }
  return all;
}

function toReference(features) {
  const segments = [];
  for (const f of features) {
    const a = f.attributes || {};
    const paths = (f.geometry && f.geometry.paths) || [];
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    const simp = [];
    for (const p of paths) {
      simp.push(decimate(p, 8));
      for (const xy of p) {
        const lon = xy[0];
        const lat = xy[1];
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
      }
    }
    const from = Number(a.STANICENI1);
    const to = Number(a.STANICENI2);
    segments.push({
      id: String(a.CIS_USEKU || ""),
      road: normRoad(a.SILNICE),
      roadRaw: String(a.SILNICE || "").trim(),
      fromM: Number.isFinite(from) ? from : null,
      toM: Number.isFinite(to) ? to : null,
      lenM: a.DELKA_US != null ? Number(a.DELKA_US) : null,
      admin: a.ADMINJ || null,
      bbox:
        Number.isFinite(minLon) && Number.isFinite(minLat)
          ? [minLon, minLat, maxLon, maxLat]
          : null,
      paths: simp,
    });
  }
  const base = {
    schema: "iu-smv-uls-reference-v1",
    source: "WMS_ULS/MapServer/5",
    layerId: SMV_ULS_LAYER.layerId,
    layerName: SMV_ULS_LAYER.layerName,
    copyright: "© Ředitelství silnic a dálnic ČR",
    accessNote: "INSPIRE metadata: no conditions for access and use / unrestricted public access",
    crs: "EPSG:4326",
    updateCadence: "2x yearly (April/October per ŘSD Geoportal)",
    fetchedAt: new Date().toISOString(),
    featureCount: segments.length,
    segments,
  };
  const body = JSON.stringify(base);
  const contentHash = crypto.createHash("sha256").update(body).digest("hex");
  return { ...base, contentHash };
}

function writeAtomic(dest, obj) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + ".new";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  if (fs.existsSync(dest)) {
    try {
      fs.copyFileSync(dest, dest + ".last-good");
    } catch {
      /* ignore */
    }
  }
  fs.renameSync(tmp, dest);
}

async function main() {
  try {
    const features = await downloadAll();
    if (!features.length) throw new Error("SMV_ULS_EMPTY");
    const ref = toReference(features);
    writeAtomic(CACHE_DEST, ref);
    // Optional published copy for sync tooling (not required for page render).
    writeAtomic(DATA_DEST, ref);
    console.log(
      JSON.stringify(
        {
          ok: true,
          featureCount: ref.featureCount,
          contentHash: ref.contentHash,
          cacheDest: CACHE_DEST,
          dataDest: DATA_DEST,
          bytes: fs.statSync(CACHE_DEST).size,
        },
        null,
        2
      )
    );
  } catch (err) {
    const kept = fs.existsSync(CACHE_DEST);
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: String(err && err.message ? err.message : err),
          keptPrevious: kept,
          failClosed: true,
        },
        null,
        2
      )
    );
    process.exit(kept ? 0 : 1);
  }
}

main();
