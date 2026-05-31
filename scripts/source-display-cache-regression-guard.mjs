/**
 * source_display_cache_regression_guard — stale Safari/PWA cache must not show old source rubrics.
 * Run: node scripts/source-display-cache-regression-guard.mjs
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { chromium, webkit } from "playwright";
import { sourceLabelHasForbiddenSubsection } from "./iu-source-display.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PROD_BASE = (process.env.IU_PROD_BASE || "https://infouzel.cz").replace(/\/$/, "");
const USE_LOCAL = process.env.IU_GUARD_LOCAL === "1";
const PORT = String(process.env.IU_GUARD_PORT || "8890");

const LEGACY_BAD = [
  "ČT24 / Domácí",
  "iDNES / Zprávy",
  "ČT24 – Domácí",
  "iDNES – Zprávy",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startLocalServer() {
  const server = spawn(process.execPath, [path.join(root, "server", "projects-static-and-vin.mjs")], {
    cwd: root,
    env: { ...process.env, PORT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    try {
      const r = await fetch(`${base}/projects/data/_probe.txt`, { cache: "no-store" });
      if (r.ok) return { server, base };
    } catch (_) {}
  }
  throw new Error(`local server not ready on ${base}`);
}

function collectSourceLabels(texts) {
  const bad = [];
  for (const t of texts) {
    const s = String(t || "").trim();
    if (!s) continue;
    if (LEGACY_BAD.some((b) => s.includes(b))) bad.push({ label: s, reason: "legacy_rubric" });
    if (sourceLabelHasForbiddenSubsection(s)) bad.push({ label: s, reason: "forbidden_subsection" });
  }
  return bad;
}

async function scrapeSources(launchFn, label, base) {
  const browser = await launchFn();
  const ctx = await browser.newContext({
    serviceWorkers: "allow",
    isMobile: label === "pwa",
    viewport: label === "pwa" ? { width: 390, height: 844 } : { width: 1366, height: 768 },
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/projects/?section=feed&topic=zpravy`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForSelector("#feed, #newsList", { timeout: 60000 }).catch(() => null);
  await sleep(5000);

  const labels = await page.evaluate(() => {
    const sel = [
      ".iuCardSource",
      ".iu-source",
      "[data-iu-source-label]",
      ".iuCardMeta .iuCardSourceLabel",
      ".feed-card-source",
    ];
    const out = [];
    for (const s of sel) {
      for (const el of document.querySelectorAll(s)) {
        const t = String(el.textContent || "").trim();
        if (t) out.push(t);
      }
    }
    return out.slice(0, 40);
  });

  await browser.close();
  return labels;
}

async function main() {
  let base = PROD_BASE;
  let localServer = null;
  if (USE_LOCAL) {
    const started = await startLocalServer();
    localServer = started.server;
    base = started.base;
  }

  const engines = [
    { id: "chrome", launch: () => chromium.launch({ headless: true }) },
    { id: "safari", launch: () => webkit.launch({ headless: true }) },
    { id: "pwa", launch: () => webkit.launch({ headless: true }) },
  ];

  let fail = false;
  for (const eng of engines) {
    const labels = await scrapeSources(eng.launch, eng.id, base);
    const bad = collectSourceLabels(labels);
    console.log(
      `[source-display-cache-regression-guard] ${eng.id} labels=${labels.length} bad=${bad.length}`,
    );
    if (bad.length) {
      for (const row of bad.slice(0, 8)) {
        console.error(`  - ${eng.id} ${row.reason}: ${row.label}`);
      }
      fail = true;
    }
  }

  if (localServer) {
    try {
      localServer.kill("SIGTERM");
    } catch (_) {}
  }

  if (fail) {
    console.error("[source-display-cache-regression-guard] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[source-display-cache-regression-guard] RESULT=PASS");
}

main().catch((e) => {
  console.error("[source-display-cache-regression-guard] ERROR:", e.message || e);
  process.exit(1);
});
