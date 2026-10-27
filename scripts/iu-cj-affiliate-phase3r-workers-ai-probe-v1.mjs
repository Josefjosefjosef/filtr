#!/usr/bin/env node
/**
 * Phase 3R — one-shot Workers AI health probe (no email bodies, no secrets printed).
 * Exit 0 even on FAIL so workflow can continue with deterministic fallback,
 * unless IU_CJ_WORKERS_AI_PROBE_STRICT=1.
 */
import { resolveWorkersAiConfig, WORKERS_AI_MODEL_CZECH_CANDIDATE } from "./iu-cj-affiliate-phase2-workers-ai-adapter.mjs";
import { AI_EVENT_JSON_SCHEMA, buildAiEventPrompt } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";
import { workersAiHttpClassifyEvent } from "./iu-cj-affiliate-phase2-workers-ai-adapter.mjs";

const env = process.env;
const config = resolveWorkersAiConfig(env);
const strict = env.IU_CJ_WORKERS_AI_PROBE_STRICT === "1";

const base = {
  schema: "iu-cj-affiliate-phase3r-workers-ai-probe-v1",
  model: config.model || WORKERS_AI_MODEL_CZECH_CANDIDATE,
  enabled: config.enabled === true,
  httpExecuteArmed: config.httpExecuteArmed === true,
  hasAccountId: Boolean(config.accountId),
  hasApiToken: Boolean(String(env.CLOUDFLARE_API_TOKEN || "").trim()),
  liveEnabled: false,
  publishArmed: false,
};

if (!config.enabled || !config.httpExecuteArmed || !config.accountId || !base.hasApiToken) {
  const out = {
    ...base,
    ok: false,
    probe: "SKIPPED_OR_BLOCKED",
    reason: !base.hasApiToken
      ? "missing_cloudflare_api_token"
      : !config.accountId
        ? "missing_account_id"
        : "workers_ai_not_armed",
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(strict ? 1 : 0);
}

const sample =
  "FROM: owner-membermessaging@mx6.cj.com\nSUBJECT: Program approval probe\nWelcome CID: 6466592 approved";

try {
  const res = await workersAiHttpClassifyEvent(sample, {
    env,
    jsonSchema: AI_EVENT_JSON_SCHEMA,
    promptBuilder: buildAiEventPrompt,
    quota: { callsUsed: 0 },
  });
  const out = {
    ...base,
    ok: res.ok === true,
    probe: res.ok ? "OK" : "FAIL",
    aiActuallyRan: res.aiActuallyRan === true || res.http === true,
    httpStatus: res.httpStatus || null,
    reason: res.reason || res.state || null,
    // Never echo model raw payload (may contain echoed probe text only — still omit).
  };
  console.log(JSON.stringify(out, null, 2));
  if (strict && !out.ok) process.exit(1);
  process.exit(0);
} catch (e) {
  const out = {
    ...base,
    ok: false,
    probe: "FAIL",
    reason: "exception",
    safe: String(e?.message || e).slice(0, 120),
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(strict ? 1 : 0);
}
