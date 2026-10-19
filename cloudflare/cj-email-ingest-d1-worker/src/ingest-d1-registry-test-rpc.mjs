/** Local-only registry test RPC — never imported from production index.js */

export function createRegistryTestRpcHandlers(db, options = {}) {
  const allow = options.allowRegistryTestHooks === true;
  return {
    async registryTestSetClaimGen(args) {
      if (!allow) return { ok: false, reason: "registry_test_set_gen_denied" };
      if (!args?.source || !args?.sourceRecordId || args?.confirmedGen == null) {
        return { ok: false, reason: "registry_test_set_gen_invalid" };
      }
      await db
        .prepare(
          "UPDATE central_offer_source_claims SET confirmed_gen = ? WHERE source = ? AND source_record_id = ? LIMIT 1"
        )
        .bind(Math.trunc(Number(args.confirmedGen)), String(args.source), String(args.sourceRecordId))
        .run();
      return { ok: true };
    },

    async registryTestDbSnapshot() {
      if (!allow) return { ok: false, reason: "registry_test_snapshot_denied" };
      const offers = await db
        .prepare(
          "SELECT offer_id, revision, conflict_state, publishability_state, block_reason, canonical_json FROM central_offers ORDER BY offer_id"
        )
        .all();
      const claims = await db
        .prepare(
          "SELECT source, source_record_id, offer_id, confirmed_gen, claim_accept, confirmed_rev_num, confirmed_rev_schema, legacy_rev_unverified FROM central_offer_source_claims ORDER BY source, source_record_id"
        )
        .all();
      const deliveries = await db
        .prepare(
          "SELECT delivery_outcome, reject_reason, COUNT(*) AS c FROM central_offer_claim_deliveries GROUP BY delivery_outcome, reject_reason"
        )
        .all();
      const events = await db.prepare("SELECT COUNT(*) AS c FROM central_registry_events").bind().first();
      const canon = (offers?.results ?? []).map((o) => {
        let validTo = null;
        try {
          validTo = JSON.parse(o.canonical_json || "{}")?.canonical?.validTo ?? null;
        } catch {
          validTo = null;
        }
        return {
          offer_id: o.offer_id,
          revision: o.revision,
          conflict_state: o.conflict_state,
          publishability_state: o.publishability_state,
          block_reason: o.block_reason,
          canonical_validTo: validTo,
        };
      });
      return {
        ok: true,
        offers: canon,
        claims: claims?.results ?? [],
        deliverySummary: deliveries?.results ?? [],
        eventCount: Number(events?.c ?? 0),
        runtime: "cloudflare_d1_binding",
      };
    },

    async registryResetForTest() {
      if (!allow) return { ok: false, reason: "registry_test_reset_denied" };
      const stmts = [
        db.prepare("DELETE FROM central_offer_conflict_log").bind(),
        db.prepare("DELETE FROM central_offer_claim_deliveries").bind(),
        db.prepare("DELETE FROM central_offer_source_claims").bind(),
        db.prepare("DELETE FROM central_registry_events").bind(),
        db.prepare("DELETE FROM central_offers").bind(),
      ];
      await db.batch(stmts);
      return { ok: true };
    },
  };
}
