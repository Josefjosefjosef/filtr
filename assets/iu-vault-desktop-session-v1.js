/**
 * Desktop shared unlock session — SharedWorker broker + BroadcastChannel fallback.
 * Ephemeral: no persistent unlock flag; MDK never written to storage.
 */
const DESKTOP_MQ = "(min-width: 1025px)";
const WORKER_URL = "/assets/iu-vault-desktop-session-worker-v1.js?v=iu-vault-desktop-shared-session-v3-20260826";
const BC_NAME = "iu-vault-desktop-session-v1";

let workerPort = null;
let workerReady = null;
let bc = null;
let localGeneration = 0;
let leaderId = null;
let joinWaiters = [];
let sessionReadyListeners = [];
let lastDesktopJoinPending = false;

export function wasDesktopJoinPending() {
  return !!lastDesktopJoinPending;
}

function randomId() {
  try {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (_) {
    return String(Date.now()) + Math.random().toString(16).slice(2);
  }
}

export function isDesktopSharedSessionViewport() {
  try {
    return !!(window.matchMedia && window.matchMedia(DESKTOP_MQ).matches);
  } catch (_) {
    return false;
  }
}

function ensureBroadcast() {
  if (bc) return bc;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(BC_NAME);
      bc.addEventListener("message", (ev) => {
        handleBcMessage(ev.data || {});
      });
    }
  } catch (_) {}
  return bc;
}

function notifySessionReady(generation) {
  sessionReadyListeners.slice().forEach((fn) => {
    try {
      fn(generation);
    } catch (_) {}
  });
  const pending = joinWaiters.slice();
  joinWaiters = [];
  pending.forEach((fn) => {
    try {
      fn();
    } catch (_) {}
  });
}

function handleBcMessage(data) {
  const type = data && data.type ? String(data.type) : "";
  if (type === "session-offer") {
    const gen = Number(data.generation) || 0;
    if (gen <= localGeneration) return;
    return;
  }
  if (type === "session-ready") {
    const gen = Number(data.generation) || 0;
    if (data.leaderId) leaderId = String(data.leaderId);
    if (gen > localGeneration) localGeneration = gen;
    notifySessionReady(gen);
    return;
  }
  if (type === "session-invalidate") {
    const gen = Number(data.generation) || 0;
    if (gen >= localGeneration) {
      localGeneration = gen;
      leaderId = null;
    }
    return;
  }
  if (type === "session-join") {
    if (!data.port) return;
    try {
      const getMdk = window.__iuVaultDesktopSessionLeaderMdk;
      if (typeof getMdk !== "function") return;
      const mdk = getMdk();
      if (!mdk) return;
      data.port.postMessage({ ok: true, generation: localGeneration, mdk });
    } catch (_) {}
  }
}

function workerSend(payload) {
  if (!workerPort) return Promise.resolve(null);
  return new Promise((resolve) => {
    const requestId = randomId();
    const onMsg = (ev) => {
      const data = ev.data || {};
      if (data.requestId && data.requestId !== requestId) return;
      try {
        workerPort.removeEventListener("message", onMsg);
      } catch (_) {}
      resolve(data);
    };
    try {
      workerPort.addEventListener("message", onMsg);
      workerPort.postMessage(Object.assign({ requestId }, payload));
    } catch (_) {
      resolve(null);
    }
    setTimeout(() => {
      try {
        workerPort.removeEventListener("message", onMsg);
      } catch (_) {}
      resolve(null);
    }, 5000);
  });
}

export async function initDesktopSessionCoordinator() {
  if (!isDesktopSharedSessionViewport()) return false;
  ensureBroadcast();
  if (workerReady) return workerReady;
  workerReady = new Promise((resolve) => {
    try {
      if (typeof SharedWorker === "undefined") {
        resolve(false);
        return;
      }
      const worker = new SharedWorker(
        (() => {
          try {
            if (window.iuTrustedHtml && window.iuTrustedHtml.policies && window.iuTrustedHtml.policies.default) {
              return window.iuTrustedHtml.policies.default.createScriptURL(WORKER_URL);
            }
          } catch (_) {}
          return WORKER_URL;
        })(),
        { name: BC_NAME }
      );
      workerPort = worker.port;
      workerPort.addEventListener("message", (ev) => {
        const data = ev.data || {};
        if (data.op === "session-ready" && data.generation) {
          localGeneration = Math.max(localGeneration, Number(data.generation) || 0);
          notifySessionReady(localGeneration);
        }
        if (data.op === "invalidated" && data.generation) {
          localGeneration = Math.max(localGeneration, Number(data.generation) || 0);
          leaderId = null;
        }
      });
      workerPort.start();
      workerPort.addEventListener("message", function hello(ev) {
        if (ev.data && ev.data.op === "hello") {
          try {
            workerPort.removeEventListener("message", hello);
          } catch (_) {}
          localGeneration = Math.max(localGeneration, Number(ev.data.generation) || 0);
          resolve(true);
        }
      });
      setTimeout(() => resolve(!!workerPort), 1500);
    } catch (_) {
      resolve(false);
    }
  });
  try {
    window.addEventListener("pagehide", () => {
      try {
        workerSend({ op: "leave" });
      } catch (_) {}
    });
  } catch (_) {}
  return workerReady;
}

export function onDesktopSessionReady(fn) {
  if (typeof fn !== "function") return;
  sessionReadyListeners.push(fn);
}

export async function tryJoinDesktopSession() {
  if (!isDesktopSharedSessionViewport()) return null;
  lastDesktopJoinPending = false;
  try {
    if (window.__IU_NEG_BLOCK_DESKTOP_SESSION_JOIN) return null;
  } catch (_) {}
  await initDesktopSessionCoordinator();
  if (workerPort) {
    const resp = await workerSend({ op: "join", generation: localGeneration });
    if (resp && resp.op === "joined" && resp.mdk) {
      localGeneration = Math.max(localGeneration, Number(resp.generation) || 0);
      return resp.mdk;
    }
    if (resp && resp.op === "join-pending") {
      lastDesktopJoinPending = true;
      return null;
    }
  }
  return await tryJoinDesktopSessionFallback();
}

async function tryJoinDesktopSessionFallback() {
  ensureBroadcast();
  return new Promise((resolve) => {
    const joinId = randomId();
    const timer = setTimeout(() => resolve(null), 4000);
    try {
      const ch = new MessageChannel();
      ch.port1.onmessage = (ev) => {
        const data = ev.data || {};
        if (!data.ok || !data.mdk) return;
        if (Number(data.generation) !== localGeneration && localGeneration > 0) return;
        clearTimeout(timer);
        localGeneration = Math.max(localGeneration, Number(data.generation) || 0);
        resolve(data.mdk);
      };
      bc.postMessage({
        type: "session-join",
        joinId,
        generation: localGeneration,
        leaderId,
        port: ch.port2,
      }, [ch.port2]);
    } catch (_) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export async function publishDesktopSession(mdk) {
  if (!isDesktopSharedSessionViewport() || !mdk) return false;
  await initDesktopSessionCoordinator();
  const nextGen = localGeneration + 1;
  leaderId = randomId();
  try {
    window.__iuVaultDesktopSessionLeaderMdk = () => mdk;
  } catch (_) {}
  if (workerPort) {
    const resp = await workerSend({ op: "publish", generation: nextGen, mdk });
    if (resp && resp.op === "published") {
      localGeneration = Number(resp.generation) || nextGen;
      ensureBroadcast();
      try {
        bc.postMessage({ type: "session-ready", generation: localGeneration, leaderId });
      } catch (_) {}
      return true;
    }
  }
  localGeneration = nextGen;
  ensureBroadcast();
  try {
    bc.postMessage({ type: "session-offer", generation: localGeneration, leaderId });
    bc.postMessage({ type: "session-ready", generation: localGeneration, leaderId });
  } catch (_) {}
  return true;
}

export async function invalidateDesktopSession(reason) {
  if (!isDesktopSharedSessionViewport()) return;
  const nextGen = localGeneration + 1;
  leaderId = null;
  try {
    delete window.__iuVaultDesktopSessionLeaderMdk;
  } catch (_) {}
  if (workerPort) {
    await workerSend({ op: "invalidate", generation: nextGen, reason: String(reason || "") });
  }
  localGeneration = nextGen;
  ensureBroadcast();
  try {
    bc.postMessage({ type: "session-invalidate", generation: localGeneration, reason: String(reason || "") });
  } catch (_) {}
}

export async function desktopSessionPeerTabCount() {
  if (!workerPort) return 0;
  const resp = await workerSend({ op: "status" });
  return resp && typeof resp.portCount === "number" ? resp.portCount : 0;
}

export function shouldSkipDesktopBackgroundAutoLock() {
  if (!isDesktopSharedSessionViewport()) return false;
  return true;
}
