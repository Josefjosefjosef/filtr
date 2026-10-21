/**
 * CJ affiliate email ingest D1 RPC Worker — production path uses env.DB only.
 */
import { handleIngestRpcHttpRequest } from "./ingest-rpc-service.mjs";
import { createD1SqlIngestApi } from "./ingest-d1-sql-api.mjs";
import {
  buildHealthPayload,
  handleStagingSyntheticRequest,
  stagingSyntheticEnabled,
} from "./staging-synthetic-routes.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify(buildHealthPayload(env)), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    if (url.pathname.startsWith("/v1/staging/") && stagingSyntheticEnabled(env)) {
      return handleStagingSyntheticRequest(request, env);
    }
    if (!env.DB) {
      return new Response(JSON.stringify({ ok: false, reason: "d1_binding_missing", rpcVersion: 1 }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (env.ingestApi) {
      return handleIngestRpcHttpRequest(request, {
        IU_CJ_D1_WORKER_INGEST_TOKEN: env.IU_CJ_D1_WORKER_INGEST_TOKEN,
        ingestApi: env.ingestApi,
      });
    }
    const ingestApi = await createD1SqlIngestApi(env.DB, {
      allowRegistryTestHooks: false,
    });
    return handleIngestRpcHttpRequest(request, {
      IU_CJ_D1_WORKER_INGEST_TOKEN: env.IU_CJ_D1_WORKER_INGEST_TOKEN,
      ingestApi,
    });
  },
};
