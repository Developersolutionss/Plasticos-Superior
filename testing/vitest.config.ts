import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./client/setup.ts"],
    include: ["client/**/*.{test,spec}.{ts,tsx}"],
  },
});
