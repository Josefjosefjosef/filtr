#!/usr/bin/env node
/** Guard: iOS/Android mobile download + second-tap flow. */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const main = path.join(__dirname, "invoice_pdf_real_export_proof.mjs");
const appUrl = process.argv[2] || "";
const args = [main];
if (appUrl) args.push(appUrl);

const r = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const out = (r.stdout || "") + (r.stderr || "");
const ios = /=== IOS_OPEN_OR_SECOND_TAP_FLOW ===[\s\S]*?PASS=true/.test(out);
const dl = /=== DOWNLOAD_USER_FLOW ===[\s\S]*?PASS=true/.test(out);
const and = /=== ANDROID_DOWNLOAD_FLOW ===[\s\S]*?PASS=true/.test(out);
console.log("=== invoice_pdf_mobile_click_flow_proof ===");
console.log("IOS_OPEN_OR_SECOND_TAP_FLOW=" + (ios ? "PASS" : "FAIL"));
console.log("DOWNLOAD_USER_FLOW=" + (dl ? "PASS" : "FAIL"));
console.log("ANDROID_DOWNLOAD_FLOW=" + (and ? "PASS" : "FAIL"));
console.log("=== END invoice_pdf_mobile_click_flow_proof ===");
if (!ios || !dl || !and || r.status !== 0) process.exit(1);
process.exit(0);
