// Utilidades compartidas por las suites que necesitan una base de datos
// propia (API aislada y E2E): resolver su nombre, recrearla y correr pasos
// contra ella. Nunca tocan la base de desarrollo.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Calcula la base aislada a partir del DATABASE_URL de `server/.env`.
 * `sufijo` es "_test" o "_e2e"; `nombreForzado` permite elegir otro nombre.
 * Salvaguarda: el nombre debe terminar en "_test" o "_e2e" y ser distinto de
 * la base de desarrollo, así ninguna suite puede borrarla por un error.
 */
export function resolverBaseAislada({ sufijo, nombreForzado }) {
  dotenv.config({ path: path.join(root, "server", ".env"), quiet: true });
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    console.error("No hay DATABASE_URL: defínela en server/.env o en el entorno.");
    process.exit(1);
  }

  const url = new URL(baseUrl);
  const baseName = url.pathname.replace(/^\//, "");
  const testName = nombreForzado || `${baseName}${sufijo}`;
  if (!/^[A-Za-z0-9_]+_(test|e2e)$/.test(testName) || testName === baseName) {
    console.error(`Nombre de base aislada no permitido: "${testName}". Debe terminar en "_test" o "_e2e" y ser distinto de "${baseName}".`);
    process.exit(1);
  }

  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${testName}`;
  return { baseUrl, baseName, testName, testUrl: testUrl.toString() };
}

/** Borra y crea de nuevo la base `testName` (conectándose a "postgres"). */
export async function recrearBase({ baseUrl, testName }) {
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    console.log(`==> Recreando la base "${testName}"…`);
    await client.query(`DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${testName}"`);
  } finally {
    await client.end();
  }
}

/** Corre un comando y termina el proceso con su código si falla. */
export function correr(etiqueta, comando, args, { cwd = root, env = process.env } = {}) {
  console.log(`==> ${etiqueta}`);
  const result = spawnSync(comando, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Aplica las migraciones y siembra los datos de ejemplo en `testUrl`. */
export function migrarYSembrar(testUrl) {
  const env = { ...process.env, DATABASE_URL: testUrl };
  correr("Aplicando migraciones", "npx", ["prisma", "migrate", "deploy"], { cwd: path.join(root, "server"), env });
  correr("Sembrando datos", "npm", ["run", "prisma:seed"], { env });
  return env;
}
