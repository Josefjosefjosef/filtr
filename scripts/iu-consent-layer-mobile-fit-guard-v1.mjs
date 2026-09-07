#!/usr/bin/env node
/**
 * Consent layer: mobile/tablet/PWA usable above bottom nav + stable copy/buttons.
 * Run: npm run iu-consent-layer-mobile-fit-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

const TITLE = "Pomozte nám zlepšovat InfoUzel.cz";
const BODY =
  "Můžete nám povolit anonymní údaje o návštěvnosti. Nezjišťujeme, kdo jste, a nesledujeme vás napříč weby. Údaje používáme pouze ke zlepšování InfoUzel.cz.";
const BTN_DENY = "Nepovolit anonymní statistiky";
const BTN_ALLOW = "Povolit anonymní statistiky";
const BTN_SETTINGS = "Nastavení";
const CACHE = "consent-layer-mobile-fit-v1-20260907";

function staticGate() {
  const css = fs.readFileSync(path.join(ROOT, "assets/iu-consent-layer.css"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");
  const client = fs.readFileSync(path.join(ROOT, "assets/iu-analytics-client.js"), "utf8");
  const privacy = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/src/privacy.ts"), "utf8");
  const layerJs = fs.readFileSync(path.join(ROOT, "assets/iu-consent-layer.js"), "utf8");

  must(index.includes(TITLE), "static:title");
  must(index.includes(BODY), "static:body");
  must(index.includes(BTN_DENY), "static:btn_deny");
  must(index.includes(BTN_ALLOW), "static:btn_allow");
  must(index.includes('id="iuConsentSettings"') && index.includes(">" + BTN_SETTINGS + "<"), "static:btn_settings");
  must(!index.includes("Anonymní statistiky nám pomáhají pochopit návštěvnost"), "static:no_old_body");
  must(!/>Anonymní statistiky návštěvnosti</.test(index), "static:no_old_title");
  must(new RegExp("iu-consent-layer\\.css\\?v=" + CACHE).test(index), "static:css_cache");
  must(new RegExp("iu-consent-layer\\.js\\?v=" + CACHE).test(index), "static:js_cache");

  must(/@media\s*\(\s*max-width:\s*900px\s*\)/.test(css), "static:css_le900");
  must(/@media\s*\(\s*min-width:\s*901px\s*\)\s*and\s*\(\s*max-width:\s*1023px\s*\)/.test(css), "static:css_tablet_band");
  must(/@media\s*\(\s*min-width:\s*1024px\s*\)/.test(css), "static:css_desktop_1024");
  must(/--bottom-nav-height/.test(css), "static:css_bottom_nav_var");
  must(/100dvh/.test(css), "static:css_dvh");
  must(/overflow-y:\s*auto/.test(css), "static:css_panel_scroll");
  must(/\.iuConsentLayer__actions\s*\{[^}]*position:\s*sticky/.test(css), "static:css_actions_sticky");
  must(!/max-height:\s*min\(\s*28vh/.test(css), "static:no_phone_clip_height");
  must(!/\.iuConsentLayer__text\s*\{\s*display:\s*none/.test(css), "static:text_not_hidden");
  must(!/overflow:\s*hidden\s*;\s*\/\* Allow wrapped/.test(css), "static:no_legacy_overflow_hidden_panel");

  // Truth contract for the public claim
  must(/blocked\s*=\s*\["ip"/.test(client) || /"ip".*"fingerprint".*"user_agent"/.test(client), "truth:client_blocks_pii");
  must(/credentials:\s*"omit"/.test(client), "truth:client_omit_creds");
  must(/Never stores UA\/IP|Never stores IP/.test(privacy), "truth:worker_no_ip_ua");
  must(/iuConsentAllowStats/.test(layerJs) && /iuConsentEssentialOnly/.test(layerJs), "static:handlers_intact");
  must(/setAnalyticsConsent\(value\)/.test(layerJs), "static:consent_api_intact");
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function measureViewport(page, label) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("iu_consent_v1");
      localStorage.removeItem("iu_consent_layer_dismissed_v1");
      Object.keys(localStorage)
        .filter((k) => /consent/i.test(k))
        .forEach((k) => localStorage.removeItem(k));
    } catch (_) {}
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.getElementById("iuConsentLayer"), { timeout: 30000 });
  await page.waitForTimeout(800);
  // Force show if still hidden (some boots dismiss)
  await page.evaluate(() => {
    const bar = document.getElementById("iuConsentLayer");
    if (bar) bar.hidden = false;
  });
  await page.waitForTimeout(200);

  const m = await page.evaluate(() => {
    const bar = document.getElementById("iuConsentLayer");
    const panel = bar && bar.querySelector(".iuConsentLayer__panel");
    const nav = document.getElementById("iuMobileBottomNav");
    const title = bar && bar.querySelector(".iuConsentLayer__title");
    const text = bar && bar.querySelector(".iuConsentLayer__text");
    const deny = document.getElementById("iuConsentEssentialOnly");
    const allow = document.getElementById("iuConsentAllowStats");
    const settings = document.getElementById("iuConsentSettings");
    if (!bar || !panel || !deny || !allow || !settings) {
      return { ok: false, reason: "missing" };
    }
    const br = bar.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const nr = nav ? nav.getBoundingClientRect() : null;
    const navCs = nav ? getComputedStyle(nav) : null;
    const navVisible =
      !!(nav && navCs && navCs.display !== "none" && navCs.visibility !== "hidden" && nr && nr.height > 24);
    const buttons = [deny, allow, settings].map((b) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return {
        label: String(b.textContent || "").trim(),
        top: r.top,
        bottom: r.bottom,
        height: r.height,
        visible: cs.visibility !== "hidden" && cs.display !== "none" && r.height > 0,
      };
    });
    const textCs = text ? getComputedStyle(text) : null;
    const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return {
      ok: true,
      title: title ? String(title.textContent || "").trim() : "",
      text: text ? String(text.textContent || "").replace(/\s+/g, " ").trim() : "",
      textDisplay: textCs ? textCs.display : "missing",
      barBottom: br.bottom,
      panelTop: pr.top,
      panelBottom: pr.bottom,
      panelMaxH: getComputedStyle(panel).maxHeight,
      panelOverflowY: getComputedStyle(panel).overflowY,
      navTop: navVisible ? nr.top : null,
      navVisible,
      vw: window.innerWidth,
      vh: window.innerHeight,
      buttons,
      overflowX,
      pageScrollY: window.scrollY,
    };
  });

  must(m.ok, label + ":probe_ok");
  if (!m.ok) return m;
  must(m.title === TITLE, label + ":title");
  must(m.text.includes("Nezjišťujeme, kdo jste"), label + ":body_claim");
  must(m.textDisplay !== "none", label + ":text_visible");
  must(m.buttons[0].label === BTN_DENY, label + ":deny_label");
  must(m.buttons[1].label === BTN_ALLOW, label + ":allow_label");
  must(m.buttons[2].label === BTN_SETTINGS, label + ":settings_label");
  must(m.buttons.every((b) => b.visible), label + ":buttons_visible");
  must(!m.overflowX, label + ":no_h_overflow");
  if (m.vw <= 1023) {
    must(/auto|scroll/.test(String(m.panelOverflowY)), label + ":panel_scrollable");
  }
  if (m.vw <= 900) {
    must(m.navVisible === true, label + ":nav_visible_le900");
  }
  if (m.navTop != null) {
    must(m.barBottom <= m.navTop + 2, label + ":above_bottom_nav");
    must(m.buttons.every((b) => b.bottom <= m.navTop + 2), label + ":buttons_above_nav");
  }
  // All three buttons must be inside the usable layer (panel may need scroll for text)
  must(m.buttons.every((b) => b.top >= 0 && b.bottom <= m.vh + 1), label + ":buttons_in_viewport");
  return m;
}

async function runtimeGate() {
  const PORT = parseInt(process.env.IU_GUARD_PORT || "8951", 10);
  const srv = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 25000);
    const browser = await chromium.launch({ headless: true });
    const cases = [
      { label: "mobile_portrait", w: 390, h: 844 },
      { label: "mobile_landscape", w: 844, h: 390 },
      { label: "tablet_portrait_nav", w: 768, h: 1024 },
      { label: "phone_wide_nav_edge", w: 900, h: 700 },
      { label: "tablet_no_nav_band", w: 1023, h: 768 },
      { label: "short_height", w: 390, h: 480 },
      { label: "desktop_1024", w: 1024, h: 768 },
    ];
    for (const c of cases) {
      const ctx = await bootstrapGuardContext(browser, {
        viewport: { width: c.w, height: c.h },
        isMobile: true,
        hasTouch: true,
      });
      const page = await bootstrapGuardPage(ctx);
      await page.goto(`http://127.0.0.1:${PORT}/projects/?section=media&nosw=1`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await measureViewport(page, c.label);
      await ctx.close();
    }

    // Desktop regression: layout must not use ≤1024 bottom-nav anchoring rules
    const desk = await bootstrapGuardContext(browser, { viewport: { width: 1440, height: 900 } });
    const dpage = await bootstrapGuardPage(desk);
    await dpage.goto(`http://127.0.0.1:${PORT}/projects/?section=media&nosw=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await dpage.evaluate(() => {
      const bar = document.getElementById("iuConsentLayer");
      if (bar) bar.hidden = false;
    });
    await dpage.waitForTimeout(200);
    const deskM = await dpage.evaluate(() => {
      const bar = document.getElementById("iuConsentLayer");
      const panel = bar && bar.querySelector(".iuConsentLayer__panel");
      const deny = document.getElementById("iuConsentEssentialOnly");
      return {
        title: bar && bar.querySelector(".iuConsentLayer__title")
          ? String(bar.querySelector(".iuConsentLayer__title").textContent || "").trim()
          : "",
        bottom: bar ? getComputedStyle(bar).bottom : "",
        btnWhiteSpace: deny ? getComputedStyle(deny).whiteSpace : "",
        radius: panel ? getComputedStyle(panel).borderRadius : "",
      };
    });
    must(deskM.title === TITLE, "desktop:title");
    must(deskM.btnWhiteSpace === "nowrap", "desktop:btn_nowrap");
    await desk.close();
    await browser.close();
  } finally {
    try {
      srv.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.error(JSON.stringify({ result: "FAIL", phase: "static", fails }, null, 2));
    process.exit(1);
  }
  await runtimeGate();
  if (fails.length) {
    console.error(JSON.stringify({ result: "FAIL", phase: "runtime", fails }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      result: "PASS",
      IU_CONSENT_LAYER_MOBILE_FIT_GUARD: "PASS",
      TITLE,
      BUTTONS: [BTN_DENY, BTN_ALLOW, BTN_SETTINGS],
    })
  );
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
