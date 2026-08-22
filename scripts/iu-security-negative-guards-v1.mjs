#!/usr/bin/env node
/**
 * Fail-state selftests: guards must detect intentional violations (no repo mutation).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isProtectedStorageKey, listProtectedExactKeys } from "../assets/iu-vault-protected-keys-v1.js";
import { isTrivialPin } from "../assets/iu-vault-core-v1.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function t(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    fails.push(`${name}: ${e.message || e}`);
    console.log(`FAIL ${name}: ${e.message || e}`);
  }
}

function extractCsp(html) {
  const m = html.match(/Content-Security-Policy[^>]*content\s*=\s*["']([\s\S]*?)["']\s*\/?>/i);
  return m ? m[1].replace(/\s+/g, " ") : "";
}

function detectRawEventsName(html) {
  const fnStart = html.indexOf("function updateEventsUI()");
  if (fnStart < 0) return true;
  const fnSlice = html.slice(fnStart, fnStart + 1200);
  return /\$\{item\.name\}/.test(fnSlice);
}

function detectPassthroughTrustedTypes(src) {
  return /createHTML\s*:\s*(?:function\s*\([^)]*\)\s*\{?\s*return\s+\w+;?\s*\}|input\s*=>\s*input)/.test(src);
}

function detectBareUnsafeEval(csp) {
  return csp.replace(/wasm-unsafe-eval/g, "").includes("unsafe-eval");
}

function detectBlockedHtml(html) {
  return /<\s*script\b/i.test(html) || /\bon\w+\s*=/i.test(html) || /javascript\s*:/i.test(html);
}

t("xss_guard_fails_on_raw_item_name", () => {
  const bad = 'function updateEventsUI() { el.innerHTML = `${item.name}`; }';
  if (!detectRawEventsName(bad)) throw new Error("detector missed violation");
  const good = 'function updateEventsUI() { el.innerHTML = escapeHtml(String(item.name)); }';
  if (detectRawEventsName(good)) throw new Error("detector false positive");
});

t("tt_sanitize_blocks_script_tag", () => {
  const tt = fs.readFileSync(path.join(ROOT, "assets", "iu-trusted-types-v1.js"), "utf8");
  if (!/IU_TT_HTML_BLOCKED/.test(tt)) throw new Error("missing block marker");
  if (detectBlockedHtml('<script>alert(1)</script>') !== true) throw new Error("detector broken");
});

t("plaintext_key_protection", () => {
  const keys = [
    "iu.notes.store.v1",
    "iu.tasks.mvp.v1",
    "iu_invoice_form_state_v1",
    "infouzel_datovka_profiles_v1",
    "iu_bakalari_profiles",
    "iu_health_insurance_v2",
    "iuShoppingLastListV1",
    "iu_user_address",
  ];
  for (const k of keys) {
    if (!isProtectedStorageKey(k)) throw new Error(`unprotected:${k}`);
  }
  if (isProtectedStorageKey("iu:local-data-protection:notice-accepted:v1")) {
    throw new Error("consent key must not be protected");
  }
});

t("module_defs_keys_protected", () => {
  const exact = listProtectedExactKeys();
  if (exact.length < 10) throw new Error("too few protected keys");
});

t("pin_trivial_reject", () => {
  if (!isTrivialPin("123456")) throw new Error("sequential pin must fail");
  if (!isTrivialPin("111111")) throw new Error("repeated pin must fail");
  if (isTrivialPin("847291")) throw new Error("valid pin rejected");
});

t("trusted_types_no_passthrough_policy", () => {
  const tt = fs.readFileSync(path.join(ROOT, "assets", "iu-trusted-types-v1.js"), "utf8");
  if (detectPassthroughTrustedTypes(tt)) throw new Error("passthrough createHTML found");
});

t("csp_no_bare_unsafe_eval", () => {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const headers = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");
  const csp = extractCsp(index);
  const headerCsp = (headers.match(/Content-Security-Policy:\s*(.+)/i) || [])[1] || "";
  if (detectBareUnsafeEval(csp)) throw new Error("meta csp has unsafe-eval");
  if (detectBareUnsafeEval(headerCsp)) throw new Error("_headers csp has unsafe-eval");
});

t("csp_require_trusted_types", () => {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const csp = extractCsp(index);
  if (!/require-trusted-types-for\s+'script'/.test(csp)) throw new Error("missing TT enforcement");
});

t("csp_script_src_no_https_wildcard", () => {
  const csp = extractCsp(fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8"));
  if (/script-src[^;]*\bhttps:\b/.test(csp)) throw new Error("script https wildcard");
});

t("vault_assets_no_eval", () => {
  const vaultFiles = fs
    .readdirSync(path.join(ROOT, "assets"))
    .filter((f) => f.startsWith("iu-vault-") && f.endsWith(".js"));
  for (const f of vaultFiles) {
    const src = fs.readFileSync(path.join(ROOT, "assets", f), "utf8");
    if (/\beval\s*\(/.test(src)) throw new Error(`${f} contains eval()`);
    if (/new\s+Function\s*\(/.test(src)) throw new Error(`${f} contains new Function()`);
  }
});

t("analytics_client_no_pii_keys", () => {
  const client = fs.readFileSync(path.join(ROOT, "assets", "iu-analytics-client.js"), "utf8");
  if (/localStorage\.setItem\([^)]*password/i.test(client)) throw new Error("analytics stores password");
  if (/sendBeacon\([^)]*notes\.store/i.test(client)) throw new Error("analytics sends notes");
});

t("csp_no_script_unsafe_inline", () => {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const csp = extractCsp(index);
  if (/'unsafe-inline'/.test((csp.match(/script-src\s+([^;]+)/i) || [])[1] || "")) {
    throw new Error("script-src still has unsafe-inline");
  }
});

t("device_seed_v1_format", () => {
  const device = fs.readFileSync(path.join(ROOT, "assets", "iu-vault-device-crypto-v1.js"), "utf8");
  if (!/seed-v1/.test(device)) throw new Error("missing seed-v1");
  if (!/wrappedSeed/.test(device)) throw new Error("missing wrappedSeed");
});

t("negative_unsafe_inline_detector", () => {
  const bad = "script-src 'self' 'unsafe-inline'";
  if (!/'unsafe-inline'/.test(bad)) throw new Error("detector broken");
  const good = "script-src 'self' 'sha256-abc'";
  if (/'unsafe-inline'/.test(good)) throw new Error("false positive");
});

if (fails.length) {
  console.error("IU_SECURITY_NEGATIVE_GUARDS_FAIL");
  process.exit(1);
}
console.log("IU_SECURITY_NEGATIVE_GUARDS_PASS");
