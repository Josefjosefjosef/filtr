#!/usr/bin/env node
/**
 * Browser proof: invoice + financial calculators usable offline after warm visit.
 * Run: node scripts/iu-pwa-offline-tools-proof-v1.mjs
 */
import { createRequire } from "module";
import { spawn } from "child_process";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SCRIPT = path.join(REPO, "server", "projects-static.mjs");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8933", 10);
const ORIGIN = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "")
  : `http://127.0.0.1:${PORT}`;
const USE_LOCAL = !process.env.IU_GUARD_BASE_URL;

async function main() {
  let serverProc = null;
  if (USE_LOCAL) {
    serverProc = spawn(process.execPath, [SERVER_SCRIPT], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const tick = () => {
        const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
          else if (Date.now() >= deadline) reject(new Error("server not ready"));
          else setTimeout(tick, 300);
        });
        req.on("error", () => {
          if (Date.now() >= deadline) reject(new Error("server not ready"));
          else setTimeout(tick, 300);
        });
      };
      tick();
    });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const passes = [];
  const failures = [];

  try {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
        localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      } catch (_) {}
    });
    await page.goto(ORIGIN + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, {
      timeout: 90000,
    });
    passes.push("sw_controlling");

    // Warm tool modules into SW cache while online.
    const warm = await page.evaluate(async () => {
      const urls = [
        "/assets/iu-invoice-module.js",
        "/assets/iu-invoice-engine.js",
        "/assets/iu-brand-colors.js",
        "/assets/iu-local-data-protection.js",
        "/assets/iu-financial-calculators-module.js",
        "/assets/iu-financial-calculators-engine.js",
      ];
      const out = [];
      for (const u of urls) {
        try {
          const r = await fetch(u, { cache: "no-store" });
          out.push({ u, status: r.status, ok: r.ok });
        } catch (e) {
          out.push({ u, ok: false, err: String(e && e.message || e) });
        }
      }
      return out;
    });
    if (warm.every((x) => x.ok)) passes.push("tools_warmed_online");
    else failures.push({ test: "tools_warmed_online", detail: warm });

    await context.setOffline(true);

    const offlineMods = await page.evaluate(async () => {
      const urls = [
        "/assets/iu-invoice-module.js",
        "/assets/iu-invoice-engine.js",
        "/assets/iu-brand-colors.js",
        "/assets/iu-local-data-protection.js",
        "/assets/iu-financial-calculators-module.js",
        "/assets/iu-financial-calculators-engine.js",
      ];
      const out = [];
      for (const u of urls) {
        try {
          const r = await fetch(u);
          const t = await r.text();
          out.push({ u, status: r.status, ok: r.ok, len: t.length });
        } catch (e) {
          out.push({ u, ok: false, err: String(e && e.message || e) });
        }
      }
      return out;
    });
    if (offlineMods.every((x) => x.ok && x.len > 100)) passes.push("tools_modules_offline");
    else failures.push({ test: "tools_modules_offline", detail: offlineMods });

    const calc = await page.evaluate(async () => {
      try {
        const mod = await import("/assets/iu-financial-calculators-engine.js");
        const loan = mod.computeLoan({ principal: "100000", rate: "5", months: "12", fee: "0" });
        const vat = mod.computeVat({ amount: "1210", rate: "21", mode: "gross" });
        const mortgage = mod.computeMortgage({ principal: "3000000", rate: "4.5", months: "360", fee: "0" });
        return {
          ok: !!(loan && vat && mortgage),
          loanPayment: loan && (loan.monthlyPayment ?? loan.payment),
          vatKeys: vat ? Object.keys(vat).slice(0, 8) : [],
        };
      } catch (e) {
        return { ok: false, reason: String(e && e.message || e) };
      }
    });
    if (calc.ok) passes.push("calculators_offline_engine");
    else failures.push({ test: "calculators_offline_engine", detail: calc });

    const invoice = await page.evaluate(async () => {
      try {
        const mod = await import("/assets/iu-invoice-engine.js");
        const state = mod.defaultFormState();
        state.lines = [mod.emptyLine(true)];
        state.lines[0].qty = "2";
        state.lines[0].unitPrice = "100";
        state.lines[0].vatPct = "21";
        const totals = mod.computeTotals(state);
        const preview = typeof mod.buildInvoiceHtmlPreview === "function" ? mod.buildInvoiceHtmlPreview(state, totals) : "";
        return {
          ok: !!(totals && typeof totals.total === "number" || totals && totals.grandTotal != null || totals),
          totalsKeys: totals ? Object.keys(totals).slice(0, 12) : [],
          previewLen: String(preview || "").length,
        };
      } catch (e) {
        return { ok: false, reason: String(e && e.message || e) };
      }
    });
    if (invoice.ok) passes.push("invoice_offline_engine");
    else failures.push({ test: "invoice_offline_engine", detail: invoice });

    await context.setOffline(false);
    const back = await page.evaluate(async () => {
      try {
        const r = await fetch("/projects/version.json", { cache: "no-store" });
        return { ok: r.ok, status: r.status };
      } catch (e) {
        return { ok: false, err: String(e && e.message || e) };
      }
    });
    if (back.ok) passes.push("online_recovery");
    else failures.push({ test: "online_recovery", detail: back });
  } finally {
    await browser.close();
    if (serverProc && !serverProc.killed) serverProc.kill("SIGTERM");
  }

  const pass = failures.length === 0;
  console.log(JSON.stringify({ pass, origin: ORIGIN, passes, failures }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
