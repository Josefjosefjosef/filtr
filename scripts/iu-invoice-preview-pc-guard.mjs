#!/usr/bin/env node
/**
 * Guard: invoice preview portal must stack above MyInfoUzel overlays on PC.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const moduleJs = fs.readFileSync(path.join(root, "assets", "iu-invoice-module.js"), "utf8");
const overlayCss = fs.readFileSync(path.join(root, "assets", "iu-invoice-overlay.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "projects", "index.html"), "utf8");

const checks = [
  moduleJs.includes("applyPreviewPortalOpenStyles"),
  moduleJs.includes('layer.style.setProperty("z-index", "12250", "important")'),
  moduleJs.includes('data-preview-open", "1")'),
  overlayCss.includes("z-index: 12250 !important"),
  overlayCss.includes("body.iu-myinfouzel-open #iuInvoicePreviewPortal"),
  overlayCss.includes("body.iu-invoice-preview-open #iuInvoicePanel.iu-invoice-overlay-panel:not([hidden])"),
  indexHtml.includes("invoice-preview-pc-v1-20260708"),
];

const pass = checks.every(Boolean);
process.stdout.write(JSON.stringify({ pass, failedCount: checks.filter((c) => !c).length }) + "\n");
if (!pass) process.exit(1);
