#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(repoRoot, "assets", "iu-affiliate-phase2-offers-v1.js"), "utf8");
const css = fs.readFileSync(path.join(repoRoot, "assets", "iu-affiliate-phase2-offers-v1.css"), "utf8");

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

expect("localhost_gate", js.includes("isLocalDevHost"));
expect("copy_coupon", js.includes("Kopírovat kód"));
expect("partner_name", js.includes("partnerName"));
expect("conditions", js.includes("conditionsSummary"));
expect("product_image", js.includes("iuAffiliatePhase2Offers__img"));
expect("show_more", js.includes("Zobrazit další"));
expect("no_prod_bypass", js.includes("public_stub_no_staging_data"));
expect("dark_mode_css", css.includes("prefers-color-scheme: dark"));
expect("responsive_grid", css.includes("max-width: 767px"));

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_OFFERS_PREVIEW_UI_SELFTEST: ok ? "OK" : "FAIL",
    failures,
  })
);
process.exit(ok ? 0 : 1);
