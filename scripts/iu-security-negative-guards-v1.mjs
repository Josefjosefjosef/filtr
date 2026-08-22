#!/usr/bin/env node
/**
 * Fail-state selftests: guards must detect intentional violations (no repo mutation).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isProtectedStorageKey } from "../assets/iu-vault-protected-keys-v1.js";
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

function detectRawEventsName(html) {
  const fnStart = html.indexOf("function updateEventsUI()");
  if (fnStart < 0) return true;
  const fnSlice = html.slice(fnStart, fnStart + 1200);
  return /\$\{item\.name\}/.test(fnSlice);
}

function detectPassthroughTrustedTypes(src) {
  return /createHTML\s*:\s*(?:function\s*\([^)]*\)\s*\{?\s*return\s+\w+|input\s*=>\s*input)/.test(src);
}

function detectBareUnsafeEval(csp) {
  return csp.replace(/wasm-unsafe-eval/g, "").includes("unsafe-eval");
}

t("xss_guard_fails_on_raw_item_name", () => {
  const bad = 'function updateEventsUI() { el.innerHTML = `${item.name}`; }';
  if (!detectRawEventsName(bad)) throw new Error("detector missed violation");
  const good = 'function updateEventsUI() { el.innerHTML = escapeHtml(String(item.name)); }';
  if (detectRawEventsName(good)) throw new Error("detector false positive");
});

t("plaintext_key_protection", () => {
  if (!isProtectedStorageKey("iu.notes.store.v1")) throw new Error("notes not protected");
  if (isProtectedStorageKey("iu:local-data-protection:notice-accepted:v1")) {
    throw new Error("consent key must not be protected");
  }
});

t("pin_trivial_reject", () => {
  if (!isTrivialPin("123456")) throw new Error("sequential pin must fail");
  if (isTrivialPin("847291")) throw new Error("valid pin rejected");
});

t("trusted_types_no_passthrough_policy", () => {
  const tt = fs.readFileSync(path.join(ROOT, "assets", "iu-trusted-types-v1.js"), "utf8");
  if (detectPassthroughTrustedTypes(tt)) throw new Error("passthrough createHTML found");
});

t("csp_no_bare_unsafe_eval", () => {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const headers = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");
  const csp = (index.match(/Content-Security-Policy[^>]*content="([^"]+)"/i) || [])[1] || "";
  const headerCsp = (headers.match(/Content-Security-Policy:\s*(.+)/i) || [])[1] || "";
  if (detectBareUnsafeEval(csp)) throw new Error("meta csp has unsafe-eval");
  if (detectBareUnsafeEval(headerCsp)) throw new Error("_headers csp has unsafe-eval");
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

if (fails.length) {
  console.error("IU_SECURITY_NEGATIVE_GUARDS_FAIL");
  process.exit(1);
}
console.log("IU_SECURITY_NEGATIVE_GUARDS_PASS");
