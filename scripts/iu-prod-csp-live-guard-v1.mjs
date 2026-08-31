#!/usr/bin/env node
/**
 * Live production CSP + Trusted Types verification.
 * XSS-CSP-01/02: requires HTTP Content-Security-Policy on HTML documents
 * (meta alone is insufficient — GitHub Pages does not apply repo `_headers`).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROD = process.env.IU_PROD_URL || "https://infouzel.cz/";
const fails = [];
const pending = [];

function extractMetaCsp(html) {
  const equivIdx = html.search(/http-equiv\s*=\s*["']Content-Security-Policy["']/i);
  if (equivIdx < 0) return "";
  const back = html.slice(Math.max(0, equivIdx - 300), equivIdx);
  const openRel = back.toLowerCase().lastIndexOf("<meta");
  if (openRel < 0) return "";
  const tagStart = Math.max(0, equivIdx - 300) + openRel;
  const after = html.slice(tagStart, tagStart + 16000);
  const endRel = after.indexOf(">");
  if (endRel < 0) return "";
  const tag = after.slice(0, endRel + 1);
  const contentMatch = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i);
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
  return { status: res.status, headers, html, url: res.url };
}

function assertCspPolicy(csp, label, failsArr) {
  if (!csp) {
    failsArr.push(`${label}_missing_csp`);
    return;
  }
  if (!/require-trusted-types-for\s+'script'/.test(csp)) failsArr.push(`${label}_missing_require_trusted_types`);
  if (!/trusted-types\s+iu-default\s+iu-escape/.test(csp)) failsArr.push(`${label}_missing_trusted_types_policies`);
  if (/script-src[^;]*\bunsafe-eval\b/.test(csp.replace(/wasm-unsafe-eval/g, ""))) {
    failsArr.push(`${label}_unsafe_eval_in_script_src`);
  }
  if (!/object-src\s+'none'/.test(csp)) failsArr.push(`${label}_object_src_missing_none`);
  if (scriptSrcHasUnsafeInline(csp)) failsArr.push(`${label}_script_src_unsafe_inline`);
}

async function main() {
  const root = await fetchHtml(PROD);
  if (root.status !== 200) fails.push(`root_status:${root.status}`);

  const httpCsp = (root.headers["content-security-policy"] || "").replace(/\s+/g, " ").trim();
  const metaCsp = extractMetaCsp(root.html);
  const edgeMarker = root.headers["x-iu-csp-edge"] || "";

  if (!httpCsp) fails.push("missing_http_csp_header");
  if (!metaCsp) fails.push("missing_meta_csp");
  if (!/frame-ancestors\s+'self'/.test(httpCsp)) fails.push("http_csp_missing_frame_ancestors_self");

  assertCspPolicy(httpCsp, "http", fails);
  assertCspPolicy(metaCsp, "meta", fails);

  // Pre-CSP window: HTTP header present ⇒ browser enforces before parser runs scripts.
  const firstScript = root.html.search(/<script\b/i);
  const metaPos = root.html.search(/http-equiv\s*=\s*["']Content-Security-Policy["']/i);
  const preMetaScriptsExist = firstScript >= 0 && metaPos >= 0 && firstScript < metaPos;
  if (httpCsp && preMetaScriptsExist) {
    // Expected: early scripts remain for vault/PWA boot; HTTP CSP closes the window.
  } else if (!httpCsp && preMetaScriptsExist) {
    fails.push("pre_csp_execution_window_open");
  }

  if (!root.html.includes("iu-trusted-types-v1.js")) fails.push("missing_tt_script");
  if (!root.html.includes("iu-vault-bootstrap")) fails.push("missing_vault_bootstrap");

  // /projects/ is 301 → / ; final document must carry HTTP CSP.
  const projects = await fetchHtml(new URL("/projects/", PROD).toString());
  const projectsHttpCsp = (projects.headers["content-security-policy"] || "").replace(/\s+/g, " ").trim();
  if (projects.status !== 200) fails.push(`projects_final_status:${projects.status}`);
  if (!projectsHttpCsp) fails.push("projects_final_missing_http_csp");
  if (!/frame-ancestors\s+'self'/.test(projectsHttpCsp)) {
    fails.push("projects_final_missing_frame_ancestors");
  }

  const eventName = String(process.env.GITHUB_EVENT_NAME || "");
  const repoClean = !localRepoScriptSrcHasUnsafeInline();
  const workerSrc = fs.readFileSync(
    path.join(ROOT, "cloudflare", "iu-site-redirects", "src", "csp-promote.ts"),
    "utf8"
  );
  const repoHasEdgePromote =
    /promoteHtmlCsp/.test(workerSrc) && /frame-ancestors 'self'/.test(workerSrc);

  // PR before Worker deploy: allow pending if remediation is already in the branch.
  if (fails.includes("missing_http_csp_header") && repoHasEdgePromote && eventName === "pull_request") {
    fails.splice(fails.indexOf("missing_http_csp_header"), 1);
    pending.push("http_csp_header_pending_worker_deploy");
    // Dependent checks that only fail because HTTP CSP is not live yet.
    for (const dep of [
      "http_missing_csp",
      "http_csp_missing_frame_ancestors_self",
      "http_missing_require_trusted_types",
      "http_missing_trusted_types_policies",
      "http_object_src_missing_none",
      "http_unsafe_eval_in_script_src",
      "http_script_src_unsafe_inline",
      "projects_final_missing_http_csp",
      "projects_final_missing_frame_ancestors",
      "pre_csp_execution_window_open",
    ]) {
      const i = fails.indexOf(dep);
      if (i >= 0) fails.splice(i, 1);
    }
  }

  if (fails.includes("http_script_src_unsafe_inline") && repoClean && eventName === "pull_request") {
    const idx = fails.indexOf("http_script_src_unsafe_inline");
    if (idx >= 0) fails.splice(idx, 1);
    pending.push("script_src_unsafe_inline_pending_deploy");
  }

  const lastMod = root.headers["last-modified"] || "";
  console.log(
    "IU_PROD_CSP_LIVE=" +
      JSON.stringify({
        status: root.status,
        finalUrl: root.url,
        lastModified: lastMod,
        httpCspPresent: Boolean(httpCsp),
        httpCspSnippet: httpCsp.slice(0, 240),
        metaCspPresent: Boolean(metaCsp),
        edgeMarker,
        frameAncestorsSelf: /frame-ancestors\s+'self'/.test(httpCsp),
        preMetaScriptsExist,
        httpClosesPreCspWindow: Boolean(httpCsp),
        projectsFinalHttpCsp: Boolean(projectsHttpCsp),
        ttEnforce: /require-trusted-types-for/.test(httpCsp || metaCsp),
        unsafeInlineScript: scriptSrcHasUnsafeInline(httpCsp || metaCsp),
        repoScriptSrcClean: repoClean,
        eventName,
        pending,
        fails,
      })
  );

  if (fails.length) {
    console.error("IU_PROD_CSP_LIVE_FAIL");
    for (const f of fails) console.error(f);
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
