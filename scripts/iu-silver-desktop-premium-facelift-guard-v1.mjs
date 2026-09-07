#!/usr/bin/env node
/**
 * Silver chat PC premium facelift — visual only; shell size invariants locked.
 * Run: npm run iu-silver-desktop-premium-facelift-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const CACHE = "silver-desktop-premium-facelift-v1-20260907";
const MARKER = "silver-desktop-premium-facelift-v1-20260907";
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

function staticGate() {
  const css = fs.readFileSync(path.join(ROOT, "assets/iu-silver-premium-draft.css"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "assets/app.css"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");

  must(new RegExp("iu-silver-premium-draft\\.css\\?v=" + CACHE).test(index), "static:css_cache");
  must(css.includes(MARKER), "static:marker");
  must(/@media\s*\(\s*min-width:\s*1025px\s*\)/.test(css), "static:desktop_mq");
  must(/\.iuSilverChatBackdrop\s*\{[^}]*0\.88/.test(css), "static:backdrop_darker");
  must(/backdrop-filter:\s*blur/.test(css), "static:backdrop_blur");
  must(/max-width:\s*720px/.test(css), "static:lock_max_width");
  must(/min-height:\s*100dvh/.test(css), "static:lock_min_height");
  /* Base size contract still in app.css */
  must(/\.iuSilverChatShell\{[\s\S]*?max-width:\s*720px/.test(app), "static:app_shell_720");
  must(/\.iuSilverChatShell\{[\s\S]*?min-height:\s*100dvh/.test(app), "static:app_shell_100dvh");
  /* Facelift must not live in app.css (css debt) */
  must(!app.includes(MARKER), "static:not_in_app_css");
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
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function openSilverChat(page) {
  await page.waitForFunction(() => document.getElementById("iuSilverChatOverlay"), { timeout: 60000 });
  await page.evaluate(() => {
    const overlay = document.getElementById("iuSilverChatOverlay");
    if (!overlay) return;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    try {
      document.body.classList.add("iuSilverChatOpen");
    } catch (_) {}
    const msgs = document.getElementById("iuSilverChatMessages");
    if (msgs && !msgs.querySelector(".iuSilverMsg--user")) {
      const u = document.createElement("div");
      u.className = "iuSilverMsg iuSilverMsg--user";
      u.textContent = "Ahoj Silvere";
      const a = document.createElement("div");
      a.className = "iuSilverMsg iuSilverMsg--assistant";
      a.textContent = "Dobrý den, jsem Silver.";
      msgs.appendChild(u);
      msgs.appendChild(a);
    }
  });
  await page.waitForTimeout(250);
}

async function measure(page, label, expectDesktop) {
  const m = await page.evaluate((expectDesktop) => {
    const overlay = document.getElementById("iuSilverChatOverlay");
    const shell = overlay && overlay.querySelector(".iuSilverChatShell");
    const backdrop = overlay && overlay.querySelector(".iuSilverChatBackdrop");
    const close = document.getElementById("iuSilverChatClose");
    const input = document.getElementById("iuSilverChatInput");
    const send = document.getElementById("iuSilverChatSend");
    const title = document.getElementById("iuSilverChatTitle");
    const msgs = document.getElementById("iuSilverChatMessages");
    if (!overlay || !shell || !backdrop || !close) return { ok: false };
    const sr = shell.getBoundingClientRect();
    const scs = getComputedStyle(shell);
    const bcs = getComputedStyle(backdrop);
    const mcs = msgs ? getComputedStyle(msgs) : null;
    const user = msgs && msgs.querySelector(".iuSilverMsg--user");
    const asst = msgs && msgs.querySelector(".iuSilverMsg--assistant");
    const bg = bcs.backgroundColor || "";
    let alpha = null;
    const rgba = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (rgba) alpha = rgba[4] != null ? Number(rgba[4]) : 1;
    return {
      ok: true,
      vw: window.innerWidth,
      vh: window.innerHeight,
      shellW: sr.width,
      shellH: sr.height,
      maxWidth: scs.maxWidth,
      minHeight: scs.minHeight,
      borderRadius: scs.borderRadius,
      boxShadow: scs.boxShadow,
      backdropAlpha: alpha,
      backdropFilter: bcs.backdropFilter || bcs.webkitBackdropFilter || "",
      closeVisible: (() => {
        const r = close.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })(),
      title: title ? String(title.textContent || "").trim() : "",
      inputH: input ? input.getBoundingClientRect().height : 0,
      sendH: send ? send.getBoundingClientRect().height : 0,
      msgsOverflowY: mcs ? mcs.overflowY : null,
      userBg: user ? getComputedStyle(user).backgroundColor : null,
      asstBg: asst ? getComputedStyle(asst).backgroundColor : null,
      expectDesktop,
    };
  }, expectDesktop);

  must(m.ok, label + ":probe_ok");
  if (!m.ok) return m;
  must(m.title === "Silver", label + ":title");
  must(m.closeVisible, label + ":close");
  must(String(m.maxWidth) === "720px", label + ":max_width_720");
  /* Height invariant: shell still fills viewport (±2px for borders) */
  must(Math.abs(m.shellH - m.vh) <= 4, label + ":height_fills_viewport");
  must(m.shellW <= 720 + 2, label + ":width_cap");
  must(/auto|scroll/.test(String(m.msgsOverflowY)), label + ":msgs_scroll");

  if (expectDesktop) {
    must(m.backdropAlpha != null && m.backdropAlpha >= 0.85, label + ":backdrop_dark");
    must(/blur\(/i.test(String(m.backdropFilter)), label + ":backdrop_blur");
    must(parseFloat(String(m.borderRadius)) >= 12, label + ":radius");
    must(String(m.boxShadow) !== "none" && String(m.boxShadow).length > 10, label + ":shadow");
    must(m.userBg && m.asstBg && m.userBg !== m.asstBg, label + ":bubble_contrast");
  } else {
    /* Mobile/tablet must NOT pick up desktop radius/blur contract */
    must(!(parseFloat(String(m.borderRadius)) >= 12), label + ":no_desktop_radius");
    must(!/blur\(/i.test(String(m.backdropFilter)), label + ":no_desktop_blur");
  }
  return m;
}

async function runtimeGate() {
  const PORT = parseInt(process.env.IU_GUARD_PORT || String(19100 + (process.pid % 800)), 10);
  const srv = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 25000);
    const browser = await chromium.launch({ headless: true });
    const desk = [
      { label: "desk_1440", w: 1440, h: 900 },
      { label: "desk_1920", w: 1920, h: 1080 },
    ];
    for (const c of desk) {
      const ctx = await bootstrapGuardContext(browser, { viewport: { width: c.w, height: c.h } });
      const page = await bootstrapGuardPage(ctx);
      await page.goto(`http://127.0.0.1:${PORT}/projects/?section=media&nosw=1`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await openSilverChat(page);
      await measure(page, c.label, true);
      await ctx.close();
    }
    const mobile = [
      { label: "mobile_390", w: 390, h: 844 },
      { label: "tablet_768", w: 768, h: 1024 },
    ];
    for (const c of mobile) {
      const ctx = await bootstrapGuardContext(browser, { viewport: { width: c.w, height: c.h }, hasTouch: true });
      const page = await bootstrapGuardPage(ctx);
      await page.goto(`http://127.0.0.1:${PORT}/projects/?section=media&nosw=1`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await openSilverChat(page);
      await measure(page, c.label, false);
      await ctx.close();
    }
    await browser.close();
  } finally {
    try {
      srv.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.error(JSON.stringify({ result: "FAIL", phase: "static", fails }, null, 2));
    process.exit(1);
  }
  await runtimeGate();
  if (fails.length) {
    console.error(JSON.stringify({ result: "FAIL", phase: "runtime", fails }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      result: "PASS",
      IU_SILVER_DESKTOP_PREMIUM_FACELIFT_GUARD: "PASS",
      CACHE,
      SHELL_MAX_WIDTH: "720px",
    })
  );
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
