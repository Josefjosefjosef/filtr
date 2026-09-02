#!/usr/bin/env node
/**
 * MENU_TOOL_FALSE_ERROR_EMPTY_SPACE_GUARD
 *
 * Menu tool subsections (mapy, jr, affiliate, radio, tvonline, tvprogram, pocasi)
 * must not show a false #lastErrInline after successful section content, and must
 * not leave a large document gap below the real section content for that error.
 *
 * Usage:
 *   node scripts/iu-menu-tool-false-error-empty-space-guard-v1.cjs
 *   IU_GUARD_URL=https://infouzel.cz/projects/ node scripts/iu-menu-tool-false-error-empty-space-guard-v1.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "..");
const EXTERNAL_URL = process.env.IU_GUARD_URL || null;
const PORT = Number(process.env.IU_GUARD_PORT || 8795);
const FALSE_ERR = "Obsah se nepodařilo zobrazit. Zkus stránku obnovit.";

const SECTIONS = [
  { section: "mapy", viewId: "iuMapyView" },
  { section: "jr", viewId: "iuJrEmptyView" },
  { section: "aff-cestovni-kancelare", viewId: "iuAffiliateView" },
  { section: "radio", viewId: "iuRadioView" },
  { section: "tvonline", viewId: "iuTvOnlineView" },
  { section: "tvprogram", viewId: "iuTvProgramView" },
  { section: "pocasi", viewId: "iuWeatherView" },
];

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const fp = path.join(REPO, p.replace(/^\/+/, ""));
        if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
          return;
        }
        res.writeHead(200, {
          "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream",
        });
        res.end(fs.readFileSync(fp));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function staticSourceGate() {
  const pipeline = fs.readFileSync(path.join(REPO, "assets/iu-app-feed-pipeline-v1.js"), "utf8");
  const appJs = fs.readFileSync(path.join(REPO, "assets/app.js"), "utf8");
  const checks = [];
  checks.push({
    id: "helper_iuFeedPipelineDomActiveP",
    pass: pipeline.indexOf("function iuFeedPipelineDomActiveP") !== -1,
  });
  checks.push({
    id: "applyFilter_gates_doRender",
    pass: /iuFeedPipelineDomActiveP\(\)\s*\)\s*doRender\s*=\s*false/.test(pipeline),
  });
  checks.push({
    id: "renderFeed_skips_false_error_when_inactive",
    pass:
      pipeline.indexOf("if (!iuFeedPipelineDomActiveP())") !== -1 &&
      pipeline.indexOf("video-only batches are intentionally skipped") !== -1,
  });
  checks.push({
    id: "loadData_skips_first_render_on_tools",
    pass: pipeline.indexOf("await renderItems(state.filteredItems);") !== -1 &&
      /if \(iuFeedPipelineDomActiveP\(\)\) \{\s*\n\s*await renderItems\(state\.filteredItems\);/.test(pipeline),
  });
  checks.push({
    id: "applySection_clears_lastErrInline_on_tools",
    pass:
      appJs.indexOf("tool subsections must not keep a stale feed #lastErrInline") !== -1 &&
      appJs.indexOf('getElementById("lastErrInline")') !== -1,
  });
  return checks;
}

async function measure(page, spec) {
  return page.evaluate((s) => {
    const err = document.getElementById("lastErrInline");
    const view = document.getElementById(s.viewId);
    const errCs = err ? getComputedStyle(err) : null;
    const errText = err ? String(err.textContent || "").trim() : "";
    const viewCs = view ? getComputedStyle(view) : null;
    const viewRect = view ? view.getBoundingClientRect() : null;
    const errRect = err ? err.getBoundingClientRect() : null;
    const docH = document.documentElement.scrollHeight;
    const viewBottomDoc = viewRect ? viewRect.bottom + (window.scrollY || window.pageYOffset || 0) : 0;
    const gapDoc = Math.max(0, Math.round(docH - viewBottomDoc));
    return {
      errDisplay: errCs ? errCs.display : "missing",
      errText: errText.slice(0, 160),
      falseErrVisible:
        errCs &&
        errCs.display !== "none" &&
        errCs.visibility !== "hidden" &&
        Number(errCs.opacity || "1") > 0.05 &&
        /Obsah se nepodařilo zobrazit/i.test(errText),
      viewDisplay: viewCs ? viewCs.display : "missing",
      viewH: viewRect ? Math.round(viewRect.height) : 0,
      docH,
      gapDocAfterView: gapDoc,
      fc: document.body.getAttribute("data-iu-fc") || "",
      toolMain: document.body.getAttribute("data-iu-tool-main") || "",
      section: document.body.getAttribute("data-section") || "",
    };
  }, spec);
}

async function run() {
  const staticChecks = staticSourceGate();
  const staticFail = staticChecks.filter((c) => !c.pass);
  if (staticFail.length) {
    console.log(
      JSON.stringify({ pass: false, stage: "static", failed: staticFail, checks: staticChecks }, null, 2)
    );
    process.exit(1);
  }

  let server = null;
  let baseUrl = EXTERNAL_URL;
  if (!baseUrl) {
    server = await startServer();
    baseUrl = `http://127.0.0.1:${PORT}/projects/`;
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      });
      for (const spec of SECTIONS) {
        const page = await context.newPage();
        const url = `${baseUrl}${baseUrl.indexOf("?") >= 0 ? "&" : "?"}section=${encodeURIComponent(spec.section)}`.replace(
          "/projects/?",
          "/projects/?"
        );
        const target = baseUrl.endsWith("/")
          ? `${baseUrl}?section=${encodeURIComponent(spec.section)}`
          : `${baseUrl}${baseUrl.indexOf("?") >= 0 ? "&" : "?"}section=${encodeURIComponent(spec.section)}`;
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForTimeout(3500);
        try {
          await page.waitForFunction(
            (id) => {
              const el = document.getElementById(id);
              return el && getComputedStyle(el).display !== "none";
            },
            spec.viewId,
            { timeout: 10000 }
          );
        } catch (_) {}
        const snap = await measure(page, spec);
        const pass =
          snap.falseErrVisible === false &&
          snap.viewDisplay !== "none" &&
          snap.viewH > 40 &&
          snap.gapDocAfterView <= 220;
        results.push({
          vp: vp.name,
          section: spec.section,
          pass,
          ...snap,
          maxGapAllowed: 220,
        });
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    if (server) server.close();
  }

  const failed = results.filter((r) => !r.pass);
  const report = {
    pass: failed.length === 0,
    falseErrNeedle: FALSE_ERR,
    staticChecks,
    results,
    failed,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
