#!/usr/bin/env node
/**
 * Live production CSP + Trusted Types header verification.
 * On pull_request: if repo CSP is already hardened but prod still has legacy
 * script-src unsafe-inline, emit PENDING_DEPLOY skip (pre-merge deploy lag).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROD = process.env.IU_PROD_URL || "https://infouzel.cz/";
const fails = [];
const pending = [];

function extractMetaCsp(html) {
  const start = html.search(/http-equiv\s*=\s*["']Content-Security-Policy["']/i);
  if (start < 0) return "";
  const contentMatch = html.slice(start).match(/content\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!contentMatch) return "";
  return contentMatch[2].replace(/\s+/g, " ").trim();
}

function scriptSrcHasUnsafeInline(csp) {
  return /'unsafe-inline'/.test((csp.match(/script-src\s+([^;]+)/i) || [])[1] || "");
}

function localRepoScriptSrcHasUnsafeInline() {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const headers = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");
  const indexCsp = extractMetaCsp(index);
  const headerMatch = headers.match(/Content-Security-Policy:\s*(.+)/i);
  const headerCsp = headerMatch ? headerMatch[1].replace(/\s+/g, " ").trim() : "";
  return scriptSrcHasUnsafeInline(indexCsp) || scriptSrcHasUnsafeInline(headerCsp);
}

async function fetchHtml(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "Cache-Control": "no-cache" } });
  const html = await res.text();
  const headers = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { status: res.status, headers, html };
}

async function main() {
  const root = await fetchHtml(PROD);
  if (root.status !== 200) fails.push(`root_status:${root.status}`);

  const csp = extractMetaCsp(root.html);
  if (!csp) fails.push("missing_meta_csp");

  if (!/require-trusted-types-for\s+'script'/.test(csp)) fails.push("missing_require_trusted_types");
  if (!/trusted-types\s+iu-default\s+iu-escape/.test(csp)) fails.push("missing_trusted_types_policies");
  if (/script-src[^;]*\bunsafe-eval\b/.test(csp.replace(/wasm-unsafe-eval/g, ""))) fails.push("unsafe_eval_in_script_src");
  if (!/object-src\s+'none'/.test(csp)) fails.push("object_src_missing_none");
  if (scriptSrcHasUnsafeInline(csp)) {
    fails.push("script_src_unsafe_inline");
  }

  if (!root.html.includes("iu-trusted-types-v1.js")) fails.push("missing_tt_script");
  if (!root.html.includes("iu-vault-bootstrap")) fails.push("missing_vault_bootstrap");

  const eventName = String(process.env.GITHUB_EVENT_NAME || "");
  const repoClean = !localRepoScriptSrcHasUnsafeInline();
  if (fails.includes("script_src_unsafe_inline") && repoClean && eventName === "pull_request") {
    const idx = fails.indexOf("script_src_unsafe_inline");
    if (idx >= 0) fails.splice(idx, 1);
    pending.push("script_src_unsafe_inline_pending_deploy");
  }

  const lastMod = root.headers["last-modified"] || "";
  console.log(
    "IU_PROD_CSP_LIVE=" +
      JSON.stringify({
        status: root.status,
        lastModified: lastMod,
        cspSnippet: csp.slice(0, 240),
        ttEnforce: /require-trusted-types-for/.test(csp),
        unsafeInlineScript: scriptSrcHasUnsafeInline(csp),
        repoScriptSrcClean: repoClean,
        eventName,
        pending,
        fails,
      })
  );

  if (fails.length) {
    console.error("IU_PROD_CSP_LIVE_FAIL");
    process.exit(1);
  }
  if (pending.length) {
    console.log("IU_PROD_CSP_LIVE_PENDING_DEPLOY=" + JSON.stringify(pending));
  }
  console.log("IU_PROD_CSP_LIVE_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
