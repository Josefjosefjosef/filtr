#!/usr/bin/env node
/**
 * Guard: Silver welcome / topbar must use „státní svátek:“ on CZ state holidays,
 * „svátek má“ on regular namedays only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppRuntimeSrc } from "./guards/iu-app-runtime-src.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appJs = readAppRuntimeSrc(root);
const indexHtml = fs.readFileSync(path.join(root, "projects", "index.html"), "utf8");

const IU_CZ_FIXED_STATE_HOLIDAYS = new Set([
  "01-01", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26",
]);

function pad(n) {
  return String(n).padStart(2, "0");
}

function getEasterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function toDateOnly(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateOnly(d);
}

function isHoliday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const mmdd = pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  if (IU_CZ_FIXED_STATE_HOLIDAYS.has(mmdd)) return true;
  const year = d.getFullYear();
  const easter = toDateOnly(getEasterDate(year));
  return dateStr === addDays(easter, -2) || dateStr === addDays(easter, 1);
}

function metaPrefixForDate(dateStr) {
  return isHoliday(dateStr) ? "státní svátek: " : "svátek má ";
}

function metaLabelShortForDate(dateStr) {
  return isHoliday(dateStr) ? "státní svátek:" : "svátek má";
}

const sourceChecks = [
  appJs.includes("function iuIsCzStateHolidayDate(refDate)"),
  appJs.includes("function iuNamedayMetaLabelPrefix(refDate)"),
  appJs.includes("function iuNamedayMetaLabelShort(refDate)"),
  appJs.includes("window.__iuIsCzStateHolidayDate = iuIsCzStateHolidayDate"),
  appJs.includes("svatekLabel.textContent = iuNamedayMetaLabelShort(refDate)"),
  appJs.includes("iuNamedayMetaLabelPrefix(d)"),
  appJs.includes("iuNamedayTopbarLabelPrefix(new Date())"),
  appJs.includes("státní\\s+svátek:\\s*(.+)"),
  !/svatekLabel\.textContent\s*=\s*"sv\\u00E1tek m\\u00E1"/.test(appJs),
  indexHtml.includes("state-holiday-label-v1-20260706") ||
  indexHtml.includes("svatek-pill-inline-layout-v1-20260707") ||
  indexHtml.includes("ds-mobile-scroll-bottom-clearance-v1-20260707") ||
  indexHtml.includes("legal-docs-hub-header-single-row-v1-20260707") ||
  indexHtml.includes("desktop-left-rail-section-close-v1-20260707") ||
  indexHtml.includes("bakalari-card-count-persist-v1-20260707"),
];

const stateHolidayDates2026 = [
  "2026-01-01",
  "2026-04-03",
  "2026-04-06",
  "2026-05-01",
  "2026-05-08",
  "2026-07-05",
  "2026-07-06",
  "2026-09-28",
  "2026-10-28",
  "2026-11-17",
  "2026-12-24",
  "2026-12-25",
  "2026-12-26",
];

const namedayDates2026 = ["2026-08-24", "2026-03-15"];

const dateChecks = [
  ...stateHolidayDates2026.map((ds) => metaPrefixForDate(ds) === "státní svátek: "),
  ...stateHolidayDates2026.map((ds) => metaLabelShortForDate(ds) === "státní svátek:"),
  ...namedayDates2026.map((ds) => metaPrefixForDate(ds) === "svátek má "),
  ...namedayDates2026.map((ds) => metaLabelShortForDate(ds) === "svátek má"),
];

const pass = sourceChecks.every(Boolean) && dateChecks.every(Boolean);

process.stdout.write(
  JSON.stringify({
    pass,
    sourceFailed: sourceChecks.filter((c) => !c).length,
    dateFailed: dateChecks.filter((c) => !c).length,
    goodFriday2026: addDays(toDateOnly(getEasterDate(2026)), -2),
    easterMonday2026: addDays(toDateOnly(getEasterDate(2026)), 1),
  }) + "\n"
);

if (!pass) process.exit(1);
