// Corre las pruebas del servidor contra una base aparte (`<base>_test`), para
// que no dejen OPs, movimientos ni notificaciones de prueba en la base de
// desarrollo. Cada corrida la recrea desde cero: migra y siembra antes de
// probar. Uso: `npm run test:server:aislado`.
import { correr, migrarYSembrar, recrearBase, resolverBaseAislada } from "./support/baseAislada.mjs";

const base = resolverBaseAislada({ sufijo: "_test", nombreForzado: process.env.TEST_DATABASE_NAME });
await recrearBase(base);
const env = migrarYSembrar(base.testUrl);
correr("Corriendo las pruebas del servidor", "npm", ["run", "test", "--workspace=server"], { env });
