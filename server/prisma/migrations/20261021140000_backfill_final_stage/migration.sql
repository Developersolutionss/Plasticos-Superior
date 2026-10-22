-- Una OP que ya tiene derivadas (no canceladas) es una etapa intermedia: su
-- material siguió a otra estación. Las OPs anteriores a is_final_stage quedan
-- en NULL y se clasificarían por su estado; esto las marca explícitamente.
-- Extrusión nunca es final.
UPDATE "production_orders" p
SET "is_final_stage" = false
WHERE p."is_final_stage" IS NULL
  AND (
    p."station" = 'extrusion'
    OR EXISTS (
      SELECT 1 FROM "production_orders" c
      WHERE c."parent_order_id" = p."id" AND c."status" <> 'cancelada'
    )
  );
