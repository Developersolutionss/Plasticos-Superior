-- Trazabilidad de custodia: qué rollo físico se tomó como insumo, escaneando
-- su QR. Self-FK opcional en production_rolls.

ALTER TABLE "production_rolls" ADD COLUMN "source_roll_id" INTEGER;

ALTER TABLE "production_rolls" ADD CONSTRAINT "production_rolls_source_roll_id_fkey"
  FOREIGN KEY ("source_roll_id") REFERENCES "production_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
