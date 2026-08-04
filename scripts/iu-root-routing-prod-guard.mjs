#!/usr/bin/env node
/**
 * P0 production root routing guard (HTTP + browser runtime).
 * Canonical app URL is https://infouzel.cz/ — never /projects/ as the hub.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

let chromium;
try {
  chromium = require(path.join(ROOT, "node_modules", "playwright")).chromium;
} catch (_) {
  try {
    chromium = require("playwright").chromium;
  } catch (e) {
    chromium = null;
  }
}

const PROD = "https://infouzel.cz";
const fails = [];
const report = { steps: [], at: new Date().toISOString() };

function ok(id, cond, detail) {
  report.steps.push({ id, ok: !!cond, detail: detail || "" });
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

async function fetchNoFollow(url) {
  const res = await fetch(url, { redirect: "manual", headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  return {
    status: res.status,
    location: res.headers.get("location") || "",
    cache: res.headers.get("cf-cache-status") || "",
    type: res.headers.get("content-type") || "",
  };
}

async function main() {
  const root = await fetchNoFollow(PROD + "/");
  ok("root_200", root.status === 200, String(root.status));
  ok("root_no_location_projects", !/\/projects\//i.test(root.location), root.location);

  const www = await fetchNoFollow("https://www.infouzel.cz/");
  ok("www_3xx", www.status >= 301 && www.status < 400, String(www.status));
  ok("www_to_apex", /^https:\/\/infouzel\.cz\/?(\?|$)/i.test(www.location) || www.location === "https://infouzel.cz/", www.location);
  ok("www_not_projects", !/\/projects\//i.test(www.location), www.location);

  const projects = await fetchNoFollow(PROD + "/projects/");
  ok("projects_permanent", projects.status === 301 || projects.status === 308, String(projects.status));
  ok("projects_to_root", /^https:\/\/infouzel\.cz\/?(\?|$)/i.test(projects.location), projects.location);

  const projectsStat = await fetchNoFollow(PROD + "/projects/statistiky/");
  ok("projects_stat_permanent", projectsStat.status === 301 || projectsStat.status === 308, String(projectsStat.status));
  ok("projects_stat_to_root", /^https:\/\/infouzel\.cz\/statistiky\/?(\?|$)/i.test(projectsStat.location), projectsStat.location);

  const projectsQ = await fetchNoFollow(PROD + "/projects/?view=saved");
  ok("projects_query_permanent", projectsQ.status === 301 || projectsQ.status === 308, String(projectsQ.status));
  ok("projects_query_kept", /view=saved/.test(projectsQ.location) && !/\/projects\//.test(new URL(projectsQ.location, PROD).pathname), projectsQ.location);

  const data = await fetchNoFollow(PROD + "/projects/version.json");
  ok("data_passthrough", data.status === 200, String(data.status));

  const man = await fetch(PROD + "/manifest.json?cb=" + Date.now(), { headers: { "Cache-Control": "no-cache" } });
  const manJson = man.ok ? await man.json() : {};
  ok("manifest_200", man.status === 200, String(man.status));
  ok("manifest_start", String(manJson.start_url || "") === "/" || String(manJson.start_url || "").startsWith("/?"), String(manJson.start_url));
  ok("manifest_scope", String(manJson.scope || "") === "/", String(manJson.scope));
  ok("manifest_no_projects", !JSON.stringify(manJson).includes("/projects/"), "manifest");

  // Repo static: git root index must never send users to /projects/
  const gitIndex = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok("git_index_no_replace_projects", !/location\.(replace|assign)\([^)]*\/projects\//.test(gitIndex), "git_index");
  ok("git_index_canonical_root", /canonical[^>]+https:\/\/infouzel\.cz\/["']/i.test(gitIndex) || /href="https:\/\/infouzel\.cz\/"/.test(gitIndex), "canonical");

  if (chromium) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));

    await page.goto(PROD + "/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(3500);
    const info = await page.evaluate(async () => {
      let sw = null;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        sw = reg
          ? {
              scope: reg.scope,
              active: reg.active && reg.active.scriptURL,
              controller: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL,
            }
          : null;
      } catch (e) {
        sw = { err: String(e) };
      }
      const canonical = document.querySelector('link[rel="canonical"]');
      const manifest = document.querySelector('link[rel="manifest"]');
      return {
        href: location.href,
        pathname: location.pathname,
        canonical: canonical && canonical.href,
        manifest: manifest && manifest.href,
        sw,
        bodyLen: (document.body && document.body.innerText ? document.body.innerText.trim().length : 0),
        hasApp: !!(document.querySelector("#iuPrehledDneRoot, [data-iu-prehled-dne-root], #app, .iuAppShell, body.iu-app")),
      };
    });
    report.browser = info;
    ok("browser_path_root", info.pathname === "/", info.pathname);
    ok("browser_href_no_projects", !String(info.href).includes("/projects/"), info.href);
    ok("browser_canonical", !String(info.canonical || "").includes("/projects/"), String(info.canonical || ""));
    ok("browser_manifest_link", !String(info.manifest || "").includes("/projects/"), String(info.manifest || ""));
    ok("browser_sw_scope", !info.sw || !String(info.sw.scope || "").includes("/projects/"), JSON.stringify(info.sw));
    ok("browser_body", info.bodyLen > 40 || info.hasApp, String(info.bodyLen));
    ok("console_errors_zero", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
    ok("page_errors_zero", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
    await browser.close();
  } else {
    ok("playwright", false, "missing");
  }

  const out = path.join(process.env.TEMP || "/tmp", "iu-root-routing-prod-guard-report.json");
  fs.writeFileSync(out, JSON.stringify({ fails, report }, null, 2));
  console.log("REPORT=" + out);
  if (fails.length) {
    console.log("FAIL_COUNT=" + fails.length);
    for (const f of fails) console.log("FAIL " + f);
    process.exit(1);
  }
  console.log("[iu-root-routing-prod-guard] OK");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(2);
});
