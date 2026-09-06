#!/usr/bin/env node
/**
 * Guard: TV online — neutral presentation (no ranking/live/pricing copy).
 * Run: npm run iu-tv-online-neutral-presentation-guard
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

const INTRO = "Odkazy na vybrané televizní a streamovací služby dostupné online.";
const SEO_H3 = "TV online – odkazy na vybrané externí služby";
const SEO_P1 =
  "Sekce TV online obsahuje odkazy na vybrané externí televizní a streamovací služby. Jednotlivé položky slouží k přechodu na příslušnou externí službu nebo její webové rozhraní.";
const SEO_P2 =
  "Dostupnost vysílání, pořadů, funkcí, předplatného a dalších podmínek určuje vždy provozovatel příslušné externí služby a může se v čase měnit.";
const SEO_P3 =
  "InfoUzel.cz televizní ani streamovací služby neprovozuje a jejich obsah neposkytuje. Sekce slouží jako orientační rozcestník k vybraným externím službám. Nabídka není úplným výčtem televizních stanic, streamovacích platforem ani dalších dostupných služeb.";

const FAQ_NEW = [
  "Kam odkazy v sekci TV online vedou?",
  "Na externí stránky nebo služby jednotlivých poskytovatelů.",
  "Poskytuje InfoUzel.cz televizní nebo streamovací obsah?",
  "Ne. InfoUzel.cz slouží v této sekci jako rozcestník k vybraným externím službám a jejich obsah neprovozuje ani neposkytuje.",
  "Jsou všechny televizní a streamovací služby v sekci uvedeny?",
  "Ne. Jde o výběr externích služeb, nikoli o úplný seznam dostupných televizních stanic nebo streamovacích platforem.",
];

const FAQ_OLD = [
  "Je TV online zdarma?",
  "Funguje TV online na mobilu?",
  "Jaký je rozdíl mezi TV online a streamovací službou?",
];

const FORBIDDEN = [
  "rychlé spuštění oblíbených kanálů",
  "TV online zdarma i placené služby na jednom místě",
  "Přehled televizí online — živé vysílání a rychlé spuštění oblíbených kanálů.",
  "oblíbených kanálů",
  "vše zdarma",
  "oficiální přehrávač",
  "placeným přístupem",
  "knihovnu filmů a seriálů podle tarifu",
];

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function sliceTvOnline(index) {
  const m = index.match(/id="iuLazyViewTpl-tvonline"[\s\S]*?<\/template>/);
  const seo = index.match(
    /data-iu-seo-stub="tvonline"[\s\S]*?<\/div>\s*<div id="iuMobileMindMenuFlow"/
  );
  // Fallback if following markup changes:
  const seo2 = index.match(/data-iu-seo-stub="tvonline"[\s\S]*?<\/section>\s*<\/div>/);
  return (m ? m[0] : "") + "\n" + (seo ? seo[0] : seo2 ? seo2[0] : "");
}

function auditStatic() {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const slice = sliceTvOnline(index);

  ok("index:exact_intro", slice.includes(INTRO));
  ok("index:seo_h3", slice.includes(SEO_H3));
  ok("index:seo_p1", slice.includes(SEO_P1));
  ok("index:seo_p2", slice.includes(SEO_P2));
  ok("index:seo_p3", slice.includes(SEO_P3));
  ok("index:marker", slice.includes("tv-online-neutral-v1-20260907"));
  ok("index:no_chip_desc", !/<span class="iuRadioChipDesc/.test(slice));
  ok("index:name_only_class", /iuRadioChip--nameOnly/.test(slice));
  ok("index:chips_present", (slice.match(/class="iuRadioChip /g) || []).length >= 1);
  for (const f of FAQ_NEW) {
    ok("index:faq:" + f.slice(0, 28), slice.includes(f));
  }
  for (const f of FAQ_OLD) {
    ok("index:no_old_faq:" + f.slice(0, 28), !slice.includes(f));
  }
  for (const b of FORBIDDEN) {
    ok("index:no:" + b.slice(0, 36), !slice.includes(b));
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

async function openTvOnline(page, baseUrl) {
  await dismissConsent(page);
  await page.goto(`${baseUrl}?section=tvonline&nosw=1&cb=${Date.now()}`, {
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
  await page.waitForSelector("#iuTvOnlineView", { state: "attached", timeout: 90000 });
  await page.evaluate(() => {
    const v = document.getElementById("iuTvOnlineView");
    if (v) {
      v.hidden = false;
      try {
        v.removeAttribute("hidden");
      } catch (_) {}
    }
  });
  await page.waitForSelector("#iuTvOnlineView a.iuRadioChip", { state: "attached", timeout: 90000 });
}

auditStatic();
if (fails.length) {
  console.log(
    JSON.stringify({ IU_TV_ONLINE_NEUTRAL_PRESENTATION_GUARD: "FAIL", phase: "static", fails }, null, 2)
  );
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8955", 10);
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
    await openTvOnline(page, `http://127.0.0.1:${PORT}/projects/`);

    const snap = await page.evaluate((args) => {
      const forbidden = args.forbidden;
      const faqOld = args.faqOld;
      const view = document.getElementById("iuTvOnlineView");
      const introEl = view ? view.querySelector(".iuSectionSubtitle") : null;
      const intro = (introEl ? introEl.textContent : "").replace(/\s+/g, " ").trim();
      const chips = [...document.querySelectorAll("#iuTvOnlineView a.iuRadioChip")].map((a) => ({
        text: (a.innerText || "").replace(/\s+/g, " ").trim(),
        href: a.getAttribute("href") || "",
        hasDesc: !!a.querySelector(".iuRadioChipDesc"),
      }));
      const overflow = view ? view.scrollWidth > view.clientWidth + 1 : false;
      const bodyText = view ? view.textContent || "" : "";
      const forbiddenHit = forbidden.find((b) => bodyText.includes(b) || intro.includes(b));
      const oldFaqHit = faqOld.find((b) => bodyText.includes(b));
      return {
        intro,
        chipCount: chips.length,
        chips,
        overflow,
        forbiddenHit: forbiddenHit || null,
        oldFaqHit: oldFaqHit || null,
      };
    }, { forbidden: FORBIDDEN, faqOld: FAQ_OLD });

    ok(vp.name + ":intro", snap.intro === INTRO, snap.intro);
    ok(vp.name + ":chips", snap.chipCount >= 1, "chips=" + snap.chipCount);
    ok(vp.name + ":https", snap.chips.every((c) => /^https:\/\//i.test(c.href)));
    ok(vp.name + ":name_only", snap.chips.every((c) => c.text.length > 0 && !c.hasDesc));
    ok(vp.name + ":no_h_overflow", !snap.overflow);
    ok(vp.name + ":no_forbidden", !snap.forbiddenHit, snap.forbiddenHit);
    ok(vp.name + ":no_old_faq", !snap.oldFaqHit, snap.oldFaqHit);

    const seoDom = await page.evaluate(() => {
      const seo =
        document.querySelector(".iu-tv-online-seo") ||
        document.querySelector('[data-iu-seo-stub="tvonline"] .iu-tv-online-seo');
      return seo ? (seo.textContent || "").replace(/\s+/g, " ").trim() : "";
    });
    if (seoDom) {
      ok(vp.name + ":seo_h3", seoDom.includes(SEO_H3));
      ok(vp.name + ":seo_p1", seoDom.includes(SEO_P1));
      ok(vp.name + ":seo_p2", seoDom.includes(SEO_P2));
      ok(vp.name + ":seo_p3", seoDom.includes(SEO_P3));
      for (const f of FAQ_NEW) {
        ok(vp.name + ":seo_faq:" + f.slice(0, 24), seoDom.includes(f));
      }
      for (const f of FAQ_OLD) {
        ok(vp.name + ":seo_no_old:" + f.slice(0, 24), !seoDom.includes(f));
      }
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
      IU_TV_ONLINE_NEUTRAL_PRESENTATION_GUARD: pass ? "PASS" : "FAIL",
      fails,
      REAL_IOS: "NOT_TESTED",
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
