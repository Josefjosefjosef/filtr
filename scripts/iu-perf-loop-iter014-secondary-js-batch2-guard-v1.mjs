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

must(/perf-loop-iter014-secondary-js-batch2-v1-20260820/.test(index), "marker");
must(/data-iu-secondary-id="crash-shield"[^>]*data-iu-src="[^"]*app-crash-shield\.js/.test(index), "crash:data_src");
must(/data-iu-secondary-id="analytics"[^>]*data-iu-src="[^"]*iu-analytics-client\.js/.test(index), "analytics:data_src");
must(/data-iu-secondary-id="ads"[^>]*data-iu-src="[^"]*iu-ads-public-v1\.js/.test(index), "ads:data_src");
must(/data-iu-secondary-id="install-box"[^>]*data-iu-src="[^"]*iu-home-premium-install-box\.js/.test(index), "install:data_src");
must(!/<script[^>]*\ssrc="[^"]*app-crash-shield\.js/.test(index), "crash:no_early_src");
must(!/<script[^>]*\ssrc="[^"]*iu-analytics-client\.js/.test(index), "analytics:no_early_src");
must(!/<script[^>]*\ssrc="[^"]*iu-ads-public-v1\.js/.test(index), "ads:no_early_src");
must(!/<script[^>]*\ssrc="[^"]*iu-home-premium-install-box\.js/.test(index), "install:no_early_src");
must(/iuEnsureSecondaryJs\("crash-shield"\)/.test(index), "idle:crash");
must(/iuEnsureSecondaryJs\("analytics"\)/.test(index), "idle:analytics");
must(/<script[^>]*\sdefer[^>]*\ssrc="[^"]*iu-consent\.js/.test(index), "consent:stays_early");
must(/<script[^>]*\sdefer[^>]*\ssrc="[^"]*iu-network-connectivity-v1\.js/.test(index), "network:stays_early");

if (fails.length) {
  console.error("[iu-perf-loop-iter014-secondary-js-batch2-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter014-secondary-js-batch2-guard] PASS");
