#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function expect(name, cond, detail) {
  if (!cond) fails.push({ name, detail: detail || null });
  else console.log("PASS " + name);
}

const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const staticCat = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json"), "utf8")
);
const proof = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-atomic-swap-public-v16.json"), "utf8")
);
const lock = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-public-swap-lock-v16.json"), "utf8")
);

expect("armed_static", staticCat.publicButtonSwapArmed === true && staticCat.liveEnabled === true);
expect("no_browser_api", staticCat.browserCjApiDependency === false);
expect("catalog_js_armed", /IU_AFF_PUBLIC_SWAP_ARMED\s*=\s*true/.test(catalogJs));
expect("static_loader", /function applyStaticMainCatalogV13/.test(catalogJs));
expect("boot_static", /loadStaticMainCatalogV13/.test(catalogJs));
expect("proof_ok", proof.ok === true && proof.PUBLIC_SWAP === "ARMED_AND_VERIFIED");
expect("lock_applied", lock.state === "APPLIED");

const parsed = parseAffiliateCatalogOrdered(catalogJs);
let cj = 0;
const seen = new Set();
let dups = 0;
for (const s of parsed.sections || []) {
  for (const it of s.items || []) {
    if (!it.url) continue;
    if (!isCjTrackingUrl(it.url)) continue;
    cj += 1;
    const id = it.advertiserId ? String(it.advertiserId) : "";
    if (id) {
      if (seen.has(id)) dups += 1;
      else seen.add(id);
    }
  }
}
expect("baked_equals_static", cj === staticCat.counts.buttons, { cj, static: staticCat.counts.buttons });
expect("no_dups", dups === 0, dups);
expect("paragon_blocked", (staticCat.remainingBlockers || []).some((b) => String(b.advertiserId) === "4686326"));
expect("rel_sponsored", /rel="sponsored noopener"/.test(catalogJs));

if (fails.length) {
  console.error(JSON.stringify({ ok: false, fails }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, cj, buttons: staticCat.counts.buttons, joined: staticCat.counts.joined }, null, 2));
