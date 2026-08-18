import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const {
  IU_SW_CACHE_VERSION_TOKENS,
  IU_SW_CACHE_VERSION_CURRENT,
  swHasAllowedCacheVersion,
} = require("./iu-sw-cache-version-allowlist.cjs");
