import { D1_WORKER_RPC_OPS } from "./ingest-rpc-ops.mjs";

/** RPC op names available only in local-test Worker entry (index.local-test.js). */
export const D1_WORKER_LOCAL_TEST_RPC_OPS = Object.freeze([
  "registryTestSetClaimGen",
  "registryTestDbSnapshot",
  "registryResetForTest",
]);

export const D1_WORKER_RPC_OPS_WITH_LOCAL_TEST = Object.freeze([
  ...D1_WORKER_RPC_OPS,
  ...D1_WORKER_LOCAL_TEST_RPC_OPS,
]);
