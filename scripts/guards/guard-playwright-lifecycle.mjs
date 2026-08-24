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

export function pickGuardPort(base = 9200, span = 800) {
  return base + Math.floor(Math.random() * span);
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
