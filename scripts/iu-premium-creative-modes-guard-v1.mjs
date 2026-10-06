#!/usr/bin/env node
/**
 * Five premium creative modes + shared render bundle sync.
 * Run: node scripts/iu-premium-creative-modes-guard-v1.mjs
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

const modeTs = read("cloudflare/iu-ads/src/premium-creative-mode.ts");
const renderTs = read("cloudflare/iu-ads/src/premium-creative-render.ts");
const renderJs = read("assets/iu-premium-creative-render-v1.js");
const inlineTs = read("cloudflare/iu-ads/src/premium-creative-render-inline.ts");
const liveJs = read("assets/iu-premium-selected-services-v1.js");
const publicOrder = read("cloudflare/iu-ads/src/public-premium-order.ts");

const modes = ["logo", "image_small", "image_medium", "image_large", "full_bleed_banner"];
for (const m of modes) {
  ok("mode_ts_" + m, modeTs.includes('"' + m + '"'));
  ok("render_js_" + m, renderJs.includes(m));
}

ok("public_order_five_modes", /PREMIUM_CREATIVE_MODE_SET/.test(publicOrder));
ok("inline_bundle_no_fs", !/node:fs/.test(inlineTs));
ok("inline_matches_asset", inlineTs.includes("iuPremiumCreativeRender") && renderJs.includes("iuPremiumCreativeRender"));
ok("live_js_bind", /bindPremiumCreativeImage/.test(liveJs));
ok("render_fractions", /0\.25/.test(modeTs) && /0\.75/.test(modeTs));

if (fails.length) {
  console.error("FAIL iu-premium-creative-modes-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-creative-modes-guard-v1");
