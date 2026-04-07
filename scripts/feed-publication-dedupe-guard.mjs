/**
 * Publication dedupe + cross-section guard (local static server).
 * Run: node scripts/feed-publication-dedupe-guard.mjs
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PORT = String(process.env.IU_GUARD_PORT || "9878");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const server = spawn(process.execPath, [path.join(root, "server", "projects-static-and-vin.mjs")], {
    cwd: root,
    env: { ...process.env, PORT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  const collect = (c) => {
    boot += c.toString();
  };
  server.stderr.on("data", collect);
  server.stdout.on("data", collect);
  for (let i = 0; i < 80; i++) {
    await sleep(50);
    if (/127\.0\.0\.1/.test(boot) || /9878|8890|9877/.test(boot)) break;
  }

  const base = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch({ headless: true });
  let consoleErrorsCount = 0;
  let appErrorsCount = 0;

  async function runPage(suffix) {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrorsCount += 1;
    });
    page.on("pageerror", () => {
      consoleErrorsCount += 1;
      appErrorsCount += 1;
    });
    await page.goto(base + suffix, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector("#feed a.iuCardTitle", { timeout: 60000 });
    await sleep(5000);
    const snap = await page.evaluate(() => {
      const u = new URL(location.href);
      const topic = u.searchParams.get("topic") || "";
      const hrefs = Array.from(document.querySelectorAll("#feed a.iuCardTitle")).map((a) =>
        String(a.getAttribute("href") || "").trim().toLowerCase(),
      );
      const pub =
        typeof window.__iuPublicationFeedFilter === "object" && window.__iuPublicationFeedFilter !== null
          ? window.__iuPublicationFeedFilter
          : null;
      let railShift = typeof window.__iuRailShiftProbe === "number" ? window.__iuRailShiftProbe : 0;
      const de = document.documentElement;
      const overflowX = de.scrollWidth > de.clientWidth + 2;
      return { topic, hrefs, pub, railShift: Math.round(railShift), overflowX };
    });
    await ctx.close();
    return snap;
  }

  try {
    const articlesRes = await fetch(base + "/projects/data/articles.json");
    const articlesJson = await articlesRes.json();
    const list = Array.isArray(articlesJson.articles) ? articlesJson.articles : [];
    const byTs = (a) => Date.parse(a.publishedAt || a.pubDate || a.date || "") || 0;
    const sorted = [...list].sort((a, b) => byTs(b) - byTs(a));
    const newestSport = sorted.find((a) => String(a.section || a.topic || "").toLowerCase() === "sport" && a.url);
    const newestFin = sorted.find((a) => String(a.section || a.topic || "").toLowerCase() === "finance" && a.url);
    const sportU = newestSport ? new URL(newestSport.url) : null;
    const finU = newestFin ? new URL(newestFin.url) : null;

    const def = await runPage("/projects/");
    const zpravy = await runPage("/projects/?section=feed&topic=zpravy");
    const sport = await runPage("/projects/?section=feed&topic=sport");
    const finance = await runPage("/projects/?section=feed&topic=finance");
    const zdravi = await runPage("/projects/?section=feed&topic=zdravi");
    const cestovani = await runPage("/projects/?section=feed&topic=cestovani");

    const sportHost = sportU ? sportU.hostname.replace(/^www\./, "").toLowerCase() : "";
    const defaultHasCrossSection =
      Boolean(sportHost) &&
      def.hrefs.some((h) => h.includes(sportHost)) &&
      Boolean(finU) &&
      def.hrefs.some((h) => h.includes(finU.hostname.replace(/^www\./, "").toLowerCase()));

    const zpravyBlocksPureSportHost = !zpravy.hrefs.slice(0, 18).some((h) => h.includes("sport.ceskatelevize.cz"));
    const sportFeedHasSport = sport.hrefs.slice(0, 10).some((h) => h.includes("sport.") || /\/fotbal\/|\/hokej\/|isport\./.test(h));
    const financeFeedHasFinance = finance.hrefs.slice(0, 12).some(
      (h) => /ekonomik|finance|ministerstvo|peněz|penez/i.test(h),
    );
    const zdraviFeedHasZdravi = zdravi.hrefs.slice(0, 15).some(
      (h) => /zdrav|zdravi|lek|nemoc|poliklinik/i.test(h),
    );
    const cestovaniOk = cestovani.hrefs.length >= 5;

    const pub = def.pub;
    const PASS_PUBLICATION_META =
      pub &&
      typeof pub.articlesIn === "number" &&
      typeof pub.keptArticles === "number" &&
      pub.articlesIn >= 50 &&
      pub.keptArticles >= 40 &&
      pub.keptArticles <= pub.articlesIn;

    const railShift = Math.max(def.railShift, zpravy.railShift, sport.railShift, finance.railShift, zdravi.railShift, cestovani.railShift);
    const overflowX =
      def.overflowX ||
      zpravy.overflowX ||
      sport.overflowX ||
      finance.overflowX ||
      zdravi.overflowX ||
      cestovani.overflowX;

    const PASS_DEFAULT_GLOBAL = def.topic === "" && defaultHasCrossSection && def.hrefs.length > 40;
    const PASS_ZPRAVY = zpravy.topic === "zpravy" && zpravyBlocksPureSportHost && zpravy.hrefs.length > 20;
    const PASS_SPORT_FILTER = sport.topic === "sport" && sportFeedHasSport;
    const PASS_FINANCE_FILTER = finance.topic === "finance" && financeFeedHasFinance;
    const PASS_ZDRAVI = zdravi.topic === "zdravi" && zdraviFeedHasZdravi;
    const PASS_CESTOVANI = cestovani.topic === "cestovani" && cestovaniOk;
    const PASS_ZERO_ERR = consoleErrorsCount === 0 && appErrorsCount === 0;
    const PASS_LAYOUT = !overflowX && railShift <= 1;

    const report = {
      PASS_DEFAULT_GLOBAL,
      PASS_ZPRAVY,
      PASS_SPORT_FILTER,
      PASS_FINANCE_FILTER,
      PASS_ZDRAVI,
      PASS_CESTOVANI,
      PASS_PUBLICATION_META,
      PASS_ZERO_ERR,
      PASS_LAYOUT,
      consoleErrorsCount,
      appErrorsCount,
      overflowX,
      railShift,
      publicationMeta: pub,
      defaultFeedCount: def.hrefs.length,
    };

    process.stdout.write(JSON.stringify(report, null, 2) + "\n");

    const allPass =
      PASS_DEFAULT_GLOBAL &&
      PASS_ZPRAVY &&
      PASS_SPORT_FILTER &&
      PASS_FINANCE_FILTER &&
      PASS_ZDRAVI &&
      PASS_CESTOVANI &&
      PASS_PUBLICATION_META &&
      PASS_ZERO_ERR &&
      PASS_LAYOUT;

    if (!allPass) {
      process.stderr.write("feed-publication-dedupe-guard: FAIL\n");
      process.exitCode = 1;
    }
  } finally {
    try {
      server.kill("SIGTERM");
    } catch (_) {}
    await browser.close();
  }
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
