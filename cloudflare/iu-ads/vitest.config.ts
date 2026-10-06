import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/premium-order-form-e2e.test.ts"],
    testTimeout: 120000,
  },
});
