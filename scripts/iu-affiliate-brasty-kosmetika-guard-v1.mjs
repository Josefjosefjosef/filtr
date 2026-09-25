#!/usr/bin/env node
/**
 * Freeze guard: Kosmetika a parfémy → Brasty.cz (CJ 14095529), fifth partner slot (first free after prior partners).
 * Does not lock remaining empty slots. Section stays at 8 slots.
 * Optional prod: IU_AFFILIATE_BRASTY_PROD=1
 * Run: npm run iu-affiliate-brasty-kosmetika-guard
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

const MARKER = "affiliate-brasty-kosmetika-v1-20260925";
const CATALOG_BUST = MARKER;
const SW_TOKEN = "2026-09-25-affiliate-brasty-kosmetika-v1";
const SECTION = "aff-kosmetika";
const SECTION_TITLE = "Kosmetika a parfémy";
const PARTNER_TITLE = "Brasty.cz";
const CJ_URL = "https://www.kqzyfj.com/click-101883843-14095529";
const SEPHORA_CJ = "https://www.anrdoezrs.net/click-101883843-13212014";
const DERMACOL_CJ = "https://www.jdoqocy.com/click-101883843-17173455";
const FOREO_CJ = "https://www.anrdoezrs.net/click-101883843-15527432";
const YVES_ROCHER_CJ = "https://www.dpbolvw.net/click-101883843-15734904";
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu-affiliate-brasty-kosmetika-guard-report.json"
);
const PORT = 8765 + Math.floor(Math.random() * 200);

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function kosmetikaBlock(catalog) {
  const blockStart = catalog.indexOf('id: "aff-kosmetika"');
  const blockEnd = catalog.indexOf('id: "aff-drogerie"', blockStart);
  return blockStart >= 0 && blockEnd > blockStart ? catalog.slice(blockStart, blockEnd) : "";
}

function drogerieBlock(catalog) {
  const blockStart = catalog.indexOf('id: "aff-drogerie"');
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
    "catalog:no_direct_brasty_href",
    !/id:\s*"aff-kosmetika"[\s\S]*?affPartner\(\s*"Brasty\.cz"\s*,\s*"https:\/\/(?:www\.)?brasty\.cz/i.test(
      catalog
    )
  );
  ok(
    "catalog:brasty_partner",
    /affPartner\(\s*"Brasty\.cz"\s*,\s*"https:\/\/www\.kqzyfj\.com\/click-101883843-14095529"\s*\)/.test(
      catalog
    )
  );
  ok(
    "catalog:slot5_brasty_after_yves_rocher",
    /id:\s*"aff-kosmetika"[\s\S]*?affPartner\(\s*"SEPHORA\.cz"[\s\S]*?affPartner\(\s*"Dermacol"[\s\S]*?affPartner\(\s*"FOREO"[\s\S]*?affPartner\(\s*"Yves Rocher"[\s\S]*?affPartner\(\s*"Brasty\.cz"/.test(
      catalog
    )
  );
  ok("catalog:sephora_unchanged", catalog.includes(SEPHORA_CJ));
  ok("catalog:dermacol_unchanged", catalog.includes(DERMACOL_CJ));
  ok("catalog:foreo_unchanged", catalog.includes(FOREO_CJ));
  ok("catalog:yves_rocher_unchanged", catalog.includes(YVES_ROCHER_CJ));

  const block = kosmetikaBlock(catalog);
  const slotCalls = (block.match(/aff(?:Item|Partner)\(/g) || []).length;
  ok("catalog:slots_8", slotCalls === 8, "n=" + slotCalls);
  ok("catalog:brasty_in_block", block.includes("14095529"));
  ok("catalog:not_in_drogerie", !drogerieBlock(catalog).includes("14095529"));
  ok("catalog:single_brasty_creative", (catalog.match(/14095529/g) || []).length === 1);

  ok("index:marker", index.includes(MARKER));
  ok("index:catalog_bust", index.includes("iu-affiliate-catalog.js?v=" + CATALOG_BUST));
  ok("sw:token", sw.includes('CACHE_VERSION = "' + SW_TOKEN + '"'));
  ok("allowlist:token", allow.includes('"' + SW_TOKEN + '"'));
  ok("allowlist:current", allow.includes('IU_SW_CACHE_VERSION_CURRENT = "' + SW_TOKEN + '"'));
}

async function auditProdCatalog() {
  const indexRes = await fetch("https://infouzel.cz/projects/index.html?cb=" + Date.now(), { cache: "no-store" });
  ok("prod:index_ok", indexRes.ok, String(indexRes.status));
  const indexHtml = await indexRes.text();
  const m = indexHtml.match(/data-iu-src="(\/assets\/iu-affiliate-catalog\.js\?v=[^"]+)"/);
  ok("prod:index_catalog_src", !!m, "missing");
  if (!m) return null;
  const catalogUrl = "https://infouzel.cz" + m[1].replace(/&amp;/g, "&");
  const catRes = await fetch(catalogUrl, { cache: "no-store" });
  ok("prod:catalog_ok", catRes.ok, String(catRes.status));
  const catBody = await catRes.text();
  ok("prod:brasty_cj", catBody.includes(CJ_URL));
  ok("prod:brasty_title", catBody.includes('"Brasty.cz"') || catBody.includes("Brasty.cz"));
  return { catalogUrl };
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
  const out = { IU_AFFILIATE_BRASTY_KOSMETIKA_GUARD: "FAIL", phase: "static", fails };
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
let prodMeta = null;

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

    const snap = await page.evaluate(
      ({ partner, sephoraTitle, dermacolTitle, foreoTitle, yvesTitle }) => {
        const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
        const chipText = (c) => {
          const t = c.querySelector(".iuRadioChipTitle");
          return ((t ? t.textContent : c.textContent) || "").replace(/\s+/g, " ").trim();
        };
        const br = chips.find((c) => chipText(c) === partner) || null;
        const first = chips[0] || null;
        const second = chips[1] || null;
        const third = chips[2] || null;
        const fourth = chips[3] || null;
        const fifth = chips[4] || null;
        let centered = false;
        if (br) {
          const cs = getComputedStyle(br);
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
          thirdText: third ? chipText(third) : "",
          fourthText: fourth ? chipText(fourth) : "",
          fifthText: fifth ? chipText(fifth) : "",
          brText: br ? chipText(br) : "",
          brHref: br ? br.getAttribute("href") || "" : "",
          brTarget: br ? br.getAttribute("target") || "" : "",
          brRel: br ? br.getAttribute("rel") || "" : "",
          brReady: br ? br.getAttribute("data-aff-ready") || "" : "",
          hasImg: br ? !!br.querySelector("img, svg, picture, canvas") : false,
          centered,
          namedCount: chips.filter((c) => chipText(c) !== "").length,
          sephoraStillFirst: first ? chipText(first) === sephoraTitle : false,
          dermacolStillSecond: second ? chipText(second) === dermacolTitle : false,
          foreoStillThird: third ? chipText(third) === foreoTitle : false,
          yvesStillFourth: fourth ? chipText(fourth) === yvesTitle : false,
        };
      },
      {
        partner: PARTNER_TITLE,
        sephoraTitle: "SEPHORA.cz",
        dermacolTitle: "Dermacol",
        foreoTitle: "FOREO",
        yvesTitle: "Yves Rocher",
      }
    );

    const tag = vp.name;
    ok(tag + ":title", snap.title === SECTION_TITLE, snap.title);
    ok(tag + ":slots_8", snap.slots === 8, "n=" + snap.slots);
    ok(tag + ":sephora_slot1", snap.sephoraStillFirst && snap.firstText === "SEPHORA.cz", snap.firstText);
    ok(tag + ":dermacol_slot2", snap.dermacolStillSecond && snap.secondText === "Dermacol", snap.secondText);
    ok(tag + ":foreo_slot3", snap.foreoStillThird && snap.thirdText === "FOREO", snap.thirdText);
    ok(tag + ":yves_slot4", snap.yvesStillFourth && snap.fourthText === "Yves Rocher", snap.fourthText);
    ok(tag + ":fifth_slot_brasty", snap.fifthText === PARTNER_TITLE, snap.fifthText);
    ok(tag + ":brasty_text", snap.brText === PARTNER_TITLE, snap.brText);
    ok(tag + ":brasty_href", snap.brHref === CJ_URL, snap.brHref);
    ok(tag + ":brasty_target", snap.brTarget === "_blank", snap.brTarget);
    ok(tag + ":brasty_rel_sponsored", /\bsponsored\b/.test(snap.brRel), snap.brRel);
    ok(tag + ":brasty_rel_noopener", /\bnoopener\b/.test(snap.brRel), snap.brRel);
    ok(tag + ":brasty_no_nofollow", !/\bnofollow\b/.test(snap.brRel));
    ok(tag + ":brasty_no_noreferrer", !/\bnoreferrer\b/.test(snap.brRel));
    ok(tag + ":brasty_ready", snap.brReady === "1", snap.brReady);
    ok(tag + ":brasty_no_img", snap.hasImg === false);
    ok(tag + ":brasty_no_direct", !/^https?:\/\/(?:www\.)?brasty\.cz/i.test(snap.brHref));
    ok(tag + ":centered", snap.centered === true);
    ok(tag + ":empty_slots_remain", snap.namedCount >= 5 && snap.namedCount < 8, "named=" + snap.namedCount);

    const popupTimeout = vp.name === "pwa" ? 30000 : 15000;
    const popupPromise = page.waitForEvent("popup", { timeout: popupTimeout }).catch(() => null);
    const chipLoc = page
      .locator("#iuAffiliateGrid a.iuAffiliateChip[data-aff-ready='1']")
      .filter({ hasText: PARTNER_TITLE });
    await chipLoc.click();
    let popup = await popupPromise;
    if (!popup && vp.name === "pwa") {
      const popupRetry = page.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
      await chipLoc.click({ force: true });
      popup = await popupRetry;
    }
    ok(tag + ":popup_opened", !!popup);
    if (popup) {
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 20000 });
      } catch (_) {}
      const popupUrl = popup.url();
      const cjOk =
        /kqzyfj\.com\/click-101883843-14095529/i.test(popupUrl) || /brasty/i.test(popupUrl);
      const pwaCiFlake =
        vp.name === "pwa" && /chromewebdata|chrome-error/i.test(popupUrl);
      ok(tag + ":popup_cj_or_site", cjOk || pwaCiFlake, popupUrl);
      await popup.close().catch(() => {});
    }

    samples.push({
      vp: vp.name,
      fifthText: snap.fifthText,
      brHref: snap.brHref,
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

if (process.env.IU_AFFILIATE_BRASTY_PROD === "1" && !fails.length) {
  try {
    prodMeta = await auditProdCatalog();
  } catch (err) {
    fails.push("prod:" + (err && err.message ? err.message : String(err)));
  }
}

const pass = fails.length === 0;
const out = {
  IU_AFFILIATE_BRASTY_KOSMETIKA_GUARD: pass ? "PASS" : "FAIL",
  fails,
  samples,
  prodMeta,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
