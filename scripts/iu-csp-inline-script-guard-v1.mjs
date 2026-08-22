#!/usr/bin/env node
/**
 * CSP inline script inventory — documents script-src unsafe-inline necessity.
 * Fails if inline scripts exist but CSP lacks hashes OR unsafe-inline.
 */
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(ROOT, "projects", "index.html");
const HEADERS = path.join(ROOT, "_headers");

function extractCsp(text) {
  const m = text.match(/Content-Security-Policy[^>]*content\s*=\s*["']([\s\S]*?)["']\s*\/?>/i);
  if (m) return m[1].replace(/\s+/g, " ").trim();
  const h = text.match(/Content-Security-Policy:\s*(.+)/i);
  return h ? h[1].trim() : "";
}

function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const body = m[2].trim();
    if (!body) continue;
    const hash = crypto.createHash("sha256").update(body, "utf8").digest("base64");
    scripts.push({ hash: `'sha256-${hash}'`, bytes: body.length });
  }
  return scripts;
}

const index = fs.readFileSync(INDEX, "utf8");
const headers = fs.readFileSync(HEADERS, "utf8");
const cspMeta = extractCsp(index);
const cspHeader = extractCsp(headers);
const scripts = extractInlineScripts(index);
const fails = [];

const scriptSrcMeta = (cspMeta.match(/script-src\s+([^;]+)/i) || [])[1] || "";
const hasUnsafeInline = /'unsafe-inline'/.test(scriptSrcMeta);
const missingHashes = scripts.filter((s) => !scriptSrcMeta.includes(s.hash));

console.log(
  "IU_CSP_INLINE_INVENTORY=" +
    JSON.stringify({
      inlineScriptCount: scripts.length,
      totalInlineBytes: scripts.reduce((a, s) => a + s.bytes, 0),
      hasUnsafeInline,
      missingHashCount: missingHashes.length,
      requireTrustedTypes: /require-trusted-types-for\s+'script'/.test(cspMeta),
    })
);

if (!scripts.length) {
  if (hasUnsafeInline) fails.push("unsafe_inline_without_scripts");
}
if (scripts.length && !hasUnsafeInline && missingHashes.length) {
  fails.push(`missing_script_hashes:${missingHashes.length}`);
}
if (!/'self'/.test(scriptSrcMeta)) fails.push("script_src_missing_self");
if (!/wasm-unsafe-eval/.test(scriptSrcMeta)) fails.push("script_src_missing_wasm");

const styleSrc = (cspMeta.match(/style-src\s+([^;]+)/i) || [])[1] || "";
if (!/'unsafe-inline'/.test(styleSrc)) {
  console.log("NOTE style-src has no unsafe-inline — link onload handlers may need style hashes");
}

if (fails.length) {
  console.error("IU_CSP_INLINE_SCRIPT_GUARD_FAIL");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("IU_CSP_INLINE_SCRIPT_GUARD_PASS");
