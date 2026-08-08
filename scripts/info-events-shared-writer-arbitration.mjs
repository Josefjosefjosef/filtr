#!/usr/bin/env node
/**
 * Offline model of GitHub Actions concurrency for info-events-data-writers.
 *
 * Documents incident ACTIVE run 31250620970:
 *   running CHMI + pending NDIC + new CHMI/IE request
 *   => pending NDIC cancelled ("higher priority waiting request")
 * when queue mode is the GitHub default (`single`).
 *
 * With `queue: max` (up to 100 pending), FIFO waiters are preserved.
 */
export const SHARED_WRITER_GROUP = "info-events-data-writers";
export const QUEUE_SINGLE = "single";
export const QUEUE_MAX = "max";
export const QUEUE_MAX_CAPACITY = 100;

/**
 * @typedef {{ id: string, source: string, enqueuedAt: number }} WriterReq
 * @typedef {{
 *   running: WriterReq|null,
 *   pending: WriterReq[],
 *   cancelled: WriterReq[],
 *   completed: WriterReq[],
 *   queueMode: 'single'|'max',
 *   cancelInProgress: boolean,
 * }} ArbState
 */

/**
 * @param {{ queueMode?: 'single'|'max', cancelInProgress?: boolean }} [opts]
 * @returns {ArbState}
 */
export function createArbState(opts = {}) {
  return {
    running: null,
    pending: [],
    cancelled: [],
    completed: [],
    queueMode: opts.queueMode === QUEUE_MAX ? QUEUE_MAX : QUEUE_SINGLE,
    cancelInProgress: opts.cancelInProgress === true,
  };
}

/**
 * Enqueue a writer request into a concurrency group (GitHub semantics).
 * @param {ArbState} state
 * @param {WriterReq} req
 * @returns {ArbState}
 */
export function enqueueWriter(state, req) {
  const next = {
    ...state,
    pending: state.pending.slice(),
    cancelled: state.cancelled.slice(),
    completed: state.completed.slice(),
    running: state.running,
  };

  if (!next.running) {
    next.running = req;
    return next;
  }

  if (next.cancelInProgress) {
    // Not used by info-events writers (cancel-in-progress: false).
    next.cancelled.push(next.running);
    next.running = req;
    next.pending = [];
    return next;
  }

  if (next.queueMode === QUEUE_SINGLE) {
    // Default GitHub: at most one pending; new request replaces previous pending.
    if (next.pending.length) {
      next.cancelled.push(...next.pending);
      next.pending = [];
    }
    next.pending = [req];
    return next;
  }

  // queue: max — FIFO pending up to capacity; overflow cancelled.
  if (next.pending.length >= QUEUE_MAX_CAPACITY) {
    next.cancelled.push(req);
    return next;
  }
  next.pending.push(req);
  return next;
}

/**
 * Complete the running writer and promote the next pending (FIFO).
 * @param {ArbState} state
 * @returns {ArbState}
 */
export function completeRunning(state) {
  const next = {
    ...state,
    pending: state.pending.slice(),
    cancelled: state.cancelled.slice(),
    completed: state.completed.slice(),
    running: state.running,
  };
  if (next.running) next.completed.push(next.running);
  next.running = next.pending.shift() || null;
  return next;
}

/**
 * Incident 31250620970 reproduction:
 * A=NDIC pending, B=CHMI running, C=new CHMI/IE request.
 * @param {'single'|'max'} queueMode
 */
export function reproduceIncident31250620970(queueMode) {
  let s = createArbState({ queueMode, cancelInProgress: false });
  s = enqueueWriter(s, { id: "B-chmi-running", source: "chmi", enqueuedAt: 1 });
  s = enqueueWriter(s, { id: "A-ndic-pending", source: "ndic", enqueuedAt: 2 });
  s = enqueueWriter(s, { id: "C-chmi-new", source: "chmi", enqueuedAt: 3 });
  const aCancelled = s.cancelled.some((w) => w.id === "A-ndic-pending");
  const aStillPending = s.pending.some((w) => w.id === "A-ndic-pending");
  return {
    state: s,
    ndicLost: aCancelled,
    ndicStillWaiting: aStillPending || (s.running && s.running.id === "A-ndic-pending"),
    annotationIfLost: aCancelled
      ? "Canceling since a higher priority waiting request for info-events-data-writers exists"
      : null,
  };
}

/**
 * Continuous arrivals; each source must eventually complete at least once.
 * @param {'single'|'max'} queueMode
 * @param {string[]} arrivals source sequence
 */
export function simulateContinuousArrivals(queueMode, arrivals) {
  let s = createArbState({ queueMode, cancelInProgress: false });
  let t = 0;
  const seq = Array.isArray(arrivals) ? arrivals : [];
  for (const source of seq) {
    t += 1;
    s = enqueueWriter(s, { id: source + "-" + t, source, enqueuedAt: t });
    // Deterministic progress: every other arrival, complete current if present.
    if (t % 2 === 0 && s.running) s = completeRunning(s);
  }
  // Drain remaining.
  let guard = 0;
  while (s.running && guard < QUEUE_MAX_CAPACITY + seq.length + 5) {
    s = completeRunning(s);
    guard += 1;
  }
  const completedSources = new Set(s.completed.map((w) => w.source));
  return {
    state: s,
    completedSources,
    cancelledIds: s.cancelled.map((w) => w.id),
    ndicEventuallyWrites: completedSources.has("ndic"),
    chmiEventuallyWrites: completedSources.has("chmi"),
    infoEventsEventuallyWrites: completedSources.has("info-events"),
    anyNdicCancelled: s.cancelled.some((w) => w.source === "ndic"),
  };
}

/** Strip YAML comments for structural scans. */
export function stripYamlComments(src) {
  return String(src || "")
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf("#");
      if (idx < 0) return line;
      const before = line.slice(0, idx);
      if ((before.match(/"/g) || []).length % 2 === 1) return line;
      if ((before.match(/'/g) || []).length % 2 === 1) return line;
      return before;
    })
    .join("\n");
}

/** Parse concurrency block text for a job (best-effort). */
export function jobConcurrencyFlags(jobYamlChunk) {
  const chunk = stripYamlComments(jobYamlChunk);
  const hasGroup = /group:\s*info-events-data-writers/.test(chunk);
  const cancelFalse = /cancel-in-progress:\s*false/.test(chunk);
  const queueMax = /queue:\s*max\b/.test(chunk);
  const queueSingle = /queue:\s*single\b/.test(chunk);
  return {
    hasGroup,
    cancelFalse,
    queueMax,
    queueSingle,
    safeArbitration: hasGroup && cancelFalse && queueMax && !queueSingle,
  };
}
