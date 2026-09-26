-- Kilos del rollo al despachar (los pone el servidor) y al recibir (los mide
-- la bodega destino, opcional). Nullable: despachos anteriores no tienen el dato.
ALTER TABLE "roll_transfers" ADD COLUMN "dispatched_kg" DECIMAL(12,2);
ALTER TABLE "roll_transfers" ADD COLUMN "received_kg" DECIMAL(12,2);
