-- El endpoint POST /raw-materials/:id/adjust ya aceptaba `notes` en el body
-- pero se descartaba en silencio (no había columna) — se agrega para que la
-- nota de un ajuste manual quede visible en el historial de movimientos.

ALTER TABLE "raw_material_movements" ADD COLUMN "notes" TEXT;
