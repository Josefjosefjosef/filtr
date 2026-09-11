#!/usr/bin/env node
/**
 * TRAFFIC RELOAD / PANEL LIFECYCLE GUARD (v1)
 *
 * Freezes product contracts for Doprava ↔ ČHMÚ across:
 *   web reload, new browser session, PWA persist, hydrate reapply, false-empty.
 *
 * Behavioral (source-level) — not function-name smoke only:
 *   A) Web reload with session traffic → ensureTrafficFetchPromise + hydrate kick
 *   B) No bare await trafficPromise (undeclared → false empty)
 *   C) Empty UI gated on trafficSnapSettled (false empty vs legitimate empty)
 *   D) New browser session defaults to ČHMÚ (sessionStorage; LS only when PWA)
 *   E) PWA persists quick view to durable LS; web does not read LS unless standalone
 *   F) Filters remain prefs/localStorage path (unchanged keys)
 *   G) Reload path mirrors click: full hydrate + ensureTrafficCatalogForCurrentFilters
 *   H) No "if filtered length === 0 show all" fallback
 *
 * Run: node scripts/iu-traffic-reload-panel-lifecycle-guard-v1.mjs
 * npm: iu-traffic-reload-panel-lifecycle-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const prehled = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const feedFilter = fs.readFileSync(path.join(ROOT, "assets", "iu-feed-filter-v1.js"), "utf8");
const overview = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");

// --- A/B: reload path must fetch head; forbid undeclared await trafficPromise ---
ok(
  "reload_no_bare_await_trafficPromise",
  !/\bawait\s+trafficPromise\b/.test(prehled),
  "undeclared await trafficPromise caused false empty on Doprava reload"
);
ok(
  "reload_uses_ensureTrafficFetchPromise",
  /feedQuickView === "chmu"[\s\S]{0,400}scheduleTrafficBackgroundPrep[\s\S]{0,800}ensureTrafficFetchPromise\(/.test(
    prehled
  ),
  "non-CHMU boot branch must call ensureTrafficFetchPromise"
);
ok(
  "reload_kick_full_hydrate",
  /ensureTrafficFetchPromise\(\)[\s\S]{0,1200}scheduleTrafficBackgroundFullHydrate/.test(prehled),
  "reload path must kick background full hydrate after head"
);
ok(
  "reload_reapply_filters_catalog",
  /ensureTrafficFetchPromise\(\)[\s\S]{0,1600}ensureTrafficCatalogForCurrentFilters\(1\)/.test(prehled),
  "reload path must reapply filters over catalog after hydrate kick"
);

// --- C: false empty vs legitimate empty ---
ok(
  "empty_gated_on_trafficSnapSettled",
  /trafficSnapSettled[\s\S]{0,200}emptyFeedStateHtml|!state\.trafficSnapSettled[\s\S]{0,400}emptyFeedStateHtml|trafficPending[\s\S]{0,300}emptyFeedStateHtml/.test(
    prehled
  ),
  "empty state must wait for trafficSnapSettled"
);
ok(
  "legitimate_empty_copy_preserved",
  /Pro toto nastavení momentálně nemáme žádné události/.test(feedFilter),
  "legitimate empty copy must remain"
);
ok(
  "no_zero_filter_show_all_fallback",
  !/filteredItems\.length\s*===\s*0[\s\S]{0,120}(showAll|resetFilter|feedQuickView\s*=\s*"all")/.test(
    prehled
  ) &&
    !/list\.length\s*===\s*0[\s\S]{0,200}applyFeedSourceAndQuickView\([^,]+,\s*[^,]+,\s*"all"\)/.test(
      prehled
    ),
  "must not mask zero results by showing all"
);

// --- D/E: web session vs PWA durable ---
ok(
  "session_key_ss",
  /iu\.prehled\.feedQuickView\.v1/.test(prehled),
  "sessionStorage key for reload"
);
ok(
  "pwa_durable_ls_key",
  /iu\.prehled\.feedQuickView\.pwa\.v1/.test(prehled),
  "PWA localStorage key"
);
ok(
  "standalone_detect",
  /display-mode:\s*standalone/.test(prehled) && /navigator\.standalone/.test(prehled),
  "PWA standalone detection"
);
ok(
  "restore_ss_before_pwa_ls",
  /sessionStorage\.getItem\(FEED_QUICK_VIEW_SS\)[\s\S]{0,500}isPrehledPwaStandalone\(\)[\s\S]{0,400}localStorage\.getItem\(FEED_QUICK_VIEW_PWA_LS\)/.test(
    prehled
  ),
  "reload SS first; PWA LS only when standalone"
);
ok(
  "persist_pwa_writes_ls",
  /isPrehledPwaStandalone\(\)[\s\S]{0,200}localStorage\.setItem\(FEED_QUICK_VIEW_PWA_LS/.test(prehled),
  "PWA persist must write durable LS"
);
ok(
  "web_default_chmu",
  /feedQuickView:\s*"chmu"/.test(prehled) && /state\.feedQuickView\s*=\s*"chmu"/.test(prehled),
  "new session default ČHMÚ"
);
ok(
  "restore_before_first_paint",
  /restoreFeedQuickViewFromSession\(\);[\s\S]{0,120}reapplyPrefsFromStore\(/.test(prehled),
  "restore panel before reapplyPrefs paint (no CHMI flicker)"
);

// --- F: filters storage unchanged ---
ok(
  "filters_prefs_key",
  /iu\.infoEvents\.prefs\.v1/.test(
    fs.readFileSync(path.join(ROOT, "assets", "iu-info-system-core-v1.js"), "utf8")
  ) || /getPrefs\(/.test(prehled),
  "filters remain prefs path"
);

// --- G: click + reload share hydrate/refilter contract ---
ok(
  "click_path_hydrate",
  /scheduleTrafficBackgroundFullHydrate[\s\S]{0,400}ensureTrafficPresenter/.test(prehled),
  "click Doprava still kicks hydrate before presenter"
);
ok(
  "hydrated_event_refilter",
  /iu-traffic-snap-hydrated[\s\S]{0,800}phase === "full"/.test(prehled),
  "full hydrate event still refilters"
);

// --- H/I: PWA warm resume architecture preserved ---
ok(
  "fg_revalidate_preserved",
  /scheduleTrafficForegroundRevalidateIfNeeded/.test(prehled) &&
    /export function scheduleTrafficForegroundRevalidate/.test(overview),
  "foreground revalidate preserved"
);
ok(
  "visibility_after_hidden",
  /trafficSawHidden[\s\S]{0,400}scheduleTrafficForegroundRevalidateIfNeeded\("visibilitychange"\)/.test(
    prehled
  ),
  "visibilitychange after hidden"
);
ok(
  "pageshow_persisted",
  /ev\.persisted[\s\S]{0,120}scheduleTrafficForegroundRevalidateIfNeeded\("pageshow-bfcache"\)/.test(
    prehled
  ),
  "pageshow(persisted)"
);
ok(
  "online_revalidate",
  /scheduleTrafficForegroundRevalidateIfNeeded\("online"\)/.test(prehled),
  "online revalidate"
);
ok(
  "full_single_flight",
  /if \(_trafficFullHydratePromise\) return _trafficFullHydratePromise/.test(overview),
  "full hydrate single-flight"
);
ok(
  "fg_single_flight",
  /if \(_trafficForegroundRevalidatePromise\) return _trafficForegroundRevalidatePromise/.test(
    overview
  ),
  "foreground revalidate single-flight"
);

// --- loading UI before settle (no false 0) ---
ok(
  "reload_loading_copy",
  /Načítám dopravu…/.test(prehled),
  "loading copy while snap pending"
);

const report = {
  TRAFFIC_RELOAD_PANEL_LIFECYCLE_GUARD: fails.length ? "FAIL" : "PASS",
  fails,
};
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
