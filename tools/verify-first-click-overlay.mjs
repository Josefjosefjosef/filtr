import { chromium } from "playwright";
import fs from "node:fs";

const OUT_DIR = "tools/_artifacts";
fs.mkdirSync(OUT_DIR, { recursive: true });

const URL = "https://infouzel.cz/projects/?panel=ai&section=jr";

const LEFT_CLICK_TEXT = /Mapy|Navigace/i;

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.screenshot({ path: `${OUT_DIR}/prod_before_click.png`, fullPage: false });

  const byText = page.getByRole("link", { name: LEFT_CLICK_TEXT }).first();
  if ((await byText.count()) > 0) {
    await byText.click();
  } else {
    const first = page.locator(".iu-leftNav a, #iuLeftRail a, nav a").first();
    await first.click();
  }

  await page.waitForTimeout(250);

  await page.screenshot({ path: `${OUT_DIR}/prod_after_click.png`, fullPage: false });

  fs.writeFileSync(`${OUT_DIR}/prod_console_errors.txt`, errors.join("\n") || "NO_CONSOLE_ERRORS");

  const finalUrl = page.url();
  fs.writeFileSync(`${OUT_DIR}/prod_final_url.txt`, finalUrl);

  await browser.close();

  const urlOk = !finalUrl.includes("panel=");
  const consoleOk = errors.length === 0;
  const verdict = urlOk && consoleOk ? "OK" : "FAIL";

  const verdictLine =
    verdict === "OK"
      ? "FIRST CLICK OVERLAY: OK"
      : `FIRST CLICK OVERLAY: FAIL — ${finalUrl} — urlOk=${urlOk} consoleErrors=${errors[0] || "none"}`;
  console.log(verdictLine);
  fs.writeFileSync(`${OUT_DIR}/verdict.txt`, verdictLine, "utf8");
  process.exit(verdict === "OK" ? 0 : 1);
};

run().catch((e) => {
  console.error("FIRST CLICK OVERLAY: FAIL — script crashed —", e);
  process.exit(1);
});
