#!/usr/bin/env node
/**
 * Selftest for iu-pages-retain-prev-assets-v1.mjs (no network beyond localhost).
 * Simulates a live site whose HTML references an OLD hashed core + an older retained generation,
 * then asserts the new artifact keeps both and the manifest is TTL-bounded.
 *
 *   npm run iu-pages-retain-prev-assets-selftest
 */
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

/** Async spawn — the fake live server runs in this process, so the event loop must stay free. */
function runScript(env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "iu-pages-retain-prev-assets-v1.mjs");

const OLD = "7f9d8fda";
const OLDER = "11111111";
const EXPIRED = "22222222";
const NEW = "ae31a0d3";
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const liveFiles = {
  [`/assets/iu-info-system-core-v1.${OLD}.js`]: "/* old core */",
  [`/assets/iu-prehled-dne-ui-v1.${OLD}.js`]: `import "./iu-info-system-core-v1.${OLD}.js";`,
  [`/assets/app.${OLD}.css`]: "body{}",
  [`/assets/iu-info-system-core-v1.${OLDER}.js`]: "/* older core */",
  [`/assets/iu-info-system-core-v1.${EXPIRED}.js`]: "/* expired core */",
  "/assets/iu-retained-assets-v1.json": JSON.stringify({
    files: [
      { file: `iu-info-system-core-v1.${OLDER}.js`, firstSeenUtc: hoursAgo(10) },
      { file: `iu-info-system-core-v1.${EXPIRED}.js`, firstSeenUtc: hoursAgo(500) },
    ],
  }),
};
const liveHtml = `<!doctype html><script type="module" src="/assets/iu-prehled-dne-ui-v1.${OLD}.js"></script><link href="/assets/app.${OLD}.css">`;

const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(liveHtml);
  }
  if (liveFiles[p] !== undefined) {
    res.writeHead(200, { "content-type": p.endsWith(".json") ? "application/json" : p.endsWith(".css") ? "text/css" : "text/javascript" });
    return res.end(liveFiles[p]);
  }
  res.writeHead(404, { "content-type": "text/html" });
  res.end("<html>404</html>");
});

let failed = 0;
function check(label, ok) {
  console.log((ok ? "PASS " : "FAIL ") + label);
  if (!ok) failed++;
}

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const tmp = mkdtempSync(join(tmpdir(), "iu-retain-"));
const stageAbs = join(tmp, "stage");
mkdirSync(join(stageAbs, "assets"), { recursive: true });
writeFileSync(join(stageAbs, "assets", `iu-info-system-core-v1.${NEW}.js`), "/* new core */");

try {
  const r = await runScript({
    IU_PAGES_STAGE_DIR: stageAbs,
    IU_PAGES_LIVE_ORIGIN: `http://127.0.0.1:${port}`,
    IU_PAGES_RETAIN_TTL_HOURS: "72",
  });
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  const a = (n) => join(stageAbs, "assets", n);
  check("exit 0", r.status === 0);
  check("previous core retained (404 skew fixed)", existsSync(a(`iu-info-system-core-v1.${OLD}.js`)));
  check("previous css retained", existsSync(a(`app.${OLD}.css`)));
  check("import dependency of previous UI retained", existsSync(a(`iu-prehled-dne-ui-v1.${OLD}.js`)));
  check("older manifest generation within TTL retained", existsSync(a(`iu-info-system-core-v1.${OLDER}.js`)));
  check("expired generation dropped", !existsSync(a(`iu-info-system-core-v1.${EXPIRED}.js`)));
  check("current deploy file untouched", readFileSync(a(`iu-info-system-core-v1.${NEW}.js`), "utf8") === "/* new core */");
  const man = JSON.parse(readFileSync(a("iu-retained-assets-v1.json"), "utf8"));
  check("manifest lists retained files only", man.files.length === 4 && man.files.every((f) => !f.file.includes(NEW)));
  check("manifest keeps original firstSeenUtc for older generation", man.files.some((f) => f.file.includes(OLDER) && Date.now() - Date.parse(f.firstSeenUtc) > 9 * 3600 * 1000));

  // Fail-open: unreachable origin must not fail the deploy.
  const r2 = await runScript({ IU_PAGES_STAGE_DIR: stageAbs, IU_PAGES_LIVE_ORIGIN: "http://127.0.0.1:1" });
  check("fail-open when live site unreachable", r2.status === 0);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.error("IU_PAGES_RETAIN_SELFTEST_FAIL count=" + failed);
  process.exit(1);
}
console.log("IU_PAGES_RETAIN_SELFTEST_PASS");
