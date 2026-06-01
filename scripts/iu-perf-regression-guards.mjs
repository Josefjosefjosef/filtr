#!/usr/bin/env node
/**
 * CI/local: flicker phase sampling + 16 rail buttons nav latency + calendar/Silver surface proof.
 * No screenshots. Uses projects-static-and-vin server (same family as other Playwright proofs).
 *
 * Run: npm run iu-perf-regression-guards
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8892", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const SKIP_LATENCY = process.env.IU_PERF_GUARDS_SKIP_LATENCY === "1";
const SKIP_CALENDAR = process.env.IU_PERF_GUARDS_SKIP_CALENDAR === "1";
const SKIP_UI = process.env.IU_PERF_GUARDS_SKIP_UI === "1";

const BUTTONS = [
  { name: "Počasí & Radar", accent: "pocasi", nonFeed: true, expect: { section: "pocasi", view: "pocasi", topic: null } },
  { name: "Mapy & Navigace", accent: "mapy", nonFeed: true, expect: { section: "mapy", view: "mapy", topic: null } },
  { name: "Jízdní řády", accent: "jr", nonFeed: true, expect: { section: "jr", view: "jr", topic: null } },
  { name: "TV program", accent: "tvprogram", nonFeed: true, expect: { section: "tvprogram", view: "tvprogram", topic: null } },
  { name: "TV online", accent: "tvonline", nonFeed: true, expect: { section: "tvonline", view: "tvonline", topic: null } },
  { name: "Rádia", accent: "radio", nonFeed: true, expect: { section: "radio", view: "radio", topic: null } },
  { name: "Média", accent: "media", nonFeed: false, expect: { section: "feed", view: "media", topic: "" } },
  { name: "Zprávy", accent: "zpravy", nonFeed: false, expect: { section: "feed", view: "media", topic: "zpravy" } },
  { name: "Sport", accent: "sport", nonFeed: false, expect: { section: "feed", view: "media", topic: "sport" } },
  { name: "Finance", accent: "finance", nonFeed: false, expect: { section: "feed", view: "media", topic: "finance" } },
  { name: "Zdraví", accent: "zdravi", nonFeed: false, expect: { section: "feed", view: "media", topic: "zdravi" } },
  { name: "Cestování", accent: "travel", nonFeed: false, expect: { section: "travel", view: "travel", topic: null } },
  { name: "Hry", accent: "hry", nonFeed: false, expect: { section: "hry", view: "media", topic: null } },
  { name: "Kultura / Akce", accent: "kultura", nonFeed: false, expect: { section: "kultura", view: "media", topic: null } },
  { name: "Věda & Historie", accent: "veda", nonFeed: false, expect: { section: "veda", view: "media", topic: null } },
  { name: "Vzdělávání", accent: "vzdelavani", nonFeed: false, expect: { section: "vzdelavani", view: "media", topic: null } },
];

const NF_VISIBLE_MAX = 200;
const NF_STABLE_MAX = 2800;
const FEED_VISIBLE_MAX = 300;
/** Feed nav uses trimmed median of N samples (drop min/max) — single-shot rAF timing is flaky on CI near 200ms. */
const FEED_VISIBLE_SAMPLES = 5;
/** Fail if multi-flash signature churn exceeds this (baseline+fix both ~1 in practice). */
const FLICKER_PHASES_MAX = 6;

function medianOf(nums) {
  const a = nums.filter((n) => n != null && Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round(((a[mid - 1] + a[mid]) / 2) * 100) / 100;
}

/** Drop one outlier at each tail when N>=5; main single-sample p50 ~206ms, CI flake at 216ms. */
function feedVisibleMsFromSamples(samples) {
  const a = samples.filter((n) => n != null && Number.isFinite(n)).sort((x, y) => x - y);
  if (a.length >= 5) return medianOf(a.slice(1, -1));
  return medianOf(a);
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
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function measureNavOnce(page, btn) {
  await page.goto(BASE + "?iuRobust=1", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(`#iuLeftRail a[data-accent="${btn.accent}"]`, { timeout: 60000 });
  await page.waitForTimeout(350);

  return page.evaluate(async ({ ac, exp, nonFeed }) => {
    function navMatches(ex) {
      const u = new URL(location.href);
      const sec = (document.body && document.body.getAttribute("data-section")) || "";
      const topic = u.searchParams.get("topic") || "";
      const center = document.getElementById("iuCenterStage");
      const view = center && center.getAttribute("data-view");
      if (sec !== ex.section || view !== ex.view) return false;
      if (ex.topic !== null && ex.topic !== undefined) {
        if (ex.topic === "") {
          if (topic && topic !== "all") return false;
        } else if (topic !== ex.topic) return false;
      }
      return true;
    }

    const L = { longTasks: [], t_pd: null, t_visible: null, t_stable: null };
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration > 50) {
            L.longTasks.push({ startTime: e.startTime, duration: e.duration });
          }
        }
      });
      po.observe({ entryTypes: ["longtask"] });
    } catch (e) {}

    const el = document.querySelector(`#iuLeftRail a[data-accent="${ac}"]`);
    if (!el) return { error: "no rail link" };

    el.addEventListener(
      "pointerdown",
      () => {
        L.t_pd = performance.now();
      },
      true
    );

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", clientX: cx, clientY: cy, view: window })
    );
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
    el.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", clientX: cx, clientY: cy, view: window })
    );
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));

    const t0 = performance.now();
    await new Promise((resolve) => {
      function step() {
        if (navMatches(exp)) {
          L.t_visible = performance.now();
          let n = 0;
          function rafChain() {
            n++;
            if (n >= 4) {
              L.t_stable = performance.now();
              resolve();
            } else requestAnimationFrame(rafChain);
          }
          requestAnimationFrame(rafChain);
        } else if (performance.now() - t0 < 20000) {
          requestAnimationFrame(step);
        } else resolve();
      }
      requestAnimationFrame(step);
    });

    const pd = L.t_pd;
    const rel = (t) => (t == null || pd == null ? null : Math.round((t - pd) * 100) / 100);

    let badLtBeforeVisible = 0;
    if (pd != null && L.t_visible != null) {
      for (const e of L.longTasks) {
        if (e.startTime >= pd && e.startTime < L.t_visible && e.duration > 50) badLtBeforeVisible++;
      }
    }

    return {
      inputToVisibleMs: rel(L.t_visible),
      inputToStableMs: rel(L.t_stable),
      badLongTasksBeforeVisible: badLtBeforeVisible,
      nonFeed,
    };
  }, { ac: btn.accent, exp: btn.expect, nonFeed: btn.nonFeed });
}

async function runFlickerPhaseGuard(page) {
  await page.goto(BASE + "?iuFlickerGuard=1", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(600);

  return page.evaluate(() => {
    return new Promise((resolve, reject) => {
      try {
        const transitions = [];
        let lastSig = "";
        let lastParts = null;
        const keys = [
          "htmlBg",
          "htmlBgImg",
          "bodyBg",
          "bodyBgImg",
          "bodyClass",
          "dataSection",
          "dataView",
          "iuHomeHidden",
          "appOpacity",
          "appVisibility",
        ];
        const maxFrames = 160;
        let frame = 0;

        function readParts() {
          const html = document.documentElement;
          const body = document.body;
          const app = document.getElementById("app");
          const home = document.getElementById("iuHomeView");
          const cs = (n) => (n ? getComputedStyle(n) : null);
          const h = cs(html);
          const b = cs(body);
          const a = app ? cs(app) : null;
          return {
            htmlBg: h?.backgroundColor || "",
            htmlBgImg: h?.backgroundImage || "",
            bodyBg: b?.backgroundColor || "",
            bodyBgImg: b?.backgroundImage || "",
            bodyClass: body?.className || "",
            dataSection: body?.getAttribute("data-section") || "",
            dataView: document.getElementById("iuCenterStage")?.getAttribute("data-view") || "",
            iuHomeHidden: home ? String(home.hidden) : "no",
            appOpacity: a?.opacity || "",
            appVisibility: a?.visibility || "",
          };
        }

        function sample() {
          const parts = readParts();
          const sig = keys.map((k) => parts[k]).join("||");
          if (sig !== lastSig) {
            const changed = {};
            if (lastParts) {
              for (const k of keys) {
                if (lastParts[k] !== parts[k]) changed[k] = { from: lastParts[k], to: parts[k] };
              }
            }
            transitions.push({ frame, tMs: Math.round(performance.now() * 100) / 100, changed });
            lastSig = sig;
            lastParts = parts;
          }
          frame++;
          if (frame < maxFrames) requestAnimationFrame(sample);
          else {
            resolve({
              visualPhaseCount: transitions.length,
              transitions,
            });
          }
        }
        requestAnimationFrame(sample);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function runCalendarSilverSurface(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.iuSilverCalendarEngine !== "undefined", null, { timeout: 120000 });

  const summary = await page.evaluate(() => {
    const line = document.getElementById("iuSilverCalendarSummaryLine1");
    const t = line ? String(line.textContent || "").trim() : "";
    return { ok: t.indexOf("Kalendář") === 0, text: t.slice(0, 80) };
  });
  if (!summary.ok) {
    return { summary, disambig: null, error: "calendar summary line missing Kalendář prefix" };
  }

  const phrase = "Ulož zítra v 11 schůzka zubař";
  await page.fill("#iuSilverHomeInput", phrase);
  await page.click("#iuSilverHomeSend");
  await page.waitForSelector("#iuSilverChatOverlay:not([hidden])", { timeout: 60000 });
  /**
   * Phrase "Ulož zítra v 11 schůzka zubař" may route either to:
   * - STORAGE_DISAMBIGUATION (storage chooser), or
   * - direct calendar.create (P1 explicit calendar anchor: schůzka + zítra) with event draft card.
   * Wait for a single stable outcome; do not assume disambiguation always appears.
   */
  await page.waitForFunction(
    () => {
      if (document.querySelector('[data-iu-silver-storage-disambiguation="1"]')) return true;
      const cards = document.querySelectorAll('[data-iu-silver-draft-card="1"]');
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const k = c.getAttribute("data-iu-silver-draft-kind");
        if (k === "note" || k === "task") continue;
        return true;
      }
      return false;
    },
    null,
    { timeout: 30000 }
  );

  const disambig = await page.evaluate(() => {
    const dis = document.querySelector('[data-iu-silver-storage-disambiguation="1"]');
    const btn = document.querySelector('[data-iu-silver-action="storage-calendar"]');
    let calendarDraftEl = null;
    const cards = document.querySelectorAll('[data-iu-silver-draft-card="1"]');
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const k = c.getAttribute("data-iu-silver-draft-kind");
      if (k === "note" || k === "task") continue;
      calendarDraftEl = c;
      break;
    }
    const mode = dis ? "storage_disambiguation" : calendarDraftEl ? "calendar_draft_direct" : "unknown";
    const saveInDraft =
      !!calendarDraftEl && !!(calendarDraftEl.querySelector && calendarDraftEl.querySelector('[data-iu-silver-action="save"]'));
    return {
      mode,
      calendarButtonFound: !!btn,
      inDisambigCard: !!(btn && btn.closest && btn.closest("[data-iu-silver-storage-disambiguation=\"1\"]")),
      calendarDraftFound: !!calendarDraftEl,
      calendarDraftHasSave: saveInDraft,
    };
  });

  return { summary, disambig };
}

async function runDesktopUiSanity(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const rail = !!document.getElementById("iuLeftRail");
    const mm = !!(document.querySelector(".mindMenu") || document.querySelector("aside.accordionCol"));
    let aiSized = false;
    if (typeof window.iuAiPanelOpenSurface === "function") {
      try {
        window.iuAiPanelOpenSurface();
        const p = document.getElementById("iu-aiPanel");
        const r = p ? p.getBoundingClientRect() : null;
        aiSized = !!(p && r && r.width > 4 && r.height > 4);
      } catch (e) {
        aiSized = false;
      }
    }
    return { leftRail: rail, mindMenuOrAccordion: mm, aiPanelSized: aiSized };
  });
}

async function main() {
  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static-and-vin.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForPort("127.0.0.1", PORT, 30000);

  const browser = await chromium.launch({ headless: true });
  const fails = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let flick;
    try {
      flick = await runFlickerPhaseGuard(page);
    } catch (e) {
      fails.push("flicker evaluate failed: " + (e && e.message ? e.message : e));
      flick = { error: String(e) };
    }
    await page.close();

    if (flick && flick.visualPhaseCount != null && flick.visualPhaseCount > FLICKER_PHASES_MAX) {
      fails.push("flicker visualPhaseCount " + flick.visualPhaseCount + " > " + FLICKER_PHASES_MAX);
    }

    const flickOut =
      flick && flick.visualPhaseCount != null
        ? {
            visualPhaseCount: flick.visualPhaseCount,
            transitionSamples: (flick.transitions || []).length,
            firstPhaseChangedKeys:
              flick.transitions && flick.transitions[0] && flick.transitions[0].changed
                ? Object.keys(flick.transitions[0].changed)
                : [],
          }
        : flick;
    console.log(JSON.stringify({ flicker: flickOut }));

    if (!SKIP_LATENCY) {
      const ctx = await browser.newContext();
      for (const btn of BUTTONS) {
        const sampleCount = btn.nonFeed ? 1 : FEED_VISIBLE_SAMPLES;
        const visSamples = [];
        let lastRow = null;
        for (let si = 0; si < sampleCount; si++) {
          const p = await ctx.newPage({ viewport: { width: 1440, height: 900 } });
          const row = await measureNavOnce(p, btn);
          await p.close();
          if (row.error) {
            fails.push(btn.name + ": " + row.error);
            lastRow = null;
            break;
          }
          lastRow = row;
          if (!btn.nonFeed && row.inputToVisibleMs != null) visSamples.push(row.inputToVisibleMs);
        }
        if (!lastRow) continue;
        const row = lastRow;
        const vis = btn.nonFeed ? row.inputToVisibleMs : feedVisibleMsFromSamples(visSamples);
        const stab = row.inputToStableMs;
        const blt = row.badLongTasksBeforeVisible || 0;
        if (vis == null || stab == null) {
          fails.push(btn.name + ": nav not settled");
          continue;
        }
        if (!btn.nonFeed && visSamples.length) {
          console.log(
            JSON.stringify({
              navLatency: { name: btn.name, feedVisibleSamples: visSamples, feedVisibleTrimmedMedianMs: vis },
            })
          );
        }
        if (btn.nonFeed) {
          if (vis > NF_VISIBLE_MAX) fails.push(btn.name + ": non-feed visible " + vis + "ms > " + NF_VISIBLE_MAX);
          if (stab > NF_STABLE_MAX) fails.push(btn.name + ": non-feed stable " + stab + "ms > " + NF_STABLE_MAX);
        } else {
          if (vis > FEED_VISIBLE_MAX) fails.push(btn.name + ": feed visible " + vis + "ms > " + FEED_VISIBLE_MAX);
        }
        if (blt > 1) fails.push(btn.name + ": long tasks >50ms before visible (count " + blt + ", allow 1)");
      }
      await ctx.close();
    }

    if (!SKIP_CALENDAR) {
      const pCal = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      let cal;
      try {
        cal = await runCalendarSilverSurface(pCal);
      } catch (e) {
        fails.push("calendar surface: " + (e && e.message ? e.message : e));
        cal = { error: String(e) };
      }
      await pCal.close();

      if (cal && cal.error) fails.push(cal.error);
      if (cal && cal.disambig && cal.disambig.mode === "storage_disambiguation" && !cal.disambig.calendarButtonFound) {
        fails.push("Silver storage-calendar control not found after disambiguation flow");
      }
      if (cal && cal.disambig && cal.disambig.mode === "calendar_draft_direct" && !cal.disambig.calendarDraftHasSave) {
        fails.push("Silver calendar draft surface missing save control after direct routing");
      }
      if (cal && cal.disambig && cal.disambig.mode === "unknown") {
        fails.push("Silver calendar surface: neither storage disambiguation nor calendar draft appeared");
      }

      console.log(JSON.stringify({ calendarSilverSurface: cal }));
    }

    if (!SKIP_UI) {
      const pUi = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      let ui;
      try {
        ui = await runDesktopUiSanity(pUi);
      } catch (e) {
        fails.push("desktop UI: " + (e && e.message ? e.message : e));
        ui = null;
      }
      await pUi.close();
      if (ui) {
        if (!ui.leftRail) fails.push("desktop UI: left rail missing");
        if (!ui.mindMenuOrAccordion) fails.push("desktop UI: mind menu / accordion missing");
        if (!ui.aiPanelSized) fails.push("desktop UI: AI panel not sized after open");
        console.log(JSON.stringify({ desktopUi: ui }));
      }
    }

    if (fails.length) {
      console.error("[iu-perf-regression-guards FAIL]", fails.join(" | "));
      process.exit(1);
    }
    console.log(JSON.stringify({ summary: "PASS" }));
  } finally {
    await browser.close();
    try {
      server.kill("SIGTERM");
    } catch (e) {}
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
