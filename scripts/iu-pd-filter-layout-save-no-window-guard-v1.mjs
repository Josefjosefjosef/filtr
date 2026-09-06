#!/usr/bin/env node
/**
 * Contract guard: Přehled dne filter layout rename, traffic Uložit, no Nepřečtené, no 96h window UI.
 * Run: npm run iu-pd-filter-layout-save-no-window-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const feed = fs.readFileSync(path.join(ROOT, "assets", "iu-feed-filter-v1.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-v1.css"), "utf8");
const core = fs.readFileSync(path.join(ROOT, "assets", "iu-info-system-core-v1.js"), "utf8");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

must(!/Zobrazit vše/.test(feed), "labels:no_zobrazit_vse");
must(/Dopravní informace/.test(feed), "labels:dopravni_info");
must(/Výstrahy ČHMÚ/.test(feed), "labels:vystrahy_chmu");
must(!/btn\("all",\s*"Zobrazit vše"/.test(feed), "render:no_all_quick_btn");
must(/data-act="feed-quick-view"/.test(feed), "handlers:feed_quick_view_kept");
must(/data-view="\$\{escFeedHtml\(id\)\}"|data-view="/.test(feed) || /data-view="/.test(feed), "handlers:data_view_kept");

must(/iuPdQuickView--primary/.test(feed) && /iuPdQuickView--primary/.test(css), "css:primary_quick_view");
must(/--iu-pd-control-radius:\s*14px/.test(css), "css:control_radius_token");
must(/border-radius:\s*var\(--iu-pd-control-radius\)/.test(css), "css:primary_uses_control_radius");
must(
  /\.iuPd__hero\s+\.iuPdBtn--settings[\s\S]*?border-bottom-left-radius:\s*var\(--iu-pd-control-radius\)/.test(css) &&
    /\.iuPd__hero\s+\.iuPdBtn--settings[\s\S]*?border-bottom-right-radius:\s*var\(--iu-pd-control-radius\)/.test(css) &&
    /\.iuPd__hero\s+\.iuPdBtn--settings[\s\S]*?border-top-left-radius:\s*0/.test(css) &&
    /\.iuPd__hero\s+\.iuPdBtn--settings[\s\S]*?border-top-right-radius:\s*0/.test(css),
  "css:settings_bottom_radius_only"
);
must(/grid-template-columns:\s*repeat\(2,/.test(css), "css:quick_view_two_cols");
must(!/grid-template-columns:\s*repeat\(3,/.test(css), "css:no_quick_view_three_cols");

const shell = ui.match(/function homeShellHtml[\s\S]*?\n\}/);
must(!!shell, "shell:homeShellHtml");
if (shell) {
  const s = shell[0];
  const qi = s.indexOf("filterBar");
  const showi = s.indexOf('class="iuPd__show"');
  const counti = s.indexOf('id="iuPdCount"');
  must(qi >= 0 && showi > qi && counti > showi, "shell:order_quick_then_toggles_then_count");
  must(/data-mode="all"/.test(s) && />Vše</.test(s), "shell:bottom_vse");
  must(/data-mode="saved"/.test(s) && /Uložené/.test(s), "shell:ulozene");
  must(/data-mode="hidden"/.test(s) && /Skryté/.test(s), "shell:skryte");
  must(!/Nepřečtené/.test(s) && !/data-mode="unread"/.test(s), "shell:no_neprectene");
  must(!/okno 96/.test(s), "shell:no_window_label");
}

must(!/okno 96/.test(ui), "ui:no_okno_96_text");
must(/položek`/.test(ui) || /položek\$\{/.test(ui) || /položek/.test(ui), "ui:count_kept");

must(/data-act="traffic-follow"/.test(ui), "traffic:follow_handler_kept");
must(/Uložit/.test(ui) && /Uloženo/.test(ui), "traffic:ulozit_labels");
must(!/Sledovat|Sleduji/.test(ui), "traffic:no_sledovat_copy");
must(/isTrafficFollowed/.test(ui) && /mode === "saved"/.test(ui), "traffic:saved_includes_followed");

must(/viewMode === "all" \? "home" : "all"/.test(ui), "mode:special_vse_toggle_kept");
must(/prefsForMode/.test(ui), "mode:prefsForMode_kept");

must(!/96 \* 3600000/.test(core), "core:no_96h_age_kill");
must(/no fixed client publish-age window|lifecycle \/ future-publish/.test(core), "core:lifecycle_gate_kept");

if (fails.length) {
  console.error("[iu-pd-filter-layout-save-no-window-guard] FAIL");
  for (const f of fails) console.error(" -", f);
  process.exit(1);
}
console.log("[iu-pd-filter-layout-save-no-window-guard] PASS");
