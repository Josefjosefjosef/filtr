#!/usr/bin/env node
/**
 * XSS sink audit — static scan of assets/*.js (excludes vendor).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "assets");

const SKIP = new Set(["vendor", "node_modules"]);
const SINK_PATTERNS = [
  { id: "innerHTML", re: /\.innerHTML\s*=/g },
  { id: "outerHTML", re: /\.outerHTML\s*=/g },
  { id: "insertAdjacentHTML", re: /\.insertAdjacentHTML\s*\(/g },
  { id: "document_write", re: /document\.write(?:ln)?\s*\(/g },
  { id: "eval", re: /\beval\s*\(/g },
  { id: "new_Function", re: /new\s+Function\s*\(/g },
  { id: "srcdoc", re: /\.srcdoc\s*=/g },
  { id: "string_setTimeout", re: /setTimeout\s*\(\s*['"`]/g },
  { id: "string_setInterval", re: /setInterval\s*\(\s*['"`]/g },
  { id: "javascript_url", re: /javascript\s*:/gi },
  { id: "DOMParser", re: /new\s+DOMParser\s*\(/g },
];

const DANGEROUS_UNESCAPED = [
  {
    id: "innerHTML_raw_item_name",
    file: "iu-app-feed-pipeline-v1.js",
    re: /function updateEventsUI\(\)[\s\S]{0,1200}\$\{item\.name\}/,
  },
];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      walk(fp, out);
      continue;
    }
    if (!name.endsWith(".js")) continue;
    out.push(fp);
  }
}

function countMatches(src, re) {
  const m = src.match(re);
  return m ? m.length : 0;
}

const files = [];
walk(ASSETS, files);

const totals = {};
for (const p of SINK_PATTERNS) totals[p.id] = 0;
const perFile = {};
const fails = [];

for (const fp of files) {
  const rel = path.relative(ROOT, fp).replace(/\\/g, "/");
  const src = fs.readFileSync(fp, "utf8");
  perFile[rel] = {};
  for (const p of SINK_PATTERNS) {
    const n = countMatches(src, p.re);
    perFile[rel][p.id] = n;
    totals[p.id] += n;
  }
  if (/\beval\s*\(/.test(src) && !rel.includes("vendor/")) {
    fails.push(`eval_forbidden:${rel}`);
  }
  if (/new\s+Function\s*\(/.test(src) && !rel.includes("vendor/")) {
    fails.push(`new_function_forbidden:${rel}`);
  }
}

for (const rule of DANGEROUS_UNESCAPED) {
  const targets = rule.file
    ? files.filter((f) => path.basename(f) === rule.file)
    : files;
  for (const fp of targets) {
    const rel = path.relative(ROOT, fp).replace(/\\/g, "/");
    const src = fs.readFileSync(fp, "utf8");
    if (rule.re.test(src)) fails.push(`${rule.id}:${rel}`);
  }
}

const report = {
  filesScanned: files.length,
  totals,
  topInnerHtml: Object.entries(perFile)
    .map(([f, c]) => [f, c.innerHTML || 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15),
};

console.log("IU_XSS_SINK_AUDIT_REPORT=" + JSON.stringify(report));

if (fails.length) {
  console.error("IU_XSS_SINK_AUDIT_FAIL");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("IU_XSS_SINK_AUDIT_PASS");
