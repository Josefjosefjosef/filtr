#!/usr/bin/env node
/**
 * Pages deploy skew fix: retain previous generation(s) of hashed assets.
 *
 * Problem: pages.yml publishes `/assets/<name>.<ASSET_VER>.(js|css)` per deploy SHA.
 * GitHub Pages replaces the whole artifact, so the previous `<name>.<oldSHA>.js` becomes 404
 * the moment the new deploy goes live. Open tabs / HTML cached by CDN / SW last-good HTML that
 * still reference the old hash then break (e.g. iu-info-system-core-v1.7f9d8fda.js 404).
 *
 * Fix: before upload, read what the LIVE site references (home HTML + retained manifest),
 * download those hashed files and place them in the new artifact (dist-pages/assets) for a TTL.
 *
 * - Fail-open: any network problem logs a warning and exits 0 (never blocks a deploy).
 * - Only files named `<base>.<8-hex>.(js|css)` under /assets/ are retained (no traversal).
 * - Retained set is tracked in `assets/iu-retained-assets-v1.json` ({ file, firstSeenUtc }),
 *   entries older than TTL are dropped so the artifact does not grow unbounded.
 *
 * Usage (after iu-pages-stage-artifact-v1.mjs, before upload):
 *   node scripts/iu-pages-retain-prev-assets-v1.mjs
 * Env:
 *   IU_PAGES_STAGE_DIR           default dist-pages
 *   IU_PAGES_LIVE_ORIGIN         default https://infouzel.cz
 *   IU_PAGES_RETAIN_TTL_HOURS    default 24
 *   IU_PAGES_RETAIN_MAX_FILES    default 60 (safety cap per run)
 */
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STAGE = resolve(ROOT, process.env.IU_PAGES_STAGE_DIR || "dist-pages");
const ORIGIN = String(process.env.IU_PAGES_LIVE_ORIGIN || "https://infouzel.cz").replace(/\/+$/, "");
const TTL_MS = Number(process.env.IU_PAGES_RETAIN_TTL_HOURS || 24) * 3600 * 1000;
const MAX_FILES = Number(process.env.IU_PAGES_RETAIN_MAX_FILES || 60);
const MANIFEST_NAME = "iu-retained-assets-v1.json";
const FETCH_TIMEOUT_MS = 15000;

/** `/assets/<base>.<8hex>.js|css` — base may contain dots/dashes, hash is 8 lowercase hex. */
const HASHED_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.[0-9a-f]{8}\.(?:js|css)$/;
const HTML_REF_RE = /\/assets\/([A-Za-z0-9_-][A-Za-z0-9._-]*\.[0-9a-f]{8}\.(?:js|css))(?![A-Za-z0-9._-])/g;
const JS_IMPORT_RE = /["'](?:\.\/|\/assets\/)([A-Za-z0-9_-][A-Za-z0-9._-]*\.[0-9a-f]{8}\.js)(?:\?[^"']*)?["']/g;

/** @param {string} text @param {RegExp} re */
export function extractHashedNames(text, re) {
  const out = new Set();
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = rx.exec(String(text || ""))) !== null) {
    if (HASHED_NAME_RE.test(m[1])) out.add(m[1]);
  }
  return out;
}

async function fetchRes(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "Cache-Control": "no-cache" }, redirect: "error" });
  } finally {
    clearTimeout(t);
  }
}

/** Download an asset; reject HTML soft-404 bodies. Returns Buffer|null. */
async function fetchAsset(name) {
  try {
    const res = await fetchRes(`${ORIGIN}/assets/${name}?iu_retain=1`);
    if (!res.ok) return null;
    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch (_) {
    return null;
  }
}

async function main() {
  const assetsDir = join(STAGE, "assets");
  if (!existsSync(assetsDir)) {
    console.error("IU_PAGES_RETAIN_FAIL missing_stage_assets=" + assetsDir);
    process.exit(1);
  }
  const now = Date.now();
  /** @type {Map<string,string>} file -> firstSeenUtc */
  const wanted = new Map();
  let liveReachable = false;

  // 1) Previous retained manifest from live site (older generations, TTL-bounded).
  try {
    const res = await fetchRes(`${ORIGIN}/assets/${MANIFEST_NAME}?iu_retain=1`);
    if (res.ok) {
      const j = JSON.parse(await res.text());
      for (const e of Array.isArray(j && j.files) ? j.files : []) {
        const seen = Date.parse(e && e.firstSeenUtc);
        if (e && HASHED_NAME_RE.test(String(e.file)) && Number.isFinite(seen) && now - seen < TTL_MS) {
          wanted.set(e.file, e.firstSeenUtc);
        }
      }
    }
  } catch (_) {
    console.warn("IU_PAGES_RETAIN_WARN live_manifest_unavailable");
  }

  // 2) Previous generation = hashed assets referenced by the LIVE home HTML (+ their JS imports).
  const nowIso = new Date(now).toISOString();
  const live = new Map(); // name -> Buffer (already downloaded)
  try {
    const res = await fetchRes(`${ORIGIN}/?iu_retain=1`);
    if (res.ok) {
      liveReachable = true;
      const html = await res.text();
      const queue = [...extractHashedNames(html, HTML_REF_RE)];
      while (queue.length && live.size < MAX_FILES) {
        const name = queue.shift();
        if (live.has(name)) continue;
        const buf = await fetchAsset(name);
        if (!buf) continue;
        live.set(name, buf);
        if (!wanted.has(name)) wanted.set(name, nowIso);
        if (name.endsWith(".js")) {
          for (const dep of extractHashedNames(buf.toString("utf8"), JS_IMPORT_RE)) {
            if (!live.has(dep)) queue.push(dep);
          }
        }
      }
    } else {
      console.warn("IU_PAGES_RETAIN_WARN live_home_status=" + res.status);
    }
  } catch (_) {
    console.warn("IU_PAGES_RETAIN_WARN live_home_unavailable");
  }

  // 3) Materialize into artifact; never overwrite files the new deploy already ships.
  const kept = [];
  let copied = 0;
  let alreadyPresent = 0;
  let missing = 0;
  for (const [file, firstSeenUtc] of wanted) {
    if (kept.length >= MAX_FILES) break;
    const dest = join(assetsDir, file);
    if (existsSync(dest)) {
      alreadyPresent++;
      // Current-generation file (same hash as this deploy) — not a retained leftover.
      continue;
    }
    const buf = live.get(file) || (await fetchAsset(file));
    if (!buf) {
      missing++;
      console.warn("IU_PAGES_RETAIN_WARN unavailable=" + file);
      continue;
    }
    writeFileSync(dest, buf);
    copied++;
    kept.push({ file, firstSeenUtc });
    console.log("IU_PAGES_RETAIN_COPY=" + file + " bytes=" + buf.length);
  }

  if (liveReachable) {
    writeFileSync(
      join(assetsDir, MANIFEST_NAME),
      JSON.stringify({ schema: "iu-retained-assets-v1", ttlHours: TTL_MS / 3600000, generatedUtc: nowIso, files: kept }, null, 2) + "\n",
      "utf8"
    );
  } else {
    console.warn("IU_PAGES_RETAIN_WARN live_unreachable_manifest_not_written");
  }
  console.log(
    "IU_PAGES_RETAIN_SUMMARY=" +
      JSON.stringify({ origin: ORIGIN, retained: copied, alreadyPresent, missing, ttlHours: TTL_MS / 3600000 })
  );
  console.log("IU_PAGES_RETAIN_OK");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    // Fail-open: retention is best-effort and must never block a deploy.
    console.warn("IU_PAGES_RETAIN_WARN fatal=" + (e && e.message ? e.message : e));
    process.exit(0);
  });
}
