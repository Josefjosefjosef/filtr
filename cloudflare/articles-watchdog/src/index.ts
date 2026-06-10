/**
 * Cloudflare Worker: cron + optional manual /run (secret).
 * Dual dispatch: fast publishable_pool path (15m) + slow full pipeline path.
 */
import { decideWatchdog, DEFAULT_QUEUED_STALE_MINUTES, parseIsoToMs } from "./decision";
import {
  buildDualTelemetry,
  resolveLaneConfigs,
  runLane,
  type DualDispatchTelemetry,
  type LaneDeps,
} from "./lanes";

export interface Env {
  GITHUB_TOKEN: string;
  /** e.g. Josefjosefjosef/filtr */
  GITHUB_REPOSITORY: string;
  /** Legacy single-workflow var (slow path fallback). */
  WORKFLOW_FILE?: string;
  FAST_WORKFLOW_FILE?: string;
  SLOW_WORKFLOW_FILE?: string;
  /** Legacy slow freshness URL. */
  FRESHNESS_URL: string;
  FAST_FRESHNESS_URL?: string;
  SLOW_FRESHNESS_URL?: string;
  /** Legacy slow stale minutes. */
  STALE_AFTER_MINUTES: string;
  FAST_STALE_AFTER_MINUTES?: string;
  SLOW_STALE_AFTER_MINUTES?: string;
  /** Optional: Bearer secret for POST /run only */
  MANUAL_TRIGGER_SECRET?: string;
}

type GhRun = {
  status: string;
  event: string;
  conclusion: string | null;
  created_at: string;
  id?: number;
};

type FreshnessDoc = {
  generatedAt?: string;
};

export type ProbeResult = {
  ok: boolean;
  service: string;
  github_token_present: boolean;
  github_token_length: number;
  github_repository: string;
  workflow_file: string;
  freshness_url: string;
  stale_after_minutes: number;
  generated_at: string | null;
  generated_age_minutes: number | null;
  github_list_runs_status: number | null;
  github_list_runs_error: string | null;
  github_dispatch_probe_status: number | null;
  decision: ReturnType<typeof decideWatchdog> | null;
  decision_error: string | null;
  blocking_run_ids: number[];
  zombie_queued_cancelled: number;
  dual_dispatch?: DualDispatchTelemetry;
};

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "infouzel-articles-watchdog",
  };
}

function assertGithubToken(env: Env): void {
  const token = (env.GITHUB_TOKEN || "").trim();
  if (!token) {
    throw new Error("GITHUB_TOKEN secret missing on worker (wrangler secret put GITHUB_TOKEN)");
  }
}

async function fetchGeneratedAtFromUrl(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    console.log(`[watchdog] freshness fetch failed: ${res.status} url=${url}`);
    return null;
  }
  const json = (await res.json()) as FreshnessDoc;
  const g = json.generatedAt;
  return typeof g === "string" && g.length > 0 ? g : null;
}

async function fetchWorkflowRunsForFile(env: Env, workflowFile: string): Promise<GhRun[]> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  if (!owner || !repo) throw new Error("Invalid GITHUB_REPOSITORY");
  const wf = encodeURIComponent(workflowFile);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=15`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub list runs failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { workflow_runs?: GhRun[] };
  return data.workflow_runs ?? [];
}

async function cancelStaleQueuedRunsForFile(
  env: Env,
  workflowFile: string,
  queuedStaleMinutes: number,
): Promise<number> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(workflowFile);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=20&status=queued`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (!res.ok) {
    console.log(`[watchdog] list queued runs failed: ${res.status} wf=${workflowFile}`);
    return 0;
  }
  const data = (await res.json()) as { workflow_runs?: Array<GhRun & { id?: number }> };
  const nowMs = Date.now();
  let cancelled = 0;
  for (const run of data.workflow_runs ?? []) {
    const createdMs = parseIsoToMs(run.created_at);
    if (createdMs === null) continue;
    const ageMin = (nowMs - createdMs) / 60_000;
    if (ageMin < queuedStaleMinutes) continue;
    if (!run.id) continue;
    const cancelUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/cancel`;
    const cr = await fetch(cancelUrl, { method: "POST", headers: ghHeaders(env.GITHUB_TOKEN) });
    console.log(
      `[watchdog] cancel queued run_id=${run.id} wf=${workflowFile} age_min=${ageMin.toFixed(0)} status=${cr.status}`,
    );
    if (cr.ok || cr.status === 409) cancelled += 1;
  }
  return cancelled;
}

async function dispatchWorkflowFile(env: Env, workflowFile: string): Promise<void> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(workflowFile);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
  console.log(`[watchdog] dispatch POST ${url} ref=main repo=${env.GITHUB_REPOSITORY}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...ghHeaders(env.GITHUB_TOKEN),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  const bodyText = res.status === 204 ? "" : await res.text();
  console.log(`[watchdog] dispatch status=${res.status} wf=${workflowFile} body=${bodyText.slice(0, 300)}`);
  if (res.status !== 204) {
    throw new Error(`GitHub dispatch failed: ${res.status} ${bodyText}`);
  }
}

function makeLaneDeps(env: Env): LaneDeps {
  return {
    fetchGeneratedAt: (url) => fetchGeneratedAtFromUrl(url),
    fetchWorkflowRuns: (workflowFile) => fetchWorkflowRunsForFile(env, workflowFile),
    cancelStaleQueuedRuns: (workflowFile, queuedStaleMinutes) =>
      cancelStaleQueuedRunsForFile(env, workflowFile, queuedStaleMinutes),
    dispatchWorkflow: (workflowFile) => dispatchWorkflowFile(env, workflowFile),
  };
}

function logDualTelemetry(telemetry: DualDispatchTelemetry): void {
  console.log(`[watchdog] FAST_DISPATCH_ATTEMPTED=${telemetry.FAST_DISPATCH_ATTEMPTED}`);
  console.log(`[watchdog] FAST_DISPATCHED=${telemetry.FAST_DISPATCHED}`);
  console.log(`[watchdog] FAST_SKIPPED_BUSY=${telemetry.FAST_SKIPPED_BUSY}`);
  console.log(`[watchdog] FAST_SKIPPED_NOT_STALE=${telemetry.FAST_SKIPPED_NOT_STALE}`);
  console.log(`[watchdog] FAST_STALE_MINUTES=${telemetry.FAST_STALE_MINUTES}`);
  console.log(`[watchdog] SLOW_DISPATCH_ATTEMPTED=${telemetry.SLOW_DISPATCH_ATTEMPTED}`);
  console.log(`[watchdog] SLOW_DISPATCHED=${telemetry.SLOW_DISPATCHED}`);
  console.log(`[watchdog] SLOW_SKIPPED_BUSY=${telemetry.SLOW_SKIPPED_BUSY}`);
  console.log(`[watchdog] SLOW_STALE_MINUTES=${telemetry.SLOW_STALE_MINUTES}`);
  console.log(`[watchdog] WATCHDOG_DUAL_DISPATCH_STATUS=${telemetry.WATCHDOG_DUAL_DISPATCH_STATUS}`);
}

export async function runDualWatchdog(env: Env, options?: { dispatch?: boolean }): Promise<{
  telemetry: DualDispatchTelemetry;
  errors: string[];
}> {
  const lanes = resolveLaneConfigs(env);
  const deps = makeLaneDeps(env);
  const shouldDispatch = options?.dispatch !== false;
  const results = [];
  const errors: string[] = [];

  for (const laneConfig of lanes) {
    try {
      if (!shouldDispatch) {
        const generatedAtIso = await deps.fetchGeneratedAt(laneConfig.freshnessUrl);
        const runs = await deps.fetchWorkflowRuns(laneConfig.workflowFile);
        const nowMs = Date.now();
        const decision = decideWatchdog({
          generatedAtIso,
          staleAfterMinutes: laneConfig.staleAfterMinutes,
          nowMs,
          runs: runs.map((r) => ({ status: r.status, created_at: r.created_at })),
        });
        const generatedMs = parseIsoToMs(generatedAtIso ?? undefined);
        results.push({
          lane: laneConfig.kind,
          workflow_file: laneConfig.workflowFile,
          freshness_url: laneConfig.freshnessUrl,
          stale_after_minutes: laneConfig.staleAfterMinutes,
          generated_at: generatedAtIso,
          stale_minutes: generatedMs !== null ? (nowMs - generatedMs) / 60_000 : null,
          dispatch_attempted: true,
          dispatched: false,
          skipped_busy: decision.action === "skip_busy",
          skipped_not_stale: decision.action === "skip_fresh",
          decision,
          blocking_run_ids: [],
          zombie_queued_cancelled: 0,
          dispatch_error: null,
        });
        continue;
      }
      const laneResult = await runLane(laneConfig, deps);
      results.push(laneResult);
      console.log(`[watchdog] lane=${laneConfig.kind} decision`, JSON.stringify(laneResult.decision));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${laneConfig.kind}:${msg}`);
      console.error(`[watchdog] lane=${laneConfig.kind} error`, msg);
    }
  }

  const telemetry = buildDualTelemetry(results);
  logDualTelemetry(telemetry);
  return { telemetry, errors };
}

/** Backward-compatible single-lane entry (slow path probe semantics). */
export async function runWatchdog(env: Env): Promise<Response> {
  const { telemetry, errors } = await runDualWatchdog(env, { dispatch: true });
  const status = errors.length ? 500 : 200;
  return new Response(
    JSON.stringify({
      ok: errors.length === 0,
      dual_dispatch: telemetry,
      errors,
    }),
    { status, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

export async function buildProbe(env: Env, dispatchProbe = false): Promise<ProbeResult> {
  const token = (env.GITHUB_TOKEN || "").trim();
  const slowWorkflow = (env.SLOW_WORKFLOW_FILE || env.WORKFLOW_FILE || "update-articles.yml").trim();
  const slowFreshness = (env.SLOW_FRESHNESS_URL || env.FRESHNESS_URL || "").trim();
  const slowStale = Number.parseInt(
    env.SLOW_STALE_AFTER_MINUTES || env.STALE_AFTER_MINUTES || "5",
    10,
  );
  const nowMs = Date.now();

  let githubListStatus: number | null = null;
  let githubListError: string | null = null;
  let runs: GhRun[] = [];
  if (token) {
    try {
      runs = await fetchWorkflowRunsForFile(env, slowWorkflow);
      githubListStatus = 200;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      githubListError = msg;
      const m = msg.match(/failed: (\d{3})/);
      githubListStatus = m ? Number(m[1]) : null;
    }
  } else {
    githubListError = "GITHUB_TOKEN secret missing";
  }

  const generatedAtIso = slowFreshness ? await fetchGeneratedAtFromUrl(slowFreshness) : null;
  const generatedMs = parseIsoToMs(generatedAtIso ?? undefined);
  const generatedAgeMin = generatedMs !== null ? (nowMs - generatedMs) / 60_000 : null;

  let decision: ReturnType<typeof decideWatchdog> | null = null;
  let decisionError: string | null = null;
  try {
    decision = decideWatchdog({
      generatedAtIso,
      staleAfterMinutes: slowStale,
      nowMs,
      runs: runs.map((r) => ({ status: r.status, created_at: r.created_at })),
    });
  } catch (e) {
    decisionError = e instanceof Error ? e.message : String(e);
  }

  const blockingRunIds = runs
    .filter((r) => {
      if (r.status === "in_progress") return true;
      if (r.status !== "queued") return false;
      const createdMs = parseIsoToMs(r.created_at);
      if (createdMs === null) return true;
      return (nowMs - createdMs) / 60_000 < DEFAULT_QUEUED_STALE_MINUTES;
    })
    .map((r) => r.id)
    .filter((id): id is number => typeof id === "number");

  let zombieCancelled = 0;
  if (token) {
    zombieCancelled = await cancelStaleQueuedRunsForFile(env, slowWorkflow, DEFAULT_QUEUED_STALE_MINUTES);
  }

  let dispatchProbeStatus: number | null = null;
  let dualDispatch: DualDispatchTelemetry | undefined;
  if (dispatchProbe && token) {
    const dual = await runDualWatchdog(env, { dispatch: true });
    dualDispatch = dual.telemetry;
    dispatchProbeStatus = dual.errors.length ? 500 : 200;
  } else if (token) {
    const dual = await runDualWatchdog(env, { dispatch: false });
    dualDispatch = dual.telemetry;
  }

  return {
    ok: Boolean(token) && githubListStatus === 200,
    service: "infouzel-articles-watchdog",
    github_token_present: Boolean(token),
    github_token_length: token.length,
    github_repository: env.GITHUB_REPOSITORY,
    workflow_file: slowWorkflow,
    freshness_url: slowFreshness,
    stale_after_minutes: slowStale,
    generated_at: generatedAtIso,
    generated_age_minutes: generatedAgeMin,
    github_list_runs_status: githubListStatus,
    github_list_runs_error: githubListError,
    github_dispatch_probe_status: dispatchProbeStatus,
    decision,
    decision_error: decisionError,
    blocking_run_ids: blockingRunIds,
    zombie_queued_cancelled: zombieCancelled,
    dual_dispatch: dualDispatch,
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "infouzel-articles-watchdog" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (url.pathname === "/probe") {
      try {
        const dispatchProbe = url.searchParams.get("dispatch") === "1";
        const probe = await buildProbe(env, dispatchProbe);
        return new Response(JSON.stringify(probe, null, 2), {
          status: probe.ok ? 200 : 503,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(JSON.stringify({ ok: false, error: msg }), {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
    }
    if (request.method === "POST" && url.pathname === "/run") {
      const secret = env.MANUAL_TRIGGER_SECRET;
      if (!secret) {
        return new Response("Not found", { status: 404 });
      }
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${secret}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      try {
        return await runWatchdog(env);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[watchdog] error", msg);
        return new Response(JSON.stringify({ ok: false, error: msg }), {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // P0-1: explicit start marker proves cron event delivery in Workers Logs.
    console.log(
      `[watchdog] scheduled fired cron=${event.cron} scheduledTime=${new Date(event.scheduledTime).toISOString()}`,
    );
    ctx.waitUntil(
      (async () => {
        try {
          const res = await runWatchdog(env);
          console.log("[watchdog] scheduled result", res.status, await res.clone().text());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[watchdog] scheduled error", msg);
        }
      })(),
    );
  },
};
