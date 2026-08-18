#!/usr/bin/env node
/**
 * Silver welcome — legacy capture input must not render in any browser/viewport.
 * Run: npm run iu-silver-welcome-legacy-input-removed-guard
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const APP = path.join(REPO, "assets", "app.js");
const FEED = path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8898", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CACHE_BUSTS = [
  "ds-mobile-scroll-bottom-clearance-v1-20260707-desktop-left-rail-section-close-v1-20260707-svatek-pill-inline-layout-v1-20260707",
  "ds-mobile-scroll-bottom-clearance-v1-20260707-desktop-left-rail-section-close-v1-20260707",
  "legal-docs-hub-header-single-row-v1-20260707",
  "ds-mobile-scroll-bottom-clearance-v1-20260707",
  "moje-sluzby-mobile-keyboard-add-btn-v1-20260706",
  "weather-artifact-utf8-eager-boot-v1-20260706",
  "legal-docs-preview-pc-v1-20260706",
  "tasks-desktop-two-panel-v1-20260706",
  "state-holiday-label-v1-20260706",
];

const VIEWPORTS = [
  { width: 390, height: 844, label: "mobile" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1280, height: 900, label: "desktop" },
];

function staticGate() {
  const app = [
    fs.readFileSync(APP, "utf8"),
    fs.existsSync(FEED) ? fs.readFileSync(FEED, "utf8") : "",
  ].join("\n");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    {
      id: "legacy_capture_removed_marker",
      pass: /Legacy welcome capture input removed/.test(app),
    },
    {
      id: "no_createElement_input_in_build",
      pass: (() => {
        const chunk = app.split("function iuUserAddressBuildCaptureSlotIfNeeded()")[1];
        if (!chunk) return false;
        const body = chunk.split("function iuUserAddressSetCore")[0] || "";
        return !/createElement\("input"\)/.test(body) && !/iuSilverWelcomeAddressInput/.test(body);
      })(),
    },
    {
      id: "capture_slot_hidden_branch",
      pass: /mode === "capture"[\s\S]*slot\.setAttribute\("hidden"/.test(app),
    },
    {
      id: "index_app_cache_bust",
      pass: CACHE_BUSTS.some((bust) => new RegExp(`app\\.js\\?v=${bust}`).test(index)),
    },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails };
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
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function measureWelcome(page) {
  return page.evaluate(() => {
    const pickVisible = (sel) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.filter((el) => {
        if (!el || el.hidden) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const st = window.getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
        return true;
      }).length;
    };
    const homeInput = document.getElementById("iuSilverHomeInput");
    const homeRect = homeInput ? homeInput.getBoundingClientRect() : null;
    return {
      legacyInputCount: pickVisible(".iuSilverWelcomeAddressInput"),
      legacySubmitCount: pickVisible(".iuSilverWelcomeAddressSubmit"),
      slotHidden: (() => {
        const slot = document.getElementById("iuSilverWelcomeAddressSlot");
        if (!slot) return true;
        return slot.hasAttribute("hidden") || pickVisible("#iuSilverWelcomeAddressSlot input") === 0;
      })(),
      homeInputVisible: !!(homeRect && homeRect.width > 1 && homeRect.height > 1),
      greetText: String(document.getElementById("iuSilverWelcomeGreet")?.textContent || "").trim(),
    };
  });
}

async function runViewport(page, viewport, label) {
  const fails = [];
  try {
    await page.setViewportSize(viewport);
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(
      () => typeof window.iuSilverWelcomeRefresh === "function",
      null,
      { timeout: 30000 },
    );
    await page.evaluate(() => {
      try {
        localStorage.removeItem("iu_user_address");
        localStorage.removeItem("iu_user_address_explicit.v1");
      } catch (_) {}
      if (typeof window.iuSilverWelcomeRefresh === "function") window.iuSilverWelcomeRefresh();
      if (typeof window.iuUserAddressBuildCaptureSlotIfNeeded === "function") {
        window.iuUserAddressBuildCaptureSlotIfNeeded();
      }
    });
    await page.waitForTimeout(500);
    const row = await measureWelcome(page);
    if (!row) {
      fails.push(`${label}/${browserType}: welcome missing`);
      return fails;
    }
    if (row.legacyInputCount > 0) {
      fails.push(`${label}: legacy input visible count=${row.legacyInputCount}`);
    }
    if (row.legacySubmitCount > 0) {
      fails.push(`${label}: legacy submit visible count=${row.legacySubmitCount}`);
    }
    if (!row.slotHidden) {
      fails.push(`${label}: address slot not hidden`);
    }
    if (!row.homeInputVisible) {
      fails.push(`${label}: iuSilverHomeInput missing`);
    }
  } catch (err) {
    fails.push(`${label}: ${String(err && err.message ? err.message : err)}`);
  }

  return fails;
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_SILVER_WELCOME_LEGACY_INPUT_REMOVED_GUARD_STATIC_FAIL");
    staticResult.fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("IU_SILVER_WELCOME_LEGACY_INPUT_REMOVED_GUARD_STATIC_PASS");

  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForPort("127.0.0.1", PORT, 30000);

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.route("**/sw.js", (route) => route.abort());
  } catch (_) {}

  const fails = [];
  try {
    for (const vp of VIEWPORTS) {
      fails.push(...(await runViewport(page, vp, vp.label)));
    }
  } catch (err) {
    fails.push(String(err && err.message ? err.message : err));
  }

  await browser.close();

  server.kill("SIGTERM");

  if (fails.length) {
    console.log("IU_SILVER_WELCOME_LEGACY_INPUT_REMOVED_GUARD_FAIL");
    fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("IU_SILVER_WELCOME_LEGACY_INPUT_REMOVED_GUARD_PASS");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
