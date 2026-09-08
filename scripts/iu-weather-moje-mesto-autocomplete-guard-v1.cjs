#!/usr/bin/env node
/**
 * Guard: Moje město picker — autocomplete + selected location + manual mode.
 * Covers Český Brod suggest, no stale Praha pending, save → mode=manual.
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

const PORT = 8877;
const CESKY = { name: "Český Brod", lat: 50.074227, lon: 14.858386 };
const fails = [];

function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function staticAudit() {
  const pipeline = fs.readFileSync(path.join(ROOT, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
  const cities = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "data", "cz_cities_min.json"), "utf8"));
  const locs = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "data", "cz_localities_picker.json"), "utf8"));

  ok("cities_is_array", Array.isArray(cities) && cities.length > 5000, "n=" + (cities && cities.length));
  ok("cities_plain_row", Array.isArray(cities[0]) && typeof cities[0][0] === "string");
  ok("cities_no_powershell_shape", !cities.some((r) => r && typeof r === "object" && !Array.isArray(r) && Array.isArray(r.value)));
  const ceskyCity = cities.find((r) => Array.isArray(r) && String(r[0]) === "Český Brod");
  ok("cities_has_cesky_brod", !!(ceskyCity && Math.abs(Number(ceskyCity[2]) - CESKY.lat) < 0.02));

  ok("locs_version_ge_4", Number(locs.version) >= 4, "v=" + locs.version);
  const ceskyLoc = (locs.items || []).find((x) => x && x.n === "Český Brod");
  ok("locs_cesky_has_coords", !!(ceskyLoc && Number.isFinite(ceskyLoc.lat) && Number.isFinite(ceskyLoc.lon)));

  ok("pipeline_city_unwrap", pipeline.includes("iuCityRowUnwrap"));
  ok("pipeline_union_cities", pipeline.includes("pushAll(fromCities)"));
  ok("pipeline_await_mode_write", /await\s+iuWeatherWriteLocationMode\(\s*IU_WEATHER_MODE_MANUAL\s*\)/.test(pipeline));
  ok("pipeline_await_manual_write", /await\s+iuWeatherWriteManualLocation\(/.test(pipeline));
  ok("pipeline_clear_pending_on_type", pipeline.includes('Vyberte lokalitu z našeptávače.'));
}

function waitHttp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const reqHttp = http.get("http://127.0.0.1:" + port + "/projects/", (res) => {
        res.resume();
        resolve();
      });
      reqHttp.on("error", () => {
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
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-08-v1");
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
        localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
        localStorage.setItem("iu_location_mode", "manual");
        localStorage.setItem(
          "iu_manual_location",
          JSON.stringify({ lat: 50.0755, lon: 14.4378, label: "Praha", name: "Praha" })
        );
      } catch (_) {}
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:" + PORT + "/projects/?section=pocasi", {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForFunction(() => typeof window.iuWeatherOpenMapPicker === "function", null, {
      timeout: 90000,
    });
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, {
      timeout: 90000,
    });

    await page.evaluate(async () => {
      if (window.iuVault && typeof window.iuVault.durableSet === "function") {
        await window.iuVault.durableSet("iu_location_mode", "manual");
        await window.iuVault.durableSet(
          "iu_manual_location",
          JSON.stringify({ lat: 50.0755, lon: 14.4378, label: "Praha", name: "Praha" })
        );
      }
    });

    await page.evaluate(() => {
      if (typeof window.iuWeatherOpenMapPicker === "function") window.iuWeatherOpenMapPicker();
    });
    await page.waitForSelector("#iuWeatherMapPickerSearch", { timeout: 30000 });
    await page.waitForFunction(
      () => {
        const ov = document.getElementById("iuWeatherMapPickerOverlay");
        return ov && !ov.hidden;
      },
      null,
      { timeout: 30000 }
    );

    /* Wait localities loaded (open is async). */
    await page.waitForTimeout(800);
    await page.fill("#iuWeatherMapPickerSearch", "Český br");
    await page.waitForFunction(
      () => {
        const box = document.getElementById("iuWeatherMapPickerSuggest");
        if (!box || box.hidden) return false;
        const t = String(box.textContent || "");
        return /esk[yý]\s*Brod/i.test(t) || t.includes("Český Brod");
      },
      null,
      { timeout: 15000 }
    );

    const suggestText = await page.evaluate(() => {
      const box = document.getElementById("iuWeatherMapPickerSuggest");
      return box ? String(box.textContent || "") : "";
    });
    ok("runtime_suggest_cesky_brod", /Český Brod/i.test(suggestText), suggestText.slice(0, 120));

    const selectedBeforePick = await page.evaluate(() => {
      const el = document.getElementById("iuWeatherMapPickerSelected");
      return el ? String(el.textContent || "") : "";
    });
    ok(
      "runtime_selected_not_praha_while_typing",
      !/Vybráno:\s*Praha/i.test(selectedBeforePick),
      selectedBeforePick
    );

    await page.evaluate(() => {
      const box = document.getElementById("iuWeatherMapPickerSuggest");
      const btns = box ? box.querySelectorAll("button") : [];
      for (let i = 0; i < btns.length; i++) {
        if (/Český Brod/i.test(String(btns[i].textContent || ""))) {
          btns[i].click();
          return;
        }
      }
    });
    await page.waitForFunction(
      () => {
        const el = document.getElementById("iuWeatherMapPickerSelected");
        return el && /Český Brod/i.test(String(el.textContent || ""));
      },
      null,
      { timeout: 10000 }
    );

    const pending = await page.evaluate(() => {
      const ov = document.getElementById("iuWeatherMapPickerOverlay");
      return ov && ov.__iuWeatherPickerLastPick ? ov.__iuWeatherPickerLastPick : null;
    });
    ok("runtime_pending_cesky", !!(pending && /Český Brod/i.test(String(pending.label || ""))));
    ok(
      "runtime_pending_coords",
      !!(pending && Math.abs(Number(pending.lat) - CESKY.lat) < 0.05 && Math.abs(Number(pending.lon) - CESKY.lon) < 0.05),
      JSON.stringify(pending)
    );
    ok("runtime_pending_not_praha", !(pending && /Praha/i.test(String(pending.label || ""))));

    page.once("dialog", async (d) => {
      try {
        await d.accept();
      } catch (_) {}
    });
    await page.click("#iuWeatherMapPickerConfirm");
    await page.waitForFunction(
      () => {
        try {
          if (typeof window.iuWeatherLocationFingerprint !== "function") return false;
          const fp = window.iuWeatherLocationFingerprint();
          return (
            fp &&
            fp.mode === "manual" &&
            /Český Brod/i.test(String(fp.name || fp.manualLabel || "")) &&
            Math.abs(Number(fp.lat) - 50.074227) < 0.05
          );
        } catch (_) {
          return false;
        }
      },
      null,
      { timeout: 20000 }
    );

    const after = await page.evaluate(() => window.iuWeatherLocationFingerprint());
    ok("runtime_mode_manual", after && after.mode === "manual", JSON.stringify(after));
    ok("runtime_name_cesky", after && /Český Brod/i.test(String(after.name || after.manualLabel || "")), JSON.stringify(after));
    ok("runtime_not_gps_mode", !(after && after.mode === "gps"));

    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => typeof window.iuWeatherLocationFingerprint === "function", null, {
      timeout: 90000,
    });
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, {
      timeout: 90000,
    });
    await page.waitForFunction(
      () => {
        const fp = window.iuWeatherLocationFingerprint();
        return fp && fp.mode === "manual" && /Český Brod/i.test(String(fp.name || fp.manualLabel || ""));
      },
      null,
      { timeout: 30000 }
    );
    const reloaded = await page.evaluate(() => window.iuWeatherLocationFingerprint());
    ok("runtime_persist_manual", reloaded && reloaded.mode === "manual", JSON.stringify(reloaded));
    ok(
      "runtime_persist_cesky",
      reloaded && /Český Brod/i.test(String(reloaded.name || reloaded.manualLabel || "")),
      JSON.stringify(reloaded)
    );
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
    IU_WEATHER_MOJE_MESTO_AUTOCOMPLETE_GUARD: fails.length ? "FAIL" : "PASS",
    fails,
  };
  console.log(JSON.stringify(out));
  if (fails.length) {
    console.error("IU_WEATHER_MOJE_MESTO_AUTOCOMPLETE_GUARD_FAIL");
    process.exitCode = 1;
  } else {
    console.log("IU_WEATHER_MOJE_MESTO_AUTOCOMPLETE_GUARD_PASS");
  }
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
