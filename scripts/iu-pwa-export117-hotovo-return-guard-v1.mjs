#!/usr/bin/env node
/**
 * Export 117: Hotovo return must keep return-boot through shell setTab(tools) and new-document head boot.
 * Simulates process-death / navigate reload with durable pending markers (not same-document visibility only).
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}
function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const html = read("projects/index.html");
  const net = read("assets/iu-network-connectivity-v1.js");
  const shell = read("assets/iu-mobile-bottom-nav-shell-v1.js");
  const feed = read("assets/iu-app-feed-pipeline-v1.js");
  const ver = read("assets/iu-pwa-version-check.js");
  must(/v14-20261016-hotovo-boot-hold/.test(net), "static:net_v14_build");
  must(/iuPwaExternalReturnPostSettleV1/.test(net), "static:post_settle_ls");
  must(/iuPwaMenuNavReturnPersistV1/.test(net), "static:menu_nav_persist_ls");
  must(/readMainScrollReturnAtHead/.test(html), "static:head_main_scroll_boot");
  must(/readMenuNavReturnAtHead/.test(html), "static:head_menu_nav_boot");
  must(/deferShellBootRelease/.test(shell), "static:shell_defer_boot_release_var");
  must(/iuMindMenuHasReturnGuard\(\)/.test(shell), "static:shell_defer_return_guard");
  must(/iuMindMenuHasReturnGuard\(\)/.test(feed), "static:feed_defer_return_guard");
  must(/iuPwaExternalReturnPostSettleV1/.test(ver), "static:version_check_post_settle");
  must(/export118-video-home-diag/.test(read("assets/iu-pwa-return-recorder-v1.js")), "static:recorder_export118");
  must(/data-iu-pwa-return-boot-mode="home"/.test(html), "static:home_boot_shell_css");
  must(/mm_return_boot_release/.test(read("assets/iu-pwa-return-recorder-v1.js")), "static:recorder_boot_release_trace");
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
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function simColdDocumentReturn(page, scenario) {
  await page.goto(scenario.url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate((sc) => {
    localStorage.removeItem("iuPwaExternalReturnMainScrollPersistV1");
    localStorage.removeItem("iuPwaMenuNavReturnPersistV1");
    localStorage.removeItem("iuPwaExternalReturnPostSettleV1");
    localStorage.removeItem("iuMindMenuReturnPendingV1");
    sessionStorage.removeItem("iuMindMenuReturnArmed");
    sessionStorage.removeItem("iuMindMenuReturnLatchTs");
    if (sc.mindMenu) {
      localStorage.setItem(
        "iuMindMenuReturnPendingV1",
        JSON.stringify({ t: Date.now(), y: sc.scrollY || 809, ai: 0, aiY: 0 })
      );
      sessionStorage.setItem("iuMindMenuReturnArmed", "1");
    } else {
      localStorage.removeItem("iuMindMenuReturnPendingV1");
      sessionStorage.removeItem("iuMindMenuReturnArmed");
    }
    if (sc.mainY) {
      localStorage.setItem(
        "iuPwaExternalReturnMainScrollPersistV1",
        JSON.stringify({ y: sc.mainY, t: Date.now(), gen: 1, route: "home" })
      );
    }
    if (sc.menuNav) {
      localStorage.setItem(
        "iuPwaMenuNavReturnPersistV1",
        JSON.stringify({ y: sc.menuY || 420, t: Date.now(), gate: "nav" })
      );
    }
  }, scenario);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => !!document.body, null, { timeout: 60000 });
  const headMode = await page.evaluate(() => document.documentElement.getAttribute("data-iu-pwa-return-boot-mode") || "");
  const samples = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      out.push({
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        gate: (document.getElementById("iuMobileGateWrap") || {}).getAttribute?.("data-iu-mobile-gate") || "",
        mode: document.documentElement.getAttribute("data-iu-pwa-return-boot-mode") || "",
        feedVis: (() => {
          const f = document.getElementById("feed");
          if (!f) return "missing";
          const st = getComputedStyle(f);
          return st.visibility;
        })(),
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  });
  const early = samples.slice(0, 4);
  must(early.some((s) => s.boot), `${scenario.id}:early_boot_class`);
  if (scenario.expectTools) {
    must(early.some((s) => s.gate === "tools"), `${scenario.id}:early_gate_tools`);
  }
  if (scenario.expectNav) {
    const menuRaw = await page.evaluate(() => localStorage.getItem("iuPwaMenuNavReturnPersistV1") || "");
    must(
      headMode === "nav" || early.some((s) => s.gate === "nav" || s.mode === "nav"),
      `${scenario.id}:early_gate_nav headMode=${headMode} menuRaw=${menuRaw.slice(0, 80)}`
    );
  }
  if (scenario.expectHomeHidden) {
    must(early.every((s) => s.feedVis === "hidden"), `${scenario.id}:feed_hidden_early`);
  }
}

async function main() {
  staticGate();
  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/projects/?nosw=1`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      } catch (_) {}
      try {
        window.matchMedia = (q) => {
          const s = String(q || "");
          if (s.indexOf("display-mode: standalone") >= 0) return { matches: true, media: s };
          if (s.indexOf("max-width: 1023px") >= 0) return { matches: true, media: s };
          if (s.indexOf("max-width: 900px") >= 0) return { matches: true, media: s };
          return { matches: false, media: s };
        };
      } catch (_) {}
    });
    await simColdDocumentReturn(page, {
      id: "mindmenu_colddoc",
      url: base,
      mindMenu: true,
      scrollY: 809,
      expectTools: true,
    });
    await simColdDocumentReturn(page, {
      id: "home_main_scroll",
      url: base,
      mainY: 1338,
      expectHomeHidden: true,
    });
    await simColdDocumentReturn(page, {
      id: "menu_nav",
      url: base,
      menuNav: true,
      menuY: 420,
      expectNav: true,
    });
  } finally {
    await browser.close();
    server.close();
  }
  if (fails.length) {
    console.log("IU_PWA_EXPORT117_HOTovo_RETURN_GUARD=FAIL");
    console.log(fails.join(","));
    process.exit(1);
  }
  console.log("IU_PWA_EXPORT117_HOTovo_RETURN_GUARD=PASS");
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
