-- AlterTable: un rollo físico solo se puede consumir una vez como insumo
CREATE UNIQUE INDEX "production_rolls_source_roll_id_key" ON "production_rolls"("source_roll_id");
