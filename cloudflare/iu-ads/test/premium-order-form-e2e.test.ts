import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { buildPremiumOrderShellHtml } from "../src/premium-order-ui";
const require = createRequire(path.join(import.meta.dirname, "../../../package.json"));
const { chromium } = require("playwright") as typeof import("playwright");

const PORT = parseInt(process.env.IU_E2E_PORT || "8973", 10);
const TEST_ICO = "27074358";
const PLACEMENT = "aff-cestovni-kancelare-p1";

function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const s = net.createConnection({ host, port }, () => {
        s.end();
        resolve();
      });
      s.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("port_timeout"));
        else setTimeout(tick, 80);
      });
    };
    tick();
  });
}

describe("premium order form browser e2e", () => {
  let server: http.Server;
  let browser: import("playwright").Browser;
  const runtimeErrors: string[] = [];
  let orderPostCount = 0;
  let lastSubmitBody: Record<string, unknown> | null = null;
  let lastUploadBody: Record<string, unknown> | null = null;
  const pngPath = path.join(os.tmpdir(), "iu-premium-order-e2e.png");

  beforeAll(async () => {
    const pngBuf = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
      "base64"
    );
    fs.writeFileSync(pngPath, pngBuf);

    const html = buildPremiumOrderShellHtml("nonce-e2e", '<p id="meta">E2E</p>', 1);

    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname === "/" || url.pathname === "/premium/order") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (url.pathname === "/v1/public/ares/ico") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            company_name: "Test Firma s.r.o.",
            billing_street: "Ulice 1",
            billing_city: "Praha",
            billing_zip: "11000",
            billing_country: "Česká republika",
            dic: "CZ27074358",
            customer_registry: {
              registry_kind: "commercial_register",
              display_line_cs:
                "Společnost zapsaná v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 123456.",
            },
          })
        );
        return;
      }
      if (url.pathname === "/v1/public/premium/orders" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => {
          body += c;
        });
        req.on("end", () => {
          orderPostCount += 1;
          lastSubmitBody = JSON.parse(body) as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ order_id: "ord-e2e-1", order_access_token: "tok-e2e-1" }));
        });
        return;
      }
      if (url.pathname.startsWith("/v1/public/premium/orders/") && url.pathname.endsWith("/upload")) {
        let body = "";
        req.on("data", (c) => {
          body += c;
        });
        req.on("end", () => {
          lastUploadBody = JSON.parse(body) as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });

    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
    await waitForPort("127.0.0.1", PORT, 15000);
    browser = await chromium.launch({ headless: true });
  }, 120000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
    try {
      fs.unlinkSync(pngPath);
    } catch {
      /* ignore */
    }
  });

  function trackPage(page: import("playwright").Page) {
    runtimeErrors.length = 0;
    page.on("pageerror", (e) => runtimeErrors.push(String(e.message || e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") runtimeErrors.push(msg.text());
    });
  }

  async function openForm(page: import("playwright").Page) {
    await page.goto(`http://127.0.0.1:${PORT}/?placement=${encodeURIComponent(PLACEMENT)}`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.waitForSelector("#form", { timeout: 10000 });
    await page.waitForFunction(() => typeof (window as unknown as { iuPremiumCreativeRender?: unknown }).iuPremiumCreativeRender === "object");
  }

  it("flow A — cancel navigates without order side effect", async () => {
    orderPostCount = 0;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage();
    trackPage(page);
    await openForm(page);
    await page.evaluate(() => {
      sessionStorage.setItem("iuPremiumOrderReturn", JSON.stringify({ href: "https://infouzel.cz/", scrollY: 0 }));
    });
    await Promise.all([page.waitForURL("https://infouzel.cz/", { timeout: 10000 }), page.click("#cancel_btn")]);
    expect(orderPostCount).toBe(0);
    expect(runtimeErrors).toEqual([]);
    await context.close();
  });

  it("flow B — full order: IČO, auth, file, modes, confirm, submit", async () => {
    orderPostCount = 0;
    lastSubmitBody = null;
    lastUploadBody = null;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage();
    trackPage(page);
    await openForm(page);

    await page.fill("#ico", TEST_ICO);
    await page.waitForFunction(
      () => (document.getElementById("company_name") as HTMLInputElement).value.includes("Test Firma"),
      { timeout: 8000 }
    );
    await page.waitForFunction(
      () => {
        const el = document.getElementById("registry_lookup");
        return el && !el.hidden && el.textContent && el.textContent.includes("obchodním rejstříku");
      },
      { timeout: 8000 }
    );

    expect(await page.locator("#ordering_person_wrap").isHidden()).toBe(true);
    await page.check("#authorization_confirmed");
    expect(await page.locator("#ordering_person_wrap").isVisible()).toBe(true);
    await page.fill("#ordering_person_name", "Jan Novák");

    await page.fill("#contact_name", "Kontakt Test");
    await page.fill("#email", "test@example.com");
    await page.fill("#phone", "+420123456789");
    await page.fill("#target_url", "https://example.com/");

    await page.setInputFiles("#file", pngPath);
    await page.waitForFunction(
      () => {
        const img = document.querySelector("#previewSlot img.iuPremiumSlotImg") as HTMLImageElement | null;
        return img && img.naturalWidth > 0;
      },
      { timeout: 10000 }
    );

    const modes = ["logo", "image_small", "image_medium", "image_large", "full_bleed_banner"] as const;
    for (const m of modes) {
      await page.locator(`input[name="creative_mode_choice"][value="${m}"]`).check();
      await page.waitForFunction(
        (mode) => document.getElementById("creative_mode")?.getAttribute("value") === mode || (document.getElementById("creative_mode") as HTMLInputElement).value === mode,
        m,
        { timeout: 5000 }
      );
    }
    await page.locator('input[name="creative_mode_choice"][value="image_large"]').check();

    await page.click("#creative_confirm_btn");
    expect(await page.locator("#creative_confirm_status").isVisible()).toBe(true);

    await page.locator('input[name="creative_mode_choice"][value="image_medium"]').check();
    expect(await page.locator("#creative_confirm_btn").isVisible()).toBe(true);

    await page.locator('input[name="creative_mode_choice"][value="image_large"]').check();
    await page.click("#creative_confirm_btn");
    expect(await page.locator("#creative_confirm_status").isVisible()).toBe(true);

    await page.click("#submit_btn");
    await page.waitForSelector("#done:not([hidden])", { timeout: 20000 });

    expect(orderPostCount).toBe(1);
    expect(lastSubmitBody?.ordering_person_name).toBe("Jan Novák");
    expect(lastSubmitBody?.creative_mode).toBe("image_large");
    expect(lastSubmitBody?.authorization_confirmed).toBe(true);
    expect(lastUploadBody?.filename).toContain(".png");
    expect(runtimeErrors).toEqual([]);
    await context.close();
  });

  it("viewport — IČO first and ARES fill on tablet and desktop", async () => {
    const viewports = [
      { name: "tablet", width: 834, height: 1112 },
      { name: "desktop", width: 1280, height: 900 },
    ] as const;
    for (const vp of viewports) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      trackPage(page);
      await openForm(page);
      const icoIdx = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("#form label"));
        return nodes.findIndex((n) => n.getAttribute("for") === "ico");
      });
      const companyIdx = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("#form label"));
        return nodes.findIndex((n) => n.getAttribute("for") === "company_name");
      });
      expect(icoIdx).toBeGreaterThanOrEqual(0);
      expect(companyIdx).toBeGreaterThan(icoIdx);
      await page.fill("#ico", TEST_ICO);
      await page.waitForFunction(
        () => (document.getElementById("company_name") as HTMLInputElement).value.includes("Test Firma"),
        { timeout: 8000 }
      );
      expect(runtimeErrors).toEqual([]);
      await context.close();
    }
  });

  it("negative — blocks unconfirmed creative and missing auth", async () => {
    orderPostCount = 0;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    trackPage(page);
    await openForm(page);

    await page.fill("#ico", TEST_ICO);
    await page.fill("#contact_name", "Kontakt");
    await page.fill("#email", "a@b.cz");
    await page.fill("#phone", "123456789");
    await page.fill("#target_url", "https://example.com/");
    await page.setInputFiles("#file", pngPath);
    await page.waitForSelector("#previewSlot img.iuPremiumSlotImg", { timeout: 10000 });

    await page.click("#submit_btn");
    expect(await page.locator("#creative_confirm_err").isVisible()).toBe(true);
    expect(orderPostCount).toBe(0);

    await page.click("#creative_confirm_btn");
    await page.click("#submit_btn");
    expect(await page.locator("#err").isVisible()).toBe(true);
    expect(orderPostCount).toBe(0);

    expect(runtimeErrors).toEqual([]);
    await context.close();
  });

  it("differential flags — main inline corruption vs string bundle", () => {
    const inlineTs = fs.readFileSync(
      path.join(import.meta.dirname, "../src/premium-creative-render-inline.ts"),
      "utf8"
    );
    const brokenOnMainPattern = /^export const INLINE_PREMIUM_CREATIVE_RENDER_JS = \{\s*"value"/m.test(inlineTs);
    expect(brokenOnMainPattern).toBe(false);
    expect(inlineTs).toContain('export const INLINE_PREMIUM_CREATIVE_RENDER_JS: string = "');
  });
});
