#!/usr/bin/env node
/** Writes reference-like invoice PDF/PNG to %TEMP% (no repo artifacts). */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(os.tmpdir(), "iu_invoice_visual_proof_" + Date.now());
fs.mkdirSync(outDir, { recursive: true });

execFileSync(
  "npm",
  ["test", "--prefix", path.join(root, "cloudflare", "iu-ads"), "--", "test/premium-invoice-visual-proof.test.ts"],
  {
    env: { ...process.env, IU_INVOICE_VISUAL_OUT: outDir },
    stdio: "inherit",
    shell: process.platform === "win32",
  }
);

const pdf = path.join(outDir, "invoice-reference-like.pdf");
const png = path.join(outDir, "invoice-reference-like.png");
console.log("VISUAL_LAYOUT_SPEC_PASS=" + (fs.existsSync(pdf) ? "true" : "false"));
console.log("VISUAL_PNG_EXPORT=" + (fs.existsSync(png) ? "true" : "false"));
console.log("VISUAL_OUT_DIR=" + outDir);
process.exit(fs.existsSync(pdf) ? 0 : 1);
