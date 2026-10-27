/** FORPSI IMAP provider parameters (official KB a3969 / a3992 — TLS 1.2+). */
export const FORPSI_IMAP_RULES_VERSION = "iu-cj-affiliate-phase2-forpsi-imap-v2";

/** Dedicated affiliate mailbox — not corporate info@ inbox. */
export const AFFILIATE_MAILBOX_ADDRESS = "affiliate@infouzel.cz";

export const FORPSI_IMAP_HOST = "imap.forpsi.com";

export const FORPSI_IMAP_TLS_MODES = Object.freeze({
  imaps_993: {
    id: "imaps_993",
    port: 993,
    tls: true,
    startTls: false,
    minTlsVersion: "TLSv1.2",
    rejectUnauthorized: true,
    docRef: "https://support.forpsi.com/kb/a3969/email-clients-settings.aspx",
  },
  starttls_143: {
    id: "starttls_143",
    port: 143,
    tls: false,
    startTls: true,
    minTlsVersion: "TLSv1.2",
    rejectUnauthorized: true,
    docRef: "https://support.forpsi.com/kb/a4178/imap-pridani-uctu.aspx",
  },
});

export const DEFAULT_FORPSI_IMAP_TLS_MODE = "imaps_993";

export const FORPSI_IMAP_DEFAULT_FOLDERS = Object.freeze(["INBOX"]);

export const FORPSI_IMAP_SYNC_DEFAULTS = Object.freeze({
  // Phase 3R: drain historical queue safely without ~20-day lag (was 15/day).
  batchSize: 80,
  maxBatchSize: 100,
  minBatchSize: 10,
  maxBatchesPerRun: 4,
  maxMessageBytes: 512 * 1024,
  maxAttachmentBytes: 256 * 1024,
  aiExcerptChars: 2_000,
  pollIntervalMsMin: 120_000,
  pollIntervalMsDefault: 300_000,
  retryMaxAttempts: 5,
  retryBaseDelayMs: 15_000,
});

/** Adapter-level read-only — blocked even if server would allow mutation. */
export const FORPSI_IMAP_FORBIDDEN_COMMANDS = Object.freeze([
  "APPEND",
  "CREATE",
  "DELETE",
  "RENAME",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
  "EXPUNGE",
  "UID EXPUNGE",
  "COPY",
  "UID COPY",
  "MOVE",
  "UID MOVE",
  "STORE",
  "UID STORE",
]);

export const FORPSI_IMAP_ALLOWED_COMMAND_PREFIXES = Object.freeze([
  "CAPABILITY",
  "NOOP",
  "LOGOUT",
  "LOGIN",
  "AUTHENTICATE",
  "LIST",
  "LSUB",
  "STATUS",
  "SELECT",
  "EXAMINE",
  "SEARCH",
  "UID SEARCH",
  "FETCH",
  "UID FETCH",
]);
