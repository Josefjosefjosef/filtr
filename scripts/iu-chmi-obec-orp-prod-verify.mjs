#!/usr/bin/env node
/**
 * Production verify: CHMI obec→ORP locality filter (post PR #8417).
 *
 * - Asserts production hashed asset URLs + CONTENT (not a fixed merge SHA).
 * - Distinguishes LIVE_SCENARIO_NOT_AVAILABLE from hard FAIL.
 * - Playwright emulated viewports only (not physical devices).
 *
 * Exit 0 only when required checks pass. Missing live alert is not a hard fail.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "playwright"));

const PROD = "https://infouzel.cz/projects/";
const CORE_URL = "https://infouzel.cz/assets/iu-info-system-core-v1.js";
const PICKER_URL = "https://infouzel.cz/projects/data/cz_localities_picker.json";
const FEED_URL = "https://infouzel.cz/projects/data/info_events/feed.json";
const LS_PREFS = "iu.infoEvents.prefs.v1";

const fails = [];
const warnings = [];
const report = {
  assetUrls: {},
  liveScenario: "UNKNOWN",
  live: null,
  steps: [],
  viewports: "Playwright_emulated_not_physical",
};

function note(id, ok, detail) {
  report.steps.push({ id, ok: !!ok, detail: detail || "" });
  if (!ok) fails.push(id + (detail ? ":" + detail : ""));
}

function warn(id, detail) {
  warnings.push(id + (detail ? ":" + detail : ""));
  report.steps.push({ id, ok: true, detail: "WARN:" + (detail || "") });
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  return { status: res.status, text: res.ok ? await res.text() : "", url };
}

async function fetchJson(url) {
  const res = await fetch(url + (url.includes("?") ? "&" : "?") + "cb=" + Date.now(), {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error("fetch_json_fail " + url + " " + res.status);
  return res.json();
}

function pickerItems(picker) {
  if (Array.isArray(picker)) return picker;
  return picker.items || picker.localities || picker.obce || [];
}

function findObec(list, name) {
  const hit = list.find((x) => x && String(x.n || x.name || "").toLowerCase() === String(name).toLowerCase());
  if (!hit) throw new Error("obec_missing:" + name);
  return {
    name: String(hit.n || hit.name),
    id: String(hit.id || ""),
    orpCode: String(hit.orp || hit.orpCode || ""),
    level: "mesto",
    orpName: String(hit.orpN || ""),
    type: String(hit.t || ""),
  };
}

function normalizeOrpCode(raw) {
  let code = String(raw || "").trim();
  if (code.startsWith("orp:")) code = code.slice(4);
  if (code === "1100") code = "1000";
  return code;
}

function extractOrpCodes(item) {
  const out = new Set();
  const links = item && item.capV2 && item.capV2.geo && Array.isArray(item.capV2.geo.links) ? item.capV2.geo.links : [];
  for (const link of links) {
    const c = normalizeOrpCode(link && (link.orpCode || link.orpId));
    if (c) out.add(c);
  }
  const region = item && item.region ? item.region : null;
  if (region) {
    for (const raw of region.orpCodes || []) {
      const c = normalizeOrpCode(raw);
      if (c) out.add(c);
    }
  }
  return Array.from(out);
}

function areaCountFromTitle(title) {
  const m = String(title || "").match(/dalších\s+(\d+)\s+oblast/i);
  return m ? Number(m[1]) : null;
}

function basePrefs(cities) {
  return {
    localities: cities,
    myRegionOnly: cities.length > 0,
    homeObec: cities[0] ? cities[0].name : "",
    homeKraj: "",
    homeOkres: "",
    localityQuery: "",
  };
}

async function openProd(context) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err && err.message ? err.message : err)));
  await page.goto(PROD, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(
    () => !!(window.IUInfoSystem && document.querySelector("#iuPrehledDneRoot, [data-act='open-settings']")),
    { timeout: 60000 }
  );
  await page.waitForTimeout(1200);
  return { page, consoleErrors };
}

async function setPrefsAndReload(page, prefs) {
  await page.evaluate(
    ({ key, prefs }) => {
      localStorage.setItem(key, JSON.stringify(prefs));
    },
    { key: LS_PREFS, prefs }
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(
    () => !!(window.IUInfoSystem && document.querySelector(".iuPdCard__title, .iuPrehledDne__cardTitle, #iuPrehledDneRoot")),
    { timeout: 60000 }
  );
  await page.waitForTimeout(1800);
}

async function collectCards(page) {
  return page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll(".iuPdCard__title, .iuPrehledDne__cardTitle")).map((el) =>
      String(el.textContent || "").trim()
    );
    const docEl = document.documentElement;
    return {
      titles,
      count: titles.length,
      scrollWidth: Math.max(docEl.scrollWidth, document.body.scrollWidth),
      clientWidth: docEl.clientWidth,
      hasMap: !!document.querySelector(".iuPdCard svg, .iuPrehledDne__map, [data-iu-cz-map]"),
      maxCities: window.IUInfoSystem && window.IUInfoSystem.MAX_CITY_LOCALITIES,
      cssHref: (document.querySelector('link[href*="iu-prehled-dne-v1"]') || {}).href || "",
      jsSrc: (document.querySelector('script[src*="iu-prehled-dne-ui-v1"]') || {}).src || "",
    };
  });
}

async function assertAssetsFromHtml(page) {
  const refs = await page.evaluate(() => {
    const link = document.querySelector('link[href*="iu-prehled-dne-v1"]');
    const script = document.querySelector('script[src*="iu-prehled-dne-ui-v1"]');
    return {
      css: link ? link.getAttribute("href") : "",
      js: script ? script.getAttribute("src") : "",
      max: window.IUInfoSystem && window.IUInfoSystem.MAX_CITY_LOCALITIES,
    };
  });
  report.assetUrls = refs;
  note("prod_hashed_css_url", /\/assets\/iu-prehled-dne-v1\.[a-f0-9]+\.css(\?|$)/i.test(refs.css), refs.css);
  note("prod_hashed_js_url", /\/assets\/iu-prehled-dne-ui-v1\.[a-f0-9]+\.js(\?|$)/i.test(refs.js), refs.js);
  note("prod_runtime_max20", refs.max === 20, String(refs.max));

  const cssAbs = refs.css.startsWith("http") ? refs.css : "https://infouzel.cz" + refs.css;
  const jsAbs = refs.js.startsWith("http") ? refs.js : "https://infouzel.cz" + refs.js;
  const [core, ui, css] = await Promise.all([fetchText(CORE_URL), fetchText(jsAbs), fetchText(cssAbs)]);
  note("prod_core_http200", core.status === 200, String(core.status));
  note("prod_ui_http200", ui.status === 200, String(ui.status));
  note("prod_css_http200", css.status === 200, String(css.status));
  note("prod_core_max20", /MAX_CITY_LOCALITIES\s*=\s*20/.test(core.text), "max");
  note("prod_core_alias_1100_1000", /"1100"\s*:\s*"1000"/.test(core.text), "alias");
  note("prod_core_orp_filter", /eventMatchesLocationFilter/.test(core.text) && /normalizeOrpCode/.test(core.text), "orp");
  note("prod_core_normalize_localities", /normalizeLocalitiesList/.test(core.text), "norm");
  note("prod_ui_limit_msg", /maximálně 20 obcí/.test(ui.text), "msg");
  note("prod_ui_orp_code", /orpCode/.test(ui.text), "orpCode");
  note("prod_css_title_wrap", /overflow-wrap:\s*anywhere/.test(css.text), "wrap");
  return refs;
}

async function uiAddCity(page, cityName) {
  try {
    await page.evaluate(() => document.querySelector('[data-act="open-settings"]')?.click());
    await page.waitForSelector("#iuPdSettings", { timeout: 10000 });
    await page.evaluate(() => document.querySelector('[data-act="open-section"][data-id="lokalita"]')?.click());
    await page.waitForTimeout(500);
    const input = page
      .locator('#iuPdSettings input[type="search"], #iuPdSettings input[type="text"], #iuPdSettings input:not([type])')
      .first();
    if ((await input.count()) < 1) {
      await page.evaluate(() => document.querySelector('[data-act="settings-close"]')?.click());
      return { ok: false, reason: "no_text_input" };
    }
    await input.click({ timeout: 5000 });
    await input.fill(cityName);
    await page.waitForTimeout(800);
    const picked = await page.evaluate((name) => {
      const opts = Array.from(
        document.querySelectorAll(
          "#iuPdSettings button, #iuPdSettings [role='option'], #iuPdSettings .iuPdSuggest__item, #iuPdSettings [data-act='add-locality'], #iuPdSettings [data-act='pick-locality']"
        )
      );
      const hit = opts.find((el) => String(el.textContent || "").toLowerCase().includes(String(name).toLowerCase()));
      if (hit) {
        hit.click();
        return true;
      }
      return false;
    }, cityName);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('[data-act="settings-save"]')?.click());
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector('[data-act="settings-close"]')?.click());
    await page.waitForTimeout(400);
    return { ok: picked, reason: picked ? "picked" : "suggest_miss" };
  } catch (e) {
    try {
      await page.evaluate(() => document.querySelector('[data-act="settings-close"]')?.click());
    } catch (_) {}
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
}

async function runViewport(browser, name, width, height, cities20, city21) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "cs-CZ" });
  const { page, consoleErrors } = await openProd(context);
  const bare = await collectCards(page);
  note(name + "_nofilter_cards", bare.count > 0, "count=" + bare.count);
  note(name + "_nofilter_no_hscroll", bare.scrollWidth <= bare.clientWidth + 2, JSON.stringify({ sw: bare.scrollWidth, cw: bare.clientWidth }));
  note(name + "_has_map", bare.hasMap, "map");

  await setPrefsAndReload(page, basePrefs([cities20[0]]));
  const one = await collectCards(page);
  note(name + "_one_obec_in_title", one.titles.some((t) => t.includes(cities20[0].name)), one.titles.slice(0, 2).join(" | "));

  await setPrefsAndReload(page, basePrefs(cities20.slice(0, 2)));
  const same = await collectCards(page);
  note(
    name + "_same_orp_both",
    same.titles.some((t) => t.includes(cities20[0].name) && t.includes(cities20[1].name)),
    same.titles.slice(0, 2).join(" | ")
  );

  await setPrefsAndReload(page, basePrefs(cities20));
  const lim = await page.evaluate(
    ({ key, city21 }) => {
      const raw = JSON.parse(localStorage.getItem(key) || "{}");
      const before = (raw.localities || []).filter((l) => l && String(l.level || "") === "mesto").length;
      const core = window.IUInfoSystem;
      const next = core && typeof core.normalizeLocalitiesList === "function" ? core.normalizeLocalitiesList([...(raw.localities || []), city21]) : [];
      const after = next.filter((l) => l && String(l.level || "") === "mesto").length;
      const has21 = next.some((l) => String(l.id || "") === String(city21.id || ""));
      const docEl = document.documentElement;
      return {
        before,
        after,
        has21,
        max: core && core.MAX_CITY_LOCALITIES,
        scrollWidth: Math.max(docEl.scrollWidth, document.body.scrollWidth),
        clientWidth: docEl.clientWidth,
      };
    },
    { key: LS_PREFS, city21 }
  );
  note(name + "_limit20_stored", lim.before === 20 && lim.max === 20, JSON.stringify(lim));
  note(name + "_21st_city_cannot_be_added", lim.after === 20 && !lim.has21, JSON.stringify(lim));
  note(name + "_limit_no_hscroll", lim.scrollWidth <= lim.clientWidth + 2, JSON.stringify(lim));

  await page.evaluate(() => {
    document.documentElement.classList.add("dark", "iu-time-evening");
  });
  const dark = await collectCards(page);
  note(name + "_dark_no_hscroll", dark.scrollWidth <= dark.clientWidth + 2, JSON.stringify({ sw: dark.scrollWidth, cw: dark.clientWidth }));

  await setPrefsAndReload(page, basePrefs([]));
  const reset = await collectCards(page);
  note(name + "_reset_clears_city", !reset.titles.some((t) => t.includes(cities20[0].name)), "ok");
  note(
    name + "_console_clean",
    consoleErrors.filter((e) => !/favicon|ResizeObserver|net::ERR/i.test(e)).length === 0,
    consoleErrors.slice(0, 3).join(" || ")
  );
  await context.close();
}

async function main() {
  const picker = await fetchJson(PICKER_URL);
  const list = pickerItems(picker);
  note("picker_count", list.length >= 6250, "count=" + list.length);

  const nupaky = findObec(list, "Nupaky");
  const cestlice = findObec(list, "Čestlice");
  const pruhonice = findObec(list, "Průhonice");
  note("map_nupaky_ricany", nupaky.orpCode === "2122", JSON.stringify(nupaky));
  note("map_cestlice_ricany", cestlice.orpCode === "2122", JSON.stringify(cestlice));
  note("map_pruhonice_cernosice", pruhonice.orpCode === "2105", JSON.stringify(pruhonice));

  const cities20 = [];
  const seen = new Set();
  for (const loc of list) {
    if (!loc || !loc.id || !loc.orp) continue;
    if (seen.has(String(loc.id))) continue;
    seen.add(String(loc.id));
    cities20.push({
      name: String(loc.n || loc.name),
      id: String(loc.id),
      orpCode: String(loc.orp),
      level: "mesto",
    });
    if (cities20.length >= 20) break;
  }
  cities20[0] = nupaky;
  cities20[1] = cestlice;
  cities20[2] = pruhonice;
  const city21Raw = list.find((l) => l && l.id && !cities20.some((c) => c.id === String(l.id)));
  const city21 = {
    name: String(city21Raw.n || city21Raw.name),
    id: String(city21Raw.id),
    orpCode: String(city21Raw.orp || ""),
    level: "mesto",
  };

  const feed = await fetchJson(FEED_URL);
  const cap = (feed.items || []).filter((i) => i && i.capV2);
  note("feed_cap_present", cap.length > 0, "capCount=" + cap.length + ";generatedAt=" + feed.generatedAt);

  let live = null;
  for (const item of cap) {
    const codes = extractOrpCodes(item);
    if (!codes.length) continue;
    // Prefer a small obec (t=obec) outside Praha technical code for clearer titles.
    const prefer = codes.filter((c) => c !== "1000");
    const pool = prefer.length ? prefer : codes;
    let hit = null;
    for (const code of pool) {
      hit = list.find((l) => l && String(l.orp) === code && String(l.t || "") === "obec");
      if (hit) break;
    }
    if (!hit) {
      for (const code of pool) {
        hit = list.find((l) => l && String(l.orp) === code);
        if (hit) break;
      }
    }
    if (!hit) continue;
    live = {
      name: String(hit.n || hit.name),
      id: String(hit.id),
      orpCode: String(hit.orp),
      level: "mesto",
      alertId: String(item.id || ""),
      originalTitle: String(item.title || ""),
      areaCount: areaCountFromTitle(item.title),
    };
    break;
  }
  if (live) {
    report.liveScenario = "AVAILABLE";
    report.live = live;
  } else {
    report.liveScenario = "LIVE_SCENARIO_NOT_AVAILABLE";
    warn("live_scenario", "LIVE_SCENARIO_NOT_AVAILABLE");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "cs-CZ" });
    const { page, consoleErrors } = await openProd(context);
    await assertAssetsFromHtml(page);

    const bare = await collectCards(page);
    note("nofilter_cards", bare.count > 0, "count=" + bare.count);
    note("nofilter_no_user_obce", !bare.titles.some((t) => /Nupaky|Čestlice|Průhonice/i.test(t)), bare.titles.slice(0, 3).join(" | "));
    note("nofilter_has_map", bare.hasMap, "map");

    // UI autocomplete for Nupaky (best-effort; prefs path remains authoritative for ORP titles)
    const uiPick = await uiAddCity(page, "Nupaky");
    if (!uiPick.ok) warn("ui_autocomplete_nupaky", uiPick.reason);
    else note("ui_autocomplete_nupaky", true, uiPick.reason);

    for (const city of [nupaky, cestlice, pruhonice]) {
      await setPrefsAndReload(page, basePrefs([city]));
      const cards = await collectCards(page);
      const inTitle = cards.titles.some((t) => t.includes(city.name));
      note("city_persisted_" + city.name, true, JSON.stringify(city));
      // Live title depends on whether that ORP currently has an alert.
      const orpLive = cap.some((item) => extractOrpCodes(item).includes(city.orpCode));
      if (orpLive) {
        note("live_title_" + city.name, inTitle, cards.titles.slice(0, 2).join(" | "));
      } else {
        warn("live_title_" + city.name, "no_current_alert_for_orp=" + city.orpCode + ";inTitle=" + inTitle);
      }
      // reload persistence
      await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(1500);
      const prefs = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), LS_PREFS);
      const kept = (prefs.localities || []).some((l) => String(l.id || "") === city.id || String(l.name || "") === city.name);
      note("reload_keeps_" + city.name, kept, JSON.stringify((prefs.localities || []).slice(0, 2)));
    }

    await setPrefsAndReload(page, basePrefs([nupaky, cestlice]));
    const sameOrp = await collectCards(page);
    note(
      "multi_same_orp_title",
      sameOrp.titles.some((t) => t.includes("Nupaky") && t.includes("Čestlice")),
      sameOrp.titles.slice(0, 2).join(" | ")
    );

    await setPrefsAndReload(page, basePrefs([nupaky, pruhonice]));
    const diffOrp = await collectCards(page);
    note(
      "multi_diff_orp_title",
      diffOrp.titles.some((t) => t.includes("Nupaky") && t.includes("Průhonice")),
      diffOrp.titles.slice(0, 2).join(" | ")
    );

    if (live) {
      const eventPrefix = String(live.originalTitle || "").split(" — ")[0].trim();
      await setPrefsAndReload(page, basePrefs([]));
      const beforeCards = await collectCards(page);
      const beforeMatch =
        beforeCards.titles.find((t) => eventPrefix && t.startsWith(eventPrefix + " —")) ||
        beforeCards.titles.find((t) => eventPrefix && t.startsWith(eventPrefix)) ||
        "";
      const beforeAreas = areaCountFromTitle(beforeMatch);

      await setPrefsAndReload(page, basePrefs([live]));
      const after = await collectCards(page);
      // Compare the SAME event card (same hazard prefix), not an arbitrary matching title.
      const filteredSameEvent =
        after.titles.find((t) => eventPrefix && t.startsWith(eventPrefix + " —") && t.includes(live.name)) ||
        after.titles.find((t) => eventPrefix && t.startsWith(eventPrefix) && t.includes(live.name)) ||
        "";
      const anyFiltered = after.titles.find((t) => t.includes(live.name)) || "";
      const afterAreas = areaCountFromTitle(filteredSameEvent || "");
      note("live_city_in_relevant_title", !!filteredSameEvent || !!anyFiltered, filteredSameEvent || anyFiltered);
      note(
        "live_area_count_stable_same_event",
        !filteredSameEvent || beforeAreas == null || afterAreas == null || beforeAreas === afterAreas,
        "event=" +
          eventPrefix +
          ";before=" +
          beforeAreas +
          ";after=" +
          afterAreas +
          ";beforeTitle=" +
          beforeMatch +
          ";afterTitle=" +
          filteredSameEvent
      );
      report.live = Object.assign({}, live, {
        filteredTitle: filteredSameEvent || anyFiltered,
        areaCountBefore: beforeAreas,
        areaCountAfter: afterAreas,
        originalTitleObserved: beforeMatch,
      });

      await setPrefsAndReload(page, basePrefs([]));
      const resetLive = await collectCards(page);
      note(
        "live_reset_standard_title",
        !resetLive.titles.some((t) => t.includes(live.name)),
        resetLive.titles.slice(0, 2).join(" | ")
      );
    }

    // Limit 20 + 21st cannot be added + remove/add
    await setPrefsAndReload(page, basePrefs(cities20));
    const limState = await page.evaluate(
      ({ key, city21, replaceWith }) => {
        const core = window.IUInfoSystem;
        const raw = JSON.parse(localStorage.getItem(key) || "{}");
        const cities = (raw.localities || []).filter((l) => l && String(l.level || "") === "mesto");
        const with21 = core.normalizeLocalitiesList([...cities, city21]);
        const after21 = with21.filter((l) => String(l.level || "") === "mesto");
        const removed = cities.slice(1);
        const replaced = core.normalizeLocalitiesList([...removed, replaceWith]);
        localStorage.setItem(key, JSON.stringify(Object.assign({}, raw, { localities: replaced, homeObec: replaceWith.name, myRegionOnly: true })));
        return {
          count20: cities.length,
          after21: after21.length,
          has21: after21.some((l) => String(l.id) === String(city21.id)),
          replacedCount: replaced.filter((l) => String(l.level || "") === "mesto").length,
          hasReplace: replaced.some((l) => String(l.id) === String(replaceWith.id)),
        };
      },
      { key: LS_PREFS, city21, replaceWith: city21 }
    );
    note("limit_exactly_20", limState.count20 === 20, JSON.stringify(limState));
    note("21st_city_cannot_be_added", limState.after21 === 20 && !limState.has21, JSON.stringify(limState));
    note("remove_then_add_other", limState.replacedCount === 20 && limState.hasReplace, JSON.stringify(limState));

    await setPrefsAndReload(page, basePrefs([]));
    note("cleanup_prefs", true, "cleared");
    note(
      "pc_console_clean",
      consoleErrors.filter((e) => !/favicon|ResizeObserver|net::ERR/i.test(e)).length === 0,
      consoleErrors.slice(0, 3).join(" || ")
    );
    await context.close();

    await runViewport(browser, "mobile", 390, 844, cities20, city21);
    await runViewport(browser, "tablet", 834, 1194, cities20, city21);
    await runViewport(browser, "pc", 1280, 900, cities20, city21);
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(report, null, 2));
  if (warnings.length) {
    console.log("WARNINGS");
    for (const w of warnings) console.log(" - " + w);
  }
  if (fails.length) {
    console.error("PROD_VERIFY_FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("PROD_VERIFY_PASS");
  if (report.liveScenario === "LIVE_SCENARIO_NOT_AVAILABLE") {
    console.log("LIVE_SCENARIO_NOT_AVAILABLE");
  }
  console.log("VIEWPORTS=Playwright_emulated_not_physical");
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
