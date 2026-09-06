#!/usr/bin/env node
/**
 * Guard: Mapy & Navigace — neutral presentation (no ranking/recommendation copy).
 * Run: npm run iu-mapy-neutral-presentation-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const INTRO =
  "Mapy, navigace a mobilita na jednom místě — odkazy na vybrané mapové, navigační a dopravní služby.";
const SEO_H2 = "Mapy, navigace a dopravní služby online";
const SEO_P1 =
  "Na jednom místě najdete odkazy na vybrané mapové a navigační služby. Sekce obsahuje například Google Maps, Mapy.cz, OpenStreetMap a Apple Maps. Po výběru služby je uživatel přesměrován na příslušnou externí stránku nebo aplikaci, kde může využít funkce poskytované danou službou.";
const SEO_P2 =
  "Sekce Mapy & Navigace obsahuje také odkazy na vybrané služby související s navigací, dopravou a mobilitou, například Waze, Mapy.cz Navigaci, informace o parkování, nabíjení elektromobilů, dopravních informacích nebo dálničních známkách.";
const SEO_P3 =
  "Sekce slouží jako orientační rozcestník k vybraným externím mapovým, navigačním a dopravním službám. Nabídka není úplným výčtem dostupných služeb.";

const FORBIDDEN = [
  "nejpoužívanější mapové a navigační služby",
  "bez zbytečného hledání",
  "Snadno otevřete",
  "nejpoužívanější",
];

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function sliceMapy(index) {
  const m = index.match(/id="iuLazyViewTpl-mapy"[\s\S]*?<\/template>/);
  const seo = index.match(/data-iu-seo-stub="mapy"[\s\S]*?<\/div>\s*<template id="iuLazyViewTpl-radio"/);
  return (m ? m[0] : "") + "\n" + (seo ? seo[0] : "");
}

function auditStatic() {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const slice = sliceMapy(index);

  ok("index:exact_intro", slice.includes(INTRO));
  ok("index:seo_h2", slice.includes(SEO_H2));
  ok("index:seo_p1", slice.includes(SEO_P1));
  ok("index:seo_p2", slice.includes(SEO_P2.replace(/&/g, "&amp;")) || slice.includes(SEO_P2));
  ok("index:seo_p3", slice.includes(SEO_P3));
  ok("index:marker", slice.includes("mapy-neutral-v1-20260906"));
  ok("index:google_maps_url", /href="https:\/\/www\.google\.com\/maps"/.test(slice));
  ok("index:mapycz_url", /href="https:\/\/mapy\.cz"/.test(slice));
  ok("index:waze_url", /href="https:\/\/www\.waze\.com\/live-map"/.test(slice));
  for (const b of FORBIDDEN) {
    ok("index:no:" + b.slice(0, 28), !slice.includes(b));
  }
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

async function dismissConsent(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
    const b = document.getElementById("iuConsentAllowStats");
    if (b) b.click();
    const layer = document.getElementById("iuConsentLayer");
    if (layer) layer.remove();
  });
}

async function openMapy(page, baseUrl) {
  await dismissConsent(page);
  await page.goto(`${baseUrl}?section=mapy&nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await dismissConsent(page);
  await page
    .waitForFunction(() => typeof window.iuApplySectionFromURL === "function", null, { timeout: 90000 })
    .catch(() => null);
  await page.evaluate(() => {
    try {
      if (typeof window.iuApplySectionFromURL === "function") window.iuApplySectionFromURL();
    } catch (_) {}
  });
  await page.waitForSelector("#iuMapyView .iuRadioChip", { state: "attached", timeout: 90000 });
  await page.evaluate(() => {
    const v = document.getElementById("iuMapyView");
    if (v) {
      v.hidden = false;
      try {
        v.removeAttribute("hidden");
      } catch (_) {}
    }
  });
}

auditStatic();
if (fails.length) {
  console.log(JSON.stringify({ IU_MAPY_NEUTRAL_PRESENTATION_GUARD: "FAIL", phase: "static", fails }, null, 2));
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8948", 10);
const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const fp = path.join(ROOT, p.replace(/^\/+/, ""));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const mime =
      fp.endsWith(".css")
        ? "text/css; charset=utf-8"
        : fp.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : fp.endsWith(".html")
            ? "text/html; charset=utf-8"
            : "application/octet-stream";
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
try {
  for (const vp of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 900 },
  ]) {
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.name === "mobile",
    });
    const page = await bootstrapGuardPage(context);
    await openMapy(page, `http://127.0.0.1:${PORT}/projects/`);

    const snap = await page.evaluate((forbidden) => {
      const view = document.getElementById("iuMapyView");
      const introEl = view ? view.querySelector(".iuSectionSubtitle") : null;
      const intro = (introEl ? introEl.textContent : "").replace(/\s+/g, " ").trim();
      const chips = [...document.querySelectorAll("#iuMapyView .iuRadioChip")].map((a) => ({
        text: (a.innerText || "").replace(/\s+/g, " ").trim(),
        href: a.getAttribute("href") || "",
      }));
      const overflow = view ? view.scrollWidth > view.clientWidth + 1 : false;
      const bodyText = view ? (view.textContent || "") : "";
      const forbiddenHit = forbidden.find((b) => bodyText.includes(b) || intro.includes(b));
      return { intro, chipCount: chips.length, chips, overflow, forbiddenHit: forbiddenHit || null };
    }, FORBIDDEN);

    ok(vp.name + ":intro", snap.intro === INTRO, snap.intro);
    ok(vp.name + ":chips", snap.chipCount >= 1);
    ok(vp.name + ":https", snap.chips.every((c) => /^https:\/\//i.test(c.href)));
    ok(vp.name + ":no_h_overflow", !snap.overflow);
    ok(vp.name + ":no_forbidden", !snap.forbiddenHit, snap.forbiddenHit);

    const seoDom = await page.evaluate(() => {
      const seo =
        document.querySelector(".iu-maps-seo-block") ||
        document.querySelector('[data-iu-seo-stub="mapy"] .iu-maps-seo-block');
      return seo ? (seo.textContent || "").replace(/\s+/g, " ").trim() : "";
    });
    if (seoDom) {
      ok(vp.name + ":seo_h2", seoDom.includes(SEO_H2));
      ok(vp.name + ":seo_p1", seoDom.includes("vybrané mapové a navigační služby"));
      ok(vp.name + ":seo_napriklad", seoDom.includes("například"));
      ok(vp.name + ":seo_p3", seoDom.includes("Nabídka není úplným výčtem dostupných služeb."));
      ok(vp.name + ":seo_no_nej", !seoDom.includes("nejpoužívanější"));
      ok(vp.name + ":seo_no_bez", !seoDom.includes("bez zbytečného hledání"));
    }

    await context.close();
  }
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      IU_MAPY_NEUTRAL_PRESENTATION_GUARD: pass ? "PASS" : "FAIL",
      fails,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
