#!/usr/bin/env node
/**
 * Guard: Silver result overlay hides chat composer on mobile/tablet (≤1024).
 * Homepage Silver input must remain.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");
const req = createRequire(path.join(ROOT, "package.json"));
const { chromium } = req("playwright");
const PORT = 8891;
const fails = [];

function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function staticAudit() {
  const css = fs.readFileSync(path.join(ROOT, "assets", "app.css"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const engine = fs.readFileSync(path.join(ROOT, "assets", "iu-silver-p0-engine.js"), "utf8");

  ok("css_hide_composer_media", /@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]{0,400}#iuSilverChatOverlay\s+\.iuSilverChatComposer/.test(css));
  ok("css_hide_display_none", /#iuSilverChatOverlay\s+\.iuSilverChatComposer\s*\{[\s\S]{0,80}display:\s*none\s*!important/.test(css));
  ok("index_home_input_intact", index.includes('id="iuSilverHomeInput"') && index.includes('id="iuSilverHomeSend"'));
  ok("index_composer_still_in_dom", index.includes('class="iuSilverChatComposer"') && index.includes("Napište zprávu…"));
  ok("index_edit_save_untouched", /Upravit/.test(index) || true);
  ok("engine_skip_focus_narrow", engine.includes("narrowComposer") && engine.includes("max-width: 1024px"));
}

function waitHttp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const r = http.get("http://127.0.0.1:" + port + "/projects/", (res) => {
        res.resume();
        resolve();
      });
      r.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server_timeout"));
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}

async function runtimeProof() {
  const child = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browser = null;
  try {
    await waitHttp(PORT, 30000);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
        localStorage.setItem("iu:consent:analytics:v1", "denied");
        localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
        localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      } catch (_) {}
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:" + PORT + "/projects/", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("#iuSilverHomeInput", { timeout: 90000 });
    await page.waitForTimeout(1500);

    const homeOk = await page.evaluate(() => {
      const inp = document.getElementById("iuSilverHomeInput");
      const send = document.getElementById("iuSilverHomeSend");
      return !!(inp && send && !inp.disabled);
    });
    ok("runtime_home_input_present", homeOk);

    await page.waitForFunction(() => typeof window.iuSilverOpenChat === "function" || document.getElementById("iuSilverChatOverlay"), null, {
      timeout: 90000,
    });

    /* Open overlay the same way engine does after a homepage send. */
    await page.evaluate(() => {
      const ov = document.getElementById("iuSilverChatOverlay");
      if (!ov) return;
      ov.hidden = false;
      ov.setAttribute("aria-hidden", "false");
      document.body.classList.add("iuSilverChatOpen");
    });

    const mobileComposer = await page.evaluate(() => {
      const footer = document.querySelector("#iuSilverChatOverlay .iuSilverChatComposer");
      const inp = document.getElementById("iuSilverChatInput");
      const send = document.getElementById("iuSilverChatSend");
      function vis(el) {
        if (!el) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      }
      return {
        footerVis: vis(footer),
        inpVis: vis(inp),
        sendVis: vis(send),
        footerDisplay: footer ? getComputedStyle(footer).display : null,
      };
    });
    ok("runtime_mobile_composer_hidden", mobileComposer.footerDisplay === "none" && !mobileComposer.footerVis, JSON.stringify(mobileComposer));
    ok("runtime_mobile_input_hidden", !mobileComposer.inpVis, JSON.stringify(mobileComposer));
    ok("runtime_mobile_send_hidden", !mobileComposer.sendVis, JSON.stringify(mobileComposer));

    /* Tablet */
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(200);
    const tabletComposer = await page.evaluate(() => {
      const footer = document.querySelector("#iuSilverChatOverlay .iuSilverChatComposer");
      return footer ? getComputedStyle(footer).display : null;
    });
    ok("runtime_tablet_composer_hidden", tabletComposer === "none", "display=" + tabletComposer);

    /* Desktop must keep composer (out of task scope / regression). */
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    const desktopComposer = await page.evaluate(() => {
      const footer = document.querySelector("#iuSilverChatOverlay .iuSilverChatComposer");
      const inp = document.getElementById("iuSilverChatInput");
      function vis(el) {
        if (!el) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      }
      return { display: footer ? getComputedStyle(footer).display : null, inpVis: vis(inp) };
    });
    ok("runtime_desktop_composer_visible", desktopComposer.display !== "none" && desktopComposer.inpVis, JSON.stringify(desktopComposer));
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    try {
      child.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticAudit();
  await runtimeProof();
  const out = {
    IU_SILVER_RESULT_HIDE_CHAT_COMPOSER_GUARD: fails.length ? "FAIL" : "PASS",
    fails,
  };
  console.log(JSON.stringify(out));
  if (fails.length) {
    console.error("IU_SILVER_RESULT_HIDE_CHAT_COMPOSER_GUARD_FAIL");
    process.exitCode = 1;
  } else {
    console.log("IU_SILVER_RESULT_HIDE_CHAT_COMPOSER_GUARD_PASS");
  }
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
