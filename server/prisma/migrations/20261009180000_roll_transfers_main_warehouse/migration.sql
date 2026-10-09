-- Los traslados de rollos entre bodegas ahora pueden ir a (o salir de) la
-- bodega principal, de donde salen los despachos a clientes. Se usa un tipo
-- propio para no agregar "principal" a las estaciones de las OPs.
CREATE TYPE "RollWarehouse" AS ENUM ('extrusion', 'impresion', 'sellado', 'precorte', 'principal');

ALTER TABLE "roll_transfers"
  ALTER COLUMN "from_station" TYPE "RollWarehouse" USING "from_station"::text::"RollWarehouse",
  ALTER COLUMN "to_station" TYPE "RollWarehouse" USING "to_station"::text::"RollWarehouse";
