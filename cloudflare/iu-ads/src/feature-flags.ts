export type FeatureFlags = {
  safeMode: boolean;
  publicDeliveryEnabled: boolean;
  adminApiEnabled: boolean;
  clientApiEnabled: boolean;
};

function isTruthy(v: string | undefined, defaultValue: boolean): boolean {
  if (v === undefined || v === "") return defaultValue;
  const n = v.trim().toLowerCase();
  if (n === "true" || n === "1" || n === "yes" || n === "on") return true;
  if (n === "false" || n === "0" || n === "no" || n === "off") return false;
  return defaultValue;
}

/** Fail-closed defaults: public/admin/client APIs off; safe mode on. */
export function resolveFeatureFlags(env: {
  ADS_SAFE_MODE?: string;
  ADS_PUBLIC_DELIVERY_ENABLED?: string;
  ADS_ADMIN_API_ENABLED?: string;
  ADS_CLIENT_API_ENABLED?: string;
}): FeatureFlags {
  return {
    safeMode: isTruthy(env.ADS_SAFE_MODE, true),
    publicDeliveryEnabled: isTruthy(env.ADS_PUBLIC_DELIVERY_ENABLED, false),
    adminApiEnabled: isTruthy(env.ADS_ADMIN_API_ENABLED, false),
    clientApiEnabled: isTruthy(env.ADS_CLIENT_API_ENABLED, false),
  };
}

export function isPublicDeliveryActive(flags: FeatureFlags): boolean {
  return flags.publicDeliveryEnabled && !flags.safeMode;
}
