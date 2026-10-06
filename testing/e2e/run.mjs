// Corre las pruebas E2E (navegador real contra la app completa) con su propia
// base de datos (`<base>_e2e`), su propio API (puerto 4100) y su propio front
// (puerto 5273). Recrea la base, migra y siembra antes de empezar, así cada
// corrida parte del mismo estado y no toca la base de desarrollo.
// Uso: `npm run test:e2e` (los argumentos extra pasan a Playwright, por
// ejemplo `npm run test:e2e -- --headed` para ver el navegador).
import { correr, migrarYSembrar, recrearBase, resolverBaseAislada } from "../support/baseAislada.mjs";

const base = resolverBaseAislada({ sufijo: "_e2e", nombreForzado: process.env.E2E_DATABASE_NAME });
await recrearBase(base);
migrarYSembrar(base.testUrl);
correr("Corriendo las pruebas E2E", "npx", ["playwright", "test", "-c", "testing/e2e/playwright.config.ts", ...process.argv.slice(2)], {
  env: { ...process.env, E2E_DATABASE_URL: base.testUrl },
});
