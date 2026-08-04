#!/usr/bin/env node
/**
 * Static forbid: public /projects/ must not reappear as hub navigation / prod test URL.
 * Allowlisted exceptions only (data contract, legacy redirect proofs, comments/docs).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const fails = [];

/** Paths scanned for forbidden public hub /projects/ usage. */
const SCAN_GLOBS = [
  "index.html",
  "manifest.json",
  "projects/manifest.json",
  "sw.js",
  "assets/app.js",
  "scripts/silver-mobile-tablet-home-ux-v1-shared.cjs",
  "scripts/silver-home-date-time-input-fit-guard-v1.cjs",
  "scripts/run-silver-home-date-time-input-fit-guard-against-checkout.cjs",
  "scripts/smoke.mjs",
  "scripts/iu-root-routing-prod-guard.mjs",
  "tools/gate-root-redirect.ps1",
  ".github/workflows/smoke.yml",
  ".github/workflows/pages.yml",
];

/**
 * Explicit allowlist patterns (line-level). Anything else matching
 * https://infouzel.cz/projects/ or hub navigation to /projects/ fails.
 */
const ALLOW_LINE = [
  /\/projects\/data\//,
  /\/projects\/version\.json/,
  /projects\/data\//,
  /legacy.*redirect/i,
  /301.*\/projects/i,
  /\/projects\/\s*→/,
  /redirectTarget\(.*\/projects/,
  /fetchNoFollow\(PROD \+ "\/projects/,
  /PROBE.*\/projects\//,
  /curl.*\/projects\//,
  /Location:.*\/projects\//i,
  /#.*\/projects\//,
  /\/\*[\s\S]*\/projects\//,
  /NEVER.*\/projects\//i,
  /must not.*\/projects\//i,
  /forbid.*\/projects\//i,
  /no_projects|not_projects|no-projects/i,
  /passthrough.*\/projects/i,
  /iuBasePath|iuInfoBasePath|basePath.*projects/,
  /FEED_OFFLINE|IMG_OFFLINE|version\.json/,
  /writeRedirect\("projects\//,
  /LEGACY_REDIRECT/,
  /server\/projects-static/,
  /static http:\/\/127\.0\.0\.1:.*\/projects\//,
  /localhost:.*\/projects\//,
  /127\.0\.0\.1:\d+\/projects\//,
];

function isAllowed(line) {
  const s = String(line || "");
  for (const re of ALLOW_LINE) {
    if (re.test(s)) return true;
  }
  return false;
}

function scanFile(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fails.push("missing:" + rel);
    return;
  }
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hubProd = /https:\/\/(www\.)?infouzel\.cz\/projects\/?(?!data\/)(?!version\.json)/i.test(line);
    const locReplace = /location\.(replace|assign)\(\s*['"`]\/projects\//.test(line);
    const startUrl = /["']start_url["']\s*:\s*["'][^"']*\/projects\//.test(line);
    const scopeProjects = /["']scope["']\s*:\s*["'][^"']*\/projects\//.test(line);
    const defaultUrl = /DEFAULT_URL\s*=\s*["']https:\/\/infouzel\.cz\/projects\//.test(line);
    if (!(hubProd || locReplace || startUrl || scopeProjects || defaultUrl)) continue;
    if (isAllowed(line)) continue;
    fails.push(rel + ":" + (i + 1) + ":" + line.trim().slice(0, 180));
  }
}

for (const rel of SCAN_GLOBS) scanFile(rel);

if (fails.length) {
  console.log("[iu-projects-forbidden-hub-guard] FAIL");
  for (const f of fails) console.log("FAIL " + f);
  process.exit(1);
}
console.log("[iu-projects-forbidden-hub-guard] OK");
