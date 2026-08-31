/**
 * Shared static-server + Playwright teardown for guard scripts.
 */
import http from "http";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(REPO, "package.json"));

/** Chromium net::ERR_UNSAFE_PORT denylist (subset relevant to local guard ranges). */
const CHROME_UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
  179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563,
  587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

export function pickGuardPort(base = 9200, span = 800) {
  const safeSpan = Math.max(1, Number(span) || 1);
  const safeBase = Math.max(1, Number(base) || 9200);
  for (let i = 0; i < 64; i++) {
    const port = safeBase + Math.floor(Math.random() * safeSpan);
    if (!CHROME_UNSAFE_PORTS.has(port)) return port;
  }
  return safeBase + (safeSpan > 1 ? 17 % safeSpan : 0);
}

export function waitForPort(host, port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`server_not_up:${port}`));
        else setTimeout(tryOnce, 120);
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() > deadline) reject(new Error(`server_not_up:${port}`));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

export function killProcessTree(procOrPid) {
  const pid = typeof procOrPid === "number" ? procOrPid : procOrPid && procOrPid.pid;
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch (_) {}
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (_) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (_) {}
  }
}

export async function stopGuardProcess(proc, timeoutMs = 4000) {
  if (!proc || proc.killed) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      finish();
    });
    try {
      proc.kill("SIGTERM");
    } catch (_) {
      clearTimeout(timer);
      finish();
    }
  });
  if (proc.exitCode == null && !proc.killed) {
    killProcessTree(proc);
  }
}

export async function closePlaywrightSession(page, context, browser, timeoutMs = 3000) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const browserProc = browser && typeof browser.process === "function" ? browser.process() : null;
  if (page) {
    try {
      await Promise.race([page.close({ runBeforeUnload: false }), delay(timeoutMs)]);
    } catch (_) {}
  }
  if (context) {
    try {
      await Promise.race([context.close(), delay(timeoutMs)]);
    } catch (_) {}
  }
  if (browser) {
    try {
      await Promise.race([browser.close(), delay(timeoutMs)]);
    } catch (_) {}
  }
  if (browserProc) {
    killProcessTree(browserProc);
  }
}

export function runGuardChildScript(scriptPath, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || 120000;
  const cwd = options.cwd || REPO;
  const env = { ...process.env, ...(options.env || {}) };
  const capture = !!options.captureOutput;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killProcessTree(child);
      finish({ status: null, timedOut: true, stdout, stderr });
    }, timeoutMs);
    child.on("exit", (code) => {
      finish({ status: code, timedOut: false, stdout, stderr });
    });
    child.on("error", (err) => {
      finish({ status: 1, timedOut: false, error: err, stdout, stderr });
    });
  });
}

export async function startGuardStaticServer(preferredPort) {
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = preferredPort + attempt;
    let proc = null;
    try {
      proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
        cwd: REPO,
        env: { ...process.env, PORT: String(port) },
        stdio: "ignore",
        detached: false,
        windowsHide: true,
      });
      await new Promise((resolve, reject) => {
        proc.once("error", reject);
        waitForPort("127.0.0.1", port, 10000).then(resolve).catch(reject);
      });
      return { proc, port };
    } catch (err) {
      lastErr = err;
      if (proc) await stopGuardProcess(proc, 1500);
    }
  }
  throw lastErr || new Error("server_start_failed");
}
