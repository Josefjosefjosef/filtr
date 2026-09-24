#!/usr/bin/env node
/**
 * Freeze guard: Lékárny → Lékárna Lemon (CJ 14563148), second partner slot (first free after Lékárna.cz).
 * Does not lock remaining empty slots. Lékárna.cz slot 1 unchanged. Section stays at 8 slots.
 * Run: npm run iu-affiliate-lekarna-lemon-lekarny-guard
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

const MARKER = "affiliate-lekarna-lemon-lekarny-v1-20260923";
const CATALOG_BUST = "affiliate-catalog-network-first-v1-20260924";
const SW_TOKEN = "2026-09-24-affiliate-catalog-network-first-v1";
const SECTION = "aff-lekarny";
const SECTION_TITLE = "Lékárny";
const PARTNER_TITLE = "Lékárna Lemon";
const CJ_URL = "https://www.jdoqocy.com/click-101883843-14563148";
const LEKARNA_CZ_CJ = "https://www.kqzyfj.com/click-101883843-15734937";
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu-affiliate-lekarna-lemon-lekarny-guard-report.json"
);
const PORT = 8765 + Math.floor(Math.random() * 200);

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function lekarnyBlock(catalog) {
  const blockStart = catalog.indexOf('id: "aff-lekarny"');
  const blockEnd = catalog.indexOf('id: "aff-zdravi-doplnky"', blockStart);
  return blockStart >= 0 && blockEnd > blockStart ? catalog.slice(blockStart, blockEnd) : "";
}

function auditStatic() {
  const catalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const allow = fs.readFileSync(
    path.join(ROOT, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs"),
    "utf8"
  );

  ok("catalog:section_id", catalog.includes('id: "' + SECTION + '"'));
  ok("catalog:section_title", catalog.includes('title: "' + SECTION_TITLE + '"'));
  ok("catalog:cj_url_exact", catalog.includes(CJ_URL));
  ok(
    "catalog:no_direct_lemon_href",
    !/id:\s*"aff-lekarny"[\s\S]*?affPartner\(\s*"Lékárna Lemon"\s*,\s*"https:\/\/(?:www\.)?lekarnalemon\.cz/i.test(
      catalog
    )
  );
  ok(
    "catalog:lemon_partner",
    /affPartner\(\s*"Lékárna Lemon"\s*,\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-14563148"\s*\)/.test(
      catalog
    )
  );
  ok(
    "catalog:slot2_lemon_after_lekarna",
    /id:\s*"aff-lekarny"[\s\S]*?affPartner\(\s*"Lékárna\.cz"[\s\S]*?affPartner\(\s*"Lékárna Lemon"/.test(
      catalog
    )
  );
  ok("catalog:lekarna_cz_unchanged", catalog.includes(LEKARNA_CZ_CJ));

  const block = lekarnyBlock(catalog);
  const slotCalls = (block.match(/aff(?:Item|Partner)\(/g) || []).length;
  ok("catalog:slots_8", slotCalls === 8, "n=" + slotCalls);
  ok("catalog:lemon_in_block", block.includes("14563148"));
  ok("catalog:not_in_zdravi", !/id:\s*"aff-zdravi-doplnky"[\s\S]*?14563148/.test(catalog));

  ok("index:marker", index.includes(MARKER));
  ok("index:catalog_bust", index.includes("iu-affiliate-catalog.js?v=" + CATALOG_BUST));
  ok("sw:token", sw.includes('CACHE_VERSION = "' + SW_TOKEN + '"'));
  ok("allowlist:token", allow.includes('"' + SW_TOKEN + '"'));
  ok("allowlist:current", allow.includes('IU_SW_CACHE_VERSION_CURRENT = "' + SW_TOKEN + '"'));
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
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-08-v1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
    const b = document.getElementById("iuConsentAllowStats");
    if (b) b.click();
    const layer = document.getElementById("iuConsentLayer");
    if (layer) layer.remove();
  });
}

async function openAff(page, baseUrl) {
  await dismissConsent(page);
  await page.goto(`${baseUrl}?section=${SECTION}&nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await dismissConsent(page);
  await page
    .waitForFunction(() => typeof window.iuAffiliateApplySection === "function", null, { timeout: 90000 })
    .catch(() => null);
  await page.evaluate((sec) => {
    try {
      if (typeof window.iuAffiliateApplySection === "function") window.iuAffiliateApplySection(sec);
    } catch (_) {}
  }, SECTION);
  await page.waitForSelector("#iuAffiliateView", { state: "attached", timeout: 90000 });
  await page.evaluate(() => {
    const v = document.getElementById("iuAffiliateView");
    if (v) {
      v.hidden = false;
      v.removeAttribute("hidden");
    }
  });
  await page.waitForFunction(
    () => document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip").length === 8,
    null,
    { timeout: 90000 }
  );
}

auditStatic();
if (fails.length) {
  const out = { IU_AFFILIATE_LEKARNA_LEMON_LEKARNY_GUARD: "FAIL", phase: "static", fails };
  fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

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

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, hasTouch: true },
  { name: "tablet", width: 768, height: 1024, hasTouch: true },
  { name: "desktop", width: 1280, height: 800, hasTouch: false },
  { name: "pwa", width: 390, height: 844, hasTouch: true, pwa: true },
];

const browser = await chromium.launch({ headless: true });
const samples = [];

try {
  for (const vp of VIEWPORTS) {
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.hasTouch,
    });
    if (vp.pwa) {
      await context.addInitScript(() => {
        try {
          Object.defineProperty(navigator, "standalone", { get: () => true });
        } catch (_) {}
      });
    }
    const page = await bootstrapGuardPage(context);
    await openAff(page, `http://127.0.0.1:${PORT}/projects/`);

    const snap = await page.evaluate(({ partner, lekarnaCz }) => {
      const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
      const chipText = (c) => {
        const t = c.querySelector(".iuRadioChipTitle");
        return ((t ? t.textContent : c.textContent) || "").replace(/\s+/g, " ").trim();
      };
      const lemon = chips.find((c) => chipText(c) === partner) || null;
      const first = chips[0] || null;
      const second = chips[1] || null;
      let centered = false;
      if (lemon) {
        const cs = getComputedStyle(lemon);
        centered =
          cs.display.includes("flex") &&
          (cs.justifyContent === "center" || cs.justifyContent === "safe center") &&
          (cs.alignItems === "center" || cs.alignItems === "safe center");
      }
      return {
        title: (document.getElementById("iuAffiliateTitle")?.textContent || "").trim(),
        slots: chips.length,
        firstText: first ? chipText(first) : "",
        secondText: second ? chipText(second) : "",
        lemonText: lemon ? chipText(lemon) : "",
        lemonHref: lemon ? lemon.getAttribute("href") || "" : "",
        lemonTarget: lemon ? lemon.getAttribute("target") || "" : "",
        lemonRel: lemon ? lemon.getAttribute("rel") || "" : "",
        lemonReady: lemon ? lemon.getAttribute("data-aff-ready") || "" : "",
        hasImg: lemon ? !!lemon.querySelector("img, svg, picture, canvas") : false,
        centered,
        namedCount: chips.filter((c) => chipText(c) !== "").length,
        lekarnaCzStillFirst: first ? chipText(first) === lekarnaCz : false,
      };
    }, { partner: PARTNER_TITLE, lekarnaCz: "Lékárna.cz" });

    const tag = vp.name;
    ok(tag + ":title", snap.title === SECTION_TITLE, snap.title);
    ok(tag + ":slots_8", snap.slots === 8, "n=" + snap.slots);
    ok(tag + ":lekarna_cz_slot1", snap.lekarnaCzStillFirst && snap.firstText === "Lékárna.cz", snap.firstText);
    ok(tag + ":second_slot_lemon", snap.secondText === PARTNER_TITLE, snap.secondText);
    ok(tag + ":lemon_text", snap.lemonText === PARTNER_TITLE, snap.lemonText);
    ok(tag + ":lemon_href", snap.lemonHref === CJ_URL, snap.lemonHref);
    ok(tag + ":lemon_target", snap.lemonTarget === "_blank", snap.lemonTarget);
    ok(tag + ":lemon_rel_sponsored", /\bsponsored\b/.test(snap.lemonRel), snap.lemonRel);
    ok(tag + ":lemon_rel_noopener", /\bnoopener\b/.test(snap.lemonRel), snap.lemonRel);
    ok(tag + ":lemon_no_nofollow", !/\bnofollow\b/.test(snap.lemonRel));
    ok(tag + ":lemon_no_noreferrer", !/\bnoreferrer\b/.test(snap.lemonRel));
    ok(tag + ":lemon_ready", snap.lemonReady === "1", snap.lemonReady);
    ok(tag + ":lemon_no_img", snap.hasImg === false);
    ok(
      tag + ":lemon_no_direct",
      !/^https?:\/\/(?:www\.)?lekarnalemon\.cz/i.test(snap.lemonHref)
    );
    ok(tag + ":centered", snap.centered === true);
    ok(tag + ":empty_slots_remain", snap.namedCount === 2, "named=" + snap.namedCount);

    const popupPromise = page.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
    await page
      .locator("#iuAffiliateGrid a.iuAffiliateChip[data-aff-ready='1']")
      .filter({ hasText: PARTNER_TITLE })
      .click();
    const popup = await popupPromise;
    ok(tag + ":popup_opened", !!popup);
    if (popup) {
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 20000 });
      } catch (_) {}
      const popupUrl = popup.url();
      ok(
        tag + ":popup_cj_or_site",
        /jdoqocy\.com\/click-101883843-14563148/i.test(popupUrl) || /lekarnalemon\.cz/i.test(popupUrl),
        popupUrl
      );
      await popup.close().catch(() => {});
    }

    samples.push({
      vp: vp.name,
      secondText: snap.secondText,
      lemonHref: snap.lemonHref,
      slots: snap.slots,
      namedCount: snap.namedCount,
    });
    await context.close();
  }
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

const pass = fails.length === 0;
const out = {
  IU_AFFILIATE_LEKARNA_LEMON_LEKARNY_GUARD: pass ? "PASS" : "FAIL",
  fails,
  samples,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
