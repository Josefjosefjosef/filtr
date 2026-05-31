/**
 * Cloudflare Worker: cron + optional manual /run (secret).
 * Triggers GitHub workflow_dispatch only when public data is stale and pipeline is idle.
 */
import { decideWatchdog, DEFAULT_QUEUED_STALE_MINUTES, parseIsoToMs } from "./decision";

export interface Env {
  GITHUB_TOKEN: string;
  /** e.g. Josefjosefjosef/filtr */
  GITHUB_REPOSITORY: string;
  /** e.g. update-articles.yml */
  WORKFLOW_FILE: string;
  /** Public JSON with generatedAt (articles index) */
  FRESHNESS_URL: string;
  /** Minutes; default 15 in wrangler.toml */
  STALE_AFTER_MINUTES: string;
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

function toRunLite(run: GhRun) {
  return { status: run.status, event: run.event, created_at: run.created_at };
}

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

async function fetchGeneratedAt(env: Env): Promise<string | null> {
  const res = await fetch(env.FRESHNESS_URL, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    console.log(`[watchdog] freshness fetch failed: ${res.status}`);
    return null;
  }
  const json = (await res.json()) as FreshnessDoc;
  const g = json.generatedAt;
  return typeof g === "string" && g.length > 0 ? g : null;
}

async function fetchWorkflowRuns(env: Env): Promise<GhRun[]> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  if (!owner || !repo) throw new Error("Invalid GITHUB_REPOSITORY");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=15`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub list runs failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { workflow_runs?: GhRun[] };
  return data.workflow_runs ?? [];
}

async function cancelStaleQueuedRuns(env: Env, queuedStaleMinutes: number): Promise<number> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=20&status=queued`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (!res.ok) {
    console.log(`[watchdog] list queued runs failed: ${res.status}`);
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
    console.log(`[watchdog] cancel queued run_id=${run.id} age_min=${ageMin.toFixed(0)} status=${cr.status}`);
    if (cr.ok || cr.status === 409) cancelled += 1;
  }
  return cancelled;
}

async function dispatchWorkflow(env: Env): Promise<Response> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
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
  console.log(`[watchdog] dispatch status=${res.status} body=${bodyText.slice(0, 300)}`);
  if (res.status !== 204) {
    throw new Error(`GitHub dispatch failed: ${res.status} ${bodyText}`);
  }
  return new Response(JSON.stringify({ ok: true, dispatched: true, status: res.status }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function buildProbe(env: Env, dispatchProbe = false): Promise<ProbeResult> {
  const token = (env.GITHUB_TOKEN || "").trim();
  const staleAfter = Number.parseInt(env.STALE_AFTER_MINUTES || "15", 10);
  const nowMs = Date.now();
  const generatedAtIso = await fetchGeneratedAt(env);
  const generatedMs = parseIsoToMs(generatedAtIso ?? undefined);
  const generatedAgeMin = generatedMs !== null ? (nowMs - generatedMs) / 60_000 : null;

  let githubListStatus: number | null = null;
  let githubListError: string | null = null;
  let runs: GhRun[] = [];
  if (token) {
    try {
      runs = await fetchWorkflowRuns(env);
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

  let decision: ReturnType<typeof decideWatchdog> | null = null;
  let decisionError: string | null = null;
  try {
    decision = decideWatchdog({
      generatedAtIso,
      staleAfterMinutes: staleAfter,
      nowMs,
      runs: runs.map(toRunLite),
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
    zombieCancelled = await cancelStaleQueuedRuns(env, DEFAULT_QUEUED_STALE_MINUTES);
  }

  let dispatchProbeStatus: number | null = null;
  if (dispatchProbe && token && decision?.action === "dispatch") {
    try {
      const res = await dispatchWorkflow(env);
      dispatchProbeStatus = res.status;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = msg.match(/failed: (\d{3})/);
      dispatchProbeStatus = m ? Number(m[1]) : 500;
    }
  }

  return {
    ok: Boolean(token) && githubListStatus === 200,
    service: "infouzel-articles-watchdog",
    github_token_present: Boolean(token),
    github_token_length: token.length,
    github_repository: env.GITHUB_REPOSITORY,
    workflow_file: env.WORKFLOW_FILE,
    freshness_url: env.FRESHNESS_URL,
    stale_after_minutes: staleAfter,
    generated_at: generatedAtIso,
    generated_age_minutes: generatedAgeMin,
    github_list_runs_status: githubListStatus,
    github_list_runs_error: githubListError,
    github_dispatch_probe_status: dispatchProbeStatus,
    decision,
    decision_error: decisionError,
    blocking_run_ids: blockingRunIds,
    zombie_queued_cancelled: zombieCancelled,
  };
}

export async function runWatchdog(env: Env): Promise<Response> {
  const staleAfter = Number.parseInt(env.STALE_AFTER_MINUTES || "15", 10);
  if (!Number.isFinite(staleAfter) || staleAfter < 1) {
    throw new Error("Invalid STALE_AFTER_MINUTES");
  }

  const zombieCancelled = await cancelStaleQueuedRuns(env, DEFAULT_QUEUED_STALE_MINUTES);
  if (zombieCancelled > 0) {
    console.log(`[watchdog] preflight cancelled stale queued runs=${zombieCancelled}`);
  }

  const nowMs = Date.now();
  const generatedAtIso = await fetchGeneratedAt(env);
  const runs = await fetchWorkflowRuns(env);

  const decision = decideWatchdog({
    generatedAtIso,
    staleAfterMinutes: staleAfter,
    nowMs,
    runs: runs.map(toRunLite),
  });

  console.log("[watchdog] decision", JSON.stringify(decision));

  if (decision.action === "skip_fresh") {
    return new Response(
      JSON.stringify({ ok: true, action: "skip_fresh", decision, zombie_queued_cancelled: zombieCancelled }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
  if (decision.action === "skip_busy") {
    return new Response(
      JSON.stringify({ ok: true, action: "skip_busy", decision, zombie_queued_cancelled: zombieCancelled }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
  return dispatchWorkflow(env);
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

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const res = await runWatchdog(env);
          console.log("[watchdog] scheduled result", res.status, await res.clone().text());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[watchdog] scheduled error", msg);
        }
      })()
    );
  },
};
