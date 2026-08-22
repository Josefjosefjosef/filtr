#!/usr/bin/env node
/**
 * Live production CSP + Trusted Types header verification.
 */
const PROD = process.env.IU_PROD_URL || "https://infouzel.cz/";
const fails = [];

async function fetchHtml(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "Cache-Control": "no-cache" } });
  const html = await res.text();
  const headers = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { status: res.status, headers, html };
}

function extractMetaCsp(html) {
  const start = html.search(/http-equiv\s*=\s*["']Content-Security-Policy["']/i);
  if (start < 0) return "";
  const contentMatch = html.slice(start).match(/content\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!contentMatch) return "";
  return contentMatch[2].replace(/\s+/g, " ").trim();
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
  if (/'unsafe-inline'/.test((csp.match(/script-src\s+([^;]+)/i) || [])[1] || "")) {
    fails.push("script_src_unsafe_inline");
  }

  if (!root.html.includes("iu-trusted-types-v1.js")) fails.push("missing_tt_script");
  if (!root.html.includes("iu-vault-bootstrap")) fails.push("missing_vault_bootstrap");

  const lastMod = root.headers["last-modified"] || "";
  console.log(
    "IU_PROD_CSP_LIVE=" +
      JSON.stringify({
        status: root.status,
        lastModified: lastMod,
        cspSnippet: csp.slice(0, 240),
        ttEnforce: /require-trusted-types-for/.test(csp),
        unsafeInlineScript: /script-src[^;]*unsafe-inline/.test(csp),
        fails,
      })
  );

  if (fails.length) {
    console.error("IU_PROD_CSP_LIVE_FAIL");
    process.exit(1);
  }
  console.log("IU_PROD_CSP_LIVE_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
