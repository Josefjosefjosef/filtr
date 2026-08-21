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

must(/perf-loop-iter015-prehled-banner-ui-after-fcp-v1-20260821/.test(index), "marker");
must(/iuDeferPrehledDneUiUntilFcp/.test(index), "defer_fn");
must(/iuEnsurePrehledDneUi/.test(index), "ensure_api");
must(/import\(SRC\)/.test(index) || /import\(/.test(index) && /iu-prehled-dne-ui-v1\.js/.test(index), "dynamic_import");
must(!/<link[^>]*rel="modulepreload"[^>]*iu-prehled-dne-ui-v1\.js/.test(index), "no_modulepreload");
must(!/<script[^>]*type="module"[^>]*src="[^"]*iu-prehled-dne-ui-v1\.js/.test(index), "no_early_module_src");
must(/infouzel-prehled-dne-banner\.webp"[^>]*media="\(min-width: 768px\)"/.test(index), "banner_preload_media");
must(/iuPd__bannerImg[^>]*fetchpriority="low"/.test(index), "banner_fetchpriority_low");
must(/iuPd__bannerImg[^>]*loading="lazy"/.test(index), "banner_loading_lazy");
/* Banner stays deferred; CHMI module may start in early head for first-real-card P0. */
must(/first-load-early-chmi-boot-v1-20260821/.test(index), "early_chmi_boot_marker");

if (fails.length) {
  console.error("[iu-perf-loop-iter015-prehled-banner-ui-after-fcp-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter015-prehled-banner-ui-after-fcp-guard] PASS");
