#!/usr/bin/env node
/**
 * EXT-HDR-PERM-01 — semantic Permissions-Policy guard (repo + optional live).
 * Does not snapshot the full header string; asserts inventory-backed directives.
 */
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
const HEADERS = path.join(ROOT, "_headers");

const REQUIRED_DENY = [
  "camera=()",
  "microphone=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "hid=()",
  "clipboard-read=()",
  "browsing-topics=()",
  "interest-cohort=()",
];
const REQUIRED_ALLOW_SELF = ["geolocation=(self)"];
const FORBIDDEN_DENY = [
  "clipboard-write=()",
  "autoplay=()",
  "fullscreen=()",
  "geolocation=()",
];

const fails = [];

function parsePolicy(src) {
  const m = src.match(/PERMISSIONS_POLICY_VALUE\s*=\s*\[([\s\S]*?)\]\.join/);
  if (!m) return "";
  return m[1]
    .split("\n")
    .map((line) => {
      const q = line.match(/"([^"]+)"/);
      return q ? q[1] : "";
    })
    .filter(Boolean)
    .join(", ");
}

function assertPolicy(label, policy) {
  if (!policy) {
    fails.push(label + "_missing_policy");
    return;
  }
  const lower = policy.toLowerCase();
  for (const d of REQUIRED_DENY) {
    if (!lower.includes(d.toLowerCase())) fails.push(label + "_missing_" + d);
  }
  for (const d of REQUIRED_ALLOW_SELF) {
    if (!lower.includes(d.toLowerCase())) fails.push(label + "_missing_" + d);
  }
  for (const d of FORBIDDEN_DENY) {
    if (lower.includes(d.toLowerCase())) fails.push(label + "_forbidden_" + d);
  }
  const ppCount = (srcCount(label, policy));
  if (ppCount > 1) fails.push(label + "_duplicate_permissions_policy");
}

function srcCount(label, policy) {
  // single joined value expected
  return policy.split("geolocation=").length - 1 > 1 ? 2 : 1;
}

const promoteSrc = fs.readFileSync(PROMOTE, "utf8");
if (!/ensurePermissionsPolicy/.test(promoteSrc)) {
  fails.push("worker_missing_ensurePermissionsPolicy");
}
if (!/PERMISSIONS_POLICY_VALUE/.test(promoteSrc)) {
  fails.push("worker_missing_PERMISSIONS_POLICY_VALUE");
}
const workerPolicy = parsePolicy(promoteSrc);
assertPolicy("worker", workerPolicy);

const headersSrc = fs.readFileSync(HEADERS, "utf8");
const hdrMatches = [...headersSrc.matchAll(/^\s*Permissions-Policy:\s*(.+)$/gim)];
if (hdrMatches.length === 0) fails.push("headers_missing_permissions_policy");
if (hdrMatches.length > 1) fails.push("headers_duplicate_permissions_policy");
if (hdrMatches.length === 1) assertPolicy("headers", hdrMatches[0][1].trim());

console.log("IU_PERMISSIONS_POLICY_WORKER=" + workerPolicy);
if (hdrMatches[0]) console.log("IU_PERMISSIONS_POLICY_HEADERS=" + hdrMatches[0][1].trim());

const liveUrl = process.env.IU_PERM_POLICY_LIVE_URL || "";
if (liveUrl) {
  const res = await fetch(liveUrl, {
    method: "GET",
    redirect: "follow",
    headers: { "Cache-Control": "no-cache", "User-Agent": "iu-perm-policy-guard/1.0" },
  });
  const live = res.headers.get("permissions-policy") || "";
  console.log("IU_PERMISSIONS_POLICY_LIVE_STATUS=" + res.status);
  console.log("IU_PERMISSIONS_POLICY_LIVE=" + live);
  if (!live) fails.push("live_missing_permissions_policy");
  else assertPolicy("live", live);
  const all = [];
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() === "permissions-policy") all.push(v);
  });
  if (all.length > 1) fails.push("live_duplicate_permissions_policy");
}

if (fails.length) {
  console.error("IU_PERMISSIONS_POLICY_GUARD=FAIL");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("IU_PERMISSIONS_POLICY_GUARD=PASS");
process.exit(0);
