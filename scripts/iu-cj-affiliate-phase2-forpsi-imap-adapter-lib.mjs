/** FORPSI read-only IMAP adapter (mock + gated live TLS). No secrets in source. */
import tls from "node:tls";
import net from "node:net";
import { createHash } from "node:crypto";
import {
  AFFILIATE_MAILBOX_ADDRESS,
  DEFAULT_FORPSI_IMAP_TLS_MODE,
  FORPSI_IMAP_ALLOWED_COMMAND_PREFIXES,
  FORPSI_IMAP_FORBIDDEN_COMMANDS,
  FORPSI_IMAP_HOST,
  FORPSI_IMAP_TLS_MODES,
} from "./iu-cj-affiliate-phase2-forpsi-imap-config.mjs";
import {
  assertForpsiImapLiveConnectAllowed,
  readForpsiImapCredentialSourceMeta,
} from "./iu-forpsi-imap-credentials-interface.mjs";
import { parseRawMimeMessage } from "./iu-cj-affiliate-phase2-forpsi-mime-lib.mjs";
import { ImapByteBuffer, readTaggedFetchWithLiteral } from "./iu-cj-affiliate-phase2-forpsi-imap-protocol.mjs";

let imapTagCounter = 0;

function nextImapTag() {
  imapTagCounter += 1;
  return "IU" + String(imapTagCounter);
}

export function assertReadOnlyImapCommand(commandLine) {
  const upper = String(commandLine || "").trim().toUpperCase();
  for (const forbidden of FORPSI_IMAP_FORBIDDEN_COMMANDS) {
    if (upper.startsWith(forbidden)) {
      return { ok: false, reason: "read_only_command_blocked", command: upper.split(/\s+/)[0] };
    }
  }
  const allowed = FORPSI_IMAP_ALLOWED_COMMAND_PREFIXES.some((p) => upper.startsWith(p));
  if (!allowed) {
    return { ok: false, reason: "command_not_in_read_only_allowlist", command: upper.split(/\s+/)[0] || upper };
  }
  return { ok: true, reason: null };
}

export function stripHtmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeFetchedMessage(raw) {
  if (raw.rawRfc822) {
    const parsed = parseRawMimeMessage(raw.rawRfc822);
    raw = {
      ...raw,
      subject: raw.subject || parsed.subject,
      from: raw.from || parsed.from,
      to: raw.to || parsed.to,
      messageIdHeader: raw.messageIdHeader || parsed.messageId,
      bodyText: parsed.ok === false ? raw.bodyText || "" : parsed.bodyText || raw.bodyText || "",
      bodyHtml: parsed.ok === false ? raw.bodyHtml || "" : parsed.bodyHtml || raw.bodyHtml || "",
      attachmentNames: parsed.attachmentNames,
      attachmentBytesTotal: parsed.attachmentBytesTotal,
      mimeWarnings: parsed.warnings,
      mimeParseOk: parsed.ok,
      mimeRejectReason: parsed.rejectReason || null,
    };
  }
  const size = Buffer.byteLength(String(raw.bodyText || "") + String(raw.bodyHtmlStripped || raw.bodyHtml || ""), "utf8");
  return {
    mailbox: raw.mailbox || AFFILIATE_MAILBOX_ADDRESS,
    folder: raw.folder || "INBOX",
    uid: raw.uid,
    uidvalidity: raw.uidvalidity,
    messageIdHeader: raw.messageIdHeader || null,
    subject: String(raw.subject || "").slice(0, 500),
    from: String(raw.from || "").slice(0, 320),
    to: String(raw.to || "").slice(0, 320),
    dateHeader: raw.dateHeader || null,
    bodyText: String(raw.bodyText || "").slice(0, 200_000),
    bodyHtmlStripped: stripHtmlToText(raw.bodyHtml || raw.bodyHtmlStripped || ""),
    sizeBytes: size,
    attachmentNames: Array.isArray(raw.attachmentNames) ? raw.attachmentNames.map(String) : [],
    attachmentBytesTotal: Number(raw.attachmentBytesTotal || 0),
    fetchMethod: raw.fetchMethod || "BODY.PEEK",
    serverMutationsPerformed: false,
  };
}

export function buildAdapterSessionRef({ mailbox, folder, uidvalidity, adapterRunId }) {
  const digest = createHash("sha256")
    .update(JSON.stringify({ mailbox, folder, uidvalidity, adapterRunId, v: 1 }))
    .digest("hex")
    .slice(0, 24);
  return "iu_cj_forpsi_imap_session_v1:" + digest;
}

/** Minimal line protocol client — live only when connect approved. */
export class ForpsiImapTlsSession {
  constructor(options = {}) {
    this.host = options.host || FORPSI_IMAP_HOST;
    this.tlsMode = FORPSI_IMAP_TLS_MODES[options.tlsModeId || DEFAULT_FORPSI_IMAP_TLS_MODE];
    this.socket = null;
    this.byteBuffer = new ImapByteBuffer();
    this.greeting = null;
    this.authenticated = false;
    this.selectedFolder = null;
    this.commandsSent = [];
  }

  async connectAndLogin() {
    const gate = assertForpsiImapLiveConnectAllowed();
    if (!gate.ok) {
      throw new Error(gate.reason + ":" + gate.detail);
    }
    const meta = readForpsiImapCredentialSourceMeta();
    const user = String(process.env.IU_FORPSI_IMAP_USER || "").trim();
    const secret = String(process.env.IU_FORPSI_IMAP_SECRET || "").trim();
    if (!user || !secret) {
      throw new Error("credentials_missing");
    }
    await this.#openSocket();
    await this.#readGreeting();
    const loginTag = nextImapTag();
    await this.#command(
      loginTag + " LOGIN " + quoteImapString(user) + " " + quoteImapString(secret),
      { hideInLog: true, tag: loginTag }
    );
    this.authenticated = true;
    return { ok: true, host: this.host, tlsMode: this.tlsMode.id };
  }

  async #openSocket() {
    const mode = this.tlsMode;
    if (mode.tls && !mode.startTls) {
      this.socket = await new Promise((resolve, reject) => {
        const s = tls.connect(
          {
            host: this.host,
            port: mode.port,
            servername: this.host,
            minVersion: mode.minTlsVersion,
            rejectUnauthorized: mode.rejectUnauthorized,
          },
          () => resolve(s)
        );
        s.on("error", reject);
      });
    } else {
      const raw = net.createConnection({ host: this.host, port: mode.port });
      await new Promise((resolve, reject) => {
        raw.once("connect", resolve);
        raw.once("error", reject);
      });
      if (mode.startTls) {
        await this.#waitLine("* OK");
        await this.#writeLine("a001 STARTTLS");
        await this.#waitTagged("a001 OK");
        this.socket = tls.connect({
          socket: raw,
          servername: this.host,
          minVersion: mode.minTlsVersion,
          rejectUnauthorized: mode.rejectUnauthorized,
        });
        await new Promise((resolve, reject) => {
          this.socket.once("secureConnect", resolve);
          this.socket.once("error", reject);
        });
      } else {
        this.socket = raw;
      }
    }
    this.byteBuffer = new ImapByteBuffer();
    this.socket.on("data", (chunk) => {
      this.byteBuffer.append(chunk);
    });
  }

  async listFolders() {
    const tag = nextImapTag();
    const lines = await this.#command(tag + " LIST \"\" \"*\"", { tag });
    const folders = [];
    for (const line of lines) {
      const m = /LIST \([^)]*\) "[^"]*" "?([^"]+)"?/.exec(line);
      if (m) folders.push(m[1]);
    }
    return folders;
  }

  async selectFolderExamine(folder) {
    const tag = nextImapTag();
    const lines = await this.#command(tag + " EXAMINE " + quoteImapString(folder), { tag });
    this.selectedFolder = folder;
    let uidvalidity = null;
    let exists = null;
    for (const line of lines || []) {
      const uv = /\* OK \[UIDVALIDITY (\d+)\]/i.exec(line) || /\* OK \[UIDVALIDITY (\d+)/i.exec(line);
      if (uv) uidvalidity = Number(uv[1]);
      const ex = /^\* (\d+) EXISTS\b/i.exec(line);
      if (ex) exists = Number(ex[1]);
    }
    this.uidvalidity = uidvalidity;
    return {
      ok: true,
      folder,
      readOnly: true,
      uidvalidity,
      messageCount: exists,
    };
  }

  async uidSearchAll() {
    const tag = nextImapTag();
    const lines = await this.#command(tag + " UID SEARCH ALL", { tag });
    const uids = [];
    for (const line of lines) {
      const m = /\* SEARCH([\d\s]+)/.exec(line);
      if (m) {
        for (const part of m[1].trim().split(/\s+/)) {
          const n = Number(part);
          if (Number.isFinite(n)) uids.push(n);
        }
      }
    }
    return uids.sort((a, b) => a - b);
  }

  async uidFetchBodyPeek(uid) {
    const tag = nextImapTag();
    const cmd = tag + " UID FETCH " + uid + " (UID RFC822.SIZE BODY.PEEK[] FLAGS)";
    const ro = assertReadOnlyImapCommand("UID FETCH " + uid + " BODY.PEEK[]");
    if (!ro.ok) throw new Error(ro.reason);
    this.commandsSent.push(cmd);
    await this.#writeLine(cmd);
    const { literal } = await readTaggedFetchWithLiteral(
      () => this.#waitLine(/.*/),
      (n) => this.#readExactBytes(n),
      tag + " OK"
    );
    return {
      uid,
      rfc822Source: literal,
      fetchCommand: "UID FETCH BODY.PEEK[]",
      sourceBytes: literal.length,
    };
  }

  async #readExactBytes(n) {
    const deadline = Date.now() + 30_000;
    while (this.byteBuffer.length < n) {
      if (Date.now() > deadline) throw new Error("imap_read_timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
    const out = this.byteBuffer.readExactBytes(n);
    if (!out || out.length !== n) throw new Error("imap_incomplete_literal");
    return out;
  }

  async logout() {
    try {
      await this.#command("a999 LOGOUT", { tag: "a999" });
    } catch {
      /* ignore */
    }
    try {
      this.socket?.end();
    } catch {
      /* ignore */
    }
  }

  async #readGreeting() {
    this.greeting = await this.#waitLine(/^\* OK/i, 30_000);
  }

  async #command(line, options = {}) {
    const ro = assertReadOnlyImapCommand(line.replace(/^\w+\s/, "").replace(/^a\d+\s/i, ""));
    const cmdBody = line.replace(/^a\d+\s/i, "").replace(/^IU\d+\s/i, "");
    const ro2 = assertReadOnlyImapCommand(cmdBody);
    if (!ro.ok && !String(line).toUpperCase().includes("LOGIN")) {
      throw new Error(ro.reason);
    }
    if (!ro2.ok && !String(line).toUpperCase().includes("LOGIN")) {
      throw new Error(ro2.reason);
    }
    const logged = options.hideInLog ? line.replace(/\s+\S+$/, " ******") : line;
    this.commandsSent.push(logged);
    await this.#writeLine(line);
    const tag = options.tag || line.split(/\s+/)[0];
    return this.#waitTagged(tag + " OK");
  }

  #writeLine(line) {
    return new Promise((resolve, reject) => {
      this.socket.write(line + "\r\n", (err) => (err ? reject(err) : resolve()));
    });
  }

  async #waitLine(pattern, timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const line = this.byteBuffer.readLine();
      if (line !== null) {
        if (typeof pattern === "string" && line.startsWith(pattern)) return line;
        if (pattern instanceof RegExp && pattern.test(line)) return line;
        if (typeof pattern === "string" && line.includes(pattern)) return line;
        // Unmatched untagged line: keep scanning within timeout.
        continue;
      }
      if (Date.now() > deadline) throw new Error("imap_read_timeout");
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async #waitTagged(okPrefix, timeoutMs = 60_000) {
    const lines = [];
    const deadline = Date.now() + timeoutMs;
    const tag = String(okPrefix || "").split(/\s+/)[0];
    for (;;) {
      if (Date.now() > deadline) throw new Error("imap_tagged_timeout:" + tag);
      const line = await this.#waitLine(/.*/, Math.max(1_000, deadline - Date.now()));
      lines.push(line);
      if (line.startsWith(okPrefix)) return lines;
      if (tag && new RegExp("^" + tag + " NO\\b", "i").test(line)) {
        throw new Error("imap_command_failed:" + line.slice(0, 120));
      }
      if (tag && new RegExp("^" + tag + " BAD\\b", "i").test(line)) {
        throw new Error("imap_command_failed:" + line.slice(0, 120));
      }
    }
  }
}

function quoteImapString(value) {
  const s = String(value);
  if (/[^\x20-\x7e]/.test(s)) {
    return "{" + Buffer.byteLength(s, "utf8") + "}\r\n" + s;
  }
  return JSON.stringify(s);
}

/** In-memory mock transport for Step A tests and audit (no network). */
export function createMockForpsiImapTransport(fixture = {}) {
  const mailbox = fixture.mailbox || AFFILIATE_MAILBOX_ADDRESS;
  const folder = fixture.folder || "INBOX";
  const uidvalidity = fixture.uidvalidity ?? 1001;
  const messages = (fixture.messages || []).map((m, i) =>
    normalizeFetchedMessage({
      ...m,
      mailbox,
      folder,
      uid: m.uid ?? i + 1,
      uidvalidity,
    })
  );
  let selected = null;
  const mutationsAttempted = [];

  return {
    mode: "mock",
    mailbox,
    async connect() {
      return { ok: true, mode: "mock", authenticated: true };
    },
    async listMailboxes() {
      return [{ name: folder, messageCount: messages.length, uidvalidity }];
    },
    async selectMailbox(name) {
      if (name !== folder) return { ok: false, reason: "folder_not_enabled", folder: name };
      selected = name;
      return { ok: true, folder: name, uidvalidity, messageCount: messages.length, readOnly: true };
    },
    async fetchMessageByUid(uid) {
      const hit = messages.find((m) => m.uid === uid);
      if (!hit) return { ok: false, reason: "uid_not_found", uid };
      return { ok: true, message: hit, serverMutationsPerformed: false };
    },
    async fetchAllUids() {
      return messages.map((m) => m.uid).sort((a, b) => a - b);
    },
    assertReadOnlyOperation(op) {
      const blocked = ["markSeen", "delete", "move", "append"];
      if (blocked.includes(op)) {
        mutationsAttempted.push(op);
        return { ok: false, reason: "read_only_adapter_blocked", op };
      }
      return { ok: true };
    },
    getMutationsAttempted() {
      return [...mutationsAttempted];
    },
    async disconnect() {
      selected = null;
      return { ok: true };
    },
  };
}

export async function createForpsiImapTransport(options = {}) {
  if (options.mode === "mock" || options.mockFixture) {
    return createMockForpsiImapTransport(options.mockFixture || options.fixture || {});
  }
  const gate = assertForpsiImapLiveConnectAllowed();
  if (!gate.ok) {
    return {
      mode: "live_blocked",
      async connect() {
        return { ok: false, ...gate };
      },
    };
  }
  const session = new ForpsiImapTlsSession(options);
  return {
    mode: "live",
    session,
    async connect() {
      return session.connectAndLogin();
    },
    async listMailboxes() {
      const names = await session.listFolders();
      return names.map((name) => ({ name, messageCount: null, uidvalidity: null }));
    },
    async selectMailbox(folder) {
      const sel = await session.selectFolderExamine(folder);
      return {
        ok: sel?.ok === true,
        folder: sel?.folder || folder,
        readOnly: true,
        uidvalidity: sel?.uidvalidity ?? null,
        messageCount: sel?.messageCount ?? null,
        reason: sel?.ok === true ? null : sel?.reason || "examine_failed",
      };
    },
    async fetchAllUids() {
      return session.uidSearchAll();
    },
    async fetchMessageByUid(uid) {
      const peek = await session.uidFetchBodyPeek(uid);
      return {
        ok: true,
        message: normalizeFetchedMessage({
          mailbox: AFFILIATE_MAILBOX_ADDRESS,
          folder: session.selectedFolder || "INBOX",
          uid,
          uidvalidity: session.uidvalidity ?? null,
          rawRfc822: peek.rfc822Source,
          fetchMethod: peek.fetchCommand,
        }),
        serverMutationsPerformed: false,
      };
    },
    async disconnect() {
      await session.logout();
    },
  };
}
