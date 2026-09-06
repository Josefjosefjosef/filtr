#!/usr/bin/env node
/**
 * Guard: AI asistenti — neutral catalog (no duplicate title, no ranking/descriptive blurbs).
 * Run: npm run iu-ai-assistants-neutral-presentation-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const H1 =
  "AI asistenti – přehled některých nástrojů pro psaní, práci a programování";
const SCOPE =
  "Orientační přehled některých známých AI nástrojů. Nabídka není úplným výčtem dostupných služeb.";
const FORBIDDEN_TITLE = "AI asistenti – přehled nástrojů ChatGPT, Gemini, Copilot a další";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function auditStatic() {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  const jsonRaw = fs.readFileSync(path.join(ROOT, "projects", "data", "services-ai.json"), "utf8");
  const data = JSON.parse(jsonRaw);

  const aiPanelSlice = (index.match(/id="iu-aiPanel"[\s\S]*?<\/div>\s*<\/div>\s*<template id="iuLazyOverlayTpl-datovka"/) || [""])[0];

  ok("index:no_iuAiTitle", !/class=["']iuAiTitle["']/.test(index));
  ok("index:no_forbidden_title", !index.includes(FORBIDDEN_TITLE));
  ok("index:exact_h1", index.includes(H1));
  ok("index:scope_note", index.includes(SCOPE) && index.includes("iuAiScopeNote"));
  ok("index:single_seo_title", (index.match(/class=["']iuSeoTitle["']/g) || []).length === 1);
  ok(
    "index:no_ranking_copy_in_ai_panel",
    !/nejlepších AI|TOP AI|naše volba|rychlého srovnání a přehledu nejlepších/i.test(aiPanelSlice)
  );
  ok("index:header_share_close", /id=["']iuAiShareBtn["']/.test(index));

  ok("app:render_name_only", /iu-aiItem--nameOnly/.test(app));
  ok("app:no_forbidden_title", !app.includes(FORBIDDEN_TITLE));
  ok(
    "app:no_subjective_ai_desc",
    !/Velmi přirozen|nejlepší pro programování|Silná AI na programování|Univerzální AI na psaní/.test(app)
  );
  ok("app:chatgpt_url", /name:\s*"ChatGPT"[\s\S]{0,160}https:\/\/chat\.openai\.com/.test(app));
  ok("app:gemini_url", /name:\s*"Google Gemini"[\s\S]{0,160}https:\/\/gemini\.google\.com/.test(app));
  ok("app:copilot_url", /name:\s*"Microsoft Copilot"[\s\S]{0,180}https:\/\/copilot\.microsoft\.com/.test(app));
  ok("app:claude_url", /name:\s*"Claude"[\s\S]{0,160}https:\/\/claude\.ai/.test(app));

  ok("json:array", Array.isArray(data) && data.length >= 1);
  ok(
    "json:no_desc_fields",
    data.every((it) => it && typeof it.name === "string" && typeof it.url === "string" && !("desc" in it))
  );
  ok("json:no_subjective_text", !/Velmi přirozen|nejlepší|Silná AI|Univerzální AI na psaní/i.test(jsonRaw));
  ok(
    "json:urls_https",
    data.every((it) => /^https:\/\//i.test(String(it.url || "")))
  );
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function auditRuntime(PORT) {
  const BASE = `http://127.0.0.1:${PORT}/projects/`;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of [
      { name: "mobile", width: 390, height: 844 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "desktop", width: 1280, height: 900 },
    ]) {
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.name !== "desktop",
      });
      const page = await bootstrapGuardPage(context);
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.evaluate(() => {
        const b = document.getElementById("iuConsentAllowStats");
        if (b) b.click();
        const layer = document.getElementById("iuConsentLayer");
        if (layer) layer.remove();
      });

      await page.evaluate(() => {
        const btn =
          document.querySelector('[data-action="ai-panel"]') ||
          document.querySelector('[data-iuq="ai"]') ||
          Array.from(document.querySelectorAll("button, a, [role='button']")).find((el) =>
            /^AI asistenti$/i.test((el.textContent || "").trim())
          );
        if (btn) btn.click();
        const pan = document.getElementById("iu-aiPanel");
        const ov = document.getElementById("iu-aiOverlay");
        if (pan && typeof window.iuSetElOpenVisible === "function") {
          window.iuSetElOpenVisible(pan, true);
          if (ov) window.iuSetElOpenVisible(ov, true);
          document.body.classList.add("iu-modal-open");
          pan.setAttribute("data-open", "1");
          pan.removeAttribute("hidden");
        } else if (pan) {
          pan.hidden = false;
          pan.setAttribute("data-open", "1");
          document.body.classList.add("iu-modal-open");
        }
      });

      await page.waitForSelector("#iu-aiPanelCards .iu-aiItem a", { timeout: 30000 });

      const snap = await page.evaluate(
        ({ H1, SCOPE, FORBIDDEN_TITLE }) => {
          const panel = document.getElementById("iu-aiPanel");
          const titles = Array.from(panel.querySelectorAll(".iuSeoTitle")).map((el) =>
            (el.textContent || "").trim()
          );
          const scope = panel.querySelector(".iuAiScopeNote");
          const items = Array.from(panel.querySelectorAll("#iu-aiPanelCards .iu-aiItem"));
          const opens = items.map((it) => {
            const a = it.querySelector("a");
            const p = it.querySelector("p");
            return {
              name: (it.querySelector("strong")?.textContent || "").trim(),
              href: a ? a.getAttribute("href") : null,
              label: a ? (a.textContent || "").trim() : null,
              hasDesc: !!(p && (p.textContent || "").trim()),
            };
          });
          const host = panel.querySelector(".iu-aiModal") || panel;
          return {
            titles,
            scope: scope ? (scope.textContent || "").trim() : null,
            forbidden: (panel.textContent || "").includes(FORBIDDEN_TITLE),
            oldBox: !!panel.querySelector(".iuAiTitle"),
            opens,
            overflow: host.scrollWidth > host.clientWidth + 1,
          };
        },
        { H1, SCOPE, FORBIDDEN_TITLE }
      );

      ok(`${vp.name}:no_old_box`, !snap.oldBox && !snap.forbidden);
      ok(`${vp.name}:exact_h1`, snap.titles.length === 1 && snap.titles[0] === H1, JSON.stringify(snap.titles));
      ok(`${vp.name}:scope`, snap.scope === SCOPE);
      ok(`${vp.name}:cards`, snap.opens.length >= 1);
      ok(
        `${vp.name}:open_links`,
        snap.opens.every((o) => o.label === "Otevřít" && /^https:\/\//i.test(String(o.href || "")))
      );
      ok(`${vp.name}:no_card_desc`, snap.opens.every((o) => !o.hasDesc));
      ok(`${vp.name}:no_h_overflow`, !snap.overflow);

      await context.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

auditStatic();
if (fails.length) {
  console.log(
    JSON.stringify(
      { IU_AI_ASSISTANTS_NEUTRAL_PRESENTATION_GUARD: "FAIL", phase: "static", fails },
      null,
      2
    )
  );
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8941", 10);
const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const fp = path.join(ROOT, p.replace(/^\/+/, ""));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const mime =
      fp.endsWith(".css")
        ? "text/css; charset=utf-8"
        : fp.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : fp.endsWith(".html")
            ? "text/html; charset=utf-8"
            : fp.endsWith(".json")
              ? "application/json; charset=utf-8"
              : "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(fs.readFileSync(fp));
  } catch (_) {
    res.writeHead(500);
    res.end("err");
  }
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
await waitForPort("127.0.0.1", PORT, 10000);

try {
  await auditRuntime(PORT);
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      IU_AI_ASSISTANTS_NEUTRAL_PRESENTATION_GUARD: pass ? "PASS" : "FAIL",
      fails,
      REAL_IOS: "NOT_TESTED",
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
