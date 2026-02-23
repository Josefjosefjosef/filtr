import { chromium } from "playwright";
import fs from "node:fs";

const OUT_DIR = "tools/_artifacts";
const URL = "https://infouzel.cz/projects/?panel=ai&section=jr";
const LEFT_CLICK_TEXT = /Mapy|Navigace/i;

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
  let finalUrl = "NO_URL (crash before navigation)";
  let verdict = "FAIL";

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));

    page.setDefaultNavigationTimeout(90000);
    page.setDefaultTimeout(90000);

    const hardUrl = new URL(URL);
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

    await page.waitForTimeout(350);
    await safeScreenshot(page, "prod_after_click.png");

    finalUrl = page.url();

    const urlOk = !finalUrl.includes("panel=");
    const consoleOk = errors.length === 0;

    verdict = urlOk && consoleOk ? "OK" : "FAIL";
  } catch (e) {
    errors.push(`SCRIPT_CRASH: ${String(e?.message || e)}`);
    verdict = "FAIL";
  } finally {
    try {
      if (page) finalUrl = page.url() || finalUrl;
    } catch {}
    try {
      if (browser) await browser.close();
    } catch {}
    write("prod_console_errors.txt", errors.join("\n") || "NO_CONSOLE_ERRORS");
    write("prod_final_url.txt", finalUrl);
    write(
      "verdict.txt",
      `FIRST CLICK OVERLAY: ${verdict}${verdict === "FAIL" ? ` — ${URL} — ${(errors[0] || "unknown error").replace(/\n/g, " ")}` : ""}`
    );
    console.log(fs.readFileSync(`${OUT_DIR}/verdict.txt`, "utf8"));
  }

  process.exit(verdict === "OK" ? 0 : 1);
};

main();
