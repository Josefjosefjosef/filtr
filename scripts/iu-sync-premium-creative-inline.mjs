#!/usr/bin/env node
/**
 * Sync cloudflare/iu-ads/src/premium-creative-render-inline.ts from assets bundle.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(ROOT, "assets/iu-premium-creative-render-v1.js"), "utf8");
const out =
  "/** Inlined from assets/iu-premium-creative-render-v1.js (keep in sync). Run: npm run iu-sync-premium-creative-inline */\n" +
  "export const INLINE_PREMIUM_CREATIVE_RENDER_JS: string = " +
  JSON.stringify(js) +
  ";\n";
fs.writeFileSync(path.join(ROOT, "cloudflare/iu-ads/src/premium-creative-render-inline.ts"), out);
console.log("OK iu-sync-premium-creative-inline");
