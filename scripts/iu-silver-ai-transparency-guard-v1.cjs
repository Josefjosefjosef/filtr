#!/usr/bin/env node
"use strict";

/**
 * Required AI transparency labels for Silver + iCentrum.
 * Static source locks + rendered DOM geometry/behavior checks.
 * Do not remove without legal/product review.
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const shared = require("./mobile-stability-guards-v1-shared.cjs");
const {
  installProofGuardNetworkStubs,
  installLocalDataProtectionAccepted,
} = require("./proofs/open_meteo_guard_stub.cjs");

async function newGuardPage(browser, viewport) {
  const context = await browser.newContext({
    viewport: viewport || { width: 1280, height: 900 },
  });
  await installLocalDataProtectionAccepted(context);
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page);
  return { context, page };
}

const GUARD_NAME = "IU_SILVER_AI_TRANSPARENCY_GUARD_V1";
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu-silver-ai-transparency-guard-v1-report.json"
);

const BADGE_TEXT = "AI asistent";
const PC_SILVER_LABEL = "Silver — AI asistent";
const ICENTRUM_TILE = "O Silverovi – AI asistent";
const SILVER_LEAD =
  "Silver je AI osobní asistent přímo v InfoUzel.cz. Pomůže vám rychle zapsat úkol, poznámku nebo událost běžnou češtinou.";
const SILVER_AI_DISCLAIMER_NEEDLES = [
  "Silver využívá umělou inteligenci",
  "mohou obsahovat nepřesnosti",
  "Důležité informace si proto vždy ověřte",
];
const ABOUT_AI_NOTE =
  "Při provozu InfoUzel.cz jsou využívány také nástroje umělé inteligence, například pro AI asistenta Silver a při tvorbě nebo úpravě některých ilustračních grafických prvků webu.";
const FORBIDDEN_ACTIVE = [
  "O Silverovi / osobní asistent",
  "O Silverovi / AI asistent",
  'iuSilverHomeDesktopActionMenuItemLabel">Silver</span>',
  "Silver je osobní asistent přímo v InfoUzel.cz",
];

const MOBILE_VPS = [
  { w: 320, h: 720, label: "320p" },
  { w: 375, h: 812, label: "375p" },
  { w: 390, h: 844, label: "390p" },
  { w: 430, h: 932, label: "430p" },
  { w: 768, h: 1024, label: "768p" },
  { w: 820, h: 1180, label: "820p" },
  { w: 1024, h: 1366, label: "1024p" },
];

function staticCheck() {
  const html = fs.readFileSync(path.join(shared.ROOT, "projects", "index.html"), "utf8");
  const checks = {
    badge_markup:
      html.indexOf('data-iu-silver-ai-badge="1"') >= 0 &&
      html.indexOf(">" + BADGE_TEXT + "</span>") >= 0 &&
      html.indexOf("Required AI transparency label") >= 0,
    badge_css_mobile:
      /@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]*\.iu-silver-ai-badge\[data-iu-silver-ai-badge\]/.test(
        html
      ),
    badge_hidden_desktop:
      /@media\s*\(\s*min-width:\s*1025px\s*\)[\s\S]*\.iu-silver-ai-badge\[data-iu-silver-ai-badge\]\s*\{\s*display:\s*none\s*!important/.test(
        html
      ),
    pc_menu_label:
      html.indexOf(">" + PC_SILVER_LABEL + "</span>") >= 0 &&
      /data-iu-silver-desktop-action="silver"[\s\S]{0,220}Silver — AI asistent/.test(html),
    icentrum_tile: html.indexOf(">" + ICENTRUM_TILE + "<") >= 0,
    silver_lead: html.indexOf(SILVER_LEAD) >= 0,
    silver_disclaimer: SILVER_AI_DISCLAIMER_NEEDLES.every((n) => html.indexOf(n) >= 0),
    about_ai_note:
      html.indexOf('data-iu-info-ai-graphics-note="1"') >= 0 && html.indexOf(ABOUT_AI_NOTE) >= 0,
    chat_subtitle:
      /iuSilverChatSubtitle">AI asistent</.test(html) ||
      html.indexOf('<p class="iuSilverChatSubtitle">AI asistent</p>') >= 0,
    no_forbidden: FORBIDDEN_ACTIVE.every((f) => html.indexOf(f) < 0),
    no_ai_graphics_card:
      html.indexOf("AI grafika") < 0 && html.indexOf('data-iu-info-section="ai-graphics"') < 0,
  };
  const fails = Object.keys(checks).filter((k) => !checks[k]);
  return { check: "static_source", pass: fails.length === 0, fails, checks };
}

async function openInfoDetail(page, section) {
  await page.evaluate(async (sec) => {
    const openBtn =
      document.querySelector("#iuTopbarInfoBtn") ||
      document.querySelector("[data-iu-open-info-center]") ||
      document.querySelector('button[aria-label*="iCentrum"]');
    if (openBtn && typeof openBtn.click === "function") openBtn.click();
    await new Promise((r) => setTimeout(r, 400));
    const tile = document.querySelector(
      '#iuTopbarInfoOverlay [data-iu-info-section="' + sec + '"].iuInfoCenter__tile, .iuInfoCenter__tile[data-iu-info-section="' + sec + '"]'
    );
    if (tile && typeof tile.click === "function") tile.click();
    const detail = document.getElementById(
      sec === "silver" ? "iuInfoCenterDetailSilver" : "iuInfoCenterDetailAbout"
    );
    if (detail) {
      detail.hidden = false;
      detail.removeAttribute("hidden");
    }
  }, section);
  await page.waitForTimeout(350);
}

async function measureMobileBadge(browser, vp) {
  const { context, page } = await newGuardPage(browser, { width: vp.w, height: vp.h });
  try {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(shared.envBaseUrl() + "/projects/?iuRobust=1&nosw=1", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(2200);
  await shared.dismissGuardOverlays(page);
  const light = await page.evaluate(({ badgeText }) => {
    const hero = document.getElementById("iuSilverHeroPremium");
    const badge = document.querySelector("[data-iu-silver-ai-badge]");
    const heroRect = hero ? hero.getBoundingClientRect() : null;
    const badgeRect = badge ? badge.getBoundingClientRect() : null;
    const cs = badge ? getComputedStyle(badge) : null;
    const text = badge ? String(badge.textContent || "").trim() : "";
    const overflowX = document.documentElement.scrollWidth > window.innerWidth + 1;
    const inside =
      !!hero &&
      !!badge &&
      hero.contains(badge) &&
      !!heroRect &&
      !!badgeRect &&
      badgeRect.left >= heroRect.left - 1 &&
      badgeRect.right <= heroRect.right + 1 &&
      badgeRect.top >= heroRect.top - 1 &&
      badgeRect.bottom <= heroRect.bottom + 1;
    const topRight =
      !!heroRect &&
      !!badgeRect &&
      heroRect.right - badgeRect.right <= 24 &&
      badgeRect.top - heroRect.top <= 24;
    return {
      text,
      textOk: text === badgeText,
      visible: !!(badge && cs && badgeRect && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0 && badgeRect.width >= 2 && badgeRect.height >= 2),
      inside,
      topRight,
      overflowX,
      pointerEvents: cs ? cs.pointerEvents : "",
    };
  }, { badgeText: BADGE_TEXT });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(200);
  const darkVisible = await page.evaluate(() => {
    const badge = document.querySelector("[data-iu-silver-ai-badge]");
    if (!badge) return false;
    const cs = getComputedStyle(badge);
    const r = badge.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0 && r.width >= 2 && r.height >= 2;
  });

  const pass =
    light.textOk &&
    light.visible &&
    light.inside &&
    light.topRight &&
    !light.overflowX &&
    light.pointerEvents === "none" &&
    darkVisible;

  return {
    check: "mobile_badge",
    viewport: vp.label,
    pass,
    light,
    darkVisible,
  };
  } finally {
    await context.close();
  }
}

async function measureIcentrum(browser) {
  const { context, page } = await newGuardPage(browser, { width: 390, height: 844 });
  try {
  await page.goto(shared.envBaseUrl() + "/projects/?iuRobust=1&nosw=1", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(2000);
  await shared.dismissGuardOverlays(page);

  await openInfoDetail(page, "silver");
  const silver = await page.evaluate(({ tile, lead, needles }) => {
    const tileEl = document.querySelector('.iuInfoCenter__tile[data-iu-info-section="silver"] .iuInfoCenter__tileLabel');
    const tileText = tileEl ? String(tileEl.textContent || "").trim() : "";
    const leadEl = document.querySelector("[data-iu-info-silver-lead]");
    const discEl = document.querySelector("[data-iu-info-silver-ai-disclaimer]");
    const leadText = leadEl ? String(leadEl.textContent || "").trim() : "";
    const discText = discEl ? String(discEl.textContent || "").trim() : "";
    const detail = document.getElementById("iuInfoCenterDetailSilver");
    const detailVisible = !!(detail && !detail.hidden);
    return {
      tileText,
      tileOk: tileText === tile,
      leadOk: leadText === lead,
      disclaimerOk: needles.every((n) => discText.indexOf(n) >= 0),
      detailVisible,
    };
  }, {
    tile: ICENTRUM_TILE,
    lead: SILVER_LEAD,
    needles: SILVER_AI_DISCLAIMER_NEEDLES,
  });

  await openInfoDetail(page, "about");
  const about = await page.evaluate(({ note }) => {
    const el = document.querySelector("[data-iu-info-ai-graphics-note]");
    const text = el ? String(el.textContent || "").trim() : "";
    return { text, noteOk: text === note };
  }, { note: ABOUT_AI_NOTE });

  return {
    check: "icentrum",
    pass:
      silver.tileOk &&
      silver.leadOk &&
      silver.disclaimerOk &&
      silver.detailVisible &&
      about.noteOk,
    silver,
    about,
  };
  } finally {
    await context.close();
  }
}

async function measurePcMenu(browser) {
  const { context, page } = await newGuardPage(browser, { width: 1280, height: 900 });
  try {
  await page.goto(shared.envBaseUrl() + "/projects/?iuRobust=1&nosw=1", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForSelector("#iuSilverHomeInput", { timeout: 45000 });
  await shared.dismissGuardOverlays(page);
  await page.evaluate(async () => {
    try {
      if (typeof window.iuEnsureSilverP0Engine === "function") await window.iuEnsureSilverP0Engine();
    } catch (_) {}
  });
  await page.waitForFunction(
    () => {
      const host = document.getElementById("iuTopbarSilverComposerHost");
      const input = document.getElementById("iuSilverHomeInput");
      return !!(
        host &&
        input &&
        host.contains(input) &&
        document.body.classList.contains("iu-desktop-silver-composer-topbar")
      );
    },
    { timeout: 120000 }
  );
  await page.waitForFunction(
    () => typeof window.__iuSilverTriggerHomeSubmit === "function",
    { timeout: 60000 }
  );
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => {
      try {
        return (
          typeof window.__iuSilverHomeDesktopActionMenuEnabled === "function" &&
          window.__iuSilverHomeDesktopActionMenuEnabled()
        );
      } catch (_) {
        return false;
      }
    });
    if (ready) break;
    await page.waitForTimeout(400);
  }
  await shared.dismissGuardOverlays(page);

  const staticLabel = await page.evaluate(({ expected }) => {
    const labelEl = document.querySelector(
      '[data-iu-silver-desktop-action="silver"] .iuSilverHomeDesktopActionMenuItemLabel'
    );
    const label = labelEl ? String(labelEl.textContent || "").trim() : "";
    const menu = document.getElementById("iuSilverHomeDesktopActionMenu");
    const actions = menu
      ? Array.from(menu.querySelectorAll("[data-iu-silver-desktop-action]")).map((el) =>
          String(el.getAttribute("data-iu-silver-desktop-action") || "")
        )
      : [];
    const badge = document.querySelector("[data-iu-silver-ai-badge]");
    const badgeCs = badge ? getComputedStyle(badge) : null;
    return {
      label,
      labelOk: label === expected,
      orderOk: JSON.stringify(actions) === JSON.stringify(["silver", "google", "seznam", "youtube", "googlemaps", "mapycz"]),
      badgeHiddenDesktop: !badge || !badgeCs || badgeCs.display === "none" || badgeCs.visibility === "hidden",
    };
  }, { expected: PC_SILVER_LABEL });

  await page.fill("#iuSilverHomeInput", "test ai label menu");
  await page.focus("#iuSilverHomeInput");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await shared.dismissGuardOverlays(page);

  const menuState = await page.evaluate(() => {
    const menu = document.getElementById("iuSilverHomeDesktopActionMenu");
    const labelEl = document.querySelector(
      '[data-iu-silver-desktop-action="silver"] .iuSilverHomeDesktopActionMenuItemLabel'
    );
    const menuOpenNow = !!(menu && !menu.hidden);
    const labelRect = labelEl && menuOpenNow ? labelEl.getBoundingClientRect() : null;
    const menuRect = menuOpenNow ? menu.getBoundingClientRect() : null;
    const fits =
      !!labelRect &&
      !!menuRect &&
      labelRect.width >= 80 &&
      labelRect.right <= menuRect.right + 2 &&
      labelRect.left >= menuRect.left - 2;
    return {
      menuOpen: !!(menu && !menu.hidden && menuRect && menuRect.height > 8),
      fits,
      labelVisibleWidth: labelRect ? labelRect.width : 0,
    };
  });

  const openExternal = await page.evaluate(() => {
    return new Promise((resolve) => {
      let done = false;
      const finish = (payload) => {
        if (done) return;
        done = true;
        resolve(payload);
      };
      const orig = window.open;
      window.open = function (url, target) {
        window.open = orig;
        finish({ url: String(url || ""), target: String(target || "") });
        return null;
      };
      const btn = document.querySelector('[data-iu-silver-desktop-action="google"]');
      if (btn) btn.click();
      setTimeout(() => finish({ url: "", target: "" }), 1500);
    });
  });

  await page.fill("#iuSilverHomeInput", "otevri silver ai");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(350);
  await shared.dismissGuardOverlays(page);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iu-silver-desktop-action="silver"]');
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForTimeout(900);
  const silverOpened = await page.evaluate(() => {
    const overlay = document.getElementById("iuSilverChatOverlay");
    return !!(overlay && !overlay.hidden);
  });

  const pass =
    staticLabel.labelOk &&
    staticLabel.orderOk &&
    staticLabel.badgeHiddenDesktop &&
    menuState.menuOpen &&
    menuState.fits &&
    /google\.com\/search/.test(openExternal.url) &&
    silverOpened;

  return {
    check: "pc_menu",
    pass,
    staticLabel,
    menuState,
    openExternal,
    silverOpened,
  };
  } finally {
    await context.close();
  }
}

async function runGuard(baseUrl) {
  const results = [];
  const st = staticCheck();
  results.push(st);

  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of MOBILE_VPS) {
      results.push(await measureMobileBadge(browser, vp));
    }
    results.push(await measureIcentrum(browser));
    results.push(await measurePcMenu(browser));
  } finally {
    await browser.close();
  }

  const pass = results.every((r) => r.pass);
  const out = { pass, url: baseUrl, results };
  try {
    fs.writeFileSync(REPORT, JSON.stringify(out, null, 2) + "\n");
  } catch (_) {}
  return out;
}

module.exports = { runGuard, GUARD_NAME, REPORT };

if (require.main === module) {
  (async () => {
    const envUrl = String(process.env.MOBILE_STABILITY_GUARDS_URL || process.env.IU_GUARD_BASE_URL || "").trim();
    let server = null;
    const port = shared.DEFAULT_PORT + 11;
    if (!envUrl) {
      server = await shared.startStaticServer(port);
      process.env.MOBILE_STABILITY_GUARDS_URL = "http://127.0.0.1:" + port;
    }
    try {
      const out = await runGuard(shared.envBaseUrl());
      process.stdout.write("=== " + GUARD_NAME + " ===\n");
      for (let i = 0; i < out.results.length; i++) {
        const r = out.results[i];
        process.stdout.write(
          String(r.check || "result") +
            (r.viewport ? "/" + r.viewport : "") +
            "=" +
            (r.pass ? "PASS" : "FAIL") +
            "\n"
        );
      }
      process.stdout.write("PASS_FAIL=" + (out.pass ? "PASS" : "FAIL") + "\n");
      process.stdout.write("report=" + REPORT + "\n");
      process.stdout.write("=== END_" + GUARD_NAME + " ===\n");
      try {
        fs.writeFileSync(REPORT, JSON.stringify(out, null, 2) + "\n");
      } catch (_) {}
      if (!out.pass) process.exit(1);
    } finally {
      if (server) server.close();
    }
  })().catch((e) => {
    process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
    process.exit(1);
  });
}
