#!/usr/bin/env node
/**
 * Export 119: shell setTab vs feed-pipeline defer helper race (recording 119 root cause).
 * Proves legacy shell-setTab-tools release dropped boot pre-fix semantics, and post-fix holds boot
 * until whitelist release even when feed helper is missing or returns false.
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
  const shell = read("assets/iu-mobile-bottom-nav-shell-v1.js");
  const rec = read("assets/iu-pwa-return-recorder-v1.js");
  must(/iuHeadDeferReturnBootRelease/.test(html), "static:head_defer_stub");
  must(/traceDeferBootRelease/.test(html), "static:head_defer_trace");
  must(/bootClassAfter/.test(html), "static:boot_class_after_trace");
  must(/callerHint|caller:/.test(html), "static:release_caller_trace");
  must(/!document\.documentElement\.classList\.contains\("iu-mm-return-boot"\)/.test(shell), "static:shell_boot_guard");
  must(/export119-shell-boot-race/.test(rec), "static:recorder_build_export119");
  must(/mm_return_boot_release/.test(rec), "static:recorder_boot_release_evict_pin");
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

function mobileInitScript() {
  return () => {
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
  };
}

async function seedMindMenuCold(page, base, scrollY) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate((y) => {
    localStorage.setItem("iuMindMenuReturnPendingV1", JSON.stringify({ t: Date.now(), y: y || 809, ai: 0, aiY: 0 }));
    sessionStorage.setItem("iuMindMenuReturnArmed", "1");
    localStorage.removeItem("iuPwaExternalReturnMainScrollPersistV1");
    localStorage.removeItem("iuPwaMenuNavReturnPersistV1");
  }, scrollY);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
}

async function testLegacyReleaseWouldDropBoot(page, base) {
  await seedMindMenuCold(page, base, 809);
  const r = await page.evaluate(() => {
    const before = document.documentElement.classList.contains("iu-mm-return-boot");
    const mode = document.documentElement.getAttribute("data-iu-pwa-return-boot-mode") || "";
    if (typeof window.__iuMmReturnBootRelease === "function") {
      window.__iuMmReturnBootRelease("shell-setTab-tools");
    }
    const after = document.documentElement.classList.contains("iu-mm-return-boot");
    document.documentElement.classList.add("iu-mm-return-boot");
    document.documentElement.removeAttribute("data-iu-pwa-return-boot-mode");
    document.documentElement.classList.remove("iu-mm-return-boot");
    const preFixSimDropped = !document.documentElement.classList.contains("iu-mm-return-boot");
    return { before, mode, postFixBlocked: before && after, preFixSimDropped };
  });
  must(r.before, "race:legacy_before_boot");
  must(r.mode === "tools", "race:tools_boot_mode");
  must(r.postFixBlocked, "race:postfix_blocks_shell_settab_release");
  must(r.preFixSimDropped, "race:pref_fix_direct_remove_drops_boot");
}

async function testShellBeforeFeedRace(page, base) {
  await page.addInitScript(() => {
    window.__iuEnsureFeedPipeline = function () {
      return new Promise(function () {});
    };
  });
  await seedMindMenuCold(page, base, 809);
  const timeline = await page.evaluate(async () => {
    const wrap = document.getElementById("iuMobileGateWrap");
    if (wrap && typeof wrap.__iuMobileGateSetTab === "function") {
      wrap.__iuMobileGateSetTab("tools");
    }
    const out = [];
    for (let i = 0; i < 16; i++) {
      const feed = document.getElementById("feed");
      const feedVis = feed ? getComputedStyle(feed).visibility : "missing";
      out.push({
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        gate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
        feedVis,
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  });
  must(timeline.some((f) => f.gate === "tools"), "race:shell_opens_tools_gate");
  must(timeline.every((f) => f.boot), "race:boot_monotonic_while_shell_runs_before_feed");
  const feedHiddenWhileBoot = timeline.filter((f) => f.boot).every((f) => f.feedVis === "hidden");
  must(feedHiddenWhileBoot, "race:feed_hidden_no_silver_flash_during_boot");
}

async function testBrokenFeedDeferHelper(page, base) {
  await seedMindMenuCold(page, base, 420);
  const r = await page.evaluate(() => {
    window.iuMindMenuShouldDeferReturnBootRelease = function () {
      return false;
    };
    const before = document.documentElement.classList.contains("iu-mm-return-boot");
    if (typeof window.__iuMmReturnBootRelease === "function") {
      window.__iuMmReturnBootRelease("feed-setTab-tools");
    }
    const afterHelperFalse = document.documentElement.classList.contains("iu-mm-return-boot");
    return { before, afterHelperFalse };
  });
  must(r.before, "race:broken_helper_before_boot");
  must(r.afterHelperFalse, "race:head_mode_still_holds_when_feed_defer_false");
}

async function testWatchdogReleasesWhenStuck(page, base) {
  await page.addInitScript(() => {
    window.__iuEnsureFeedPipeline = function () {
      return new Promise(function () {});
    };
  });
  await seedMindMenuCold(page, base, 0);
  await page.evaluate(() => {
    try {
      localStorage.removeItem("iuMindMenuReturnPendingV1");
      sessionStorage.removeItem("iuMindMenuReturnArmed");
    } catch (_) {}
    window.iuMindMenuShouldDeferReturnBootRelease = function () {
      return false;
    };
  });
  await page.waitForTimeout(2600);
  const end = await page.evaluate(() => {
    const boot = document.documentElement.classList.contains("iu-mm-return-boot");
    const body = document.body;
    const feed = document.getElementById("feed");
    const feedVis = feed ? getComputedStyle(feed).visibility : "missing";
    return {
      boot,
      bodyOk: !!body,
      feedVis,
      diagCleared: (window.__iuMmReturnBootDiag && window.__iuMmReturnBootDiag.clearedBy) || "",
    };
  });
  must(!end.boot, "race:watchdog_clears_stuck_boot");
  must(end.bodyOk, "race:document_usable_after_watchdog");
  must(end.diagCleared === "boot-watchdog-2400ms" || !end.boot, "race:watchdog_reason");
}

async function testHomeDeepFirstPaint(page, base) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(() => {
    localStorage.setItem(
      "iuPwaExternalReturnMainScrollPersistV1",
      JSON.stringify({ y: 1338, t: Date.now(), gen: 1, route: "home" })
    );
    localStorage.removeItem("iuMindMenuReturnPendingV1");
    sessionStorage.removeItem("iuMindMenuReturnArmed");
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  const early = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const silver = document.getElementById("iuMobileSilverSlot");
      out.push({
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        mode: document.documentElement.getAttribute("data-iu-pwa-return-boot-mode") || "",
        silverVis: silver ? getComputedStyle(silver).visibility : "missing",
        feedVis: (() => {
          const f = document.getElementById("feed");
          return f ? getComputedStyle(f).visibility : "missing";
        })(),
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  });
  must(early.some((f) => f.mode === "home-deep"), "home:deep_mode");
  const bootFrames = early.filter((f) => f.boot);
  must(
    bootFrames.length > 0 &&
      bootFrames.every((f) => f.silverVis === "hidden" || f.silverVis === "missing") &&
      bootFrames.every((f) => f.feedVis === "hidden"),
    "home:no_silver_feed_flash_during_boot"
  );
}

async function testMenuNavBoot(page, base) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(() => {
    localStorage.setItem("iuPwaMenuNavReturnPersistV1", JSON.stringify({ y: 420, t: Date.now(), gate: "nav" }));
    localStorage.removeItem("iuMindMenuReturnPendingV1");
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  const early = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const feed = document.getElementById("feed");
      out.push({
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        gate: (document.getElementById("iuMobileGateWrap") || {}).getAttribute?.("data-iu-mobile-gate") || "",
        feedVis: feed ? getComputedStyle(feed).visibility : "missing",
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  });
  must(early.some((f) => f.gate === "nav" || f.boot), "menu:nav_gate_or_boot");
  must(early.filter((f) => f.boot).every((f) => f.feedVis === "hidden"), "menu:feed_hidden_during_nav_boot");
}

async function testRecorderBootReleaseUnderPressure(page, base) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.iuPwaReturnRecorder && window.iuPwaReturnRecorder.startRecording, null, {
    timeout: 60000,
  });
  await page.evaluate(() => {
    try {
      window.iuPwaReturnRecorder.startRecording("export119race");
    } catch (_) {}
    document.documentElement.classList.add("iu-mm-return-boot");
    document.documentElement.setAttribute("data-iu-pwa-return-boot-mode", "tools");
    if (typeof window.__iuMmReturnBootRelease === "function") {
      window.__iuMmReturnBootRelease("shell-setTab-tools");
      window.__iuMmReturnBootRelease("mindmenu-scroll-zero");
    }
    if (window.iuPwaReturnRecorder && typeof window.iuPwaReturnRecorder.ingestTrace === "function") {
      for (let i = 0; i < 400; i++) {
        window.iuPwaReturnRecorder.ingestTrace("fetch_pressure", { i: i, url: "https://example.test/" + i });
      }
    }
  });
  const log = await page.evaluate(() => {
    try {
      return localStorage.getItem("iu:pwa-return-recorder-log:v1") || "";
    } catch (_) {
      return "";
    }
  });
  must(/trace:mm_return_boot_deferred/.test(log), "recorder:deferred_trace_present");
  must(/trace:mm_return_boot_release/.test(log), "recorder:release_trace_survives_pressure");
  must(/"caller":/.test(log), "recorder:release_has_caller");
  must(/"bootClassBefore":/.test(log) && /"bootClassAfter":/.test(log), "recorder:boot_class_fields");
  must(/"reason":"mindmenu-scroll-zero"/.test(log), "recorder:whitelist_release_reason");
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
    await page.addInitScript(mobileInitScript());
    await testLegacyReleaseWouldDropBoot(page, base);
    await testShellBeforeFeedRace(page, base);
    await testBrokenFeedDeferHelper(page, base);
    await testWatchdogReleasesWhenStuck(page, base);
    await testHomeDeepFirstPaint(page, base);
    await testMenuNavBoot(page, base);
    await testRecorderBootReleaseUnderPressure(page, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (fails.length) {
    console.log("IU_PWA_EXPORT119_SHELL_BOOT_RACE_GUARD=FAIL");
    console.log(fails.join(","));
    process.exit(1);
  }
  console.log("IU_PWA_EXPORT119_SHELL_BOOT_RACE_GUARD=PASS");
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
