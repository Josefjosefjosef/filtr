#!/usr/bin/env node
/**
 * Hard verify: 8× IU_AI_VIDEOS embed — real play (currentTime > 0).
 * Screenshots: artifacts/embed-verify/<AI>_<ID>_before.png, _after.png.
 * No production code changes. Run from repo root (npm ci + playwright installed).
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "artifacts", "embed-verify");

const IU_AI_VIDEOS = [
  { name: "ChatGPT", videoId: "JTxsNm9IdYU" },
  { name: "Google Gemini", videoId: "_TVnM9dmUSk" },
  { name: "Microsoft Copilot", videoId: "NbpVLqtML2M" },
  { name: "Claude", videoId: "oqUclC3gqKs" },
  { name: "Perplexity AI", videoId: "_vMOWw3uYvk" },
  { name: "DeepSeek", videoId: "i9kTrcf-gDQ" },
  { name: "Grok", videoId: "Hy46FSmgkmg" },
  { name: "Mistral AI", videoId: "tcBYaZqdc4A" },
];

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function verifyOne(page, item, index) {
  const { name, videoId } = item;
  const url = `https://www.youtube.com/embed/${videoId}?autoplay=0&mute=1`;
  const prefix = `${safeName(name)}_${videoId}`;
  let pass = false;
  let reason = "";

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2500);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUT_DIR, `${prefix}_before.png`) });

    const playBtn = page.locator('button[aria-label="Play"], .ytp-large-play-button, [class*="play-button"]').first();
    const video = page.locator("video").first();
    const playable = (await playBtn.count()) > 0 ? playBtn : video;

    if ((await playable.count()) > 0) {
      await playable.click();
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        const currentTime = await page.evaluate(() => {
          const v = document.querySelector("video");
          return v ? v.currentTime : 0;
        });
        if (currentTime > 0) {
          pass = true;
          reason = `currentTime=${currentTime.toFixed(1)}s`;
          break;
        }
      }
      if (!pass) reason = "currentTime still 0 after 10s";
    } else {
      if ((await video.count()) > 0) {
        await video.click();
        for (let i = 0; i < 10; i++) {
          await page.waitForTimeout(1000);
          const currentTime = await page.evaluate(() => {
            const v = document.querySelector("video");
            return v ? v.currentTime : 0;
          });
          if (currentTime > 0) {
            pass = true;
            reason = `currentTime=${currentTime.toFixed(1)}s`;
            break;
          }
        }
        if (!pass) reason = "currentTime 0 after 10s";
      } else {
        reason = "no play button or video element";
      }
    }

    await page.screenshot({ path: path.join(OUT_DIR, `${prefix}_after.png`) });
  } catch (e) {
    reason = (e.message || String(e)).slice(0, 80);
  }

  return { name, videoId, pass, reason };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = [];
  for (let i = 0; i < IU_AI_VIDEOS.length; i++) {
    const r = await verifyOne(page, IU_AI_VIDEOS[i], i);
    results.push(r);
    console.log(`${r.name}\t${r.videoId}\t${r.pass ? "PASS" : "FAIL"}\t${r.reason}`);
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log("\nScreenshots:", OUT_DIR);
  console.log("Summary: PASS", results.filter((r) => r.pass).length, "FAIL", failed.length);
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
