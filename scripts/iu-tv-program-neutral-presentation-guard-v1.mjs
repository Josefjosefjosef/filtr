#!/usr/bin/env node
/**
 * Guard: TV program — neutral presentation (no ranking/recommendation copy).
 * Run: npm run iu-tv-program-neutral-presentation-guard
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

const HERO_SUB = "Odkazy na vybrané televizní programy a externí služby.";
const EVENING_H3 = "Program podle typu obsahu";
const STATIONS_LEAD =
  "Odkazy na vybrané televizní programy. Odkazy se otevřou na externích stránkách.";
const SEO_H3 = "TV program – odkazy na vybrané externí zdroje";
const SEO_P1 =
  "Sekce TV program obsahuje odkazy na vybrané externí televizní programy a související zdroje. Obsah lze procházet podle vybraných kategorií nebo televizních stanic.";
const SEO_P2 =
  "Po výběru je uživatel přesměrován na příslušnou externí stránku, kde jsou dostupné informace poskytované provozovatelem daného zdroje.";
const SEO_P3 =
  "InfoUzel.cz televizní programy ani vysílání jednotlivých stanic neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím zdrojům. Nabídka není úplným výčtem televizních stanic, pořadů ani dostupných televizních programů.";

const FORBIDDEN = [
  "Doporučení dnes večer",
  "Rychlé odkazy na hlavní TV programy",
  "TV program online přehledně",
  "čistý přehled vhodný pro mobil, tablet i počítač",
  "bez zbytečného hledání a bez zahlcení reklamními prvky",
  "TV program je určený jako praktický rozcestník",
  "Film večer",
  "Seriál večer",
  "Sport dnes",
  "Oficiální TV program ČT",
  "TV program Nova Group",
  "Výběr filmů napříč hlavními stanicemi",
];

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function sliceTv(index) {
  const m = index.match(/id="iuLazyViewTpl-tvprogram"[\s\S]*?<\/template>/);
  const seo = index.match(
    /data-iu-seo-stub="tvprogram"[\s\S]*?<\/div>\s*<template id="iuLazyViewTpl-mapy"/
  );
  return (m ? m[0] : "") + "\n" + (seo ? seo[0] : "");
}

function sliceTvApp(app) {
  const start = app.indexOf("const IU_TV_PROGRAM_LINKS");
  const end = app.indexOf("function iuInitTvProgramChoiceUi");
  if (start < 0 || end < 0 || end <= start) return "";
  return app.slice(start, end);
}

function auditStatic() {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const slice = sliceTv(index);
  const appSlice = sliceTvApp(app);

  ok("index:exact_hero_sub", slice.includes(HERO_SUB));
  ok("index:evening_h3", slice.includes(EVENING_H3));
  ok("index:stations_lead", slice.includes(STATIONS_LEAD));
  ok("index:seo_h3", slice.includes(SEO_H3));
  ok("index:seo_p1", slice.includes(SEO_P1));
  ok("index:seo_p2", slice.includes(SEO_P2));
  ok("index:seo_p3", slice.includes(SEO_P3));
  ok("index:marker", slice.includes("tv-program-neutral-v1-20260906"));
  ok("index:rec_filmy", slice.includes(">Filmy<"));
  ok("index:rec_serialy", slice.includes(">Seriály<"));
  ok("index:rec_sport", slice.includes(">Sport<"));
  ok("index:cta_filmy", slice.includes("Zobrazit filmy"));
  ok("index:cta_serialy", slice.includes("Zobrazit seriály"));
  ok("index:cta_sport", slice.includes("Zobrazit sport"));
  ok("index:choice_film", /data-iu-tv-choice="film"/.test(slice));
  ok("app:links_defined", appSlice.includes("IU_TV_PROGRAM_LINKS"));
  ok("app:name_only_mount", appSlice.includes("iuTvPgCard__name") && !appSlice.includes("iuTvPgCard__hint"));
  ok("app:no_row_hint", !appSlice.includes("iuTvProgramChoiceOverlay__rowHint"));
  for (const b of FORBIDDEN) {
    ok("index:no:" + b.slice(0, 36), !slice.includes(b));
    ok("app:no:" + b.slice(0, 36), !appSlice.includes(b));
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

async function openTv(page, baseUrl) {
  await dismissConsent(page);
  await page.goto(`${baseUrl}?section=tvprogram&nosw=1&cb=${Date.now()}`, {
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
  await page.waitForSelector("#iuTvProgramView", { state: "attached", timeout: 90000 });
  await page.evaluate(() => {
    const v = document.getElementById("iuTvProgramView");
    if (v) {
      v.hidden = false;
      try {
        v.removeAttribute("hidden");
      } catch (_) {}
    }
  });
  await page
    .waitForSelector("#iuTvProgramVerifiedHost a.iuTvPgHit", { state: "attached", timeout: 90000 })
    .catch(() => null);
}

auditStatic();
if (fails.length) {
  console.log(
    JSON.stringify({ IU_TV_PROGRAM_NEUTRAL_PRESENTATION_GUARD: "FAIL", phase: "static", fails }, null, 2)
  );
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8953", 10);
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
    await openTv(page, `http://127.0.0.1:${PORT}/projects/`);

    const snap = await page.evaluate((forbidden) => {
      const view = document.getElementById("iuTvProgramView");
      const heroSub = (view ? view.querySelector(".iuTvPgHero__sub") : null);
      const hero = (heroSub ? heroSub.textContent : "").replace(/\s+/g, " ").trim();
      const eveningH = (view ? view.querySelector("#iuTvPg-evening h3") : null);
      const evening = (eveningH ? eveningH.textContent : "").replace(/\s+/g, " ").trim();
      const leads = view
        ? [...view.querySelectorAll(".iuTvPgLead")].map((el) =>
            (el.textContent || "").replace(/\s+/g, " ").trim()
          )
        : [];
      const stationsLead = leads.find((t) => t.indexOf("televizní programy") >= 0) || "";
      const cards = [...document.querySelectorAll("#iuTvProgramVerifiedHost a.iuTvPgHit")].map((a) => ({
        text: (a.innerText || "").replace(/\s+/g, " ").trim(),
        href: a.getAttribute("href") || "",
        hasHint: !!(a.querySelector(".iuTvPgCard__hint") && a.querySelector(".iuTvPgCard__hint").offsetParent !== null),
      }));
      const recTitles = [...document.querySelectorAll("#iuTvPg-evening .iuTvPgRecCard__title")].map((el) =>
        (el.textContent || "").replace(/\s+/g, " ").trim()
      );
      const overflow = view ? view.scrollWidth > view.clientWidth + 1 : false;
      const bodyText = view ? view.textContent || "" : "";
      const forbiddenHit = forbidden.find((b) => bodyText.includes(b) || hero.includes(b));
      return {
        hero,
        evening,
        stationsLead,
        cardCount: cards.length,
        cards,
        recTitles,
        overflow,
        forbiddenHit: forbiddenHit || null,
      };
    }, FORBIDDEN);

    ok(vp.name + ":hero", snap.hero === HERO_SUB, snap.hero);
    ok(vp.name + ":evening", snap.evening === EVENING_H3, snap.evening);
    ok(vp.name + ":stations_lead", snap.stationsLead === STATIONS_LEAD, snap.stationsLead);
    ok(vp.name + ":cards", snap.cardCount >= 1, "cards=" + snap.cardCount);
    ok(vp.name + ":https", snap.cards.every((c) => /^https:\/\//i.test(c.href)));
    ok(
      vp.name + ":name_only",
      snap.cards.every((c) => c.text.length > 0 && !c.hasHint && c.text.indexOf("\n") < 0)
    );
    ok(vp.name + ":rec_filmy", snap.recTitles.includes("Filmy"));
    ok(vp.name + ":rec_serialy", snap.recTitles.includes("Seriály"));
    ok(vp.name + ":rec_sport", snap.recTitles.includes("Sport"));
    ok(vp.name + ":no_h_overflow", !snap.overflow);
    ok(vp.name + ":no_forbidden", !snap.forbiddenHit, snap.forbiddenHit);

    const seoDom = await page.evaluate(() => {
      const seo =
        document.querySelector(".iu-tv-seo-block") ||
        document.querySelector('[data-iu-seo-stub="tvprogram"] .iu-tv-seo-block');
      return seo ? (seo.textContent || "").replace(/\s+/g, " ").trim() : "";
    });
    if (seoDom) {
      ok(vp.name + ":seo_h3", seoDom.includes(SEO_H3));
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
      IU_TV_PROGRAM_NEUTRAL_PRESENTATION_GUARD: pass ? "PASS" : "FAIL",
      fails,
      REAL_IOS: "NOT_TESTED",
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
