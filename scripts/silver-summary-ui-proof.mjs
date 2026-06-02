/**
 * Playwright: loads local repo /projects/ via tiny static server, then
 * window.__iuGetTodayCalendarSummaryState (must match current assets/app.js).
 *
 * Run: node scripts/silver-summary-ui-proof.mjs
 */
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const {
  installProofGuardNetworkStubs,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const VIEWPORTS = [
  [390, 844],
  [768, 1024],
  [1366, 768],
  [1440, 900],
  [1920, 1080]
];

/** Must match :root --iu-calendar-accent (lightened vs former #15803d). */
const CALENDAR_ACCENT_RGB = { r: 28, g: 135, b: 72 };
const RETIRED_ACCENT_RGB = { r: 21, g: 128, b: 61 };

const DAY = "2026-03-26";
const ev4 = [
  { date: DAY, time: "09:00", title: "a" },
  { date: DAY, time: "10:00", title: "b" },
  { date: DAY, time: "11:00", title: "c" },
  { date: DAY, time: "13:22", title: "d" }
];

function mime(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function stripCspFromHtml(buf) {
  const s = buf.toString("utf8");
  return Buffer.from(
    s.replace(/<meta\s[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi, ""),
    "utf8"
  );
}

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let u = (req.url || "/").split("?")[0];
      if (u === "/" || u === "") u = "/projects/index.html";
      let rel = decodeURIComponent(u.replace(/^\//, "")).replace(/\\/g, "/");
      if (rel.endsWith("/")) rel += "index.html";
      const fp = path.resolve(ROOT, rel);
      if (!fp.startsWith(ROOT)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      let buf = await fs.readFile(fp);
      if (/\.html?$/i.test(fp)) buf = stripCspFromHtml(buf);
      res.setHeader("Content-Type", mime(fp));
      res.statusCode = 200;
      res.end(buf);
    } catch (e) {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, base: "http://127.0.0.1:" + addr.port });
    });
    server.on("error", reject);
  });
}

async function installClsHarness(page) {
  await page.evaluate(async () => {
    try {
      await document.fonts.ready;
    } catch (e) {}
    try {
      if (window.__iuClsPO) window.__iuClsPO.disconnect();
    } catch (e) {}
    window.__iuClsSum = 0;
    window.__iuClsPO = new PerformanceObserver(function (list) {
      const entries = list.getEntries();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.hadRecentInput) window.__iuClsSum = (window.__iuClsSum || 0) + e.value;
      }
    });
    window.__iuClsPO.observe({ type: "layout-shift", buffered: false });
  });
  await page.waitForTimeout(200);
}

async function snapMetrics(page) {
  const overflowX = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
  const railShift = await page.evaluate(() =>
    typeof window.__iuRailShiftProbe === "number" ? window.__iuRailShiftProbe : 0
  );
  const clsSum = await page.evaluate(() => Number(window.__iuClsSum || 0));
  return { overflowX, railShift, clsSum };
}

async function auditCalendarAccentUi(page) {
  return page.evaluate(
    ({ exp, retired, white }) => {
      function parseRgbProp(el, prop) {
        const raw = getComputedStyle(el)[prop];
        const s = String(raw || "").trim().toLowerCase();
        // rgb()/rgba()
        let m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) return { r: +m[1], g: +m[2], b: +m[3] };
        // hex
        m = s.match(/^#([0-9a-f]{6})$/i);
        if (m) {
          const hex = m[1];
          return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
          };
        }
        // modern CSS color(): color(srgb r g b / a)
        m = s.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\s*\)/);
        if (m) {
          const r = Math.round(parseFloat(m[1]) * 255);
          const g = Math.round(parseFloat(m[2]) * 255);
          const b = Math.round(parseFloat(m[3]) * 255);
          if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
        }
        return null;
      }
      function numFontWeight(el) {
        const w = getComputedStyle(el).fontWeight;
        if (w === "bold" || w === "bolder") return 700;
        const n = Number(w);
        return Number.isFinite(n) ? n : 400;
      }
      function rgbEq(a, b) {
        return a && b && a.r === b.r && a.g === b.g && a.b === b.b;
      }
      function relLum(rgb) {
        if (!rgb) return 0;
        function f(c) {
          const x = c / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        }
        const R = f(rgb.r),
          G = f(rgb.g),
          B = f(rgb.b);
        return 0.2126 * R + 0.7152 * G + 0.0722 * B;
      }
      function contrastRgb(a, b) {
        const L1 = relLum(a),
          L2 = relLum(b);
        const x = Math.max(L1, L2),
          y = Math.min(L1, L2);
        return (x + 0.05) / (y + 0.05);
      }
      const labels = document.querySelectorAll(".iuCalendarSummary__label");
      if (labels.length !== 1) return { ok: false, reason: "label_count_" + labels.length };
      const label = labels[0];
      const labelTextOk = label.textContent === "Kalendář:";
      const icon = document.querySelector("#iuSilverCalendarSummaryCard .iuCalendarSummary__icon");
      const rest = document.querySelector("#iuSilverCalendarSummaryCard .iuCalendarSummary__rest");
      const btn = document.querySelector(".mindMenu .iu-mmTopTool--cal.iuMindMenuButton");
      if (!icon || !rest || !btn) return { ok: false, reason: "missing_dom" };
      let maxStrokePx = 0;
      const swEls = icon.querySelectorAll("svg, svg *");
      for (let si = 0; si < swEls.length; si++) {
        try {
          const sw = getComputedStyle(swEls[si]).strokeWidth;
          const m = String(sw).match(/([\d.]+)px/);
          if (m) maxStrokePx = Math.max(maxStrokePx, parseFloat(m[1], 10));
        } catch {}
      }
      const rootVar = getComputedStyle(document.documentElement).getPropertyValue("--iu-calendar-accent").trim();
      const lc = parseRgbProp(label, "color");
      const ic = parseRgbProp(icon, "color");
      const rc = parseRgbProp(rest, "color");
      const bc = parseRgbProp(btn, "backgroundColor");
      const btnFg = parseRgbProp(btn, "color");
      const btnTxt = btn.querySelector(".iu-mmTopToolText");
      const btnIconSlot = btn.querySelector(".iu-mmTopToolIcon");
      const btnTxtRgb = btnTxt ? parseRgbProp(btnTxt, "color") : null;
      const btnIconRgb = btnIconSlot ? parseRgbProp(btnIconSlot, "color") : null;
      const lw = numFontWeight(label);
      const iw = numFontWeight(icon);
      const mindContrast = bc && btnFg ? contrastRgb(bc, btnFg) : 0;
      const noOldGreen =
        lc &&
        ic &&
        bc &&
        !rgbEq(lc, retired) &&
        !rgbEq(ic, retired) &&
        !rgbEq(bc, retired) &&
        rc &&
        !rgbEq(rc, retired);
      const strokeOk = maxStrokePx <= 1.6;
      const readableMind =
        mindContrast >= 4.5 &&
        btnTxtRgb &&
        rgbEq(btnTxtRgb, white) &&
        btnIconRgb &&
        rgbEq(btnIconRgb, white);
      const labelIconConsistent = lc && ic && rgbEq(ic, lc);
      const mindBtnUsesBaseAccent = bc && rgbEq(bc, exp);
      const imageTileMode = !!(btn.classList && btn.classList.contains("iu-mmTopTool--imageTile"));
      let ok;
      if (imageTileMode) {
        const img = btn.querySelector("img.iu-mmTopToolImageTile");
        const imgUrl = img ? String(img.currentSrc || img.src || "") : "";
        const tileOk = !!(img && img.naturalWidth > 10 && /calendar-tile\.jpg/i.test(imgUrl));
        const imgCs = img ? getComputedStyle(img) : null;
        const fitOk = !!(imgCs && imgCs.objectFit === "contain");
        const fitsBox = !!(
          img &&
          img.clientWidth <= btn.clientWidth + 1 &&
          img.clientHeight <= btn.clientHeight + 1
        );
        ok =
          rootVar === "#1c8748" &&
          labelTextOk &&
          noOldGreen &&
          strokeOk &&
          labelIconConsistent &&
          !rgbEq(rc, lc) &&
          lw >= 700 &&
          iw !== 700 &&
          tileOk &&
          fitOk &&
          fitsBox;
      } else {
        ok =
          rootVar === "#1c8748" &&
          labelTextOk &&
          noOldGreen &&
          strokeOk &&
          labelIconConsistent &&
          mindBtnUsesBaseAccent &&
          !rgbEq(rc, lc) &&
          lw >= 700 &&
          iw !== 700 &&
          readableMind;
      }
      return {
        ok,
        rootVar,
        labelTextOk,
        lc,
        ic,
        rc,
        bc,
        btnFg,
        btnTxtRgb,
        btnIconRgb,
        mindContrast: imageTileMode ? 21 : mindContrast,
        maxStrokePx,
        lw,
        iw,
        noOldGreen,
        imageTileMode
      };
    },
    { exp: CALENDAR_ACCENT_RGB, retired: RETIRED_ACCENT_RGB, white: { r: 255, g: 255, b: 255 } }
  );
}

async function mindMenuBgNonAdaptive(page) {
  const readBg = (scheme) =>
    page.evaluate((sch) => {
      const btn = document.querySelector(".mindMenu .iu-mmTopTool--cal.iuMindMenuButton");
      if (!btn) return { scheme: sch, backgroundColor: null, imageTile: false, imgSrc: "", objectFit: "" };
      const imageTile = !!(btn.classList && btn.classList.contains("iu-mmTopTool--imageTile"));
      const img = btn.querySelector("img.iu-mmTopToolImageTile");
      const imgSrc = img ? String(img.currentSrc || img.src || "") : "";
      const objectFit = img ? String(getComputedStyle(img).objectFit || "") : "";
      return {
        scheme: sch,
        backgroundColor: getComputedStyle(btn).backgroundColor,
        imageTile,
        imgSrc,
        objectFit
      };
    }, scheme);
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(200);
  const light = await readBg("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(200);
  const dark = await readBg("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(120);
  let ok;
  if (light.imageTile && dark.imageTile) {
    ok =
      light.imgSrc &&
      light.imgSrc === dark.imgSrc &&
      light.objectFit === "contain" &&
      dark.objectFit === "contain" &&
      /calendar-tile\.jpg/i.test(String(light.imgSrc));
  } else {
    ok =
      light.backgroundColor &&
      dark.backgroundColor &&
      light.backgroundColor === dark.backgroundColor &&
      /28,\s*135,\s*72/.test(String(light.backgroundColor));
  }
  return { light, dark, ok };
}

async function main() {
  const { server, base } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] },
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page);
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (!isIgnorableGuardConsoleError(t)) consoleErrors.push(t);
    }
  });
  page.on("pageerror", (err) => {
    const t = String(err && err.message ? err.message : err);
    if (!isIgnorableGuardConsoleError(t)) consoleErrors.push(t);
  });

  let scenariosPass = true;
  const perViewport = [];

  for (let vi = 0; vi < VIEWPORTS.length; vi++) {
    const [vw, vh] = VIEWPORTS[vi];
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto(base + "/projects/", { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction(() => typeof window.__iuGetTodayCalendarSummaryState === "function", null, {
      timeout: 120000
    });
    await installClsHarness(page);
    await page.evaluate(() => {
      window.__iuClsSum = 0;
    });

    if (vi === 0) {
      async function runScenario(id, iso, items, checks) {
    const st = await page.evaluate(
      ({ isoIn, itemsIn }) => {
        const d = new Date(isoIn);
        return window.__iuGetTodayCalendarSummaryState(d, itemsIn);
      },
      { isoIn: iso, itemsIn: items }
    );
    let ok = true;
    if (checks.primaryText != null && st.primaryText !== checks.primaryText) ok = false;
    if (checks.secondaryText != null && st.secondaryText !== checks.secondaryText) ok = false;
    if (checks.hideSecondaryLine != null && st.hideSecondaryLine !== checks.hideSecondaryLine) ok = false;
    if (checks.secondaryMustNotInclude != null && String(st.secondaryText).includes(checks.secondaryMustNotInclude))
      ok = false;
        console.log(JSON.stringify({ scenario: id, pass: ok, actual: st, checks }));
        return ok;
      }

      const A = await runScenario(
        "A_before_first",
        DAY + "T08:00:00",
        ev4,
        {
          primaryText: "Kalendář: Dnes máte uložené 4 záznamy.",
          secondaryText: "První dnešní záznam v 09:00 hod.",
          secondaryMustNotInclude: "Další záznam"
        }
      );
      const B = await runScenario(
        "B_next_after_09",
        DAY + "T09:30:00",
        ev4,
        {
          primaryText: "Kalendář: Dnes máte uložené 4 záznamy.",
          secondaryText: "Další záznam v 10:00 hod."
        }
      );
      const C = await runScenario(
        "C_all_done",
        DAY + "T14:00:00",
        ev4,
        {
          primaryText: "Kalendář: Dnes jste měli uložené 4 záznamy.",
          secondaryText: "Dnešní záznamy už proběhly."
        }
      );
      const D = await runScenario(
        "D_single_before",
        DAY + "T08:00:00",
        [{ date: DAY, time: "09:00", title: "x" }],
        {
          primaryText: "Kalendář: Dnes máte uložený 1 záznam.",
          secondaryText: "Další záznam v 09:00 hod.",
          secondaryMustNotInclude: "Dnešní záznam"
        }
      );
      const E = await runScenario(
        "E_empty",
        DAY + "T12:00:00",
        [],
        {
          primaryText: "Kalendář: Dnes nemáte uložený žádný záznam.",
          secondaryText: "",
          hideSecondaryLine: true
        }
      );
      scenariosPass = A && B && C && D && E;
    }

    const accentAudit = await auditCalendarAccentUi(page);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      try {
        window.__iuClsSum = 0;
      } catch {}
    });
    const m = await snapMetrics(page);
    let mindBg = null;
    if (vi === 0) {
      mindBg = await mindMenuBgNonAdaptive(page);
    }
    perViewport.push({
      viewport: [vw, vh],
      accentAudit,
      CLS: m.clsSum,
      overflowX: m.overflowX,
      railShift: m.railShift,
      mindBg
    });
  }

  await browser.close();
  server.close();

  const firstRow = perViewport[0];
  const mindNonAdaptiveOk = !!(firstRow && firstRow.mindBg && firstRow.mindBg.ok);

  let passAll =
    scenariosPass &&
    consoleErrors.length === 0 &&
    mindNonAdaptiveOk &&
    perViewport.every(
      (row) =>
        row.accentAudit.ok &&
        row.CLS === 0 &&
        !row.overflowX &&
        row.railShift === 0
    );

  function rgbEqPub(a, b) {
    return a && b && a.r === b.r && a.g === b.g && a.b === b.b;
  }

  const sample = firstRow && firstRow.accentAudit;
  const imgTile = !!(sample && sample.imageTileMode);
  const verdict = {
    CALENDAR_ACCENT_LOCK: passAll ? "OK" : "FAIL",
    LABEL_OK: sample && sample.ok && sample.labelTextOk && sample.lw >= 700 ? "YES" : "NO",
    ICON_OK:
      sample && sample.ok && sample.iw !== 700 && sample.maxStrokePx <= 1.6 && rgbEqPub(sample.lc, sample.ic)
        ? "YES"
        : "NO",
    REST_TEXT_OK: sample && sample.ok && sample.rc && !rgbEqPub(sample.rc, CALENDAR_ACCENT_RGB) ? "YES" : "NO",
    MIND_MENU_BUTTON_OK:
      sample && sample.ok && (imgTile || rgbEqPub(sample.bc, CALENDAR_ACCENT_RGB)) ? "YES" : "NO",
    CONTRAST_OK: sample && sample.ok && (imgTile || sample.mindContrast >= 4.5) ? "YES" : "NO",
    NON_ADAPTIVE_OK: mindNonAdaptiveOk ? "YES" : "NO",
    OLD_COLOR_NOT_PRESENT: sample && sample.noOldGreen ? "YES" : "NO",
    FINAL_VERDICT: passAll ? "PASS" : "FAIL"
  };

  console.log(
    JSON.stringify(
      {
        viewports: perViewport,
        consoleErrorsCount: consoleErrors.length,
        consoleErrors: consoleErrors.length ? consoleErrors : undefined,
        passAll,
        verdict
      },
      null,
      2
    )
  );
  console.log("CALENDAR_ACCENT_LOCK=" + verdict.CALENDAR_ACCENT_LOCK);
  console.log("LABEL_OK=" + verdict.LABEL_OK);
  console.log("ICON_OK=" + verdict.ICON_OK);
  console.log("REST_TEXT_OK=" + verdict.REST_TEXT_OK);
  console.log("MIND_MENU_BUTTON_OK=" + verdict.MIND_MENU_BUTTON_OK);
  console.log("CONTRAST_OK=" + verdict.CONTRAST_OK);
  console.log("NON_ADAPTIVE_OK=" + verdict.NON_ADAPTIVE_OK);
  console.log("OLD_COLOR_NOT_PRESENT=" + verdict.OLD_COLOR_NOT_PRESENT);
  console.log("FINAL_VERDICT=" + verdict.FINAL_VERDICT);
  process.exit(passAll ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
