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

must(/perf-loop-iter011-desktop-css-after-fcp-v1-20260820/.test(index), "marker");
must(/iuDeferDesktopCssUntilNeeded/.test(index), "activator");
must(/data-iu-desktop-css="1"/.test(index), "desktop_attr");
must(/data-iu-href="[^"]*iu-desktop-home-premium\.css/.test(index), "home_premium:data_href");
must(!/\shref="[^"]*iu-desktop-home-premium\.css/.test(index), "home_premium:no_early_href");
must(/href="[^"]*app\.css[^"]*"/.test(index), "appcss:stays_blocking");
must(/href="[^"]*iu-prehled-dne-v1\.css[^"]*"/.test(index), "prehled:stays_blocking");

if (fails.length) {
  console.error("[iu-perf-loop-iter011-desktop-css-after-fcp-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter011-desktop-css-after-fcp-guard] PASS");
