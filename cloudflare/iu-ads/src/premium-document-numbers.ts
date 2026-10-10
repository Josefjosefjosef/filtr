/**
 * Sequential document numbers for storno confirmations and credit notes (per calendar year).
 */
import { newId } from "./admin-auth";

function yearKey(prefix: string, year: number): string {
  return prefix + "_SEQ_" + String(year);
}

async function nextSequence(db: D1Database, settingsKey: string): Promise<number> {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(settingsKey).first<{ value: string }>();
  const current = Math.max(0, Number(row?.value) || 0);
  const next = current + 1;
  await db
    .prepare(
      "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
    .bind(settingsKey, String(next))
    .run();
  return next;
}

export async function allocatePremiumStornoNumber(db: D1Database, nowIso: string): Promise<string> {
  const year = new Date(nowIso).getFullYear();
  const seq = await nextSequence(db, yearKey("PREMIUM_STORNO", year));
  return "STO-" + String(year) + "-" + String(seq).padStart(6, "0");
}

export async function allocatePremiumCreditNoteNumber(db: D1Database, nowIso: string): Promise<string> {
  const year = new Date(nowIso).getFullYear();
  const seq = await nextSequence(db, yearKey("PREMIUM_CREDIT_NOTE", year));
  return "DOB-" + String(year) + "-" + String(seq).padStart(6, "0");
}

export function newStornoRecordId(): string {
  return newId("sto");
}

export function newCreditNoteId(): string {
  return newId("dob");
}
