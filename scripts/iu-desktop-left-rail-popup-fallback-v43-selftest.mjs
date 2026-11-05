#!/usr/bin/env node
/**
 * V43 — when window.open is blocked, left-rail tool handler must return false
 * so app.js can persistNavState / mount affiliate in-page (first-click).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(
  path.join(ROOT, "assets", "iu-desktop-left-rail-new-window-v1.js"),
  "utf8"
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(src.includes("showTabBlockedNotice"), "notice helper present");
assert(
  /if\s*\(\s*!tab\s*\)\s*\{[\s\S]*?showTabBlockedNotice\(\);\s*return false;/.test(src),
  "blocked popup must return false"
);
assert(!/if\s*\(\s*!tab\s*\)\s*\{[\s\S]*?showTabBlockedNotice\(\);\s*return true;/.test(src), "must not return true when blocked");

console.log(
  JSON.stringify({
    IU_DESKTOP_LEFT_RAIL_POPUP_FALLBACK_V43_SELFTEST: "PASS",
    fix: "openToolTab returns false when window.open blocked → in-page aff-* mount",
  })
);
