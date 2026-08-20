#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const fails = [];
const must = (c, id) => {
  if (!c) fails.push(id);
};

must(/perf-loop-iter013-desktop-js-after-fcp-v1-20260820/.test(index), "marker");
must(/iuDeferDesktopJsUntilNeeded/.test(index), "activator");
must(/iuEnsureDesktopJs/.test(index), "ensure");
must(/data-iu-desktop-js="1"[^>]*data-iu-src="[^"]*iu-desktop-section-close-v1\.js/.test(index), "section_close:data_src");
must(/data-iu-desktop-js="1"[^>]*data-iu-src="[^"]*iu-desktop-left-rail-new-window-v1\.js/.test(index), "left_rail:data_src");
must(/data-iu-desktop-js="1"[^>]*data-iu-src="[^"]*iu-desktop-tool-window-left-rail-v1\.js/.test(index), "tool_window:data_src");
must(/<script[^>]*\stype="module"[^>]*\ssrc="[^"]*iu-desktop-info-panel\.js/.test(index), "info_panel:stays_early");
must(!/<script[^>]*\ssrc="[^"]*iu-desktop-section-close-v1\.js/.test(index), "section_close:no_early_src");
must(!/<script[^>]*\ssrc="[^"]*iu-desktop-left-rail-new-window-v1\.js/.test(index), "left_rail:no_early_src");
must(!/<script[^>]*\ssrc="[^"]*iu-desktop-tool-window-left-rail-v1\.js/.test(index), "tool_window:no_early_src");
must(/min-width:\s*1025px/.test(index) && /iuDeferDesktopJsUntilNeeded/.test(index), "desktop_mq");

if (fails.length) {
  console.error("[iu-perf-loop-iter013-desktop-js-after-fcp-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter013-desktop-js-after-fcp-guard] PASS");
