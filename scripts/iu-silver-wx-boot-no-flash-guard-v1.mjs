#!/usr/bin/env node
/**
 * Silver weather boot: no CTA flash when geo granted; CTA OK when prompt.
 * Also checks nameday early cache path + ComputePhase pending≠firstVisit.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_silver_wx_boot_no_flash_guard.json");
const CTA = "Zobrazit počasí pro tvoji polohu?";

function staticContract() {
  const fails = [];
  const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const pipe = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
  const pkg = fs.readFileSync(path.join(REPO, "package.json"), "utf8");
  const smoke = fs.readFileSync(path.join(REPO, ".github", "workflows", "smoke.yml"), "utf8");

  if (!/data-iu-silver-wx-phase="boot"/.test(index)) fails.push("static_index_default_phase_not_boot");
  if (/data-iu-silver-wx-phase="firstVisit"/.test(index)) fails.push("static_index_still_has_firstVisit_markup");
  if (!/data-iu-silver-wx-boot/.test(index) || !/initializing/.test(index)) {
    fails.push("static_index_missing_initializing_boot");
  }
  if (!/iu:nameday:cache:v1/.test(index)) fails.push("static_index_missing_nameday_cache_early");
  if (!/__iuSilverWxGeoPerm/.test(index) && !/__iuSilverWxGeoPerm/.test(pipe)) {
    fails.push("static_missing_geo_perm_state");
  }
  const compute = pipe.indexOf("function iuSilverWeatherComputePhase");
  if (compute < 0) fails.push("static_missing_ComputePhase");
  else {
    const slice = pipe.slice(compute, compute + 1200);
    if (slice.indexOf('perm === "pending"') < 0 && slice.indexOf('perm === "granted"') < 0) {
      fails.push("static_ComputePhase_missing_perm_gate");
    }
    if (!/return "loading"/.test(slice)) fails.push("static_ComputePhase_missing_loading_for_pending");
  }
  if (pkg.indexOf("iu-silver-wx-boot-no-flash-guard") < 0) fails.push("package_json_missing_script");
  if (smoke.indexOf("iu-silver-wx-boot-no-flash-guard") < 0) fails.push("smoke_yml_missing_guard");
  return fails;
}

async function installConsent(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
}

async function mockGeoPerm(context, state) {
  await context.addInitScript((st) => {
    try {
      window.__iuSilverWxGeoPerm = st === "granted" ? "pending" : st;
      const orig = navigator.permissions && navigator.permissions.query
        ? navigator.permissions.query.bind(navigator.permissions)
        : null;
      if (!navigator.permissions) {
        // eslint-disable-next-line no-global-assign
        navigator.permissions = {};
      }
      navigator.permissions.query = async (desc) => {
        try {
          if (desc && String(desc.name) === "geolocation") {
            return { state: st, onchange: null, addEventListener() {}, removeEventListener() {} };
          }
        } catch (_) {}
        if (orig) return orig(desc);
        return { state: "prompt", onchange: null, addEventListener() {}, removeEventListener() {} };
      };
    } catch (_) {}
  }, state);
}

async function samplePhases(page, ms) {
  return page.evaluate(async (args) => {
    const CTA = args.cta;
    const out = [];
    const hero = document.getElementById("iuSilverHeroPremium");
    const start = performance.now();
    const push = () => {
      const card = document.getElementById("iuSilverWeatherCard");
      const l1 = document.getElementById("iuSilverWeatherLine1");
      const text = l1 ? String(l1.textContent || "") : "";
      const r = hero ? hero.getBoundingClientRect() : null;
      out.push({
        t: Math.round(performance.now() - start),
        phase: card ? card.getAttribute("data-iu-silver-wx-phase") : null,
        layout: card ? card.getAttribute("data-iu-silver-wx-layout") : null,
        hasCta: text.indexOf(CTA) !== -1,
        text: text.slice(0, 80),
        heroY: r ? Math.round(r.top) : null,
        svatek: (() => {
          const n = document.querySelector("#iuSilverWelcomeMeta .svatek-name");
          return n ? String(n.textContent || "").trim() : "";
        })(),
      });
    };
    push();
    const iv = setInterval(push, 50);
    await new Promise((r) => setTimeout(r, args.ms));
    clearInterval(iv);
    push();
    return out;
  }, { cta: CTA, ms });
}

function analyzeGranted(samples) {
  const fails = [];
  const ctaHits = samples.filter((s) => s.hasCta);
  if (ctaHits.length) fails.push("granted_cta_appeared:" + ctaHits.length);
  const ys = samples.map((s) => s.heroY).filter((y) => typeof y === "number");
  if (ys.length >= 2) {
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    if (max - min > 24) fails.push("granted_silver_jump_px:" + (max - min));
  }
  return { fails, ctaHits: ctaHits.length, heroDelta: ys.length ? Math.max(...ys) - Math.min(...ys) : 0 };
}

function analyzePrompt(samples) {
  const fails = [];
  const ctaIdx = samples.findIndex((s) => s.hasCta);
  if (ctaIdx < 0) fails.push("prompt_cta_never_appeared");
  else {
    const before = samples.slice(0, ctaIdx);
    const ctaBeforeWrong = before.filter((s) => s.hasCta);
    if (ctaBeforeWrong.length) fails.push("prompt_cta_before_settle_dup");
    /* After CTA appears, it may stay; must not flip away to loading then back repeatedly. */
    const after = samples.slice(ctaIdx);
    let flips = 0;
    let prev = true;
    for (const s of after) {
      if (s.hasCta !== prev) {
        flips += 1;
        prev = s.hasCta;
      }
    }
    if (flips > 2) fails.push("prompt_cta_oscillation:" + flips);
  }
  return { fails, ctaIdx };
}

async function runScenario(browser, base, name, permState, prepPage) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await installConsent(context);
  await mockGeoPerm(context, permState);
  const page = await context.newPage();
  if (typeof prepPage === "function") await prepPage(page, context);

  const phaseLog = [];
  await page.exposeFunction("__iuWxPhaseLog", (row) => {
    phaseLog.push(row);
  }).catch(() => {});

  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  const early = await page.evaluate((cta) => {
    const card = document.getElementById("iuSilverWeatherCard");
    const l1 = document.getElementById("iuSilverWeatherLine1");
    const text = l1 ? String(l1.textContent || "") : "";
    return {
      boot: document.documentElement.getAttribute("data-iu-silver-wx-boot"),
      phase: card ? card.getAttribute("data-iu-silver-wx-phase") : null,
      hasCta: text.indexOf(cta) !== -1,
      text: text.slice(0, 100),
    };
  }, CTA);

  const samples = await samplePhases(page, 3500);
  try {
    await waitForVaultReady(page, 90000);
  } catch (_) {}
  const lateSamples = await samplePhases(page, 2000);
  const all = samples.concat(lateSamples);

  let analysis;
  if (permState === "granted") analysis = analyzeGranted(all);
  else analysis = analyzePrompt(all);

  await context.close();
  return { name, early, analysis, sampleCount: all.length, last: all[all.length - 1] || null };
}

async function main() {
  const fails = staticContract();
  const evidence = { staticFails: fails.slice() };
  let server = null;
  let browser = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(9610, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;
    browser = await chromium.launch({ headless: true });

    const promptRun = await runScenario(browser, base, "PERMISSION_PROMPT", "prompt");
    evidence.prompt = promptRun;
    fails.push(...promptRun.analysis.fails);

    const grantedRun = await runScenario(browser, base, "PERMISSION_GRANTED", "granted", async (page, context) => {
      try {
        await context.grantPermissions(["geolocation"], { origin: base.replace(/\/projects\/?$/, "") });
      } catch (_) {}
      try {
        await context.setGeolocation({ latitude: 50.0755, longitude: 14.4378 });
      } catch (_) {}
      await page.addInitScript(() => {
        try {
          const key = "iuEarlyWxCacheV1";
          const data = {
            current: {
              temperature_2m: 18,
              apparent_temperature: 17,
              weather_code: 3,
              is_day: 1,
              wind_speed_10m: 5,
              wind_gusts_10m: 8,
              wind_direction_10m: 90,
              pressure_msl: 1015,
              relative_humidity_2m: 60,
              visibility: 10000,
            },
          };
          localStorage.setItem(
            key,
            JSON.stringify({ lat: 50.0755, lon: 14.4378, at: Date.now(), data })
          );
        } catch (_) {}
      });
    });
    evidence.granted = grantedRun;
    fails.push(...grantedRun.analysis.fails);
    if (grantedRun.early && grantedRun.early.hasCta) {
      fails.push("granted_early_paint_had_cta");
    }
    if (grantedRun.last && grantedRun.last.phase === "firstVisit") {
      fails.push("granted_ended_as_firstVisit");
    }
    if (grantedRun.last && grantedRun.last.hasCta) {
      fails.push("granted_ended_with_cta");
    }

    const report = {
      IU_SILVER_WX_BOOT_NO_FLASH_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      fails,
      evidence,
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
    if (fails.length) process.exit(1);
  } catch (err) {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    if (server) await stopGuardProcess(server.proc || null);
  }
}

main();
