/**
 * articles_freshness_cross_browser_guard — Chrome/WebKit/PWA must see fresh articles.json.
 * Run: node scripts/articles-freshness-cross-browser-guard.mjs
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { chromium, webkit } from "playwright";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PROD_BASE = (process.env.IU_PROD_BASE || "https://infouzel.cz").replace(/\/$/, "");
const USE_LOCAL = process.env.IU_GUARD_LOCAL === "1";
const PORT = String(process.env.IU_GUARD_PORT || "8890");
const MAX_AGE_H = Number(process.env.ARTICLES_FRESHNESS_MAX_AGE_H || "6");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sectionNewestAgeHours(doc, sectionKey) {
  const list = Array.isArray(doc.articles)
    ? doc.articles
    : Array.isArray(doc.items)
      ? doc.items
      : [];
  let newest = 0;
  for (const a of list) {
    const sec = String(a.section || a.topic || "").toLowerCase();
    if (sec !== sectionKey) continue;
    const t = Date.parse(a.publishedAt || a.pubDate || a.date || "") || 0;
    if (t > newest) newest = t;
  }
  if (!newest) return null;
  return (Date.now() - newest) / (3600 * 1000);
}

async function fetchProdArticles(base) {
  const res = await fetch(`${base}/projects/data/articles.json`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`articles.json HTTP ${res.status}`);
  return res.json();
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

async function runBrowserProof(launchFn, label, base, prodGeneratedAt) {
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
  await page.waitForSelector("#feed a.iuCardTitle, #newsList a.iuCardTitle", { timeout: 60000 }).catch(() => null);
  await page
    .waitForFunction(
      () => {
        const p = window.__iuFeedPipelineState;
        return p && p.hasLoadedData === true && p.isLoadingData !== true;
      },
      { timeout: 90000 },
    )
    .catch(() => null);
  await sleep(1500);

  const snap = await page.evaluate(async () => {
    const pipe = window.__iuFeedPipelineState || null;
    const gen = (pipe && pipe.lastArticlesGeneratedAt) || null;
    const labels = Array.from(document.querySelectorAll(".iuCardSource, .iu-source, [data-iu-source-label]"))
      .map((el) => String(el.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 12);
    const titles = Array.from(document.querySelectorAll("#feed a.iuCardTitle, #newsList a.iuCardTitle"))
      .map((a) => String(a.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 6);
    const reuseBefore = window.__iuArticlesSingleFlightReuseCount | 0;
    if (typeof window.__iuLoadData === "function") {
      await window.__iuLoadData();
    }
    const reuseAfter = window.__iuArticlesSingleFlightReuseCount | 0;
    const blockedReuse = reuseAfter > reuseBefore;
    const pipeAfter = window.__iuFeedPipelineState || null;
    const genAfter = (pipeAfter && pipeAfter.lastArticlesGeneratedAt) || null;
    return { gen, genAfter, labels, titles, reuseBefore, reuseAfter, blockedReuse, refetched: !blockedReuse };
  });

  await browser.close();

  const uiGen = snap.gen ? String(snap.gen).trim() : "";
  const prodGen = prodGeneratedAt ? String(prodGeneratedAt).trim() : "";
  const genMatch = !prodGen || !uiGen || uiGen === prodGen;

  return {
    label,
    uiGen,
    prodGen,
    genMatch,
    titles: snap.titles,
    labels: snap.labels,
    refetched: snap.refetched,
    reuseBefore: snap.reuseBefore,
    reuseAfter: snap.reuseAfter,
  };
}

function staticSingleFlightGuard() {
  const appJs = fs.readFileSync(path.join(root, "assets", "app.js"), "utf8");
  if (!appJs.includes("__iuInvalidateArticlesJsonSingleFlight")) {
    throw new Error("app.js missing __iuInvalidateArticlesJsonSingleFlight invalidation");
  }
  const fnBlock = appJs.match(/function __iuInvalidateFeedPrimaryJsonCache\(\)\s*\{[\s\S]*?\n\s*\}/);
  if (!fnBlock || !fnBlock[0].includes("__iuInvalidateArticlesJsonSingleFlight")) {
    throw new Error("__iuInvalidateFeedPrimaryJsonCache must invalidate articles single-flight");
  }
  console.log("[articles-freshness-cross-browser-guard] static single-flight invalidation OK");
}

async function main() {
  staticSingleFlightGuard();

  let base = PROD_BASE;
  let localServer = null;
  if (USE_LOCAL) {
    const started = await startLocalServer();
    localServer = started.server;
    base = started.base;
  }

  const prodDoc = await fetchProdArticles(base);
  const prodGeneratedAt = prodDoc.generatedAt || prodDoc.generated_at || null;
  if (!prodGeneratedAt) {
    throw new Error("production articles.json missing generatedAt");
  }
  const genAgeH = (Date.now() - Date.parse(prodGeneratedAt)) / (3600 * 1000);
  console.log(
    `[articles-freshness-cross-browser-guard] prod generatedAt=${prodGeneratedAt} age_h=${genAgeH.toFixed(2)}`,
  );
  if (genAgeH > MAX_AGE_H) {
    throw new Error(`production generatedAt older than ${MAX_AGE_H}h`);
  }

  for (const sec of ["aktualne", "sport", "finance", "zdravi"]) {
    const ageH = sectionNewestAgeHours(prodDoc, sec);
    if (ageH == null) {
      throw new Error(`production section ${sec} has no articles`);
    }
    console.log(`[articles-freshness-cross-browser-guard] prod section=${sec} newest_age_h=${ageH.toFixed(2)}`);
    if (ageH > MAX_AGE_H) {
      throw new Error(`production section ${sec} newest article older than ${MAX_AGE_H}h`);
    }
  }

  const engines = [
    { id: "chrome", launch: () => chromium.launch({ headless: true }) },
    { id: "safari", launch: () => webkit.launch({ headless: true }) },
    { id: "pwa", launch: () => webkit.launch({ headless: true }) },
  ];

  let fail = false;
  for (const eng of engines) {
    try {
      const proof = await runBrowserProof(eng.launch, eng.id, base, prodGeneratedAt);
      console.log(
        `[articles-freshness-cross-browser-guard] ${eng.id} uiGen=${proof.uiGen || "(none)"} genMatch=${proof.genMatch} refetched=${proof.refetched} titles=${proof.titles.length}`,
      );
      if (!proof.refetched) {
        console.error(
          `[articles-freshness-cross-browser-guard] FAIL ${eng.id}: loadData() did not refetch articles/bootstrap JSON`,
        );
        fail = true;
      }
      if (!proof.genMatch && proof.uiGen && prodGeneratedAt) {
        console.error(`[articles-freshness-cross-browser-guard] FAIL ${eng.id}: generatedAt mismatch ui=${proof.uiGen} prod=${prodGeneratedAt}`);
        fail = true;
      }
      if (!proof.titles.length) {
        console.error(`[articles-freshness-cross-browser-guard] FAIL ${eng.id}: no feed titles rendered`);
        fail = true;
      }
    } catch (e) {
      console.error(`[articles-freshness-cross-browser-guard] FAIL ${eng.id}:`, e.message || e);
      fail = true;
    }
  }

  if (localServer) {
    try {
      localServer.kill("SIGTERM");
    } catch (_) {}
  }

  if (fail) {
    console.error("[articles-freshness-cross-browser-guard] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[articles-freshness-cross-browser-guard] RESULT=PASS");
}

main().catch((e) => {
  console.error("[articles-freshness-cross-browser-guard] ERROR:", e.message || e);
  process.exit(1);
});
