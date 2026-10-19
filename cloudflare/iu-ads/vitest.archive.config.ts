import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const extractRoot = process.env.IU_CJ_VITEST_EXTRACT_ROOT || toolRoot;

/** Archive audit vitest: extracted sources + repo toolchain node_modules. */
export default defineConfig({
  root: extractRoot,
  resolve: {
    alias: {
      fflate: path.join(toolRoot, "node_modules/fflate"),
    },
  },
  test: {
    environment: "node",
    include: [
      "test/affiliate-ad-archive.test.ts",
      "test/affiliate-ad-archive-publication-trust.test.ts",
    ],
    testTimeout: 120000,
    deps: {
      moduleDirectories: [path.join(toolRoot, "node_modules")],
    },
  },
});
