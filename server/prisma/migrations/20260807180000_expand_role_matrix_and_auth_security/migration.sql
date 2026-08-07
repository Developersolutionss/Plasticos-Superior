-- Expande UserRole de 3 valores a la matriz completa (~11 roles), migrando
-- los datos existentes en vez de solo agregar/quitar valores del enum
-- (Postgres no permite DROP VALUE, así que hay que recrear el tipo).

-- 1) Nuevo tipo con los valores finales
CREATE TYPE "UserRole_new" AS ENUM (
  'super_admin',
  'admin',
  'gerente_produccion',
  'planeacion',
  'ventas_pedidos',
  'operario_extrusion',
  'operario_impresion',
  'operario_sellado_precorte',
  'calidad',
  'almacen_despachos',
  'auditor'
);

-- 2) Migra los datos existentes: admin -> super_admin, produccion -> gerente_produccion,
--    despacho -> almacen_despachos (mapeo acordado con Steban)
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING (
  CASE "role"::text
    WHEN 'admin' THEN 'super_admin'
    WHEN 'produccion' THEN 'gerente_produccion'
    WHEN 'despacho' THEN 'almacen_despachos'
  END
)::"UserRole_new";

-- 3) Reemplaza el tipo viejo por el nuevo
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

-- 4) Seguridad de acceso: bloqueo por intentos fallidos + 2FA
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "two_factor_secret" TEXT;
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;

-- 5) Recuperación de contraseña
CREATE TABLE "password_reset_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
