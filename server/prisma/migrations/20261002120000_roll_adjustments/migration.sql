-- Ajustes de saldo de un rollo (peso al recibir en otra bodega / conteo físico).
-- El saldo disponible pasa a ser: peso del rollo − lo consumido + suma de ajustes.
CREATE TYPE "RollAdjustmentReason" AS ENUM ('recepcion', 'conteo');

CREATE TABLE "roll_adjustments" (
    "id" SERIAL NOT NULL,
    "roll_id" INTEGER NOT NULL,
    "reason" "RollAdjustmentReason" NOT NULL,
    "previous_kg" DECIMAL(12,2) NOT NULL,
    "new_kg" DECIMAL(12,2) NOT NULL,
    "delta_kg" DECIMAL(12,2) NOT NULL,
    "transfer_id" INTEGER,
    "notes" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roll_adjustments_transfer_id_key" ON "roll_adjustments"("transfer_id");
CREATE INDEX "roll_adjustments_roll_id_idx" ON "roll_adjustments"("roll_id");

ALTER TABLE "roll_adjustments" ADD CONSTRAINT "roll_adjustments_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "production_rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "roll_adjustments" ADD CONSTRAINT "roll_adjustments_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "roll_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "roll_adjustments" ADD CONSTRAINT "roll_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
