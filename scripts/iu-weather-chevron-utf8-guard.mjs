#!/usr/bin/env node
/**
 * Guard: Silver/weather chevron action indicator must use UTF-8 escape, not mojibake.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appCss = fs.readFileSync(path.join(root, "assets", "app.css"), "utf8");
const appJs = fs.readFileSync(path.join(root, "assets", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "projects", "index.html"), "utf8");

const checks = [
  appCss.includes('content: "\\2197"'),
  !appCss.includes('content: "â†'),
  appJs.includes("iuWeatherBootPrefetchIfReady"),
  appJs.includes("removeAttribute(\"data-iu-action-indicator\")"),
  appJs.includes("fetch/render immediately when Počasí section opens"),
  indexHtml.includes("weather-artifact-utf8-eager-boot-v1-20260706") ||
  indexHtml.includes("state-holiday-label-v1-20260706") ||
  indexHtml.includes("ds-mobile-scroll-bottom-clearance-v1-20260707") ||
  indexHtml.includes("legal-docs-hub-header-single-row-v1-20260707"),
];

const pass = checks.every(Boolean);
process.stdout.write(JSON.stringify({ pass, failedCount: checks.filter((c) => !c).length }) + "\n");
if (!pass) process.exit(1);
