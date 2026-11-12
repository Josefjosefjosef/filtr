/**
 * Cloudflare Worker: cron + optional manual /run (secret).
 * Dispatches cj-affiliate-catalog-sync.yml catch-up when catalog freshness is stale.
 * Does not write production data — GitHub workflow remains the engine.
 * Independent of GitHub Actions schedule undelivery (catalog + watch can both vanish).
 */
import {
  decideCjCatalogWatchdog,
  isCatchupDispatchRun,
  parseIsoToMs,
  type GhRunLike,
} from "./decision.ts";
import { readGeneratedAtFromResponse } from "./freshness.ts";

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPOSITORY: string;
  WORKFLOW_FILE: string;
  FRESHNESS_URL: string;
  STALE_AFTER_MINUTES: string;
  MAX_CATCHUPS_PER_UTC_DAY?: string;
  CATCHUP_COOLDOWN_MINUTES?: string;
  MANUAL_TRIGGER_SECRET?: string;
}

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "infouzel-cj-catalog-sync-watchdog",
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

function requireManualTriggerAuth(env: Env, request: Request): Response | null {
  const secret = (env.MANUAL_TRIGGER_SECRET || "").trim();
  if (!secret) return jsonResponse({ ok: false, error: "manual_trigger_disabled" }, 403);
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${secret}`) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  return null;
}

async function fetchGeneratedAt(env: Env): Promise<string | null> {
  const res = await fetch(env.FRESHNESS_URL, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    console.log(`[cj-catalog-sync-watchdog] freshness fetch failed: ${res.status}`);
    return null;
  }
  return readGeneratedAtFromResponse(res);
}

async function listRuns(env: Env): Promise<GhRunLike[]> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=30`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub list runs failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { workflow_runs?: GhRunLike[] };
  return data.workflow_runs ?? [];
}

async function fetchWorkflowState(env: Env): Promise<string | null> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (!res.ok) {
    console.log(`[cj-catalog-sync-watchdog] workflow state fetch failed: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { state?: string };
  return typeof data.state === "string" && data.state ? data.state : null;
}

/** Catch-up inputs — audit-honest (never invents event=schedule). */
export const CATCHUP_DISPATCH_INPUTS = {
  execute_live_fetch: "1",
  offers_mode: "refresh_priority",
  arm_publish: "0",
  promote_managed_public: "0",
  publish_managed_public_r2: "0",
  arm_offers_live: "0",
  promote_offers_public: "1",
  catchup_dispatch: "1",
} as const;

async function dispatchCatchup(
  env: Env,
): Promise<{ status: number; ok: boolean; workflowState?: string | null; reason?: string }> {
  assertGithubToken(env);
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(env.WORKFLOW_FILE);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...ghHeaders(env.GITHUB_TOKEN),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: CATCHUP_DISPATCH_INPUTS,
    }),
  });
  const bodyText = res.status === 204 ? "" : await res.text();
  console.log(`[cj-catalog-sync-watchdog] dispatch status=${res.status} body=${bodyText.slice(0, 200)}`);
  if (res.status === 204) return { status: res.status, ok: true };
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

export type RunCycleOpts = {
  force?: boolean;
  allowMutations?: boolean;
};

export async function runCycle(
  env: Env,
  opts: RunCycleOpts = {},
): Promise<Record<string, unknown>> {
  const allowMutations = opts.allowMutations !== false;
  const staleAfter = Math.max(1, Number(env.STALE_AFTER_MINUTES) || 240);
  const maxCatchups = Math.max(1, Number(env.MAX_CATCHUPS_PER_UTC_DAY) || 4);
  const cooldownMin = Math.max(1, Number(env.CATCHUP_COOLDOWN_MINUTES) || 60);
  const generatedAt = await fetchGeneratedAt(env);
  const runs = await listRuns(env);

  const decision = opts.force
    ? ({
        action: "dispatch" as const,
        reason: "stale" as const,
        ageMinutes: generatedAt
          ? (Date.now() - (parseIsoToMs(generatedAt) || Date.now())) / 60_000
          : null,
        staleAfterMinutes: staleAfter,
      })
    : decideCjCatalogWatchdog({
        generatedAt,
        nowMs: Date.now(),
        staleAfterMinutes: staleAfter,
        runs,
        maxCatchupsPerUtcDay: maxCatchups,
        catchupCooldownMinutes: cooldownMin,
      });

  let dispatch: {
    status: number;
    ok: boolean;
    workflowState?: string | null;
    reason?: string;
  } | null = null;
  if (decision.action === "dispatch" && allowMutations) {
    dispatch = await dispatchCatchup(env);
  }

  const catchupsToday = runs.filter((r) => {
    if (!isCatchupDispatchRun(r)) return false;
    const t = parseIsoToMs(r.created_at);
    if (t == null) return false;
    return new Date(t).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  }).length;

  const report = {
    service: "infouzel-cj-catalog-sync-watchdog",
    ok: decision.action !== "dispatch" || !allowMutations || !!(dispatch && dispatch.ok),
    observeOnly: !allowMutations,
    triggerAt: new Date().toISOString(),
    generatedAt,
    catchupsToday,
    decision,
    dispatch,
    workflowFile: env.WORKFLOW_FILE,
    freshnessUrl: env.FRESHNESS_URL,
    github_token_present: !!(env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim()),
    note: "Catch-up is workflow_dispatch only (CATCHUP_DISPATCH_NOT_SCHEDULE); never counted as schedule.",
  };
  console.log(`[cj-catalog-sync-watchdog] REPORT=${JSON.stringify(report)}`);
  if (allowMutations && decision.action === "dispatch" && dispatch && !dispatch.ok) {
    throw new Error(dispatch.reason || `dispatch_failed status=${dispatch.status}`);
  }
  return report;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runCycle(env).catch((err) => {
        console.log(
          `[cj-catalog-sync-watchdog] scheduled_error=${String(err && err.message ? err.message : err)}`,
        );
      }),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "infouzel-cj-catalog-sync-watchdog",
        github_token_present: !!(env.GITHUB_TOKEN && env.GITHUB_TOKEN.trim()),
        // Anonymous GET /probe is observe-only by design (SEC). Scheduled cron mutates.
        anonymousProbeObserveOnly: true,
        scheduledMutationsEnabled: true,
        staleAfterMinutes: Math.max(1, Number(env.STALE_AFTER_MINUTES) || 240),
      });
    }
    if (url.pathname === "/probe") {
      try {
        // dispatch=1 → force catch-up (ops). act=1 → mutate only if decide() says dispatch
        // (respects daycap/cooldown; used by GHA cron-fallback when CF cron missed).
        const doForce = url.searchParams.get("dispatch") === "1";
        const doAct = url.searchParams.get("act") === "1";
        if (doForce || doAct) {
          const denied = requireManualTriggerAuth(env, request);
          if (denied) return denied;
        }
        const report = await runCycle(env, {
          force: doForce,
          allowMutations: doForce || doAct,
        });
        return jsonResponse(report, report.ok ? 200 : 503);
      } catch (err) {
        return jsonResponse(
          {
            ok: false,
            error: String(err && (err as Error).message ? (err as Error).message : err),
          },
          503,
        );
      }
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const denied = requireManualTriggerAuth(env, request);
      if (denied) return denied;
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
