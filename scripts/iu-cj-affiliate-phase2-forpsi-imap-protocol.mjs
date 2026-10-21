/** IMAP tagged response + literal reader (byte-accurate BODY.PEEK[]). */

export function parseImapLiteralLength(line) {
  const m = /\{(\d+)\}\r?$/.exec(String(line).trim());
  return m ? Number(m[1]) : null;
}

export class ImapByteBuffer {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  append(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "latin1");
    this.chunks.push(buf);
    this.length += buf.length;
  }

  indexOf(sub, start = 0) {
    const hay = this.toBuffer();
    return hay.indexOf(sub, start);
  }

  toBuffer() {
    return Buffer.concat(this.chunks, this.length);
  }

  readLine() {
    const hay = this.toBuffer();
    const idx = hay.indexOf("\r\n");
    if (idx < 0) return null;
    const line = hay.slice(0, idx).toString("latin1");
    const rest = hay.slice(idx + 2);
    this.chunks = rest.length ? [rest] : [];
    this.length = rest.length;
    return line;
  }

  readExactBytes(n) {
    if (this.length < n) return null;
    const hay = this.toBuffer();
    const out = hay.slice(0, n);
    const rest = hay.slice(n);
    this.chunks = rest.length ? [rest] : [];
    this.length = rest.length;
    return out;
  }
}

/**
 * Read tagged FETCH response; literal lengths are **bytes** (IMAP RFC).
 */
export async function readTaggedFetchWithLiteral(readLine, readExactBytes, tagPrefix, options = {}) {
  const maxLiteralBytes = options.maxLiteralBytes ?? 512 * 1024;
  const deadlineMs = options.deadlineMs ?? 30_000;
  const started = Date.now();
  const lines = [];
  const literalChunks = [];
  let literalBytes = 0;
  for (;;) {
    if (Date.now() - started > deadlineMs) throw new Error("imap_read_timeout");
    const line = await readLine();
    if (line === null) throw new Error("imap_unexpected_eof");
    lines.push(line);
    const litLen = parseImapLiteralLength(line);
    if (litLen != null && litLen >= 0) {
      if (litLen > maxLiteralBytes) throw new Error("imap_literal_too_large");
      const before = line.replace(/\{\d+\}\r?$/, "");
      if (before) lines[lines.length - 1] = before;
      const payload = await readExactBytes(litLen);
      if (!payload || payload.length !== litLen) throw new Error("imap_incomplete_literal");
      literalChunks.push(payload);
      literalBytes += payload.length;
      const tail = await readLine();
      if (tail) lines.push(tail);
    }
    if (line.startsWith(tagPrefix)) break;
  }
  return { lines, literal: Buffer.concat(literalChunks, literalBytes) };
}
