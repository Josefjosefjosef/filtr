#!/usr/bin/env node
/**
 * Parcel card "Vybrat dopravce" must toggle carrier list open AND closed.
 * Run: npm run iu-parcel-carrier-picker-toggle-guard
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8996", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover&nosw=1`;
const LS_KEY = "iu_silver_parcel_watch_v1";
const CACHE_BUST = "parcel-carrier-picker-toggle-v1-20260907";
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function staticGate() {
  const js = read("assets/iu-silver-parcel-dashboard.js");
  const css = read("assets/iu-silver-parcel-dashboard.css");
  const desk = read("assets/iu-desktop-parcel-watch-overlay.css");
  const index = read("projects/index.html");

  must(/Vybrat dopravce/.test(js), "static_btn_label");
  must(/pickerHost\.hidden\s*=\s*!willOpen/.test(js), "static_toggle_hidden");
  must(/aria-expanded/.test(js), "static_aria_expanded");
  must(/aria-controls/.test(js), "static_aria_controls");
  must(
    /iuSilverParcelWatch__picker\[hidden\][\s\S]*?display:\s*none\s*!important/.test(css),
    "static_css_picker_hidden"
  );
  must(
    /iuSilverParcelWatch__picker\[hidden\][\s\S]*?display:\s*none\s*!important/.test(desk),
    "static_desktop_css_picker_hidden"
  );
  must(
    new RegExp("iu-silver-parcel-dashboard\\.js\\?v=" + CACHE_BUST).test(index),
    "static_index_js_cache_bust"
  );
  must(
    new RegExp("iu-silver-parcel-dashboard\\.css\\?v=" + CACHE_BUST).test(index),
    "static_index_css_cache_bust"
  );
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

function seedParcel(id, number) {
  return {
    id,
    number,
    sequence: Number(String(id).replace(/\D/g, "")) || 1,
    addedAt: Date.now(),
    lastCheckedAt: null,
    carrierHint: "",
    postalDigits: "",
    terminalVerified: null,
    pickupAddressVerified: "",
    completedAt: null,
    lastDetection: null,
  };
}

async function runtimeGate() {
  const srv = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    const viewports = [
      { width: 390, height: 844, label: "mobile" },
      { width: 768, height: 1024, label: "tablet" },
    ];

    for (let vi = 0; vi < viewports.length; vi++) {
      const vp = viewports[vi];
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: vp.width, height: vp.height },
        isMobile: true,
        hasTouch: true,
      });
      const page = await bootstrapGuardPage(context);

      async function seedList(payload) {
        await waitForVaultReady(page, 90000).catch(() => {});
        await page.evaluate(
          async ({ key, payload: list }) => {
            const raw = JSON.stringify(list);
            try {
              if (window.iuVault && typeof window.iuVault.durableSet === "function") {
                await window.iuVault.durableSet(key, raw);
                return;
              }
            } catch (_) {}
            localStorage.setItem(key, raw);
          },
          { key: LS_KEY, payload }
        );
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForFunction(() => document.getElementById("iuSilverParcelWatch"), {
          timeout: 45000,
        });
        await waitForVaultReady(page, 90000).catch(() => {});
        await page.waitForTimeout(1000);
        const n = await page.locator(".iuSilverParcelWatch__card").count();
        if (n < payload.length) {
          await page.evaluate(
            async ({ key, payload: list }) => {
              const raw = JSON.stringify(list);
              try {
                if (window.iuVault && typeof window.iuVault.durableSet === "function") {
                  await window.iuVault.durableSet(key, raw);
                  return;
                }
              } catch (_) {}
              localStorage.setItem(key, raw);
            },
            { key: LS_KEY, payload }
          );
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForFunction(() => document.getElementById("iuSilverParcelWatch"), {
            timeout: 45000,
          });
          await waitForVaultReady(page, 90000).catch(() => {});
          await page.waitForTimeout(1000);
        }
      }

      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => document.getElementById("iuSilverParcelWatch"), {
        timeout: 45000,
      });

      const two = [
        seedParcel("p_toggle_a", "TOGGLEAA11"),
        seedParcel("p_toggle_b", "TOGGLEBB22"),
      ];
      await seedList(two);

      const cards = page.locator(".iuSilverParcelWatch__card");
      must((await cards.count()) >= 2, "rt_" + vp.label + "_two_cards");

      const btnA = cards.nth(0).getByRole("button", { name: "Vybrat dopravce" });
      const btnB = cards.nth(1).getByRole("button", { name: "Vybrat dopravce" });
      must((await btnA.count()) === 1, "rt_" + vp.label + "_btn_a");
      must((await btnB.count()) === 1, "rt_" + vp.label + "_btn_b");

      const pickerA = page.locator("#iuSilverParcelPicker_p_toggle_a");
      const pickerB = page.locator("#iuSilverParcelPicker_p_toggle_b");

      async function assertClosed(picker, tag) {
        const st = await picker.evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            hidden: el.hidden,
            display: cs.display,
            h: el.getBoundingClientRect().height,
            chips: el.querySelectorAll(".iuSilverParcelWatch__chip").length,
          };
        });
        must(st.hidden === true, tag + "_hidden_attr");
        must(st.display === "none", tag + "_display_none");
        must(st.h < 1, tag + "_no_height");
      }

      async function assertOpen(picker, tag) {
        const st = await picker.evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            hidden: el.hidden,
            display: cs.display,
            h: el.getBoundingClientRect().height,
            chips: el.querySelectorAll(".iuSilverParcelWatch__chip").length,
          };
        });
        must(st.hidden === false, tag + "_not_hidden");
        must(st.display !== "none", tag + "_visible_display");
        must(st.h > 8, tag + "_has_height");
        must(st.chips >= 3, tag + "_has_chips");
      }

      await assertClosed(pickerA, "rt_" + vp.label + "_a_init");
      await btnA.click();
      await assertOpen(pickerA, "rt_" + vp.label + "_a_open1");
      must((await btnA.getAttribute("aria-expanded")) === "true", "rt_" + vp.label + "_a_aria_open");

      await btnA.click();
      await assertClosed(pickerA, "rt_" + vp.label + "_a_close1");
      must((await btnA.getAttribute("aria-expanded")) === "false", "rt_" + vp.label + "_a_aria_close");

      for (let i = 0; i < 3; i++) {
        await btnA.click();
        await assertOpen(pickerA, "rt_" + vp.label + "_a_cycle_open_" + i);
        await btnA.click();
        await assertClosed(pickerA, "rt_" + vp.label + "_a_cycle_close_" + i);
      }

      await btnB.click();
      await assertOpen(pickerB, "rt_" + vp.label + "_b_open");
      await assertClosed(pickerA, "rt_" + vp.label + "_a_unaffected_while_b");
      await btnB.click();
      await assertClosed(pickerB, "rt_" + vp.label + "_b_close");

      await btnA.click();
      await assertOpen(pickerA, "rt_" + vp.label + "_a_reopen_for_select");
      const chip = pickerA.locator(".iuSilverParcelWatch__chip").first();
      must((await chip.count()) === 1, "rt_" + vp.label + "_chip_exists");
      await chip.click();
      await page.waitForTimeout(600);
      const afterSelect = await page.evaluate((key) => {
        try {
          const raw = localStorage.getItem(key);
          const list = raw ? JSON.parse(raw) : [];
          const hit = list.find((x) => x.id === "p_toggle_a");
          return hit && hit.carrierHint ? String(hit.carrierHint) : "";
        } catch (_) {
          return "";
        }
      }, LS_KEY);
      must(afterSelect.length > 0, "rt_" + vp.label + "_carrier_select_persists");

      await seedList(two);
      await btnA.click();
      await assertOpen(pickerA, "rt_" + vp.label + "_a_open_before_remove");
      const removeBtn = cards.nth(0).getByRole("button", { name: /Odstranit/i });
      await removeBtn.click();
      const confirm = page.locator(".iuSilverParcelWatch__confirmModal:not([hidden]) button").filter({
        hasText: /Odstranit|Ano|Potvrdit/i,
      });
      if ((await confirm.count()) > 0) {
        await confirm.first().click();
      }
      await page.waitForTimeout(500);
      must((await page.locator("#iuSilverParcelPicker_p_toggle_a").count()) === 0, "rt_" + vp.label + "_a_dom_gone");
      must((await page.locator("#iuSilverParcelPicker_p_toggle_b").count()) === 1, "rt_" + vp.label + "_b_still_present");

      const snap1 = await page.evaluate((key) => localStorage.getItem(key) || "", LS_KEY);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => document.getElementById("iuSilverParcelWatch"), {
        timeout: 45000,
      });
      await waitForVaultReady(page, 90000).catch(() => {});
      await page.waitForTimeout(800);
      const snap2 = await page.evaluate((key) => localStorage.getItem(key) || "", LS_KEY);
      must(snap1 === snap2, "rt_" + vp.label + "_persistence_reload");

      await context.close();
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
  console.log(JSON.stringify({ result: "PASS", IU_PARCEL_CARRIER_PICKER_TOGGLE_GUARD: "PASS" }));
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
