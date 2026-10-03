#!/usr/bin/env node
/**
 * Premium public display: hide empty slots, sales panel, compact active order.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const js = read("assets/iu-premium-selected-services-v1.js");
const css = read("assets/iu-premium-selected-services-v1.css");
const displayTs = read("cloudflare/iu-ads/src/premium-display.ts");
const publicTs = read("cloudflare/iu-ads/src/public-premium-selected.ts");

ok("js:sales_link", js.includes("Chci zde mít vlastní tlačítko"));
ok("js:sales_panel", js.includes("iuPremiumSalesPanel"));
ok("js:active_only_public", js.includes("iuPremiumSlot--sold") && !js.includes("buildFreeSlot"));
ok("js:aria_expanded", js.includes("aria-expanded"));
ok("css:sales_link", css.includes(".iuPremiumSalesLink"));
ok("display:display_rank", displayTs.includes("assignPremiumDisplayRanks"));
ok("public:sale_state", publicTs.includes("sale_state"));
ok("public:display_rank", publicTs.includes("assignPremiumDisplayRanks"));

if (fails.length) {
  console.error("FAIL iu-premium-display-compaction-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-display-compaction-guard-v1");
