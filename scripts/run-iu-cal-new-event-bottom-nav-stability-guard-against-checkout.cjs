#!/usr/bin/env node
"use strict";

/**
 * Run calendar Nová událost bottom-nav stability guard against checkout.
 */

const path = require("path");
const { spawn, spawnSync } = require("child_process");
const http = require("http");

const PORT = Number(process.env.IU_CAL_SHEET_NAV_GUARD_LOCAL_PORT || 8099);
const GUARD_URL = `http://127.0.0.1:${PORT}/`;
const SERVER_SCRIPT = path.join(__dirname, "..", "server", "projects-static.mjs");

function waitForServer(maxMs) {
  const deadline = Date.now() + maxMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(GUARD_URL, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
        else if (Date.now() >= deadline) reject(new Error("server not ready"));
        else setTimeout(tick, 250);
      });
      req.on("error", () => {
        if (Date.now() >= deadline) reject(new Error("server not ready"));
        else setTimeout(tick, 250);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (Date.now() >= deadline) reject(new Error("server not ready"));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

async function main() {
  const server = spawn(process.execPath, [SERVER_SCRIPT], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (c) => (serverLog += String(c)));
  server.stderr.on("data", (c) => (serverLog += String(c)));
  const stopServer = () => {
    if (!server.killed) server.kill("SIGTERM");
  };
  process.on("exit", stopServer);

  try {
    await waitForServer(30000);
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "iu-cal-new-event-bottom-nav-stability-guard-v1.cjs")],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          IU_CAL_SHEET_NAV_GUARD_URL: GUARD_URL,
          SILVER_HOME_UX_GUARD_URL: GUARD_URL,
        },
      }
    );
    process.exitCode = result.status === 0 ? 0 : result.status || 1;
  } catch (err) {
    process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
    if (serverLog) process.stderr.write(serverLog + "\n");
    process.exitCode = 1;
  } finally {
    stopServer();
  }
}

main();
