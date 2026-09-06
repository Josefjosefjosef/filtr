#!/usr/bin/env node
/**
 * Guard: Jízdní řády — neutral presentation (no ranking/recommendation copy).
 * Run: npm run iu-jr-neutral-presentation-guard
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
  "Odkazy na vybrané služby pro vyhledávání spojů a dopravní informace v České republice.";
const SEO_H2 = "Jízdní řády vlaků, autobusů a MHD online";
const SEO_P1 =
  "Sekce Jízdní řády obsahuje odkazy na vybrané externí služby související s vyhledáváním spojů a veřejnou dopravou v České republice. Mezi uvedené služby patří například IDOS, PID Lítačka, DPP Praha, České dráhy, RegioJet, Leo Express, IDS JMK a PID.";
const SEO_P2 =
  "Po výběru je uživatel přesměrován na příslušnou externí stránku nebo aplikaci, kde může využít informace a funkce poskytované danou službou.";
const SEO_P3 =
  "Sekce slouží jako orientační rozcestník k vybraným externím službám. Nabídka není úplným výčtem dopravců, dopravních systémů ani dostupných služeb.";

const FORBIDDEN = [
  "Rychlé odkazy na vyhledání spojů",
  "Snadno otevřete",
  "můžete rychle ověřit",
  "Hodí se pro",
  "praktický rozcestník",
  "bez zbytečného hledání",
  "otevřít oficiální službu dopravce",
  "oficiální službu dopravce",
  "Na jednom místě najdete rychlé odkazy",
];

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function sliceJr(index) {
  const m = index.match(/id="iuLazyViewTpl-jr"[\s\S]*?<\/template>/);
  const seo = index.match(/data-iu-seo-stub="jr"[\s\S]*?<\/div>\s*<template id="iuLazyViewTpl-affiliate"/);
  return (m ? m[0] : "") + "\n" + (seo ? seo[0] : "");
}

function auditStatic() {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const slice = sliceJr(index);

  ok("index:exact_intro", slice.includes(INTRO));
  ok("index:seo_h2", slice.includes(SEO_H2));
  ok("index:seo_p1", slice.includes(SEO_P1));
  ok("index:seo_p2", slice.includes(SEO_P2));
  ok("index:seo_p3", slice.includes(SEO_P3));
  ok("index:marker", slice.includes("jr-neutral-v1-20260906"));
  ok("index:idos_url", /href="https:\/\/idos\.idnes\.cz"/.test(slice));
  ok("index:cd_url", /href="https:\/\/www\.cd\.cz"/.test(slice));
  ok("index:pid_url", /href="https:\/\/www\.pid\.cz"/.test(slice));
  // Do not lock chip count — only require at least one chip link.
  const chipCount = (slice.match(/class="iuRadioChip"/g) || []).length;
  ok("index:chips_present", chipCount >= 1, "chips=" + chipCount);
  for (const b of FORBIDDEN) {
    ok("index:no:" + b.slice(0, 32), !slice.includes(b));
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

async function openJr(page, baseUrl) {
  await dismissConsent(page);
  await page.goto(`${baseUrl}?section=jr&nosw=1&cb=${Date.now()}`, {
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
  await page.waitForSelector("#iuJrEmptyView .iuRadioChip", { state: "attached", timeout: 90000 });
  await page.evaluate(() => {
    const v = document.getElementById("iuJrEmptyView");
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
  console.log(JSON.stringify({ IU_JR_NEUTRAL_PRESENTATION_GUARD: "FAIL", phase: "static", fails }, null, 2));
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8951", 10);
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
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 900 },
  ]) {
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.name !== "desktop",
    });
    const page = await bootstrapGuardPage(context);
    await openJr(page, `http://127.0.0.1:${PORT}/projects/`);

    const snap = await page.evaluate((forbidden) => {
      const view = document.getElementById("iuJrEmptyView");
      const introEl = view ? view.querySelector(".iuSectionSubtitle") : null;
      const intro = (introEl ? introEl.textContent : "").replace(/\s+/g, " ").trim();
      const chips = [...document.querySelectorAll("#iuJrEmptyView .iuRadioChip")].map((a) => ({
        text: (a.innerText || "").replace(/\s+/g, " ").trim(),
        href: a.getAttribute("href") || "",
      }));
      const overflow = view ? view.scrollWidth > view.clientWidth + 1 : false;
      const bodyText = view ? view.textContent || "" : "";
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
        document.querySelector(".iu-timetables-seo-block") ||
        document.querySelector('[data-iu-seo-stub="jr"] .iu-timetables-seo-block');
      return seo ? (seo.textContent || "").replace(/\s+/g, " ").trim() : "";
    });
    if (seoDom) {
      ok(vp.name + ":seo_h2", seoDom.includes(SEO_H2));
      ok(vp.name + ":seo_p1", seoDom.includes(SEO_P1));
      ok(vp.name + ":seo_p2", seoDom.includes(SEO_P2));
      ok(vp.name + ":seo_p3", seoDom.includes(SEO_P3));
      for (const b of FORBIDDEN) {
        ok(vp.name + ":seo_no:" + b.slice(0, 24), !seoDom.includes(b));
      }
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
      IU_JR_NEUTRAL_PRESENTATION_GUARD: pass ? "PASS" : "FAIL",
      fails,
      REAL_IOS: "NOT_TESTED",
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
