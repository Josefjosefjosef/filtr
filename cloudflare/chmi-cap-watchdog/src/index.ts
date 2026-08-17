/**
 * Cloudflare Worker: cron + optional manual /run (secret).
 * Dispatches update-chmi-cap-v2.yml when production feed.json is stale.
 * Does not write production data directly — GitHub workflow remains the engine.
 */
import { decideWatchdog, parseIsoToMs } from "./decision";

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPOSITORY: string;
  WORKFLOW_FILE: string;
  FRESHNESS_URL: string;
  STALE_AFTER_MINUTES: string;
  MANUAL_TRIGGER_SECRET?: string;
}

type GhRun = {
  status: string;
  conclusion: string | null;
  created_at: string;
  id?: number;
};

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "infouzel-chmi-cap-watchdog",
  };
}

function assertGithubToken(env: Env): void {
  const token = (env.GITHUB_TOKEN || "").trim();
  if (!token) {
    throw new Error("GITHUB_TOKEN secret missing on worker (wrangler secret put GITHUB_TOKEN)");
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function fetchFreshnessSnapshot(url: string): Promise<{
  generatedAt: string | null;
  chmiCount: number | null;
  activeCount: number | null;
  futureCount: number | null;
}> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    console.log(`[chmi-cap-watchdog] freshness fetch failed: ${res.status}`);
    return { generatedAt: null, chmiCount: null, activeCount: null, futureCount: null };
  }
  const json = (await res.json()) as {
    generatedAt?: string;
    items?: Array<{ sourceId?: string; status?: string }>;
  };
  const generatedAt = typeof json.generatedAt === "string" && json.generatedAt ? json.generatedAt : null;
  const chmi = (json.items || []).filter((i) => i && i.sourceId === "chmi");
  const activeCount = chmi.filter((i) => i.status === "aktivni").length;
  const futureCount = chmi.filter((i) => i.status === "naplanovano").length;
  return { generatedAt, chmiCount: chmi.length, activeCount, futureCount };
}

async function listRuns(env: Env): Promise<GhRun[]> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=15`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub list runs failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { workflow_runs?: GhRun[] };
  return data.workflow_runs ?? [];
}

async function fetchWorkflowState(env: Env): Promise<string | null> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (!res.ok) {
    console.log(`[chmi-cap-watchdog] workflow state fetch failed: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { state?: string };
  return typeof data.state === "string" && data.state ? data.state : null;
}

async function dispatchWorkflow(
  env: Env
): Promise<{ status: number; ok: boolean; workflowState?: string | null; reason?: string }> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
  // Never log token. Body is only ref=main.
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...ghHeaders(env.GITHUB_TOKEN),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { mode: "active" },
    }),
  });
  const bodyText = res.status === 204 ? "" : await res.text();
  console.log(`[chmi-cap-watchdog] dispatch status=${res.status} body=${bodyText.slice(0, 200)}`);
  if (res.status === 204) return { status: res.status, ok: true };
  // 422 commonly means the workflow is disabled_manually (schedule+dispatch both dead).
  let workflowState: string | null = null;
  let reason = `dispatch_failed status=${res.status}`;
  if (res.status === 422) {
    workflowState = await fetchWorkflowState(env);
    if (workflowState && workflowState !== "active") {
      reason = `workflow_disabled state=${workflowState}`;
    }
  }
  return { status: res.status, ok: false, workflowState, reason };
}

async function cancelStaleQueued(env: Env, staleMin: number): Promise<number> {
  assertGithubToken(env);
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
    if (createdMs == null || !run.id) continue;
    const ageMin = (nowMs - createdMs) / 60_000;
    if (ageMin < staleMin) continue;
    const cancelUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/cancel`;
    const cr = await fetch(cancelUrl, { method: "POST", headers: ghHeaders(env.GITHUB_TOKEN) });
    console.log(`[chmi-cap-watchdog] cancel queued run_id=${run.id} age_min=${ageMin.toFixed(0)} status=${cr.status}`);
    if (cr.ok || cr.status === 409) cancelled += 1;
  }
  return cancelled;
}

async function runCycle(env: Env, opts: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  const staleAfter = Math.max(1, Number(env.STALE_AFTER_MINUTES) || 8);
  const snap = await fetchFreshnessSnapshot(env.FRESHNESS_URL);
  const generatedAt = snap.generatedAt;
  const runs = await listRuns(env);
  await cancelStaleQueued(env, Math.max(staleAfter, 20));

  const decision = opts.force
    ? ({
        action: "dispatch",
        reason: "stale",
        ageMinutes: generatedAt ? (Date.now() - (parseIsoToMs(generatedAt) || Date.now())) / 60000 : null,
        staleAfterMinutes: staleAfter,
      } as const)
    : decideWatchdog({
        generatedAt,
        nowMs: Date.now(),
        staleAfterMinutes: staleAfter,
        runs,
      });

  let dispatch: {
    status: number;
    ok: boolean;
    workflowState?: string | null;
    reason?: string;
  } | null = null;
  if (decision.action === "dispatch") {
    dispatch = await dispatchWorkflow(env);
  }

  const report = {
    service: "infouzel-chmi-cap-watchdog",
    ok: decision.action !== "dispatch" || !!(dispatch && dispatch.ok),
    triggerAt: new Date().toISOString(),
    generatedAt,
    production: {
      chmiCount: snap.chmiCount,
      activeCount: snap.activeCount,
      futureCount: snap.futureCount,
    },
    decision,
    dispatch,
    workflowFile: env.WORKFLOW_FILE,
    freshnessUrl: env.FRESHNESS_URL,
    github_token_present: !!(env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim()),
    // Never include token value.
  };
  console.log(`[chmi-cap-watchdog] REPORT=${JSON.stringify(report)}`);
  if (decision.action === "dispatch" && dispatch && !dispatch.ok) {
    throw new Error(dispatch.reason || `dispatch_failed status=${dispatch.status}`);
  }
  return report;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runCycle(env).catch((err) => {
        console.log(`[chmi-cap-watchdog] scheduled_error=${String(err && err.message ? err.message : err)}`);
      })
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "infouzel-chmi-cap-watchdog",
        github_token_present: !!(env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim()),
      });
    }
    if (url.pathname === "/probe") {
      try {
        const doDispatch = url.searchParams.get("dispatch") === "1";
        const report = await runCycle(env, { force: doDispatch });
        return jsonResponse(report, report.ok ? 200 : 503);
      } catch (err) {
        return jsonResponse(
          {
            ok: false,
            error: String(err && (err as Error).message ? (err as Error).message : err),
          },
          503
        );
      }
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const secret = (env.MANUAL_TRIGGER_SECRET || "").trim();
      if (!secret) return jsonResponse({ ok: false, error: "manual_trigger_disabled" }, 403);
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${secret}`) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      try {
        const report = await runCycle(env, { force: true });
        return jsonResponse(report, report.ok ? 200 : 503);
      } catch (err) {
        return jsonResponse({ ok: false, error: String((err as Error).message || err) }, 503);
      }
    }
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  },
};
