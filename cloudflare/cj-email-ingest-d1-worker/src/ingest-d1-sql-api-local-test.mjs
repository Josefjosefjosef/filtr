/** Local Wrangler dev: production ingest API + isolated test RPC handlers. */
import { createD1SqlIngestApi } from "./ingest-d1-sql-api.mjs";
import { createRegistryTestRpcHandlers } from "./ingest-d1-registry-test-rpc.mjs";

export async function createD1SqlIngestApiForLocalTest(db, options = {}) {
  const base = await createD1SqlIngestApi(db, {
    ...options,
    allowRegistryTestHooks: options.allowRegistryTestHooks === true,
  });
  const testRpc = createRegistryTestRpcHandlers(db, {
    allowRegistryTestHooks: options.allowRegistryTestHooks === true,
  });
  return { ...base, ...testRpc };
}
