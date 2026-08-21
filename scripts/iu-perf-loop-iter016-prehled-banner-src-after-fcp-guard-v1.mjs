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

must(/perf-loop-iter016-prehled-banner-src-after-fcp-v1-20260821/.test(index), "marker");
must(/iuDeferPrehledBannerUntilFcp/.test(index), "defer_fn");
must(/iuEnsurePrehledBanner/.test(index), "ensure_api");
must(/data-iu-banner-src=/.test(index), "data_src");
must(/data-iu-banner-srcset=/.test(index), "data_srcset");
must(!/<source[^>]*\ssrcset="\/assets\/images\/infouzel-prehled-dne-banner\.webp"/.test(index), "no_early_webp_srcset");

if (fails.length) {
  console.error("[iu-perf-loop-iter016-prehled-banner-src-after-fcp-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter016-prehled-banner-src-after-fcp-guard] PASS");
