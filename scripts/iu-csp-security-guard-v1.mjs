#!/usr/bin/env node
/**
 * Static CSP security guard — meta + _headers must stay within approved baseline.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(ROOT, "projects", "index.html");
const HEADERS = path.join(ROOT, "_headers");

function extractCspBlocks(text) {
  const blocks = [];
  const metaRe = /<meta\s[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi;
  let m;
  while ((m = metaRe.exec(text))) {
    const tag = m[0];
    const contentMatch = tag.match(/content\s*=\s*["']([\s\S]*?)["']\s*\/?>/i);
    if (contentMatch) blocks.push(contentMatch[1].replace(/\s+/g, " ").trim());
  }
  const headerRe = /Content-Security-Policy:\s*(.+)/gi;
  while ((m = headerRe.exec(text))) blocks.push(m[1].replace(/\s+/g, " ").trim());
  return blocks;
}

function hasBareUnsafeEval(csp) {
  return csp.replace(/wasm-unsafe-eval/g, "").includes("unsafe-eval");
}

function must(cond, id, fails) {
  if (!cond) fails.push(id);
}

const fails = [];
const indexHtml = fs.readFileSync(INDEX, "utf8");
const headersTxt = fs.readFileSync(HEADERS, "utf8");
const csps = [...extractCspBlocks(indexHtml), ...extractCspBlocks(headersTxt)];

must(csps.length >= 2, "csp_sources_present", fails);

for (const csp of csps) {
  must(/default-src\s+'self'/.test(csp), "default_src_self", fails);
  must(/object-src\s+'none'/.test(csp), "object_src_none", fails);
  must(/base-uri\s+'self'/.test(csp), "base_uri_self", fails);
  must(/form-action\s+'self'/.test(csp), "form_action_self", fails);
  must(!hasBareUnsafeEval(csp), "no_unsafe_eval", fails);
  must(/\bwasm-unsafe-eval\b/.test(csp), "wasm_unsafe_eval_allowed", fails);
  must(!/script-src[^;]*\bhttps:\b/.test(csp), "script_src_no_https_wildcard", fails);
  must(/worker-src\s+'self'/.test(csp), "worker_src_self", fails);
  must(/manifest-src\s+'self'/.test(csp), "manifest_src_self", fails);
  must(/trusted-types\s+iu-default/.test(csp), "trusted_types_policy", fails);
  must(/require-trusted-types-for\s+'script'/.test(csp), "require_trusted_types_script", fails);
}

must(indexHtml.includes("iu-trusted-types-v1.js"), "trusted_types_script_loaded", fails);
must(
  indexHtml.indexOf("iu-trusted-types-v1.js") < indexHtml.indexOf("iu-vault-bootstrap-v1.js"),
  "trusted_types_before_vault",
  fails
);

if (fails.length) {
  console.error("IU_CSP_SECURITY_GUARD_FAIL");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("IU_CSP_SECURITY_GUARD_PASS");
