#!/usr/bin/env node
/**
 * PC-only: middle feed outer wrapper (#iuSilverWelcomeStack) must not show a visible perimeter stroke.
 * Keeps base .silver-welcome-stack border for mobile/tablet; desktop hides via transparent border-color.
 * Run: npm run iu-pc-middle-feed-outer-border-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const MARKER = "pc-middle-feed-outer-border-v1-20260908";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8917", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function staticGate() {
  const css = read("assets/iu-desktop-home-premium.css");
  const app = read("assets/app.css");
  const index = read("projects/index.html");

  must(css.includes(MARKER), "static:marker");
  must(/@media\s*\(\s*min-width:\s*1025px\s*\)/.test(css), "static:desktop_mq");
  must(
    /body\.iu-desktop-home-grid\s+#silver-slot\s+#iuSilverWelcomeStack[\s\S]{0,900}?border-color:\s*transparent\s*!important/.test(
      css
    ),
    "static:desktop_transparent_border"
  );
  must(
    !/body\.iu-desktop-home-grid\s+#silver-slot\s+#iuSilverWelcomeStack[\s\S]{0,900}?border-color:\s*rgba\(\s*15\s*,\s*35\s*,\s*55\s*,\s*0\.1\s*\)\s*!important/.test(
      css
    ),
    "static:no_visible_outer_rgba"
  );
  must(
    /\.silver-welcome-stack\s*\{[\s\S]*?border:\s*var\(--iuSilverTopCardBorder\)/.test(app),
    "static:base_border_preserved"
  );
  must(
    new RegExp(
      "iu-desktop-home-premium\\.css\\?v=[^\"']*" + MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ).test(index),
    "static:index_css_cache"
  );
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request(
        { host, port, path: "/projects/", method: "HEAD", timeout: 800 },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function runtimeGate() {
  const child = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  let browser;
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    browser = await chromium.launch({ headless: true });
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: 1440, height: 900 },
    });
    const page = await bootstrapGuardPage(context);
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => {
        const el = document.getElementById("iuSilverWelcomeStack");
        return !!(el && document.body.classList.contains("iu-desktop-home-grid"));
      },
      null,
      { timeout: 60000 }
    );
    await page.waitForTimeout(400);

    const m = await page.evaluate(() => {
      const stack = document.getElementById("iuSilverWelcomeStack");
      if (!stack) return { ok: false, reason: "no_stack" };
      const cs = getComputedStyle(stack);
      const parsePx = (v) => {
        const n = parseFloat(String(v || "0"));
        return Number.isFinite(n) ? n : 0;
      };
      const isInvisibleColor = (c) => {
        const s = String(c || "").trim().toLowerCase();
        if (!s || s === "transparent") return true;
        const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
        if (m) {
          const a = m[4] === undefined ? 1 : parseFloat(m[4]);
          return !(a > 0.02);
        }
        return false;
      };
      const sides = ["Top", "Right", "Bottom", "Left"].map((side) => {
        const w = parsePx(cs["border" + side + "Width"]);
        const c = String(cs["border" + side + "Color"] || "");
        const visible = w > 0.5 && !isInvisibleColor(c);
        return { side, w, c, visible };
      });
      const card =
        stack.querySelector(".iuNewsPreviewCard") ||
        document.getElementById("iuDesktopInfoPanel") ||
        stack.querySelector(".box-prehled-dne, .box-sport, .box-finance");
      let innerVisible = false;
      if (card) {
        const ics = getComputedStyle(card);
        const iw = parsePx(ics.borderTopWidth);
        const ic = String(ics.borderTopColor || "");
        innerVisible = iw > 0.5 && !isInvisibleColor(ic);
      }
      return {
        ok: true,
        desktop: document.body.classList.contains("iu-desktop-home-grid"),
        sides,
        outerVisible: sides.some((s) => s.visible),
        innerVisible,
        outline: String(cs.outlineStyle || ""),
        boxShadow: String(cs.boxShadow || ""),
      };
    });

    must(m.ok === true, "runtime:stack_present");
    must(m.desktop === true, "runtime:desktop_grid");
    must(m.outerVisible === false, "runtime:outer_border_invisible:" + JSON.stringify(m.sides || []));
    must(m.innerVisible === true, "runtime:inner_card_border_kept");
    must(!/solid|double|groove|ridge|inset|outset/i.test(m.outline || ""), "runtime:no_outline");
    must(!m.boxShadow || m.boxShadow === "none", "runtime:no_box_shadow");
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      child.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.error("[iu-pc-middle-feed-outer-border-guard] FAIL");
    for (const id of fails) console.error("[iu-pc-middle-feed-outer-border-guard] " + id);
    process.exit(1);
  }
  await runtimeGate();
  if (fails.length) {
    console.error("[iu-pc-middle-feed-outer-border-guard] FAIL");
    for (const id of fails) console.error("[iu-pc-middle-feed-outer-border-guard] " + id);
    process.exit(1);
  }
  console.log("[iu-pc-middle-feed-outer-border-guard] PASS");
  console.log("RESULT=PASS");
}

main().catch((err) => {
  console.error("[iu-pc-middle-feed-outer-border-guard] FAIL:" + String(err && err.message ? err.message : err));
  process.exit(1);
});
