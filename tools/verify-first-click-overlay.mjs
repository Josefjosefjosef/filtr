import { chromium } from "playwright";
import fs from "node:fs";

const OUT_DIR = "tools/_artifacts";
const BASE_URL = "https://infouzel.cz/projects/?panel=ai&section=jr";
const LEFT_CLICK_TEXT = /Mapy|Navigace/i;

const NOISE_ERRORS = [
  /\/projects\/data\/videos\.json/i,
  /preflightDataEndpoints/i,
  /TypeError:\s*Failed to fetch/i,
  /loadAiAssistants|AI assistants load failed/i,
];
const isNoise = (s) => NOISE_ERRORS.some((re) => re.test(String(s)));

const OVERLAY_SELECTORS = [
  ".iuOverlay",
  ".iuModalOverlay",
  ".iuModal",
  "#iu-aiPanel",
  "#iu-aiOverlay",
  "[data-iu-overlay]",
  "[data-iu-backdrop]",
  "[data-iu-modal]",
  "#iuOverlay",
  "#overlay",
  ".overlay",
];

const write = (name, content) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/${name}`, content ?? "");
};

const safeScreenshot = async (page, name) => {
  try {
    await page.screenshot({ path: `${OUT_DIR}/${name}`, fullPage: false });
    return true;
  } catch (e) {
    const msg = `SCREENSHOT_FAIL ${name}: ${String(e)}`;
    const p = `${OUT_DIR}/prod_screenshot_error.txt`;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    try {
      const existing = fs.existsSync(p) ? fs.readFileSync(p, "utf8") + "\n" : "";
      fs.writeFileSync(p, existing + msg);
    } catch {
      fs.writeFileSync(p, msg);
    }
    return false;
  }
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let browser = null;
  let page = null;

  const errors = [];
  const noise = [];
  let finalUrl = "NO_URL (crash before navigation)";
  let overlaySeen = false;
  let verdictCode = "FAIL";

  const isOverlayVisibleNow = async () => {
    for (const sel of OVERLAY_SELECTORS) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0) {
          const box = await loc.boundingBox().catch(() => null);
          const visible = await loc.isVisible().catch(() => false);
          if (visible && box && box.width > 10 && box.height > 10) return true;
        }
      } catch {}
    }
    return false;
  };

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const t = msg.text();
        if (!isNoise(t)) errors.push(t);
        else noise.push(t);
      }
    });
    page.on("pageerror", (err) => {
      const t = String(err);
      if (!isNoise(t)) errors.push(t);
      else noise.push(t);
    });

    page.setDefaultNavigationTimeout(90000);
    page.setDefaultTimeout(90000);

    const hardUrl = new URL(BASE_URL);
    hardUrl.searchParams.set("__v", String(Date.now()));
    await page.goto(hardUrl.toString(), { waitUntil: "domcontentloaded" });

    await safeScreenshot(page, "prod_before_click.png");

    hardUrl.searchParams.set("__v", String(Date.now() + 1));
    await page.goto(hardUrl.toString(), { waitUntil: "domcontentloaded" });

    const byText = page.getByRole("link", { name: LEFT_CLICK_TEXT }).first();
    const fallbackLink = page.locator("nav a, .iu-leftNav a, #iuLeftRail a, [data-left-rail] a, .iuLeftRail a, .leftRail a").first();

    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null),
      (async () => {
        if ((await byText.count()) > 0) await byText.click({ timeout: 30000 });
        else await fallbackLink.click({ timeout: 30000 });
      })(),
    ]);

    await page.waitForTimeout(100);

    for (let i = 0; i < 10; i++) {
      if (await isOverlayVisibleNow()) {
        overlaySeen = true;
        break;
      }
      await page.waitForTimeout(40);
    }

    await page.waitForTimeout(250);
    await safeScreenshot(page, "prod_after_click.png");

    finalUrl = page.url();

    const routingOk = !finalUrl.includes("panel=");
    const overlayOk = !overlaySeen;
    const jsOk = errors.length === 0;

    if (!routingOk) verdictCode = "FAIL_ROUTING";
    else if (!overlayOk) verdictCode = "FAIL_OVERLAY";
    else if (!jsOk) verdictCode = "FAIL_JS";
    else verdictCode = "OK";
  } catch (e) {
    errors.push(`SCRIPT_CRASH: ${String(e?.message || e)}`);
    verdictCode = "FAIL_JS";
  } finally {
    try {
      if (page) finalUrl = page.url() || finalUrl;
    } catch {}
    try {
      if (browser) await browser.close();
    } catch {}
    write("prod_console_errors.txt", errors.join("\n") || "NO_CONSOLE_ERRORS");
    write("prod_console_noise.txt", noise.join("\n") || "NO_NOISE");
    write("prod_final_url.txt", finalUrl);
    write("prod_overlay_seen.txt", overlaySeen ? "OVERLAY_SEEN" : "NO_OVERLAY_SEEN");
    write(
      "verdict.txt",
      verdictCode === "OK"
        ? "FIRST CLICK OVERLAY: OK"
        : `FIRST CLICK OVERLAY: FAIL — ${BASE_URL} — ${verdictCode} — ${(errors[0] || "unknown").replace(/\n/g, " ")}`
    );
    console.log(fs.readFileSync(`${OUT_DIR}/verdict.txt`, "utf8"));
  }

  process.exit(verdictCode === "OK" ? 0 : 1);
};

main();
