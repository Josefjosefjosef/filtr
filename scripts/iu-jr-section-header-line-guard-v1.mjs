#!/usr/bin/env node
/**
 * Jízdní řády: section header divider line must match orange heading (not blue content accent).
 * Run: npm run iu-jr-section-header-line-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-jr-section-header-line-guard
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8910", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const VIEWPORTS = [
  { id: "mobile", width: 390, height: 844 },
  { id: "tablet", width: 768, height: 1024 },
  { id: "desktop", width: 1280, height: 900 },
];

const JR_ORANGE = { r: 245, g: 158, b: 11 };
const JR_ORANGE_HEX = "#F59E0B";

function readStaticChecks() {
  const appCss = fs.readFileSync(path.join(REPO, "assets", "app.css"), "utf8");
  const checks = [
    {
      id: "newslist_jr_accent_override",
      pass: /#newsList\s+#iuJrEmptyView\s+\.iuSectionHeader--jr[\s\S]*?--iuSectionAccent\s*:\s*#F59E0B/i.test(
        appCss
      ),
    },
    {
      id: "jr_header_line_uses_section_accent",
      pass: /#iuJrEmptyView\s+\.iuSectionHeader--jr\s+\.iuSectionHeaderLine[\s\S]*?var\(--iuSectionAccent\)/.test(
        appCss
      ),
    },
    {
      id: "jr_h2_orange",
      pass: /#iuJrEmptyView\s+\.iuSectionHeader--jr\s+h2[\s\S]*?color\s*:\s*#F59E0B/i.test(appCss),
    },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, checks, fails };
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

function buildUrl(params) {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const p = new URLSearchParams(params || {});
  if (isLocal) p.set("iuRobust", "1");
  if (/infouzel\.cz/i.test(BASE)) p.set("nosw", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

function parseRgb(color) {
  const m = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function nearOrange(rgb, tol = 18) {
  if (!rgb) return false;
  return (
    Math.abs(rgb.r - JR_ORANGE.r) <= tol &&
    Math.abs(rgb.g - JR_ORANGE.g) <= tol &&
    Math.abs(rgb.b - JR_ORANGE.b) <= tol
  );
}

function isBlueish(rgb) {
  if (!rgb) return false;
  return rgb.b > rgb.r && rgb.b > 140;
}

async function auditViewport(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(buildUrl({ section: "jr" }), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => {
      const header = document.querySelector("#iuJrEmptyView .iuSectionHeader--jr");
      const h2 = header && header.querySelector("h2");
      return !!header && !!h2 && String(document.body?.dataset?.section || "").toLowerCase() === "jr";
    },
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(400);

  const sample = await page.evaluate(() => {
    const header = document.querySelector("#iuJrEmptyView .iuSectionHeader--jr");
    const h2 = header ? header.querySelector("h2") : null;
    const line = header ? header.querySelector(".iuSectionHeaderLine") : null;
    if (!header || !h2 || !line) {
      return { ok: false, reason: "missing_elements" };
    }
    const h2Style = getComputedStyle(h2);
    const lineStyle = getComputedStyle(line);
    const accent = getComputedStyle(header).getPropertyValue("--iuSectionAccent").trim();
    return {
      ok: true,
      h2Color: h2Style.color,
      accent,
      lineBackground: lineStyle.backgroundImage || lineStyle.background || "",
      lineOpacity: lineStyle.opacity,
      lineHeight: lineStyle.height,
    };
  });

  if (!sample.ok) {
    return { viewport: viewport.id, pass: false, reason: sample.reason };
  }

  const h2Rgb = parseRgb(sample.h2Color);
  const accentLower = String(sample.accent || "").toLowerCase();
  const accentOk = accentLower === JR_ORANGE_HEX.toLowerCase() || nearOrange(parseRgb(sample.accent));
  const h2Ok = nearOrange(h2Rgb);
  const notBlue = !isBlueish(h2Rgb);
  const lineHasAccent = String(sample.lineBackground).includes("linear-gradient");
  const pass = h2Ok && accentOk && notBlue && lineHasAccent;

  return {
    viewport: viewport.id,
    pass,
    h2Color: sample.h2Color,
    accent: sample.accent,
    lineBackground: sample.lineBackground.slice(0, 120),
    h2Ok,
    accentOk,
    notBlue,
    lineHasAccent,
  };
}

async function auditMapyRegression(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl({ section: "mapy" }), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => String(document.body?.dataset?.section || "").toLowerCase() === "mapy",
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(400);
  const sample = await page.evaluate(() => {
    const header = document.querySelector("#iuMapyView .iuSectionHeader--mapy");
    const h2 = header ? header.querySelector("h2") : null;
    if (!header || !h2) return { ok: false };
    const accent = getComputedStyle(header).getPropertyValue("--iuSectionAccent").trim();
    const rgb = getComputedStyle(h2).color;
    return { ok: true, accent, h2Color: rgb };
  });
  if (!sample.ok) return { pass: false, reason: "mapy_missing" };
  const rgb = parseRgb(sample.h2Color);
  const greenish = rgb && rgb.g > rgb.b && rgb.g >= 120;
  return { pass: greenish, accent: sample.accent, h2Color: sample.h2Color };
}

async function main() {
  const staticAudit = readStaticChecks();
  if (!staticAudit.pass) {
    process.stdout.write(
      JSON.stringify({ pass: false, stage: "static", fails: staticAudit.fails }) + "\n"
    );
    process.exit(1);
  }

  let server = null;
  if (USE_LOCAL_SERVER) {
    server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      stdio: "ignore",
      env: { ...process.env, PORT: String(PORT) },
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, {});
  const page = await context.newPage();

  const viewportResults = [];
  for (const vp of VIEWPORTS) {
    viewportResults.push(await auditViewport(page, vp));
  }
  const mapyRegression = await auditMapyRegression(page);

  await browser.close();
  if (server) server.kill("SIGTERM");

  const allViewportsPass = viewportResults.every((r) => r.pass);
  const pass = allViewportsPass && mapyRegression.pass;

  process.stdout.write(
    JSON.stringify({
      pass,
      static: staticAudit.checks.map((c) => ({ id: c.id, pass: c.pass })),
      viewports: viewportResults,
      mapyRegression,
    }) + "\n"
  );

  if (!pass) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
