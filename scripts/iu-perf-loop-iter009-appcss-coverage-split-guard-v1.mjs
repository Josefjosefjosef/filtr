#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const must = (c, id) => { if (!c) fails.push(id); };
const index = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "assets/app.css"), "utf8");
must(fs.existsSync(path.join(ROOT, "assets/iu-app-deferred.css")), "deferred:exists");
must(fs.existsSync(path.join(ROOT, "assets/iu-app-desktop.css")), "desktop:exists");
must(/iu-app-deferred\.css/.test(index) && /data-iu-defer-overlay-css="1"/.test(index), "index:deferred_link");
must(/iu-app-desktop\.css[^>]*media="\(min-width: 1025px\)"/.test(index), "index:desktop_mq");
must(/perf-loop-iter009-appcss-coverage-split-v1-20260820/.test(index), "marker");
must(app.length < 400000, "appcss:shrunken:" + app.length);
must(/CALENDAR ACCENT HARD LOCK/.test(app), "appcss:calendar_lock");
must(/mindMenu \.iu-mmTopTool--cal\.iuMindMenuButton/.test(app), "appcss:mm_cal_btn");
must(/iu-mindmenu-bottom-nav-restore-v1\.css[^>]*data-iu-defer-overlay-css="1"/.test(index), "defer:bottom_nav_restore");
must(/iu-overlay-mobile-tablet-unified-v1\.css[^>]*data-iu-defer-overlay-css="1"/.test(index), "defer:overlay_unified");
if (fails.length) { console.error("[iu-perf-loop-iter009-appcss-coverage-split-guard] FAIL"); for (const id of fails) console.error(" - " + id); process.exit(1); }
console.log("[iu-perf-loop-iter009-appcss-coverage-split-guard] PASS");
console.log("APP_CSS_BYTES=" + app.length);
