#!/usr/bin/env node
/**
 * SC-EXP-01 defense-in-depth: forbid non-runtime paths in the Pages staging artifact.
 * Primary security model remains the allowlist stager; this guard blocks regressions.
 *
 * Usage:
 *   IU_PAGES_STAGE_DIR=dist-pages node scripts/iu-pages-artifact-guard-v1.mjs
 */
import { existsSync, readdirSync, statSync, readFileSync, unlinkSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STAGE = process.env.IU_PAGES_STAGE_DIR
  ? join(ROOT, process.env.IU_PAGES_STAGE_DIR)
  : join(ROOT, "dist-pages");

const FORBIDDEN_PREFIXES = [
  ".git/",
  ".github/",
  ".vscode/",
  ".cursor/",
  "node_modules/",
  "cloudflare/",
  "scripts/",
  "docs/",
  "server/",
  "tools/",
  "deploy/",
  "diagnostics/",
  "config/",
  "ocr_corpus/",
  "programovani/",
  "partials/",
  "data/",
  "filtr/",
];

const FORBIDDEN_EXACT = new Set([
  "package.json",
  "package-lock.json",
  ".gitignore",
  ".gitattributes",
  ".cursorrules",
  "requirements.txt",
  "doprava.html",
  "zpravy.html",
]);

const FORBIDDEN_SUFFIXES = [".map", ".bak", ".old", ".orig", ".tmp", ".zip", ".tar", ".gz", ".7z"];

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".iu-pages-artifact-manifest.json") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

if (!existsSync(STAGE)) {
  console.error("IU_PAGES_ARTIFACT_GUARD_FAIL missing_stage=" + STAGE);
  process.exit(1);
}

const files = walkFiles(STAGE);
const rels = files.map((f) => relative(STAGE, f).split(sep).join("/"));
const forbidden = [];

for (const rel of rels) {
  const lower = rel.toLowerCase();
  if (FORBIDDEN_EXACT.has(rel) || FORBIDDEN_EXACT.has(lower)) {
    forbidden.push(rel);
    continue;
  }
  for (const pref of FORBIDDEN_PREFIXES) {
    if (rel === pref.slice(0, -1) || rel.startsWith(pref)) {
      forbidden.push(rel);
      break;
    }
  }
  for (const suf of FORBIDDEN_SUFFIXES) {
    if (lower.endsWith(suf)) {
      forbidden.push(rel);
      break;
    }
  }
  if (/(^|\/)\.env(\.|$)/i.test(rel)) forbidden.push(rel);
}

const required = ["index.html", "sw.js", "offline.html", "assets", "projects", "manifest.json"];
const missingRequired = [];
for (const r of required) {
  if (!existsSync(join(STAGE, r))) missingRequired.push(r);
}

let totalBytes = 0;
for (const f of files) totalBytes += statSync(f).size;
const top = readdirSync(STAGE).filter((n) => n !== ".iu-pages-artifact-manifest.json").sort();

const proof = {
  stage: relative(ROOT, STAGE).split(sep).join("/") || ".",
  fileCount: files.length,
  totalBytes,
  topLevel: top,
  forbiddenCount: forbidden.length,
  forbiddenSample: forbidden.slice(0, 40),
  missingRequired,
  FORBIDDEN_ARTIFACT_PATHS: forbidden.length,
};

console.log("IU_PAGES_ARTIFACT_GUARD=" + JSON.stringify(proof));

if (missingRequired.length) {
  console.error("IU_PAGES_ARTIFACT_GUARD_FAIL missing_required");
  process.exit(1);
}
if (forbidden.length) {
  console.error("IU_PAGES_ARTIFACT_GUARD_FAIL forbidden_paths");
  process.exit(1);
}

// Remove internal manifest so it is never uploaded publicly.
const man = join(STAGE, ".iu-pages-artifact-manifest.json");
if (existsSync(man)) {
  try {
    const raw = readFileSync(man, "utf8");
    console.log("IU_PAGES_ARTIFACT_MANIFEST_BYTES=" + Buffer.byteLength(raw));
  } catch (_) {}
  unlinkSync(man);
}

console.log("FORBIDDEN_ARTIFACT_PATHS=0");
console.log("IU_PAGES_ARTIFACT_GUARD_PASS");
process.exit(0);
