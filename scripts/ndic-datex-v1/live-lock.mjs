/**
 * Single-flight lock for NDIC 60s live processor.
 * MAX_CONCURRENT_LIVE_DATEX_PROCESSORS=1
 */
import fs from "node:fs";
import path from "node:path";

export function defaultLiveLockPath(env = process.env) {
  if (env.IU_NDIC_LIVE_LOCK_PATH) return path.resolve(String(env.IU_NDIC_LIVE_LOCK_PATH));
  const root = env.IU_NDIC_LIVE_ROOT
    ? path.resolve(String(env.IU_NDIC_LIVE_ROOT))
    : path.join(env.HOME || env.USERPROFILE || ".", ".cache", "infouzel-ndic-live");
  return path.join(root, "live.lock");
}

/**
 * Try acquire exclusive lock. Returns { ok, handle, reason }.
 * Non-blocking: if held, reason=locked.
 */
export function tryAcquireLiveLock(lockPath = defaultLiveLockPath()) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(lockPath, "a+");
  } catch (e) {
    return { ok: false, reason: "lock_open_failed", error: String((e && e.message) || e) };
  }
  try {
    fs.writeSync(fd, "");
    // Exclusive non-blocking lock (Linux/macOS). On Windows, fall back to lockfile presence.
    if (typeof fs.fchmodSync === "function" && process.platform !== "win32") {
      try {
        const { flockSync } = awaitableFlock();
        if (flockSync) {
          const locked = flockSync(fd, "exnb");
          if (!locked) {
            fs.closeSync(fd);
            return { ok: false, reason: "locked" };
          }
        } else {
          // advisory via pid file
          const pidPath = lockPath + ".pid";
          if (fs.existsSync(pidPath)) {
            const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
            if (pid && isPidAlive(pid)) {
              fs.closeSync(fd);
              return { ok: false, reason: "locked", holderPid: pid };
            }
          }
          fs.writeFileSync(pidPath, String(process.pid) + "\n", "utf8");
        }
      } catch {
        const pidPath = lockPath + ".pid";
        if (fs.existsSync(pidPath)) {
          const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
          if (pid && isPidAlive(pid)) {
            fs.closeSync(fd);
            return { ok: false, reason: "locked", holderPid: pid };
          }
        }
        fs.writeFileSync(pidPath, String(process.pid) + "\n", "utf8");
      }
    } else {
      const pidPath = lockPath + ".pid";
      if (fs.existsSync(pidPath)) {
        const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
        if (pid && isPidAlive(pid)) {
          fs.closeSync(fd);
          return { ok: false, reason: "locked", holderPid: pid };
        }
      }
      fs.writeFileSync(pidPath, String(process.pid) + "\n", "utf8");
    }
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + "\n");
    return {
      ok: true,
      handle: {
        fd,
        lockPath,
        release() {
          try {
            const pidPath = lockPath + ".pid";
            if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
          } catch {
            /* ignore */
          }
          try {
            fs.closeSync(fd);
          } catch {
            /* ignore */
          }
        },
      },
    };
  } catch (e) {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
    return { ok: false, reason: "lock_failed", error: String((e && e.message) || e) };
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function awaitableFlock() {
  try {
    // Optional native; not required — pid fallback is enough for VPS.
    return { flockSync: null };
  } catch {
    return { flockSync: null };
  }
}
