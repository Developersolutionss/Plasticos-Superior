import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Las pruebas E2E escriben datos reales. Solo corren contra una base que
// termina en "_e2e", que prepara `npm run test:e2e`. Si alguien llama a
// Playwright directo, se corta acá antes de tocar nada.
const baseDeDatos = process.env.E2E_DATABASE_URL;
if (!baseDeDatos || !/_e2e$/.test(new URL(baseDeDatos).pathname)) {
  throw new Error("Corre las pruebas E2E con `npm run test:e2e`: prepara su propia base (_e2e) y evita tocar la de desarrollo.");
}

const raiz = path.resolve(import.meta.dirname, "..", "..");
export const PUERTO_API = 4100;
export const PUERTO_FRONT = 5273;

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: "**/*.spec.ts",
  outputDir: path.join(import.meta.dirname, "resultados"),
  // Los flujos comparten una sola base: se corren de a uno y en orden.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(import.meta.dirname, "informe") }]],
  use: {
    baseURL: `http://localhost:${PUERTO_FRONT}`,
    locale: "es-CO",
    timezoneId: "America/Bogota",
    // La PWA registra un service worker que cachea; en las pruebas se bloquea
    // para que cada corrida vea siempre lo recién compilado.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }, testIgnore: /\.movil\.spec\.ts$/ },
    { name: "movil", use: { ...devices["Pixel 7"] }, testMatch: /\.movil\.spec\.ts$/ },
  ],
  webServer: [
    {
      command: "node --import tsx src/index.ts",
      cwd: path.join(raiz, "server"),
      url: `http://localhost:${PUERTO_API}/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...(process.env as Record<string, string>),
        PORT: String(PUERTO_API),
        DATABASE_URL: baseDeDatos,
        JWT_SECRET: "e2e-jwt-secret",
        ROLL_TOKEN_SECRET: "e2e-roll-token-secret",
        FRONTEND_URL: `http://localhost:${PUERTO_FRONT}`,
      },
    },
    {
      // Compilación de producción (la que usa la planta), no el servidor de
      // desarrollo: sin el doble montaje de StrictMode ni código de depuración.
      command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PUERTO_FRONT} --strictPort`,
      cwd: path.join(raiz, "client"),
      url: `http://localhost:${PUERTO_FRONT}`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { ...(process.env as Record<string, string>), API_PROXY_TARGET: `http://localhost:${PUERTO_API}` },
    },
  ],
});
