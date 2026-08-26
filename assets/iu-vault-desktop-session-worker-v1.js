/**
 * Desktop-only ephemeral vault session broker (SharedWorker).
 * Holds in-memory MDK for same-origin tabs; cleared when all tabs disconnect or on invalidate.
 */
"use strict";

const CHANNEL = "iu-vault-desktop-session-v1";
const ports = new Set();
let generation = 0;
let sessionMdk = null;

function portCount() {
  return ports.size;
}

function clearSession(nextGen) {
  generation = typeof nextGen === "number" && nextGen > generation ? nextGen : generation + 1;
  sessionMdk = null;
  broadcast({ op: "invalidated", generation });
}

function broadcast(msg) {
  ports.forEach((port) => {
    try {
      port.postMessage(msg);
    } catch (_) {}
  });
}

function reply(port, msg, req) {
  const out = Object.assign({}, msg);
  if (req && req.requestId) out.requestId = req.requestId;
  try {
    port.postMessage(out);
  } catch (_) {}
}

function handleMessage(port, data) {
  const op = data && data.op ? String(data.op) : "";
  if (op === "join") {
    const reqGen = typeof data.generation === "number" ? data.generation : 0;
    if (sessionMdk && reqGen > 0 && reqGen !== generation) {
      reply(port, { op: "join-denied", reason: "stale_generation", generation }, data);
      return;
    }
    if (sessionMdk) {
      reply(port, { op: "joined", generation, mdk: sessionMdk, portCount: portCount() }, data);
      return;
    }
    reply(port, { op: "join-pending", generation, portCount: portCount() }, data);
    return;
  }
  if (op === "publish") {
    const reqGen = typeof data.generation === "number" ? data.generation : 0;
    if (reqGen <= generation) {
      reply(port, { op: "publish-denied", reason: "stale_generation", generation }, data);
      return;
    }
    if (!data.mdk) {
      reply(port, { op: "publish-denied", reason: "missing_mdk", generation }, data);
      return;
    }
    generation = reqGen;
    sessionMdk = data.mdk;
    broadcast({ op: "session-ready", generation, portCount: portCount() });
    reply(port, { op: "published", generation, portCount: portCount() }, data);
    return;
  }
  if (op === "invalidate") {
    const reqGen = typeof data.generation === "number" ? data.generation : 0;
    if (reqGen > 0 && reqGen < generation) {
      reply(port, { op: "invalidate-ignored", generation }, data);
      return;
    }
    clearSession(reqGen > generation ? reqGen : generation + 1);
    reply(port, { op: "invalidated", generation, portCount: portCount() }, data);
    return;
  }
  if (op === "status") {
    reply(
      port,
      {
        op: "status",
        generation,
        hasSession: !!sessionMdk,
        portCount: portCount(),
      },
      data
    );
    return;
  }
  if (op === "leave") {
    try {
      ports.delete(port);
    } catch (_) {}
    if (ports.size === 0) {
      generation += 1;
      sessionMdk = null;
    }
    return;
  }
}

self.onconnect = (ev) => {
  const port = ev.ports[0];
  ports.add(port);
  port.onmessage = (msgEv) => {
    handleMessage(port, msgEv.data || {});
  };
  try {
    port.start();
  } catch (_) {}
  reply(port, {
    op: "hello",
    generation,
    hasSession: !!sessionMdk,
    portCount: portCount(),
    channel: CHANNEL,
  });
};
