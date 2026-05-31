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
};

function toRunLite(run: GhRun) {
  return { status: run.status, event: run.event, created_at: run.created_at };
}

type FreshnessDoc = {
  generatedAt?: string;
};

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "infouzel-articles-watchdog",
  };
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
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=20&status=queued`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (!res.ok) return 0;
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
    if (cr.ok || cr.status === 409) cancelled += 1;
  }
  return cancelled;
}

async function dispatchWorkflow(env: Env): Promise<Response> {
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...ghHeaders(env.GITHUB_TOKEN),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (res.status !== 204) {
    const t = await res.text();
    throw new Error(`GitHub dispatch failed: ${res.status} ${t}`);
  }
  return new Response(JSON.stringify({ ok: true, dispatched: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function runWatchdog(env: Env): Promise<Response> {
  const staleAfter = Number.parseInt(env.STALE_AFTER_MINUTES || "10", 10);
  if (!Number.isFinite(staleAfter) || staleAfter < 1) {
    throw new Error("Invalid STALE_AFTER_MINUTES");
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
      JSON.stringify({ ok: true, action: "skip_fresh", decision }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
  if (decision.action === "skip_busy") {
    return new Response(
      JSON.stringify({ ok: true, action: "skip_busy", decision }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
  const cancelled = await cancelStaleQueuedRuns(env, DEFAULT_QUEUED_STALE_MINUTES);
  if (cancelled > 0) {
    console.log(`[watchdog] cancelled stale queued runs=${cancelled}`);
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
