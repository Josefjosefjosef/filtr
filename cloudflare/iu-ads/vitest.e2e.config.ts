import { defineConfig } from "vitest/config";

export default defineConfig({
  assetsInclude: ["**/*.ttf"],
  test: {
    environment: "node",
    setupFiles: ["test/vitest-font-setup.ts"],
    include: ["test/premium-order-form-e2e.test.ts"],
    testTimeout: 120000,
  },
});
