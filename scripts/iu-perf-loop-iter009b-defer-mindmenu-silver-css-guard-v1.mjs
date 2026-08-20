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

must(/perf-loop-iter009b-defer-mindmenu-silver-css-v1-20260820/.test(index), "marker");

const mustDefer = [
  "iu-mindmenu-mobile-tablet-v61.css",
  "iu-mindmenu-bottom-nav-restore-v1.css",
  "iu-overlay-mobile-tablet-unified-v1.css",
];
for (const f of mustDefer) {
  const re = new RegExp(
    `href="[^"]*${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*"[^>]*data-iu-defer-overlay-css="1"`
  );
  must(re.test(index), "defer:" + f);
}

must(/href="[^"]*iu-silver-parcel-dashboard\.css[^"]*"\s*\/>/.test(index), "parcel:stays_blocking");
must(!/iu-silver-parcel-dashboard\.css[^>]*data-iu-defer-overlay-css/.test(index), "parcel:not_deferred");
must(/href="[^"]*iu-silver-finance-home-card\.css[^"]*"\s*\/>/.test(index), "finance:stays_blocking");
must(/href="[^"]*iu-home-premium-install-box\.css[^"]*"\s*\/>/.test(index), "install:stays_blocking");
must(/href="[^"]*app\.css[^"]*"\s*\/>/.test(index), "appcss:stays_blocking");
must(/href="[^"]*iu-prehled-dne-v1\.css[^"]*"\s*\/>/.test(index), "prehled:stays_blocking");
must(/href="[^"]*iu-silver-premium-draft\.css[^"]*"\s*\/>/.test(index), "silver_draft:stays_blocking");
must(!/iu-app-deferred\.css/.test(index), "no_coverage_split_deferred");
must(!/iu-app-desktop\.css/.test(index), "no_coverage_split_desktop");

if (fails.length) {
  console.error("[iu-perf-loop-iter009b-defer-mindmenu-silver-css-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter009b-defer-mindmenu-silver-css-guard] PASS");
