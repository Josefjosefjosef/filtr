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

must(/first-load-app-css-nonblocking-v1-20260821/.test(index), "marker");
must(/data-iu-defer-app-css="1"/.test(index), "defer_attr");
must(/rel="preload"\s+as="style"[^>]*app\.css/.test(index) || /rel="preload" as="style" href="\/assets\/app\.css/.test(index), "preload_style");
must(/media="print"[^>]*data-iu-defer-app-css="1"|data-iu-defer-app-css="1"[^>]*media="print"/.test(index), "print_media");
must(/onload="this\.media='all'/.test(index), "onload_swap");
must(/<noscript>\s*<link rel="stylesheet" href="\/assets\/app\.css/.test(index), "noscript_fallback");
// Must not leave a classic render-blocking app.css without media=print (except noscript)
const withoutNoscript = index.replace(/<noscript>[\s\S]*?<\/noscript>/gi, "");
const blocking = [...withoutNoscript.matchAll(/<link\s+rel="stylesheet"\s+href="\/assets\/app\.css[^"]*"[^>]*>/g)].map((m) => m[0]);
for (const tag of blocking) {
  if (!/media=/.test(tag)) fails.push("blocking_app_css_without_media:" + tag.slice(0, 80));
}

if (fails.length) {
  console.error("[iu-first-load-app-css-nonblocking-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-first-load-app-css-nonblocking-guard] PASS");
