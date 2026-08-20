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

must(/perf-loop-iter010-overlay-css-after-fcp-v1-20260820/.test(index), "marker");
must(/iuDeferOverlayCssUntilFcp/.test(index), "activator");
must(/data-iu-href="[^"]*iu-invoice-overlay\.css/.test(index), "invoice:data_href");
must(!/<link[^>]*\shref="[^"]*iu-invoice-overlay\.css/.test(index), "invoice:no_early_href");
must(/data-iu-href="[^"]*iu-myinfouzel-premium-overlay\.css/.test(index), "icentrum:data_href");
must(/href="[^"]*app\.css[^"]*"/.test(index), "appcss:stays_blocking");
must(/href="[^"]*iu-prehled-dne-v1\.css[^"]*"/.test(index), "prehled:stays_blocking");
must(/href="[^"]*iu-silver-parcel-dashboard\.css[^"]*"\s*\/>/.test(index), "parcel:stays_blocking");
must(/iuEnsureOverlayCss=function\(frag\)[\s\S]*data-iu-href/.test(index), "ensure:sets_href");

if (fails.length) {
  console.error("[iu-perf-loop-iter010-overlay-css-after-fcp-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter010-overlay-css-after-fcp-guard] PASS");
