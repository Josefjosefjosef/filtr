#!/usr/bin/env node
"use strict";
/**
 * Silver quick-panel notes prefix: sync focus + typing (mobile/tablet/PWA).
 * Proves: Do poznámek → textarea focused/retained → typing works;
 * and home click-hold must not steal quick-panel prefix taps.
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");
const { createRequire } = require("module");
const REPO = path.resolve(__dirname, "..");
const req = createRequire(path.join(REPO, "package.json"));
const { chromium } = req("playwright");
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_silver_quick_notes_focus_guard.json");
const PORT = 8851;
const PANEL_REL = "assets/iu-silver-quick-panel.js";
const APP_REL = "assets/app.js";
const SMOKE_REL = path.join(".github", "workflows", "smoke.yml");

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function extractFunction(src, name) {
  const needle = "function " + name;
  const i = src.indexOf(needle);
  if (i < 0) return "";
  const brace = src.indexOf("{", i);
  if (brace < 0) return "";
  let depth = 0;
  for (let j = brace; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return src.slice(i);
}

function staticContract(panel, app, smokeYml) {
  const fails = [];
  const focusSync = extractFunction(panel, "focusInputSync");
  const insert = extractFunction(panel, "insertNotesPrefix");
  const bind = extractFunction(panel, "bindPanel");
  if (!focusSync) fails.push("static_missing_focusInputSync");
  else {
    if (focusSync.indexOf("requestAnimationFrame") >= 0) fails.push("static_focusInputSync_uses_rAF");
    if (focusSync.indexOf("setTimeout") >= 0) fails.push("static_focusInputSync_uses_setTimeout");
    if (focusSync.indexOf("inp.focus") < 0) fails.push("static_focusInputSync_no_focus");
  }
  if (!insert) fails.push("static_missing_insertNotesPrefix");
  else if (insert.indexOf("focusInputSync") < 0) fails.push("static_insert_no_focusInputSync");
  if (panel.indexOf("function focusInput(") >= 0 && panel.indexOf("setTimeout") >= 0) {
    const legacy = extractFunction(panel, "focusInput");
    if (legacy && legacy.indexOf("setTimeout") >= 0) fails.push("static_legacy_async_focusInput_present");
  }
  if (!bind) fails.push("static_missing_bindPanel");
  else {
    if (bind.indexOf("pointerdown") < 0) fails.push("static_bind_no_pointerdown");
    if (bind.indexOf("passive: false") < 0 && bind.indexOf("passive:!1") < 0) {
      fails.push("static_bind_pointerdown_not_nonpassive");
    }
  }
  if (app.indexOf("#iuSilverQuickPanel") < 0) {
    fails.push("static_app_missing_quickpanel_clickhold_exclude");
  }
  if (String(smokeYml || "").indexOf("iu-silver-quick-notes-focus-guard") < 0) {
    fails.push("static_smoke_yml_missing_guard");
  }
  return fails;
}

function waitHttp(port, ms) {
  const deadline = Date.now() + ms;
  return (async function loop() {
    while (Date.now() < deadline) {
      try {
        await new Promise((resolve, reject) => {
          const reqHttp = http.get({ host: "127.0.0.1", port: port, path: "/projects/", timeout: 1500 }, (res) => {
            res.resume();
            if (res.statusCode && res.statusCode < 500) resolve();
            else reject(new Error("bad status"));
          });
          reqHttp.on("error", reject);
          reqHttp.on("timeout", () => {
            try {
              reqHttp.destroy();
            } catch (_) {}
            reject(new Error("timeout"));
          });
        });
        return;
      } catch (_) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error("server not up");
  })();
}

async function startServer() {
  const script = path.join(REPO, "server", "projects-static.mjs");
  const child = spawn(process.execPath, [script], {
    cwd: REPO,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(PORT) },
    shell: false,
  });
  let serverErr = "";
  child.stderr.on("data", (c) => {
    serverErr += String(c);
  });
  try {
    await waitHttp(PORT, 90000);
  } catch (err) {
    if (serverErr) console.error(String(serverErr).trim());
    try {
      child.kill("SIGTERM");
    } catch (_) {}
    throw err;
  }
  return child;
}

async function dismissConsent(page) {
  try {
    await page.evaluate(() => {
      try {
        localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
        localStorage.setItem("iu:consent:analytics:v1", "denied");
      } catch (_) {}
      const btn = document.getElementById("iuConsentEssentialOnly");
      if (btn) btn.click();
    });
  } catch (_) {}
}

async function openQuickPanelViaSection(page) {
  /* Off-home: open a section so bottom-nav Silver toggles quick panel. */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:" + PORT + "/projects/?iu_sqn_focus=1", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await dismissConsent(page);
  await page.waitForFunction(
    () => typeof window.iuSilverQuickPanelHandleBottomNavSilver === "function",
    null,
    { timeout: 90000 }
  );
  /* Navigate to a feed section via bottom nav or hash/section API. */
  await page.evaluate(() => {
    try {
      if (typeof window.__iuShowSection === "function") {
        window.__iuShowSection("pocasi");
        return;
      }
    } catch (_) {}
    try {
      document.body.classList.add("iu-mobileMainVisible");
      document.body.dataset.section = "pocasi";
    } catch (_) {}
  });
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => {
    try {
      if (typeof window.iuSilverQuickPanelHandleBottomNavSilver === "function") {
        return !!window.iuSilverQuickPanelHandleBottomNavSilver();
      }
    } catch (_) {}
    return false;
  });
  if (!opened) {
    /* Force-open for environments where handle returns false. */
    await page.evaluate(() => {
      const panel = document.getElementById("iuSilverQuickPanel");
      if (!panel) return;
      panel.hidden = false;
      panel.classList.add("iuSilverQuickPanel--open");
      document.body.classList.add("iu-silverQuickPanelOpen");
      try {
        if (typeof window.__iuSilverSyncQuickPanelUxState === "function") window.__iuSilverSyncQuickPanelUxState();
      } catch (_) {}
    });
  }
  await page.waitForSelector("#iuSilverQuickPanel:not([hidden])", { timeout: 15000 });
}

async function runtimeProof() {
  const fails = [];
  let child = null;
  let browser = null;
  try {
    child = await startServer();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await openQuickPanelViaSection(page);

    const prefix = page.locator("#iuSilverQuickPanelPrefix");
    await prefix.waitFor({ state: "visible", timeout: 15000 });

    /* pointerdown path (primary iOS gesture). */
    await prefix.dispatchEvent("pointerdown", { button: 0, pointerType: "touch", isPrimary: true });
    await page.waitForTimeout(80);

    const afterPrefix = await page.evaluate(() => {
      const inp = document.getElementById("iuSilverQuickPanelInput");
      const prefixBtn = document.getElementById("iuSilverQuickPanelPrefix");
      return {
        value: inp ? String(inp.value || "") : "",
        active: document.activeElement && document.activeElement.id,
        focused: document.activeElement === inp,
        prefixHidden: !!(prefixBtn && prefixBtn.hidden),
        panelOpen: !!(document.getElementById("iuSilverQuickPanel") && !document.getElementById("iuSilverQuickPanel").hidden),
      };
    });
    if (afterPrefix.value.indexOf("Do poznámek ") !== 0) fails.push("runtime_prefix_not_applied:" + afterPrefix.value);
    if (!afterPrefix.focused) fails.push("runtime_input_not_focused:" + afterPrefix.active);
    if (!afterPrefix.panelOpen) fails.push("runtime_panel_closed_after_prefix");

    await page.keyboard.type("Test poznámky");
    const afterType = await page.evaluate(() => {
      const inp = document.getElementById("iuSilverQuickPanelInput");
      return {
        value: inp ? String(inp.value || "") : "",
        focused: document.activeElement === inp,
        panelOpen: !!(document.getElementById("iuSilverQuickPanel") && !document.getElementById("iuSilverQuickPanel").hidden),
      };
    });
    if (afterType.value.indexOf("Test poznámky") < 0) fails.push("runtime_typing_lost:" + afterType.value);
    if (!afterType.focused) fails.push("runtime_focus_lost_while_typing");
    if (!afterType.panelOpen) fails.push("runtime_panel_closed_while_typing");

    /* Close + reopen + prefix again */
    await page.evaluate(() => {
      try {
        if (typeof window.iuSilverQuickPanelClose === "function") window.iuSilverQuickPanelClose();
      } catch (_) {}
    });
    await page.waitForTimeout(100);
    await openQuickPanelViaSection(page);
    await page.locator("#iuSilverQuickPanelPrefix").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#iuSilverQuickPanelPrefix").dispatchEvent("pointerdown", {
      button: 0,
      pointerType: "touch",
      isPrimary: true,
    });
    await page.waitForTimeout(80);
    const again = await page.evaluate(() => {
      const inp = document.getElementById("iuSilverQuickPanelInput");
      return {
        value: inp ? String(inp.value || "") : "",
        focused: document.activeElement === inp,
      };
    });
    if (again.value.indexOf("Do poznámek ") !== 0) fails.push("runtime_reopen_prefix_fail");
    if (!again.focused) fails.push("runtime_reopen_not_focused");

    /* Manual tap into input retains focus */
    await page.locator("#iuSilverQuickPanelInput").click({ timeout: 10000 });
    const manual = await page.evaluate(() => document.activeElement && document.activeElement.id);
    if (manual !== "iuSilverQuickPanelInput") fails.push("runtime_manual_tap_focus_fail:" + manual);

    /* click-hold exclude: with engine not ready, document capture must not rewrite home input */
    await page.evaluate(() => {
      try {
        window.__iuSilverP0EngineReady = 0;
      } catch (_) {}
      const home = document.getElementById("iuSilverHomeInput");
      if (home) home.value = "";
      const q = document.getElementById("iuSilverQuickPanelInput");
      if (q) {
        q.value = "";
        try {
          q.blur();
        } catch (_) {}
      }
      try {
        if (typeof window.__iuSilverSyncQuickPanelUxState === "function") window.__iuSilverSyncQuickPanelUxState();
      } catch (_) {}
    });
    await page.waitForSelector("#iuSilverQuickPanelPrefix:not([hidden])", { timeout: 10000 });
    await page.locator("#iuSilverQuickPanelPrefix").dispatchEvent("pointerdown", {
      button: 0,
      pointerType: "touch",
      isPrimary: true,
    });
    await page.evaluate(() => {
      const prefix = document.getElementById("iuSilverQuickPanelPrefix");
      if (prefix) prefix.click();
    });
    const isolation = await page.evaluate(() => {
      const home = document.getElementById("iuSilverHomeInput");
      const q = document.getElementById("iuSilverQuickPanelInput");
      return {
        home: home ? String(home.value || "") : "",
        quick: q ? String(q.value || "") : "",
        active: document.activeElement && document.activeElement.id,
      };
    });
    if (isolation.home.indexOf("Do poznámek") === 0) fails.push("runtime_clickhold_stole_to_home");
    if (isolation.quick.indexOf("Do poznámek ") !== 0) fails.push("runtime_quick_prefix_lost_after_click");

    return {
      fails: fails,
      afterPrefix: afterPrefix,
      afterType: afterType,
      again: again,
      isolation: isolation,
    };
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    try {
      if (child) child.kill("SIGTERM");
    } catch (_) {}
  }
}

(async function main() {
  const panel = readRepo(PANEL_REL);
  const app = readRepo(APP_REL);
  const smokeYml = readRepo(SMOKE_REL);
  const staticFails = staticContract(panel, app, smokeYml);
  let runtime = { fails: ["runtime_not_run"] };
  try {
    runtime = await runtimeProof();
  } catch (e) {
    runtime = { fails: ["runtime_throw:" + String((e && e.message) || e)] };
  }
  const fails = staticFails.concat(runtime.fails || []);
  const report = {
    IU_SILVER_QUICK_NOTES_FOCUS_GUARD: fails.length ? "FAIL" : "PASS",
    fails: fails,
    staticFails: staticFails,
    runtime: runtime,
  };
  try {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  } catch (_) {}
  console.log(JSON.stringify(report));
  if (fails.length) {
    console.error("IU_SILVER_QUICK_NOTES_FOCUS_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_SILVER_QUICK_NOTES_FOCUS_GUARD_PASS");
})().catch((e) => {
  console.error(String((e && e.stack) || e));
  process.exit(1);
});
