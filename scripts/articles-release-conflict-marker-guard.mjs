/**
 * articles_release_conflict_marker_guard — block release commit when projects/data has conflict markers.
 *
 * Run: node scripts/articles-release-conflict-marker-guard.mjs
 *
 * Env:
 *   ARTICLES_DATA_ROOT — default projects/data
 *   ARTICLES_RELEASE_CONFLICT_SCAN_GLOB — optional comma list of relative paths to scan (default: all under root)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const MARKER_LINE_RE = /^(<<<<<<<|=======|>>>>>>>)/;

function log(msg) {
  console.log(`[articles-release-conflict-marker-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[articles-release-conflict-marker-guard] FAIL: ${msg}`);
}

export function lineHasConflictMarker(line) {
  return MARKER_LINE_RE.test(String(line || "").trimStart());
}

export function scanTextForConflictMarkers(text, fileLabel = "text") {
  const hits = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lineHasConflictMarker(lines[i])) {
      hits.push({ file: fileLabel, line: i + 1, text: lines[i].trim() });
    }
  }
  return hits;
}

function walkFiles(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      out.push(full);
    }
  }
  return out;
}

function shouldScanFile(relPath) {
  const base = path.basename(relPath);
  if (base.endsWith(".tmp") || base.endsWith(".bak")) return false;
  return true;
}

export function scanProjectsData(rootDir = "projects/data", options = {}) {
  const absRoot = path.resolve(rootDir);
  const onlyPaths = options.onlyPaths ?? null;
  const files =
    Array.isArray(onlyPaths) && onlyPaths.length > 0
      ? onlyPaths.map((p) => path.resolve(p))
      : walkFiles(absRoot);

  const markerHits = [];
  const jsonErrors = [];
  for (const filePath of files) {
    const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
    if (!shouldScanFile(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      jsonErrors.push({ file: rel, error: e.message || String(e) });
      continue;
    }
    markerHits.push(...scanTextForConflictMarkers(text, rel));
    if (rel.endsWith(".json")) {
      try {
        JSON.parse(text);
      } catch (e) {
        jsonErrors.push({ file: rel, error: e.message || String(e) });
      }
    }
  }
  return { markerHits, jsonErrors, scanned: files.length };
}

function main() {
  const root = process.env.ARTICLES_DATA_ROOT || "projects/data";
  const onlyRaw = (process.env.ARTICLES_RELEASE_CONFLICT_SCAN_PATHS || "").trim();
  const onlyPaths = onlyRaw
    ? onlyRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const { markerHits, jsonErrors, scanned } = scanProjectsData(root, { onlyPaths });
  log(`root=${root} scanned_files=${scanned}`);

  if (markerHits.length > 0) {
    for (const hit of markerHits.slice(0, 20)) {
      fail(`${hit.file}:${hit.line}: conflict marker ${hit.text}`);
    }
    if (markerHits.length > 20) {
      fail(`... and ${markerHits.length - 20} more conflict marker lines`);
    }
    console.error("[articles-release-conflict-marker-guard] RESULT=FAIL");
    process.exit(1);
  }

  if (jsonErrors.length > 0) {
    for (const err of jsonErrors) {
      fail(`${err.file}: invalid JSON (${err.error})`);
    }
    console.error("[articles-release-conflict-marker-guard] RESULT=FAIL");
    process.exit(1);
  }

  log("RESULT=PASS");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
