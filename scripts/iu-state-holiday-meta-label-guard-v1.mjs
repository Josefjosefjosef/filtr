#!/usr/bin/env node
/**
 * Státní svátek vs jmeniny — popisek v #iuSilverWelcomeMeta (státní svátek: / svátek má).
 * Run: npm run iu-state-holiday-meta-label-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(REPO, "assets", "app.js");
const INDEX = path.join(REPO, "projects", "index.html");
const JS_BUST = "state-holiday-meta-label-v1-20260706";

function staticGate() {
  const app = fs.readFileSync(APP, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");

  const welcomeChunk = app.split("function iuSilverWelcomeInit")[1] || "";
  const welcomeMetaChunk = welcomeChunk.split("function iuSilverMobileStackFitInit")[0] || welcomeChunk.slice(0, 12000);

  const checks = [
    {
      id: "state_holiday_detector",
      pass: /function iuIsCzechStateHolidayDisplayName\(/.test(app),
    },
    {
      id: "meta_label_prefix_helper",
      pass: /function iuNamedayMetaLabelPrefix\(/.test(app),
    },
    {
      id: "hus_in_state_set",
      pass: /Upálení mistra Jana Husa/.test(app),
    },
    {
      id: "welcome_uses_dynamic_label",
      pass: /svatekLabel\.textContent = iuNamedayMetaLabelPrefix\(namePart\)/.test(app),
    },
    {
      id: "welcome_no_hardcoded_svatek_ma_label",
      pass: !/svatekLabel\.textContent = "sv\\u00E1tek m\\u00E1"/.test(welcomeMetaChunk),
    },
    {
      id: "parse_state_holiday_prefix",
      pass: /státní\\s\+svátek\\s\*:\\s\*\(\.\+\)/.test(app),
    },
    {
      id: "topbar_line_helper",
      pass: /function iuNamedayTopbarLine\(/.test(app),
    },
    {
      id: "daily_panel_uses_topbar_line",
      pass: /elNameday\.textContent = iuNamedayTopbarLine\(nm\)/.test(app),
    },
    {
      id: "index_app_cache_bust",
      pass: new RegExp(`app\\.js\\?v=${JS_BUST}`).test(index),
    },
  ];

  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
}

function main() {
  const result = staticGate();
  if (!result.pass) {
    console.log("IU_STATE_HOLIDAY_META_LABEL_GUARD_FAIL");
    result.fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("IU_STATE_HOLIDAY_META_LABEL_GUARD_PASS");
}

main();
