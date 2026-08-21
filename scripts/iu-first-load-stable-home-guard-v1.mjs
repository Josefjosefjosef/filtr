#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-v1.css"), "utf8");
const fails = [];
const must = (c, id) => {
  if (!c) fails.push(id);
};

must(/first-load-stable-home-v1-20260821/.test(index), "marker");
must(/data-iu-pd-feed-skeleton="1"/.test(index), "skeleton_attr");
must(/iuPdFeedSkeleton__row/.test(index), "skeleton_rows");
must(/min-height:\s*520px/.test(index) || /min-height:\s*520px/.test(css), "feed_min_height");
must(/iuEnsurePrehledDneUi\(\)/.test(index), "ensure_call");
/* FIRST LOAD: start when #iuPrehledDneRoot is parsed (not full DCL / idle). afterFcp is optional legacy. */
must(
  /afterFcp\(function\(\)\{\s*\/\* FIRST LOAD[\s\S]*?iuEnsurePrehledDneUi\(\);/.test(index) ||
    /afterFcp\(function\(\)\{\s*window\.iuEnsurePrehledDneUi\(\);/.test(index) ||
    (/getElementById\("iuPrehledDneRoot"\)/.test(index) &&
      /startChmiBoot|iuEnsurePrehledDneUi\(\)/.test(index) &&
      /first-load-early-chmi-boot-v1-20260821/.test(index)),
  "immediate_after_fcp_or_root_ready"
);
must(!/afterFcp\(function\(\)\{\s*function go\(\)\{window\.iuEnsurePrehledDneUi\(\);\}[\s\S]*requestIdleCallback/.test(index), "no_idle_delay");
must(
  (() => {
    const parcel = index.indexOf('id="iuSilverParcelWatch"');
    const root = index.indexOf('id="iuPrehledDneRoot"');
    return parcel > 0 && root > 0 && parcel < root;
  })(),
  "product_order_parcel_before_prehled"
);

if (fails.length) {
  console.error("[iu-first-load-stable-home-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-first-load-stable-home-guard] PASS");
