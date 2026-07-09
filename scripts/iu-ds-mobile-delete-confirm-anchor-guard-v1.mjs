#!/usr/bin/env node
/**
 * Datová schránka — mobil/tablet delete confirm anchored to active card.
 * Run: npm run iu-ds-mobile-delete-confirm-anchor-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const APP = path.join(REPO, "assets", "app.js");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8898", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

const PROFILES = [
  { id: "iu_ds_guard_a", label: "Profil A", username: "user-a", password: "pass-a", locked: true },
  { id: "iu_ds_guard_b", label: "Profil B", username: "user-b", password: "pass-b", locked: true },
  { id: "iu_ds_guard_c", label: "Profil C", username: "user-c", password: "pass-c", locked: true },
];

function staticGate() {
  const app = fs.readFileSync(APP, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    {
      id: "attach_helper",
      pass: /function iuDsAttachDeleteConfirmToProfile\(profileId\)/.test(app),
    },
    {
      id: "mobile_host_class",
      pass: /iu-ds-profile--deleteConfirmHost/.test(app),
    },
    {
      id: "prevent_scroll_focus",
      pass: /focus\(\{ preventScroll: true \}\)/.test(app),
    },
    {
      id: "cache_bust",
      pass: /ds-mobile-delete-confirm-anchor-v1-20260709/.test(index),
    },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
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

async function openDatovka(page) {
  await page.evaluate(() => {
    const gateTab = document.getElementById("iuMobileGateTabTools");
    if (gateTab) gateTab.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="datovka"]');
    if (btn) btn.click();
  });
  await page.waitForFunction(
    () => {
      const panel = document.getElementById("iuDsPanel");
      return panel && !panel.hidden && panel.dataset.open === "1";
    },
    null,
    { timeout: 20000 }
  );
  await page.waitForTimeout(500);
}

async function seedProfiles(page) {
  await page.evaluate((rows) => {
    const t = Date.now();
    const profiles = rows.map((row) => ({
      id: row.id,
      label: row.label,
      username: row.username,
      password: row.password,
      locked: row.locked,
      createdAt: t,
      updatedAt: t,
    }));
    localStorage.setItem(
      "infouzel_datovka_profiles_v1",
      JSON.stringify({ v: 1, profiles })
    );
    localStorage.setItem("iu_local_data_protection_accepted_v1", "1");
  }, PROFILES);
}

async function clickDeleteOnProfile(page, profileId) {
  return page.evaluate((id) => {
    const card = document.querySelector('.iu-ds-profile[data-profile-id="' + id + '"]');
    if (!card) return { ok: false, reason: "card_missing" };
    const del = card.querySelector('[data-ds-action="delete"]');
    if (!del) return { ok: false, reason: "delete_missing" };
    const scrollHost = document.querySelector("#iuDsPanel .iu-datovka-scroll-host") || document.getElementById("iuDsPanel");
    const scrollBefore = scrollHost ? scrollHost.scrollTop : 0;
    del.click();
    const scrollAfter = scrollHost ? scrollHost.scrollTop : 0;
    return { ok: true, scrollDelta: Math.abs(scrollAfter - scrollBefore) };
  }, profileId);
}

async function measureConfirmAnchor(page, profileId) {
  return page.evaluate((id) => {
    const card = document.querySelector('.iu-ds-profile[data-profile-id="' + id + '"]');
    const confirm = document.getElementById("iuDsDeleteConfirm");
    const box = confirm ? confirm.querySelector(".iu-ds-deleteConfirm__box") : null;
    if (!card || !confirm || !box || confirm.hasAttribute("hidden")) {
      return { ok: false, reason: "confirm_not_open" };
    }
    const parentIsCard = confirm.parentElement === card;
    const cardRect = card.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const boxInsideCard =
      boxRect.top >= cardRect.top - 2 &&
      boxRect.bottom <= cardRect.bottom + 2 &&
      boxRect.left >= cardRect.left - 2 &&
      boxRect.right <= cardRect.right + 2;
    return {
      ok: parentIsCard && boxInsideCard,
      parentIsCard,
      boxInsideCard,
      cardTop: Math.round(cardRect.top),
      boxTop: Math.round(boxRect.top),
    };
  }, profileId);
}

async function closeConfirm(page) {
  await page.evaluate(() => {
    const cancel = document.getElementById("iuDsDeleteConfirmCancel");
    if (cancel) cancel.click();
  });
  await page.waitForTimeout(250);
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await seedProfiles(page);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  await openDatovka(page);

  const cases = [];
  for (const profile of PROFILES) {
    await page.evaluate((id) => {
      const card = document.querySelector('.iu-ds-profile[data-profile-id="' + id + '"]');
      if (card && typeof card.scrollIntoView === "function") {
        card.scrollIntoView({ block: "center", behavior: "instant" });
      }
    }, profile.id);
    await page.waitForTimeout(350);
    const click = await clickDeleteOnProfile(page, profile.id);
    const anchor = await measureConfirmAnchor(page, profile.id);
    cases.push({
      profileId: profile.id,
      click,
      anchor,
      pass: !!(click.ok && anchor.ok && (click.scrollDelta || 0) <= 2),
    });
    await closeConfirm(page);
  }

  await context.close();
  return {
    viewport: vp.name,
    pass: cases.every((c) => c.pass),
    cases,
  };
}

async function runDesktopUnchanged(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE + "?section=media", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    if (typeof window.iuOpenOverlay === "function") window.iuOpenOverlay("datovka");
    else if (typeof window.iuDatovkaOpenSurface === "function") window.iuDatovkaOpenSurface();
  });
  await page.waitForTimeout(800);
  const desktop = await page.evaluate(() => {
    const modal = document.querySelector("#iuDsPanel .iu-ds-modal");
    const card = document.querySelector(".iu-ds-profile");
    const del = card ? card.querySelector('[data-ds-action="delete"]') : null;
    if (!modal || !card || !del) return { ok: false, reason: "missing_elements" };
    del.click();
    const confirm = document.getElementById("iuDsDeleteConfirm");
    if (!confirm || confirm.hasAttribute("hidden")) return { ok: false, reason: "confirm_not_open" };
    const parentIsModal = confirm.parentElement === modal;
    const parentIsCard = confirm.parentElement === card;
    const cancel = document.getElementById("iuDsDeleteConfirmCancel");
    if (cancel) cancel.click();
    return { ok: parentIsModal && !parentIsCard, parentIsModal, parentIsCard };
  });
  await context.close();
  return desktop;
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_DS_MOBILE_DELETE_CONFIRM_ANCHOR_GUARD_FAIL");
    console.log(JSON.stringify({ phase: "static", ...staticResult }, null, 2));
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(REPO, p.replace(/^\/+/, ""));
      if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const mime =
        fp.endsWith(".css") ? "text/css; charset=utf-8" :
        fp.endsWith(".js") ? "text/javascript; charset=utf-8" :
        fp.endsWith(".html") ? "text/html; charset=utf-8" :
        "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(fs.readFileSync(fp));
    } catch (_) {
      res.writeHead(500);
      res.end("err");
    }
  });

  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  await waitForPort("127.0.0.1", PORT, 10000);

  const browser = await chromium.launch({ headless: true });
  const viewports = [];
  for (const vp of VIEWPORTS) {
    viewports.push(await runViewport(browser, vp));
  }
  const desktop = await runDesktopUnchanged(browser);
  await browser.close();
  server.close();

  const pass = viewports.every((v) => v.pass) && !!desktop.ok;
  console.log("IU_DS_MOBILE_DELETE_CONFIRM_ANCHOR_GUARD_" + (pass ? "PASS" : "FAIL"));
  console.log(
    JSON.stringify(
      {
        result: pass ? "PASS" : "FAIL",
        static: staticResult,
        desktop,
        viewports,
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
