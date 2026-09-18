-- El código del QR de un rollo (EXT-1, PRE-1, SELL-1...) pasa a numerarse
-- por estación en vez de compartir el autoincrement `id` de toda la tabla
-- (antes sacar un rollo de Extrusión después de uno de Precorte podía
-- saltar de EXT-70 a PRE-71 en vez de arrancar en 1).

-- AlterTable: se agregan nullable primero para poder backfillear antes de
-- exigir NOT NULL.
ALTER TABLE "production_rolls" ADD COLUMN "station" "ProductionStation";
ALTER TABLE "production_rolls" ADD COLUMN "station_sequence" INTEGER;

-- Backfill: cada rollo hereda la estación de su OP...
UPDATE "production_rolls" r
SET "station" = po."station"
FROM "production_orders" po
WHERE po.id = r."production_order_id";

-- ...y la numeración por estación se arma en el mismo orden en que ya
-- existían (por id, que es el orden real de creación) — así los rollos
-- viejos conservan una numeración estable en vez de barajarse.
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "station" ORDER BY id) AS seq
  FROM "production_rolls"
)
UPDATE "production_rolls" r
SET "station_sequence" = numbered.seq
FROM numbered
WHERE numbered.id = r.id;

-- Ahora sí, NOT NULL: todo rollo pertenece a una OP con estación asignada
-- (no hay forma de cargar rollos en una OP "en blanco" sin proceso).
ALTER TABLE "production_rolls" ALTER COLUMN "station" SET NOT NULL;
ALTER TABLE "production_rolls" ALTER COLUMN "station_sequence" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "production_rolls_station_station_sequence_key" ON "production_rolls"("station", "station_sequence");
