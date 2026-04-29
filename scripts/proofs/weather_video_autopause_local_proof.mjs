#!/usr/bin/env node
/**
 * Local proof: Počasí inline historical video stops when leaving the section.
 * Viewports: 390×844, 768×1024, 1440×900.
 *
 * Env: IU_WEATHER_VIDEO_PROOF_PORT (default 8092)
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Math.max(1024, parseInt(process.env.IU_WEATHER_VIDEO_PROOF_PORT || "8092", 10));
const BASE = `http://127.0.0.1:${PORT}`;
const GOTO_MS = 35000;
const PLAY_WAIT_MS = 28000;

const VIEWPORTS = [
  { key: "viewport_mobile_390x844", width: 390, height: 844 },
  { key: "viewport_tablet_768x1024", width: 768, height: 1024 },
  { key: "viewport_desktop_1440x900", width: 1440, height: 900 },
];

function serveFile(urlPath) {
  let filePath = path.join(
    ROOT,
    urlPath === "/" || urlPath === "" ? "index.html" : urlPath.replace(/^\//, "").replace(/\/$/, "") || "index.html"
  );
  if (urlPath && urlPath !== "/" && !urlPath.startsWith("/projects")) {
    const lastSeg = (urlPath.split("?")[0] || "").split("/").filter(Boolean).pop() || "";
    if (!path.extname(lastSeg)) {
      const p = path.join(ROOT, urlPath.replace(/^\//, "").split("/")[0]);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) filePath = path.join(p, "index.html");
    }
  }
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT)) && !filePath.includes(ROOT)) return null;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath);
        const ct =
          ext === ".css"
            ? "text/css"
            : ext === ".js"
              ? "application/javascript"
              : ext === ".json"
                ? "application/json"
                : ext === ".ico"
                  ? "image/x-icon"
                  : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function gitShort(refCmd) {
  try {
    return execSync(refCmd, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function gotoDom(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_MS });
}

async function leaveWeatherToHub(page, vw) {
  if (vw <= 900) {
    await page.locator('[data-iu-bottom-nav="home"]').first().click({ timeout: 12000 });
  } else {
    await page.locator('.iu-leftNavItem[data-accent="media"][data-media-topic="all"]').first().click({ timeout: 12000 });
  }
}

async function runOneViewport(page, vp) {
  let consoleErr = 0;
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (/favicon\.ico/i.test(text)) return;
      consoleErr += 1;
    }
  });

  const out = {
    weather_opened: false,
    weather_video_started: false,
    left_weather_via: "",
    active_weather_iframe_after_leave: false,
    active_weather_iframe_src_after_leave: "",
    weather_video_reset_or_stopped: false,
    consoleErrorsCount: 0,
    appErrorsCount: 0,
    result: "FAIL",
  };

  try {
    await gotoDom(page, `${BASE}/projects/?section=pocasi`);
    await page.waitForTimeout(1600);
    out.weather_opened = true;

    await page.waitForSelector("#iuWeatherHistoryPlay", { timeout: 30000 });
    const cardHidden = await page.evaluate(() => {
      const c = document.getElementById("iuWeatherHistoryCard");
      return !!(c && c.hidden);
    });
    if (cardHidden) {
      out.result = "FAIL_card_hidden";
      return out;
    }

    await page.click("#iuWeatherHistoryPlay");
    await page.waitForTimeout(900);
    await page.waitForSelector("#iuWeatherHistoryPlayerHost iframe.iuVideoIframe", { timeout: PLAY_WAIT_MS });
    out.weather_video_started = true;

    out.left_weather_via = vp.width <= 900 ? "bottom_nav_home" : "left_nav_media";

    await leaveWeatherToHub(page, vp.width);
    await page.waitForTimeout(900);

    const probe = await page.evaluate(() => {
      const wv = document.getElementById("iuWeatherView");
      const host = document.getElementById("iuWeatherHistoryPlayerHost");
      const ifr = wv ? wv.querySelector("#iuWeatherHistoryPlayerHost iframe, .iu-weather-video-embed-host iframe") : null;
      const kids = host && typeof host.childElementCount === "number" ? host.childElementCount : -1;
      const src = ifr && ifr.getAttribute ? String(ifr.getAttribute("src") || "") : "";
      const appErr = (() => {
        try {
          return localStorage.getItem("iu:lastError") ? 1 : 0;
        } catch {
          return 0;
        }
      })();
      return {
        hasIframe: !!ifr,
        src,
        hostKids: kids,
        appErrorsCount: appErr,
      };
    });

    out.active_weather_iframe_after_leave = probe.hasIframe;
    out.active_weather_iframe_src_after_leave = probe.src ? "nonempty" : "empty";
    out.appErrorsCount = probe.appErrorsCount;
    out.consoleErrorsCount = consoleErr;
    out.weather_video_reset_or_stopped = !probe.hasIframe && probe.hostKids === 0;
    out.result =
      out.weather_video_reset_or_stopped && out.consoleErrorsCount === 0 && out.appErrorsCount === 0 ? "PASS" : "FAIL";
  } catch (e) {
    out.result = `FAIL_${String(e && e.message ? e.message : e).slice(0, 120)}`;
    out.consoleErrorsCount = consoleErr;
  }
  return out;
}

function fmtVpLine(key, o) {
  return [
    `${key}`,
    `weather_opened:${o.weather_opened}`,
    `weather_video_started:${o.weather_video_started}`,
    `left_weather_via:${o.left_weather_via}`,
    `active_weather_iframe_after_leave:${o.active_weather_iframe_after_leave}`,
    `active_weather_iframe_src_after_leave:${o.active_weather_iframe_src_after_leave}`,
    `weather_video_reset_or_stopped:${o.weather_video_reset_or_stopped}`,
    `consoleErrorsCount:${o.consoleErrorsCount}`,
    `appErrorsCount:${o.appErrorsCount}`,
    `result:${o.result}`,
  ].join(":");
}

async function main() {
  const server = await startServer();
  const branch = gitShort("git rev-parse --abbrev-ref HEAD");
  const commit = gitShort("git rev-parse HEAD");
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      page.on("pageerror", (err) => {
        console.error("[proof pageerror]", err.message);
      });
      const r = await runOneViewport(page, vp);
      results.push({ key: vp.key, r });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const overall =
    results.every((x) => x.r.result === "PASS") && results.length === VIEWPORTS.length ? "PASS" : "FAIL";

  console.log("=== WEATHER_VIDEO_AUTOPAUSE_LOCAL_PROOF ===");
  console.log(`branch:${branch}:commit:${commit}`);
  for (const { key, r } of results) {
    console.log(fmtVpLine(key, r));
  }
  console.log(`overall_result:${overall}`);
  console.log("=== END_WEATHER_VIDEO_AUTOPAUSE_LOCAL_PROOF ===");

  if (overall !== "PASS") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
