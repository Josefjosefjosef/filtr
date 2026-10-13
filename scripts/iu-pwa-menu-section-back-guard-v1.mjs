#!/usr/bin/env node
/**
 * Regression: Menu → section → external return must not break first Back (duplicate ?section= history).
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8964", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?nosw=1&iuInfoSystem=cutover`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const net = read("assets/iu-network-connectivity-v1.js");
  const app = read("assets/app.js");
  const html = read("projects/index.html");
  must(/pwa-external-return-unified-v11-20261013-section-layout-external-handoff/.test(net), "static:v11_build");
  must(/iuPwaEarlyCoalesceV1/.test(html), "static:early_coalesce_inline");
  must(/iuPwaPagehideSectionCanonV1/.test(net), "static:pagehide_canon");
  must(/iuPwaWebNavCoalesceSameSectionBackForward/.test(app), "static:coalesce_fn");
  must(/iuWebNavDetailFromGateV1/.test(app), "static:detail_gate_ss");
  must(html.includes("data-iu-cold-section"), "static:cold_section_attr");
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (urlPath.endsWith("/")) urlPath += "index.html";
        const filePath = path.join(REPO, urlPath.replace(/^\/+/, ""));
        if (!filePath.startsWith(REPO) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404);
          res.end("nf");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime =
          ext === ".html"
            ? "text/html; charset=utf-8"
            : ext === ".js"
              ? "text/javascript; charset=utf-8"
              : "application/octet-stream";
        res.writeHead(200, { "content-type": mime });
        res.end(fs.readFileSync(filePath));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function runtimeGate() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.iuPwaWebNavCoalesceSameSectionBackForward, null, { timeout: 60000 });

    const coalesce = await page.evaluate(() => {
      sessionStorage.setItem("iuWebNavDetailFromGateV1", "1");
      sessionStorage.setItem("iuPwaPagehideSectionCanonV1", "/projects/?section=aff-cestovni-kancelare");
      history.replaceState({ iu_webnav_section: true }, "", "/projects/?section=aff-cestovni-kancelare");
      var navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length) {
        try {
          Object.defineProperty(navEntries[0], "type", { configurable: true, value: "back_forward" });
        } catch (_) {}
      }
      return window.iuPwaWebNavCoalesceSameSectionBackForward();
    });
    must(coalesce === true, "rt:coalesce_menu");

    const after = await page.evaluate(() => ({
      hash: location.hash,
      gate: (document.getElementById("iuMobileGateWrap") || {}).getAttribute("data-iu-mobile-gate") || "",
      section: new URL(location.href).searchParams.get("section") || "",
    }));
    must(after.hash === "#iu-nav" || after.hash === "#nav", "rt:coalesce_hash_menu");
    must(after.gate === "nav", "rt:coalesce_gate_nav");
    must(after.section === "", "rt:coalesce_section_cleared");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

async function main() {
  staticGate();
  await runtimeGate();
  if (fails.length) {
    console.log("IU_PWA_MENU_SECTION_BACK_GUARD_PASS=false");
    console.log("FAILS=" + fails.join("|"));
    process.exit(1);
  }
  console.log("IU_PWA_MENU_SECTION_BACK_GUARD_PASS=true");
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
