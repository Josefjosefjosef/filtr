#!/usr/bin/env node
/**
 * Guard: Rádio — neutral presentation (no ranking/descriptive blurbs).
 * Run: npm run iu-radio-neutral-presentation-guard
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
  "Online rádia na jeden klik — rychlé odkazy na vybrané české rozhlasové stanice.";
const SEO_P1 =
  "Sekce Rádio na infoUzel.cz slouží jako rychlý rozcestník na vybrané české rozhlasové stanice. Sekce obsahuje odkazy například na Radiožurnál, Dvojku, Vltavu, Evropu 2, Impuls, Fajn rádio, Kiss, Rádio Beat a Blaník.";
const SEO_P2 =
  "infoUzel.cz rozhlasové vysílání přímo nepřehrává. Po výběru stanice je uživatel přesměrován na příslušnou externí stránku nebo online vysílání dané stanice.";
const FAQ =
  "Ne. infoUzel.cz poskytuje odkazy na externí stránky nebo online vysílání jednotlivých rozhlasových stanic.";

const FORBIDDEN_BLURBS = [
  "Zpravodajství ČRo",
  "Mluvené slovo",
  "Kultura a hudba",
  "Pop a zábava",
  "Hity + servis",
  "Aktuální hity",
  "Hudba a zábava",
  "České hity",
  "zpravodajství Českého rozhlasu",
  "ověřený zdroj",
  "vždy pokračuje",
  "nejoblíbenější",
];

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function sliceRadio(index) {
  const m = index.match(/id="iuLazyViewTpl-radio"[\s\S]*?<\/template>/);
  const seo = index.match(/data-iu-seo-stub="radio"[\s\S]*?<\/div>\s*<template id="iuLazyViewTpl-tvonline"/);
  return (m ? m[0] : "") + "\n" + (seo ? seo[0] : "");
}

function auditStatic() {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const overlay = fs.readFileSync(path.join(ROOT, "assets", "iu-radio-overlay.css"), "utf8");
  const radioSlice = sliceRadio(index);

  ok("index:exact_intro", radioSlice.includes(INTRO));
  ok("index:no_nejoblibenejsi", !/nejoblíbenější/i.test(radioSlice));
  ok("index:seo_p1", radioSlice.includes(SEO_P1));
  ok("index:seo_p2", radioSlice.includes(SEO_P2));
  ok("index:faq", radioSlice.includes(FAQ));
  ok("index:napriklad", /například na Radiožurnál/.test(radioSlice));
  ok("index:overlay_css_link", /iu-radio-overlay\.css\?v=/.test(index));
  ok("index:overlay_frag", /"iu-radio-overlay\.css"/.test(index));
  for (const b of FORBIDDEN_BLURBS) {
    ok("index:no_blurb:" + b.slice(0, 24), !radioSlice.includes(b));
  }
  ok("index:no_chip_desc", !/<span class="iuRadioChipDesc">/.test(radioSlice));
  ok("index:list_no_dash_blurbs", !/<li>[^<]+ — /.test(radioSlice));

  const radioItemsMatch = app.match(/const RADIO_ITEMS = \[([\s\S]*?)\];/);
  ok("app:radio_items", !!radioItemsMatch);
  if (radioItemsMatch) {
    const block = radioItemsMatch[0];
    ok("app:no_desc_field", !/\bdesc\s*:/.test(block));
    ok("app:name_only_class", /iuRadioChip--nameOnly/.test(app));
    ok("app:urls_https", /https:\/\/radiozurnal\.rozhlas\.cz\//.test(block));
    ok("app:no_forbidden_in_items", !FORBIDDEN_BLURBS.some((b) => block.includes(b)));
  }
  ok("css:radio_scoped", /#iuRadioView/.test(overlay) && /iuRadioChip--nameOnly/.test(overlay));
  ok("css:hide_desc", /\.iuRadioChipDesc[\s\S]{0,40}display:\s*none/.test(overlay));
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

async function openRadio(page, baseUrl) {
  await dismissConsent(page);
  await page.goto(`${baseUrl}?section=radio&nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await dismissConsent(page);
  await page.waitForFunction(() => typeof window.iuApplySectionFromURL === "function", null, {
    timeout: 90000,
  }).catch(() => null);
  await page.evaluate(() => {
    try {
      if (typeof window.iuApplySectionFromURL === "function") window.iuApplySectionFromURL();
    } catch (_) {}
  });
  await page.waitForSelector("#iuRadioView .iuRadioChip", { state: "attached", timeout: 90000 });
  await page.evaluate(() => {
    const v = document.getElementById("iuRadioView");
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
  console.log(JSON.stringify({ IU_RADIO_NEUTRAL_PRESENTATION_GUARD: "FAIL", phase: "static", fails }, null, 2));
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8947", 10);
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
    await openRadio(page, `http://127.0.0.1:${PORT}/projects/`);

    const snap = await page.evaluate((forbidden) => {
      const view = document.getElementById("iuRadioView");
      const intro = (document.getElementById("iuRadioIntroShort") || {}).textContent || "";
      const chips = [...document.querySelectorAll("#iuRadioView .iuRadioChip")].map((a) => ({
        text: (a.innerText || "").replace(/\s+/g, " ").trim(),
        href: a.getAttribute("href") || "",
        hasDesc: !!a.querySelector(".iuRadioChipDesc"),
      }));
      const seo = document.getElementById("iuRadioSeoBlock") || document.querySelector(".iu-radio-seo-block");
      const seoText = seo ? seo.textContent || "" : "";
      const overflow = view ? view.scrollWidth > view.clientWidth + 1 : false;
      const forbiddenHit = forbidden.find((b) => {
        const inChips = chips.some((c) => (c.text || "").includes(b));
        return inChips || (intro || "").includes(b);
      });
      return {
        intro: intro.replace(/\s+/g, " ").trim(),
        chipCount: chips.length,
        chips,
        hasSeo: !!seo,
        seoText: seoText.replace(/\s+/g, " ").trim(),
        overflow,
        forbiddenHit: forbiddenHit || null,
      };
    }, FORBIDDEN_BLURBS);

    ok(vp.name + ":intro", snap.intro === INTRO, snap.intro);
    ok(vp.name + ":chips", snap.chipCount >= 1);
    ok(vp.name + ":no_desc_nodes", snap.chips.every((c) => !c.hasDesc));
    ok(
      vp.name + ":titles_only",
      snap.chips.every((c) => c.text && !c.text.includes("—") && !FORBIDDEN_BLURBS.some((b) => c.text.includes(b)))
    );
    ok(vp.name + ":https", snap.chips.every((c) => /^https:\/\//i.test(c.href)));
    ok(vp.name + ":no_h_overflow", !snap.overflow);
    ok(vp.name + ":no_forbidden_in_view", !snap.forbiddenHit, snap.forbiddenHit);

    // SEO stub may stay hidden; check DOM source still present
    const seoDom = await page.evaluate(() => {
      const seo =
        document.getElementById("iuRadioSeoBlock") ||
        document.querySelector('[data-iu-seo-stub="radio"] .iu-radio-seo-block');
      return seo ? (seo.textContent || "").replace(/\s+/g, " ").trim() : "";
    });
    if (seoDom) {
      ok(vp.name + ":seo_p1", seoDom.includes(SEO_P1.split(".")[0]));
      ok(vp.name + ":seo_napriklad", seoDom.includes("například"));
      ok(vp.name + ":seo_p2", seoDom.includes("rozhlasové vysílání přímo nepřehrává"));
      ok(vp.name + ":faq", seoDom.includes(FAQ));
      ok(vp.name + ":no_overeny", !seoDom.includes("ověřený zdroj"));
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
      IU_RADIO_NEUTRAL_PRESENTATION_GUARD: pass ? "PASS" : "FAIL",
      fails,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
