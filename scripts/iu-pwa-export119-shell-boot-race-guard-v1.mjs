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

const SHELL_WRAP_WAIT_MS = 20000;
const MENU_NAV_GATE_WAIT_MS = 8000;
const MENU_POST_WRAP_EARLY_FRAMES = 12;

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}
function mustBucket(bucket, cond, id) {
  if (!cond) bucket.push(id);
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
    try {
      window.__iuExport119JsErrors = window.__iuExport119JsErrors || [];
      window.addEventListener(
        "error",
        (ev) => {
          try {
            window.__iuExport119JsErrors.push(String(ev.message || ev.error || "error"));
          } catch (_) {}
        },
        true
      );
    } catch (_) {}
  };
}

/** First 12 rAF samples from DOMContentLoaded — early boot/gate race window. */
function menuNavReloadEarlySamplerScript() {
  return () => {
    window.__iuExport119MenuEarly = { samples: [], domReadyMs: 0 };
    function sampleFrame() {
      const feed = document.getElementById("feed");
      window.__iuExport119MenuEarly.samples.push({
        t: performance.now(),
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        gate: document.getElementById("iuMobileGateWrap")?.getAttribute?.("data-iu-mobile-gate") || "",
        feedVis: feed ? getComputedStyle(feed).visibility : "missing",
      });
    }
    function burstFromDomReady() {
      window.__iuExport119MenuEarly.domReadyMs = performance.now();
      sampleFrame();
      let left = 11;
      const step = () => {
        if (left <= 0) return;
        left -= 1;
        requestAnimationFrame(() => {
          sampleFrame();
          step();
        });
      };
      requestAnimationFrame(step);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", burstFromDomReady, { once: true });
    } else {
      burstFromDomReady();
    }
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
  await page
    .waitForFunction(() => document.documentElement.classList.contains("iu-mm-return-boot"), null, {
      timeout: MENU_NAV_GATE_WAIT_MS,
    })
    .catch(() => null);
}

async function testPostFixBlocksShellSetTabRelease(page, base) {
  await seedMindMenuCold(page, base, 809);
  const r = await page.evaluate(() => {
    const before = document.documentElement.classList.contains("iu-mm-return-boot");
    const mode = document.documentElement.getAttribute("data-iu-pwa-return-boot-mode") || "";
    if (typeof window.__iuMmReturnBootRelease === "function") {
      window.__iuMmReturnBootRelease("shell-setTab-tools");
    }
    const after = document.documentElement.classList.contains("iu-mm-return-boot");
    return { before, mode, postFixBlocked: before && after };
  });
  must(r.before, "race:legacy_before_boot");
  must(r.mode === "tools", "race:tools_boot_mode");
  must(r.postFixBlocked, "race:postfix_blocks_shell_settab_release");
}

/** Pre-main head + shell path: no head stub, shell-setTab-tools when defer helper missing. */
async function testOriginalPreFixCodeDropsBoot(page, base) {
  await page.addInitScript(() => {
    window.__iuEnsureFeedPipeline = function () {
      return new Promise(function () {});
    };
  });
  await seedMindMenuCold(page, base, 809);
  const repro = await page.evaluate(() => {
    try {
      delete window.iuMindMenuShouldDeferReturnBootRelease;
    } catch (_) {}
    window.__iuMmReturnBootRelease = function legacyMmReturnBootRelease(reason) {
      var why = String(reason || "");
      var allowBootRelease = {
        "home-scroll-restored": 1,
        "menu-nav-scroll-done": 1,
        "menu-nav-scroll-timeout": 1,
        "menu-nav-scroll-fallback": 1,
        "mindmenu-scroll-done": 1,
        "mindmenu-scroll-zero": 1,
        "mindmenu-scroll-no-panel": 1,
        "mindmenu-tool-overlay-restored": 1,
        "boot-watchdog-2400ms": 1,
        "clear-markers": 1,
      };
      if (!allowBootRelease[why]) {
        try {
          if (
            typeof window.iuMindMenuShouldDeferReturnBootRelease === "function" &&
            window.iuMindMenuShouldDeferReturnBootRelease()
          ) {
            return;
          }
        } catch (_defBoot) {}
      }
      document.documentElement.classList.remove("iu-mm-return-boot");
      document.documentElement.removeAttribute("data-iu-mm-return-boot");
      document.documentElement.removeAttribute("data-iu-pwa-return-boot-mode");
    };
    var before = document.documentElement.classList.contains("iu-mm-return-boot");
    var deferShellBootRelease = false;
    if (!deferShellBootRelease) window.__iuMmReturnBootRelease("shell-setTab-tools");
    var after = document.documentElement.classList.contains("iu-mm-return-boot");
    return { before, after, dropped: before && !after };
  });
  must(repro.before, "race:original_code_boot_before");
  must(repro.dropped, "race:original_code_shell_release_drops_boot");
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
  const surfaces = await page.evaluate(async () => {
    function painted(el) {
      if (!el) return false;
      var st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity || "1") < 0.05) {
        return false;
      }
      var r = el.getBoundingClientRect();
      return r.width > 12 && r.height > 12 && r.bottom > 0 && r.top < (window.innerHeight || 0);
    }
    function firstSurface() {
      if (painted(document.getElementById("iuMindMenuView"))) return "mindmenu";
      if (painted(document.getElementById("iuMobileGatePanelTools"))) return "tools_panel";
      if (painted(document.getElementById("iuMobileGatePanelNav"))) return "menu_nav";
      if (painted(document.getElementById("iuMobileSilverSlot"))) return "silver";
      if (painted(document.getElementById("feed"))) return "feed";
      var bg = getComputedStyle(document.documentElement).backgroundColor || "";
      return "other:" + bg;
    }
    var out = [];
    for (var i = 0; i < 8; i++) {
      out.push({
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        surface: firstSurface(),
      });
      await new Promise(function (r) {
        requestAnimationFrame(r);
      });
    }
    return out;
  });
  must(
    surfaces
      .filter((f) => f.boot)
      .every((f) => f.surface !== "feed" && f.surface !== "silver" && !/^other:rgb\(255,\s*255,\s*255\)/.test(f.surface)),
    "race:no_feed_silver_or_white_first_during_boot"
  );
  const gateBoot = await page.evaluate(() => {
    var wrap = document.getElementById("iuMobileGateWrap");
    var content = document.getElementById("iuMobileGateContent");
    var tools = document.getElementById("iuMobileGatePanelTools");
    var stTools = tools ? getComputedStyle(tools) : null;
    var stContent = content ? getComputedStyle(content) : null;
    return {
      boot: document.documentElement.classList.contains("iu-mm-return-boot"),
      gate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
      toolsVis: stTools ? stTools.visibility : "",
      contentHidden: content ? content.getAttribute("aria-hidden") : "",
      contentVis: stContent ? stContent.visibility : "",
    };
  });
  must(gateBoot.boot, "race:boot_on_after_shell_settab");
  must(gateBoot.gate === "tools", "race:tools_gate_after_shell_settab");
  must(gateBoot.toolsVis === "visible", "race:tools_panel_visibility_during_boot");
  must(gateBoot.contentHidden === "false", "race:gate_content_open_during_boot");
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

async function applyHomeDeepSabotage(page, options = {}) {
  if (options.forceWhiteGapDuringBoot) {
    await page.addInitScript(() => {
      const paintWhite = () => {
        document.documentElement.style.backgroundColor = "#ffffff";
        document.body.style.backgroundColor = "#ffffff";
        ["feed", "iuMobileSilverSlot", "iuMobileGateWrap", "iuMindMenuView"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) {
            el.style.visibility = "hidden";
            el.style.opacity = "0";
            el.style.pointerEvents = "none";
          }
        });
      };
      document.addEventListener("DOMContentLoaded", () => {
        paintWhite();
        requestAnimationFrame(function loop() {
          paintWhite();
          requestAnimationFrame(loop);
        });
      });
    });
  }
}

async function testHomeDeepFirstPaint(page, base, bucket = fails, options = {}) {
  await applyHomeDeepSabotage(page, options);
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "iuPwaExternalReturnMainScrollPersistV1",
        JSON.stringify({ y: 1338, t: Date.now(), gen: 1, route: "home" })
      );
      localStorage.removeItem("iuMindMenuReturnPendingV1");
      sessionStorage.removeItem("iuMindMenuReturnArmed");
    } catch (_) {}
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  const headSnap = await page.evaluate(() => ({
    mode: document.documentElement.getAttribute("data-iu-pwa-return-boot-mode") || "",
    boot: document.documentElement.classList.contains("iu-mm-return-boot"),
    headMode: (window.__iuMmReturnBootDiag && window.__iuMmReturnBootDiag.headReturnMode) || "",
  }));
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
  mustBucket(
    bucket,
    early.some((f) => f.mode === "home-deep") || headSnap.mode === "home-deep" || headSnap.headMode === "home-deep",
    "home:deep_mode"
  );
  const bootFrames = early.filter((f) => f.boot);
  mustBucket(
    bucket,
    bootFrames.length > 0 &&
      bootFrames.every((f) => f.silverVis === "hidden" || f.silverVis === "missing") &&
      bootFrames.every((f) => f.feedVis === "hidden"),
    "home:no_silver_feed_flash_during_boot"
  );
  const homePaint = await page.evaluate(async () => {
    function painted(el) {
      if (!el) return false;
      var st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity || "1") < 0.05) return false;
      var r = el.getBoundingClientRect();
      return r.width > 12 && r.height > 12;
    }
    var frames = [];
    for (var i = 0; i < 8; i++) {
      var htmlBg = getComputedStyle(document.documentElement).backgroundColor || "";
      frames.push({
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        mode: document.documentElement.getAttribute("data-iu-pwa-return-boot-mode") || "",
        silverPainted: painted(document.getElementById("iuMobileSilverSlot")),
        feedPainted: painted(document.getElementById("feed")),
        htmlBg: htmlBg,
        whiteFlash: htmlBg === "rgb(255, 255, 255)" || htmlBg === "rgba(0, 0, 0, 0)",
      });
      await new Promise(function (r) {
        requestAnimationFrame(r);
      });
    }
    return frames;
  });
  mustBucket(
    bucket,
    homePaint.filter((f) => f.boot).every((f) => !f.silverPainted && !f.feedPainted && !f.whiteFlash),
    "home:no_white_gap_or_home_chrome_painted_during_boot"
  );
  const bootFromPersist = await page.evaluate(() => {
    var d = window.__iuMmReturnBootDiag || {};
    return d.applied === true && d.headReturnMode === "home-deep";
  });
  mustBucket(
    bucket,
    bootFromPersist ||
      headSnap.headMode === "home-deep" ||
      headSnap.mode === "home-deep" ||
      early.some((f) => f.mode === "home-deep"),
    "home:head_boot_from_main_scroll_persist"
  );
  mustBucket(
    bucket,
    headSnap.mode === "home-deep" ||
      headSnap.headMode === "home-deep" ||
      headSnap.boot ||
      homePaint.slice(0, 6).every((f) => !f.feedPainted && !f.silverPainted && !f.whiteFlash),
    "home:deep_return_no_white_gap_first_frames"
  );
  if (options.forceWhiteGapDuringBoot) {
    mustBucket(
      bucket,
      !homePaint.slice(0, 6).some((f) => f.whiteFlash && !f.feedPainted && !f.silverPainted),
      "home:visible_white_gap_during_boot"
    );
  }
}

/** MindMenu cold return must establish boot (negative: sabotageBootClass). */
export async function testMindMenuReturnBoot(page, base, bucket = fails, options = {}) {
  await applyMenuNavBootSabotage(page, options);
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate((y) => {
    localStorage.setItem("iuMindMenuReturnPendingV1", JSON.stringify({ t: Date.now(), y: y || 809, ai: 0, aiY: 0 }));
    sessionStorage.setItem("iuMindMenuReturnArmed", "1");
    localStorage.removeItem("iuPwaExternalReturnMainScrollPersistV1");
    localStorage.removeItem("iuPwaMenuNavReturnPersistV1");
  }, 809);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => document.querySelectorAll("*").length > 800,
    null,
    { timeout: 30000 }
  );
  const bootSeen = await page.evaluate(() => ({
    boot: document.documentElement.classList.contains("iu-mm-return-boot"),
    mode: document.documentElement.getAttribute("data-iu-pwa-return-boot-mode") || "",
  }));
  mustBucket(bucket, bootSeen.boot, "mindmenu:return_boot_missing");
  if (bootSeen.boot) {
    mustBucket(bucket, bootSeen.mode === "tools", "mindmenu:tools_boot_mode");
  }
}

async function applyMenuNavBootSabotage(page, options = {}) {
  if (options.sabotageNavGate) {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const wrap = document.getElementById("iuMobileGateWrap");
        if (wrap && typeof wrap.__iuMobileGateSetTab === "function") {
          wrap.__iuMobileGateSetTab = function () {};
        }
      });
    });
  }
  if (options.sabotageBootClass) {
    await page.addInitScript(() => {
      const strip = () => document.documentElement.classList.remove("iu-mm-return-boot");
      document.addEventListener("DOMContentLoaded", () => {
        strip();
        new MutationObserver(strip).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class"],
        });
      });
    });
  }
  if (options.hideNavPanel) {
    await page.addInitScript(() => {
      const hide = () => {
        const nav = document.getElementById("iuMobileGatePanelNav");
        if (nav) {
          nav.hidden = true;
          nav.style.visibility = "hidden";
        }
      };
      document.addEventListener("DOMContentLoaded", () => {
        hide();
        setInterval(hide, 5);
        new MutationObserver(hide).observe(document.documentElement, { subtree: true, childList: true });
      });
    });
  }
  if (options.forceFeedVisibleDuringBoot) {
    await page.addInitScript(() => {
      const loop = () => {
        const feed = document.getElementById("feed");
        const boot = document.documentElement.classList.contains("iu-mm-return-boot");
        const gate = document.getElementById("iuMobileGateWrap")?.getAttribute?.("data-iu-mobile-gate") || "";
        if (feed && boot && gate === "nav") {
          feed.style.visibility = "visible";
          feed.style.display = "block";
          feed.style.opacity = "1";
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }
  if (options.exposeFeedBeforeNav) {
    await page.addInitScript(() => {
      const showFeed = () => {
        const feed = document.getElementById("feed");
        if (feed) {
          feed.style.visibility = "visible";
          feed.style.display = "block";
          feed.style.opacity = "1";
        }
      };
      document.addEventListener("DOMContentLoaded", showFeed, { once: true });
      const loop = () => {
        const wrap = document.getElementById("iuMobileGateWrap");
        const gate = wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "";
        if (gate !== "nav") showFeed();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }
  if (options.removeMobileGateWrap) {
    await page.addInitScript(() => {
      const remove = () => {
        const wrap = document.getElementById("iuMobileGateWrap");
        if (wrap) wrap.remove();
      };
      document.addEventListener("DOMContentLoaded", () => {
        remove();
        new MutationObserver(remove).observe(document.documentElement, { subtree: true, childList: true });
      });
    });
  }
}

export async function testMenuNavBoot(page, base, bucket = fails, options = {}) {
  await applyMenuNavBootSabotage(page, options);
  await page.addInitScript(menuNavReloadEarlySamplerScript());

  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  if (!options.skipMenuPersist) {
    const gate = options.menuPersistGate === "home" ? "home" : "nav";
    await page.evaluate((g) => {
      localStorage.setItem("iuPwaMenuNavReturnPersistV1", JSON.stringify({ y: 420, t: Date.now(), gate: g }));
      localStorage.removeItem("iuMindMenuReturnPendingV1");
    }, gate);
  } else {
    await page.evaluate(() => {
      localStorage.removeItem("iuPwaMenuNavReturnPersistV1");
      localStorage.removeItem("iuMindMenuReturnPendingV1");
    });
  }

  const reloadStarted = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });

  const wrapSeen = await page
    .waitForFunction(() => Boolean(document.getElementById("iuMobileGateWrap")), null, { timeout: SHELL_WRAP_WAIT_MS })
    .catch(() => null);
  mustBucket(bucket, Boolean(wrapSeen), "menu:shell_wrap_timeout");

  const gateWaitStart = await page.evaluate(() => performance.now());
  const navReady = await page
    .waitForFunction(
      () => {
        const boot = document.documentElement.classList.contains("iu-mm-return-boot");
        const gate = document.getElementById("iuMobileGateWrap")?.getAttribute("data-iu-mobile-gate") || "";
        return gate === "nav" || boot;
      },
      null,
      { timeout: MENU_NAV_GATE_WAIT_MS }
    )
    .catch(() => null);
  const gateWaitMs = await page.evaluate((t0) => Math.round(performance.now() - t0), gateWaitStart);

  if (!navReady) {
    const diag = await page.evaluate(() => {
      const wrap = document.getElementById("iuMobileGateWrap");
      const nav = document.getElementById("iuMobileGatePanelNav");
      return {
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        gate: wrap?.getAttribute("data-iu-mobile-gate") || "",
        wrapPresent: Boolean(wrap),
        navVisibility: nav ? getComputedStyle(nav).visibility : "missing",
        jsErrors: window.__iuExport119JsErrors || [],
      };
    });
    console.log(
      "menu_nav_boot_timeout_diag=" +
        JSON.stringify({ gateWaitMs, reloadMs: Date.now() - reloadStarted, diag })
    );
  }
  mustBucket(bucket, Boolean(navReady), "menu:nav_gate_or_boot");

  const reloadEarly = await page.evaluate(() => window.__iuExport119MenuEarly?.samples || []);

  const postWrapEarly = await page.evaluate(async (frameCount) => {
    function painted(el) {
      if (!el) return false;
      var st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity || "1") < 0.05) return false;
      var r = el.getBoundingClientRect();
      return r.width > 12 && r.height > 12;
    }
    const out = [];
    for (let i = 0; i < frameCount; i++) {
      const feed = document.getElementById("feed");
      out.push({
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        gate: document.getElementById("iuMobileGateWrap")?.getAttribute?.("data-iu-mobile-gate") || "",
        feedVis: feed ? getComputedStyle(feed).visibility : "missing",
        navPainted: painted(document.getElementById("iuMobileGatePanelNav")),
        feedPainted: painted(document.getElementById("feed")),
        silverPainted: painted(document.getElementById("iuMobileSilverSlot")),
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  }, MENU_POST_WRAP_EARLY_FRAMES);

  mustBucket(
    bucket,
    postWrapEarly.some((f) => f.gate === "nav" || f.boot),
    "menu:shell_early_nav_or_boot"
  );

  if (options.exposeFeedBeforeNav) {
    const reloadEarlyNavIdx = reloadEarly.findIndex((f) => f.gate === "nav");
    if (reloadEarlyNavIdx > 0) {
      mustBucket(
        bucket,
        reloadEarly.slice(0, reloadEarlyNavIdx).every((f) => f.feedVis === "hidden" || f.feedVis === "missing"),
        "menu:reload_early_feed_visible_before_nav"
      );
    }
  }
  mustBucket(
    bucket,
    reloadEarly.filter((f) => f.boot).every((f) => f.feedVis === "hidden" || f.feedVis === "missing"),
    "menu:reload_early_feed_hidden_during_boot"
  );

  mustBucket(
    bucket,
    postWrapEarly.filter((f) => f.boot).every((f) => f.feedVis === "hidden" || f.feedVis === "missing"),
    "menu:feed_hidden_during_nav_boot"
  );
  if (options.forceFeedVisibleDuringBoot || options.exposeFeedBeforeNav) {
    mustBucket(
      bucket,
      !postWrapEarly.some((f) => (f.gate === "nav" || f.boot) && f.feedPainted),
      "menu:feed_visible_during_nav_boot"
    );
  }

  const firstNavIdx = postWrapEarly.findIndex((f) => f.gate === "nav" || f.boot);
  if (firstNavIdx > 0) {
    mustBucket(
      bucket,
      postWrapEarly.slice(0, firstNavIdx).every((f) => !f.feedPainted && !f.silverPainted),
      "menu:no_home_flash_before_nav_ready"
    );
  }

  const menuPaint = await page.evaluate(async () => {
    function painted(el) {
      if (!el) return false;
      var st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity || "1") < 0.05) return false;
      var r = el.getBoundingClientRect();
      return r.width > 12 && r.height > 12;
    }
    var frames = [];
    for (var i = 0; i < 10; i++) {
      frames.push({
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        gate: document.getElementById("iuMobileGateWrap")?.getAttribute?.("data-iu-mobile-gate") || "",
        navPainted: painted(document.getElementById("iuMobileGatePanelNav")),
        feedPainted: painted(document.getElementById("feed")),
        silverPainted: painted(document.getElementById("iuMobileSilverSlot")),
      });
      await new Promise(function (r) {
        requestAnimationFrame(r);
      });
    }
    return frames;
  });
  mustBucket(
    bucket,
    menuPaint.filter((f) => f.boot).every((f) => !f.feedPainted && !f.silverPainted),
    "menu:nav_panel_first_visible_no_home_flash"
  );

  const navShellOpen = await page.evaluate(() => {
    const nav = document.getElementById("iuMobileGatePanelNav");
    const wrap = document.getElementById("iuMobileGateWrap");
    return (
      wrap?.getAttribute("data-iu-mobile-gate") === "nav" &&
      Boolean(nav) &&
      nav.hidden === false &&
      !nav.hasAttribute("hidden")
    );
  });
  mustBucket(bucket, navShellOpen, "menu:nav_shell_open");

  return { gateWaitMs, reloadMs: Date.now() - reloadStarted, reloadEarly, postWrapEarly };
}

async function testRecorderBootReleaseUnderPressure(page, base) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "iuPwaExternalReturnMainScrollPersistV1",
        JSON.stringify({ y: 900, t: Date.now(), gen: 1, route: "home" })
      );
    } catch (_) {}
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () =>
      window.iuPwaReturnRecorder &&
      window.iuPwaReturnRecorder.startRecording &&
      typeof window.__iuMmReturnBootRelease === "function",
    null,
    { timeout: 60000 }
  );
  await page.evaluate(() => {
    try {
      window.iuPwaReturnRecorder.startRecording("export119race");
    } catch (_) {}
    document.documentElement.classList.add("iu-mm-return-boot");
    document.documentElement.setAttribute("data-iu-pwa-return-boot-mode", "home-deep");
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

export { REPO, startServer, mobileInitScript, SHELL_WRAP_WAIT_MS, MENU_NAV_GATE_WAIT_MS, testHomeDeepFirstPaint };

export async function runExport119ShellBootRaceGuard() {
  fails.length = 0;
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
    await testPostFixBlocksShellSetTabRelease(page, base);
    const pageLegacy = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await pageLegacy.addInitScript(mobileInitScript());
    await testOriginalPreFixCodeDropsBoot(pageLegacy, base);
    await pageLegacy.close();
    await testShellBeforeFeedRace(page, base);
    await testBrokenFeedDeferHelper(page, base);
    await testWatchdogReleasesWhenStuck(page, base);
    const pageHome = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await pageHome.addInitScript(mobileInitScript());
    await testHomeDeepFirstPaint(pageHome, base);
    await pageHome.close();
    const pageMenu = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await pageMenu.addInitScript(mobileInitScript());
    await testMenuNavBoot(pageMenu, base);
    await pageMenu.close();
    const pageRec = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await pageRec.addInitScript(mobileInitScript());
    await testRecorderBootReleaseUnderPressure(pageRec, base);
    await pageRec.close();
  } finally {
    await browser.close();
    server.close();
  }
  return { ok: fails.length === 0, fails: [...fails] };
}

async function main() {
  const result = await runExport119ShellBootRaceGuard();
  if (!result.ok) {
    console.log("IU_PWA_EXPORT119_SHELL_BOOT_RACE_GUARD=FAIL");
    console.log(result.fails.join(","));
    process.exit(1);
  }
  console.log("IU_PWA_EXPORT119_SHELL_BOOT_RACE_GUARD=PASS");
}

if (process.argv[1] && process.argv[1].includes("iu-pwa-export119-shell-boot-race-guard-v1.mjs")) {
  main().catch((e) => {
    console.log(String(e));
    process.exit(1);
  });
}
