#!/usr/bin/env node
/**
 * V25 — CJ affiliate link attrs + chip title wrap (≤2 lines) gates.
 * Static/source proofs only (no live publish, no checkpoint mutation).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(detail ? `${id}:${detail}` : id);
  else console.log("PASS", id);
}

const appCss = fs.readFileSync(path.join(ROOT, "assets", "app.css"), "utf8");
const chipsCss = fs.readFileSync(
  path.join(ROOT, "assets", "iu-affiliate-phase3z-partner-chips-v1.css"),
  "utf8"
);
const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const offersJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-phase2-offers-v1.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const staticCatalog = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json"), "utf8")
);
const phase3h = fs.readFileSync(
  path.join(ROOT, "scripts", "iu-cj-affiliate-phase3h-coverage-reconcile-v1-selftest.mjs"),
  "utf8"
);
const registryYml = fs.readFileSync(
  path.join(ROOT, ".github", "workflows", "cj-affiliate-phase3z-partner-registry.yml"),
  "utf8"
);

ok(
  "app_css_scoped_line_clamp",
  /#iuAffiliateView a\.iuAffiliateChip \.iuRadioChipTitle[\s\S]{0,400}-webkit-line-clamp:\s*2/.test(appCss)
);
ok(
  "app_css_white_space_normal",
  /#iuAffiliateView a\.iuAffiliateChip \.iuRadioChipTitle[\s\S]{0,500}white-space:\s*normal/.test(appCss)
);
ok(
  "app_css_no_global_chip_clamp",
  !/(^|\n)\.iuRadioChipTitle\s*\{[\s\S]{0,200}-webkit-line-clamp:\s*2/.test(appCss)
);
ok(
  "phase3z_css_line_clamp",
  /\.iuAffiliateSection\[data-iu-phase3z-chips="1"\][\s\S]{0,500}-webkit-line-clamp:\s*2/.test(chipsCss)
);
ok(
  "catalog_chip_target_blank",
  /target="_blank"\s+rel="sponsored noopener"/.test(catalogJs) ||
    /rel="sponsored noopener"[\s\S]{0,80}target="_blank"/.test(catalogJs) ||
    /target="_blank"[\s\S]{0,120}rel="sponsored noopener"/.test(catalogJs)
);
ok("catalog_chip_title_attr", /title="'\s*\+\s*escapeHtml\(titleText\)/.test(catalogJs));
ok("catalog_chip_aria_label", /aria-label="'\s*\+\s*escapeHtml\(titleText\)/.test(catalogJs));
ok("catalog_disclosure_present", /IU_AFFILIATE_DISCLOSURE_TEXT\s*=/.test(catalogJs));
ok(
  "offers_sponsored",
  (offersJs.match(/rel="sponsored noopener"/g) || []).length >= 3
);
ok(
  "cache_bust_css_wrap",
  /app\.css\?v=[^"]*affiliate-chip-title-wrap-v1-20261102/.test(indexHtml)
);
ok(
  "cache_bust_catalog_v25",
  /iu-affiliate-catalog\.js\?v=cj-phase3z-v25-links-wrap-2026-11-02/.test(indexHtml)
);
ok("phase3h_novakid_catalog_match", /novakid_catalog_match/.test(phase3h));
ok("phase3h_no_stale_false_match", !/novakid_no_false_match/.test(phase3h));
ok(
  "registry_ready_assert_gated",
  /verify_on and verify_limit == "0"/.test(registryYml) ||
    /verify_on and verify_limit == '0'/.test(registryYml)
);

const buttons = Array.isArray(staticCatalog.buttons) ? staticCatalog.buttons : [];
ok("static_buttons_present", buttons.length >= 175, String(buttons.length));
const urls = buttons.map((b) => String(b.url || ""));
const cjHostOk = /^(www\.)?(kqzyfj|anrdoezrs|tkqlhce|dpbolvw|jdoqocy|ftjcfx|lduhtrp|tqlkg|qksrv|pntra|gopjn|pjtra|pntrac|pjatr|pntrs)\.(com|net)$/i;
const badUrls = [];
for (const u of urls) {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:" || !cjHostOk.test(parsed.host) || !/\/click-\d+-\d+/.test(parsed.pathname)) {
      badUrls.push(u);
    }
  } catch {
    badUrls.push(u);
  }
}
ok("static_urls_cj_click", badUrls.length === 0, badUrls.slice(0, 5).join("|"));
const ids = buttons.map((b) => String(b.advertiserId || ""));
ok("no_duplicate_advertiser_ids", new Set(ids).size === ids.length, String(ids.length - new Set(ids).size));
ok(
  "paragon_hold",
  (staticCatalog.remainingBlockers || []).some((b) => String(b.advertiserId) === "4686326")
);

const h = spawnSync(process.execPath, [path.join(ROOT, "scripts/iu-cj-affiliate-phase3h-coverage-reconcile-v1-selftest.mjs")], {
  encoding: "utf8",
  cwd: ROOT,
});
ok("phase3h_selftest", (h.status ?? 1) === 0, `code=${h.status}`);

const out = {
  ok: fails.length === 0,
  fails,
  suite: "v25-links-wrap-e2e",
  buttonCount: buttons.length,
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exitCode = 1;
