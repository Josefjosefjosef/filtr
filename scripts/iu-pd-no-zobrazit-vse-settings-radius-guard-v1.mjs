#!/usr/bin/env node
/**
 * Guard: Přehled dne — no "Zobrazit vše"; Nastavení bottom radius matches primary controls.
 * Static contract (stable). Runtime geometry covered by iu-prehled-dne-settings-v6-guard + this static lock.
 * Run: npm run iu-pd-no-zobrazit-vse-settings-radius-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feed = fs.readFileSync(path.join(ROOT, "assets", "iu-feed-filter-v1.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-v1.css"), "utf8");
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

must(!/Zobrazit vše/.test(feed), "labels:no_zobrazit_vse");
must(!/btn\(\s*"all"\s*,\s*"Zobrazit vše"/.test(feed), "render:no_all_quick_btn");
must(/Dopravní informace/.test(feed), "labels:dopravni_info");
must(/Výstrahy ČHMÚ/.test(feed), "labels:vystrahy_chmu");
must(/data-act="feed-quick-view"/.test(feed), "handlers:feed_quick_view_kept");
must(/data-act="open-settings"/.test(ui) && /iuPdBtn--settings/.test(ui), "ui:settings_cta");
must(/data-mode="all"/.test(ui) && /data-mode="saved"/.test(ui) && /data-mode="hidden"/.test(ui), "ui:show_toggles_kept");

must(/--iu-pd-control-radius:\s*14px/.test(css), "css:control_radius_token");
must(
  /\.iuPdQuickView--primary\s+\.iuPdQuickView__btn[\s\S]{0,200}border-radius:\s*var\(--iu-pd-control-radius\)/.test(css),
  "css:primary_uses_control_radius"
);
must(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(css), "css:quick_view_two_cols");
must(!/grid-template-columns:\s*repeat\(3,/.test(css), "css:no_quick_view_three_cols");

must(
  /\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[^}]*border-top-left-radius:\s*0/.test(css) &&
    /\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[^}]*border-top-right-radius:\s*0/.test(css),
  "css:settings_top_square"
);
must(
  /\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[^}]*border-bottom-left-radius:\s*var\(--iu-pd-control-radius\)/.test(css) &&
    /\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[^}]*border-bottom-right-radius:\s*var\(--iu-pd-control-radius\)/.test(css),
  "css:settings_bottom_control_radius"
);
must(!/\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[^}]*border-bottom-left-radius:\s*999px/.test(css), "css:no_pill_settings_bottom");

if (fails.length) {
  console.error("[iu-pd-no-zobrazit-vse-settings-radius-guard] FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("[iu-pd-no-zobrazit-vse-settings-radius-guard] PASS");
