#!/usr/bin/env node
/**
 * Mobile/tablet/PWA: Kalendář+Úkoly under Silver collapse + local persistence.
 *
 * Guards:
 * - default collapsed (no expanded attr / FOUC early LS boot)
 * - toggle control on Silver bottom edge
 * - localStorage key iu.infoCards.expanded.v1
 * - collapsed zeros layout height (no CLS leftover)
 * - desktop ≥1024 hides toggle / does not collapse cards
 * - calendar/tasks summary inits still present (visibility-only change)
 *
 * Run: npm run iu-silver-info-cards-collapse-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
const FEED = fs.readFileSync(
  path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"),
  "utf8"
);
const APP_JS = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

ok(
  "EARLY_BOOT_SCRIPT",
  /__iuInfoCardsExpandedEarlyBoot/.test(INDEX) &&
    /iu\.infoCards\.expanded\.v1/.test(INDEX) &&
    /data-iu-info-cards-expanded/.test(INDEX),
  "missing early FOUC boot"
);

ok(
  "CRITICAL_COLLAPSE_CSS",
  /iuInfoCardsCollapseCriticalCss/.test(INDEX) &&
    /html:not\(\[data-iu-info-cards-expanded="1"\]\)[\s\S]{0,220}#iuInfoCardsMobileTablet[\s\S]{0,120}display:\s*none\s*!important/.test(
      INDEX
    ),
  "collapsed display:none missing"
);

ok(
  "POST_APP_COLLAPSE_ZERO_HEIGHT",
  /iuInfoCardsMobileTabletPostAppCss/.test(INDEX) &&
    /html:not\(\[data-iu-info-cards-expanded="1"\]\)[\s\S]{0,200}#iuInfoCardsMobileTablet[\s\S]{0,160}min-height:\s*0\s*!important/.test(
      INDEX
    ),
  "post-app zero height missing"
);

ok(
  "TOGGLE_BUTTON_IN_SILVER",
  /id="iuInfoCardsExpandToggle"/.test(INDEX) &&
    /aria-controls="iuInfoCardsMobileTablet"/.test(INDEX) &&
    /aria-expanded="false"/.test(INDEX) &&
    /class="iu-info-cards-expand-toggle"/.test(INDEX),
  "toggle button missing"
);

ok(
  "TOGGLE_AFTER_QUICK_ACTIONS",
  /data-iu-hero-quick="notes"[\s\S]{0,2500}id="iuInfoCardsExpandToggle"[\s\S]{0,1200}id="iuInfoCardsMobileTablet"/.test(
    INDEX
  ),
  "toggle must sit between quick actions and info cards"
);

ok(
  "DESKTOP_HIDE_TOGGLE",
  /@media\s*\(min-width:\s*1024px\)\s*\{[\s\S]{0,180}\.iu-info-cards-expand-toggle[\s\S]{0,80}display:\s*none\s*!important/.test(
    INDEX
  ),
  "desktop toggle hide missing"
);

ok(
  "DESKTOP_CARDS_CONTENTS_UNCHANGED",
  /@media\(min-width:1024px\)\{#silver-slot \.iu-info-cards-mobile-tablet\{display:contents\}\}/.test(
    INDEX
  ) ||
    /@media\s*\(min-width:\s*1024px\)\s*\{[^}]*#silver-slot\s+\.iu-info-cards-mobile-tablet\s*\{\s*display:\s*contents/.test(
      INDEX
    ),
  "desktop display:contents must remain"
);

ok(
  "FEED_INIT_FN",
  /function iuInfoCardsExpandToggleInit\s*\(/.test(FEED) &&
    /iuInfoCardsExpandToggleInit\(\)/.test(FEED),
  "init missing"
);

ok(
  "FEED_PERSIST_KEY",
  /IU_INFO_CARDS_EXPANDED_KEY\s*=\s*"iu\.infoCards\.expanded\.v1"/.test(FEED) &&
    /localStorage\.setItem\(IU_INFO_CARDS_EXPANDED_KEY/.test(FEED) &&
    /durableSet\(IU_INFO_CARDS_EXPANDED_KEY/.test(FEED),
  "persist write missing"
);

ok(
  "FEED_ARIA_EXPANDED",
  /setAttribute\(\s*"aria-expanded"/.test(FEED) &&
    /data-iu-info-cards-expanded/.test(FEED),
  "aria/state apply missing"
);

ok(
  "CAL_TASKS_LOGIC_INTACT",
  /function iuSilverCalendarSummaryInit\s*\(/.test(FEED) &&
    /function iuSilverTasksSummaryInit\s*\(/.test(FEED) &&
    /iuSilverCalendarSummaryInit\(\)/.test(FEED) &&
    /iuSilverTasksSummaryInit\(\)/.test(FEED),
  "summary inits must remain"
);

ok(
  "CACHE_BUST_MARKER",
  /silver-info-cards-collapse-v1-20260915/.test(INDEX) &&
    /silver-info-cards-collapse-v1-20260915/.test(APP_JS),
  "cache-bust marker missing"
);

ok(
  "NO_PARALLEL_CAL_TASKS_IMPL",
  !/iuInfoCardsParallelCalendar|iuDuplicateTasksSummary/.test(FEED),
  "must not invent parallel calendar/tasks"
);

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-silver-info-cards-collapse-guard-v1",
      pass,
      failCount: fails.length,
      fails,
      results,
    },
    null,
    2
  )
);
if (!pass) {
  console.log("IU_SILVER_INFO_CARDS_COLLAPSE_FAIL");
  process.exit(1);
}
console.log("IU_SILVER_INFO_CARDS_COLLAPSE_PASS");
