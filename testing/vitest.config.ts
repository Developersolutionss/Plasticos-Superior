import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "jsdom",
    setupFiles: ["./client/setup.ts"],
    include: ["client/**/*.{test,spec}.{ts,tsx}"],
  },
});
