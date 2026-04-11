/**
 * applyFilter CPU audit — requires ?iuApplyFilterAudit=1 (see projects/index.html) + assets/app.js.
 *
 * Env:
 *   APPLY_FILTER_AUDIT_URL (default http://127.0.0.1:8080/projects/?section=media&iuApplyFilterAudit=1)
 *   APPLY_FILTER_AUDIT_RUNS per viewport (default 5)
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.APPLY_FILTER_AUDIT_PORT || 8080);
const BASE =
  process.env.APPLY_FILTER_AUDIT_URL ||
  `http://127.0.0.1:${PORT}/projects/?section=media&iuApplyFilterAudit=1&iuClusterEngineAudit=1`;
const RUNS = Math.max(1, parseInt(process.env.APPLY_FILTER_AUDIT_RUNS || "5", 10));
const USE_LOCAL_SERVER = String(process.env.APPLY_FILTER_AUDIT_LOCAL_SERVER || "1") === "1";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1366, height: 768 },
];

function serveFile(urlPath) {
  let filePath = path.join(ROOT, (urlPath === "/" || urlPath === "") ? "index.html" : urlPath.replace(/^\//, "").replace(/\/$/, "") || "index.html");
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
          ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".json" ? "application/json" : ext === ".ico" ? "image/x-ico" : "text/html";
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

function stats(arr) {
  const a = arr.filter((x) => typeof x === "number" && Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return { median: null, p95: null, max: null };
  const mid = Math.floor(a.length / 2);
  const median = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  const p95i = Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1);
  return { median, p95: a[Math.max(0, p95i)], max: a[a.length - 1] };
}

async function oneRun(page, vw) {
  await page.setViewportSize({ width: vw.width, height: vw.height });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  try {
    await page.route("**/sw.js", (route) => route.abort());
  } catch (_) {}
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(
    () =>
      window.__IU_APPLYFILTER_AUDIT_REPORT__ &&
      Array.isArray(window.__IU_APPLYFILTER_AUDIT_REPORT__.runs) &&
      window.__IU_APPLYFILTER_AUDIT_REPORT__.runs.length >= 1,
    { timeout: 120000 }
  );
  await page.waitForTimeout(2000);
  await page
    .waitForFunction(
      () => {
        const rep = window.__IU_APPLYFILTER_AUDIT_REPORT__;
        if (!rep || !Array.isArray(rep.runs)) return false;
        return rep.runs.some((x) => x && x.passTag === "post_idle_full");
      },
      { timeout: 180000 }
    )
    .catch(() => {});
  // requestIdleCallback may schedule full-cluster pass after retention's applyFilter; give it headroom.
  await page.waitForTimeout(45000);
  let cls = null;
  let overflowX = null;
  let railShift = null;
  try {
    const clsProbe = await page.evaluate(() => {
      let c = 0;
      try {
        if (typeof performance !== "undefined" && performance.getEntriesByType) {
          const e = performance.getEntriesByType("layout-shift");
          for (let i = 0; i < e.length; i++) {
            const x = e[i];
            if (x && !x.hadRecentInput) c += Number(x.value) || 0;
          }
        }
      } catch (_) {}
      let ox = false;
      try {
        ox = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
      } catch (_) {}
      let rs = 0;
      try {
        const rail = document.querySelector(".iuRightRail, .layout__rail, aside");
        if (rail) rs = Number(rail.getBoundingClientRect().x) || 0;
      } catch (_) {}
      return { cls: c, overflowX: ox, railShift: rs };
    });
    cls = clsProbe.cls;
    overflowX = clsProbe.overflowX;
    railShift = clsProbe.railShift;
  } catch (_) {}

  const rep = await page.evaluate(() => window.__IU_APPLYFILTER_AUDIT_REPORT__ || null);
  const clusterEngineAuditLast = await page.evaluate(() => window.__IU_CLUSTER_ENGINE_AUDIT_LAST__ || null);
  const clickMs = await page.evaluate(() => {
    try {
      const hb = document.querySelector(".iuHamburger");
      if (hb) hb.click();
    } catch (_) {}
    return null;
  });
  void clickMs;

  return {
    viewport: vw.name,
    url: BASE,
    runs: rep && rep.runs ? rep.runs : [],
    clusterEngineAuditLast,
    consoleErrorsCount: consoleErrors.length,
    appErrorsCount: 0,
    cls,
    overflowX,
    railShift,
    firstSuccessfulClickHandledMs: null,
  };
}

async function main() {
  let server = null;
  if (USE_LOCAL_SERVER && (BASE.includes("127.0.0.1") || BASE.includes("localhost"))) {
    server = await startServer();
  }
  const browser = await chromium.launch({ headless: true });
  const allRows = [];
  try {
    for (const vw of VIEWPORTS) {
      for (let i = 0; i < RUNS; i++) {
        const page = await browser.newPage();
        const row = await oneRun(page, vw);
        row.runIndex = i + 1;
        await page.close();
        console.log(JSON.stringify(row));
        allRows.push(row);
      }
    }
  } finally {
    await browser.close();
    if (server && server.close) {
      try {
        server.close();
      } catch (_) {}
    }
  }

  const capped = [];
  const idleFull = [];
  const idleClusterMapMs = [];
  const idlePairCompareMs = [];
  const idleTimeReject = [];
  for (const row of allRows) {
    const runs = row.runs || [];
    for (let j = 0; j < runs.length; j++) {
      const r = runs[j];
      const tag = r.passTag || "";
      const ms = r.applyFilterDurationMs;
      if (tag === "capped_initial" && typeof ms === "number") capped.push(ms);
      if (tag === "post_idle_full" && typeof ms === "number") idleFull.push(ms);
    }
    const ce = row.clusterEngineAuditLast;
    if (ce && typeof ce.clusterMapMs === "number") idleClusterMapMs.push(ce.clusterMapMs);
    if (ce && typeof ce.pairCompareDurationMs === "number") idlePairCompareMs.push(ce.pairCompareDurationMs);
    if (ce && typeof ce.timeRejectBeforeSemanticCount === "number") idleTimeReject.push(ce.timeRejectBeforeSemanticCount);
  }

  console.log(
    JSON.stringify({
      aggregate: {
        cappedApplyFilterMs: stats(capped),
        postIdleFullApplyFilterMs: stats(idleFull),
        postIdleClusterMapMs: stats(idleClusterMapMs),
        postIdlePairCompareDurationMs: stats(idlePairCompareMs),
        timeRejectBeforeSemanticCount: stats(idleTimeReject),
      },
      note:
        "capped_initial = first pass with cluster cap when nArt>cap; post_idle_full = requestIdleCallback full clustering; clusterEngineAuditLast = last buildPublicationClusterUrlMap (idle full pass)",
    })
  );
  try {
    process.stdout.write("\x07");
  } catch (_) {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
