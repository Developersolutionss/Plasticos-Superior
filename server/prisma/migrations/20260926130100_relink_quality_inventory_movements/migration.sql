-- Reetiqueta los movimientos viejos: el valor nuevo del enum no se puede
-- usar en la misma transacción en que se crea, por eso va en una migración
-- aparte.
--
-- 1) Entradas de Calidad: se guardaban con reference_id = id del control de
--    calidad. Pasan a apuntar a la OP.
UPDATE "inventory_movements" m
SET "reference_type" = 'production_order', "reference_id" = qc."production_order_id"
FROM "quality_checks" qc
WHERE m."reference_type" = 'manual_adjustment'
  AND m."movement_type" = 'entrada_produccion'
  AND m."reference_id" = qc."id";

-- 2) Reversiones por reapertura: ya apuntaban a la OP (reference_id = id de
--    la OP), solo cambia el tipo.
UPDATE "inventory_movements" m
SET "reference_type" = 'production_order'
FROM "production_orders" po
WHERE m."reference_type" = 'manual_adjustment'
  AND m."movement_type" = 'ajuste'
  AND m."reference_id" = po."id";
