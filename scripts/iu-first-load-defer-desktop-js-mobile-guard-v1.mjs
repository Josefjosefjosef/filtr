#!/usr/bin/env node
/**
 * FIRST LOAD: desktop-only JS must not be classic defer/module on all viewports.
 * Mobile first-screen bandwidth must not compete with desktop rail/info-panel scripts.
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
must(!/<script\s+defer\s+src="\/assets\/iu-desktop-/.test(index), "index:no_classic_desktop_defer");
must(
  !/<script\s+type="module"\s+src="\/assets\/iu-desktop-info-panel\.js/.test(index),
  "index:no_eager_desktop_info_panel_module"
);
must(/data-iu-src="\/assets\/iu-desktop-section-close-v1\.js/.test(index), "index:section_close_src");
must(/data-iu-src="\/assets\/iu-desktop-info-panel\.js/.test(index), "index:info_panel_src");
must(/min-width:\s*1025px/.test(index) && /iuDeferDesktopJsUntilDesktop/.test(index), "index:desktop_mq");

if (fails.length) {
  console.error("[iu-first-load-defer-desktop-js-mobile-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-first-load-defer-desktop-js-mobile-guard] PASS");
