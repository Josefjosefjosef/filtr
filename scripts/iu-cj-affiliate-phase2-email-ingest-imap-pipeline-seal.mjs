/** IMAP pipeline attestation verify helpers (v21 — no offline production sealing). */
export const IMAP_PIPELINE_ATTESTATION_SOURCE_V20 = "iu_cj_imap_adapter_pipeline_attestation_v20";
export const COMMERCIAL_ACTION_DEDUP_IMAP_PIPELINE_ATTESTATION_V20 = IMAP_PIPELINE_ATTESTATION_SOURCE_V20;
export const IMAP_PIPELINE_SESSION_REF_PREFIX_HARNESS = "iu_cj_offline_harness_imap_session_v20:";

export function buildImapPipelineAttestationDigestInput(record, adapterSessionRef) {
  return JSON.stringify({
    v: 20,
    source: IMAP_PIPELINE_ATTESTATION_SOURCE_V20,
    adapterSessionRef: String(adapterSessionRef || ""),
    mailboxKeyId: record.mailboxKeyId ?? null,
    mailbox: record.mailbox ?? null,
    folder: record.folder ?? null,
    uid: record.uid ?? null,
    uidvalidity: record.uidvalidity ?? null,
    actionIndex: record.actionIndex ?? null,
    blockFingerprint: record.blockFingerprint ?? null,
    commercialActionKey: record.commercialActionKey ?? null,
  });
}

/** Offline library cannot validate future adapter attestations — fail closed. */
export function verifyImapPipelineAttestationOnRecord() {
  return { ok: false, reason: "blocked_awaiting_trusted_imap_adapter" };
}
