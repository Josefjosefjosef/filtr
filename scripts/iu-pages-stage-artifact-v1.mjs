#!/usr/bin/env node
/**
 * SC-EXP-01: stage an allowlisted GitHub Pages production artifact.
 *
 * Canonical contract: PRODUCTION ARTIFACT = explicit runtime content only.
 * Repository checkout ≠ Pages artifact.
 *
 * Run AFTER deploy-time mutations in the working tree:
 *   - versioned asset copies
 *   - HTML rewrite
 *   - iu-pages-root-publish.mjs
 *   - CSP hash apply
 *
 * Usage:
 *   node scripts/iu-pages-stage-artifact-v1.mjs
 *   IU_PAGES_STAGE_DIR=dist-pages node scripts/iu-pages-stage-artifact-v1.mjs
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STAGE = process.env.IU_PAGES_STAGE_DIR
  ? join(ROOT, process.env.IU_PAGES_STAGE_DIR)
  : join(ROOT, "dist-pages");

/** Explicit runtime paths/directories relative to repo root (allowlist). */
const ALLOW_DIRS = [
  "assets",
  "projects",
  "icons", // root-publish
  "statistiky", // root-publish
  "zdroje-a-licence", // root-publish
  "bot",
  ".well-known",
];

const ALLOW_FILES = [
  "index.html",
  "sw.js",
  "offline.html",
  "manifest.json",
  "favicon.svg",
  "robots.txt",
  "sitemap.xml",
  "CNAME",
  ".nojekyll",
  "_headers",
];

/** Optional until iu-pages-root-publish has run (still required in real Pages deploy). */
const OPTIONAL_DIRS = new Set(["icons", "statistiky", "zdroje-a-licence", ".well-known"]);

const SKIP_NAME_RE = /(^|\/)(\.env|\.env\..*|.*\.(bak|old|orig|tmp|zip|tar|gz|7z|map))$/i;

function shouldSkipRel(relPosix) {
  return SKIP_NAME_RE.test(relPosix.replace(/\\/g, "/"));
}

function filterCopy(src, dest) {
  const st = statSync(src);
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src)) {
      const childSrc = join(src, name);
      const childDest = join(dest, name);
      const childRel = relative(STAGE, childDest).split(sep).join("/");
      if (shouldSkipRel(childRel) || shouldSkipRel(name)) {
        console.log("STAGE_SKIP_NON_RUNTIME=" + childRel);
        continue;
      }
      filterCopy(childSrc, childDest);
    }
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { force: true });
}

function copyPath(rel, { optional = false } = {}) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    if (optional) {
      console.log("STAGE_SKIP_MISSING=" + rel);
      return;
    }
    console.error("IU_PAGES_STAGE_MISSING=" + rel);
    process.exit(1);
  }
  const dest = join(STAGE, rel);
  filterCopy(abs, dest);
  console.log("STAGE_COPY=" + rel);
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

for (const d of ALLOW_DIRS) {
  copyPath(d, { optional: OPTIONAL_DIRS.has(d) });
}

// Deploy path always runs root-publish first. For local/PR dry-run, fall back to projects shell.
if (!existsSync(join(ROOT, "index.html")) && existsSync(join(ROOT, "projects", "index.html"))) {
  mkdirSync(STAGE, { recursive: true });
  cpSync(join(ROOT, "projects", "index.html"), join(STAGE, "index.html"));
  console.log("STAGE_COPY=projects/index.html->index.html (dry-run fallback)");
}
if (!existsSync(join(ROOT, "manifest.json")) && existsSync(join(ROOT, "projects", "manifest.json"))) {
  cpSync(join(ROOT, "projects", "manifest.json"), join(STAGE, "manifest.json"));
  console.log("STAGE_COPY=projects/manifest.json->manifest.json (dry-run fallback)");
}

for (const f of ALLOW_FILES) {
  if (f === "index.html" && existsSync(join(STAGE, "index.html"))) continue;
  if (f === "manifest.json" && existsSync(join(STAGE, "manifest.json"))) continue;
  copyPath(f);
}

const files = walkFiles(STAGE);
let totalBytes = 0;
for (const f of files) totalBytes += statSync(f).size;
const top = readdirSync(STAGE).sort();
const relFiles = files.map((f) => relative(STAGE, f).split(sep).join("/")).sort();

const manifest = {
  contract: "iu-pages-production-artifact-allowlist-v1",
  stageDir: relative(ROOT, STAGE).split(sep).join("/") || ".",
  fileCount: files.length,
  totalBytes,
  topLevel: top,
  allowDirs: ALLOW_DIRS,
  allowFiles: ALLOW_FILES,
  sampleFiles: relFiles.slice(0, 40),
};

const manifestPath = join(STAGE, ".iu-pages-artifact-manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
// Manifest must NOT ship to the public site — keep it beside stage for CI, then delete before upload.
console.log("IU_PAGES_STAGE_MANIFEST=" + JSON.stringify(manifest));
console.log("IU_PAGES_STAGE_OK=" + STAGE);
process.exit(0);
