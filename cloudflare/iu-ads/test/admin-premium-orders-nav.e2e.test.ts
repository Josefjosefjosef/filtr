import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { buildAdminShellHtml } from "../src/admin-ui";

const require = createRequire(path.join(import.meta.dirname, "../../../package.json"));
const { chromium } = require("playwright") as typeof import("playwright");

const PORT = parseInt(process.env.IU_ADMIN_E2E_PORT || "8974", 10);
const BASE = `http://127.0.0.1:${PORT}`;

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

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("admin premium orders nav e2e (regression #11846 loading)", () => {
  let server: http.Server;
  let browser: import("playwright").Browser;
  const runtimeErrors: string[] = [];
  const rejectOrdersList = { on: false };

  beforeAll(async () => {
    const html = buildAdminShellHtml("nonce-admin-e2e");
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", BASE);
      if (url.pathname === "/admin" || url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (url.pathname === "/health") {
        json(res, 200, { adminApiEnabled: true, safeMode: false, publicDeliveryEnabled: false, schemaVersion: 1 });
        return;
      }
      if (url.pathname === "/v1/admin/auth/me") {
        json(res, 200, {
          user: {
            user_id: "u_e2e",
            email: "admin-e2e@example.invalid",
            display_name: "E2E Admin",
            roles: ["main_admin"],
            is_active: true,
          },
        });
        return;
      }
      if (url.pathname === "/v1/admin/nav") {
        json(res, 200, {
          nav: [
            { id: "dashboard", label_cs: "Dashboard" },
            { id: "premium", label_cs: "Objednávky — Vybrané služby a odkazy", badge_count: 1 },
          ],
          roles: ["main_admin"],
        });
        return;
      }
      if (url.pathname === "/v1/admin/dashboard") {
        json(res, 200, { widgets: { open_orders: 0 } });
        return;
      }
      if (url.pathname === "/v1/admin/premium/orders/summary") {
        json(res, 200, {
          pending_review: 1,
          active_published: 2,
          paused: 0,
          ending_within_30_days: 0,
          unpaid: 0,
        });
        return;
      }
      if (url.pathname === "/v1/admin/premium/orders") {
        if (rejectOrdersList.on) {
          json(res, 500, { error: "internal", message_cs: "Simulovaná chyba seznamu." });
          return;
        }
        json(res, 200, {
          premium_orders: [
            {
              order_id: "ord_e2e_1",
              company_name: "E2E Firma s.r.o.",
              ico: "12345678",
              category_slug: "cestovni-kancelare",
              category_title_cs: "Cestovní kanceláře",
              position: 1,
              position_label: "P1",
              duration_label_cs: "6 měsíců",
              price_label_cs: "10 000 Kč",
              workflow_status: "submitted",
              workflow_status_label_cs: "Čeká na schválení",
              submitted_at: "2026-01-01T10:00:00.000Z",
              submitted_at_label_cs: "1. 1. 2026 11:00",
              payment_status: "unpaid",
              publishable: true,
            },
          ],
        });
        return;
      }
      if (url.pathname === "/v1/admin/premium/orders/ord_e2e_1") {
        json(res, 200, {
          order: {
            order_id: "ord_e2e_1",
            company_name: "E2E Firma s.r.o.",
            client_id: "cli_e2e",
            placement_id: "aff-cestovni-kancelare-p1",
            workflow_status: "submitted",
            workflow_status_label_cs: "Čeká na schválení",
            payment_status: "unpaid",
            publishable: true,
            category_title_cs: "Cestovní kanceláře",
            category_slug: "cestovni-kancelare",
            position: 1,
            position_label: "P1",
            duration_months: 6,
            ico: "12345678",
          },
          order_documents: [],
          order_documents_pdf_count: 0,
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
  });

  function trackPage(page: import("playwright").Page) {
    runtimeErrors.length = 0;
    page.on("pageerror", (e) => runtimeErrors.push(String(e.message || e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") runtimeErrors.push(msg.text());
    });
  }

  async function openLoggedInAdmin(page: import("playwright").Page) {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#app-view.show", { timeout: 15000 });
    await page.waitForSelector('#nav button[data-id="premium"]', { timeout: 15000 });
  }

  async function waitOrdersLoaded(page: import("playwright").Page) {
    await page.waitForFunction(
      () => {
        const panel = document.getElementById("panel");
        if (!panel) return false;
        const t = panel.textContent || "";
        if (t.includes("Načítám…")) return false;
        return t.includes("Objednávky — Vybrané služby") || t.includes("Simulovaná chyba");
      },
      { timeout: 15000 }
    );
  }

  async function panelText(page: import("playwright").Page): Promise<string> {
    return (await page.locator("#panel").textContent()) || "";
  }

  async function clickPremiumNav(page: import("playwright").Page) {
    const toggle = page.locator("#btn-nav-toggle");
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForSelector("#nav.open", { timeout: 5000 });
    }
    await page.evaluate(() => {
      const btn = document.querySelector('#nav button[data-id="premium"]') as HTMLButtonElement | null;
      if (btn) btn.click();
    });
  }

  it("desktop — navigace na Objednávky dokončí render (bez Načítám…)", async () => {
    rejectOrdersList.on = false;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    trackPage(page);
    await openLoggedInAdmin(page);
    await clickPremiumNav(page);
    await waitOrdersLoaded(page);
    const txt = await panelText(page);
    expect(txt.includes("E2E Firma s.r.o.")).toBe(true);
    expect(txt.includes("Načítám…")).toBe(false);
    expect(runtimeErrors).toEqual([]);
    await context.close();
  });

  it("mobile — prázdný seznam bez Načítám…", async () => {
    rejectOrdersList.on = false;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage();
    trackPage(page);
    await openLoggedInAdmin(page);
    await page.route("**/v1/admin/premium/orders", (route) => {
      if (route.request().method() === "GET" && !route.request().url().includes("/summary")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ premium_orders: [] }),
        });
        return;
      }
      route.continue();
    });
    await clickPremiumNav(page);
    await waitOrdersLoaded(page);
    const emptyTxt = await panelText(page);
    expect(emptyTxt.includes("Žádné objednávky k zobrazení")).toBe(true);
    expect(emptyTxt.includes("Načítám…")).toBe(false);
    expect(runtimeErrors).toEqual([]);
    await context.close();
  });

  it("chyba API — zobrazí chybu (ne nekonečné Načítám…)", async () => {
    rejectOrdersList.on = true;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    trackPage(page);
    await openLoggedInAdmin(page);
    await clickPremiumNav(page);
    await waitOrdersLoaded(page);
    let errTxt = await panelText(page);
    expect(errTxt.includes("Simulovaná chyba seznamu")).toBe(true);
    expect(errTxt.includes("Načítám…")).toBe(false);
    rejectOrdersList.on = false;
    runtimeErrors.length = 0;
    await clickPremiumNav(page);
    await waitOrdersLoaded(page);
    expect((await panelText(page)).includes("E2E Firma s.r.o.")).toBe(true);
    expect(runtimeErrors).toEqual([]);
    await context.close();
  });

  it("detail objednávky a návrat na seznam", async () => {
    rejectOrdersList.on = false;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    trackPage(page);
    await openLoggedInAdmin(page);
    await clickPremiumNav(page);
    await waitOrdersLoaded(page);
    await page.click('[data-premium-detail="ord_e2e_1"]');
    await page.waitForFunction(
      () => {
        const panel = document.getElementById("panel");
        return panel && (panel.textContent || "").includes("Dokumenty objednávky");
      },
      { timeout: 15000 }
    );
    await page.click("#order-detail-back");
    await waitOrdersLoaded(page);
    expect((await panelText(page)).includes("E2E Firma s.r.o.")).toBe(true);
    expect(runtimeErrors).toEqual([]);
    await context.close();
  });
});
