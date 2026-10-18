/** Parameterized SQL fragments for atomic finalize (D1 batch). */

export const FINALIZE_SQL = Object.freeze({

  contentWhere: `(raw_snapshot_json IS NOT NULL AND TRIM(raw_snapshot_json) != '' AND TRIM(raw_snapshot_json) != 'null'

    AND results_summary_json IS NOT NULL AND TRIM(results_summary_json) != ''

    AND (results_summary_json LIKE '%"v15Blockers"%' OR results_summary_json LIKE '%"stagingState"%')

    AND results_summary_json NOT LIKE '%"aiState":"pending"%'

    AND results_summary_json NOT LIKE '%"aiState":"invalid_ai_json"%')`,

  contentWhereM: `(m.raw_snapshot_json IS NOT NULL AND TRIM(m.raw_snapshot_json) != '' AND TRIM(m.raw_snapshot_json) != 'null'

    AND m.results_summary_json IS NOT NULL AND TRIM(m.results_summary_json) != ''

    AND (m.results_summary_json LIKE '%"v15Blockers"%' OR m.results_summary_json LIKE '%"stagingState"%')

    AND m.results_summary_json NOT LIKE '%"aiState":"pending"%'

    AND m.results_summary_json NOT LIKE '%"aiState":"invalid_ai_json"%')`,

  leaseGate: `EXISTS (

      SELECT 1 FROM ingest_leases

      WHERE lease_id = ? AND holder_run_id = ? AND expires_at >= ?

    )`,

});



export function buildFinalizeBatchStatements(db, params) {

  const {

    ts,

    key,

    mailbox,

    uidvalidity,

    uid,

    folder,

    globalLeaseId,

    runId,

    nowIsoLease,

  } = params;

  const { contentWhere, contentWhereM, leaseGate } = FINALIZE_SQL;

  const updateStmt = db

    .prepare(

      `UPDATE message_lifecycle SET stage = 'completed', publishable = 0, completed_at = ?, updated_at = ?

       WHERE msg_key = ? AND stage = 'v15_done' AND fail_reason IS NULL

       AND mailbox = ? AND uidvalidity = ? AND uid = ?

       AND ${contentWhere}

       AND ${leaseGate}`

    )

    .bind(

      ts,

      ts,

      key,

      mailbox,

      uidvalidity,

      uid,

      globalLeaseId,

      runId,

      nowIsoLease

    );

  const insertStmt = db

    .prepare(

      `INSERT INTO completed_uids (mailbox, folder, uidvalidity, uid, completed_at)

       SELECT m.mailbox, ?, m.uidvalidity, m.uid, ?

       FROM message_lifecycle m

       WHERE m.msg_key = ? AND m.stage = 'completed' AND m.fail_reason IS NULL

       AND m.mailbox = ? AND m.uidvalidity = ? AND m.uid = ?

       AND ${contentWhereM}

       AND ${leaseGate}

       AND NOT EXISTS (

         SELECT 1 FROM completed_uids c

         WHERE c.mailbox = m.mailbox AND c.folder = ? AND c.uidvalidity = m.uidvalidity AND c.uid = m.uid

       )`

    )

    .bind(

      folder,

      ts,

      key,

      mailbox,

      uidvalidity,

      uid,

      globalLeaseId,

      runId,

      nowIsoLease,

      folder

    );

  return [updateStmt, insertStmt];

}

