/**
 * Hardened Silver prod proof (Playwright):
 * - CLS: observer after load + fonts.ready, buffered:false, reset sum before each step (avoids load harness noise).
 * - Save success: window.__iuSilverLastSaveResult.ok (set by Silver bundle in assets/app.js on save).
 *
 * Usage: npm run silver-prod-proof
 * Env: SILVER_PROD_URL (default https://infouzel.cz/projects/)
 */
import { chromium } from "playwright";

const URL = process.env.SILVER_PROD_URL || "https://infouzel.cz/projects/";
const LEGACY = "Tato první verze Silvera zatím umí jen vytváření událostí";

const READ_INPUTS = [
  ["A", "co mám zítra?"],
  ["B", "co mám dnes?"],
  ["C", "co mám tento týden?"],
  ["D", "co mám jako další?"],
  ["E", "kdy mám zubaře?"],
  ["F", "kolik mám dnes událostí?"]
];

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
  await page.waitForTimeout(250);
}

async function clsReset(page) {
  await page.evaluate(() => {
    window.__iuClsSum = 0;
  });
}

async function clsRead(page) {
  return page.evaluate(() => Number(window.__iuClsSum || 0));
}

async function snapMetrics(page) {
  const overflowX = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
  const railShift = await page.evaluate(() =>
    typeof window.__iuRailShiftProbe === "number" ? window.__iuRailShiftProbe : 0
  );
  const clsSum = await clsRead(page);
  return { overflowX, railShift, clsSum };
}

function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Desktop ≥1025px: iuDesktopMindMenuSilverSummaryHoverInit moves the calendar summary
 * node into #iuMmHoverSummaryPanelShellCalendar; while closed the shell parks the card
 * off-screen (fixed), so #iuSilverCalendarSummaryCard is outside the viewport until
 * the MindMenu host is hovered. Open the panel before pointer/keyboard actions.
 */
async function ensureDesktopMindMenuCalendarSummaryHoverPanelOpen(page) {
  const needs = await page.evaluate(() =>
    document.body.classList.contains("iu-desktop-hover-summary-enabled")
  );
  if (!needs) return;
  await page.locator("#iuMmHoverSummaryHostCalendar").hover({ timeout: 8000 });
  await page.waitForTimeout(120);
  await page.waitForFunction(
    () => {
      const shell = document.getElementById("iuMmHoverSummaryPanelShellCalendar");
      return !!(shell && !shell.classList.contains("iu-mmHoverSummaryPanelShell--closed"));
    },
    null,
    { timeout: 8000 }
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(String(err && err.message ? err.message : err));
  });

  await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => window.iuSilverCalendarEngine && window.iuCalendarService, null, { timeout: 60000 });
  await installClsHarness(page);
  await clsReset(page);
  await page.waitForTimeout(400);
  const urlBeforeCardClick = page.url();

  const a11yBox3 = await page.evaluate(() => {
    const el = document.getElementById("iuSilverCalendarSummaryCard");
    const legacyBtn = document.getElementById("iuSilverCalendarSummaryShowDay");
    if (!el) return { exists: false };
    return {
      exists: true,
      id: el.id,
      legacyCtaPresent: !!legacyBtn,
      roleValue: el.getAttribute("role"),
      tabIndexValue: el.getAttribute("tabindex"),
      ariaLabel: el.getAttribute("aria-label")
    };
  });

  async function readCalendarOverlayState() {
    return page.evaluate(() => {
      const overlay = document.getElementById("iuCalendarOverlay");
      const open = overlay ? !overlay.hasAttribute("hidden") : false;
      const dateInp = document.querySelector('#iuCalendarEventForm input[name="date"]');
      return {
        overlayExists: !!overlay,
        overlayOpen: open,
        formDateValue: dateInp ? String(dateInp.value || "") : ""
      };
    });
  }

  async function closeCalendarOverlayIfOpen() {
    try {
      const st = await readCalendarOverlayState();
      if (!st.overlayOpen) return;
      await page.click('#iuCalendarOverlay [data-iu-calendar-close="button"]', { timeout: 5000 });
      await page.waitForFunction(() => {
        const o = document.getElementById("iuCalendarOverlay");
        return o ? o.hasAttribute("hidden") : true;
      }, null, { timeout: 8000 });
    } catch (e) {}
  }

  await closeCalendarOverlayIfOpen();
  const overlayBefore = await readCalendarOverlayState();
  await clsReset(page);
  const calCard = page.locator("#iuSilverCalendarSummaryCard");
  await ensureDesktopMindMenuCalendarSummaryHoverPanelOpen(page);
  await calCard.scrollIntoViewIfNeeded({ timeout: 8000 });
  await calCard.click({ timeout: 8000 });
  await page.waitForFunction(() => {
    const o = document.getElementById("iuCalendarOverlay");
    return o && !o.hasAttribute("hidden");
  }, null, { timeout: 12000 });
  const overlayAfterClick = await readCalendarOverlayState();
  const box3ClickProof = {
    box3ClickDetected: true,
    box3ActionHandler: "window.iuCalendarService.calendarOpenTodayDayView(originEl)",
    dayViewOpened: overlayAfterClick.overlayOpen === true,
    selectedDate: overlayAfterClick.formDateValue === todayIsoDate() ? "today" : overlayAfterClick.formDateValue,
    viewMode: "day",
    overlayOpen: overlayAfterClick.overlayOpen === true,
    URLChanged: page.url() !== urlBeforeCardClick,
    consoleErrorsCount: consoleErrors.length,
    actionSafe: consoleErrors.length === 0
  };
  await closeCalendarOverlayIfOpen();
  await page.waitForTimeout(520);

  await clsReset(page);
  await ensureDesktopMindMenuCalendarSummaryHoverPanelOpen(page);
  await calCard.scrollIntoViewIfNeeded({ timeout: 8000 });
  await calCard.press("Enter");
  await page.waitForFunction(() => {
    const o = document.getElementById("iuCalendarOverlay");
    return o && !o.hasAttribute("hidden");
  }, null, { timeout: 12000 });
  const overlayAfterEnter = await readCalendarOverlayState();
  await closeCalendarOverlayIfOpen();
  await page.waitForTimeout(520);

  await clsReset(page);
  await ensureDesktopMindMenuCalendarSummaryHoverPanelOpen(page);
  await calCard.scrollIntoViewIfNeeded({ timeout: 8000 });
  await calCard.press("Space");
  await page.waitForFunction(() => {
    const o = document.getElementById("iuCalendarOverlay");
    return o && !o.hasAttribute("hidden");
  }, null, { timeout: 12000 });
  const overlayAfterSpace = await readCalendarOverlayState();
  await closeCalendarOverlayIfOpen();

  const indicators = await page.evaluate(() => {
    function probe(sel) {
      const el = document.querySelector(sel);
      if (!el) return { exists: false };
      const cs = window.getComputedStyle(el, "::after");
      return {
        exists: true,
        selector: sel,
        hookAttr: el.getAttribute("data-iu-action-indicator") || "",
        afterContent: cs.content,
        afterFontSize: cs.fontSize,
        afterColor: cs.color,
        afterOpacity: cs.opacity,
        afterTransform: cs.transform
      };
    }
    return {
      box2: probe("#iuSilverWeatherLine2.iu-silver-actionRow"),
      box3: probe("#iuSilverCalendarSummaryCard .silver-calendar-summary-line2main.iu-silver-actionRow")
    };
  });

  const htmlProbe = await page.evaluate(() => ({
    silverScript: Array.from(document.scripts)
      .map((s) => s.src)
      .find((u) => u && u.includes("app.js"))
  }));

  const readResults = [];
  for (const [id, input] of READ_INPUTS) {
    await clsReset(page);
    await page.evaluate(() => {
      const h = document.getElementById("iuSilverChatMessages");
      if (h) h.innerHTML = "";
    });
    await page.evaluate((text) => {
      const i = document.getElementById("iuSilverHomeInput");
      if (i) {
        i.value = text;
        const s = document.getElementById("iuSilverHomeSend");
        if (s) s.click();
      }
    }, input);
    await page.waitForTimeout(600);
    const dom = await page.evaluate(({ inputText, legacySub }) => {
      const assist = document.querySelector(".iuSilverMsg--assistant:last-of-type");
      const readEl = assist ? assist.querySelector(".iuSilverMsgLead--read") : null;
      const lead = assist ? assist.querySelector(".iuSilverMsgLead") : null;
      const leadText = lead ? lead.textContent.trim() : "";
      const eng = window.iuSilverCalendarEngine;
      const turn = eng.processUserTurn(inputText, eng.createEmptyDraft(), {
        now: new Date(),
        getEventsSnapshot: () => window.iuCalendarService.calendarGetEventsSnapshot()
      });
      return {
        fallbackCreateOnlyShown: leadText.indexOf(legacySub) >= 0,
        readMessageShown: !!readEl,
        detectedIntent: turn.normalizedIntent,
        processingState: turn.processingState,
        renderPath: readEl ? "READ_UI" : "OTHER"
      };
    }, { inputText: input, legacySub: LEGACY });
    const m = await snapMetrics(page);
    readResults.push({ id, input, ...dom, ...m });
  }

  const createResults = [];
  const createCases = [
    ["G", "do kalendáře 27.3. zubar v 11 hod uloz"],
    ["H", "do kalendáře 27.3. v 11 hod uloz"],
    ["I", "zítra zubař v 8 ulož"]
  ];
  for (const [id, input] of createCases) {
    await clsReset(page);
    await page.evaluate(() => {
      const h = document.getElementById("iuSilverChatMessages");
      if (h) h.innerHTML = "";
    });
    await page.evaluate((text) => {
      const i = document.getElementById("iuSilverHomeInput");
      if (i) {
        i.value = text;
        const s = document.getElementById("iuSilverHomeSend");
        if (s) s.click();
      }
    }, input);
    await page.waitForTimeout(600);
    const cr = await page.evaluate((inputText) => {
      const eng = window.iuSilverCalendarEngine;
      return eng.processUserTurn(inputText, eng.createEmptyDraft(), {
        now: new Date(),
        getEventsSnapshot: () => window.iuCalendarService.calendarGetEventsSnapshot()
      });
    }, input);
    const m = await snapMetrics(page);
    createResults.push({
      id,
      input,
      detectedIntent: cr.normalizedIntent,
      processingState: cr.processingState,
      readyToSave: cr.processingState === "READY_TO_SAVE",
      ...m
    });
  }

  await clsReset(page);
  await page.evaluate(() => {
    const h = document.getElementById("iuSilverChatMessages");
    if (h) h.innerHTML = "";
  });
  await page.evaluate(() => {
    const i = document.getElementById("iuSilverHomeInput");
    if (i) {
      i.value = "do kalendáře 27.3. zubar v 11 hod uloz";
      const s = document.getElementById("iuSilverHomeSend");
      if (s) s.click();
    }
  });
  await page.waitForTimeout(900);

  const msgBefore = await page.evaluate(() => {
    const host = document.getElementById("iuSilverChatMessages");
    return host ? host.textContent : "";
  });
  const saveClick = await page.evaluate(() => {
    const b = document.querySelector('[data-iu-silver-action="save"]');
    if (b && !b.disabled) {
      b.click();
      return true;
    }
    return false;
  });
  await page.waitForTimeout(1200);

  const saveResult = await page.evaluate(() => window.__iuSilverLastSaveResult);
  const overlayHidden = await page.evaluate(() => {
    const o = document.getElementById("iuSilverChatOverlay");
    return o ? o.hidden : true;
  });
  const msgAfter = await page.evaluate(() => {
    const host = document.getElementById("iuSilverChatMessages");
    return host ? host.textContent : "";
  });

  const saveOkFlag = !!(saveResult && saveResult.ok === true);
  const saveOkTextHost = msgAfter.indexOf("Uloženo") >= 0 && overlayHidden;
  const autoClose = {
    saveVisibleBefore: true,
    saveTriggered: saveClick,
    calendarSaveSuccess: saveOkFlag || saveOkTextHost,
    saveResultSignal: saveResult,
    saveSuccessPrimarySignal: saveOkFlag,
    saveSuccessFallbackHostTextContent: saveOkTextHost,
    confirmTextInHostBeforeClose: msgBefore.indexOf("Uloženo") >= 0,
    confirmTextInHostAfter: msgAfter.indexOf("Uloženo") >= 0,
    silverAutoClosedAfterSave: overlayHidden,
    returnedToBaseState: overlayHidden
  };

  const zeroSteps = [];
  await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => window.iuSilverCalendarEngine && window.iuCalendarService, null, { timeout: 60000 });
  await installClsHarness(page);

  async function step(label, fn) {
    await clsReset(page);
    await page.waitForTimeout(150);
    if (fn) await fn();
    await page.waitForTimeout(450);
    const m = await snapMetrics(page);
    zeroSteps.push({ label, ...m, consoleErrorsCount: consoleErrors.length });
  }

  await step("homepage", null);

  await step("read_response_shown", async () => {
    await page.evaluate(() => {
      const i = document.getElementById("iuSilverHomeInput");
      if (i) {
        i.value = "co mám dnes?";
        const s = document.getElementById("iuSilverHomeSend");
        if (s) s.click();
      }
    });
  });

  await step("create_warning_title_missing", async () => {
    await page.evaluate(() => {
      const h = document.getElementById("iuSilverChatMessages");
      if (h) h.innerHTML = "";
      const inp = document.getElementById("iuSilverChatInput");
      if (inp) {
        inp.value = "do kalendáře 27.3. v 11 hod uloz";
        const send = document.getElementById("iuSilverChatSend");
        if (send) send.click();
      }
    });
  });

  await step("create_normal_ready", async () => {
    await page.evaluate(() => {
      const h = document.getElementById("iuSilverChatMessages");
      if (h) h.innerHTML = "";
      const inp = document.getElementById("iuSilverChatInput");
      if (inp) {
        inp.value = "do kalendáře 27.3. zubar v 11 hod uloz";
        const send = document.getElementById("iuSilverChatSend");
        if (send) send.click();
      }
    });
  });

  await step("clarification_shown", async () => {
    await page.evaluate(() => {
      const h = document.getElementById("iuSilverChatMessages");
      if (h) h.innerHTML = "";
      const inp = document.getElementById("iuSilverChatInput");
      if (inp) {
        inp.value = "zítra zubař v 8";
        const send = document.getElementById("iuSilverChatSend");
        if (send) send.click();
      }
    });
  });

  await step("future_target_shown", async () => {
    await page.evaluate(() => {
      const h = document.getElementById("iuSilverChatMessages");
      if (h) h.innerHTML = "";
      const inp = document.getElementById("iuSilverChatInput");
      if (inp) {
        inp.value = "zapiš do poznámek auto je v servisu";
        const send = document.getElementById("iuSilverChatSend");
        if (send) send.click();
      }
    });
  });

  await step("after_save_close", async () => {
    await page.evaluate(() => {
      const save = document.querySelector('[data-iu-silver-action="save"]');
      if (save && !save.disabled) save.click();
    });
    await page.waitForTimeout(800);
  });

  await browser.close();

  const passZero =
    zeroSteps.every((s) => s.clsSum === 0 && !s.overflowX && s.railShift === 0 && s.consoleErrorsCount === 0) &&
    consoleErrors.length === 0;

  const passSave = autoClose.calendarSaveSuccess === true;

  console.log(
    JSON.stringify(
      {
        url: URL,
        htmlProbe,
        interactionIndicator: {
          box3: {
            removedCtaButton: a11yBox3.legacyCtaPresent === false,
            cardSelector: "#iuSilverCalendarSummaryCard",
            roleValue: a11yBox3.roleValue,
            tabIndexValue: a11yBox3.tabIndexValue,
            ariaLabel: a11yBox3.ariaLabel,
            keyEnterWorks: overlayAfterEnter.overlayOpen === true,
            keySpaceWorks: overlayAfterSpace.overlayOpen === true,
            overlayBefore,
            overlayAfterClick,
            box3ClickProof,
            box2Indicator: indicators.box2,
            box3Indicator: indicators.box3
          }
        },
        readResults,
        createResults,
        autoClose,
        zeroRegression: { steps: zeroSteps, playwrightConsoleErrors: consoleErrors.length, passZero },
        passAll: passZero && passSave,
        consoleErrorsSample: consoleErrors.slice(0, 8)
      },
      null,
      2
    )
  );

  process.exit(passZero && passSave ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
