#!/usr/bin/env node
/** Guard: PDF visual color (bordó, graphical size). */
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
const color = /=== PDF_VISUAL_COLOR ===[\s\S]*?PASS=true/.test(out);
const notText = /=== PDF_NOT_TEXT_ONLY ===[\s\S]*?PASS=true/.test(out);
const magic = /=== PDF_MAGIC_BYTES ===[\s\S]*?PASS=true/.test(out);
console.log("=== invoice_pdf_visual_color_proof ===");
console.log("PDF_VISUAL_COLOR=" + (color ? "PASS" : "FAIL"));
console.log("PDF_NOT_TEXT_ONLY=" + (notText ? "PASS" : "FAIL"));
console.log("PDF_MAGIC_BYTES=" + (magic ? "PASS" : "FAIL"));
console.log("=== END invoice_pdf_visual_color_proof ===");
if (!color || !notText || !magic || r.status !== 0) process.exit(1);
process.exit(0);
