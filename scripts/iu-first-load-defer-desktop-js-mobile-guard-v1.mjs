#!/usr/bin/env node
/**
 * FIRST LOAD: desktop rail/tool-window JS must not be classic defer on all viewports.
 * Info panel stays eager (powers mobile Rychlý přehled).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

must(/iuDeferDesktopJsUntilDesktop/.test(index), "index:activator");
must(/data-iu-desktop-js="1"/.test(index), "index:data_attr");
must(/defer-desktop-js-mobile-v1-20260822/.test(index), "index:cache_bust");
must(!/<script\s+defer\s+src="\/assets\/iu-desktop-section-close/.test(index), "index:no_classic_section_close_defer");
must(!/<script\s+defer\s+src="\/assets\/iu-desktop-left-rail/.test(index), "index:no_classic_left_rail_defer");
must(!/<script\s+defer\s+src="\/assets\/iu-desktop-tool-window/.test(index), "index:no_classic_tool_window_defer");
must(/data-iu-src="\/assets\/iu-desktop-section-close-v1\.js/.test(index), "index:section_close_src");
must(/data-iu-src="\/assets\/iu-desktop-left-rail-new-window-v1\.js/.test(index), "index:left_rail_src");
must(/data-iu-src="\/assets\/iu-desktop-tool-window-left-rail-v1\.js/.test(index), "index:tool_window_src");
must(
  /<script\s+type="module"\s+src="\/assets\/iu-desktop-info-panel\.js/.test(index),
  "index:info_panel_eager_module"
);
must(!/data-iu-src="\/assets\/iu-desktop-info-panel\.js/.test(index), "index:info_panel_not_deferred");
must(/min-width:\s*1025px/.test(index) && /iuDeferDesktopJsUntilDesktop/.test(index), "index:desktop_mq");

if (fails.length) {
  console.error("[iu-first-load-defer-desktop-js-mobile-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-first-load-defer-desktop-js-mobile-guard] PASS");
