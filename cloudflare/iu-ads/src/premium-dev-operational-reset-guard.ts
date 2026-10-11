import type { Env } from "./types";

/** D1 fallback when Worker var is unset (value "0" disables, "1" enables). */
export const PREMIUM_DEV_OPERATIONAL_RESET_SETTING_KEY = "premium_dev_operational_reset_enabled";

function envTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function envFalsy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "0" || s === "false" || s === "no";
}

/** Bulk „Vyčistit všechny testovací záznamy“ — allowed only during pre-commercial development. */
export async function isPremiumDevOperationalResetEnabled(env: Env): Promise<boolean> {
  if (envTruthy(env.PREMIUM_COMMERCIAL_LIVE)) return false;
  if (envFalsy(env.PREMIUM_DEV_OPERATIONAL_RESET_ENABLED)) return false;
  if (envTruthy(env.PREMIUM_DEV_OPERATIONAL_RESET_ENABLED)) return true;
  if (!env.DB) return true;
  const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = ?")
    .bind(PREMIUM_DEV_OPERATIONAL_RESET_SETTING_KEY)
    .first<{ value: string }>();
  if (row?.value != null) {
    if (envFalsy(String(row.value))) return false;
    if (envTruthy(String(row.value))) return true;
  }
  return true;
}

export async function premiumDevOperationalResetDisabledMessage(env: Env): Promise<string> {
  if (envTruthy(env.PREMIUM_COMMERCIAL_LIVE)) {
    return "Hromadný reset testovacích dat je po spuštění ostrého provozu zakázán (PREMIUM_COMMERCIAL_LIVE).";
  }
  return "Hromadný reset testovacích dat je vypnutý (PREMIUM_DEV_OPERATIONAL_RESET_ENABLED nebo nastavení v D1).";
}
