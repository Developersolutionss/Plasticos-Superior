-- QR publico por ubicacion: token secreto (no adivinable como el `code`)
-- que da acceso de solo lectura, sin login, al stock de esa ubicacion
-- puntual (ver server/src/routes/publicLocation.ts).
ALTER TABLE "warehouse_locations" ADD COLUMN "public_token" TEXT;

-- Backfill para ubicaciones ya existentes: no depende de extensiones de
-- Postgres (pgcrypto/gen_random_uuid), suficiente entropia para este caso
-- de uso (evitar adivinar un link, no un secreto criptografico critico).
UPDATE "warehouse_locations"
SET "public_token" = md5(random()::text || clock_timestamp()::text || "id"::text)
WHERE "public_token" IS NULL;

ALTER TABLE "warehouse_locations" ALTER COLUMN "public_token" SET NOT NULL;

CREATE UNIQUE INDEX "warehouse_locations_public_token_key" ON "warehouse_locations"("public_token");
