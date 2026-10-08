/**
 * Node prod-proof helper — keep PNG/QR scan logic aligned with
 * cloudflare/iu-ads/src/premium-invoice-pdf-qr-extract.ts
 */
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const adsRoot = join(here, "..", "..", "cloudflare", "iu-ads");
const require = createRequire(import.meta.url);
const { PNG } = require(join(adsRoot, "node_modules", "pngjs"));
const jsQR = require(join(adsRoot, "node_modules", "jsqr"));

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function bytesMatch(buf, off, sig) {
  for (let i = 0; i < sig.length; i++) {
    if (buf[off + i] !== sig[i]) return false;
  }
  return true;
}

export function findEmbeddedPngsInPdf(pdfBytes) {
  const out = [];
  const max = pdfBytes.length;
  for (let i = 0; i < max - PNG_SIG.length; i++) {
    if (!bytesMatch(pdfBytes, i, PNG_SIG)) continue;
    let end = -1;
    for (let j = i + PNG_SIG.length; j < max - IEND.length; j++) {
      if (bytesMatch(pdfBytes, j, IEND)) {
        end = j + IEND.length;
        break;
      }
    }
    if (end > i) {
      out.push(pdfBytes.slice(i, end));
      i = end - 1;
    }
  }
  const buf = Buffer.from(pdfBytes);
  const latin = buf.toString("latin1");
  let idx = 0;
  while (idx < latin.length) {
    const streamStart = latin.indexOf("stream", idx);
    if (streamStart < 0) break;
    let dataStart = streamStart + 6;
    if (latin[dataStart] === "\r") dataStart++;
    if (latin[dataStart] === "\n") dataStart++;
    const streamEnd = latin.indexOf("endstream", dataStart);
    if (streamEnd < 0) break;
    let chunk = buf.subarray(dataStart, streamEnd);
    if (chunk[chunk.length - 1] === 0x0a) chunk = chunk.subarray(0, chunk.length - 1);
    if (chunk[chunk.length - 1] === 0x0d) chunk = chunk.subarray(0, chunk.length - 1);
    const dictStart = latin.lastIndexOf("<<", streamStart);
    const dict = dictStart >= 0 ? latin.slice(dictStart, streamStart) : "";
    if (dict.includes("/FlateDecode")) {
      try {
        const inflated = zlib.inflateSync(chunk);
        if (bytesMatch(inflated, 0, PNG_SIG)) out.push(new Uint8Array(inflated));
        else out.push(...findEmbeddedPngsInPdf(new Uint8Array(inflated)));
      } catch {
        /* skip */
      }
    }
    idx = streamEnd + 9;
  }
  return out;
}

export function decodeSpaydFromInvoicePdfBytes(pdfBytes) {
  const pngs = findEmbeddedPngsInPdf(pdfBytes);
  for (const pngBytes of pngs) {
    try {
      const png = PNG.sync.read(Buffer.from(pngBytes));
      const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      const data = code?.data?.trim();
      if (data && data.startsWith("SPD*")) return data;
    } catch {
      /* next */
    }
  }
  return null;
}

export function pdfBytesContainNeedle(pdfBytes, needle) {
  const n = String(needle || "").trim();
  if (!n) return false;
  const latin = Buffer.from(pdfBytes).toString("latin1");
  if (latin.includes(n)) return true;
  const utf16be = Buffer.from(n, "utf16le").swap16();
  return Buffer.from(pdfBytes).includes(utf16be);
}

export function parseSpaydFields(payload) {
  const out = {};
  const body = payload.startsWith("SPD*") ? payload.slice(4) : payload;
  const segments = body.split("*");
  if (segments[0]?.includes(".")) segments.shift();
  for (const seg of segments) {
    const idx = seg.indexOf(":");
    if (idx <= 0) continue;
    out[seg.slice(0, idx)] = seg.slice(idx + 1);
  }
  return out;
}

export function czechBankAccountToIban(bankCode, accountNumber, accountPrefix = "000000") {
  const bank = String(bankCode).replace(/\D/g, "").padStart(4, "0").slice(-4);
  const prefix = String(accountPrefix).replace(/\D/g, "").padStart(6, "0").slice(-6);
  const account = String(accountNumber).replace(/\D/g, "").padStart(10, "0").slice(-10);
  const bban = bank + prefix + account;
  const numeric = (bban + "123500").replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    rem = Number(String(rem) + numeric.slice(i, i + 7)) % 97;
  }
  const check = String(98 - rem).padStart(2, "0");
  return "CZ" + check + bban;
}

export function buildExpectedSpayd({ amountCents, currency, variableSymbol }) {
  const iban = czechBankAccountToIban("5500", "294822412", "000000");
  const amount = (Number(amountCents) / 100).toFixed(2);
  const vs = String(variableSymbol).replace(/\D/g, "").slice(-10);
  return (
    "SPD*1.0*ACC:" +
    iban +
    "*AM:" +
    amount +
    "*CC:" +
    (currency || "CZK").toUpperCase() +
    "*X-VS:" +
    vs
  );
}

export function variableSymbolFromInvoiceNumber(invoiceNumber) {
  const digits = String(invoiceNumber || "").replace(/\D/g, "");
  return digits.slice(-10) || String(invoiceNumber || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 10);
}
