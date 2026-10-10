/** Storno / credit-note PDF enqueue (delegates to premium-order-documents). */
import { ensurePremiumStornoDocuments } from "./premium-order-documents";
import type { Env } from "./types";

export async function enqueuePremiumStornoDocuments(
  env: Env,
  orderId: string,
  actorUserId: string,
  opts: { stornoKind: "rejection" | "cancellation"; forceRetryIncomplete?: boolean }
): Promise<{ ok: boolean; results: Record<string, unknown> }> {
  void opts.stornoKind;
  return ensurePremiumStornoDocuments(env, orderId, actorUserId, {
    forceRetryIncomplete: opts.forceRetryIncomplete,
  });
}
