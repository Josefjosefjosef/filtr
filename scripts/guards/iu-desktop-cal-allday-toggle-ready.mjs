/**
 * Shared ready / ownership / failure contracts for desktop calendar all-day toggle guard.
 * Test infrastructure only — no product code.
 */
import http from "http";
import net from "net";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const INLINE_WAIT_MS = 30000;
export const OVERLAY_WAIT_MS = 30000;
export const CAL_SERVICE_WAIT_MS = 90000;
export const SERVER_READY_WAIT_MS = 45000;

export const FAIL = Object.freeze({
  SERVER_NOT_READY: "SERVER_NOT_READY",
  WRONG_APP_RESPONSE: "WRONG_APP_RESPONSE",
  STALE_PORT_PROCESS: "STALE_PORT_PROCESS",
  PAGE_URL_MISMATCH: "PAGE_URL_MISMATCH",
  DOCUMENT_NOT_COMPLETE: "DOCUMENT_NOT_COMPLETE",
  PAGE_ERROR_BEFORE_CLICK: "PAGE_ERROR_BEFORE_CLICK",
  PAGE_ERROR_AFTER_CLICK: "PAGE_ERROR_AFTER_CLICK",
  CALENDAR_ROOT_MISSING: "CALENDAR_ROOT_MISSING",
  DAY_SLOT_MISSING: "DAY_SLOT_MISSING",
  DAY_SLOT_NOT_VISIBLE: "DAY_SLOT_NOT_VISIBLE",
  DAY_SLOT_COVERED: "DAY_SLOT_COVERED",
  LISTENER_NOT_READY: "LISTENER_NOT_READY",
  INLINE_ALREADY_OPEN: "INLINE_ALREADY_OPEN",
  CLICK_FAILED: "CLICK_FAILED",
  INLINE_ROOT_MISSING: "INLINE_ROOT_MISSING",
  INLINE_ROOT_HIDDEN: "INLINE_ROOT_HIDDEN",
  WRONG_DAY_OR_FORM: "WRONG_DAY_OR_FORM",
  SECOND_CLICK_REQUIRED: "SECOND_CLICK_REQUIRED",
  ALL_DAY_TOGGLE_FAIL: "ALL_DAY_TOGGLE_FAIL",
  CLEANUP_FAILED: "CLEANUP_FAILED",
  BROWSER_ERROR: "BROWSER_ERROR",
  HTTP_REQUEST_FAILURE: "HTTP_REQUEST_FAILURE",
  READY_MILESTONE_MISSING: "READY_MILESTONE_MISSING",
});

export function failError(code, detail) {
  const err = new Error(code + (detail ? ": " + detail : ""));
  err.code = code;
  err.sanitized = true;
  return err;
}

export function allocateEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else if (!port) reject(new Error("no ephemeral port"));
        else resolve(port);
      });
    });
    srv.on("error", reject);
  });
}

function mimeFor(fp) {
  if (fp.endsWith(".html")) return "text/html; charset=utf-8";
  if (fp.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (fp.endsWith(".css")) return "text/css; charset=utf-8";
  if (fp.endsWith(".json")) return "application/json; charset=utf-8";
  if (fp.endsWith(".svg")) return "image/svg+xml";
  if (fp.endsWith(".png")) return "image/png";
  if (fp.endsWith(".jpg") || fp.endsWith(".jpeg")) return "image/jpeg";
  if (fp.endsWith(".webp")) return "image/webp";
  if (fp.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

/**
 * Task-owned static server with ownership token endpoint.
 * Never attaches to an existing listener.
 */
export function startOwnedStaticServer(repoRoot, port) {
  const token = crypto.randomBytes(16).toString("hex");
  const root = path.resolve(repoRoot);
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/__iu_cal_toggle_guard_owner") {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "x-iu-cal-toggle-owner": token,
          "cache-control": "no-store",
        });
        res.end(JSON.stringify({ ok: true, token, app: "iu-cal-allday-toggle-guard" }));
        return;
      }
      let p = decodeURIComponent(u.pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(root, p.replace(/^\/+/, ""));
      if (!fp.startsWith(root) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const body = fs.readFileSync(fp);
      res.writeHead(200, {
        "content-type": mimeFor(fp),
        "x-iu-cal-toggle-owner": token,
        "cache-control": "no-store",
      });
      res.end(body);
    } catch (_) {
      res.writeHead(500);
      res.end("err");
    }
  });

  const listenPromise = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return { server, token, listenPromise, port };
}

function httpGetJson(host, port, pathname, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, path: pathname, method: "GET", timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {}
          resolve({
            status: res.statusCode || 0,
            ownerHeader: res.headers["x-iu-cal-toggle-owner"] || "",
            json,
            rawLen: raw.length,
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

export async function waitForOwnedServerReady(host, port, expectedToken, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() <= deadline) {
    try {
      const r = await httpGetJson(host, port, "/__iu_cal_toggle_guard_owner", 800);
      if (r.status === 200 && r.ownerHeader === expectedToken && r.json && r.json.token === expectedToken) {
        const app = await httpGetJson(host, port, "/projects/", 2000).catch(() => null);
        if (!app || app.status !== 200 || app.ownerHeader !== expectedToken || app.rawLen < 200) {
          throw failError(FAIL.WRONG_APP_RESPONSE, "projects/ missing or wrong owner");
        }
        return;
      }
      if (r.status === 200 && r.ownerHeader && r.ownerHeader !== expectedToken) {
        throw failError(FAIL.STALE_PORT_PROCESS, "owner token mismatch");
      }
      lastErr = new Error("token not ready");
    } catch (e) {
      if (e && e.code === FAIL.STALE_PORT_PROCESS) throw e;
      if (e && e.code === FAIL.WRONG_APP_RESPONSE) throw e;
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw failError(
    FAIL.SERVER_NOT_READY,
    lastErr && lastErr.message ? lastErr.message : "deadline"
  );
}

export async function closeOwnedServer(server) {
  if (!server) return;
  await new Promise((resolve) => {
    try {
      server.close(() => resolve());
      setTimeout(resolve, 2000);
    } catch (_) {
      resolve();
    }
  });
}

/**
 * Pure ready-gate used by fixtures: click allowed only after milestone.
 */
export async function waitForReadyMilestone(readState, isReady, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const s = await readState();
    if (isReady(s)) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw failError(FAIL.READY_MILESTONE_MISSING, "ready deadline");
}

/**
 * Ensures exactly one click callback after ready; second click forbidden.
 */
export async function runSingleClickAfterReady({ readState, isReady, click, timeoutMs }) {
  let clicks = 0;
  const wrappedClick = async () => {
    clicks += 1;
    if (clicks > 1) throw failError(FAIL.SECOND_CLICK_REQUIRED, "second click attempted");
    return click();
  };
  await waitForReadyMilestone(readState, isReady, timeoutMs);
  await wrappedClick();
  return { clicks };
}

export function assertScenarioIsolation(sharedKeys) {
  if (sharedKeys && sharedKeys.length) {
    throw failError("SCENARIO_STATE_LEAK", sharedKeys.join(","));
  }
  return true;
}
