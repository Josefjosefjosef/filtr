#!/usr/bin/env node
/**
 * IU_CRITICAL_HOME_ASSETS_GUARD — critical homepage graphics contract.
 * Forensic 2026-09-12: Trusted Types stripped <picture>, PNG 1MB became critical path,
 * static banner was lazy/low. Guard locks the fixed contract.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const must = (c, id) => {
  if (!c) fails.push(id);
};

const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const tt = fs.readFileSync(path.join(ROOT, "assets", "iu-trusted-types-v1.js"), "utf8");

must(/PICTURE:\s*1/.test(tt), "tt_allows_picture");
must(/SOURCE:\s*1/.test(tt), "tt_allows_source");
must(/SOURCE:\s*\{\s*type:\s*1,\s*srcset:\s*1/.test(tt), "tt_source_attrs");
must(/fetchpriority:\s*1/.test(tt), "tt_img_fetchpriority");
must(/isSafeSrcset/.test(tt), "tt_srcset_validator");

must(/iuPd__bannerImg[^>]*src="\/assets\/images\/infouzel-prehled-dne-banner\.webp"/.test(index), "index_banner_webp");
must(!/iuPd__bannerImg[^>]*src="\/assets\/images\/infouzel-prehled-dne-banner\.png"/.test(index), "index_banner_no_png_src");
must(/iuPd__bannerImg[^>]*fetchpriority="high"/.test(index), "index_banner_fp_high");
must(/iuPd__bannerImg[^>]*loading="eager"/.test(index), "index_banner_eager");
must(/<picture>[\s\S]*?infouzel-prehled-dne-banner\.webp[\s\S]*?<\/picture>/.test(index), "index_banner_picture");

must(/infouzel-prehled-dne-banner\.webp/.test(ui) && /function bannerHtml/.test(ui), "ui_banner_webp");
must(!/bannerHtml[\s\S]{0,400}infouzel-prehled-dne-banner\.png/.test(ui), "ui_banner_no_png_src");
must(/fetchpriority="high" loading="eager"/.test(ui), "ui_banner_eager_high");

must(/iu-security-tt-picture-banner-v1-20260912/.test(index), "tt_cache_bust");
must(fs.existsSync(path.join(ROOT, "assets", "images", "infouzel-prehled-dne-banner.webp")), "webp_exists");

if (fails.length) {
  console.error("[IU_CRITICAL_HOME_ASSETS_GUARD] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[IU_CRITICAL_HOME_ASSETS_GUARD] PASS");
