/**
 * Production Worker entry (Deploy IU Ads). Excludes CJ affiliate archive routes until
 * a controlled deploy via index-cj-affiliate-archive.ts + workflow_dispatch.
 */
export { default } from "./index.ts";
