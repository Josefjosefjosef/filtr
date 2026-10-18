/** Registry DB atomic execution — D1 batch or sqlite execTransaction only. */

export function registryDbCapabilities(db) {
  return {
    hasExecTransaction: typeof db?.execTransaction === "function",
    hasBatch: typeof db?.batch === "function",
  };
}

export function assertRegistryAtomicDb(db) {
  const cap = registryDbCapabilities(db);
  if (cap.hasExecTransaction || cap.hasBatch) return cap;
  const err = new Error("registry_atomic_unavailable");
  err.reason = "registry_atomic_unavailable";
  throw err;
}

/** Run work inside one atomic scope. D1: caller must commit writes via db.batch (all-or-nothing). */
export async function runRegistryAtomic(db, work) {
  const cap = assertRegistryAtomicDb(db);
  if (cap.hasExecTransaction) {
    return db.execTransaction(work);
  }
  return work(db);
}

/**
 * Execute prepared statements in one D1 batch. Throws if batch unsupported.
 * @returns {Promise<Array>} batch results
 */
export async function registryBatch(db, statements) {
  if (typeof db.batch !== "function") {
    const err = new Error("registry_batch_required");
    err.reason = "registry_batch_required";
    throw err;
  }
  if (!statements.length) return [];
  return db.batch(statements);
}

export function revisionConflictError() {
  const err = new Error("registry_revision_conflict");
  err.reason = "registry_revision_conflict";
  return err;
}
