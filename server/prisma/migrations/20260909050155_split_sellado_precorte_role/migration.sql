-- Separa el rol combinado "operario_sellado_precorte" en dos roles reales:
-- "operario_sellado" y "operario_precorte" -- el cliente pidió que sean
-- distintos (Extrusión e Impresión ya eran roles separados). Postgres no
-- permite DROP VALUE de un enum, así que hay que recrear el tipo (mismo
-- patrón que 20260807180000_expand_role_matrix_and_auth_security).

-- 1) Nuevo tipo con los valores finales
CREATE TYPE "UserRole_new" AS ENUM (
  'super_admin',
  'admin',
  'gerente_produccion',
  'planeacion',
  'ventas_pedidos',
  'operario_extrusion',
  'operario_impresion',
  'operario_sellado',
  'operario_precorte',
  'calidad',
  'almacen_despachos',
  'auditor'
);

-- 2) Migra los datos existentes: todos los que tenían el rol combinado
--    quedan en "operario_sellado" por defecto (acordado con Steban); los
--    que en realidad hacen Precorte se corrigen a mano en Usuarios.
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING (
  CASE "role"::text
    WHEN 'operario_sellado_precorte' THEN 'operario_sellado'
    ELSE "role"::text
  END
)::"UserRole_new";

-- 3) Reemplaza el tipo viejo por el nuevo
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
