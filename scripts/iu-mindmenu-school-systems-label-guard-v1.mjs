#!/usr/bin/env node
/**
 * MindMenu — Školní systémy public label contract (bakalari id preserved).
 * Run: node scripts/iu-mindmenu-school-systems-label-guard-v1.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function fail(m) {
  fails.push(m);
}
function ok(m) {
  console.log("PASS " + m);
}
function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

const index = read("projects/index.html");
const appJs = read("assets/app.js");
const css = read("assets/app.css");
const cssOverlay = read("assets/iu-custom-buttons-overlay.css");
const privacy = read("assets/iu-tool-privacy-info.js");
const feed = read("assets/iu-app-feed-pipeline-v1.js");
const backup = read("assets/iu-user-data-backup-core.js");

if (!/data-quicktool-id="bakalari"[\s\S]{0,500}Školní systémy/.test(index)) fail("tile_primary_missing");
else ok("tile_primary");
if (!/iuTileTextSecondary[\s\S]{0,80}Bakaláři, EduPage, Škola OnLine atd\./.test(index)) fail("tile_secondary_missing");
else ok("tile_secondary");
if (/aria-label="Bakaláři"/.test(index)) fail("tile_aria_old");
else ok("tile_aria_new");
if (/data-iuq="bakalari"[\s\S]{0,200}<span class="iuTileText">Bakaláři<\/span>/.test(index)) fail("tile_old_single_label");
else ok("tile_not_old_single");

if (!/bakalari:\s*"Školní systémy"/.test(appJs)) fail("app_title_missing");
else ok("app_title");
if ((appJs.match(/bakalari:\s*"Školní systémy"/g) || []).length < 2) fail("app_title_both_surfaces");
else ok("app_title_both_surfaces");
if (!/Otevřít školní systém/.test(appJs)) fail("open_btn_missing");
else ok("open_btn");
if (/Otevřít Bakaláře/.test(appJs)) fail("open_btn_old");
else ok("open_btn_old_gone");
if (!/Odkaz na školní systém/.test(appJs)) fail("url_label_missing");
else ok("url_label");
if (/Odkaz na Bakaláře/.test(appJs)) fail("url_label_old");
else ok("url_label_old_gone");

if (!/iu_bakalari_profiles/.test(appJs)) fail("storage_key_must_remain");
else ok("storage_key_preserved");
if (!/data-quicktool-id="bakalari"/.test(index) || !/data-iuq="bakalari"/.test(index)) fail("tile_ids_must_remain");
else ok("tile_ids_preserved");

if (!/iuTileText--stack/.test(cssOverlay) || !/iuTileTextSecondary/.test(cssOverlay)) fail("css_stack_missing");
else ok("css_stack");

if (!/Informace o soukromí — Školní systémy/.test(privacy)) fail("privacy_title");
else ok("privacy_title");
if (/provozovatelem systému Bakaláři/.test(privacy)) fail("privacy_exclusive_claim");
else ok("privacy_generalized");
if (!/školního informačního systému/.test(privacy) && !/školnímu informačnímu systému/.test(privacy)) {
  fail("privacy_school_system_wording");
} else ok("privacy_school_system_wording");

if (!/id:\s*"bakalari",\s*label:\s*"Školní systémy"/.test(feed)) fail("feed_registry_label");
else ok("feed_registry_label");
if (!/id:\s*"bakalari",\s*label:\s*"Školní systémy"[\s\S]{0,80}iu_bakalari_profiles/.test(backup)) {
  fail("backup_label_or_key");
} else ok("backup_label_key");

if (fails.length) {
  console.error("IU_MINDMENU_SCHOOL_SYSTEMS_LABEL_GUARD=FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("IU_MINDMENU_SCHOOL_SYSTEMS_LABEL_GUARD=PASS");
