/**
 * Phase 2H — publish validated managed-public JSON to Cloudflare R2 via
 * existing iu-site-redirects worker endpoint (no git merge to main).
 *
 * Default DISARMED: IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_ARMED != 1 → dry-run only.
 * Never prints tokens. Never writes assets/ / workflows / slot policy.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { validateManagedPublicPayload } from "./iu-cj-affiliate-catalog-sync-promote-managed-public-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_REL = "projects/data/iu-affiliate-cj-managed-public-v1.json";
const DEFAULT_PUBLISH_PATH =
  "/projects/data/iu-affiliate-cj-managed-public/__iu_live_publish";

export function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function buildPublishEnvelope(document, opts = {}) {
  const body = typeof document === "string" ? document : JSON.stringify(document);
  const parsed = typeof document === "string" ? JSON.parse(document) : document;
  const contentSha256 = opts.contentSha256 || sha256Hex(body);
  return {
    meta: {
      generationId: opts.generationId || new Date().toISOString(),
      publishedAt: opts.publishedAt || new Date().toISOString(),
      contentSha256,
      source: opts.source || "cj-catalog-sync-r2-publish-v1",
    },
    document: parsed,
  };
}

/**
 * In-memory mock of the Worker R2 publish+serve surface for fixture E2E.
 * Proves: validated JSON → store → public GET without any git merge.
 */
export function createMemoryCjManagedPublicEndpoint(opts = {}) {
  const token = opts.token || "fixture-token";
  const state = {
    current: null,
    lkg: null,
    meta: null,
    publishes: 0,
  };

  function validate(doc) {
    return validateManagedPublicPayload(doc, { websitePid: opts.websitePid });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const json = (obj, status = 200) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(obj));
    };

    if (url.pathname === DEFAULT_PUBLISH_PATH && req.method === "POST") {
      const auth = req.headers.authorization || "";
      if (auth !== "Bearer " + token) return json({ ok: false, reason: "UNAUTHORIZED" }, 401);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return json({ ok: false, reason: "INVALID_JSON" }, 400);
      }
      const v = validate(payload.document);
      if (!v.ok) return json({ ok: false, reason: "VALIDATION_FAILED", errors: v.errors }, 400);
      if (state.meta && payload.meta && state.meta.contentSha256 === payload.meta.contentSha256) {
        return json({
          ok: true,
          reason: "UNCHANGED_CONTENT_PUBLICATION_SKIPPED",
          generationId: state.meta.generationId,
        });
      }
      if (state.current) state.lkg = state.current;
      state.current = payload.document;
      state.meta = payload.meta || {};
      state.publishes += 1;
      return json({
        ok: true,
        reason: "PUBLISHED",
        ATOMIC_PUBLICATION_PASS: "YES",
        NO_GIT_MERGE_REQUIRED: "YES",
        generationId: state.meta.generationId,
        partnerCount: v.counts.partners,
        activeCount: v.counts.active,
      });
    }

    if (
      url.pathname === "/projects/data/iu-affiliate-cj-managed-public-v1.json" &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      if (!state.current) {
        res.writeHead(404, { "cache-control": "no-store" });
        res.end("missing");
        return;
      }
      const body = JSON.stringify(state.current);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-iu-cj-managed-public-source": "memory-fixture",
      });
      if (req.method === "HEAD") return res.end();
      return res.end(body);
    }

    if (url.pathname === "/__rollback" && req.method === "POST") {
      if (!state.lkg) return json({ ok: false, reason: "LKG_MISSING" }, 404);
      state.current = state.lkg;
      return json({ ok: true, reason: "ROLLED_BACK_TO_LKG" });
    }

    res.writeHead(404);
    res.end("not found");
  });

  return {
    state,
    token,
    publishPath: DEFAULT_PUBLISH_PATH,
    publicPath: "/projects/data/iu-affiliate-cj-managed-public-v1.json",
    listen(port = 0) {
      return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          resolve({ port: addr.port, base: "http://127.0.0.1:" + addr.port });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

export async function publishManagedPublicToR2(opts = {}) {
  const env = opts.env || process.env;
  const armed = env.IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_ARMED === "1";
  const endpoint = String(opts.endpoint || env.IU_CJ_MANAGED_PUBLIC_PUBLISH_URL || "").trim();
  const token = String(opts.token || env.IU_CJ_MANAGED_PUBLIC_PUBLISH_TOKEN || "");
  const sourcePath =
    opts.sourcePath || path.join(ROOT, PUBLIC_REL);

  if (!fs.existsSync(sourcePath) && !opts.document) {
    return { ok: false, reason: "SOURCE_MISSING", armed };
  }
  const document =
    opts.document || JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const validation = validateManagedPublicPayload(document, {
    websitePid: opts.websitePid || env.IU_CJ_WEBSITE_PID,
  });
  if (!validation.ok) {
    return { ok: false, reason: "VALIDATION_FAILED", errors: validation.errors, armed };
  }

  const envelope = buildPublishEnvelope(document, {
    generationId: opts.generationId,
    contentSha256: opts.contentSha256,
    source: opts.source,
  });

  if (!armed) {
    return {
      ok: true,
      reason: "DRY_RUN_DISARMED",
      armed: false,
      NO_GIT_MERGE_REQUIRED: "YES",
      wouldPublishBytes: JSON.stringify(envelope.document).length,
      counts: validation.counts,
      endpointConfigured: Boolean(endpoint),
      tokenConfigured: Boolean(token),
    };
  }

  if (!endpoint) return { ok: false, reason: "ENDPOINT_MISSING", armed: true };
  if (!token) return { ok: false, reason: "TOKEN_MISSING", armed: true };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "x-iu-cj-content-sha256": envelope.meta.contentSha256,
    },
    body: JSON.stringify(envelope),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, reason: "NON_JSON_RESPONSE", status: res.status };
  }
  return {
    ok: res.ok && body && body.ok === true,
    status: res.status,
    armed: true,
    NO_GIT_MERGE_REQUIRED: "YES",
    response: body,
  };
}

async function main() {
  const result = await publishManagedPublicToR2();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && result.reason !== "DRY_RUN_DISARMED") process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  });
}
