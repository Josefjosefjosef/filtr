#!/usr/bin/env node
/**
 * V17: prove 101/74 was audit false-negative (.com-only host regex),
 * all baked partners are CJ via authoritative isCjTrackingUrl,
 * Paragon remains JOINED-without-button.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { evaluateArmedCatalogHealth } from "./guards/iu-affiliate-v16-armed-catalog-health-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function expect(name, cond, detail) {
  if (!cond) fails.push({ name, detail: detail || null });
  else console.log("PASS " + name);
}

/** Broken V16 TEMP audit classifier — required .com only (missed .net). */
function brokenComOnlyClassifier(url) {
  return (
    /click-\d+-\d+/i.test(String(url || "")) &&
    /(jdoqocy|dpbolvw|anrdoezrs|tkqlhce|kqzyfj|ftjcfx|pjtra|qksrv)\.com/i.test(String(url || ""))
  );
}

const catalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const staticCat = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json"), "utf8")
);

const partnerRe =
  /affPartner\(\s*"([^"]+)"\s*,\s*"(https:[^"]+)"\s*(?:,\s*"(\d+)")?\s*\)/g;
const partners = [];
let m;
while ((m = partnerRe.exec(catalog))) {
  partners.push({ title: m[1], href: m[2], advertiserId: m[3] || null });
}

let authCj = 0;
let brokenCj = 0;
let brokenNonCj = 0;
const falseNeg = [];
for (const p of partners) {
  const auth = isCjTrackingUrl(p.href);
  const broken = brokenComOnlyClassifier(p.href);
  if (auth) authCj += 1;
  if (broken) brokenCj += 1;
  else {
    brokenNonCj += 1;
    falseNeg.push(p);
  }
}

expect("partner_count_175", partners.length === 175, partners.length);
expect("auth_classifier_all_cj", authCj === partners.length, { authCj, n: partners.length });
expect("broken_split_101_74", brokenCj === 101 && brokenNonCj === 74, {
  brokenCj,
  brokenNonCj,
});
expect(
  "false_neg_only_net_hosts",
  falseNeg.every((p) => /\.net\//i.test(p.href)),
  falseNeg.slice(0, 3)
);
expect("static_buttons_175", staticCat.counts.buttons === 175);
expect("static_joined_176", staticCat.counts.joined === 176);
expect(
  "paragon_blocker",
  (staticCat.remainingBlockers || []).some((b) => String(b.advertiserId) === "4686326")
);
expect("paragon_not_button", !partners.some((p) => p.advertiserId === "4686326"));
expect("no_paragon_in_catalog_js_text_as_partner", !/affPartner\([^)]*4686326/.test(catalog));

const health = evaluateArmedCatalogHealth(ROOT, { guardName: "V17_SELFTEST" });
expect("armed_health_ok", health.armed && health.ok, health.report);

// Explain paragonBlocked=false from V16 TEMP script: it checked catalog.js for 4686326,
// but Paragon is only in JSON remainingBlockers — absence in catalog.js is correct.
const paragonInCatalogJs = /4686326/.test(catalog);
expect("paragon_absent_from_catalog_js", paragonInCatalogJs === false);
expect(
  "paragon_present_in_static_json",
  JSON.stringify(staticCat).includes("4686326")
);

if (fails.length) {
  console.error(JSON.stringify({ ok: false, fails }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      explanation:
        "V16 DOM audit used a .com-only host regex; 74 CJ deep links on anrdoezrs.net/dpbolvw.net were false NON_CJ. Authoritative isCjTrackingUrl accepts .(com|net). All 175 baked buttons are CJ. Paragon 4686326 is JOINED without button (remainingBlockers).",
      partners: partners.length,
      authoritativeCj: authCj,
      brokenComOnlyCj: brokenCj,
      brokenComOnlyFalseNonCj: brokenNonCj,
      joined: staticCat.counts.joined,
      buttons: staticCat.counts.buttons,
      paragon: {
        inCatalogJs: false,
        inRemainingBlockers: true,
        status: "UNSUITABLE_CUSTOMER_DESTINATION",
        publishedButton: false,
      },
    },
    null,
    2
  )
);
