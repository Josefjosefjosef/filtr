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

must(/perf-loop-iter012-secondary-js-after-fcp-v1-20260820/.test(index), "marker");
must(/iuDeferSecondaryJsUntilFcp/.test(index), "activator");
must(/iuEnsureSecondaryJs/.test(index), "ensure");
must(
  /data-iu-defer-secondary-js="1"[^>]*data-iu-secondary-id="affiliate"[^>]*data-iu-src="[^"]*iu-affiliate-catalog\.js/.test(
    index
  ) ||
    /data-iu-secondary-id="affiliate"[^>]*data-iu-src="[^"]*iu-affiliate-catalog\.js/.test(index),
  "affiliate:data_src"
);
must(
  /data-iu-defer-secondary-js="1"[^>]*data-iu-secondary-id="privacy"[^>]*data-iu-src="[^"]*iu-tool-privacy-info\.js/.test(
    index
  ) ||
    /data-iu-secondary-id="privacy"[^>]*data-iu-src="[^"]*iu-tool-privacy-info\.js/.test(index),
  "privacy:data_src"
);
must(!/<script[^>]*\sdefer[^>]*\ssrc="[^"]*iu-affiliate-catalog\.js/.test(index), "affiliate:no_early_defer_src");
must(!/<script[^>]*\ssrc="[^"]*iu-affiliate-catalog\.js/.test(index), "affiliate:no_early_src");
must(!/<script[^>]*\ssrc="[^"]*iu-tool-privacy-info\.js/.test(index), "privacy:no_early_src");
must(!/<script[^>]*\ssrc="[^"]*iu-home-load-audit\.js/.test(index), "audit:no_early_src");
must(/iuHomeAudit=1/.test(index), "audit:opt_in");
must(/<script[^>]*\sdefer[^>]*\ssrc="[^"]*iu-silver-quick-panel\.js/.test(index), "silver_quick:stays_early");
must(/<script[^>]*\sdefer[^>]*\ssrc="[^"]*iu-info-center-lazy-mount\.js/.test(index), "icentrum_lazy:stays_early");

if (fails.length) {
  console.error("[iu-perf-loop-iter012-secondary-js-after-fcp-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter012-secondary-js-after-fcp-guard] PASS");
