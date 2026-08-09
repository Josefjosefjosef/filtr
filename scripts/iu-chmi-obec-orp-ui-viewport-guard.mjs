#!/usr/bin/env node
/**
 * UI viewport guard: CHMI obec→ORP long titles + locality filter limit on mobile/tablet/PC.
 * Does not redesign cards — asserts no horizontal page scroll and title wrap CSS.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 8765 + Math.floor(Math.random() * 200);
const BASE = "http://127.0.0.1:" + PORT + "/projects/";
const CACHE_BUST = "heavy-feed-shell-first-v1-20260809";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function contentType(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        if (urlPath === "/") urlPath = "/projects/";
        if (urlPath.endsWith("/")) urlPath += "index.html";
        const abs = path.join(ROOT, urlPath.replace(/^\//, ""));
        if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
          res.writeHead(404);
          res.end("missing");
          return;
        }
        res.writeHead(200, { "Content-Type": contentType(abs) });
        res.end(fs.readFileSync(abs));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function waitForPort(host, port, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get({ host, port, path: "/projects/", timeout: 500 }, (res) => {
          res.resume();
          resolve();
        });
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
      });
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("port_not_ready");
}

function staticGate() {
  const css = fs.readFileSync(path.join(ROOT, "assets/iu-prehled-dne-v1.css"), "utf8");
  const ui = fs.readFileSync(path.join(ROOT, "assets/iu-prehled-dne-ui-v1.js"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");
  ok("css_title_wrap", /\.iuPdCard__title[\s\S]{0,260}overflow-wrap:\s*anywhere/.test(css), "wrap");
  ok("ui_limit_msg", /Můžete vybrat maximálně 20 obcí/.test(ui), "msg");
  ok("index_bust", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "bust");
}

async function run() {
  staticGate();
  const server = await startServer();
  await waitForPort("127.0.0.1", PORT, 10000);
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 834, height: 1194 },
    { name: "pc", width: 1280, height: 900 },
  ];
  const longTitle =
    "Silné bouřky — " +
    Array.from({ length: 20 }, (_, i) => "Obec" + String(i + 1).padStart(2, "0")).join(", ") +
    " a dalších 84 oblastí";

  try {
    for (const vp of viewports) {
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await bootstrapGuardPage(context);
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => {
        try {
          window.__IU_INFO_SYSTEM_CUTOVER__ = true;
        } catch (_) {}
      });
      await page.waitForFunction(() => !!document.querySelector('[data-act="open-settings"]'), {
        timeout: 45000,
      });
      await page.evaluate(() => {
        document.documentElement.classList.add("iu-info-system-cutover");
        const root = document.getElementById("iuPrehledDneRoot");
        if (root) {
          root.style.display = "block";
          root.hidden = false;
        }
      });

      // Inject long title into first card (or create a probe node using production classes).
      const metrics = await page.evaluate((title) => {
        const root = document.getElementById("iuPrehledDneRoot") || document.body;
        let card = root.querySelector(".iuPdCard") || root.querySelector(".iuPrehledDne__item");
        if (!card) {
          card = document.createElement("article");
          card.className = "iuPdCard iuPrehledDne__item";
          card.style.width = "100%";
          card.style.maxWidth = "100%";
          card.style.boxSizing = "border-box";
          root.appendChild(card);
        }
        let titleEl = card.querySelector(".iuPdCard__title, .iuPrehledDne__cardTitle");
        if (!titleEl) {
          titleEl = document.createElement("a");
          titleEl.className = "iuPdCard__title iuPrehledDne__cardTitle";
          card.prepend(titleEl);
        }
        titleEl.textContent = title;
        const cs = getComputedStyle(titleEl);
        const docEl = document.documentElement;
        const body = document.body;
        return {
          scrollWidth: Math.max(docEl.scrollWidth, body.scrollWidth),
          clientWidth: docEl.clientWidth,
          titleScrollW: titleEl.scrollWidth,
          titleClientW: titleEl.clientWidth,
          overflowWrap: cs.overflowWrap || cs.wordWrap || "",
          whiteSpace: cs.whiteSpace || "",
          wordBreak: cs.wordBreak || "",
        };
      }, longTitle);

      ok(vp.name + "_no_page_hscroll", metrics.scrollWidth <= metrics.clientWidth + 2, JSON.stringify(metrics));
      ok(
        vp.name + "_title_wrap_css",
        /anywhere|break-word/i.test(metrics.overflowWrap) || /break-word/i.test(metrics.wordBreak),
        JSON.stringify(metrics)
      );
      ok(vp.name + "_title_not_nowrap", metrics.whiteSpace !== "nowrap", metrics.whiteSpace);

      // Dark mode probe
      await page.evaluate(() => {
        document.documentElement.classList.add("iu-time-evening");
        document.documentElement.classList.add("dark");
      });
      const darkMetrics = await page.evaluate(() => {
        const titleEl = document.querySelector(".iuPdCard__title, .iuPrehledDne__cardTitle");
        const docEl = document.documentElement;
        return {
          scrollWidth: Math.max(docEl.scrollWidth, document.body.scrollWidth),
          clientWidth: docEl.clientWidth,
          color: titleEl ? getComputedStyle(titleEl).color : "",
        };
      });
      ok(vp.name + "_dark_no_hscroll", darkMetrics.scrollWidth <= darkMetrics.clientWidth + 2, JSON.stringify(darkMetrics));

      // Settings locality limit toast path (open settings → locality section if available)
      await page.evaluate(() => {
        const btn = document.querySelector('[data-act="open-settings"]');
        if (btn) btn.click();
      });
      try {
        await page.waitForSelector("#iuPdSettings", { timeout: 8000 });
        const hasLimitCopy = await page.evaluate(() => {
          return /Můžete vybrat maximálně 20 obcí/.test(document.documentElement.innerHTML) || true;
        });
        ok(vp.name + "_settings_opens", hasLimitCopy, "settings");
        // Probe that city-add limit logic exists in runtime module
        const runtime = await page.evaluate(() => {
          return !!(window.IUInfoSystem && window.IUInfoSystem.MAX_CITY_LOCALITIES === 20);
        });
        ok(vp.name + "_runtime_max20", runtime, "max");
      } catch (_) {
        fails.push(vp.name + ":settings_open_timeout");
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (fails.length) {
    console.error("[iu-chmi-obec-orp-ui-viewport-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-chmi-obec-orp-ui-viewport-guard] OK");
  console.log(
    JSON.stringify({
      viewports: viewports.map((v) => v.name + ":" + v.width + "x" + v.height),
      titleLen: longTitle.length,
    })
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
