#!/usr/bin/env node
/**
 * Console classification guard for intentional offline scenarios.
 * Fails only on unexpected console errors / page errors.
 * Expected offline network failures are counted separately and do not fail.
 *
 * Run: node scripts/iu-console-classify-offline-guard.mjs
 * Optional: IU_CONSOLE_GUARD_URL=https://infouzel.cz/projects/?iuRobust=1
 */
import http from "http";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { classify } from "./iu-console-classify-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8951", 10);
const LIVE = process.env.IU_CONSOLE_GUARD_URL || "";
const LOCAL = `http://127.0.0.1:${PORT}/projects/?iuRobust=1`;

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function runAgainst(url, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const events = [];
  let phase = "load";

  const push = (kind, payload) => {
    const loc = payload.location || {};
    const ev = {
      phase,
      kind,
      type: payload.type || kind,
      text: payload.text || "",
      source: loc.url || payload.source || null,
      line: loc.lineNumber != null ? loc.lineNumber : null,
      column: loc.columnNumber != null ? loc.columnNumber : null,
    };
    ev.classification = classify(ev);
    events.push(ev);
  };

  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    push(type === "warning" ? "warning" : "console.error", {
      type,
      text: msg.text(),
      location: msg.location() || {},
    });
  });
  page.on("pageerror", (err) => {
    push("pageerror", { type: "pageerror", text: String(err && err.message ? err.message : err) });
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure();
    push("requestfailed", {
      type: "requestfailed",
      text: `${req.method()} ${req.url()} :: ${failure && failure.errorText ? failure.errorText : "failed"}`,
      source: req.url(),
    });
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  phase = "reload";
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(800);
  phase = "offline";
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);
  } catch (_) {
    /* offline reload may fail hard — still classify console events */
  }
  phase = "online_recovery";
  await context.setOffline(false);
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(800);
  } catch (_) {
    /* recovery navigation can abort after offline — classify captured events */
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(800);
    } catch (_) {
      /* still classify whatever console events were captured */
    }
  }
  await browser.close();

  const unexpected = events.filter((e) => e.classification === "unexpectedConsoleError");
  const expectedOffline = events.filter((e) => e.classification === "expectedOfflineNetworkFailure");
  const browserOnlyRo = events.filter((e) => e.classification === "browserOnlyResizeObserverLoop");
  const warnings = events.filter((e) => e.classification === "warning");
  const rawConsoleErrors = events.filter((e) => e.kind === "console.error").length;

  return {
    label,
    url,
    pass: unexpected.length === 0,
    totals: {
      allEvents: events.length,
      rawConsoleErrorCount: rawConsoleErrors,
      unexpectedConsoleErrors: unexpected.length,
      expectedOfflineNetworkFailures: expectedOffline.length,
      browserOnlyResizeObserverLoop: browserOnlyRo.length,
      warnings: warnings.length,
    },
    unexpected: unexpected.slice(0, 12),
    expectedOfflineSample: expectedOffline.slice(0, 6),
  };
}

let server = null;
try {
  // Self-check: narrow RO classification must not swallow real app errors.
  const selfChecks = [
    [
      "ro_loop_exact",
      classify({
        kind: "pageerror",
        text: "ResizeObserver loop completed with undelivered notifications.",
        phase: "load",
      }) === "browserOnlyResizeObserverLoop",
    ],
    [
      "real_typeerror_still_unexpected",
      classify({ kind: "pageerror", text: "TypeError: x is not a function", phase: "load" }) ===
        "unexpectedConsoleError",
    ],
    [
      "invalid_state_still_unexpected",
      classify({
        kind: "pageerror",
        text: "An attempt was made to use an object that is not, or is no longer, usable",
        phase: "load",
      }) === "unexpectedConsoleError",
    ],
  ];
  const selfFail = selfChecks.filter((row) => !row[1]).map((row) => row[0]);
  if (selfFail.length) {
    console.error(JSON.stringify({ pass: false, selfCheckFails: selfFail }, null, 2));
    process.exit(1);
  }

  const targets = [];
  if (LIVE) targets.push({ url: LIVE, label: "live" });
  server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForPort("127.0.0.1", PORT, 30000);
  targets.push({ url: LOCAL, label: "local" });

  const results = [];
  for (const t of targets) results.push(await runAgainst(t.url, t.label));
  const fail = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ pass: fail.length === 0, results }, null, 2));
  if (fail.length) process.exit(1);
  process.exit(0);
} catch (e) {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
} finally {
  if (server) {
    try {
      server.kill("SIGTERM");
    } catch (_) {}
  }
}
