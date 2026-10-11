/** Immutable archive of Premium terms HTML per version (R2 + D1) and order bindings. */
import { sha256Hex } from "./backup";
import { newId } from "./admin-auth";
import {
  PREMIUM_TERMS_EFFECTIVE_AT,
  PREMIUM_TERMS_V1_EFFECTIVE_AT,
  PREMIUM_TERMS_V1_VERSION,
  PREMIUM_TERMS_V2_EFFECTIVE_AT,
  PREMIUM_TERMS_V2_VERSION,
  PREMIUM_TERMS_VERSION,
  buildPremiumTermsHtml,
  buildPremiumTermsV1Html,
  buildPremiumTermsV2Html,
} from "./premium-terms";
import type { Env } from "./types";

export type PremiumTermsArchiveRow = {
  archive_id: string;
  terms_version: string;
  effective_at: string;
  content_hash: string;
  r2_key: string;
  byte_size: number;
};

export function resolvePremiumTermsArchiveSource(termsVersion: string): { html: string; effective_at: string } | null {
  const nonce = "archive";
  if (termsVersion === PREMIUM_TERMS_V1_VERSION) {
    return { html: buildPremiumTermsV1Html(nonce), effective_at: PREMIUM_TERMS_V1_EFFECTIVE_AT };
  }
  if (termsVersion === PREMIUM_TERMS_V2_VERSION) {
    return { html: buildPremiumTermsV2Html(nonce), effective_at: PREMIUM_TERMS_V2_EFFECTIVE_AT };
  }
  if (termsVersion === PREMIUM_TERMS_VERSION) {
    return { html: buildPremiumTermsHtml(nonce), effective_at: PREMIUM_TERMS_EFFECTIVE_AT };
  }
  return null;
}

export async function ensurePremiumTermsArchiveForVersion(
  env: Env,
  termsVersion: string,
  effectiveAtHint?: string | null
): Promise<PremiumTermsArchiveRow | null> {
  if (!env.DB || !env.DOCUMENTS) return null;
  const existing = await env.DB.prepare(
    "SELECT archive_id, terms_version, effective_at, content_hash, r2_key, byte_size FROM premium_terms_archives WHERE terms_version = ?"
  )
    .bind(termsVersion)
    .first<PremiumTermsArchiveRow>();
  if (existing) return existing;

  const source = resolvePremiumTermsArchiveSource(termsVersion);
  if (!source) return null;
  const effectiveAt = (effectiveAtHint && String(effectiveAtHint).trim()) || source.effective_at;
  const bytes = new TextEncoder().encode(source.html);
  const contentHash = await sha256Hex(bytes);
  const archiveId = newId("pta");
  const r2Key = "premium/terms/archives/" + termsVersion + "/" + contentHash + ".html";
  const nowIso = new Date().toISOString();

  const head = await env.DOCUMENTS.head(r2Key);
  if (!head) {
    await env.DOCUMENTS.put(r2Key, bytes, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { terms_version: termsVersion, content_hash: contentHash },
    });
  }

  await env.DB.prepare(
    `INSERT INTO premium_terms_archives (archive_id, terms_version, effective_at, content_hash, r2_key, byte_size, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(terms_version) DO NOTHING`
  )
    .bind(archiveId, termsVersion, effectiveAt, contentHash, r2Key, bytes.byteLength, nowIso)
    .run();

  return (
    (await env.DB.prepare(
      "SELECT archive_id, terms_version, effective_at, content_hash, r2_key, byte_size FROM premium_terms_archives WHERE terms_version = ?"
    )
      .bind(termsVersion)
      .first<PremiumTermsArchiveRow>()) ?? null
  );
}

export async function bindPremiumOrderTermsArchive(
  env: Env,
  orderId: string,
  termsVersion: string,
  effectiveAtHint?: string | null
): Promise<{ ok: boolean; archive_id?: string; content_hash?: string; missing?: boolean }> {
  if (!env.DB) return { ok: false, missing: true };
  const bound = await env.DB.prepare(
    "SELECT archive_id, content_hash FROM premium_order_terms_bindings WHERE order_id = ?"
  )
    .bind(orderId)
    .first<{ archive_id: string; content_hash: string }>();
  if (bound) return { ok: true, archive_id: bound.archive_id, content_hash: bound.content_hash };

  const archive = await ensurePremiumTermsArchiveForVersion(env, termsVersion, effectiveAtHint);
  if (!archive) return { ok: false, missing: true };

  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO premium_order_terms_bindings (order_id, archive_id, terms_version, content_hash, bound_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(order_id) DO NOTHING`
  )
    .bind(orderId, archive.archive_id, archive.terms_version, archive.content_hash, nowIso)
    .run();

  return { ok: true, archive_id: archive.archive_id, content_hash: archive.content_hash };
}

export async function loadPremiumOrderTermsArchiveHtml(env: Env, orderId: string): Promise<{
  ok: boolean;
  html?: string;
  terms_version?: string;
  effective_at?: string;
  content_hash?: string;
  message_cs?: string;
}> {
  if (!env.DB || !env.DOCUMENTS) {
    return { ok: false, message_cs: "Archiv podmínek není nakonfigurován." };
  }

  let binding = await env.DB.prepare(
    `SELECT b.order_id, b.terms_version, b.content_hash, a.effective_at, a.r2_key
     FROM premium_order_terms_bindings b
     JOIN premium_terms_archives a ON a.archive_id = b.archive_id
     WHERE b.order_id = ?`
  )
    .bind(orderId)
    .first<{ terms_version: string; content_hash: string; effective_at: string; r2_key: string }>();

  if (!binding) {
    const payloadRow = await env.DB.prepare("SELECT payload_json FROM orders WHERE order_id = ?")
      .bind(orderId)
      .first<{ payload_json: string }>();
    let termsVersion: string | null = null;
    let termsEffective: string | null = null;
    if (payloadRow?.payload_json) {
      try {
        const p = JSON.parse(payloadRow.payload_json) as { terms_version?: string; terms_effective_at?: string };
        termsVersion = typeof p.terms_version === "string" ? p.terms_version : null;
        termsEffective = typeof p.terms_effective_at === "string" ? p.terms_effective_at : null;
      } catch {
        termsVersion = null;
      }
    }
    if (!termsVersion) {
      return {
        ok: false,
        message_cs: "Archivní znění obchodních podmínek pro tuto objednávku není k dispozici.",
      };
    }
    const bind = await bindPremiumOrderTermsArchive(env, orderId, termsVersion, termsEffective);
    if (!bind.ok || !bind.archive_id) {
      return {
        ok: false,
        message_cs: "Archivní znění obchodních podmínek pro verzi " + termsVersion + " nelze načíst.",
      };
    }
    binding = await env.DB.prepare(
      `SELECT b.order_id, b.terms_version, b.content_hash, a.effective_at, a.r2_key
       FROM premium_order_terms_bindings b
       JOIN premium_terms_archives a ON a.archive_id = b.archive_id
       WHERE b.order_id = ?`
    )
      .bind(orderId)
      .first<{ terms_version: string; content_hash: string; effective_at: string; r2_key: string }>();
  }

  if (!binding) {
    return { ok: false, message_cs: "Archivní znění obchodních podmínek pro tuto objednávku není k dispozici." };
  }

  const obj = await env.DOCUMENTS.get(binding.r2_key);
  if (!obj) {
    return { ok: false, message_cs: "Soubor archivu podmínek v úložišti chybí — kontaktujte technickou podporu." };
  }
  const html = await obj.text();
  return {
    ok: true,
    html,
    terms_version: binding.terms_version,
    effective_at: binding.effective_at,
    content_hash: binding.content_hash,
  };
}
