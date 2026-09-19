#!/usr/bin/env node
/**
 * Dump Cloudflare /zones/{id}/dnssec JSON from stdin.
 * Prints DNSSEC_* and REGISTRAR_* lines for registrar copy-paste.
 * Usage: curl .../dnssec | node scripts/iu-dnssec-cf-dump-v1.mjs
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(0, "utf8");
let d;
try {
  d = JSON.parse(raw);
} catch (e) {
  console.log("SUCCESS=", false);
  console.log("ERRORS=", [{ message: "invalid_json", detail: String(e && e.message) }]);
  process.exit(1);
}

console.log("SUCCESS=", d.success);
console.log("ERRORS=", JSON.stringify(d.errors || []));
const r = d.result || {};
for (const k of Object.keys(r).sort()) {
  console.log("DNSSEC_" + k.toUpperCase() + "=", r[k]);
}
for (const k of [
  "status",
  "flags",
  "algorithm",
  "key_tag",
  "digest_type",
  "digest",
  "ds",
  "public_key",
]) {
  if (Object.prototype.hasOwnProperty.call(r, k) && r[k] != null) {
    console.log("REGISTRAR_" + k.toUpperCase() + "=", r[k]);
  }
}
