/**
 * Guard — desktop right rail partner banners (Resistance + IAF) must stay removed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const failures = [];
const indexHtml = read("projects/index.html");
const railCss = read("assets/iu-desktop-right-rail-cards.css");

const bannedIds = [
  "iuDesktopRightRailPartnerResistance",
  "iuDesktopRightRailPartnerIaf",
];

for (const id of bannedIds) {
  if (indexHtml.includes(`id="${id}"`)) {
    failures.push(`index.html must not contain #${id}`);
  }
}

const bannedPatterns = [
  "partner-resistance-security-right-rail",
  "partner-iaf-petr-ondrus",
  "iu-desktop-right-rail-partner",
  "data-iaf-fallback-active",
];

for (const pattern of bannedPatterns) {
  if (indexHtml.includes(pattern)) {
    failures.push(`index.html must not reference ${pattern}`);
  }
  if (railCss.includes(pattern)) {
    failures.push(`iu-desktop-right-rail-cards.css must not reference ${pattern}`);
  }
}

if (!indexHtml.includes('id="iuDesktopInvoiceBanner"')) {
  failures.push("invoice banner (#iuDesktopInvoiceBanner) must remain");
}
if (!indexHtml.includes("remove-partner-banners-v1-20260706")) {
  failures.push("index.html cache bust token missing");
}

const pass = failures.length === 0;
process.stdout.write(JSON.stringify({ pass, failures }) + "\n");
if (!pass) process.exitCode = 1;
