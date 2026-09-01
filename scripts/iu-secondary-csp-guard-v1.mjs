#!/usr/bin/env node
/**
 * EXT-CSP-SECONDARY-01 — semantic guard for secondary HTML CSP + hash drift.
 * Also re-checks Permissions-Policy constants remain intact.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMOTE = path.join(
  ROOT,
  "cloudflare",
  "iu-site-redirects",
  "src",
  "csp-promote.ts"
);
const OFFLINE = path.join(ROOT, "offline.html");
const ZDROJE = path.join(ROOT, "projects", "zdroje-a-licence", "index.html");

const fails = [];

function sha256B64(s) {
  return "sha256-" + crypto.createHash("sha256").update(s, "utf8").digest("base64");
}

function extractShaConst(src, name) {
  const m = src.match(new RegExp('export const ' + name + '\\s*=\\s*"([^"]+)"'));
  return m ? m[1] : "";
}

const promoteSrc = fs.readFileSync(PROMOTE, "utf8");
if (!/IU_CSP_SECONDARY_EDGE_MARKER/.test(promoteSrc)) {
  fails.push("missing_secondary_edge_marker");
}
if (!/secondaryCspForPath/.test(promoteSrc)) {
  fails.push("missing_secondaryCspForPath");
}
if (!/pathname === "\/offline.html"/.test(promoteSrc)) {
  fails.push("offline_path_not_in_html_document_paths");
}

const offlineHashConst = extractShaConst(promoteSrc, "OFFLINE_INLINE_SCRIPT_SHA256");
const zlHashConst = extractShaConst(promoteSrc, "ZDROJE_INLINE_MODULE_SHA256");
const offlineHtml = fs.readFileSync(OFFLINE, "utf8");
const offOpen = offlineHtml.indexOf("<script>");
const offClose = offlineHtml.indexOf("</script>", offOpen);
const offlineBody = offlineHtml.slice(offOpen + "<script>".length, offClose);
const offlineActual = sha256B64(offlineBody);
if (!offlineHashConst) fails.push("offline_hash_const_missing");
if (offlineHashConst !== offlineActual) {
  fails.push(
    "offline_script_hash_drift expected=" +
      offlineHashConst +
      " actual=" +
      offlineActual
  );
}

const zlHtml = fs.readFileSync(ZDROJE, "utf8");
const zlOpenTag = '<script type="module">';
const zlOpen = zlHtml.indexOf(zlOpenTag);
const zlClose = zlHtml.indexOf("</script>", zlOpen);
const zlBody = zlHtml.slice(zlOpen + zlOpenTag.length, zlClose);
const zlActual = sha256B64(zlBody);
if (!zlHashConst) fails.push("zdroje_hash_const_missing");
if (zlHashConst !== zlActual) {
  fails.push(
    "zdroje_script_hash_drift expected=" + zlHashConst + " actual=" + zlActual
  );
}

if (!/export const CSP_OFFLINE_HTML/.test(promoteSrc)) fails.push("missing_CSP_OFFLINE_HTML");
if (!/export const CSP_BOT_HTML/.test(promoteSrc)) fails.push("missing_CSP_BOT_HTML");
if (!/export const CSP_ZDROJE_HTML/.test(promoteSrc)) fails.push("missing_CSP_ZDROJE_HTML");
if (!/OFFLINE_INLINE_SCRIPT_SHA256/.test(promoteSrc)) {
  fails.push("offline_csp_missing_hash_ref");
}
if (!/ZDROJE_INLINE_MODULE_SHA256/.test(promoteSrc)) {
  fails.push("zdroje_csp_missing_hash_ref");
}
if (!/script-src 'self'/.test(promoteSrc)) fails.push("bot_missing_script_src_self");
if (!/"object-src 'none'"/.test(promoteSrc)) fails.push("missing_object_src_none");

if (!/PERMISSIONS_POLICY_VALUE/.test(promoteSrc)) {
  fails.push("permissions_policy_missing");
}
if (!/geolocation=\(self\)/.test(promoteSrc)) {
  fails.push("permissions_policy_geo_self_missing");
}

console.log("IU_SECONDARY_CSP_OFFLINE_HASH=" + offlineActual);
console.log("IU_SECONDARY_CSP_ZDROJE_HASH=" + zlActual);

const live = process.env.IU_SECONDARY_CSP_LIVE_URL || "";
if (live) {
  const paths = ["/offline.html", "/bot/", "/zdroje-a-licence/", "/"];
  for (const p of paths) {
    const url = new URL(p, live).toString();
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "Cache-Control": "no-cache", "User-Agent": "iu-secondary-csp-guard/1.0" },
    });
    const csp = res.headers.get("content-security-policy") || "";
    const edge = res.headers.get("x-iu-csp-edge") || "";
    const ct = res.headers.get("content-type") || "";
    console.log(
      "LIVE " +
        p +
        " status=" +
        res.status +
        " edge=" +
        edge +
        " csp=" +
        (csp ? "YES" : "NO")
    );
    if (!/text\/html/i.test(ct)) {
      fails.push("live_" + p + "_not_html");
      continue;
    }
    if (!csp) fails.push("live_" + p + "_missing_csp");
    if (p === "/offline.html" || p === "/bot/" || p === "/zdroje-a-licence/") {
      if (edge !== "secondary-v1") fails.push("live_" + p + "_bad_edge_marker");
      if (/script-src[^;]*'unsafe-inline'/.test(csp)) {
        fails.push("live_" + p + "_unsafe_inline");
      }
    }
    if (p === "/") {
      if (edge !== "meta-promoted-v1") fails.push("live_root_bad_edge_marker");
      if (!/require-trusted-types-for/.test(csp)) {
        fails.push("live_root_missing_tt");
      }
    }
  }
  for (const p of ["/sw.js", "/manifest.json"]) {
    const url = new URL(p, live).toString();
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "Cache-Control": "no-cache", "User-Agent": "iu-secondary-csp-guard/1.0" },
    });
    const csp = res.headers.get("content-security-policy");
    const edge = res.headers.get("x-iu-csp-edge");
    console.log(
      "LIVE_NONHTML " + p + " csp=" + JSON.stringify(csp) + " edge=" + JSON.stringify(edge)
    );
    if (csp) fails.push("live_nonhtml_" + p + "_unexpected_csp");
    if (edge) fails.push("live_nonhtml_" + p + "_unexpected_edge");
  }
}

if (fails.length) {
  console.error("IU_SECONDARY_CSP_GUARD=FAIL");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("IU_SECONDARY_CSP_GUARD=PASS");
process.exit(0);
