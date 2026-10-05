// Corre las pruebas del servidor contra una base aparte (`<base>_test`), para
// que no dejen OPs, movimientos ni notificaciones de prueba en la base de
// desarrollo. Cada corrida la recrea desde cero: migra y siembra antes de
// probar. Uso: `npm run test:server:aislado`.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, "server", ".env") });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  console.error("No hay DATABASE_URL: defínela en server/.env o en el entorno.");
  process.exit(1);
}

const url = new URL(baseUrl);
const baseName = url.pathname.replace(/^\//, "");
const testName = process.env.TEST_DATABASE_NAME || `${baseName}_test`;

// Salvaguarda: solo se borra una base cuyo nombre termina en "_test". Así este
// script nunca puede eliminar la base de desarrollo, aunque alguien se
// equivoque con la variable.
if (!/^[A-Za-z0-9_]+_test$/.test(testName) || testName === baseName) {
  console.error(`Nombre de base de pruebas no permitido: "${testName}". Debe terminar en "_test" y ser distinto de "${baseName}".`);
  process.exit(1);
}

const testUrl = new URL(baseUrl);
testUrl.pathname = `/${testName}`;

// Se conecta a la base de mantenimiento "postgres" para poder borrar y crear.
const adminUrl = new URL(baseUrl);
adminUrl.pathname = "/postgres";
adminUrl.search = "";

const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  console.log(`==> Recreando la base de pruebas "${testName}"…`);
  await client.query(`DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${testName}"`);
} finally {
  await client.end();
}

const env = { ...process.env, DATABASE_URL: testUrl.toString() };
function run(label, command, args, cwd) {
  console.log(`==> ${label}`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("Aplicando migraciones", "npx", ["prisma", "migrate", "deploy"], path.join(root, "server"));
run("Sembrando datos", "npm", ["run", "prisma:seed"], root);
run("Corriendo las pruebas del servidor", "npm", ["run", "test", "--workspace=server"], root);
