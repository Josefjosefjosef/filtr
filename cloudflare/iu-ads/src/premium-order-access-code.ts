/**
 * Human-facing premium order reference + client portal access code (hash-only at rest).
 */
import { hashClientAccessCode } from "./admin-codes";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GROUP_LEN = 4;

function randomGroup(): string {
  const bytes = new Uint8Array(GROUP_LEN);
  crypto.getRandomValues(bytes);
  let part = "";
  for (let i = 0; i < GROUP_LEN; i++) part += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return part;
}

/** Format IU-YY-XXXX-XXXX (non-sequential, high entropy). */
export function generateCustomerOrderCode(now: Date = new Date()): { plaintext: string; prefix: string } {
  const yy = String(now.getUTCFullYear() % 100).padStart(2, "0");
  const g1 = randomGroup();
  const g2 = randomGroup();
  const plaintext = "IU-" + yy + "-" + g1 + "-" + g2;
  return { plaintext, prefix: "IU-" + yy };
}

export function normalizeCustomerOrderCode(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export async function hashOrderPortalCode(plaintext: string, pepper: string): Promise<string> {
  return hashClientAccessCode(normalizeCustomerOrderCode(plaintext), pepper);
}
