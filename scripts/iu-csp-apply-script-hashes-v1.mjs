#!/usr/bin/env node
/**
 * Compute inline script SHA-256 hashes and apply to CSP (removes script-src unsafe-inline).
 * Run: node scripts/iu-csp-apply-script-hashes-v1.mjs
 * Deploy artifact: IU_CSP_APPLY_INDEX=index.html node scripts/iu-csp-apply-script-hashes-v1.mjs
 */
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = process.env.IU_CSP_APPLY_INDEX
  ? path.resolve(ROOT, process.env.IU_CSP_APPLY_INDEX)
  : path.join(ROOT, "projects", "index.html");
const HEADERS = path.join(ROOT, "_headers");

function extractInlineScriptHashes(html) {
  const hashes = [];
  const re = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const body = m[2];
    if (!body.trim()) continue;
    const hash = crypto.createHash("sha256").update(body, "utf8").digest("base64");
    hashes.push(`'sha256-${hash}'`);
  }
  return hashes;
}

function buildScriptSrc(hashes) {
  return `script-src 'self' ${hashes.join(" ")} 'wasm-unsafe-eval';`;
}

function updateMetaCsp(html, scriptSrcLine) {
  return html.replace(
    /script-src[^;]*;/,
    scriptSrcLine
  );
}

function updateHeadersCsp(headers, scriptSrcPart) {
  return headers.replace(
    /script-src[^;]*/,
    scriptSrcPart.replace(/;$/, "")
  );
}

const index = fs.readFileSync(INDEX, "utf8");
const hashes = extractInlineScriptHashes(index);
if (!hashes.length) {
  console.error("NO_INLINE_SCRIPTS");
  process.exit(1);
}

const scriptSrcLine = buildScriptSrc(hashes);
const newIndex = updateMetaCsp(index, scriptSrcLine);
const headers = fs.readFileSync(HEADERS, "utf8");
const newHeaders = updateHeadersCsp(headers, scriptSrcLine);

fs.writeFileSync(INDEX, newIndex);
fs.writeFileSync(HEADERS, newHeaders);

console.log(
  "IU_CSP_SCRIPT_HASHES_APPLIED=" +
    JSON.stringify({
      indexPath: path.relative(ROOT, INDEX),
      hashCount: hashes.length,
      scriptSrcLength: scriptSrcLine.length,
      removedUnsafeInline: true,
    })
);
