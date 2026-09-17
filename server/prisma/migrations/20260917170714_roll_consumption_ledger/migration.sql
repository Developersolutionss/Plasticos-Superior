-- Un rollo madre ya no se consume entero de una sola vez: en Sellado/Precorte
-- se monta el rollo grande de Extrusión y se le van sacando rollos chicos
-- hasta agotarlo, así que el mismo source_roll_id se repite en varias filas.
-- DropIndex
DROP INDEX "production_rolls_source_roll_id_key";

-- CreateIndex
CREATE INDEX "production_rolls_source_roll_id_idx" ON "production_rolls"("source_roll_id");

-- CreateTable
CREATE TABLE "roll_consumptions" (
    "id" SERIAL NOT NULL,
    "roll_id" INTEGER NOT NULL,
    "source_roll_id" INTEGER NOT NULL,
    "quantity_kg" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roll_consumptions_roll_id_idx" ON "roll_consumptions"("roll_id");

-- CreateIndex
CREATE INDEX "roll_consumptions_source_roll_id_idx" ON "roll_consumptions"("source_roll_id");

-- AddForeignKey
ALTER TABLE "roll_consumptions" ADD CONSTRAINT "roll_consumptions_roll_id_fkey"
  FOREIGN KEY ("roll_id") REFERENCES "production_rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_consumptions" ADD CONSTRAINT "roll_consumptions_source_roll_id_fkey"
  FOREIGN KEY ("source_roll_id") REFERENCES "production_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: hasta ahora escanear un rollo como insumo lo consumía ENTERO (el
-- unique de arriba lo garantizaba), así que cada fila histórica con
-- source_roll_id equivale a haberle sacado al madre todo su peso. Sin esto,
-- un rollo viejo ya consumido aparecería con saldo completo y se podría
-- volver a usar.
INSERT INTO "roll_consumptions" ("roll_id", "source_roll_id", "quantity_kg", "created_at")
SELECT r."id", r."source_roll_id", madre."weight_kg", r."created_at"
FROM "production_rolls" r
JOIN "production_rolls" madre ON madre."id" = r."source_roll_id"
WHERE r."source_roll_id" IS NOT NULL;
