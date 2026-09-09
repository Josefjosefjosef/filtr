#!/usr/bin/env node
/**
 * Desktop CSS before first paint (cold-start FOUC fix).
 * Historically deferred after FCP; that caused PC layout jumps. Now requires early href
 * with media=(min-width:1025px) so desktop paints correctly without waiting for FCP.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const homePremium = fs.readFileSync(
  path.join(ROOT, "assets", "iu-desktop-home-premium.css"),
  "utf8"
);
const fails = [];
const must = (c, id) => {
  if (!c) fails.push(id);
};

must(/desktop-css-before-paint-v1-20260909/.test(index), "marker");
must(/iuDeferDesktopCssUntilNeeded/.test(index), "activator");
must(/data-iu-desktop-css="1"/.test(index), "desktop_attr");
must(
  /href="[^"]*iu-desktop-home-premium\.css[^"]*"[^>]*data-iu-desktop-css="1"|data-iu-desktop-css="1"[^>]*href="[^"]*iu-desktop-home-premium\.css/.test(
    index
  ),
  "home_premium:early_href"
);
must(
  /href="[^"]*iu-desktop-home-premium\.css[^"]*"[^>]*media="\(min-width:\s*1025px\)"|media="\(min-width:\s*1025px\)"[^>]*href="[^"]*iu-desktop-home-premium\.css/.test(
    index
  ),
  "home_premium:desktop_media"
);
{
  const start = index.indexOf("(function iuDeferDesktopCssUntilNeeded");
  const end = index.indexOf("(function iuDeferOverlayCssUntilFcp", start);
  const body = start >= 0 ? index.slice(start, end > start ? end : start + 2500) : "";
  must(body.length > 0, "activator_body");
  must(!/afterFcp\s*\(\s*activate\s*\)/.test(body), "no_after_fcp_activate");
  must(/\bactivate\s*\(\s*\)\s*;/.test(body), "immediate_activate");
}
must(/href="[^"]*app\.css[^"]*"/.test(index), "appcss:present");
must(/href="[^"]*iu-prehled-dne-v1\.css[^"]*"/.test(index), "prehled:stays_blocking");
must(
  !/body\.iu-desktop-home-grid\s+#newsList\s*>\s+#iuCenterStage\s*\{\s*opacity:\s*0/.test(homePremium),
  "home_premium:no_center_opacity_hide"
);
must(
  /body\.iu-desktop-home-grid\[data-iu-fc="1"\]\s*\{\s*--iu-dhp-center-stage-mt:\s*1140px/.test(homePremium),
  "home_premium:default_center_mt"
);

if (fails.length) {
  console.error("[iu-perf-loop-iter011-desktop-css-after-fcp-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter011-desktop-css-after-fcp-guard] PASS");
